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
        visaWarnDays: 120,
        theme: 'system',
        budgets: {},
        business: '',
        apiKey: '',
        model: '',
        autoFile: true,
        ocr: true,
      },
      accounts: [{ id: 'acc-main', name: 'Current account' }],
      transactions: [],
      rules: [],
      bills: [],
      incomeSources: [],
      paperwork: [],
      documents: [],
      visas: [],
      todoLists: [
        { id: 'list-personal', name: 'Personal' },
        { id: 'list-admin', name: 'Life admin' },
        { id: 'list-work', name: 'Work' },
      ],
      tasks: [],
      sections: [],
      sectionItems: [],
      inbox: [],
      filedLog: [],
    };
  }

  function migrate(s) {
    const b = blank();
    for (const k of Object.keys(b)) if (s[k] === undefined) s[k] = b[k];
    s.settings = Object.assign({}, b.settings, s.settings);
    s.settings.budgets = s.settings.budgets || {};
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

  function persist(state) {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
      storageOK = true;
    } catch (e) {
      storageOK = false;
      if (GU.ui) GU.ui.toast("Couldn't save. Your browser storage may be full or blocked; export a backup from Settings.");
    }
  }

  const store = {
    state: null,
    isFirstRun: false,
    storageOK: () => storageOK,
    init() {
      const s = load();
      this.isFirstRun = !s;
      this.state = s || blank();
      GU.util.setCurrency(this.state.settings.currency);
    },
    /* All changes go through commit so they are saved and the screen redraws. */
    commit(mutator) {
      mutator(this.state);
      GU.util.setCurrency(this.state.settings.currency);
      persist(this.state);
      listeners.forEach((fn) => fn());
    },
    replaceAll(next) {
      this.state = migrate(next);
      this.commit(() => {});
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
    remove(collection, id) {
      const rec = this.find(collection, id);
      this.commit((s) => {
        s[collection] = s[collection].filter((x) => x.id !== id);
      });
      if (rec && rec.files) rec.files.forEach((f) => files.remove(f.id));
      return rec;
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
    async get(id) {
      if (!files.db) return files.memory.get(id) || null;
      try {
        return (await files._req(() => files._store('readonly').get(id))) || null;
      } catch (e) {
        return null;
      }
    },
    async remove(id) {
      const u = urlCache.get(id);
      if (u) URL.revokeObjectURL(u);
      urlCache.delete(id);
      if (!files.db) return files.memory.delete(id);
      try {
        await files._req(() => files._store('readwrite').delete(id));
      } catch (e) {
        /* already gone */
      }
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
      store.replaceAll(data.state);
    },
  };

  GU.store = store;
  GU.files = files;
  GU.backup = backup;
})();
