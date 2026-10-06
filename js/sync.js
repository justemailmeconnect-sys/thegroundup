/* The Ground Up: sync across your devices.
   When the dashboard is open on claude.ai, your records are kept in your own private space in the
   artifact's database (data/users/<you>/, which nobody else can read) and your files are uploaded as
   artifact assets. Every device you open it on loads the same data and sees changes live.
   Everywhere else (a file on your computer, your own web host) it stays in this browser only.

   Each part of the state (transactions, bills, settings…) is saved as JSON text, split into
   documents small enough for the database. A part is only rewritten when it changed. */
(function () {
  'use strict';
  const GU = window.GU;
  const store = GU.store;

  const SYNC_KEY = 'groundup.sync.v1';
  const CHUNK_BYTES = 200000;
  const NOT_SYNCED = ['version'];
  const LOCAL_SETTINGS = ['apiKey']; // secrets stay on the device they were typed on
  const MAX_ASSET = 20 * 1024 * 1024;

  let db = null;
  let col = null;
  let assets = null;
  let uid = null;
  let ready = false;
  let applying = false;
  let unsub = null;
  let timer = null;
  let writing = false;
  let again = false;
  let deviceFresh = false;
  const remoteParts = {}; // key -> highest part count seen on the server
  const SESSION = 's' + GU.util.uid(); // marks this page's own writes, so their echoes are ignored
  const status = { mode: 'off', message: 'Saved in this browser only.', savedAt: null, files: { uploaded: 0, waiting: 0, local: 0 } };
  const listeners = new Set();

  /* ---------- small helpers ---------- */
  const enc = new TextEncoder();
  function hash(str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0).toString(36) + '.' + str.length.toString(36);
  }
  function loadMemo() {
    try {
      return JSON.parse(localStorage.getItem(SYNC_KEY) || '{}');
    } catch (e) {
      return {};
    }
  }
  const memo = loadMemo(); // {uid, synced: {key: hash}, device, welcomed}
  memo.synced = memo.synced || {};
  if (!memo.device) memo.device = 'd' + GU.util.uid();
  function saveMemo() {
    try {
      localStorage.setItem(SYNC_KEY, JSON.stringify(memo));
    } catch (e) {
      /* storage full: sync still works for this visit */
    }
  }
  function setStatus(mode, message) {
    status.mode = mode;
    if (message != null) status.message = message;
    listeners.forEach((fn) => fn(status));
  }
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  /* What gets saved for one part of the state. */
  function partOf(state, key) {
    const v = state[key];
    if (key === 'settings') {
      const out = Object.assign({}, v);
      for (const k of LOCAL_SETTINGS) delete out[k];
      return out;
    }
    if (key === 'inbox') return (v || []).filter((i) => i.status !== 'reading');
    return v;
  }
  function keysOf(state) {
    return Object.keys(state).filter((k) => !NOT_SYNCED.includes(k));
  }
  /* Splits text into pieces that each fit in one document. */
  function split(json) {
    const out = [];
    let i = 0;
    while (i < json.length) {
      let n = Math.min(json.length - i, 120000);
      while (n > 1000 && enc.encode(JSON.stringify(json.slice(i, i + n))).length > CHUNK_BYTES) n = Math.floor(n / 2);
      out.push(json.slice(i, i + n));
      i += n;
    }
    return out.length ? out : [''];
  }

  /* ---------- reading what's on the server ---------- */
  function assemble(snap) {
    const meta = {};
    const groups = {};
    for (const d of snap.docs) {
      if (!d.exists) continue;
      const b = d.data();
      if (d.id === 'meta') {
        Object.assign(meta, (b && b.keys) || {});
        continue;
      }
      if (!b || typeof b.k !== 'string') continue;
      remoteParts[b.k] = Math.max(remoteParts[b.k] || 0, (b.p || 0) + 1);
      const g = (groups[b.k] = groups[b.k] || {});
      const v = (g[b.h] = g[b.h] || { n: b.n, at: 0, parts: [], mine: true });
      v.parts[b.p] = b.s;
      v.at = Math.max(v.at, b.at || 0);
      if (b.session !== SESSION) v.mine = false;
    }
    const out = {};
    for (const k of Object.keys(groups)) {
      const complete = Object.entries(groups[k]).filter(([, v]) => v.parts.filter((x) => typeof x === 'string').length === v.n);
      if (!complete.length) continue; // being written right now: the next snapshot will have it
      const want = meta[k] && complete.find(([h]) => h === meta[k].h);
      const [h, v] = want || complete.sort((a, b) => b[1].at - a[1].at)[0];
      out[k] = { h, json: v.parts.join(''), mine: v.mine };
    }
    return out;
  }

  /* Everything in `primary`, plus records only `extra` has (matched by id). For objects, `primary` wins key by key. */
  function union(primary, extra, skipDemo) {
    if (Array.isArray(primary) && Array.isArray(extra)) {
      const ids = new Set(primary.map((x) => x && x.id).filter(Boolean));
      return primary.concat(extra.filter((x) => x && x.id && !ids.has(x.id) && !(skipDemo && x.demo)));
    }
    if (primary && extra && typeof primary === 'object' && typeof extra === 'object' && !Array.isArray(primary) && !Array.isArray(extra)) return Object.assign({}, extra, primary);
    return primary;
  }

  function onRemote(snap, initial) {
    const remote = assemble(snap);
    const state = store.state;
    const next = {};
    let changed = false;
    for (const [k, r] of Object.entries(remote)) {
      if (memo.synced[k] === r.h || r.mine) continue;
      let theirs;
      try {
        theirs = JSON.parse(r.json);
      } catch (e) {
        continue;
      }
      const localHash = state[k] === undefined ? null : hash(JSON.stringify(partOf(state, k)));
      if (localHash === r.h) {
        memo.synced[k] = r.h;
        continue;
      }
      const untouched = memo.synced[k] != null && localHash === memo.synced[k];
      if (untouched || deviceFresh || state[k] === undefined) next[k] = theirs; // nothing new here: take theirs
      else if (memo.synced[k] == null) next[k] = union(theirs, partOf(state, k), true); // first sync of a device that already had data: theirs, plus anything only this device has
      else next[k] = union(partOf(state, k), theirs, false); // both changed: keep yours, add what's new from the other device
      memo.synced[k] = r.h;
      changed = true;
    }
    saveMemo();
    if (!changed) return Object.keys(remote).length > 0;
    applying = true;
    try {
      const merged = Object.assign({}, store.state);
      for (const k of Object.keys(next)) {
        if (k === 'settings') merged.settings = Object.assign({}, next.settings, pick(store.state.settings, LOCAL_SETTINGS));
        else if (k === 'inbox') {
          const ids = new Set((next.inbox || []).map((i) => i.id));
          merged.inbox = (next.inbox || []).concat((store.state.inbox || []).filter((i) => i.status === 'reading' && !ids.has(i.id)));
        } else merged[k] = next[k];
      }
      store.replaceAll(merged);
    } finally {
      applying = false;
    }
    if (!initial) schedule(800);
    return true;
  }
  function pick(o, keys) {
    const out = {};
    for (const k of keys) if (o && o[k] !== undefined) out[k] = o[k];
    return out;
  }

  /* ---------- saving ---------- */
  function schedule(ms) {
    if (!col || !ready) return;
    clearTimeout(timer);
    timer = setTimeout(flush, ms == null ? 1500 : ms);
  }

  async function write(ref, body) {
    try {
      await ref.set(body);
    } catch (e) {
      if (e && e.code === 'unavailable') {
        await sleep(800 + Math.random() * 1200);
        await ref.set(body);
      } else throw e;
    }
  }

  async function flush() {
    if (!col || !ready || applying) return;
    if (writing) {
      again = true;
      return;
    }
    writing = true;
    try {
      const state = store.state;
      const changes = [];
      for (const k of keysOf(state)) {
        const json = JSON.stringify(partOf(state, k));
        if (json === undefined) continue;
        const h = hash(json);
        if (memo.synced[k] !== h) changes.push({ k, json, h });
      }
      if (!changes.length) return;
      setStatus('saving', 'Saving…');
      const metaKeys = {};
      for (const c of changes) {
        const parts = split(c.json);
        const at = Date.now();
        for (let i = 0; i < parts.length; i++) await write(col.doc('k.' + c.k + '.' + i), { k: c.k, p: i, n: parts.length, h: c.h, s: parts[i], at, device: memo.device, session: SESSION });
        for (let i = parts.length; i < (remoteParts[c.k] || 0); i++) await col.doc('k.' + c.k + '.' + i).delete();
        remoteParts[c.k] = parts.length;
        memo.synced[c.k] = c.h;
        metaKeys[c.k] = { h: c.h, n: parts.length };
      }
      const metaRef = col.doc('meta');
      const cur = await metaRef.get();
      await write(metaRef, { keys: Object.assign({}, cur.exists ? cur.data().keys : {}, metaKeys), at: Date.now(), device: memo.device });
      saveMemo();
      status.savedAt = Date.now();
      setStatus('on', 'Synced across your devices.');
    } catch (e) {
      failed(e);
    } finally {
      writing = false;
      if (again) {
        again = false;
        schedule(300);
      }
    }
  }

  function failed(e) {
    const code = e && e.code;
    console.warn('[sync]', code, e && e.message);
    if (code === 'quota_exceeded') setStatus('error', 'Your synced storage is full, so new changes are only saved in this browser. Export a backup from Settings.');
    else if (code === 'revoked' || code === 'not_granted' || code === 'capability_disabled' || code === 'capability_removed') {
      stop();
      setStatus('off', 'Sync isn’t available here, so changes are saved in this browser only.');
    } else setStatus('error', 'Couldn’t sync just now. Your changes are safe in this browser and I’ll try again.');
    if (code !== 'revoked' && code !== 'not_granted') {
      clearTimeout(timer);
      timer = setTimeout(flush, 30000);
    }
  }

  function stop() {
    if (unsub) unsub();
    unsub = null;
    col = null;
    ready = false;
  }

  /* ---------- files ---------- */
  const ACCEPTED = /^(image\/(png|jpeg|gif|webp)|application\/pdf|video\/(mp4|webm)|text\/(csv|plain|markdown)|application\/json)$/;
  const BY_EXT = { pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', csv: 'text/csv', md: 'text/markdown', json: 'application/json',
    txt: 'text/plain', text: 'text/plain', qif: 'text/plain', ofx: 'text/plain', qfx: 'text/plain', eml: 'text/plain' };
  function assetType(rec) {
    const t = String(rec.type || '').split(';')[0].trim().toLowerCase();
    if (ACCEPTED.test(t)) return t;
    const ext = (String(rec.name || '').match(/\.([a-z0-9]+)$/i) || [])[1];
    return (ext && BY_EXT[ext.toLowerCase()]) || null;
  }
  const queue = [];
  let uploading = false;
  let found = {};
  function commitFound() {
    const done = found;
    found = {};
    if (!Object.keys(done).length) return;
    store.commit((st) => {
      st.remoteFiles = Object.assign({}, st.remoteFiles || {}, done);
    });
  }
  function queueUpload(id) {
    if (!assets || (store.state.remoteFiles || {})[id] || queue.includes(id)) return;
    queue.push(id);
    status.files.waiting = queue.length;
    pumpUploads();
  }
  async function pumpUploads() {
    if (uploading || !assets || !ready) return;
    uploading = true;
    let tries = 0;
    try {
      while (queue.length && assets) {
        const id = queue[0];
        const rec = (store.state.remoteFiles || {})[id] ? null : await GU.files.getLocal(id);
        if (!rec || !rec.blob || rec.demo) {
          queue.shift();
          continue;
        }
        const meta = { name: rec.name, type: rec.type, size: rec.size, added: rec.added };
        const type = assetType(rec);
        if (!type || rec.blob.size > MAX_ASSET || rec.blob.size === 0) {
          found[id] = Object.assign({ skip: !type ? 'type' : 'size' }, meta);
          queue.shift();
          continue;
        }
        try {
          const r = await assets.upload(rec.blob, { type });
          found[id] = Object.assign({ asset: r.id }, meta);
          queue.shift();
          tries = 0;
          status.files.uploaded++;
        } catch (e) {
          const code = e && e.code;
          if (['invalid_request', 'too_large', 'unsupported_type'].includes(code)) {
            found[id] = Object.assign({ skip: code }, meta);
            queue.shift();
          } else if ((code === 'rate_limited' || code === 'store_unavailable' || code === 'upstream_error') && tries < 3) {
            tries++;
            await sleep(code === 'rate_limited' ? 20000 : 3000);
          } else if (code === 'quota_or_state') {
            setStatus(status.mode, 'Your file storage is full, so new files stay on this device only.');
            break;
          } else {
            assets = null;
            break;
          }
        }
        status.files.waiting = queue.length;
        if (Object.keys(found).length >= 5) commitFound();
      }
    } finally {
      commitFound();
      uploading = false;
      status.files.waiting = queue.length;
      listeners.forEach((fn) => fn(status));
    }
  }
  /* Uploads any file this device has that isn't synced yet. */
  async function backfill() {
    if (!assets) return;
    const known = store.state.remoteFiles || {};
    for (const r of await GU.files.all()) if (!r.demo && !known[r.id]) queueUpload(r.id);
  }

  const fetching = {};
  /* A file added on another device: download it once and keep it here. */
  function fetchFile(id) {
    const m = (store.state.remoteFiles || {})[id];
    if (!m || !m.asset) return Promise.resolve(null);
    if (fetching[id]) return fetching[id];
    fetching[id] = (async () => {
      try {
        const res = await fetch('/_blob/' + m.asset);
        if (!res.ok) return null;
        const raw = await res.blob();
        const blob = m.type && raw.type !== m.type ? new Blob([raw], { type: m.type }) : raw;
        const rec = { id, name: m.name, type: m.type || blob.type, size: blob.size, added: m.added, blob };
        await GU.files.put(rec);
        return rec;
      } catch (e) {
        return null;
      } finally {
        delete fetching[id];
      }
    })();
    return fetching[id];
  }
  /* A file you deleted: remove its synced copy too. */
  function forget(id) {
    const m = (store.state.remoteFiles || {})[id];
    if (!m) return;
    if (m.asset && assets) assets.delete(m.asset).catch(() => {});
    // Deletions can happen inside another change (an import's undo), so update the list just after it.
    setTimeout(() => store.commit((st) => {
      const next = Object.assign({}, st.remoteFiles);
      delete next[id];
      st.remoteFiles = next;
    }), 0);
  }

  /* ---------- starting up ---------- */
  function possible() {
    return !!(window.claude && typeof window.claude.use === 'function');
  }

  /* Connects and loads what's on the server. Resolves {remote: true} when your data was there. */
  async function start(opts) {
    opts = opts || {};
    deviceFresh = !!opts.fresh;
    if (!possible()) return { remote: false };
    setStatus('connecting', 'Connecting…');
    let user = null;
    try {
      [db, user] = await Promise.all([window.claude.use('db'), window.claude.use('user')]);
      uid = db && user ? await user.id() : null;
    } catch (e) {
      db = null;
    }
    if (!db || !uid) {
      setStatus('off', 'Sync isn’t available here (sign in to claude.ai to sync), so changes are saved in this browser only.');
      return { remote: false };
    }
    if (memo.uid && memo.uid !== uid) memo.synced = {};
    memo.uid = uid;
    col = db.collection('data/users/' + uid);
    window.claude.use('assets').then((a) => {
      assets = a;
      if (ready) backfill();
    }).catch(() => {});

    return new Promise((resolve) => {
      let answered = false;
      const answer = (v) => {
        if (answered) return;
        answered = true;
        resolve(v);
      };
      const begin = (snap) => {
        const had = onRemote(snap, true);
        ready = true;
        deviceFresh = false;
        status.savedAt = Date.now();
        setStatus('on', 'Synced across your devices.');
        answer({ remote: had });
        schedule(200);
        backfill();
        if (!memo.welcomed) {
          memo.welcomed = true;
          saveMemo();
          GU.ui.toast(had ? 'Your dashboard is synced. Changes on your other devices show up here.' : 'Your dashboard now syncs. Open the same link on your phone or another computer and it’s all there.');
        }
      };
      unsub = col.onSnapshot((snap) => {
        if (snap.metadata && snap.metadata.fromCache) return; // wait for the server's answer before deciding anything
        if (!ready) begin(snap);
        else onRemote(snap, false);
      }, (e) => {
        failed(e);
        answer({ remote: false });
      });
      setTimeout(() => answer({ remote: false, waiting: true }), 15000);
    });
  }

  store.subscribe(() => {
    if (!applying) schedule();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && timer) {
      clearTimeout(timer);
      flush();
    }
  });

  GU.sync = {
    possible, start, queueUpload, fetchFile, forget,
    status: () => status,
    active: () => ready && !!col,
    onStatus(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    flush,
  };
})();
