/* The Ground Up: sync across your devices.
   When the dashboard is open on claude.ai, your records are kept in your own private space in the
   artifact's database (data/users/<you>/, which nobody else can read) and your files are uploaded as
   artifact assets. Every device you open it on loads the same data and sees changes live.
   Everywhere else (a file on your computer, your own web host) it stays in this browser only.

   Each part of the state (transactions, bills, settings…) is saved as JSON text, split into
   documents small enough for the database. A part is only rewritten when it changed.

   Nothing here may ever replace saved data with less than this device has seen. A device that has never held your
   data writes nothing until you add something real (first-sync rule); a server that looks empty is looked at again
   before it is believed; a part is never written over a newer version this device hasn't merged; and once a day a
   full safety copy is kept in a separate place (data/users/<you>/backups/), restorable from Settings. */
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
  let queued = false; // a save is waiting on its timer
  let waitTimer = null; // re-reading a server that looked empty
  const remoteParts = {}; // key -> highest part count seen on the server
  const server = {}; // key -> {h, at, empty}: the newest version of each part the server is known to hold (snapshots, direct reads, our own writes)
  const held = {}; // key -> true once this page has merged the server's version of the part and holds something real for it
  const intended = new Set(); // parts a restore means to overwrite with, for the one save that follows it
  const staleTries = {}; // key -> saves in a row that could not bring in a newer server version
  const warned = {};
  let blocked = ''; // why saving is held back right now ('' when it isn't)
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
  const memo = loadMemo(); // {uid, synced: {key: hash}, recs: {key: {id or field: hash}}, device, welcomed}
  memo.synced = memo.synced || {};
  memo.recs = memo.recs && typeof memo.recs === 'object' ? memo.recs : {};
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

  /* ---------- what counts as "nothing of yours" ---------- */
  /* Two questions, both judged against store.blank():
     isDefault(k, v): exactly what an unused app holds for that part ([] , the one default account, the three default lists,
       default settings, meta with only its creation date). Never written by a device that hasn't synced the part.
     isBlank(k, v, state): nothing but what the app writes by itself before you do anything: defaults, start-up markers in
       meta (created, refileV1 when it only says it had nothing to sort, hubFreshV1 when it moved nothing), the example
       records (marked demo) and their companions (the example employer, example budgets). A device whose every part is
       blank has never held your data, so it writes nothing until you add something real. (A clean start was run against an
       empty server to find these: nothing else changes by itself. The look, colours and theme are only ever set by choosing
       them, so a choice counts as something real.)
     isBlank(k, v, state, true) counts the examples as content (a device that holds them does hold something: it may clear
       them, and that is a deliberate change that must sync). */
  const OWN_MARKERS = {
    created: () => true,
    refileV1: (v) => !v || (v.skipped === true && !(v.changes && v.changes.length) && !(v.done && Object.keys(v.done).length)),
    hubFreshV1: (v) => !v || !v.n,
    demoBudgets: () => true,
  };
  function deepEq(a, b) {
    if (a === b) return true;
    if (!a || !b || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) !== Array.isArray(b)) return false;
    const ka = Object.keys(a);
    if (ka.length !== Object.keys(b).length) return false;
    return ka.every((k) => Object.prototype.hasOwnProperty.call(b, k) && deepEq(a[k], b[k]));
  }
  const without = (o, names) => {
    const out = {};
    for (const k of Object.keys(o || {})) if (!names.includes(k) && o[k] != null) out[k] = o[k];
    return out;
  };
  /* How the site looks (look, colours, theme) is not something of yours to protect: choosing one on a device that holds nothing
     else never lets it save. (It is saved, with the rest of the settings, as soon as there is something real.) */
  const PRESENTATION = ['look', 'palette', 'theme'];
  function isDefault(k, v) {
    if (v === undefined) return true;
    const b = partOf(store.blank(), k);
    if (k === 'meta') return deepEq(without(v, ['created']), without(b, ['created']));
    if (k === 'settings') return deepEq(without(v, PRESENTATION), without(b, PRESENTATION));
    return deepEq(v, b);
  }
  function isBlank(k, v, state, examplesCount) {
    if (v === undefined || isDefault(k, v)) return true;
    const b = partOf(store.blank(), k);
    const meta = (state && state.meta) || {};
    if (k === 'meta') return Object.keys(v || {}).every((f) => (f === 'demoBudgets' && examplesCount ? false : OWN_MARKERS[f] ? OWN_MARKERS[f](v[f]) : false));
    if (k === 'settings') {
      const drop = LOCAL_SETTINGS.concat(PRESENTATION, !examplesCount && v && v.employer && v.employer.demo ? ['employer'] : [], !examplesCount && meta.demoBudgets ? ['budgets'] : []);
      return deepEq(without(v, drop), without(b, drop));
    }
    if (Array.isArray(v)) {
      const demoBills = new Set(((state && state.bills) || []).filter((x) => x && x.demo).map((x) => x.id));
      const example = (x) => !examplesCount && !!x && (x.demo === true || (k === 'paperwork' && x.billId != null && demoBills.has(x.billId)) || (k === 'trash' && x.record && x.record.demo === true));
      const rest = v.filter((x) => !example(x));
      return rest.length === 0 || (Array.isArray(b) && deepEq(rest, b.filter((x) => !example(x)))); // the default account or lists, with or without the examples beside them
    }
    return false;
  }
  function deviceBlank(state) {
    return keysOf(state).every((k) => isBlank(k, partOf(state, k), state));
  }
  /* Quick test of a part's saved text without parsing big ones: nothing that is only defaults is anywhere near this long. */
  function emptyJson(k, json) {
    if (json.length > 4000) return false;
    try {
      return isDefault(k, JSON.parse(json));
    } catch (e) {
      return false;
    }
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
  /* What the server holds, per part, whether or not all of its pieces have arrived: the hash of the newest piece seen
     (the meta document names one too), and whether that version is only defaults. A snapshot replaces what was known (other
     devices' clocks are not trusted to say which is newer), except that a view from before this device's own newer write doesn't. */
  function noteServer(snap, remote) {
    const newest = {};
    let named = {};
    for (const d of snap.docs) {
      if (!d.exists) continue;
      const b = d.data();
      if (d.id === 'meta') {
        named = (b && b.keys) || {};
        continue;
      }
      if (!b || typeof b.k !== 'string') continue;
      if (!newest[b.k] || (b.at || 0) > (newest[b.k].at || 0)) newest[b.k] = b;
    }
    for (const k of new Set(Object.keys(newest).concat(Object.keys(named)))) {
      const n = newest[k];
      const h = n ? n.h : named[k] && named[k].h;
      if (!h) continue;
      const at = n ? n.at || 0 : 0;
      if (server[k] && server[k].mine && at <= server[k].at) continue; // a view from before this device's own newer write
      const r = remote[k];
      server[k] = { h, at, mine: false, doc: !!n, empty: !!(r && r.h === h && emptyJson(k, r.json)) };
    }
  }
  /* How much of the saved data a snapshot holds: documents that are data (meta or a part), and how many different parts. */
  function inspect(snap) {
    let docs = 0;
    const keys = new Set();
    for (const d of snap.docs) {
      if (!d.exists) continue;
      const b = d.data();
      if (d.id === 'meta') {
        docs++;
        Object.keys((b && b.keys) || {}).forEach((k) => keys.add(k));
      } else if (b && typeof b.k === 'string') {
        docs++;
        keys.add(b.k);
      }
    }
    return { docs, keys: keys.size };
  }
  /* A server answer this device may act on: it holds data, and at least as many parts as this device has ever seen there. */
  function believable(snap) {
    const i = inspect(snap);
    return i.docs > 0 && i.keys >= Object.keys(memo.synced).length;
  }

  /* ---------- merging record by record ---------- */
  /* The hash of each record (by id) in a list, or of each field in an object such as settings: what this device
     last had in common with the server, so a merge can tell which records were changed here. A missing field and
     an empty one (null) hash the same. null when a list has records with no id. */
  const recHash = (v) => hash(JSON.stringify(v === undefined ? null : v));
  function recsOf(v) {
    if (Array.isArray(v)) {
      if (!v.every((x) => x && typeof x === 'object' && x.id != null)) return null;
      const out = {};
      for (const x of v) out[x.id] = recHash(x);
      return out;
    }
    if (v && typeof v === 'object') {
      const out = {};
      for (const k of Object.keys(v)) out[k] = recHash(v[k]);
      return out;
    }
    return null;
  }
  const canMerge = (a, b) => (Array.isArray(a) && Array.isArray(b) && recsOf(a) !== null && recsOf(b) !== null) ||
    (!!a && !!b && typeof a === 'object' && typeof b === 'object' && !Array.isArray(a) && !Array.isArray(b));
  /* Both devices changed a part since they last synced: each record (or field) changed on this device keeps this
     device's copy; everything else takes the other device's, deletions on either side included. A record changed
     on both keeps this device's. `base` is recsOf() of what they last had in common. */
  function merge3(local, theirs, base) {
    const was = (id) => (Object.prototype.hasOwnProperty.call(base, id) ? base[id] : null);
    if (Array.isArray(local)) {
      const mine = new Map(local.map((x) => [x.id, x]));
      const other = new Map(theirs.map((x) => [x.id, x]));
      const out = [];
      for (const x of local) {
        const here = recHash(x) !== was(x.id); // changed (or added) on this device
        if (other.has(x.id)) out.push(here ? x : other.get(x.id));
        else if (here) out.push(x); // deleted on the other device, but changed here: kept
      }
      for (const r of theirs) if (!mine.has(r.id) && recHash(r) !== was(r.id)) out.push(r); // deleted here and unchanged there: stays deleted
      return out;
    }
    const out = {};
    const none = recHash(null);
    for (const k of new Set(Object.keys(theirs).concat(Object.keys(local)))) {
      const here = recHash(local[k]) !== (was(k) || none);
      const v = here ? local[k] : theirs[k];
      if (v !== undefined) out[k] = v;
    }
    return out;
  }
  /* No record-by-record memory for a part (its first merge since this version): this device's copy of each record
     wins, as before, but an empty field here never wipes one the other device has filled in. */
  function legacyMerge(local, theirs) {
    const out = union(local, theirs, false);
    if (out && typeof out === 'object' && !Array.isArray(out) && theirs && typeof theirs === 'object' && !Array.isArray(theirs)) {
      for (const k of Object.keys(out)) if (out[k] == null && theirs[k] != null) out[k] = theirs[k];
    }
    return out;
  }
  /* What a device had in common with the server when it last synced, for parts it hasn't changed since. */
  function seedBases(state) {
    for (const k of Object.keys(memo.synced)) {
      if (memo.recs[k] || !state || state[k] === undefined) continue;
      const v = partOf(state, k);
      if (hash(JSON.stringify(v)) === memo.synced[k]) memo.recs[k] = recsOf(v);
    }
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

  /* A device that loaded the examples before the saved data arrived: the examples' loose ends in settings and meta stay behind. */
  function withoutExamples(k, v) {
    if (!v || typeof v !== 'object' || Array.isArray(v)) return v;
    const out = Object.assign({}, v);
    if (k === 'settings' && out.employer && out.employer.demo) delete out.employer;
    if (k === 'meta') {
      delete out.demoBudgets;
      if (out.refileV1 && out.refileV1.demo) delete out.refileV1;
    }
    return out;
  }
  /* At start-up: parts this device's memory says it saved, but that this browser holds nothing real for (its storage was
     cleared and the sync memory was not). The device doesn't hold them, whatever the memory says, so it forgets them: they
     are taken from the server again, and nothing blank is ever saved over them. */
  function forgetUnheld(state) {
    let n = 0;
    for (const k of Object.keys(memo.synced)) {
      const v = state[k] === undefined ? undefined : partOf(state, k);
      if (v !== undefined && !isBlank(k, v, state, true)) {
        held[k] = true; // it really has this part (the examples count): it may delete it on purpose
        continue;
      }
      delete memo.synced[k];
      delete memo.recs[k];
      n++;
    }
    if (n) saveMemo();
  }
  /* Parts this device has now merged with the server's version: that version is what it knows the server to hold, and if it
     holds something real for the part it may later delete it on purpose. */
  function noteHeld(remote) {
    for (const [k, r] of Object.entries(remote)) {
      if (memo.synced[k] !== r.h) continue;
      if (!r.mine) server[k] = { h: r.h, at: (server[k] && server[k].h === r.h && server[k].at) || 0, mine: false, doc: true, empty: emptyJson(k, r.json) };
      if (store.state[k] !== undefined && !isBlank(k, partOf(store.state, k), store.state, true)) held[k] = true;
    }
  }

  function onRemote(snap, initial) {
    const remote = assemble(snap);
    noteServer(snap, remote);
    const state = store.state;
    const next = {};
    const theirsOf = {};
    const legacy = [];
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
        memo.recs[k] = recsOf(theirs);
        continue;
      }
      const local = state[k] === undefined ? undefined : partOf(state, k);
      const untouched = memo.synced[k] != null && localHash === memo.synced[k];
      const base = memo.recs[k];
      // nothing new here: take theirs. (A first-run device takes it whole only for a part it holds nothing real for: it may have waited a
      // few seconds for a server that looked empty, and what was typed meanwhile is kept, merged in below.)
      if (untouched || (deviceFresh && isBlank(k, local, state)) || state[k] === undefined) next[k] = theirs;
      else if (memo.synced[k] == null) next[k] = union(theirs, withoutExamples(k, local), true); // first sync of a device that already had data: theirs, plus anything only this device has
      else if (base && canMerge(local, theirs)) next[k] = merge3(local, theirs, base); // both changed: yours where you changed it, theirs elsewhere
      else {
        next[k] = legacyMerge(local, theirs); // both changed, and no record of what was in common: keep yours, add what's new
        legacy.push(k);
      }
      // Merging gave the same parts as theirs in another order: take theirs as it is, so there is nothing to save back.
      if (next[k] && typeof next[k] === 'object' && !Array.isArray(next[k]) && deepEq(next[k], theirs)) next[k] = theirs;
      theirsOf[k] = theirs;
      memo.synced[k] = r.h;
      memo.recs[k] = recsOf(theirs);
      changed = true;
    }
    // A first merge like that keeps this device's old copies, so put back what the Home/Work re-sort changed on the other device.
    if (legacy.length && GU.refile && GU.refile.heal) {
      try {
        const logged = (m) => !!(m && m.refileV1 && Array.isArray(m.refileV1.changes) && m.refileV1.changes.length);
        GU.refile.heal(next, theirsOf, legacy, [theirsOf.meta, next.meta, state.meta].find(logged) || null);
      } catch (e) {
        console.warn('[sync] heal', e);
      }
    }
    saveMemo();
    if (!changed) {
      noteHeld(remote);
      return Object.keys(remote).length > 0;
    }
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
      store.replaceAll(merged); // never recorded for Undo: it's another device's change
    } finally {
      applying = false;
    }
    noteHeld(remote);
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
    queued = true;
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

  /* Saving held back: say so calmly, once in the console, and change nothing on the server. */
  const CALM = 'Waiting to see your saved data before saving anything.';
  const WHY = {
    'server-looks-empty': 'the server looks empty, so it is being read again before it is believed',
    'blank-device': 'this device has never held any of your data, so it has nothing to save until you add something',
    protect: 'saving would replace saved data with nothing this device has seen',
    newer: 'the server has a newer version this device has not merged yet',
  };
  function hold(why) {
    blocked = why;
    if (!warned.once) { // once per visit, so the console isn't filled however long it waits
      warned.once = true;
      console.warn('[sync] Not saving yet: ' + (WHY[why] || why) + '. Nothing on the server has been changed.');
    }
    setStatus(ready ? 'waiting' : 'connecting', CALM);
  }

  /* One part of the state as it is right now. */
  function currentOf(k) {
    const value = partOf(store.state, k);
    const json = JSON.stringify(value);
    return json === undefined ? null : { k, json, h: hash(json), value, rev: store.rev };
  }
  /* Why a changed part must not be written now ('' when it may be):
       'default'       never synced, and just the defaults: nothing to save, nothing to say;
       'blank-device'  this device has never held anything of yours, so it saves nothing until you add something real;
       'protect'       it would replace saved data with nothing, and this device never held that data. */
  function refuse(k, c, deviceIsBlank) {
    if (intended.has(k)) return '';
    const never = memo.synced[k] == null;
    if (never && isDefault(k, c.value)) return 'default';
    if (never && deviceIsBlank()) return 'blank-device';
    const sv = server[k];
    if (!never && !held[k] && sv && !sv.empty && isBlank(k, c.value, store.state)) return 'protect';
    return '';
  }
  /* The parts that changed here and may be written, and the reason the others may not. */
  function plan() {
    const state = store.state;
    let blankDevice = null;
    const deviceIsBlank = () => (blankDevice === null ? (blankDevice = deviceBlank(state)) : blankDevice);
    const out = [];
    let why = '';
    for (const k of keysOf(state)) {
      const c = currentOf(k);
      if (!c || memo.synced[k] === c.h) continue;
      const r = refuse(k, c, deviceIsBlank);
      if (r === 'default') continue;
      if (r) why = why || r;
      else out.push(c);
    }
    return { out, why };
  }
  /* Looks at the server itself, not at the last snapshot, before a part is overwritten: which of these parts has a version
     there, from another session, that this device hasn't merged? */
  async function newerOnServer(keys) {
    const stale = [];
    const look = async (k) => {
      const d = await col.doc('k.' + k + '.0').get();
      if (!d.exists) {
        // Nothing there to merge. If a snapshot only ever heard of a newer version through the meta document, that is not believed
        // over this direct look (or the part could never be saved again); if its documents were seen and are now gone, it is
        // handled like a version nobody can read in full.
        const sv = server[k];
        if (sv && !sv.mine && sv.h !== memo.synced[k]) {
          if (sv.doc) stale.push(k);
          else delete server[k];
        }
        return;
      }
      const b = d.data();
      if (!b || b.session === SESSION || b.h === memo.synced[k]) return;
      server[k] = { h: b.h, at: b.at || 0, mine: false, doc: true, empty: false };
      stale.push(k);
    };
    const todo = keys.filter((k) => !intended.has(k));
    for (let i = 0; i < todo.length; i += 4) await Promise.all(todo.slice(i, i + 4).map(look));
    return stale;
  }
  /* Everything that's there now: get() on the collection, or (for a database that offers nothing like it) the first live answer of a
     fresh listener. */
  function readAll() {
    if (typeof col.get === 'function') return col.get();
    return new Promise((resolve, reject) => {
      let off = null;
      let done = false;
      let timer = null;
      const end = (fn, v) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        try {
          if (off) off();
        } catch (e) {
          /* already gone */
        }
        fn(v);
      };
      timer = setTimeout(() => end(reject, Object.assign(new Error('the listing did not answer'), { code: 'unavailable' })), 8000);
      try {
        off = col.onSnapshot((snap) => {
          if (!(snap.metadata && snap.metadata.fromCache)) end(resolve, snap);
        }, (e) => end(reject, e));
        if (done) off();
      } catch (e) {
        end(reject, e);
      }
    });
  }
  /* Reads everything that's there now and merges it in, as a snapshot would. */
  async function refresh() {
    const snap = await readAll();
    if (col && ready) onRemote(snap, false);
  }
  /* Reads one part straight from its own documents, not through the listing (which may be behind, or wrong), and merges it in.
     False when the part isn't there in full: another device is part-way through writing it, or it was never finished. */
  async function pullKey(k) {
    const first = await col.doc('k.' + k + '.0').get();
    const b0 = first.exists && first.data();
    if (!b0 || typeof b0.k !== 'string' || !(b0.n >= 1)) return false;
    const docs = [first];
    for (let i = 1; i < b0.n; i++) {
      const d = await col.doc('k.' + k + '.' + i).get();
      const b = d.exists && d.data();
      if (!b || b.h !== b0.h) return false;
      docs.push(d);
    }
    if (!col || !ready) return false;
    onRemote({ docs }, false);
    return memo.synced[k] === b0.h;
  }

  async function flush() {
    queued = false;
    if (!col || !ready || applying) return;
    if (writing) {
      again = true;
      return;
    }
    writing = true;
    let wrote = false;
    let retry = 0;
    try {
      let { out, why } = plan();
      const overrides = new Set();
      if (out.length) {
        setStatus('saving', 'Saving…');
        // Never write over a version this device hasn't merged: bring it in first, then write only what still differs.
        let stale = [];
        const unreadable = new Set();
        for (let pass = 0; out.length; pass++) {
          stale = await newerOnServer(out.map((c) => c.k));
          if (!stale.length || pass === 2) break;
          await refresh();
          // whatever the listing still doesn't bring is read straight from its own documents
          for (const k of await newerOnServer(stale)) if (!(await pullKey(k))) unreadable.add(k);
          const p = plan();
          out = p.out;
          why = p.why || why;
        }
        for (const k of Object.keys(staleTries)) if (!stale.includes(k)) delete staleTries[k];
        out = out.filter((c) => {
          if (!stale.includes(c.k)) return true;
          staleTries[c.k] = (staleTries[c.k] || 0) + 1;
          retry = Math.max(retry, staleTries[c.k]);
          // A version nobody can read in full (a write that was never finished) would block this part for ever: after a few tries
          // it is replaced, but only by something real. A version that can be read is merged, never replaced.
          if (staleTries[c.k] >= 4 && unreadable.has(c.k) && !isBlank(c.k, c.value, store.state)) {
            overrides.add(c.k);
            return true;
          }
          why = why || 'newer';
          return false;
        });
      }
      const metaKeys = {};
      for (const c0 of out) {
        const k = c0.k;
        const c = c0.rev === store.rev ? c0 : currentOf(k); // the state may have moved on while earlier parts were being written
        if (!c || memo.synced[k] === c.h) continue;
        if (!intended.has(k) && !overrides.has(k)) {
          const sv = server[k];
          if (sv && sv.h !== memo.synced[k]) { // a newer version arrived meanwhile: it is merged first, next time
            why = why || 'newer';
            retry = Math.max(retry, 1);
            continue;
          }
          const r = refuse(k, c, () => deviceBlank(store.state));
          if (r) {
            if (r !== 'default') why = why || r;
            continue;
          }
        }
        const recs = recsOf(c.value);
        const parts = split(c.json);
        const at = Date.now();
        for (let i = 0; i < parts.length; i++) await write(col.doc('k.' + k + '.' + i), { k, p: i, n: parts.length, h: c.h, s: parts[i], at, device: memo.device, session: SESSION });
        for (let i = parts.length; i < (remoteParts[k] || 0); i++) await col.doc('k.' + k + '.' + i).delete();
        remoteParts[k] = parts.length;
        memo.synced[k] = c.h;
        memo.recs[k] = recs;
        server[k] = { h: c.h, at, mine: true, empty: emptyJson(k, c.json) };
        if (!isBlank(k, c.value, store.state, true)) held[k] = true;
        metaKeys[k] = { h: c.h, n: parts.length };
        wrote = true;
      }
      if (wrote) {
        const metaRef = col.doc('meta');
        const cur = await metaRef.get();
        await write(metaRef, { keys: Object.assign({}, cur.exists ? cur.data().keys : {}, metaKeys), at: Date.now(), device: memo.device });
        saveMemo();
        status.savedAt = Date.now();
      }
      if (why) hold(why);
      else {
        blocked = '';
        if (wrote || status.mode === 'saving' || status.mode === 'waiting' || status.mode === 'connecting') setStatus('on', 'Synced across your devices.');
        if (backups) backups.arm();
      }
      if (retry) {
        clearTimeout(timer);
        queued = true;
        timer = setTimeout(flush, Math.min(60000, 5000 * Math.pow(2, retry - 1)));
      }
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
      queued = true;
      timer = setTimeout(flush, 30000);
    }
  }

  function stop() {
    if (unsub) unsub();
    unsub = null;
    clearTimeout(waitTimer);
    waitTimer = null;
    if (backups) backups.stop();
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
    }, { history: false });
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
    }, { history: false }), 0);
  }

  /* ---------- safety copies ---------- */
  /* Once a day, when this device holds real data and is fully in step with the server, a whole copy of the state is kept at
     data/users/<you>/backups/<yyyy-mm-dd>/ (documents named and chunked like the live ones) with a small note about it in
     data/users/<you>/backups/index/<yyyy-mm-dd>. They live in their own sub-collections, so the live listing never loads them.
     The 7 newest are kept. A copy far smaller than the last one is not written (and nothing is removed): it is only noted. */
  const COPY_KEEP = 7;
  const COPY_IDLE_MS = 5000;
  const COPY_MIN_SHARE = 0.6;
  const COPY_MSG = {
    offline: 'Safety copies need the online app, opened from claude.ai while signed in.',
    connecting: 'Still connecting to your saved data. Try again in a few seconds.',
    working: 'A safety copy is being made or restored. Try again in a moment.',
    gone: 'That safety copy isn’t there any more.',
    bad: 'This safety copy didn’t check out (it’s incomplete or damaged), so I haven’t changed anything.',
    noBefore: 'I couldn’t save your current data first, so I haven’t changed anything.',
    unsaved: 'Restored here, but your other devices haven’t received it yet. It will keep trying.',
  };
  const backups = (function () {
    let cache = null; // the last list read from the index, newest first
    let timer = null; // waiting for a quiet moment
    let busy = false;
    let tries = 0;
    let waitVisible = false;
    const listeners = new Set();
    const pad2 = (n) => String(n).padStart(2, '0');
    const available = () => !!(db && uid && col);
    const root = () => db.doc('data/users/' + uid + '/backups');
    const indexCol = () => root().collection('index');
    const copyCol = (id) => root().collection(id);
    const entryOf = (id, b) => ({
      id, kind: b.kind === 'before-restore' ? 'before-restore' : 'daily', day: b.day || String(id).slice(0, 10), at: b.at || 0, device: b.device || '',
      bytes: b.bytes || 0, counts: b.counts && typeof b.counts === 'object' ? b.counts : {}, keys: b.keys && typeof b.keys === 'object' ? b.keys : {},
      flagged: !!b.flagged, reason: b.reason || '', latest: b.latest || '', latestBytes: b.latestBytes || 0, restoredFrom: b.restoredFrom || '',
    });
    function remember(list) {
      cache = list.slice().sort((a, b) => b.at - a.at);
      listeners.forEach((fn) => fn(cache));
      return cache;
    }
    async function readIndex() {
      const snap = await indexCol().get();
      const out = [];
      for (const d of snap.docs) if (d.exists) out.push(entryOf(d.id, d.data() || {}));
      return remember(out);
    }
    /* Waits while a normal save is running or about to, so copies never get in its way; one document at a time. */
    async function gentle() {
      for (let i = 0; i < 40 && (writing || queued); i++) await sleep(150);
      await sleep(25);
    }
    function pack() {
      const st = store.state;
      const keys = {};
      const counts = {};
      let bytes = 0;
      for (const k of keysOf(st)) {
        const v = partOf(st, k);
        const json = JSON.stringify(v);
        if (json === undefined) continue;
        const parts = split(json);
        keys[k] = { h: hash(json), n: parts.length, parts };
        bytes += enc.encode(json).length;
        const n = Array.isArray(v) ? v.length : k === 'remoteFiles' && v ? Object.keys(v).length : 0;
        if (n) counts[k] = n;
      }
      return { keys, counts, bytes };
    }
    async function writeCopy(id, kind, extra, p) {
      p = p || pack();
      const at = Date.now();
      const dir = copyCol(id);
      const names = {};
      for (const k of Object.keys(p.keys)) {
        const { h, n, parts } = p.keys[k];
        for (let i = 0; i < n; i++) {
          await gentle();
          if (!col || !ready) throw new Error('stopped');
          await write(dir.doc('k.' + k + '.' + i), { k, p: i, n, h, s: parts[i], at, device: memo.device, session: SESSION });
        }
        names[k] = { h, n };
      }
      const body = Object.assign({ id, kind, day: GU.util.today(), at, device: memo.device, bytes: p.bytes, counts: p.counts, keys: names }, extra || {});
      await gentle();
      await write(indexCol().doc(id), body); // last: a copy only shows in the list once every piece of it is there
      return entryOf(id, body);
    }
    async function removeCopy(id) {
      await indexCol().doc(id).delete(); // first, so it stops showing as a copy
      const snap = await copyCol(id).get();
      for (const d of snap.docs) {
        await gentle();
        await copyCol(id).doc(d.id).delete();
      }
    }
    /* The 7 newest copies stay; a 'before restore' copy also stays until 3 newer ones exist. */
    async function rotate(entries) {
      const real = entries.filter((e) => !e.flagged).sort((a, b) => b.at - a.at);
      const keep = new Set(real.slice(0, COPY_KEEP).map((e) => e.id));
      real.forEach((e, i) => {
        if (e.kind === 'before-restore' && i < 3) keep.add(e.id);
      });
      for (const e of real) if (!keep.has(e.id)) await removeCopy(e.id);
      const oldest = Math.min.apply(null, real.filter((e) => keep.has(e.id)).map((e) => e.at));
      const gone = new Set(real.filter((e) => !keep.has(e.id)).map((e) => e.id));
      for (const e of entries) {
        if (e.flagged && e.at < oldest) {
          await gentle();
          await indexCol().doc(e.id).delete();
          gone.add(e.id);
        }
      }
      return entries.filter((e) => !gone.has(e.id));
    }
    /* Why no copy may be made right now ('' when one may): only from a device that holds real data and is in step with the server. */
    function notNow() {
      if (!available() || !ready) return 'offline';
      if (applying) return 'applying';
      if (status.mode === 'error') return 'error';
      if (blocked) return 'held';
      if (deviceBlank(store.state)) return 'blank';
      if (writing || queued) return 'busy';
      if (plan().out.length) return 'unsaved';
      // a newer version of a part is on the server and has not been merged (it is being written, or cannot be read in full)
      if (Object.keys(server).some((k) => server[k] && !server[k].mine && server[k].doc && server[k].h !== memo.synced[k])) return 'behind';
      return '';
    }
    /* Makes today's copy if it doesn't exist yet. opts.anyway: even when the data is much smaller than the last copy. */
    async function makeNow(opts) {
      opts = opts || {};
      if (busy) return { skipped: 'busy' };
      let why = notNow();
      if (why) return { skipped: why };
      busy = true;
      let started = false;
      const day = GU.util.today();
      try {
        const entries = await readIndex();
        why = notNow(); // the page may have moved on while the list was being read
        if (why) return { skipped: why };
        const have = entries.find((e) => e.id === day);
        if (have && !opts.anyway) {
          memo.backupDay = day; // today is dealt with (a copy, or a note that the data looked much smaller): not looked at again on every save
          saveMemo();
          return { skipped: have.flagged ? 'flagged-today' : 'exists' };
        }
        started = !have;
        const p = pack();
        const last = entries.filter((e) => !e.flagged && e.kind === 'daily')[0];
        if (last && last.bytes > 0 && p.bytes < last.bytes * COPY_MIN_SHARE && !opts.anyway) {
          console.warn('[sync] Today’s safety copy was not made: the data is much smaller than the last copy. Older copies are untouched.');
          const note = { id: day, kind: 'daily', day, at: Date.now(), device: memo.device, flagged: true, reason: 'shrink', bytes: p.bytes, latest: last.id, latestBytes: last.bytes };
          await write(indexCol().doc(day), note);
          memo.backupDay = day;
          saveMemo();
          remember(entries.filter((x) => x.id !== day).concat([entryOf(day, note)]));
          return { skipped: 'shrink', flagged: true };
        }
        const e = await writeCopy(day, 'daily', {}, p);
        started = false; // finished: whatever goes wrong next, this copy is kept
        memo.backupDay = day;
        saveMemo();
        remember(await rotate(entries.filter((x) => x.id !== e.id).concat([e])));
        return { written: e.id, bytes: e.bytes };
      } catch (e) {
        const code = e && (e.code || e.message);
        console.warn('[sync] safety copy', code);
        if (started) removeCopy(day).catch(() => {}); // a copy that wasn't finished doesn't stay behind, taking up room
        // A copy that keeps failing (the database is full, or refuses it) is not tried again after every save: a few times, then tomorrow.
        const f = memo.backupFail && memo.backupFail.day === day ? memo.backupFail : { day, n: 0 };
        f.n++;
        memo.backupFail = f;
        if (f.n >= 3 || code === 'quota_exceeded') memo.backupDay = day;
        saveMemo();
        return { skipped: 'error', error: code };
      } finally {
        busy = false;
      }
    }
    /* After a successful save: a copy is looked at once things have been quiet for a few seconds, and only while the page is showing. */
    function arm() {
      if (!ready || !available() || memo.backupDay === GU.util.today()) return;
      clearTimeout(timer);
      timer = setTimeout(tick, COPY_IDLE_MS);
    }
    async function tick() {
      timer = null;
      if (document.visibilityState !== 'visible') {
        waitVisible = true;
        return;
      }
      if (memo.backupDay === GU.util.today()) return;
      const r = await makeNow();
      if (['busy', 'unsaved', 'applying', 'behind'].includes(r.skipped) && tries++ < 5) timer = setTimeout(tick, 15000);
      else tries = 0;
    }
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && waitVisible) {
        waitVisible = false;
        arm();
      }
    });

    /* Reads a copy and checks every part of it against what was recorded when it was made. Nothing is changed. */
    async function load(id) {
      const index = (await readIndex()).find((e) => e.id === id && !e.flagged);
      if (!index) throw new Error(COPY_MSG.gone);
      const snap = await copyCol(id).get();
      const groups = {};
      for (const d of snap.docs) {
        const b = d.exists && d.data();
        if (!b || typeof b.k !== 'string') continue;
        const g = (groups[b.k] = groups[b.k] || {});
        (g[b.h] = g[b.h] || { n: b.n, parts: [] }).parts[b.p] = b.s;
      }
      const names = Object.keys(index.keys);
      if (!names.length) throw new Error(COPY_MSG.bad);
      const loaded = {};
      for (const k of names) {
        const want = index.keys[k];
        const g = groups[k] && groups[k][want.h];
        if (!g || g.n !== want.n || g.parts.filter((x) => typeof x === 'string').length !== want.n) throw new Error(COPY_MSG.bad);
        const json = g.parts.join('');
        if (hash(json) !== want.h) throw new Error(COPY_MSG.bad);
        try {
          loaded[k] = JSON.parse(json);
        } catch (e) {
          throw new Error(COPY_MSG.bad);
        }
      }
      return { index, loaded };
    }
    /* Replaces everything, here and (through normal syncing) on every device, with a copy. Your current data is copied first. */
    async function restore(id) {
      if (!available()) throw new Error(COPY_MSG.offline);
      if (!ready) throw new Error(COPY_MSG.connecting);
      if (busy) throw new Error(COPY_MSG.working);
      busy = true;
      try {
        const { loaded } = await load(id); // checked before anything is touched
        // What the server holds now comes in first, so the Before-restore copy has it (a device that shows an empty site may not have
        // seen it yet) and this restore is the only difference left to save.
        await refresh();
        let before = '';
        if (!deviceBlank(store.state)) {
          const t = new Date();
          const base = GU.util.today() + '-before-restore-' + pad2(t.getHours()) + pad2(t.getMinutes());
          const taken = new Set((cache || []).map((e) => e.id));
          before = base;
          for (let n = 2; taken.has(before); n++) before = base + '-' + n; // a second restore in the same minute doesn't overwrite the first one's copy
          try {
            remember((cache || []).concat([await writeCopy(before, 'before-restore', { restoredFrom: id })]));
          } catch (e) {
            removeCopy(before).catch(() => {});
            throw new Error(COPY_MSG.noBefore);
          }
        }
        const next = Object.assign(store.blank(), { version: store.state.version });
        for (const k of Object.keys(next)) if (k in loaded) next[k] = loaded[k];
        next.settings = Object.assign({}, next.settings, pick(store.state.settings, LOCAL_SETTINGS));
        const reading = (store.state.inbox || []).filter((i) => i.status === 'reading');
        if (reading.length) next.inbox = (next.inbox || []).concat(reading);
        intended.clear();
        keysOf(next).forEach((k) => intended.add(k));
        store.replaceAll(next, { reset: true });
        let left = 1;
        for (let i = 0; i < 6 && left; i++) {
          while (writing) await sleep(50);
          await flush();
          while (writing) await sleep(50);
          left = plan().out.length;
        }
        if (left) throw new Error(COPY_MSG.unsaved);
        return { restored: id, before };
      } finally {
        intended.clear();
        busy = false;
      }
    }
    function stop() {
      clearTimeout(timer);
      timer = null;
    }
    return {
      available, list: readIndex, makeNow, restore, arm, stop,
      cached: () => cache,
      onChange(fn) {
        listeners.add(fn);
        return () => listeners.delete(fn);
      },
    };
  })();

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
    if (memo.uid && memo.uid !== uid) {
      memo.synced = {};
      memo.recs = {};
      delete memo.backupDay;
    }
    memo.uid = uid;
    forgetUnheld(store.state);
    seedBases(store.state);
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
        if (ready) return;
        clearTimeout(waitTimer);
        waitTimer = null;
        const had = onRemote(snap, true);
        ready = true;
        blocked = '';
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
      /* The first answer is not always the whole truth (one that looked empty is what let a new device save over everything).
         If it holds no data at all, or fewer parts than this device has ever seen there, nothing is decided and nothing is saved:
         the server is read again about 2 and 6 seconds after, and only if it still has nothing is it treated as a new account.
         Data that turns up in the meantime is used at once. */
      let doubting = false;
      const doubt = () => {
        if (doubting || ready) return;
        doubting = true;
        hold('server-looks-empty');
        // The app is told now that nothing is known yet (as after the 15 s limit), so a first run doesn't sit empty while the server
        // is read again; it saves nothing meanwhile, and the examples it may show are replaced once the saved data turns up.
        answer({ remote: false, waiting: true });
        const gaps = [2000, 4000];
        let n = 0;
        const again = async () => {
          waitTimer = null;
          if (ready || !col) return;
          let snap = null;
          try {
            snap = await readAll();
          } catch (e) {
            snap = null;
          }
          if (ready || !col) return;
          n++;
          if (snap && believable(snap)) return begin(snap);
          if (n < gaps.length) waitTimer = setTimeout(again, gaps[n]);
          else if (snap) begin(snap); // still nothing there: a new account (or one with less than before, which is the truth)
          else waitTimer = setTimeout(again, 10000); // couldn't even read: keep waiting, save nothing
        };
        waitTimer = setTimeout(again, gaps[0]);
      };
      unsub = col.onSnapshot((snap) => {
        if (snap.metadata && snap.metadata.fromCache) return; // wait for the server's answer before deciding anything
        if (ready) onRemote(snap, false);
        else if (believable(snap)) begin(snap);
        else doubt();
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
    applying: () => applying, // true while another device's changes are being applied here
    onStatus(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    flush,
    backups: { list: backups.list, makeNow: backups.makeNow, restore: backups.restore, available: backups.available, cached: backups.cached, onChange: backups.onChange },
  };
})();
