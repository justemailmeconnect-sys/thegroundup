/* The Ground Up: one ⋯ menu on every item, everywhere, and the lists you can download.

   GU.organise.itemMenu(anchor, collection, id, extras) opens the same menu for any record in any list:
   Open, Rename, Move to…, Duplicate, Download, then what's special to that page (Mark paid, Done…), then Delete.
   Every change goes through store.commit, so it is one step in Undo history (js/history.js) with a name, and the toast
   that follows has an Undo that takes back exactly that step.

   A row only needs organise.moreBtn(collection, id): the click is handled here. A page that has actions of its own
   registers them with organise.extras[collection] = (record, context) => [menu items]. */
(function () {
  'use strict';
  const GU = window.GU;
  const store = GU.store;
  const { esc, uid, today, plural } = GU.util;
  const { icon } = GU.ui;

  const parts = () => GU.parts;
  const wm = () => GU.workMoney || null;
  const co = (cap) => (parts() ? parts().co(store.state, cap) : cap ? 'The company' : 'the company');
  const paysLabel = () => (parts() ? parts().paysLabel(store.state) : 'Company pays');
  const clip = (t, n) => (String(t).length > (n || 40) ? String(t).slice(0, (n || 40) - 1).trim() + '…' : String(t));
  const quote = (t) => '‘' + clip(t) + '’';
  const copyOf = (v) => JSON.parse(JSON.stringify(v));
  const isWorkPaper = (p) => !!p && p.context === 'work';

  /* The field each kind of record is named by, its words, and the start of its ids. */
  const CFG = {
    paperwork: { field: 'title', one: 'receipt', pfx: 'p-', what: 'Receipt or invoice' },
    bills: { field: 'name', one: 'bill', pfx: 'b-', what: 'Bill' },
    debts: { field: 'name', one: 'debt', pfx: 'debt-', what: 'Debt' },
    incomeSources: { field: 'name', one: 'income', pfx: 'i-', what: 'Income' },
    transactions: { field: 'description', one: 'transaction', pfx: 't-', what: 'Transaction' },
    documents: { field: 'title', one: 'document', pfx: 'd-', what: 'Document' },
    visas: { field: 'visaType', one: 'visa application', pfx: 'v-', what: 'Visa application' },
    tasks: { field: 'title', one: 'task', pfx: 'k-', what: 'Task' },
    projects: { field: 'name', one: 'project', pfx: 'pj-', what: 'Project' },
    costIdeas: { field: 'name', one: 'plan', pfx: 'ci-', what: 'Plan' },
    workNotes: { field: 'title', one: 'note', pfx: 'wn-', what: 'Note' },
    sectionItems: { field: 'title', one: 'item', pfx: 'si-', what: 'Item' },
    requests: { field: 'title', one: 'thing to get', pfx: 'rq-', what: 'Thing to get' },
  };
  const rec = (c, id) => (store.state[c] || []).find((x) => x.id === id) || null;
  const nameOf = (c, r) => String((r && r[(CFG[c] || { field: 'name' }).field]) || (r && (r.name || r.title || r.description)) || (CFG[c] ? CFG[c].what : 'Item'));

  /* ---------- one step, then a toast whose Undo takes back exactly that step ---------- */
  /* Runs fn (which commits) as its own step called `label`, then says `msg` with an Undo. */
  function act(label, fn, msg) {
    GU.history.seal();
    const out = fn();
    GU.history.label(label);
    if (msg !== false) GU.history.offerUndo(msg || label);
    return out;
  }
  const mutate = (c, id, fn, label, msg) => act(label, () => store.commit((s) => {
    const r = (s[c] || []).find((x) => x.id === id);
    if (r) fn(r, s);
  }, { label }), msg);

  /* A question with one text box. Resolves to the answer, or null. */
  function ask(o) {
    return new Promise((resolve) => {
      let done = false;
      GU.ui.formDialog({
        title: o.title,
        intro: o.intro,
        fields: [{ name: 'v', label: o.label || 'Name', required: true, placeholder: o.placeholder || '' }],
        values: { v: o.value || '' },
        submitLabel: o.submit || 'Save',
        onSubmit: (v) => {
          done = true;
          resolve(String(v.v || '').trim());
        },
      }).el.addEventListener('close', () => {
        if (!done) resolve(null);
      });
    });
  }

  /* ---------- CSV (a list or one record), saved through the downloads permission ---------- */
  const BOM = String.fromCharCode(0xfeff); // so spreadsheet apps read it as UTF-8 (the £ sign, accents)
  /* One cell. Numbers stay numbers; text a spreadsheet would run as a formula (=, +, -, @) is kept as text. */
  function csvCell(v) {
    if (v == null) return '';
    let t = typeof v === 'number' ? String(v) : String(v);
    if (typeof v !== 'number' && /^[=+\-@\t\r]/.test(t) && !/^-?\d+(\.\d+)?$/.test(t)) t = "'" + t;
    return /[",\r\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t;
  }
  const csvText = (rows) => BOM + rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
  const fileSafe = (t) => String(t || 'list').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60) || 'list';
  function saveCSV(rows, name) {
    return GU.ui.saveFile(new Blob([csvText(rows)], { type: 'text/csv;charset=utf-8' }), fileSafe(name) + '.csv');
  }

  /* A record as one CSV row: its plain fields (files by name; lists and notes about it left out). */
  function recordRow(c, r) {
    const keys = [];
    const vals = [];
    for (const k of Object.keys(r)) {
      const v = r[k];
      if (k === 'files') {
        keys.push('files');
        vals.push((v || []).map((f) => f.name).join('; '));
      } else if (v == null || typeof v === 'object') continue;
      else {
        keys.push(k);
        vals.push(v);
      }
    }
    return [keys, vals];
  }
  /* The record's files (one as it is, several as a .zip), or with none a one-row spreadsheet of the record. */
  async function download(c, id) {
    const r = rec(c, id);
    if (!r) return false;
    const list = (r.files || []).filter((f) => f && f.id);
    if (list.length) return GU.ui.downloadFiles(list.map((f) => f.id), nameOf(c, r));
    return saveCSV(recordRow(c, r), nameOf(c, r));
  }

  /* ---------- rename ---------- */
  async function rename(c, id) {
    const r = rec(c, id);
    if (!r) return;
    const field = CFG[c].field;
    const was = String(r[field] || '');
    const label = c === 'transactions' ? 'Description' : field === 'title' ? 'Title' : 'Name';
    const v = await ask({ title: 'Rename', label, value: was, submit: 'Rename' });
    if (v == null || v === was) return;
    mutate(c, id, (x, s) => {
      x[field] = v;
      if (x.updated !== undefined) x.updated = today();
    }, 'Renamed ' + quote(was) + ' to ' + quote(v), 'Renamed to ' + quote(v));
  }

  /* ---------- duplicate ---------- */
  /* Why a record can't be copied, or '' when it can. */
  function whyNotCopy(c, r) {
    if (c === 'transactions') {
      const used = (store.state.paperwork || []).some((p) => p.purchaseTx === r.id || p.repaidTx === r.id || (p.repayments || []).some((x) => x && x.tx === r.id) || (p.payments || []).some((x) => x && x.tx === r.id));
      if (used) return 'It’s linked to a claim or an invoice';
    }
    if (c === 'paperwork') {
      if (r.purchaseTx || r.repaidTx || r.packId || (r.payments || []).length || (r.repayments || []).length || r.billId) return 'It already has payments or a claim pack';
    }
    return '';
  }
  function copyName(r, field) {
    const was = String(r[field] || '');
    return (was || 'Copy').replace(/\s*\(copy( \d+)?\)$/i, '') + ' (copy)';
  }
  function duplicate(c, id) {
    const r = rec(c, id);
    if (!r || whyNotCopy(c, r)) return;
    const f = CFG[c].field;
    const n = copyOf(r);
    n.id = CFG[c].pfx + uid();
    n[f] = copyName(r, f);
    if (n.created !== undefined) n.created = today();
    if (n.updated !== undefined) n.updated = today();
    // What belongs to the one record only: where it came from and what it was matched to.
    for (const k of ['importBatch', 'statementBatch', 'foundKey', 'found', 'review', 'folder']) delete n[k];
    if (c === 'bills') n.history = [];
    if (c === 'debts') {
      n.history = [];
      delete n.schedule;
      delete n.scheduleUpdated;
    }
    if (c === 'paperwork') {
      delete n.reference;
      delete n.importBatch;
    }
    if (n.demo) delete n.demo; // a copy is yours, even of an example
    act('Duplicated ' + quote(nameOf(c, r)), () => store.commit((s) => {
      const list = s[c];
      const i = list.findIndex((x) => x.id === id);
      list.splice(i < 0 ? list.length : i + 1, 0, n);
    }, { label: 'Duplicated ' + quote(nameOf(c, r)) }), 'Made ' + quote(n[f]));
  }

  /* ---------- delete ---------- */
  function remove(c, id) {
    const r = rec(c, id);
    if (!r) return;
    const label = nameOf(c, r);
    GU.history.seal();
    if (c === 'transactions') {
      // The thing in Get paid back this paid for stays there, without a bank payment: one step with the delete.
      let entry = null;
      store.commit((s) => {
        s.transactions = s.transactions.filter((x) => x.id !== id);
        entry = GU.trash.put(s, c, r, label);
        for (const p of s.paperwork || []) {
          if (p.purchaseTx === id) {
            delete p.purchaseTx;
            delete p.purchaseWas;
          }
        }
      }, { label: 'Deleted ' + quote(label) });
      GU.trash.offerUndo(entry);
      return;
    }
    store.remove(c, id, label);
  }

  /* ---------- places: Home, Work, folders, lists, categories ---------- */
  const heading = (t) => ({ heading: t });
  const sep = { separator: true };

  /* Work folders a record can sit in, on its page. */
  const AREA_OF = { tasks: 'tasks', paperwork: 'invoices', projects: 'projects', bills: 'bills', documents: 'contracts' };
  const foldersFor = (c) => (GU.work && AREA_OF[c] ? GU.work.foldersOf(store.state, AREA_OF[c]) : []);
  function inFolder(c, r) {
    const fo = foldersFor(c).find((f) => f.id === r.workFolder);
    return fo ? fo.id : '';
  }
  function folderItems(c, r) {
    const area = AREA_OF[c];
    if (!area || !GU.work) return [];
    const cur = inFolder(c, r);
    const set = (folder, name) => mutate(c, r.id, (x) => {
      if (folder) x.workFolder = folder;
      else delete x.workFolder;
    }, 'Moved ' + quote(nameOf(c, r)) + (name ? ' to ' + quote(name) : ' out of its folder'), 'Moved ' + quote(nameOf(c, r)) + (name ? ' to ' + quote(name) : ' out of its folder'));
    const items = [heading('Folder'), { icon: 'x', label: 'No folder', checked: !cur, disabled: !cur, onClick: () => set('', '') }];
    for (const f of foldersFor(c)) items.push({ icon: 'folder', label: f.name, checked: cur === f.id, disabled: cur === f.id, onClick: () => set(f.id, f.name) });
    items.push({ icon: 'plus', label: 'New folder…', onClick: async () => {
      const name = await ask({ title: 'New folder', label: 'Folder name', placeholder: 'e.g. Suppliers, 2026', submit: 'Create and move' });
      if (!name) return;
      if (foldersFor(c).some((f) => f.name.toLowerCase() === name.toLowerCase())) return GU.ui.toast('There’s already a folder called ' + name + '.');
      const fid = 'wf-' + uid();
      act('Moved ' + quote(nameOf(c, r)) + ' to the new folder ' + quote(name), () => store.commit((s) => {
        s.workFolders = (s.workFolders || []).concat([{ id: fid, area, name, created: today() }]);
        const x = s[c].find((y) => y.id === r.id);
        if (x) x.workFolder = fid;
      }, { label: 'Moved ' + quote(nameOf(c, r)) + ' to the new folder ' + quote(name) }), 'Moved ' + quote(nameOf(c, r)) + ' to ' + quote(name));
    } });
    return items;
  }

  /* To-do lists (Home) and the Work list. */
  const workList = () => (parts() ? parts().workListId(store.state) : null);
  function moveTaskToList(r, listId, name) {
    mutate('tasks', r.id, (x) => {
      x.listId = listId;
    }, 'Moved ' + quote(r.title) + ' to ' + quote(name), 'Moved ' + quote(r.title) + ' to ' + quote(name));
  }
  function taskHomeWork(r) {
    const work = parts().isWorkTask(store.state, r);
    const items = [];
    if (work) {
      items.push(heading('Where'));
      items.push({ icon: 'briefcase', label: 'Work', hint: co(true) + '’s tasks', checked: true, disabled: true, onClick: () => {} });
      items.push({ icon: 'home', label: 'Home', hint: 'Back to your own to-do lists', onClick: () => GU.work.takeOut('tasks', r.id) });
    } else {
      const lists = store.state.todoLists.filter((l) => l.id !== workList());
      items.push(heading('List'));
      for (const l of lists) items.push({ icon: 'list', label: l.name, checked: r.listId === l.id, disabled: r.listId === l.id, onClick: () => moveTaskToList(r, l.id, l.name) });
      items.push({ icon: 'plus', label: 'New list…', onClick: async () => {
        const name = await ask({ title: 'New list', label: 'List name', placeholder: 'e.g. Wedding, Shopping', submit: 'Create and move' });
        if (!name) return;
        const id = 'list-' + uid();
        act('Moved ' + quote(r.title) + ' to the new list ' + quote(name), () => store.commit((s) => {
          s.todoLists.push({ id, name });
          const x = s.tasks.find((y) => y.id === r.id);
          if (x) x.listId = id;
        }, { label: 'Moved ' + quote(r.title) + ' to the new list ' + quote(name) }), 'Moved ' + quote(r.title) + ' to ' + quote(name));
      } });
      items.push(sep);
      items.push(heading('Where'));
      items.push({ icon: 'briefcase', label: 'Work', hint: co(true) + '’s tasks', onClick: () => mutate('tasks', r.id, (x, s) => {
        x.context = 'work';
        x.listId = GU.work.ensureWorkList(s);
      }, 'Moved ' + quote(r.title) + ' to Work', 'Moved ' + quote(r.title) + ' to Work') });
    }
    return items;
  }

  /* Your own categories (the pages in the menu) and the groups inside them. */
  const sectionList = () => (GU.sections && GU.sections.ordered ? GU.sections.ordered() : store.state.sections || []);
  const groupsIn = (sid) => Array.from(new Set((store.state.sectionItems || []).filter((x) => x.sectionId === sid && x.group).map((x) => x.group))).sort((a, b) => a.localeCompare(b));
  function moveItem(r, sid, group, text) {
    mutate('sectionItems', r.id, (x) => {
      x.sectionId = sid;
      if (group) x.group = group;
      else delete x.group;
    }, 'Moved ' + quote(r.title) + ' to ' + text, 'Moved ' + quote(r.title) + ' to ' + text);
  }
  function itemPlaces(r, anchor) {
    const secs = sectionList();
    const here = secs.find((x) => x.id === r.sectionId);
    const items = [];
    const newGroup = async (sid, secName) => {
      const name = await ask({ title: 'New group', label: 'Group name', placeholder: 'e.g. MOT, Insurance', submit: 'Create and move' });
      if (name) moveItem(r, sid, name, quote(name) + (sid === r.sectionId ? '' : ' in ' + quote(secName)));
    };
    items.push(heading('Group in ' + (here ? here.name : 'this category')));
    items.push({ icon: 'x', label: 'No group', checked: !r.group, disabled: !r.group, onClick: () => moveItem(r, r.sectionId, '', 'no group') });
    for (const g of groupsIn(r.sectionId)) items.push({ icon: 'folder', label: g, checked: r.group === g, disabled: r.group === g, onClick: () => moveItem(r, r.sectionId, g, quote(g)) });
    items.push({ icon: 'plus', label: 'New group…', onClick: () => newGroup(r.sectionId, here && here.name) });
    items.push(sep);
    items.push(heading('Another category'));
    for (const sec of secs) {
      if (sec.id === r.sectionId) continue;
      const gs = groupsIn(sec.id);
      const where = (sec.part === 'work' ? 'Work' : 'Home');
      if (gs.length) {
        items.push({ icon: sec.icon || 'star', label: sec.name, hint: where + ' · choose a group…', onClick: () => setTimeout(() => GU.ui.menu(anchor, [
          heading(sec.name),
          { icon: 'x', label: 'No group', onClick: () => moveItem(r, sec.id, '', quote(sec.name)) },
        ].concat(gs.map((g) => ({ icon: 'folder', label: g, onClick: () => moveItem(r, sec.id, g, quote(g) + ' in ' + quote(sec.name)) })),
          [{ icon: 'plus', label: 'New group…', onClick: () => newGroup(sec.id, sec.name) }])), 30) });
      } else items.push({ icon: sec.icon || 'star', label: sec.name, hint: where, onClick: () => moveItem(r, sec.id, '', quote(sec.name)) });
    }
    items.push({ icon: 'plus', label: 'New category…', onClick: async () => {
      const name = await ask({ title: 'New category', label: 'Category name', placeholder: 'e.g. Car, Pets, Wedding', submit: 'Create and move' });
      if (!name) return;
      const sid = 's' + uid();
      act('Moved ' + quote(r.title) + ' to the new category ' + quote(name), () => store.commit((s) => {
        s.sections.push({ id: sid, name, icon: GU.sections.iconFor(name), created: today(), part: here && here.part === 'work' ? 'work' : 'home' });
        const x = s.sectionItems.find((y) => y.id === r.id);
        if (x) {
          x.sectionId = sid;
          delete x.group;
        }
      }, { label: 'Moved ' + quote(r.title) + ' to the new category ' + quote(name) }), 'Moved ' + quote(r.title) + ' to ' + quote(name));
    } });
    return items;
  }

  /* Money categories and accounts, for a bank line. */
  function txPlaces(r) {
    const F = GU.finance;
    const out = r.amount < 0;
    const linked = r.category === F.WORK_OUT || r.category === F.WORK_IN;
    const items = [];
    const cats = (out ? F.EXPENSE : F.INCOME).filter((x) => !(F.WORK || []).includes(x));
    items.push(heading('Category'));
    const setCat = (cat) => mutate('transactions', r.id, (x) => {
      x.category = cat;
    }, 'Changed the category of ' + quote(r.description) + ' to ' + cat, 'Category: ' + cat);
    if (linked) items.push({ icon: 'tag', label: r.category, hint: 'It’s counted as work money, so I’ve left its category alone', checked: true, disabled: true, onClick: () => {} });
    else {
      for (const cat of cats) items.push({ icon: 'tag', label: cat, checked: r.category === cat, disabled: r.category === cat, onClick: () => setCat(cat) });
    }
    const accts = store.state.accounts || [];
    if (accts.length > 1) {
      items.push(sep);
      items.push(heading('Account'));
      for (const a of accts) {
        items.push({ icon: 'bank', label: a.name, checked: r.account === a.id, disabled: r.account === a.id, onClick: () => mutate('transactions', r.id, (x) => {
          x.account = a.id;
        }, 'Moved ' + quote(r.description) + ' to ' + quote(a.name), 'Moved to ' + quote(a.name)) });
      }
    }
    return items;
  }

  /* Notes: any Work page, or a folder on it. */
  function notePlaces(r) {
    const s = store.state;
    const L = GU.work.labelOf;
    const areas = [{ area: 'general', folder: '', label: 'Overview' }, { area: 'requests', folder: '', label: L('requests') }];
    for (const a of GU.work.AREAS) {
      areas.push({ area: a.id, folder: '', label: L(a.id) });
      for (const f of GU.work.foldersOf(s, a.id)) areas.push({ area: a.id, folder: f.id, label: L(a.id) + ' › ' + f.name });
    }
    const cur = (o) => (r.area || 'general') === o.area && (r.folder || '') === o.folder;
    return [heading('Page')].concat(areas.map((o) => ({ icon: o.folder ? 'folder' : 'list', label: o.label, checked: cur(o), disabled: cur(o), onClick: () => mutate('workNotes', r.id, (x) => {
      Object.assign(x, { area: o.area, folder: o.folder, updated: today() });
    }, 'Moved ' + quote(r.title) + ' to ' + quote(o.label), 'Moved to ' + quote(o.label)) })));
  }

  /* Home to Work, and back. */
  function paperPlaces(r) {
    const W = wm();
    const items = [];
    if (!W) return items;
    const lane = W.lane(r, 'paperwork');
    items.push(heading('Where'));
    items.push({ icon: 'home', label: 'Home', hint: lane === 'home' ? 'Your own receipts' : 'Not for work', checked: lane === 'home', disabled: lane === 'home', onClick: () => W.moveToHome('paperwork', r.id) });
    items.push({ icon: 'coin', label: 'Work: I paid, get it back', hint: 'Goes to Get paid back', checked: lane === 'back', disabled: lane === 'back', onClick: () => W.setPayer('paperwork', r.id, 'me') });
    const paidBack = lane === 'back' && W.stage(r) === 'paid-back';
    items.push({ icon: 'briefcase', label: 'Work: ' + paysLabel(), hint: paidBack ? 'It’s already paid back' : co(true) + ' paid or will pay', checked: lane === 'ktk', disabled: lane === 'ktk' || paidBack, onClick: () => W.setPayer('paperwork', r.id, 'company') });
    if (!isWorkPaper(r)) {
      const kinds = [['receipt', 'Receipt'], ['invoice-in', 'Invoice I need to pay'], ['invoice-out', 'Invoice I’ve sent'], ['warranty', 'Warranty']];
      items.push(sep);
      items.push(heading('Kind'));
      for (const [k, label] of kinds) {
        items.push({ icon: 'receipt', label, checked: r.kind === k, disabled: r.kind === k, onClick: () => mutate('paperwork', r.id, (x) => {
          const prev = copyOf(x);
          x.kind = k;
          if (k !== 'invoice-in' && k !== 'invoice-out') {
            x.status = '';
            x.dueDate = '';
          } else if (!x.status) x.status = 'unpaid';
          if (W.normalise) W.normalise(x, prev);
        }, 'Changed ' + quote(r.title) + ' to ' + label.toLowerCase(), 'Now: ' + label.toLowerCase()) });
      }
    } else if (lane === 'ktk' || lane === 'unsorted') items.push(sep, ...folderItems('paperwork', r));
    return items;
  }
  function billPlaces(r) {
    const W = wm();
    const items = [];
    const work = parts().isWorkBill(r);
    const payer = work && W ? W.payerOf(r, 'bills') : '';
    items.push(heading('Where'));
    items.push({ icon: 'home', label: 'Home', hint: work ? 'Not for work' : 'Your own bills', checked: !work, disabled: !work, onClick: () => W.moveToHome('bills', r.id) });
    const toWork = (who) => {
      if (work) return W.setPayer('bills', r.id, who);
      const text = 'Moved ' + quote(r.name) + ' to Work';
      act(text, () => store.commit((s) => {
        const x = s.bills.find((y) => y.id === r.id);
        if (!x) return;
        x.context = 'work';
        x.payer = who;
        x.category = GU.finance.WORK_OUT || 'Work expenses';
        if (who === 'me' && W.billClaims) W.billClaims(s);
      }, { label: text }), text);
    };
    items.push({ icon: 'coin', label: 'Work: comes out of my account', hint: co(true) + ' pays me back', checked: work && payer === 'me', disabled: work && payer === 'me', onClick: () => toWork('me') });
    items.push({ icon: 'briefcase', label: 'Work: ' + co() + ' pays it', hint: 'Not from your account', checked: work && payer === 'company', disabled: work && payer === 'company', onClick: () => toWork('company') });
    if (work) items.push(sep, ...folderItems('bills', r));
    return items;
  }
  function docPlaces(r) {
    const work = parts().isWorkDoc(r);
    const T = (GU.tabs.documents && GU.tabs.documents.TYPES) || [];
    const items = [heading('Where')];
    items.push({ icon: 'home', label: 'Home', checked: !work, disabled: !work, onClick: () => GU.work.takeOut('documents', r.id) });
    items.push({ icon: 'briefcase', label: 'Work', hint: co(true) + '’s contracts and documents', checked: work, disabled: work, onClick: () => mutate('documents', r.id, (x) => {
      x.context = 'work';
      if (!x.type || x.type === 'Other') x.type = GU.work.CONTRACT;
    }, 'Moved ' + quote(r.title) + ' to Work', 'Moved ' + quote(r.title) + ' to Work') });
    items.push(sep, heading('Type'));
    for (const t of T) items.push({ icon: 'folder', label: t, checked: r.type === t, disabled: r.type === t, onClick: () => mutate('documents', r.id, (x) => {
      x.type = t;
    }, 'Moved ' + quote(r.title) + ' to ' + t, 'Moved to ' + t) });
    if (work) items.push(sep, ...folderItems('documents', r));
    return items;
  }
  function projectPlaces(r) {
    const home = parts().isHomeProject(r);
    const items = [heading('Where')];
    items.push({ icon: 'home', label: 'Home', hint: 'Home › To-do › Projects', checked: home, disabled: home, onClick: () => GU.work.moveProject(r.id, 'home') });
    items.push({ icon: 'briefcase', label: 'Work', hint: 'Work › Jobs › Projects', checked: !home, disabled: !home, onClick: () => GU.work.moveProject(r.id, 'work') });
    if (!home) items.push(sep, ...folderItems('projects', r));
    return items;
  }
  function ideaPlaces(r) {
    const home = parts().ideaPart(r) === 'home';
    const items = [heading('Where')];
    items.push({ icon: 'home', label: 'Home', hint: 'Plans', checked: home, disabled: home, onClick: () => GU.work.takeOut('costIdeas', r.id) });
    items.push({ icon: 'briefcase', label: 'Work', hint: 'Adds it to To buy', checked: !home, disabled: !home || !GU.costs.isOpen(r), onClick: () => GU.requests.addIdeas([r.id]) });
    return items;
  }

  /* The places a record can go, as menu items, or [] when it has nowhere else to go. */
  function placesFor(c, r, anchor) {
    switch (c) {
      case 'paperwork': return paperPlaces(r);
      case 'bills': return billPlaces(r);
      case 'documents': return docPlaces(r);
      case 'tasks': {
        const items = taskHomeWork(r);
        if (parts().isWorkTask(store.state, r)) items.push(sep, ...folderItems('tasks', r));
        return items;
      }
      case 'projects': return projectPlaces(r);
      case 'costIdeas': return ideaPlaces(r);
      case 'sectionItems': return itemPlaces(r, anchor);
      case 'transactions': return txPlaces(r);
      case 'workNotes': return notePlaces(r);
      default: return [];
    }
  }
  const NO_MOVE = ['debts', 'incomeSources', 'requests', 'visas'];

  /* ---------- the menu ---------- */
  /* extras: page-specific menu items (Mark paid, Done…), shown after the standard ones and before Delete. */
  function itemMenu(anchor, c, id, extras) {
    const r = rec(c, id);
    if (!r || !CFG[c]) return;
    const open = () => GU.view.open({ c, id });
    const hasFiles = (r.files || []).some((f) => f && f.id);
    const copyWhy = whyNotCopy(c, r);
    const items = [
      { icon: 'edit', label: 'Open', onClick: open },
      { icon: 'edit', label: 'Rename', onClick: () => rename(c, id) },
    ];
    if (!NO_MOVE.includes(c)) items.push({ icon: 'move', label: 'Move to…', hint: 'Another place', onClick: () => setTimeout(() => {
      const fresh = rec(c, id);
      const places = fresh ? placesFor(c, fresh, anchor) : [];
      if (!places.length) return GU.ui.toast('There’s nowhere else to move this.');
      GU.ui.menu(anchor, [heading('Move ' + clip(nameOf(c, fresh), 30) + ' to')].concat(places));
    }, 30) });
    items.push({ icon: 'copy', label: 'Duplicate', hint: copyWhy || 'Files are shared, not copied', disabled: !!copyWhy, onClick: () => duplicate(c, id) });
    items.push({ icon: 'download', label: 'Download', hint: hasFiles ? (r.files.length > 1 ? 'All ' + r.files.length + ' files, zipped' : 'The file') : 'As a one-row spreadsheet', onClick: () => download(c, id) });
    const more = (extras || []).filter(Boolean);
    if (more.length) items.push(sep, ...more);
    items.push(sep, { icon: 'trash', label: 'Delete', hint: 'You can undo it', danger: true, onClick: () => remove(c, id) });
    GU.ui.menu(anchor, items);
  }

  /* The ⋯ button for a row. ctx: a word the page's extras can look at. */
  function moreBtn(c, id, label, ctx) {
    const r = rec(c, id);
    const name = label || (r ? nameOf(c, r) : '');
    return '<button type="button" class="icon-btn organise-more" data-organise="' + esc(c + '|' + id + (ctx ? '|' + ctx : '')) + '" aria-haspopup="menu" aria-label="More for ' + esc(name) + '" data-tip="More">' + icon('more') + '</button>';
  }
  /* Pages put their own actions here: extras[collection] = (record, ctx) => [menu items]. */
  const extras = {};
  document.addEventListener('click', (e) => {
    const b = e.target.closest && e.target.closest('[data-organise]');
    if (!b) return;
    e.preventDefault();
    e.stopPropagation();
    const [c, id, ctx] = b.getAttribute('data-organise').split('|');
    const r = rec(c, id);
    if (!r) return;
    itemMenu(b, c, id, extras[c] ? extras[c](r, ctx) : []);
  }, true);

  /* ---------- containers: your own categories ---------- */
  /* The same menu for a category (a page in your menu): Open, Rename, Move to… (Home or Work), Duplicate, Download
     (everything in it, zipped), Delete. */
  async function renameSection(id) {
    const sec = (store.state.sections || []).find((x) => x.id === id);
    if (!sec) return;
    const v = await ask({ title: 'Rename category', label: 'Name', value: sec.name, submit: 'Rename' });
    if (v == null || v === sec.name) return;
    act('Renamed the category ' + quote(sec.name) + ' to ' + quote(v), () => store.commit((s) => {
      const x = s.sections.find((y) => y.id === id);
      if (x) {
        x.name = v;
        x.icon = GU.sections.iconFor(v);
      }
    }, { label: 'Renamed the category ' + quote(sec.name) + ' to ' + quote(v) }), 'Renamed to ' + quote(v));
  }
  function moveSectionTo(id, part) {
    const sec = (store.state.sections || []).find((x) => x.id === id);
    if (!sec || GU.sections.partOf(sec) === part) return;
    const text = 'Moved the category ' + quote(sec.name) + ' to ' + (part === 'work' ? 'Work' : 'Home');
    act(text, () => store.commit((s) => {
      const x = s.sections.find((y) => y.id === id);
      if (x) x.part = part;
    }, { label: text }), text);
  }
  function duplicateSection(id) {
    const sec = (store.state.sections || []).find((x) => x.id === id);
    if (!sec) return;
    const nid = 's' + uid();
    const text = 'Duplicated the category ' + quote(sec.name);
    act(text, () => store.commit((s) => {
      const n = copyOf(sec);
      n.id = nid;
      n.name = copyName(sec, 'name');
      n.created = today();
      delete n.order;
      delete n.hidden;
      delete n.byAssistant;
      s.sections.push(n);
      for (const it of s.sectionItems.filter((x) => x.sectionId === id).map(copyOf)) {
        it.id = 'si-' + uid();
        it.sectionId = nid;
        s.sectionItems.push(it);
      }
    }, { label: text }), 'Made ' + quote(copyName(sec, 'name')));
  }
  /* Everything in a category: its things as a spreadsheet, and every file in a folder named for its group. */
  async function downloadSection(id) {
    const sec = (store.state.sections || []).find((x) => x.id === id);
    if (!sec) return false;
    const items = store.state.sectionItems.filter((x) => x.sectionId === id);
    const head = ['Title', 'Group', 'From or with', 'Date', 'Amount', 'Remind on', 'Reference', 'Notes', 'Files'];
    const rows = items.map((x) => [x.title || '', x.group || '', x.party || '', x.date || '', x.amount != null && x.amount !== '' ? Number(x.amount) : '', x.dueDate || '', x.reference || '', x.notes || '', (x.files || []).map((f) => f.name).join('; ')]);
    const entries = [{ name: fileSafe(sec.name) + '.csv', blob: new Blob([csvText([head].concat(rows))], { type: 'text/csv;charset=utf-8' }) }];
    let missing = 0;
    for (const it of items) {
      for (const f of it.files || []) {
        const r = f && f.id ? await GU.files.get(f.id) : null;
        if (!r || !r.blob) {
          missing++;
          continue;
        }
        entries.push({ name: (it.group ? fileSafe(it.group) + '/' : '') + fileSafe(it.title) + ' - ' + fileSafe(f.name), blob: r.blob });
      }
    }
    if (missing) GU.ui.toast(plural(missing, 'file') + ' isn’t on this device yet, so it’s left out.');
    return GU.ui.saveFile(await GU.ui.makeZip(entries), fileSafe(sec.name) + '.zip');
  }
  function containerMenu(anchor, kind, id) {
    if (kind !== 'sections') return;
    const sec = (store.state.sections || []).find((x) => x.id === id);
    if (!sec) return;
    const part = GU.sections.partOf(sec);
    const n = store.state.sectionItems.filter((x) => x.sectionId === id).length;
    GU.ui.menu(anchor, [
      { icon: 'edit', label: 'Open', onClick: () => GU.view.go('s-' + id) },
      { icon: 'edit', label: 'Rename', onClick: () => renameSection(id) },
      { icon: 'move', label: 'Move to…', hint: 'Home or Work', onClick: () => setTimeout(() => GU.ui.menu(anchor, [
        heading('Move ' + clip(sec.name, 30) + ' to'),
        { icon: 'home', label: 'Home', checked: part === 'home', disabled: part === 'home', onClick: () => moveSectionTo(id, 'home') },
        { icon: 'briefcase', label: 'Work', hint: co(true) + '’s categories', checked: part === 'work', disabled: part === 'work', onClick: () => moveSectionTo(id, 'work') },
      ]), 30) },
      { icon: 'copy', label: 'Duplicate', hint: 'With ' + plural(n, 'thing') + ' in it', onClick: () => duplicateSection(id) },
      { icon: 'download', label: 'Download', hint: 'Everything in it, zipped', onClick: () => downloadSection(id) },
      sep,
      { icon: 'trash', label: 'Delete', hint: 'You can undo it', danger: true, onClick: () => GU.sections.deleteSection(id) },
    ]);
  }

  /* ---------- rows that come from somewhere else (read only) ---------- */
  /* A row that isn't a record of its own (an instalment from a debt's payment schedule): the same menu, with what
     can't be done greyed out and why, so it looks like every other row. rows: [{head, row}] for Download. */
  const readOnly = {};
  function readOnlyBtn(kind, key, label) {
    return '<button type="button" class="icon-btn organise-more inst__more" data-organise-ro="' + esc(kind + '|' + key) + '" aria-haspopup="menu" aria-label="' + esc(label || 'More') + '" data-tip="More">' + icon('more') + '</button>';
  }
  document.addEventListener('click', (e) => {
    const b = e.target.closest && e.target.closest('[data-organise-ro]');
    if (!b) return;
    e.preventDefault();
    e.stopPropagation();
    const at = b.getAttribute('data-organise-ro');
    const kind = at.split('|')[0];
    const spec = readOnly[kind] && readOnly[kind](at.slice(kind.length + 1));
    if (!spec) return;
    const why = spec.why || 'It comes from somewhere else';
    const off = (label, ico) => ({ icon: ico, label, hint: why, disabled: true, onClick: () => {} });
    GU.ui.menu(b, [
      { icon: 'edit', label: 'Open', hint: spec.openHint, onClick: spec.open },
      off('Rename', 'edit'), off('Move to…', 'move'), off('Duplicate', 'copy'),
      { icon: 'download', label: 'Download', hint: 'As a one-row spreadsheet', onClick: () => saveCSV([spec.head, spec.row], spec.name) },
      sep, Object.assign(off('Delete', 'trash'), { danger: true }),
    ]);
  }, true);

  /* ---------- download a list as a spreadsheet ---------- */
  /* lists[kind] = () => ({name, head: [...], rows: [[...]]}) for what the page is showing now. */
  const lists = {};
  function listButton(kind, label) {
    return '<button type="button" class="btn" data-download-list="' + esc(kind) + '">' + icon('download') + esc(label || 'Download list (CSV)') + '</button>';
  }
  async function downloadList(kind) {
    const f = lists[kind];
    if (!f) return false;
    const d = f();
    if (!d || !d.rows) return false;
    if (!d.rows.length) {
      GU.ui.toast('There’s nothing in this list to download.');
      return false;
    }
    const ok = await saveCSV([d.head].concat(d.rows), (d.name || kind) + ' ' + today());
    if (ok) GU.ui.toast('Saved ' + plural(d.rows.length, 'row') + ' as a spreadsheet');
    return ok;
  }
  document.addEventListener('click', (e) => {
    const b = e.target.closest && e.target.closest('[data-download-list]');
    if (!b) return;
    e.preventDefault();
    if (b.disabled) return;
    b.disabled = true;
    downloadList(b.getAttribute('data-download-list')).finally(() => (b.disabled = false));
  }, true);

  GU.organise = {
    CFG, itemMenu, moreBtn, readOnlyBtn, readOnly, extras, lists, listButton, downloadList, csvCell, csvText, saveCSV,
    containerMenu, renameSection, moveSectionTo, duplicateSection, downloadSection,
    rename, duplicate, remove, download, placesFor, ask, act, mutate, folderItems, groupsIn, nameOf, quote,
  };
})();
