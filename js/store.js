/* The Ground Up: data store. Records live in localStorage, uploaded files in IndexedDB.
   Nothing leaves this browser unless you export a backup yourself. */
(function () {
  'use strict';
  const GU = window.GU;
  const { today, uid } = GU.util;

  const KEY = 'groundup.v1';
  const listeners = new Set();
  let storageOK = true;

  function blank() {
    return {
      version: 1,
      meta: { created: today() },
      settings: {
        name: '',
        currency: 'GBP',
        docWarnDays: 90,
        visaWarnDays: 120, // no longer shown or used; kept so older backups and synced settings stay as they were
        theme: 'system',
        budgets: {},
        business: '',
        apiKey: '',
        model: '',
        autoFile: true,
        ocr: true,
        // employer is left out on purpose: {name, short, match, wageSource, payInto, repayDays, nudgeDays, chaseDays, since}
        // once set. A blank key here would count as a local edit and wipe the synced one on your other devices.
        // ucDay (1 to 31, the day your Universal Credit assessment period starts, set on Home › Tax year) is left out the same way.
      },
      accounts: [{ id: 'acc-main', name: 'Current account' }],
      transactions: [],
      rules: [],
      bills: [],
      incomeSources: [],
      paperwork: [],
      documents: [],
      visas: [], // the Visas page was removed, but the data key stays so saved records, backups and sync keep working
      todoLists: [
        { id: 'list-personal', name: 'Personal' },
        { id: 'list-admin', name: 'Life admin' },
        { id: 'list-work', name: 'Work' },
      ],
      tasks: [],
      debts: [],
      projects: [],
      workFolders: [],
      workNotes: [],
      costIdeas: [],
      // Things the business has asked you to get (Work › To buy): {id, title, note, link, estimate, qty, askedDate, needBy, payer, status, orderedDate, boughtDate, paperId, created}.
      requests: [],
      sections: [],
      sectionItems: [],
      inbox: [],
      // The Sorting hub's 'Always put <match> in <place>' rules: {id, match, destination, context, payer, …, created}.
      sortRules: [],
      filedLog: [],
      // What you told the charge alerts (js/alerts.js): {id (the alert's own id), status: 'dismissed' | 'following' | 'reopened', at, taskId, demo}.
      // Kept out of Undo; syncs record by record like the lists above.
      alertStates: [],
      remoteFiles: {},
      trash: [],
    };
  }

  function migrate(s) {
    const b = blank();
    for (const k of Object.keys(b)) if (s[k] === undefined) s[k] = b[k];
    if (!s.meta || typeof s.meta !== 'object' || Array.isArray(s.meta)) s.meta = b.meta;
    s.settings = Object.assign({}, b.settings, s.settings);
    s.settings.budgets = s.settings.budgets || {};
    if (!Array.isArray(s.sortRules)) s.sortRules = [];
    if (!Array.isArray(s.alertStates)) s.alertStates = [];
    return s;
  }

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      return raw ? migrate(JSON.parse(raw)) : null;
    } catch (e) {
      storageOK = false;
      return null;
    }
  }

  /* ---------- serialising: one piece per top-level key ---------- */
  /* The state is written as one JSON string per key, joined, which is exactly what JSON.stringify(state) gives. History
     (js/history.js) compares each key's string with the last one, and only for keys that changed goes record by record,
     so a change costs about the same as saving always did. A key holding a list of records with ids is also kept as one
     string per record; a plain object (settings, meta) as one string per field. */
  const isRec = (x) => !!x && typeof x === 'object' && !Array.isArray(x) && x.id != null;
  function serialise(state) {
    const snap = { keys: [], t: {}, str: {}, rs: {}, ids: {}, fn: {} };
    for (const k of Object.keys(state)) {
      const v = state[k];
      if (v === undefined || typeof v === 'function') continue;
      if (Array.isArray(v) && v.every(isRec)) {
        const n = v.length;
        const rs = new Array(n);
        const ids = new Array(n);
        for (let i = 0; i < n; i++) {
          rs[i] = JSON.stringify(v[i]);
          ids[i] = v[i].id;
        }
        snap.t[k] = 'arr';
        snap.rs[k] = rs;
        snap.ids[k] = ids;
        snap.str[k] = '[' + rs.join(',') + ']';
      } else if (v && typeof v === 'object' && !Array.isArray(v)) {
        const names = [];
        const fs = [];
        for (const f of Object.keys(v)) {
          const s = JSON.stringify(v[f]);
          if (s === undefined) continue;
          names.push(f);
          fs.push(s);
        }
        snap.t[k] = 'obj';
        snap.fn[k] = names;
        snap.rs[k] = fs;
        let out = '{';
        for (let i = 0; i < names.length; i++) out += (i ? ',' : '') + JSON.stringify(names[i]) + ':' + fs[i];
        snap.str[k] = out + '}';
      } else {
        const s = JSON.stringify(v);
        if (s === undefined) continue;
        snap.t[k] = 'blob';
        snap.str[k] = s;
      }
      snap.keys.push(k);
    }
    return snap;
  }

  function persist(snap) {
    try {
      let out = '{';
      for (let i = 0; i < snap.keys.length; i++) out += (i ? ',' : '') + JSON.stringify(snap.keys[i]) + ':' + snap.str[snap.keys[i]];
      localStorage.setItem(KEY, out + '}');
      storageOK = true;
    } catch (e) {
      storageOK = false;
      if (GU.ui) GU.ui.toast("Couldn't save. Your browser storage may be full or blocked; export a backup from Settings.");
    }
  }
  let lastSnap = null; // what was saved last, key by key (History compares against it)

  const store = {
    state: null,
    isFirstRun: false,
    storageOK: () => storageOK,
    init() {
      const s = load();
      this.isFirstRun = !s;
      this.state = s || blank();
      GU.util.setCurrency(this.state.settings.currency);
      lastSnap = serialise(this.state);
    },
    /* All changes go through commit so they are saved and the screen redraws.
       opts: {label, history}. label names the change in Undo ('Moved ‘Vet bill’ to Pets'); it's worked out from what
       changed when left out. history: false marks a change that isn't yours (a sync from another device, the
       background tidying, a status update), so Undo never records or undoes it. Several commits from one gesture
       (within about 0.7 s) are one step. */
    commit(mutator, opts) {
      let failed = null;
      try {
        mutator(this.state);
      } catch (e) {
        failed = e; // nothing rolls back; what was changed is still saved and still undoable
      }
      this.rev = (this.rev || 0) + 1; // lets slow sums (like the cost forecast) know when to work things out again
      GU.util.setCurrency(this.state.settings.currency);
      const snap = serialise(this.state);
      persist(snap);
      const prev = lastSnap;
      lastSnap = snap;
      if (GU.history) {
        try {
          GU.history.record(prev, snap, opts || null);
        } catch (e) {
          console.error(e); // Undo must never get in the way of saving
        }
      }
      listeners.forEach((fn) => fn());
      if (failed) throw failed;
    },
    /* Swaps in a whole new state (a sync from another device, a restored backup, erasing everything). It is never
       recorded for Undo. opts.reset: true also forgets the Undo history, for a restore or an erase, where the old
       steps no longer mean anything. */
    replaceAll(next, opts) {
      this.state = migrate(next);
      this.commit(() => {}, { history: false });
      if (opts && opts.reset && GU.history) GU.history.reset();
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    blank,
    find(collection, id) {
      return (this.state[collection] || []).find((x) => x.id === id);
    },
    upsert(collection, record) {
      this.commit((s) => {
        const list = s[collection];
        const i = list.findIndex((x) => x.id === record.id);
        if (i >= 0) list[i] = record;
        else list.push(record);
      });
    },
    /* Deletes a record into Recently deleted (kept 30 days, files and all) and offers Undo. */
    remove(collection, id, label) {
      const rec = this.find(collection, id);
      if (!rec) return null;
      let entry = null;
      this.commit((s) => {
        s[collection] = s[collection].filter((x) => x.id !== id);
        entry = trash.put(s, collection, rec, label);
      }, { label: 'Deleted ‘' + clip(trash.labelOf(collection, rec, label)) + '’' });
      trash.offerUndo(entry);
      return rec;
    },
  };

  /* ---------- Recently deleted ---------- */
  const KEEP_DAYS = 30;
  const clip = (t, n) => (String(t).length > (n || 48) ? String(t).slice(0, (n || 48) - 1).trim() + '…' : String(t));
  const KIND = { bills: 'Bill', debts: 'Debt', paperwork: 'Receipt or invoice', documents: 'Document', visas: 'Visa application', incomeSources: 'Income', tasks: 'Task',
    transactions: 'Transaction', sectionItems: 'Item', sections: 'Category', accounts: 'Bank account', inbox: 'Inbox item', projects: 'Work project', workNotes: 'Work note', workFolders: 'Work folder', costIdeas: 'Cost idea', sortRules: 'Sorting rule', requests: 'Thing to get', todoLists: 'To-do list' };
  const trash = {
    KIND,
    /* Adds a deleted record (and anything deleted along with it, in `extra`) to the bin. Call inside a commit. */
    labelOf(collection, record, label) {
      return label || record.name || record.title || record.description || record.visaType || KIND[collection] || 'Item';
    },
    put(s, collection, record, label, extra) {
      const entry = { id: 'del-' + uid(), c: collection, at: new Date().toISOString(), label: trash.labelOf(collection, record, label), record, extra: extra || null };
      s.trash = [entry].concat(s.trash || []).slice(0, 200);
      return entry;
    },
    offerUndo(entry) {
      if (!entry || !GU.ui) return;
      GU.ui.toast('Deleted ' + entry.label + '. It’s in Settings → Recently deleted for 30 days.', { timeout: 10000, action: 'Undo', exact: true, onAction: () => trash.restore(entry.id) });
    },
    /* Puts a deleted record back, with anything that went with it. */
    restore(id) {
      const entry = (store.state.trash || []).find((e) => e.id === id);
      if (!entry) return false;
      store.commit((s) => {
        const put = (c, rec) => {
          s[c] = s[c] || [];
          if (!s[c].some((x) => x.id === rec.id)) s[c].push(rec);
        };
        put(entry.c, entry.record);
        const x = entry.extra || {};
        for (const c of ['sectionItems', 'transactions', 'tasks']) (x[c] || []).forEach((r) => put(c, r));
        if (x.ignoredBill) s.settings.ignoredBills = (s.settings.ignoredBills || []).filter((k) => k !== x.ignoredBill);
        s.trash = (s.trash || []).filter((e) => e.id !== id);
      }, { label: 'Restored ‘' + clip(entry.label) + '’' });
      if (GU.ui) GU.ui.toast('Restored ' + entry.label);
      return true;
    },
    /* Gone for good after 30 days: only then are their files deleted. Files taken off a record by hand (an attachment
       removed in a form) wait the same 30 days, so Undo can bring them back; then any nobody uses any more go too. */
    purge() {
      const cutoff = Date.now() - KEEP_DAYS * 864e5;
      const old = (store.state.trash || []).filter((e) => Date.parse(e.at) < cutoff);
      if (old.length) {
        store.commit((s) => (s.trash = (s.trash || []).filter((e) => Date.parse(e.at) >= cutoff)), { history: false });
        const live = files.referenced();
        for (const e of old) {
          const recs = [e.record].concat(Object.values(e.extra || {}).filter(Array.isArray).flat());
          for (const r of recs) for (const f of (r && r.files) || []) if (!live.includes('"' + f.id + '"')) files.erase(f.id);
        }
      }
      return files.sweep(cutoff);
    },
  };

  /* ---------- Files (IndexedDB) ---------- */
  const urlCache = new Map();
  const files = {
    db: null,
    ok: true,
    memory: new Map(),
    persisted: false,
    open() {
      return new Promise((resolve) => {
        try {
          const req = indexedDB.open('groundup-files', 1);
          req.onupgradeneeded = () => req.result.createObjectStore('files', { keyPath: 'id' });
          req.onsuccess = () => {
            files.db = req.result;
            resolve();
          };
          req.onerror = () => {
            files.ok = false;
            resolve();
          };
        } catch (e) {
          files.ok = false;
          resolve();
        }
      });
    },
    _store(mode) {
      return files.db.transaction('files', mode).objectStore('files');
    },
    _req(fn) {
      return new Promise((resolve, reject) => {
        const r = fn();
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
      });
    },
    async put(rec) {
      if (!files.db) {
        files.memory.set(rec.id, rec);
        return;
      }
      await files._req(() => files._store('readwrite').put(rec));
    },
    async getLocal(id) {
      if (!files.db) return files.memory.get(id) || null;
      try {
        return (await files._req(() => files._store('readonly').get(id))) || null;
      } catch (e) {
        return null;
      }
    },
    /* A file from this device, or one added on another device (downloaded once, then kept here). */
    async get(id) {
      const rec = await files.getLocal(id);
      if (rec || !GU.sync) return rec;
      return GU.sync.fetchFile(id);
    },
    /* A file nobody uses any more (an attachment taken off a record). It isn't deleted yet: it's marked, and Recently
       deleted's tidy-up (trash.purge) deletes it after 30 days if nothing uses it by then, so Undo can bring it back. */
    async remove(id) {
      try {
        const rec = await files.getLocal(id);
        if (!rec) return;
        rec.unref = new Date().toISOString();
        await files.put(rec);
      } catch (e) {
        /* it just stays where it is */
      }
    },
    /* Deletes a file for good (and its synced copy). */
    async erase(id) {
      const u = urlCache.get(id);
      if (u) URL.revokeObjectURL(u);
      urlCache.delete(id);
      if (GU.sync) GU.sync.forget(id);
      if (!files.db) return files.memory.delete(id);
      try {
        await files._req(() => files._store('readwrite').delete(id));
      } catch (e) {
        /* already gone */
      }
    },
    /* Everything the records still point at, as text to search for an id in: the records, Recently deleted and all.
       (The list of synced files is left out: it names every file, including the ones nobody uses.) */
    referenced() {
      return JSON.stringify(Object.assign({}, store.state, { remoteFiles: undefined }));
    },
    /* Deletes files marked unused for more than 30 days (cutoff, in ms) that still aren't used anywhere; a marked file
       that's in use again (an Undo put it back) is unmarked. Returns how many were deleted. */
    async sweep(cutoff) {
      let n = 0;
      try {
        const live = files.referenced();
        for (const r of await files.all()) {
          if (!r || !r.unref) continue;
          if (live.includes('"' + r.id + '"')) {
            delete r.unref;
            await files.put(r);
          } else if (Date.parse(r.unref) < cutoff) {
            await files.erase(r.id);
            n++;
          }
        }
      } catch (e) {
        /* try again next time */
      }
      return n;
    },
    async all() {
      if (!files.db) return Array.from(files.memory.values());
      return files._req(() => files._store('readonly').getAll());
    },
    async clear() {
      urlCache.forEach((u) => URL.revokeObjectURL(u));
      urlCache.clear();
      if (!files.db) return files.memory.clear();
      await files._req(() => files._store('readwrite').clear());
    },
    /* Saves an uploaded File and returns its metadata. Big photos are scaled down to save space. */
    async add(file, extra) {
      let blob = file;
      try {
        blob = await shrinkImage(file);
      } catch (e) {
        blob = file;
      }
      const rec = {
        id: 'f-' + uid(),
        name: file.name || 'upload',
        type: blob.type || file.type || 'application/octet-stream',
        size: blob.size,
        added: today(),
        blob,
      };
      if (extra) Object.assign(rec, extra);
      await files.put(rec);
      if (GU.sync && !rec.demo) GU.sync.queueUpload(rec.id);
      if (!files.persisted && navigator.storage && navigator.storage.persist) {
        files.persisted = true;
        navigator.storage.persist().catch(() => {});
      }
      return { id: rec.id, name: rec.name, type: rec.type, size: rec.size, added: rec.added };
    },
    async url(id) {
      if (urlCache.has(id)) return urlCache.get(id);
      const rec = await files.get(id);
      if (!rec || !rec.blob) return null;
      const u = URL.createObjectURL(rec.blob);
      urlCache.set(id, u);
      return u;
    },
  };

  async function shrinkImage(file) {
    const MAX = 2200;
    if (!/^image\/(jpeg|png|webp)$/.test(file.type) || !window.createImageBitmap) return file;
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, MAX / Math.max(bmp.width, bmp.height));
    if (scale === 1 && file.size < 1.5 * 1024 * 1024) return file;
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    const out = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.86));
    return out && out.size < file.size ? out : file;
  }

  /* ---------- Backup ---------- */
  function blobToDataURL(blob) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = () => reject(r.error);
      r.readAsDataURL(blob);
    });
  }
  function dataURLToBlob(url) {
    const [head, body] = url.split(',');
    const type = (head.match(/data:([^;]+)/) || [])[1] || 'application/octet-stream';
    const bin = atob(body);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type });
  }
  const backup = {
    async build() {
      const recs = await files.all();
      const packed = [];
      for (const r of recs) {
        packed.push({ id: r.id, name: r.name, type: r.type, size: r.size, added: r.added, data: await blobToDataURL(r.blob) });
      }
      return JSON.stringify({ app: 'the-ground-up', version: 1, exported: new Date().toISOString(), state: store.state, files: packed });
    },
    async restore(text) {
      const data = JSON.parse(text);
      if (!data || data.app !== 'the-ground-up' || !data.state) throw new Error('This file is not a backup from The Ground Up.');
      await files.clear();
      for (const f of data.files || []) {
        await files.put({ id: f.id, name: f.name, type: f.type, size: f.size, added: f.added, blob: dataURLToBlob(f.data) });
      }
      store.replaceAll(data.state, { reset: true });
    },
  };

  GU.store = store;
  GU.trash = trash;
  GU.files = files;
  GU.backup = backup;
})();
