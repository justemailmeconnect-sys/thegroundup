/* The Ground Up: Inbox. Throw anything here: photos, PDFs, screenshots, pasted emails, quick notes.
   The assistant reads each one, files it where it belongs (or starts a new section),
   and keeps anything it isn't sure about here for you to check. */
(function () {
  'use strict';
  const GU = window.GU;
  const { esc, uid, today, money, fmtDate, plural } = GU.util;
  const { icon, pill, emptyState, toast, thumbHTML, viewFiles, formDialog, menu } = GU.ui;
  const store = GU.store;

  const AUTO_FILE_AT = 0.75;
  const WORK_OUT = (GU.finance && GU.finance.WORK_OUT) || 'Work expenses';
  const PAYSLIPS = 'Employment and payslips';
  const undoers = new Map();
  let running = false;
  let modeCache = 'offline';

  /* ---------- Home or Work ---------- */
  const parts = () => GU.parts || null;
  const inWork = () => !!(parts() && parts().get() === 'work');
  const co = (cap) => (parts() ? parts().co(store.state, cap) : cap ? 'The company' : 'the company');
  const WORK_SCOPE = () => ({ kind: 'work', area: null, name: 'Work' });
  /* Work receipts and invoices that are still waiting for 'whose money paid?'. */
  const asksPayer = (r) => !!(r && GU.brain.asksPayer(r) && r.payer !== 'me' && r.payer !== 'company');
  /* Whose money a Work page means: drops on Get paid back are yours, drops on the company's page are its. */
  function scopePayer(sc) {
    if (!sc || sc.kind !== 'work') return null;
    if (sc.payer === 'me' || sc.payer === 'company') return sc.payer;
    return sc.area === 'back' ? 'me' : sc.area === 'invoices' ? 'company' : null;
  }
  /* Where something added without a place of its own goes. In Work it's for work (notes too), unless ctx says Home. */
  function scopeFor(input) {
    if (input.scope) return input.scope;
    if (input.ctx === 'work' || (input.ctx !== 'home' && inWork())) return WORK_SCOPE();
    return null;
  }
  /* In Work, a labelled folder keeps its own place only when that isn't work paperwork: statements still go to
     the importer, and visa, debt and payslip folders are always yours. Everything else is filed for work. */
  function workLabel(p, workScope) {
    const l = p.label;
    if (!l) return { scope: workScope, sub: p.sub };
    if (['statements', 'visa', 'debts'].includes(l.kind) || (l.kind === 'documents' && l.docType === PAYSLIPS)) return { scope: l, sub: p.sub };
    if (l.kind === 'section') {
      const sec = l.sectionId && (store.state.sections || []).find((x) => x.id === l.sectionId);
      if (sec && sec.part === 'work') return { scope: l, sub: p.sub };
    }
    const sc = Object.assign({}, workScope, { name: workScope.name + ' › ' + l.name });
    if (l.kind === 'paperwork') sc.paperKind = l.paperKind;
    else if (l.kind === 'documents') sc.area = 'contracts';
    return { scope: sc, sub: l.kind === 'section' ? [l.name, p.sub].filter(Boolean).join(' › ') : p.sub };
  }

  /* ---------- queue ---------- */
  /* input: {files, note, scope, ctx}. scope: where it was added (a section, a Work page…). ctx: 'home' or 'work'
     when the caller knows; otherwise the part you're in decides. */
  async function add(input) {
    const files = input.files || [];
    const note = (input.note || '').trim();
    if (!files.length && !note) return;
    const ctx = input.ctx === 'home' || input.ctx === 'work' ? input.ctx : null;
    const scope = scopeFor(input);

    // Quick notes ("call the dentist tomorrow", "paid £18 for printer paper") are filed instantly without waiting for Claude.
    if (!files.length) {
      const quick = await GU.brain.quick(note).catch(() => null);
      if (quick && quick.destination === 'order_history') return GU.tabs.receipts.importOrders(note, orderPreset(scope));
      if (quick && quick.confidence >= 0.8 && (['task', 'transaction_out', 'transaction_in'].includes(quick.destination) || (quick.destination === 'receipt' && quick.payer))) {
        const result = scope ? applyScope(quick, scope, '', ctx, '') : quick;
        if (!asksPayer(result)) {
          fileItem({ id: 'in-' + uid(), created: today(), note, files: [], scope }, result);
          return;
        }
      }
      const item = { id: 'in-' + uid(), created: today(), note, files: [], status: 'reading', scope, ctx };
      store.commit((s) => s.inbox.push(item));
      return pump();
    }
    // Your own folders decide where things go (Car → Car, Passports → Important documents, Bank statements → importer).
    let work = files.map((f) => ({ file: f, scope, sub: input.scope ? GU.folders.subPath(f) : '', ctx, root: GU.ui.pathOf(f).includes('/') ? GU.ui.pathOf(f).split('/')[0] : '' }));
    if (scope && scope.kind === 'paperwork') work.forEach((w) => (w.ctx = ctx || (GU.folders.plan([w.file])[0] || {}).context));
    if (!input.scope) {
      // In Work, anything without a place of its own is for work.
      work = GU.folders.plan(files).map((p) => (scope ? Object.assign({ file: p.file, ctx }, workLabel(p, scope)) : { file: p.file, scope: p.label, sub: p.sub, ctx: ctx || p.context }));
      const statements = work.filter((w) => w.scope && w.scope.kind === 'statements').map((w) => w.file);
      if (statements.length) {
        GU.tabs.transactions.importStatement(statements);
        work = work.filter((w) => !(w.scope && w.scope.kind === 'statements'));
      }
    }
    // Files for a visa application are attached straight away; nothing needs reading.
    const visaWork = work.filter((w) => w.scope && w.scope.kind === 'visa');
    if (visaWork.length) {
      await attachToVisas(visaWork);
      work = work.filter((w) => !(w.scope && w.scope.kind === 'visa'));
    }
    if (!work.length) return;
    const labels = Array.from(new Set(work.filter((w) => w.scope).map((w) => w.scope.name || '').filter(Boolean)));
    const from = GU.ui.folderSummary(work.map((w) => w.file));
    if (work.length > 1 || from) {
      readingToast = toast('Reading ' + plural(work.length, 'file') + (labels.length ? ' into ' + labels.slice(0, 3).join(', ') + (labels.length > 3 ? ' and ' + (labels.length - 3) + ' more' : '') : from ? ' from ' + from : '') + '. I’ll tell you when they’re filed.', { timeout: 60000 });
    }
    let chunk = [];
    const flush = () => {
      const items = chunk;
      chunk = [];
      if (items.length) store.commit((s) => s.inbox.push(...items));
      pump();
    };
    for (const w of work) {
      const meta = await GU.files.add(w.file);
      const path = GU.ui.pathOf(w.file);
      if (path !== meta.name) meta.path = path;
      chunk.push({ id: 'in-' + uid(), created: today(), note, files: [meta], status: 'reading', scope: w.scope || null, sub: w.sub || '', ctx: w.ctx || null, root: w.root || '' });
      if (chunk.length >= 20) flush();
    }
    flush();
  }

  async function attachToVisas(list) {
    const groups = new Map();
    for (const w of list) {
      let id = w.scope.visaId || (store.state.visas.find((v) => v.visaType.toLowerCase() === String(w.scope.name).toLowerCase()) || {}).id;
      if (!id) {
        id = 'v-' + uid();
        store.commit((s) => s.visas.push({ id, created: today(), visaType: w.scope.name, country: '', applicant: 'Me', status: 'Planning', checklist: [],
          log: [{ id: uid(), date: today(), text: 'Started from your “' + w.scope.name + '” folder' }], files: [] }));
      }
      w.scope.visaId = id;
      if (!groups.has(id)) groups.set(id, []);
      groups.get(id).push(await GU.files.add(w.file));
    }
    for (const [id, metas] of groups) GU.tabs.visas.attach(id, metas, 'Added ' + plural(metas.length, 'file') + ' from your folders: ' + metas.slice(0, 3).map((m) => m.name).join(', ') + (metas.length > 3 ? '…' : ''));
    const v = store.find('visas', groups.keys().next().value);
    toast('Added ' + plural(list.length, 'file') + ' to ' + (groups.size > 1 ? groups.size + ' visa applications' : (v ? v.visaType : 'your visa application')));
  }

  /* A file you put in a section (or a labelled folder) stays there: the reading only fills in the details. */
  function applyScope(r, scope, sub, ctx, root) {
    const out = Object.assign({}, r, { confidence: 1, scoped: true, folder: sub || '' });
    const unclear = r.destination === 'unsure' || r.confidence < 0.5;
    const fileTitle = (r._fileName || '').replace(/\.[a-z0-9]+$/i, '').replace(/[_-]+/g, ' ').trim();
    if (unclear && fileTitle) out.title = fileTitle;
    const paper = ['receipt', 'invoice_to_pay', 'invoice_owed_to_me', 'warranty'];
    if (scope.kind === 'paperwork') {
      if (scope.paperKind === 'warranty') out.destination = 'warranty';
      else if (scope.paperKind === 'receipt') out.destination = 'receipt';
      else if (scope.paperKind === 'invoice') out.destination = ['invoice_to_pay', 'invoice_owed_to_me'].includes(r.destination) ? r.destination : 'invoice_to_pay';
      else out.destination = paper.includes(r.destination) ? r.destination : 'receipt';
      if (/paid/i.test(scope.name || '') || /\bpaid\b/i.test(sub || '')) out.paid = true;
      if (ctx) out.context = ctx;
    } else if (scope.kind === 'documents') {
      out.destination = 'document';
      // Your folder names first (Passports, Insurance…), then what the document itself says, then a Car/Van folder.
      const named = GU.folders.DOC_TYPES.find(([re]) => re.test(sub || '')) || GU.folders.DOC_TYPES.find(([re]) => re.test(root || ''));
      const own = r.destination === 'document' && r.document_type && r.document_type !== 'Other' ? r.document_type : null;
      out.document_type = (named && named[1]) || scope.docType || own || (/\b(car|van|motorbike|motorcycle)\b/i.test(root + ' ' + sub) ? 'Vehicle' : 'Other');
    } else if (scope.kind === 'bills') {
      out.destination = 'bill';
    } else if (scope.kind === 'debts') {
      // A card's own transaction export still goes to the statement importer.
      if (r.destination !== 'bank_statement') out.destination = 'debt';
    } else if (scope.kind === 'work') {
      // Added in Work: it's for work, and the page you were on decides what kind of thing it is and whose money paid.
      out.context = 'work';
      // A bank statement or an order list still opens its importer, whichever Work page it was dropped on.
      if (['bank_statement', 'order_history'].includes(r.destination)) out.destination = r.destination;
      else if (scope.area === 'invoices') out.destination = paper.includes(r.destination) && r.destination !== 'invoice_owed_to_me' ? r.destination : 'invoice_to_pay';
      else if (scope.area === 'back') {
        // Things you paid for: a receipt, or an invoice you've paid.
        out.destination = r.destination === 'invoice_to_pay' ? 'invoice_to_pay' : 'receipt';
        if (out.destination === 'invoice_to_pay') out.paid = true;
      } else if (scope.area === 'bills') out.destination = 'bill';
      else if (scope.area === 'contracts') {
        out.destination = 'document';
        out.document_type = (GU.work && GU.work.CONTRACT) || 'Other';
      } else if (scope.paperKind) {
        // A Receipts or Invoices folder dropped in Work.
        if (scope.paperKind === 'warranty') out.destination = 'warranty';
        else if (scope.paperKind === 'receipt') out.destination = 'receipt';
        else out.destination = ['invoice_to_pay', 'invoice_owed_to_me'].includes(r.destination) ? r.destination : 'invoice_to_pay';
        if (/paid/i.test(scope.name || '') || /\bpaid\b/i.test(sub || '')) out.paid = true;
      } else if (unclear && r._fileName) out.destination = 'document';
      // Otherwise it keeps what it was read as, and whose money paid if that could be told.
      GU.brain.workSense(out);
      const payer = scopePayer(scope);
      if (payer && (paper.includes(out.destination) || out.destination === 'bill')) out.payer = payer;
      if (out.destination === 'unsure') out.confidence = r.confidence; // a note I couldn't place still waits for you
      out.summary = (r.destination === 'unsure' ? out.title : out.summary || out.title) + ' (added in ' + scope.name + ')';
      return out;
    } else if (scope.kind === 'section') {
      out.destination = 'section';
      const sec = scope.sectionId ? store.state.sections.find((x) => x.id === scope.sectionId) : store.state.sections.find((x) => x.name.toLowerCase() === String(scope.name || '').toLowerCase());
      out.section_id = sec ? sec.id : null;
      out.new_section_name = sec ? null : scope.name;
      out.group = sub || '';
    }
    out.summary = (r.destination === 'unsure' ? out.title : r.summary || out.title) + (scope.name ? ' (from your “' + scope.name + '” folder)' : '');
    return out;
  }

  const batch = { filed: 0, waiting: 0, seen: 0 };
  let readingToast = null;
  async function pump() {
    if (running) return;
    running = true;
    Object.assign(batch, { filed: 0, waiting: 0, seen: 0 });
    try {
      let next;
      while ((next = store.state.inbox.find((i) => i.status === 'reading'))) {
        const id = next.id;
        let result = null;
        let error = '';
        try {
          const blobs = [];
          for (const m of next.files) {
            const rec = await GU.files.get(m.id);
            if (rec && rec.blob) blobs.push(new File([rec.blob], m.name, { type: m.type }));
          }
          result = await GU.brain.analyse({ files: blobs, note: next.note, paths: next.files.map((m) => m.path || m.name) });
          if (next.scope && result) result = applyScope(Object.assign(result, { _fileName: (next.files[0] || {}).name }), next.scope, next.sub, next.ctx, next.root);
        } catch (e) {
          console.warn('[inbox] analyse failed', e);
          error = 'I couldn’t read this one. Pick where it goes.';
        }
        const item = store.state.inbox.find((i) => i.id === id);
        if (!item) continue;
        store.commit(() => {
          item.status = result ? 'ready' : 'error';
          item.result = result || null;
          item.error = error;
        });
        batch.seen++;
        const quiet = batch.seen > 1 || store.state.inbox.some((i) => i.status === 'reading');
        if (settle(item, quiet)) batch.filed++;
        else batch.waiting++;
      }
    } finally {
      running = false;
    }
    if (readingToast) {
      readingToast();
      readingToast = null;
    }
    if (batch.seen > 1) {
      const msg = 'Filed ' + plural(batch.filed, 'item') + (batch.waiting ? '. ' + batch.waiting + ' need' + (batch.waiting === 1 ? 's' : '') + ' a quick check.' : '.');
      toast(msg, batch.waiting && location.hash !== '#inbox' ? { action: 'Review', onAction: () => GU.view.go('inbox') } : {});
    }
  }

  /* Returns true when the item was filed automatically. Work receipts and invoices are never filed while
     nobody knows whose money paid, unless your bank shows you paid it. */
  function settle(item, quiet) {
    const r = item.result;
    if (!r) return false;
    if (asksPayer(r)) {
      const who = GU.brain.payerFor(r);
      if (who) store.commit(() => (r.payer = who));
    }
    const ask = asksPayer(r);
    if (!ask && item.scope && r.scoped && r.destination !== 'unsure') {
      fileItem(item, r, { quiet });
      return true;
    }
    const auto = store.state.settings.autoFile !== false;
    if (!ask && auto && r.confidence >= AUTO_FILE_AT && !['unsure', 'bank_statement', 'order_history'].includes(r.destination)) {
      fileItem(item, r, { quiet });
      return true;
    }
    // A single spreadsheet opens its importer straight away (you still confirm there).
    if (!quiet && ['bank_statement', 'order_history'].includes(r.destination)) {
      fileItem(item, r);
      return true;
    }
    if (!quiet && location.hash !== '#inbox') {
      toast(ask ? 'Whose money paid for ' + (r.title || 'this') + '? Answer in your Inbox.' : 'Something needs a quick check in your Inbox', { action: ask ? 'Answer' : 'Review', onAction: () => GU.view.go('inbox') });
    }
    return false;
  }

  /* Files an inbox item using a (possibly edited) result. */
  function fileItem(item, result, opts) {
    if (result.destination === 'bank_statement') return openImporter(item);
    if (result.destination === 'order_history') return openOrders(item);
    const res = GU.brain.file(result, item.files || [], item.note);
    if (!res) return;
    if (res.ref) workTag(item, res.ref.c, res.ref.id);
    const logId = 'log-' + uid();
    store.commit((s) => {
      s.inbox = s.inbox.filter((i) => i.id !== item.id);
      s.filedLog.unshift({ id: logId, date: today(), summary: result.summary || result.title, title: result.title, label: res.label, tab: res.tab, ref: res.ref, via: result.via, files: (item.files || []).length });
      s.filedLog = s.filedLog.slice(0, 40);
    });
    const restore = Object.assign({}, item, { status: 'ready', result });
    undoers.set(logId, () => {
      res.undo();
      store.commit((s) => {
        s.filedLog = s.filedLog.filter((l) => l.id !== logId);
        s.inbox.push(restore);
      });
      undoers.delete(logId);
    });
    if (!(opts && opts.quiet)) toast('Filed in ' + res.label + ': ' + (result.title || ''), { action: 'Undo', onAction: () => undoers.get(logId) && undoers.get(logId)() });
  }

  /* Answers 'whose money paid?' for work receipts and invoices, then files them. */
  function answerPayer(ids, payer) {
    const items = store.state.inbox.filter((i) => ids.includes(i.id) && i.result);
    items.forEach((it) => fileItem(it, Object.assign({}, it.result, { payer, context: 'work' }), { quiet: items.length > 1 }));
    if (items.length > 1) toast('Filed ' + plural(items.length, 'item') + ' in ' + (payer === 'me' ? 'Get paid back' : parts() ? parts().paysLabel(store.state) : 'Work') + '. Each one can be undone from Filed recently.');
  }

  /* Files every item that has a suggestion, in one go (not the ones waiting for 'whose money paid?'). */
  function fileAll() {
    const items = store.state.inbox.filter((i) => i.status !== 'reading' && i.result && !['unsure', 'bank_statement', 'order_history'].includes(i.result.destination) && !asksPayer(i.result));
    let n = 0;
    for (const it of items) {
      const live = store.state.inbox.find((x) => x.id === it.id);
      if (!live) continue;
      fileItem(live, live.result, { quiet: true });
      n++;
    }
    toast('Filed ' + plural(n, 'item') + '. Each one can be undone from Filed recently.');
  }

  async function importAllStatements() {
    const items = store.state.inbox.filter((i) => i.result && i.result.destination === 'bank_statement');
    const files = [];
    for (const it of items) {
      const m = (it.files || [])[0];
      const rec = m && (await GU.files.get(m.id));
      if (rec) files.push(new File([rec.blob], m.name, { type: m.type }));
    }
    items.forEach((it) => discard(it.id, true));
    if (files.length) GU.tabs.transactions.importStatement(files);
  }

  /* Orders dropped in Work are for work: yours to get back on Get paid back, otherwise on the company's card. */
  const orderPreset = (sc) => (sc && sc.kind === 'work' ? { context: 'work', payer: scopePayer(sc) || 'company' } : undefined);
  async function openOrders(item) {
    const m = (item.files || [])[0];
    const rec = m && (await GU.files.get(m.id));
    if (!rec) return toast('The order list is missing. Try uploading it again.');
    GU.tabs.receipts.importOrders(new File([rec.blob], m.name, { type: m.type || 'text/csv' }), orderPreset(item.scope));
    discard(item.id, true);
  }

  async function openImporter(item) {
    const m = (item.files || [])[0];
    const rec = m && (await GU.files.get(m.id));
    if (!rec) return toast('The statement file is missing. Try uploading it again.');
    GU.tabs.transactions.importCSV(new File([rec.blob], m.name, { type: m.type || 'text/csv' }));
    discard(item.id, true);
  }

  /* keepQuiet: handed on to an importer, so nothing is lost. Otherwise it goes to Recently deleted. */
  function discard(id, keepQuiet) {
    const item = store.state.inbox.find((i) => i.id === id);
    if (!item) return;
    if (keepQuiet) {
      (item.files || []).forEach((f) => GU.files.remove(f.id));
      store.commit((s) => (s.inbox = s.inbox.filter((i) => i.id !== id)));
      return;
    }
    let entry = null;
    store.commit((s) => {
      s.inbox = s.inbox.filter((i) => i.id !== id);
      entry = GU.trash.put(s, 'inbox', Object.assign({}, item, { status: 'ready' }), (item.result && item.result.title) || (item.files[0] && item.files[0].name) || 'Inbox item');
    });
    GU.trash.offerUndo(entry);
  }

  /* Something added in Work is filed as work, in the folder it was added to. A Work page that says whose money
     it is (Get paid back, the company's page) sets it, and GU.workMoney fills in the stage and legacy flags. */
  function workTag(item, c, id) {
    const sc = item.scope;
    if (!sc || sc.kind !== 'work' || !['paperwork', 'bills', 'documents', 'tasks'].includes(c)) return;
    const payer = scopePayer(sc);
    store.commit((s) => {
      const rec = (s[c] || []).find((x) => x.id === id);
      if (!rec) return;
      rec.context = 'work';
      if (sc.folderId) rec.workFolder = sc.folderId;
      if (c === 'tasks' && GU.work && GU.work.ensureWorkList) rec.listId = GU.work.ensureWorkList(s);
      if (c === 'bills') {
        rec.category = WORK_OUT;
        if (payer && !rec.payer) rec.payer = payer;
      }
      if (c === 'paperwork') {
        if (payer && !rec.payer && rec.kind !== 'invoice-out') rec.payer = payer;
        if (GU.workMoney) GU.workMoney.normalise(rec);
      }
    });
  }

  /* Opens the destination's own form, prefilled, so details can be checked before filing. */
  function editAndFile(item) {
    const r = GU.brain.workSense(Object.assign({}, item.result || {}));
    const files = item.files || [];
    const work = r.context === 'work';
    const wl = work && parts() ? parts().workListId(store.state) : null;
    const done = (rec) => {
      if (rec && rec.id) for (const c of ['paperwork', 'bills', 'documents', 'tasks']) if ((store.state[c] || []).some((x) => x.id === rec.id)) workTag(item, c, rec.id);
      store.commit((s) => {
        s.inbox = s.inbox.filter((i) => i.id !== item.id);
        s.filedLog.unshift({ id: 'log-' + uid(), date: today(), summary: r.summary || r.title, title: r.title, label: GU.brain.where(r), tab: null, ref: null, via: r.via, files: files.length });
        s.filedLog = s.filedLog.slice(0, 40);
      });
    };
    const kinds = { receipt: 'receipt', invoice_to_pay: 'invoice-in', invoice_owed_to_me: 'invoice-out', warranty: 'warranty' };
    switch (r.destination) {
      case 'receipt': case 'invoice_to_pay': case 'invoice_owed_to_me': case 'warranty':
        return GU.tabs.receipts.create({ values: Object.assign({ kind: kinds[r.destination], context: r.context, title: r.title, party: r.party, amount: r.amount, date: r.date || today(), dueDate: r.due_date,
          status: r.paid ? 'paid' : 'unpaid', warrantyUntil: r.expiry_date, reference: r.reference, category: work ? '' : r.category, notes: r.notes || item.note, files },
          work ? { payer: GU.brain.payerFor(r) || (r.payer === 'me' || r.payer === 'company' ? r.payer : '') } : {}), onSaved: done });
      case 'bill':
        return GU.tabs.bills.create(Object.assign({ name: r.title, payee: r.party, amount: r.amount, frequency: r.frequency || 'monthly', nextDue: r.due_date || r.date || today(), category: work ? WORK_OUT : r.category || 'Bills & utilities', context: r.context, notes: r.notes, files },
          work && r.payer ? { payer: r.payer } : {}), { onSaved: done });
      case 'document':
        return GU.tabs.documents.create({ title: r.title, type: r.document_type || 'Other', context: work ? 'work' : 'home', reference: r.reference, issueDate: r.date, expiryDate: r.expiry_date, notes: [r.summary, r.notes].filter(Boolean).join('\n'), files }, { onSaved: done });
      case 'visa':
        if (r.visa_id) return fileItem(item, r);
        return GU.tabs.visas.create({ visaType: r.title, reference: r.reference, notes: r.notes, files }, { onSaved: done });
      case 'task':
        return GU.tabs.todos.create(Object.assign({ title: r.title, due: r.due_date || '', notes: item.note && item.note !== r.title ? item.note : '' }, work ? Object.assign({ context: 'work' }, wl ? { listId: wl } : {}) : { context: 'home' }), { onSaved: done });
      case 'transaction_out': case 'transaction_in':
        return GU.tabs.transactions.create({ direction: r.destination === 'transaction_in' ? 'in' : 'out', description: r.party || r.title, amount: r.amount, date: r.date || today(), category: r.category, notes: r.notes }, { onSaved: done });
      case 'section':
        return GU.sections.createItem(r.section_id || { name: r.new_section_name || 'New section' }, { title: r.title, party: r.party, amount: r.amount, date: r.date, dueDate: r.due_date || r.expiry_date, reference: r.reference, notes: [r.summary, r.notes].filter(Boolean).join('\n'), files }, { onSaved: done, byAssistant: true });
      case 'debt':
        return GU.tabs.debts.create({ name: r.party || r.title, lender: r.party || '', type: r.debt_type || undefined, balance: r.amount, balanceDate: r.date || today(), monthlyPayment: r.monthly_payment,
          apr: r.interest_rate, paymentDay: r.due_date ? +r.due_date.slice(8, 10) : null, notes: [r.reference ? 'Ref ' + r.reference : '', r.notes].filter(Boolean).join('\n'), files }, { onSaved: done });
      case 'bank_statement':
        return openImporter(item);
      case 'order_history':
        return openOrders(item);
      default:
        return choosePlace(item, null);
    }
  }

  /* Makes an item yours: no 'whose money' and no Work page. Call inside a commit. */
  function toHome(item) {
    if (item.result) {
      item.result.context = 'home';
      item.result.payer = null;
    }
    if (item.scope && item.scope.kind === 'work') item.scope = null;
  }
  /* The Home / Work chip on a card: moves the item to the other part before it's filed. */
  function flipPart(item) {
    store.commit(() => {
      if (!item.result) return;
      if (item.result.context === 'work') toHome(item);
      else item.result.context = 'work';
    });
  }

  /* Lets you change where an item should go. */
  function choosePlace(item, anchor) {
    const set = (patch) => {
      store.commit(() => {
        item.result = Object.assign(item.result || { title: item.note || (item.files[0] && item.files[0].name) || 'Item', confidence: 1, context: 'home' }, patch, { confidence: 1, summary: (item.result && item.result.summary) || '' });
        item.status = 'ready';
        if (patch.context === 'home') toHome(item);
      });
    };
    const s = store.state;
    const c = co();
    const r0 = item.result || {};
    // For the company: keep a receipt or invoice as it was read, otherwise it's a receipt (yours) or an invoice (theirs).
    const forWork = (payer) => set({ context: 'work', payer, destination: ['receipt', 'invoice_to_pay'].includes(r0.destination) ? r0.destination : payer === 'me' ? 'receipt' : 'invoice_to_pay' });
    const workOpts = [
      { icon: 'coin', label: 'For ' + c + ': I paid, get it back', hint: 'Work › Get paid back', onClick: () => forWork('me') },
      { icon: 'briefcase', label: 'For ' + c + ': ' + (parts() ? parts().paysLabel(s) : 'Company pays'), hint: 'It’s ' + c + '’s money, not yours', onClick: () => forWork('company') },
    ];
    const paperOpts = [
      { icon: 'receipt', label: 'Receipt', onClick: () => set({ destination: 'receipt' }) },
      { icon: 'receipt', label: 'Invoice to pay', onClick: () => set({ destination: 'invoice_to_pay', paid: false }) },
      { icon: 'check', label: 'Paid invoice', onClick: () => set({ destination: 'invoice_to_pay', paid: true }) },
      // Someone owing you for your own side work is always yours (an invoice to the company is 'I paid, get it back').
      { icon: 'coin', label: 'Invoice someone owes me', hint: 'For your own side work', onClick: () => set({ destination: 'invoice_owed_to_me', context: 'home' }) },
      { icon: 'shield', label: 'Warranty or guarantee', onClick: () => set({ destination: 'warranty' }) },
    ];
    const isWork = r0.context === 'work' || (item.scope && item.scope.kind === 'work');
    const opts = (isWork ? workOpts.concat(paperOpts) : paperOpts.concat(workOpts)).concat([
      { icon: 'bills', label: 'Regular bill', onClick: () => set({ destination: 'bill' }) },
      { icon: 'card', label: 'Debt', hint: 'Card, loan, Klarna, finance', onClick: () => set({ destination: 'debt' }) },
      { icon: 'folder', label: 'Important document', onClick: () => set({ destination: 'document', document_type: (item.result && item.result.document_type) || 'Other' }) },
    ].concat(s.visas.filter((v) => !['Refused', 'Withdrawn'].includes(v.status)).map((v) => ({ icon: 'globe', label: 'Visa: ' + v.visaType, hint: v.applicant || v.country, onClick: () => set({ destination: 'visa', visa_id: v.id }) })))
      .concat([
        { icon: 'globe', label: 'New visa application', onClick: () => set({ destination: 'visa', visa_id: null }) },
        { icon: 'todo', label: 'Task', onClick: () => set({ destination: 'task' }) },
        { icon: 'out', label: 'Money out', onClick: () => set({ destination: 'transaction_out' }) },
        { icon: 'in', label: 'Money in', onClick: () => set({ destination: 'transaction_in' }) },
      ])
      .concat((s.sections || []).map((x) => ({ icon: x.icon || 'star', label: x.name, hint: 'Your section', onClick: () => set({ destination: 'section', section_id: x.id, new_section_name: null }) })))
      .concat([{ icon: 'plus', label: 'New section…', onClick: () => formDialog({
        title: 'New section', fields: [{ name: 'name', label: 'Section name', required: true, placeholder: 'e.g. Car, Pets, Wedding' }], submitLabel: 'Use this section',
        onSubmit: (v) => set({ destination: 'section', section_id: null, new_section_name: v.name }),
      }) }]));
    menu(anchor || document.querySelector('.main'), opts);
  }

  /* ---------- view ---------- */
  function confidenceLabel(c) {
    if (c >= 0.85) return pill('Sure', 'good', 'check');
    if (c >= 0.6) return pill('Fairly sure', 'info');
    return pill('Not sure', 'warn', 'alert');
  }
  function detailChips(r) {
    const out = [];
    if (r.party) out.push(r.party);
    if (r.amount != null) out.push((r.destination === 'debt' ? 'balance ' : '') + money(r.amount));
    if (r.monthly_payment != null) out.push(money(r.monthly_payment) + ' a month');
    if (r.interest_rate != null) out.push(r.interest_rate + '% APR');
    if (r.date) out.push(fmtDate(r.date, { short: true }));
    if (r.due_date) out.push('due ' + fmtDate(r.due_date, { short: true }));
    if (r.expiry_date) out.push((r.destination === 'warranty' ? 'covered until ' : 'expires ') + fmtDate(r.expiry_date, { short: true }));
    if (r.reference) out.push('ref ' + r.reference);
    if (r.task_title) out.push('+ task: ' + r.task_title + (r.task_due ? ' (' + fmtDate(r.task_due, { short: true }) + ')' : ''));
    return out.map((x) => '<span class="detail">' + esc(x) + '</span>').join('');
  }

  /* Destinations that can be yours or for work. */
  const EITHER = ['receipt', 'invoice_to_pay', 'invoice_owed_to_me', 'warranty', 'bill', 'document', 'task'];
  /* [Company's money] [Mine, get it back], for one item (an id) or for several (ids joined by commas). */
  function payerButtons(ids, all) {
    const n = esc(ids);
    return '<button type="button" class="btn btn--sm btn--ktk" data-payer="company" data-ids="' + n + '">' + icon('briefcase') + esc((all ? 'All ' + co() : co(true)) + '’s money') + '</button>' +
      '<button type="button" class="btn btn--sm btn--mine" data-payer="me" data-ids="' + n + '">' + icon('coin') + (all ? 'All mine, get them back' : 'Mine, get it back') + '</button>';
  }

  function cardHTML(item) {
    const r = item.result;
    const thumbs = (item.files || []).length ? '<button type="button" class="doc-row__thumb" data-view="' + esc(item.id) + '" aria-label="View files">' + thumbHTML(item.files) + '</button>'
      : '<span class="thumb thumb--empty">' + icon('note') + '</span>';
    if (item.status === 'reading') {
      return '<li class="inbox-card is-reading">' + thumbs + '<div class="inbox-card__main"><b>' + esc(item.note || (item.files[0] && item.files[0].name) || 'Item') + '</b>' +
        '<p class="reading"><span class="spinner" aria-hidden="true"></span>Reading…</p></div></li>';
    }
    const dest = r ? GU.brain.where(r) : 'Not sorted';
    const ask = asksPayer(r);
    const id = esc(item.id);
    // Things that can be either yours or for work get a Home / Work chip in place of the part's name.
    const part = r && EITHER.includes(r.destination) && /^(Home|Work) › /.test(dest) ? dest.slice(0, 4) : '';
    const chip = part ? '<button type="button" class="chip inbox-card__part inbox-card__part--' + part.toLowerCase() + '" data-flip="' + id + '" title="' +
      esc(part === 'Work' ? 'Not for ' + co() + '? Move it to Home' : 'For ' + co() + '? Move it to Work') + '">' + icon(part === 'Work' ? 'briefcase' : 'home') + part + '</button>' : '';
    return '<li class="inbox-card">' + thumbs +
      '<div class="inbox-card__main">' +
      '<p class="inbox-card__summary">' + esc(r && r.summary ? r.summary : item.error || 'I’m not sure what this is.') + '</p>' +
      (item.note && r && item.note !== r.summary ? '<p class="inbox-card__note">You wrote: “' + esc(item.note) + '”</p>' : '') +
      (r ? '<p class="inbox-card__dest">' + chip + icon('chevron') + '<b>' + esc(part ? dest.slice(7) : dest) + '</b>' + (ask ? '' : confidenceLabel(r.confidence)) + '</p><p class="details">' + detailChips(r) + '</p>' : '') +
      (r && r.warning ? '<p class="field__help">' + esc(r.warning) + '</p>' : '') +
      (ask ? '<p class="inbox-card__ask">Whose money paid for this?</p>' : '') +
      '<div class="inbox-card__actions">' +
      (ask ? payerButtons(item.id) : r && r.destination !== 'unsure' ? '<button type="button" class="btn btn--sm btn--primary" data-file="' + id + '">' + icon('check') + (['bank_statement', 'order_history'].includes(r.destination) ? 'Open importer' : 'File it') + '</button>' : '') +
      '<button type="button" class="btn btn--sm" data-place="' + esc(item.id) + '">' + icon('folder') + (r && r.destination !== 'unsure' ? 'Somewhere else' : 'Choose where') + '</button>' +
      (r && !['unsure', 'bank_statement', 'order_history'].includes(r.destination) ? '<button type="button" class="btn btn--sm" data-details="' + esc(item.id) + '">' + icon('edit') + 'Check details</button>' : '') +
      ((item.files || []).length ? '<button type="button" class="btn btn--sm btn--ghost" data-dl="' + esc(item.files.map((f) => f.id).join(',')) + '" data-dl-name="' + esc((r && r.title) || item.note || 'Inbox files') + '">' + icon('download') + (item.files.length > 1 ? 'Download all' : 'Download') + '</button>' : '') +
      '<button type="button" class="btn btn--sm btn--ghost" data-discard="' + esc(item.id) + '">' + icon('trash') + 'Remove</button>' +
      '</div></div></li>';
  }

  function render(root) {
    const s = store.state;
    const reading = s.inbox.filter((i) => i.status === 'reading');
    const ready = s.inbox.filter((i) => i.status !== 'reading');
    const asking = ready.filter((i) => asksPayer(i.result));
    const fileable = ready.filter((i) => i.result && !['unsure', 'bank_statement', 'order_history'].includes(i.result.destination) && !asksPayer(i.result));
    const where = '<button type="button" class="link link--btn" data-where-help>Where does it go?</button>';
    const work = inWork();
    const shown = ready.slice(0, 60).concat(reading.slice(0, 6));
    const waiting = s.inbox;
    const log = s.filedLog.slice(0, 15);
    GU.brain.mode().then((m) => {
      const changed = m !== modeCache;
      modeCache = m;
      const el = root.querySelector('[data-mode]');
      if (el) el.innerHTML = modeHTML(m);
      if (changed && m !== 'offline') GU.render();
    });

    root.innerHTML = GU.view.head({
      eyebrow: 'Your assistant',
      title: 'Inbox',
      text: 'Throw anything at me: photos of receipts, invoices, letters, screenshots, emails or quick notes. I’ll work out what each one is and file it in the right place in Home or Work, or start a new section when nothing fits.',
      actions: '<button type="button" class="btn btn--ghost" data-where-help>' + icon('info') + 'Where does it go?</button>',
    }) +
      '<form class="thrower" data-throw>' +
      '<label class="visually-hidden" for="inbox-note">Type or paste anything</label>' +
      '<textarea id="inbox-note" name="note" rows="3" placeholder="Type or paste anything: “Dentist on 14 Nov at 3pm”, “Paid £20 to the window cleaner”, an email from your landlord… or paste a screenshot."></textarea>' +
      '<div class="thrower__drop" tabindex="0" role="button" aria-label="Upload files">' + icon('upload') + '<span><b>Drop photos, PDFs, files or whole folders here</b><small>or tap to choose files or take a photo. Folders inside folders are included too.</small></span><input type="file" multiple accept="' + GU.ui.ACCEPT + '" hidden id="inbox-file"></div>' +
      '<div class="thrower__pick"><button type="button" class="btn btn--sm" data-pick-files>' + icon('file') + 'Choose files</button><button type="button" class="btn btn--sm" data-pick-folder>' + icon('folder') + 'Choose a folder</button></div>' +
      (work ? '<p class="thrower__part">' + icon('briefcase') + '<span>You’re in Work, so what you add here is filed for ' + esc(co()) + '. <button type="button" class="link link--btn" data-part-home>File in Home instead</button></span></p>' : '') +
      '<div class="thrower__foot"><p class="thrower__mode" data-mode>' + modeHTML(modeCache) + '</p>' +
      '<label class="check"><input type="checkbox" id="auto-file"' + (s.settings.autoFile !== false ? ' checked' : '') + '><span>File automatically when I’m sure</span></label>' +
      '<button type="submit" class="btn btn--primary">' + icon('check') + 'Sort it</button></div>' +
      '</form>' +
      (asking.length > 1 ? '<section class="ask-card inbox-ask" aria-label="Whose money paid?"><header class="ask-card__head"><h2>' + icon('coin') + 'Whose money paid?</h2>' +
        '<p>' + esc(plural(asking.length, 'thing') + ' for ' + co() + ' need an answer. If ' + co() + ' paid, they go in ' + (parts() ? parts().paysLabel(s) : 'Company pays') + '. If you paid, they go in Get paid back so you can claim the money.') + '</p>' +
        '<div class="ask-card__opts">' + payerButtons(asking.map((i) => i.id).join(','), true) + '</div></header></section>' : '') +
      '<section class="panel"><header class="panel__head"><h2>Waiting for you</h2><span class="panel__tools">' +
      (reading.length ? '<span class="reading"><span class="spinner" aria-hidden="true"></span>Reading ' + reading.length + ' more…</span>' : '') +
      (ready.filter((i) => i.result && i.result.destination === 'bank_statement').length > 1 ? '<button type="button" class="btn btn--sm" data-import-all>' + icon('bank') + 'Import all ' + ready.filter((i) => i.result && i.result.destination === 'bank_statement').length + ' statements</button>' : '') +
      (fileable.length > 1 ? '<button type="button" class="btn btn--sm btn--primary" data-file-all>' + icon('check') + 'File all ' + fileable.length + '</button>' : '') +
      (!reading.length && fileable.length <= 1 ? '<span class="muted">' + (waiting.length ? plural(waiting.length, 'item') : 'all clear') + '</span>' : '') + '</span></header>' +
      (waiting.length ? '<ul class="inbox-list">' + shown.map(cardHTML).join('') + '</ul>' +
        (ready.length > 60 ? '<p class="panel__foot muted">Showing 60 of ' + ready.length + '. File some to see the rest.</p>' : '')
        : '<div class="panel__body">' + emptyState({ icon: 'check', title: 'Nothing waiting', text: 'Everything you’ve sent me has been filed. Not sure where something belongs? ' + where }) + '</div>') + '</section>' +
      (log.length ? '<section class="panel"><header class="panel__head"><h2>Filed recently</h2></header><ul class="rows rows--tight">' + log.map((l) =>
        '<li class="row-item"><span class="row-item__icon">' + icon('check') + '</span><span class="row-item__text"><b>' + esc(l.summary || l.title) + '</b><em>' + esc(fmtDate(l.date, { short: true })) + ' · ' + esc(l.label) + (l.via ? ' · read by ' + esc(GU.brain.modeLabel(l.via).replace(/ \(.*\)/, '')) : '') + '</em></span>' +
        '<span class="row-item__act">' + (l.ref ? '<button type="button" class="btn btn--sm btn--ghost" data-open-log="' + esc(l.id) + '">Open</button>' : '') +
        (undoers.has(l.id) ? '<button type="button" class="btn btn--sm btn--ghost" data-undo="' + esc(l.id) + '">Undo</button>' : '') + '</span></li>').join('') + '</ul></section>' : '');

    const form = root.querySelector('[data-throw]');
    const input = root.querySelector('#inbox-file');
    const drop = root.querySelector('.thrower__drop');
    const pending = [];
    const send = () => {
      const note = form.elements.note.value;
      const files = pending.splice(0);
      if (!note.trim() && !files.length) {
        form.elements.note.focus();
        return;
      }
      form.elements.note.value = '';
      add({ files, note });
    };
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      send();
    });
    form.elements.note.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        send();
      }
    });
    form.elements.note.addEventListener('paste', (e) => {
      const files = Array.from((e.clipboardData && e.clipboardData.files) || []);
      if (files.length) {
        e.preventDefault();
        add({ files, note: form.elements.note.value });
        form.elements.note.value = '';
      }
    });
    drop.addEventListener('click', () => input.click());
    root.querySelector('[data-pick-files]').addEventListener('click', () => input.click());
    root.querySelector('[data-pick-folder]').addEventListener('click', async () => {
      const files = await GU.ui.pickFolder();
      if (!files.length) return toast('That folder has no files I can read.');
      const note = form.elements.note.value;
      form.elements.note.value = '';
      add({ files, note });
    });
    drop.addEventListener('keydown', (e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), input.click()));
    input.addEventListener('change', () => {
      const note = form.elements.note.value;
      form.elements.note.value = '';
      add({ files: Array.from(input.files), note });
    });
    ['dragover', 'dragenter'].forEach((ev) => drop.addEventListener(ev, (e) => (e.preventDefault(), drop.classList.add('is-over'))));
    drop.addEventListener('dragleave', () => drop.classList.remove('is-over'));
    drop.addEventListener('drop', (e) => {
      e.preventDefault();
      drop.classList.remove('is-over');
      const note = form.elements.note.value;
      form.elements.note.value = '';
      GU.ui.filesFromDrop(e.dataTransfer).then((files) => (files.length ? add({ files, note }) : toast('There were no files I can read in that.')));
    });
    root.querySelector('#auto-file').addEventListener('change', (e) => store.commit((st) => (st.settings.autoFile = e.target.checked)));

    root.addEventListener('click', (e) => {
      const find = (attr) => {
        const b = e.target.closest('[' + attr + ']');
        return b ? { b, item: store.state.inbox.find((i) => i.id === b.getAttribute(attr)) } : null;
      };
      let hit;
      const pay = e.target.closest('[data-payer]');
      if (pay) return answerPayer(String(pay.dataset.ids || '').split(',').filter(Boolean), pay.dataset.payer);
      if ((hit = find('data-flip')) && hit.item) return flipPart(hit.item);
      if (e.target.closest('[data-part-home]') && parts()) {
        parts().set('home');
        return GU.render();
      }
      if (e.target.closest('[data-file-all]')) return fileAll();
      if (e.target.closest('[data-import-all]')) return importAllStatements();
      if ((hit = find('data-file')) && hit.item) return fileItem(hit.item, hit.item.result);
      if ((hit = find('data-details')) && hit.item) return editAndFile(hit.item);
      if ((hit = find('data-place')) && hit.item) return choosePlace(hit.item, hit.b);
      if ((hit = find('data-discard')) && hit.item) return discard(hit.item.id);
      if ((hit = find('data-view')) && hit.item) return viewFiles(hit.item.files, 0, hit.item.note || 'Files');
      const u = e.target.closest('[data-undo]');
      if (u && undoers.has(u.dataset.undo)) return undoers.get(u.dataset.undo)();
      const o = e.target.closest('[data-open-log]');
      if (o) {
        const l = store.state.filedLog.find((x) => x.id === o.dataset.openLog);
        if (l && l.ref) {
          if (l.tab) GU.view.go(l.tab);
          setTimeout(() => GU.view.open(l.ref), 50);
        }
      }
    });
  }

  function modeHTML(m) {
    if (m === 'offline') return icon('lock') + '<span>Reading offline, on this device. <a class="link" href="#settings">Connect Claude</a> for much smarter sorting of photos and letters.</span>';
    return icon('check') + '<span>Reading with ' + esc(GU.brain.modeLabel(m)) + '.</span>';
  }

  /* Pick up anything left half-read when the page was closed. */
  function resume() {
    if (store.state.inbox.some((i) => i.status === 'reading')) pump();
  }

  GU.inbox = { add, resume, fileItem, answerPayer };
  GU.tabs.inbox = { label: 'Inbox', short: 'Inbox', icon: 'inbox', render };
})();
