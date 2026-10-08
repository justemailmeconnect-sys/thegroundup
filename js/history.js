/* The Ground Up: Undo and redo for the whole site.

   Every store.commit is compared with the one before, key by key (see serialise in store.js). Only the keys whose text
   changed are looked at closely, and for those the change is kept record by record: which records were added, removed or
   changed, as before and after text. Commits within about 0.7 s of each other (one gesture often saves twice) are one
   step, with a name made from what changed ('Deleted ‘Vet bill’', 'Moved ‘Boiler repair’ to Work').

   Undo and redo apply a step to the CURRENT state, record by record, so something changed elsewhere in the meantime
   (another device, a later edit) survives. A record that is no longer as the step left it is left alone, and the toast
   says so. Changes that aren't yours (a sync from another device, the nightly tidying, status updates) are committed with
   history: false and never recorded or undone.

   The history is per device: kept in memory and copied to sessionStorage (best effort), the last 100 steps. */
(function () {
  'use strict';
  const GU = window.GU;
  const store = GU.store;
  const clip = (t, n) => (String(t).length > (n || 40) ? String(t).slice(0, (n || 40) - 1).trim() + '…' : String(t));

  const MAX_STEPS = 100;
  const GROUP_MS = 700; // commits this close together are one gesture
  const MAX_BYTES = 40e6; // in memory
  const SAVE_BYTES = 3.2e6; // in sessionStorage
  const SESSION_KEY = 'groundup.history.v1';
  const BOOKKEEPING = ['trash', 'filedLog', 'remoteFiles', 'meta', 'version'];

  let undoStack = []; // oldest first
  let redoStack = []; // the one undone last is at the end
  let muted = 0;
  let batching = 0; // inside batch(): everything committed is one step
  let batchStep = null;
  let lastCommit = { step: null, at: 0 };
  let seq = 0;
  const captures = []; // stack of {changes} being collected by capture()
  let saveTimer = null;
  const watchers = new Set();

  /* ---------- reading what changed ---------- */
  /* Two texts of the same JSON value: equal as text, or equal once keys are put in order. */
  function canon(v) {
    if (Array.isArray(v)) return v.map(canon);
    if (v && typeof v === 'object') {
      const o = {};
      for (const k of Object.keys(v).sort()) o[k] = canon(v[k]);
      return o;
    }
    return v;
  }
  function same(a, b) {
    if (a === b) return true;
    if (a == null || b == null) return false;
    try {
      return JSON.stringify(canon(JSON.parse(a))) === JSON.stringify(canon(JSON.parse(b)));
    } catch (e) {
      return false;
    }
  }

  /* What changed in one key between two serialisations, or null. */
  function diffKey(prev, cur, k) {
    const ps = prev.str[k];
    const cs = cur.str[k];
    if (ps === cs) return null;
    const pt = prev.t[k];
    const ct = cur.t[k];
    if (pt === 'arr' && ct === 'arr') {
      const pids = prev.ids[k];
      const prs = prev.rs[k];
      const cids = cur.ids[k];
      const crs = cur.rs[k];
      const pm = new Map();
      for (let i = 0; i < pids.length; i++) pm.set(pids[i], i);
      const cm = new Map();
      for (let i = 0; i < cids.length; i++) cm.set(cids[i], i);
      if (pm.size === pids.length && cm.size === cids.length) {
        const recs = [];
        for (let i = 0; i < cids.length; i++) {
          const j = pm.get(cids[i]);
          if (j === undefined) recs.push({ id: cids[i], b: null, a: crs[i], pa: i ? cids[i - 1] : null, ia: i });
          else if (prs[j] !== crs[i]) recs.push({ id: cids[i], b: prs[j], a: crs[i] });
        }
        for (let j = 0; j < pids.length; j++) if (!cm.has(pids[j])) recs.push({ id: pids[j], b: prs[j], a: null, pb: j ? pids[j - 1] : null, ib: j });
        const ch = { t: 'arr', recs };
        // Records that are still there but in a different order (the list was sorted): the whole order is kept, before and after.
        const ob = pids.filter((id) => cm.has(id));
        const oa = cids.filter((id) => pm.has(id));
        for (let i = 0; i < ob.length; i++) {
          if (ob[i] !== oa[i]) {
            ch.ob = pids;
            ch.oa = cids;
            break;
          }
        }
        if (!recs.length && !ch.ob) return null;
        return ch;
      }
    } else if (pt === 'obj' && ct === 'obj') {
      const pn = prev.fn[k];
      const prs = prev.rs[k];
      const cn = cur.fn[k];
      const crs = cur.rs[k];
      const pm = new Map();
      for (let i = 0; i < pn.length; i++) pm.set(pn[i], prs[i]);
      const fields = [];
      const seen = new Set();
      for (let i = 0; i < cn.length; i++) {
        seen.add(cn[i]);
        const was = pm.has(cn[i]) ? pm.get(cn[i]) : null;
        if (was !== crs[i]) fields.push({ name: cn[i], b: was, a: crs[i] });
      }
      for (let i = 0; i < pn.length; i++) if (!seen.has(pn[i])) fields.push({ name: pn[i], b: prs[i], a: null });
      return fields.length ? { t: 'obj', fields } : null;
    }
    return { t: 'blob', b: ps === undefined ? null : ps, a: cs === undefined ? null : cs };
  }

  /* ---------- joining the changes of several commits into one step ---------- */
  const has = (o, k) => o[k] !== undefined;
  function compose(into, add) {
    for (const k of Object.keys(add)) {
      const x = into[k];
      const y = add[k];
      if (!x) {
        into[k] = y;
        continue;
      }
      if (x.t === 'arr' && y.t === 'arr') {
        const m = new Map(x.recs.map((r) => [r.id, r]));
        for (const r of y.recs) {
          const e = m.get(r.id);
          if (!e) {
            m.set(r.id, r);
            continue;
          }
          if ((e.b === null && r.a === null) || (e.b !== null && r.a !== null && same(e.b, r.a))) {
            m.delete(r.id);
            continue;
          }
          const out = { id: r.id, b: e.b, a: r.a };
          for (const f of ['pb', 'ib']) if (has(e, f)) out[f] = e[f];
          else if (has(r, f) && e.b !== null) out[f] = r[f];
          for (const f of ['pa', 'ia']) if (has(r, f)) out[f] = r[f];
          else if (has(e, f) && r.a !== null) out[f] = e[f];
          m.set(r.id, out);
        }
        x.recs = Array.from(m.values());
        if (y.ob || x.ob) {
          x.ob = x.ob || y.ob;
          x.oa = y.oa || x.oa;
        }
        if (!x.recs.length && !x.ob) delete into[k];
      } else if (x.t === 'obj' && y.t === 'obj') {
        const m = new Map(x.fields.map((f) => [f.name, f]));
        for (const f of y.fields) {
          const e = m.get(f.name);
          if (!e) m.set(f.name, f);
          else if (same(e.b, f.a)) m.delete(f.name);
          else m.set(f.name, { name: f.name, b: e.b, a: f.a });
        }
        x.fields = Array.from(m.values());
        if (!x.fields.length) delete into[k];
      } else if (x.t === 'blob' && y.t === 'blob') {
        if (same(x.b, y.a)) delete into[k];
        else into[k] = { t: 'blob', b: x.b, a: y.a };
      } else into[k] = { t: 'blob', b: null, a: null, mixed: true, kept: x };
    }
  }
  const sizeOf = (changes) => {
    let n = 0;
    for (const k of Object.keys(changes)) {
      const c = changes[k];
      if (c.t === 'arr') for (const r of c.recs) n += (r.b ? r.b.length : 0) + (r.a ? r.a.length : 0) + 60;
      else if (c.t === 'obj') for (const f of c.fields) n += (f.b ? f.b.length : 0) + (f.a ? f.a.length : 0) + 40;
      else n += (c.b ? c.b.length : 0) + (c.a ? c.a.length : 0);
    }
    return n;
  };

  /* ---------- naming a step ---------- */
  const NOUN = {
    paperwork: ['receipt', 'receipts'], bills: ['bill', 'bills'], debts: ['debt', 'debts'], documents: ['document', 'documents'],
    incomeSources: ['income source', 'income sources'], tasks: ['task', 'tasks'], transactions: ['transaction', 'transactions'],
    sectionItems: ['item', 'items'], sections: ['category', 'categories'], accounts: ['account', 'accounts'], inbox: ['inbox item', 'inbox items'],
    projects: ['project', 'projects'], workNotes: ['note', 'notes'], workFolders: ['folder', 'folders'], costIdeas: ['plan', 'plans'],
    requests: ['thing to get', 'things to get'], todoLists: ['list', 'lists'], rules: ['rule', 'rules'], sortRules: ['rule', 'rules'], visas: ['visa application', 'visa applications'],
  };
  const NAME_FIELDS = ['name', 'title', 'description', 'visaType', 'match'];
  const parse = (s) => {
    try {
      return s == null ? null : JSON.parse(s);
    } catch (e) {
      return null;
    }
  };
  const nameOf = (rec) => (rec ? String(rec.name || rec.title || rec.description || rec.visaType || rec.match || rec.label || '') : '');
  const noun = (c, n) => (NOUN[c] ? NOUN[c][n === 1 ? 0 : 1] : n === 1 ? 'thing' : 'things');
  const quote = (t) => '‘' + clip(t) + '’';
  const lookup = (c, id) => ((store.state && store.state[c]) || []).find((x) => x.id === id);

  function describeOne(c, r) {
    const b = parse(r.b);
    const a = parse(r.a);
    const nm = nameOf(a || b) || (NOUN[c] ? NOUN[c][0] : 'item');
    if (!b) return 'Added ' + quote(nm);
    if (!a) return 'Deleted ' + quote(nm);
    const fields = Array.from(new Set(Object.keys(a).concat(Object.keys(b)))).filter((f) => JSON.stringify(canon(a[f])) !== JSON.stringify(canon(b[f])));
    const only = (list) => fields.length > 0 && fields.every((f) => list.includes(f));
    const nameField = NAME_FIELDS.find((f) => fields.includes(f));
    if (nameField && only(NAME_FIELDS.concat(['updated', 'icon']))) return 'Renamed ' + quote(b[nameField] || nm) + ' to ' + quote(a[nameField] || '');
    if (only(['done', 'doneAt'])) return 'Marked ' + quote(nm) + (a.done ? ' done' : ' not done');
    if (fields.includes('status') && a.status === 'paid' && b.status !== 'paid') return 'Marked ' + quote(nm) + ' paid';
    if (only(['status', 'updated', 'doneDate', 'orderedDate', 'boughtDate']) && typeof a.status === 'string' && a.status) return 'Marked ' + quote(nm) + ' as ' + a.status.toLowerCase();
    if (fields.includes('context')) return 'Moved ' + quote(nm) + ' to ' + (a.context === 'work' ? 'Work' : 'Home');
    if (fields.includes('sectionId')) return 'Moved ' + quote(nm) + ' to ' + quote(nameOf(lookup('sections', a.sectionId)) || 'another category');
    if (fields.includes('listId')) return 'Moved ' + quote(nm) + ' to ' + quote(nameOf(lookup('todoLists', a.listId)) || 'another list');
    if (fields.includes('workFolder')) return 'Moved ' + quote(nm) + ' to ' + (a.workFolder ? quote(nameOf(lookup('workFolders', a.workFolder)) || 'a folder') : 'no folder');
    if (fields.includes('group')) return 'Moved ' + quote(nm) + (a.group ? ' to ' + quote(a.group) : ' out of its group');
    if (fields.includes('account') && c === 'transactions') return 'Moved ' + quote(nm) + ' to ' + quote(nameOf(lookup('accounts', a.account)) || 'another account');
    if (fields.includes('category')) return 'Changed the category of ' + quote(nm) + (a.category ? ' to ' + clip(a.category, 24) : '');
    if (fields.includes('type') && c === 'documents') return 'Moved ' + quote(nm) + ' to ' + clip(a.type, 24);
    if (fields.includes('kind') && c === 'paperwork') return 'Changed ' + quote(nm) + ' to ' + clip(a.kind, 24);
    if (fields.includes('payer')) return 'Changed who pays for ' + quote(nm);
    if (only(['files'])) return 'Changed the files on ' + quote(nm);
    if (only(['order'])) return 'Reordered ' + quote(nm);
    if (only(['hidden'])) return (a.hidden ? 'Hid ' : 'Showed ') + quote(nm) + ' in the menu';
    return 'Edited ' + quote(nm);
  }

  function describe(changes) {
    const keys = Object.keys(changes);
    const trash = changes.trash && changes.trash.recs ? changes.trash.recs : [];
    const binned = trash.filter((r) => r.b === null && r.a);
    const taken = trash.filter((r) => r.a === null && r.b);
    if (binned.length) {
      if (binned.length === 1) {
        const e = parse(binned[0].a);
        return 'Deleted ' + quote(e && e.label ? e.label : 'it');
      }
      return 'Deleted ' + binned.length + ' things';
    }
    if (taken.length) {
      if (taken.length === 1) {
        const e = parse(taken[0].b);
        return 'Restored ' + quote(e && e.label ? e.label : 'it');
      }
      return 'Restored ' + taken.length + ' things';
    }
    const main = keys.filter((k) => !BOOKKEEPING.includes(k));
    if (!main.length) return keys.includes('meta') ? 'Changed a setting' : 'Changed something';
    const counts = {};
    let total = 0;
    for (const k of main) {
      const ch = changes[k];
      if (ch.t === 'arr') {
        counts[k] = ch.recs.length || 1;
        total += counts[k];
      } else {
        counts[k] = 1;
        total += 1;
      }
    }
    if (main.length === 1) {
      const k = main[0];
      const ch = changes[k];
      if (ch.t === 'arr' && ch.recs.length === 1) return describeOne(k, ch.recs[0]);
      if (ch.t === 'arr' && ch.recs.length > 1) {
        const added = ch.recs.filter((r) => r.b === null).length;
        const removed = ch.recs.filter((r) => r.a === null).length;
        const n = ch.recs.length;
        if (added === n) return 'Added ' + n + ' ' + noun(k, n);
        if (removed === n) return 'Removed ' + n + ' ' + noun(k, n);
        // The same field changed on all of them?
        const first = parse(ch.recs[0].a);
        const fieldOf = (r) => {
          const a = parse(r.a);
          const b = parse(r.b);
          if (!a || !b) return '?';
          return Object.keys(a).concat(Object.keys(b)).filter((f, i, l) => l.indexOf(f) === i && JSON.stringify(canon(a[f])) !== JSON.stringify(canon(b[f]))).sort().join(',');
        };
        const f0 = fieldOf(ch.recs[0]);
        if (first && ch.recs.every((r) => fieldOf(r) === f0)) {
          if (f0 === 'category') return 'Changed the category of ' + n + ' ' + noun(k, n);
          if (f0 === 'context') return 'Moved ' + n + ' ' + noun(k, n) + ' to ' + (first.context === 'work' ? 'Work' : 'Home');
          if (f0 === 'done,doneAt' || f0 === 'done') return 'Marked ' + n + ' ' + noun(k, n) + (first.done ? ' done' : ' not done');
        }
        return 'Changed ' + n + ' ' + noun(k, n);
      }
      if (ch.t === 'arr') return 'Reordered ' + noun(k, 2);
      if (k === 'settings') {
        const f = ch.fields || [];
        return f.length === 1 ? 'Changed the ' + f[0].name.replace(/([A-Z])/g, ' $1').toLowerCase() + ' setting' : 'Changed settings';
      }
      return 'Changed ' + k;
    }
    return 'Changed ' + total + ' things';
  }

  /* ---------- recording ---------- */
  function newStep(changes, label, at) {
    return { id: 's' + Date.now().toString(36) + (++seq).toString(36), at, lastAt: at, n: 1, label: label || '', explicit: !!label, changes, size: sizeOf(changes), sealed: false };
  }
  function trim() {
    while (undoStack.length > MAX_STEPS) undoStack.shift();
    let bytes = undoStack.reduce((a, s) => a + s.size, 0) + redoStack.reduce((a, s) => a + s.size, 0);
    while (bytes > MAX_BYTES && undoStack.length > 1) bytes -= undoStack.shift().size;
    while (redoStack.length > MAX_STEPS) redoStack.shift();
  }

  /* Called by store.commit with the saved text of every key before and after. */
  function record(prev, cur, opts) {
    const skip = !prev || muted > 0 || (opts && opts.history === false);
    if (skip && !captures.length) {
      lastCommit = { step: null, at: 0 };
      return;
    }
    const changes = {};
    const keys = prev.keys.concat(cur.keys.filter((k) => !(k in prev.str)));
    for (const k of keys) {
      if (prev.str[k] === cur.str[k]) continue;
      const d = diffKey(prev, cur, k);
      if (d) changes[k] = d;
    }
    // Something is collecting changes that aren't recorded (see capture): it gets its own copy.
    if (captures.length && Object.keys(changes).length) compose(captures[captures.length - 1], JSON.parse(JSON.stringify(changes)));
    if (skip) {
      lastCommit = { step: null, at: 0 };
      return;
    }
    if (!Object.keys(changes).length) {
      lastCommit = { step: null, at: 0 };
      return;
    }
    const now = Date.now();
    const label = opts && opts.label ? opts.label : '';
    const top = undoStack[undoStack.length - 1];
    let step = null;
    if (batching) step = batchStep && undoStack.includes(batchStep) ? batchStep : null;
    else if (top && !top.sealed && now - top.lastAt < GROUP_MS) step = top;
    if (step) {
      compose(step.changes, changes);
      step.n++;
      step.lastAt = now;
      if (label && !step.explicit) {
        step.label = label;
        step.explicit = true;
      }
      if (!Object.keys(step.changes).length) {
        undoStack.splice(undoStack.indexOf(step), 1);
        if (batchStep === step) batchStep = null;
        lastCommit = { step: null, at: 0 };
        changed();
        return;
      }
      step.size = sizeOf(step.changes);
    } else {
      step = newStep(changes, label, now);
      undoStack.push(step);
      redoStack = [];
      if (batching) batchStep = step;
    }
    if (!step.explicit) step.label = describe(step.changes);
    trim();
    lastCommit = { step: step.id, at: now };
    changed();
  }

  /* ---------- applying a step to what's there now ---------- */
  function applyArr(s, k, ch, dir, res) {
    const want = dir === 'undo' ? 'a' : 'b'; // how each record should be right now
    const to = dir === 'undo' ? 'b' : 'a';
    const arr = Array.isArray(s[k]) ? s[k].slice() : null;
    if (!arr) {
      for (const r of ch.recs) {
        res.total++;
        res.conflicts.push({ c: k, id: r.id });
      }
      return;
    }
    const at = new Map();
    for (let i = 0; i < arr.length; i++) at.set(arr[i] && arr[i].id, i);
    const drop = new Set();
    const inserts = [];
    let touched = false;
    for (const r of ch.recs) {
      res.total++;
      const i = at.get(r.id);
      const now = i === undefined ? null : JSON.stringify(arr[i]);
      if (same(now, r[want])) {
        if (r[to] === null) drop.add(r.id);
        else if (now === null) inserts.push(r);
        else arr[i] = JSON.parse(r[to]);
        res.applied++;
        touched = true;
      } else if (same(now, r[to])) res.already++;
      else res.conflicts.push({ c: k, id: r.id });
    }
    if (drop.size) {
      for (let i = arr.length - 1; i >= 0; i--) if (arr[i] && drop.has(arr[i].id)) arr.splice(i, 1);
    }
    if (inserts.length) {
      const pos = dir === 'undo' ? 'ib' : 'ia';
      const pre = dir === 'undo' ? 'pb' : 'pa';
      inserts.sort((x, y) => (x[pos] === undefined ? 1e9 : x[pos]) - (y[pos] === undefined ? 1e9 : y[pos]));
      for (const r of inserts) {
        const rec = JSON.parse(r[to]);
        let where = arr.length;
        if (r[pre] === null) where = 0;
        else if (r[pre] !== undefined) {
          const p = arr.findIndex((x) => x && x.id === r[pre]);
          where = p >= 0 ? p + 1 : Math.min(r[pos] === undefined ? arr.length : r[pos], arr.length);
        } else if (r[pos] !== undefined) where = Math.min(r[pos], arr.length);
        arr.splice(where, 0, rec);
      }
    }
    const order = dir === 'undo' ? ch.ob : ch.oa;
    if (order && order.length) {
      // Put the records back in the order the list had (or has now been given): the ones the order knows, in its
      // order; anything it doesn't know (added by someone else since) stays after the record it followed.
      const rank = new Map(order.map((id, i) => [id, i]));
      const known = [];
      const loose = new Map(); // id of the known record it follows (or '' for the start) -> records
      let anchor = '';
      for (const x of arr) {
        if (x && rank.has(x.id)) {
          known.push(x);
          anchor = x.id;
        } else {
          if (!loose.has(anchor)) loose.set(anchor, []);
          loose.get(anchor).push(x);
        }
      }
      known.sort((x, y) => rank.get(x.id) - rank.get(y.id));
      const next = (loose.get('') || []).slice();
      for (const x of known) {
        next.push(x);
        for (const y of loose.get(x.id) || []) next.push(y);
      }
      if (next.some((x, i) => x !== arr[i])) {
        arr.length = 0;
        next.forEach((x) => arr.push(x));
        touched = true;
      }
    }
    if (touched) s[k] = arr;
  }
  function applyObj(s, k, ch, dir, res) {
    const want = dir === 'undo' ? 'a' : 'b';
    const to = dir === 'undo' ? 'b' : 'a';
    if (!s[k] || typeof s[k] !== 'object' || Array.isArray(s[k])) {
      for (const f of ch.fields) {
        res.total++;
        res.conflicts.push({ c: k, id: f.name });
      }
      return;
    }
    const obj = Object.assign({}, s[k]);
    let touched = false;
    for (const f of ch.fields) {
      res.total++;
      const now = obj[f.name] === undefined ? null : JSON.stringify(obj[f.name]);
      if (same(now, f[want])) {
        if (f[to] === null) delete obj[f.name];
        else obj[f.name] = JSON.parse(f[to]);
        res.applied++;
        touched = true;
      } else if (same(now, f[to])) res.already++;
      else res.conflicts.push({ c: k, id: f.name });
    }
    if (touched) s[k] = obj;
  }
  function applyBlob(s, k, ch, dir, res) {
    const want = dir === 'undo' ? 'a' : 'b';
    const to = dir === 'undo' ? 'b' : 'a';
    res.total++;
    const now = s[k] === undefined ? null : JSON.stringify(s[k]);
    if (same(now, ch[want])) {
      if (ch[to] === null) delete s[k];
      else s[k] = JSON.parse(ch[to]);
      res.applied++;
    } else if (same(now, ch[to])) res.already++;
    else res.conflicts.push({ c: k, id: '' });
  }
  /* Applies a step's changes to the current state (in one commit that isn't recorded). */
  function applyStep(step, dir) {
    const res = { total: 0, applied: 0, already: 0, conflicts: [] };
    store.commit((s) => {
      for (const k of Object.keys(step.changes)) {
        const ch = step.changes[k];
        if (ch.mixed) continue;
        if (ch.t === 'arr') applyArr(s, k, ch, dir, res);
        else if (ch.t === 'obj') applyObj(s, k, ch, dir, res);
        else applyBlob(s, k, ch, dir, res);
      }
    }, { history: false });
    return res;
  }
  /* How much of a step's 'before' is already in place (a legacy Undo ran). */
  function revertedBy(step) {
    const probe = { total: 0, applied: 0, already: 0, conflicts: [] };
    const s = store.state;
    for (const k of Object.keys(step.changes)) {
      const ch = step.changes[k];
      if (ch.mixed) continue;
      const items = ch.t === 'arr' ? ch.recs.map((r) => {
        const rec = (s[k] || []).find((x) => x && x.id === r.id);
        return { now: rec ? JSON.stringify(rec) : null, b: r.b, a: r.a };
      }) : ch.t === 'obj' ? ch.fields.map((f) => ({ now: s[k] && s[k][f.name] !== undefined ? JSON.stringify(s[k][f.name]) : null, b: f.b, a: f.a }))
        : [{ now: s[k] === undefined ? null : JSON.stringify(s[k]), b: ch.b, a: ch.a }];
      for (const it of items) {
        probe.total++;
        if (same(it.now, it.b)) probe.already++;
        else probe.conflicts.push(k);
      }
    }
    return probe;
  }

  /* ---------- undo and redo ---------- */
  function say(msg, o) {
    if (GU.ui && GU.ui.toast) GU.ui.toast(msg, o);
  }
  const things = (n) => (n === 1 ? '1 thing' : n + ' things');
  function leftNote(n) {
    return n ? ' · ' + things(n) + ' had changed since, so I left ' + (n === 1 ? 'it' : 'them') : '';
  }
  /* The next change starts a new step, however soon it comes. */
  function seal() {
    const top = undoStack[undoStack.length - 1];
    if (top) top.sealed = true;
  }

  /* Undoes one step (the newest, or `step`). opts.quiet: no toast. Returns {ok, label, left, empty}. */
  function undoOne(step, opts) {
    opts = opts || {};
    seal();
    let out;
    if (!step) {
      while (undoStack.length && !out) out = applyOne(undoStack.pop(), 'undo', opts);
      if (!out) {
        if (!opts.quiet) say('Nothing to undo');
        out = { ok: false, empty: true };
      }
    } else {
      const i = undoStack.indexOf(step);
      if (i < 0) return { ok: false, empty: true };
      undoStack.splice(i, 1);
      out = applyOne(step, 'undo', opts) || { ok: false, label: step.label, left: 0, already: true };
    }
    seal();
    changed();
    return out;
  }
  /* Applies a step that's been taken off its stack, and puts it on the other one. Returns the result, or null when the
     step was already undone (so the caller moves on to the next one). */
  function applyOne(step, dir, opts) {
    const res = applyStep(step, dir);
    const done = dir === 'undo' ? 'Undone' : 'Redone';
    if (res.total && !res.applied && !res.conflicts.length) {
      // Everything was already as it should be: a legacy Undo got there first.
      (dir === 'undo' ? redoStack : undoStack).push(step);
      step.sealed = true;
      changed();
      return null;
    }
    if (res.conflicts.length && !res.applied) {
      if (!opts.quiet) say('Didn’t ' + (dir === 'undo' ? 'undo' : 'redo') + ': ' + clip(step.label, 60) + '. It had changed since, so I left it as it is.');
      changed();
      return { ok: false, label: step.label, left: res.conflicts.length };
    }
    step.sealed = true;
    (dir === 'undo' ? redoStack : undoStack).push(step);
    trim();
    changed();
    if (!opts.quiet) {
      say(done + ': ' + step.label + leftNote(res.conflicts.length), dir === 'undo'
        ? { action: 'Redo', timeout: 10000, plain: true, onAction: () => redo() }
        : { action: 'Undo', timeout: 10000, plain: true, onAction: () => undo() });
    }
    return { ok: true, label: step.label, left: res.conflicts.length };
  }
  function undo(opts) {
    return undoOne(null, opts);
  }
  function redo(opts) {
    opts = opts || {};
    seal();
    let out = null;
    while (redoStack.length && !out) out = applyOne(redoStack.pop(), 'redo', opts);
    if (!out) {
      if (!opts.quiet) say('Nothing to redo');
      out = { ok: false, empty: true };
    }
    seal();
    changed();
    return out;
  }
  /* Undo this step alone (a step further back than the newest). */
  function undoStep(id, opts) {
    const step = undoStack.find((s) => s.id === id);
    if (!step) return { ok: false, empty: true };
    return undoOne(step, opts);
  }
  /* Undo everything back to, and including, this step. */
  function undoTo(id, opts) {
    opts = opts || {};
    if (!undoStack.some((s) => s.id === id)) return { ok: false, empty: true };
    let n = 0;
    let left = 0;
    let label = '';
    while (undoStack.some((s) => s.id === id)) {
      const r = undoOne(null, { quiet: true });
      if (r.empty) break;
      if (r.ok) {
        n++;
        left += r.left || 0;
        label = r.label;
      }
    }
    if (!opts.quiet) say('Undone: ' + (n === 1 ? label : n + ' changes') + leftNote(left), { action: 'Redo', timeout: 10000, plain: true, onAction: () => redo() });
    return { ok: n > 0, n, left };
  }
  function redoTo(id, opts) {
    opts = opts || {};
    if (!redoStack.some((s) => s.id === id)) return { ok: false, empty: true };
    let n = 0;
    let left = 0;
    let label = '';
    while (redoStack.some((s) => s.id === id)) {
      const r = redo({ quiet: true });
      if (r.empty) break;
      if (r.ok) {
        n++;
        left += r.left || 0;
        label = r.label;
      }
    }
    if (!opts.quiet) say('Redone: ' + (n === 1 ? label : n + ' changes') + leftNote(left), { action: 'Undo', timeout: 10000, plain: true, onAction: () => undo() });
    return { ok: n > 0, n, left };
  }

  /* ---------- Undo buttons in toasts (and the older closures behind them) ---------- */
  /* The step the commit just made went into, to tie a toast's Undo to it. */
  function toastTag() {
    if (!lastCommit.step || Date.now() - lastCommit.at > 1500) return null;
    const step = undoStack.find((s) => s.id === lastCommit.step);
    return step ? { id: step.id, n: step.n } : null;
  }
  /* The click on a toast's Undo. legacy: what the toast did before there was History (put the old record back).
     o.exact: the Undo is for exactly the one change just made, so the history's own record of that change is used,
     and a deleted record goes back in the very same place. Anything else runs legacy, which makes its own changes
     (they aren't recorded: they are the undo) and marks the step it undid as undone, so Ctrl+Z goes to the one before. */
  function undoFromToast(tag, legacy, o) {
    if (tag && o && o.exact) {
      const step = undoStack.find((s) => s.id === tag.id);
      if (step && step.n === 1 && tag.n === 1) return undoOne(step);
      if (!step && redoStack.some((s) => s.id === tag.id)) {
        say('That’s already undone');
        return { ok: false };
      }
    }
    if (typeof legacy !== 'function') return { ok: false };
    // It makes its own changes, which aren't recorded: they are the undo. The step they undid goes with them.
    let out;
    muted++;
    try {
      out = legacy();
    } finally {
      muted--;
    }
    const settle = () => {
      const target = tag && undoStack.find((s) => s.id === tag.id);
      const candidates = target ? [target] : undoStack.slice(-1);
      for (const st of candidates) {
        const probe = revertedBy(st);
        if (probe.total && !probe.conflicts.length) {
          undoStack.splice(undoStack.indexOf(st), 1);
          st.sealed = true;
          redoStack.push(st);
        }
      }
      seal();
      changed();
    };
    if (out && typeof out.then === 'function') out.then(settle, settle);
    else settle();
    return { ok: true, legacy: true };
  }

  /* ---------- the rest of the API ---------- */
  /* Runs fn without recording what it commits. */
  function silent(fn) {
    muted++;
    try {
      return fn();
    } finally {
      muted--;
    }
  }
  /* A message with an Undo that takes back the step the last commit went into, whatever else has happened since. */
  function offerUndo(msg, opts) {
    const tag = toastTag();
    if (!tag) return say(msg, opts);
    return say(msg, Object.assign({ action: 'Undo', plain: true, onAction: () => undoStep(tag.id) }, opts || {}));
  }
  /* Names the step the last commit went into (a message that says what happened is a better name than 'Edited …'). */
  function label(text) {
    if (!text || !lastCommit.step || Date.now() - lastCommit.at > 1500) return;
    const step = undoStack.find((s) => s.id === lastCommit.step);
    if (!step || step.explicit || step.n > 1) return; // a step of several commits keeps the name worked out from all of them
    step.label = clip(String(text).replace(/\s+/g, ' ').trim(), 70);
    step.explicit = true;
    changed();
  }
  /* Runs fn (which commits changes that aren't recorded, such as the tidying done at start-up) and returns what it
     changed as a loose step, so an Undo button on its message can take it back record by record: {result, step}. */
  function capture(fn) {
    const mine = {};
    captures.push(mine);
    let result;
    try {
      result = fn();
    } finally {
      captures.pop();
    }
    return { result, step: { id: 'c' + Date.now().toString(36) + (++seq).toString(36), label: '', changes: mine, n: 1, size: 0 } };
  }
  /* Undoes a loose step from capture() against what's there now. */
  function undoLoose(step, name) {
    const res = applyStep(step, 'undo');
    if (res.conflicts.length && !res.applied) say((name || 'That') + ' had changed since, so I left it as it is.');
    else if (res.conflicts.length) say('Undone' + leftNote(res.conflicts.length));
    else say('Undone' + (name ? ': ' + name : ''));
    return { ok: res.applied > 0, left: res.conflicts.length };
  }
  /* Runs fn so that everything it commits is one step, however long it takes, with this name. */
  function batch(label, fn) {
    if (!batching) batchStep = null;
    batching++;
    try {
      return fn();
    } finally {
      batching--;
      if (!batching) {
        if (batchStep && label && undoStack.includes(batchStep)) {
          batchStep.label = label;
          batchStep.explicit = true;
        }
        batchStep = null;
        seal();
        changed();
      }
    }
  }
  function reset() {
    undoStack = [];
    redoStack = [];
    batching = 0;
    batchStep = null;
    lastCommit = { step: null, at: 0 };
    try {
      sessionStorage.removeItem(SESSION_KEY);
    } catch (e) {
      /* no session storage */
    }
    changed(true);
  }
  const brief = (s) => ({ id: s.id, label: s.label, at: s.at, n: s.n });
  function list() {
    return { undo: undoStack.slice().reverse().map(brief), redo: redoStack.slice().reverse().map(brief) };
  }
  function status() {
    const u = undoStack[undoStack.length - 1];
    const r = redoStack[redoStack.length - 1];
    return { canUndo: !!u, canRedo: !!r, undoLabel: u ? u.label : '', redoLabel: r ? r.label : '', steps: undoStack.length };
  }
  function onChange(fn) {
    watchers.add(fn);
    return () => watchers.delete(fn);
  }
  function changed(skipSave) {
    if (!skipSave) scheduleSave();
    watchers.forEach((fn) => {
      try {
        fn(status());
      } catch (e) {
        console.error(e);
      }
    });
  }

  /* ---------- keeping it for this tab (reloads) ---------- */
  function scheduleSave() {
    if (saveTimer) return;
    saveTimer = setTimeout(save, 400);
  }
  function save() {
    clearTimeout(saveTimer);
    saveTimer = null;
    try {
      let u = undoStack.slice(-MAX_STEPS);
      let r = redoStack.slice(-MAX_STEPS);
      let bytes = u.concat(r).reduce((a, s) => a + s.size, 0);
      while (bytes > SAVE_BYTES && (u.length || r.length)) {
        const gone = r.length ? r.shift() : u.shift();
        bytes -= gone.size;
      }
      sessionStorage.setItem(SESSION_KEY, JSON.stringify({ v: 1, u, r }));
    } catch (e) {
      try {
        sessionStorage.removeItem(SESSION_KEY);
      } catch (e2) {
        /* no session storage */
      }
    }
  }
  function load() {
    try {
      const raw = sessionStorage.getItem(SESSION_KEY);
      const d = raw ? JSON.parse(raw) : null;
      if (!d || d.v !== 1 || !Array.isArray(d.u) || !Array.isArray(d.r)) return;
      const ok = (s) => s && typeof s.id === 'string' && s.changes && typeof s.changes === 'object';
      undoStack = d.u.filter(ok).map((s) => Object.assign(s, { sealed: true }));
      redoStack = d.r.filter(ok).map((s) => Object.assign(s, { sealed: true }));
      changed(true);
    } catch (e) {
      /* start empty */
    }
  }
  window.addEventListener('pagehide', () => {
    if (saveTimer) save();
  });

  /* ---------- Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z, Ctrl+Y ---------- */
  const TYPING = /^(text|search|email|url|tel|password|number|date|datetime-local|month|week|time)$/i;
  function typing(el) {
    if (!el || el === document.body) return false;
    if (el.isContentEditable) return true;
    const tag = el.tagName;
    if (tag === 'TEXTAREA') return true;
    if (tag === 'INPUT') return TYPING.test(el.getAttribute('type') || 'text');
    return false;
  }
  document.addEventListener('keydown', (e) => {
    if (e.defaultPrevented || e.altKey || !(e.ctrlKey || e.metaKey)) return;
    const k = String(e.key || '').toLowerCase();
    const isUndo = k === 'z' && !e.shiftKey;
    const isRedo = (k === 'z' && e.shiftKey) || (k === 'y' && !e.shiftKey && !e.metaKey);
    if (!isUndo && !isRedo) return;
    if (typing(e.target) || typing(document.activeElement)) return; // the browser's own text undo applies there
    if (document.querySelector('dialog[open]')) return; // a form is being filled in
    e.preventDefault();
    if (isUndo) undo();
    else redo();
  });

  GU.history = {
    MAX_STEPS, GROUP_MS,
    record, undo, redo, undoStep, undoTo, redoTo, undoFromToast, toastTag,
    silent, batch, seal, reset, list, status, onChange, load, save, label, capture, undoLoose, offerUndo,
    canUndo: () => undoStack.length > 0, canRedo: () => redoStack.length > 0,
    describe,
  };
  load();
})();
