/* The Ground Up: the Sorting hub. Put anything in it: photos, PDFs, screenshots, pasted emails, quick notes, or an
   instruction ("make a Pets section and put the vet bill in it"). Each thing is read and filed where it belongs,
   by your rules first, then by Claude (or the offline reader). Anything it isn't sure about waits here for you,
   and every change it makes can be undone from Recently sorted. The engine (places, rules, duplicates, the
   sorting agent) is in js/sorter.js. GU.inbox is kept as another name for GU.hub, so older callers still work. */
(function () {
  'use strict';
  const GU = window.GU;
  const { esc, uid, today, money, fmtDate, plural } = GU.util;
  const { icon, pill, emptyState, toast, thumbHTML, viewFiles, formDialog, menu } = GU.ui;
  const store = GU.store;
  const S = () => GU.sorter;

  const AUTO_FILE_AT = 0.75;
  const RECENT = 30;
  const WORK_OUT = (GU.finance && GU.finance.WORK_OUT) || 'Work expenses';
  const PAYSLIPS = 'Employment and payslips';
  const NOT_FILEABLE = ['unsure', 'bank_statement', 'order_history'];
  const undoers = new Map();
  let running = false;
  let modeCache = 'offline';
  let conn; // how Claude is reached for instructions: {kind, tools}, null when it can't be, undefined until checked

  /* What the page remembers while you use it (not saved). */
  const ui = { draft: '', telling: new Set(), tellText: new Map(), open: new Set(), held: new Map(), rulesOpen: false };
  /* The sorting agent's reply line under the box. */
  let reply = null; // {busy, ctl, q, text, status, note, error, stopped, changes: [log ids], undone, offline}
  const memory = []; // the last few instructions and replies, so "now put it in Pets too" makes sense

  // Recently deleted names what came from here.
  if (GU.trash && GU.trash.KIND) GU.trash.KIND.inbox = 'Sorting hub item';

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

  /* ---------- the queue ---------- */
  /* input: {files, note, scope, ctx}. scope: where it was added (a section, a Work page…). ctx: 'home' or 'work'
     when the caller knows; otherwise the part you're in decides. Resolves with what happened:
     {label, logId} when a note was filed straight away, {waiting: n} when things wait to be read, or {} otherwise. */
  async function add(input) {
    const files = input.files || [];
    const note = (input.note || '').trim();
    if (!files.length && !note) return {};
    const ctx = input.ctx === 'home' || input.ctx === 'work' ? input.ctx : null;
    const scope = scopeFor(input);

    // Quick notes ("call the dentist tomorrow", "paid £18 for printer paper") are filed instantly without waiting for Claude.
    if (!files.length) {
      const quick = await GU.brain.quick(note).catch(() => null);
      if (quick && quick.destination === 'order_history') {
        GU.tabs.receipts.importOrders(note, orderPreset(scope));
        return { imported: 'orders' };
      }
      if (quick && quick.confidence >= 0.8 && (['task', 'transaction_out', 'transaction_in'].includes(quick.destination) || (quick.destination === 'receipt' && quick.payer))) {
        let result = scope ? applyScope(quick, scope, '', ctx, '') : quick;
        if (!scope) result = S().applyRules({ note, files: [] }, result);
        if (!asksPayer(result)) {
          const out = fileItem({ id: 'in-' + uid(), created: today(), note, files: [], scope }, result);
          return out ? { label: out.label, logId: out.logId } : {};
        }
      }
      const item = { id: 'in-' + uid(), created: today(), note, files: [], status: 'reading', scope, ctx };
      store.commit((s) => s.inbox.push(item));
      pump();
      return { waiting: 1, id: item.id };
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
    if (!work.length) return {};
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
    return { waiting: work.length };
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
      // Dropped on Work's Overview, or anywhere in Work with no page of its own: your rules can still say where.
      if (!scope.area && !scope.paperKind && !payer) out.scoped = 'work';
      out.why = 'You added it in ' + scope.name;
      out.summary = (r.destination === 'unsure' ? out.title : out.summary || out.title) + ' (added in ' + scope.name + ')';
      return out;
    } else if (scope.kind === 'section') {
      out.destination = 'section';
      const sec = scope.sectionId ? store.state.sections.find((x) => x.id === scope.sectionId) : store.state.sections.find((x) => x.name.toLowerCase() === String(scope.name || '').toLowerCase());
      out.section_id = sec ? sec.id : null;
      out.new_section_name = sec ? null : scope.name;
      out.group = sub || '';
    }
    out.why = scope.name ? 'It was in your “' + scope.name + '” folder' : 'You added it there';
    out.summary = (r.destination === 'unsure' ? out.title : r.summary || out.title) + (scope.name ? ' (from your “' + scope.name + '” folder)' : '');
    return out;
  }

  /* Your rules, before anything Claude or the reader thought. Something you put on a page of its own stays
     there; on Work's Overview a rule can still say which Work page, but not move it to Home. */
  function withRules(item, r) {
    if (!r) return r;
    if (r.scoped && r.scoped !== 'work') return r;
    const out = S().applyRules(item, r);
    if (out === r || !out.rule) return r;
    if (r.scoped === 'work' && out.context !== 'work') return r;
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
          result = await GU.brain.analyse({ files: blobs, note: next.note, hint: next.hint, paths: next.files.map((m) => m.path || m.name) });
          if (next.scope && result) result = applyScope(Object.assign(result, { _fileName: (next.files[0] || {}).name }), next.scope, next.sub, next.ctx, next.root);
          result = withRules(next, result);
          // What you said about it ('dad paid this', 'for the wedding') wins over the reading.
          if (next.hint && result) {
            const h = S().hintOverrides(next.hint, result);
            if (h.changed) result = Object.assign(h.r, { rule: null });
          }
        } catch (e) {
          console.warn('[hub] analyse failed', e);
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
      toast(msg, batch.waiting && location.hash !== '#hub' ? { action: 'Review', onAction: () => GU.view.go('hub') } : {});
    }
  }

  /* Returns true when the item was filed automatically. Work receipts and invoices are never filed while
     nobody knows whose money paid, unless your bank shows you paid it. Nor is anything that looks like a
     record you already have. */
  function settle(item, quiet) {
    const r = item.result;
    if (!r) return false;
    if (asksPayer(r)) {
      const who = GU.brain.payerFor(r);
      if (who) store.commit(() => Object.assign(r, { payer: who, why: r.why || 'Your bank shows you paid it' }));
    }
    const ask = asksPayer(r);
    const dup = S().dupOf(item);
    if (!ask && !dup && item.scope && r.scoped === true && r.destination !== 'unsure') {
      fileItem(item, r, { quiet });
      return true;
    }
    const auto = store.state.settings.autoFile !== false;
    if (!ask && !dup && auto && r.confidence >= AUTO_FILE_AT && !NOT_FILEABLE.includes(r.destination)) {
      fileItem(item, r, { quiet, by: r.rule ? 'rule' : '' });
      return true;
    }
    // A single spreadsheet opens its importer straight away (you still confirm there).
    if (!quiet && ['bank_statement', 'order_history'].includes(r.destination)) {
      fileItem(item, r);
      return true;
    }
    if (!quiet && location.hash !== '#hub') {
      toast(ask ? 'Whose money paid for ' + (r.title || 'this') + '? Answer in the Sorting hub.' : dup ? 'Something in the Sorting hub looks like one you already have' : 'Something needs a quick check in the Sorting hub',
        { action: ask ? 'Answer' : 'Review', onAction: () => GU.view.go('hub') });
    }
    return false;
  }

  /* ---------- filing, with Undo ---------- */
  /* Files an item using a (possibly edited) result. opts: {quiet, by: 'claude' | 'rule' | 'you'}.
     Returns {logId, label, ref, tab}, or null when nothing was filed (an importer opened instead). */
  function fileItem(item, result, opts) {
    opts = opts || {};
    if (result.destination === 'bank_statement') return void openImporter(item);
    if (result.destination === 'order_history') return void openOrders(item);
    const res = GU.brain.file(result, item.files || [], item.note);
    if (!res) return null;
    // Only something new is filed for the Work page it was added on: a file added to a record you already had
    // (the same order number, say) leaves that record where it is.
    if (res.ref && !res.attached) workTag(item, res.ref.c, res.ref.id);
    const logId = 'log-' + uid();
    const by = opts.by || result.by || (result.rule ? 'rule' : '');
    // Undo takes it out of where it went and puts it back here as it was before, to sort again (not with a place
    // the same instruction made and may have taken away again). Set before the page redraws, so Recently sorted
    // shows its Undo straight away.
    const restore = Object.assign({}, item, { status: 'ready', result: Object.assign({}, item.result || result) });
    delete restore.ruleOffer;
    undoers.set(logId, () => {
      res.undo();
      store.commit((s) => {
        s.filedLog = s.filedLog.filter((l) => l.id !== logId);
        if (!s.inbox.some((i) => i.id === restore.id)) s.inbox.push(restore);
      });
      undoers.delete(logId);
      return true;
    });
    ui.held.delete(item.id);
    store.commit((s) => {
      s.inbox = s.inbox.filter((i) => i.id !== item.id);
      s.filedLog.unshift({ id: logId, date: today(), summary: result.summary || result.title, title: result.title, label: res.label, tab: res.tab, ref: res.ref, via: result.via, files: (item.files || []).length, by });
      s.filedLog = s.filedLog.slice(0, 60);
    });
    if (!opts.quiet) toast('Filed in ' + res.label + ': ' + (result.title || ''), { action: 'Undo', onAction: () => undo(logId) });
    return { logId, label: res.label, ref: res.ref, tab: res.tab };
  }
  /* A change the sorting agent (or an instruction) made, in Recently sorted with its Undo. o: {label, where, tab,
     ref, by, undo}. undo() may return false when it can't be undone after all. Returns the log id. */
  function logChange(o) {
    const id = 'log-' + uid();
    if (typeof o.undo === 'function') {
      undoers.set(id, () => {
        if (o.undo() === false) return false;
        store.commit((s) => (s.filedLog = s.filedLog.filter((l) => l.id !== id)));
        undoers.delete(id);
        return true;
      });
    }
    store.commit((s) => {
      s.filedLog.unshift({ id, date: today(), kind: 'change', summary: o.label, title: o.label, label: o.where || '', tab: o.tab || null, ref: o.ref || null, by: o.by || 'claude' });
      s.filedLog = s.filedLog.slice(0, 60);
    });
    return id;
  }
  /* Undoes one entry of Recently sorted. Returns true when it was undone. */
  function undo(logId) {
    const fn = undoers.get(logId);
    if (!fn) return false;
    return fn() !== false;
  }

  /* Answers 'whose money paid?' for work receipts and invoices, then files them. */
  function answerPayer(ids, payer) {
    const items = store.state.inbox.filter((i) => ids.includes(i.id) && i.result);
    items.forEach((it) => fileItem(it, Object.assign({}, it.result, { payer, context: 'work' }), { quiet: items.length > 1 }));
    if (items.length > 1) toast('Filed ' + plural(items.length, 'item') + ' in ' + (payer === 'me' ? 'Get paid back' : parts() ? parts().paysLabel(store.state) : 'Work') + '. Each one can be undone from Recently sorted.');
  }

  /* Files every item at or above the auto-file confidence. The rest stay, each with the reason.
     Returns {filed, left: [{id, reason}], logIds}. */
  function sortEverything(opts) {
    opts = opts || {};
    const idx = S().dupIndex();
    const logIds = [];
    const left = [];
    ui.held.clear();
    for (const it of store.state.inbox.slice()) {
      const live = store.state.inbox.find((x) => x.id === it.id);
      if (!live) continue;
      const reason = S().holdReason(live, idx);
      if (reason) {
        left.push({ id: live.id, reason });
        ui.held.set(live.id, reason);
        continue;
      }
      const out = fileItem(live, live.result, { quiet: true, by: opts.by || '' });
      if (out) logIds.push(out.logId);
    }
    if (!opts.quiet) {
      toast(logIds.length ? 'Filed ' + plural(logIds.length, 'item') + '.' + (left.length ? ' ' + plural(left.length, 'item') + ' left: each one says why.' : ' Each one can be undone from Recently sorted.')
        : left.length ? 'Nothing was sure enough to file. Each item says why.' : 'Nothing to sort.');
      GU.render();
    }
    return { filed: logIds.length, left, logIds };
  }
  /* Files a group of items as they are (you chose them), in one go. */
  function fileGroup(ids) {
    let n = 0;
    for (const id of ids) {
      const live = store.state.inbox.find((x) => x.id === id);
      if (live && live.result && !NOT_FILEABLE.includes(live.result.destination) && !asksPayer(live.result)) {
        if (fileItem(live, live.result, { quiet: true })) n++;
      }
    }
    toast('Filed ' + plural(n, 'item') + '. Each one can be undone from Recently sorted.');
  }

  async function importAllStatements() {
    const items = store.state.inbox.filter((i) => i.result && i.result.destination === 'bank_statement');
    const files = [];
    for (const it of items) {
      const m = (it.files || [])[0];
      const rec = m && (await GU.files.get(m.id));
      if (rec) files.push(new File([rec.blob], m.name, { type: m.type }));
    }
    items.forEach((it) => discard(it.id, { handedOn: true }));
    if (files.length) GU.tabs.transactions.importStatement(files);
  }

  /* Orders dropped in Work are for work: yours to get back on Get paid back, otherwise on the company's card. */
  const orderPreset = (sc) => (sc && sc.kind === 'work' ? { context: 'work', payer: scopePayer(sc) || 'company' } : undefined);
  async function openOrders(item) {
    const m = (item.files || [])[0];
    const rec = m && (await GU.files.get(m.id));
    if (!rec) return toast('The order list is missing. Try uploading it again.');
    GU.tabs.receipts.importOrders(new File([rec.blob], m.name, { type: m.type || 'text/csv' }), orderPreset(item.scope));
    discard(item.id, { handedOn: true });
  }

  async function openImporter(item) {
    const m = (item.files || [])[0];
    const rec = m && (await GU.files.get(m.id));
    if (!rec) return toast('The statement file is missing. Try uploading it again.');
    GU.tabs.transactions.importCSV(new File([rec.blob], m.name, { type: m.type || 'text/csv' }));
    discard(item.id, { handedOn: true });
  }

  /* opts.handedOn: given to an importer, so nothing is lost. Otherwise it goes to Recently deleted.
     Returns an undo function (or null). */
  function discard(id, opts) {
    opts = opts || {};
    const item = store.state.inbox.find((i) => i.id === id);
    if (!item) return null;
    ui.held.delete(id);
    if (opts.handedOn) {
      (item.files || []).forEach((f) => GU.files.remove(f.id));
      store.commit((s) => (s.inbox = s.inbox.filter((i) => i.id !== id)));
      return null;
    }
    let entry = null;
    store.commit((s) => {
      s.inbox = s.inbox.filter((i) => i.id !== id);
      entry = GU.trash.put(s, 'inbox', Object.assign({}, item, { status: item.status === 'reading' ? 'reading' : 'ready' }), (item.result && item.result.title) || (item.files[0] && item.files[0].name) || item.note || 'Sorting hub item');
    });
    if (!opts.quiet) GU.trash.offerUndo(entry);
    return () => GU.ui.quietly(() => GU.trash.restore(entry.id));
  }

  /* Something added in Work is filed as work, in the folder it was added to. A Work page that says whose money
     it is (Get paid back, the company's page) sets it, and GU.workMoney fills in the stage and legacy flags.
     Never for something that was saved as yours: a payslip, or a form you switched to Home. */
  function workTag(item, c, id) {
    const sc = item.scope;
    if (!sc || sc.kind !== 'work' || !['paperwork', 'bills', 'documents', 'tasks'].includes(c)) return;
    const payer = scopePayer(sc);
    store.commit((s) => {
      const rec = (s[c] || []).find((x) => x.id === id);
      if (!rec || rec.context === 'home') return;
      if (c === 'tasks' && rec.context !== 'work' && !(GU.parts && GU.parts.isWorkTask(s, rec))) return;
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
      const at = rec && rec.id ? whereNow(rec.id) : null;
      store.commit((s) => {
        s.inbox = s.inbox.filter((i) => i.id !== item.id);
        s.filedLog.unshift({ id: 'log-' + uid(), date: today(), summary: r.summary || r.title, title: r.title, label: at ? at.label : GU.brain.where(r), tab: at ? at.tab : null, ref: at ? at.ref : null, via: r.via, files: files.length, by: 'you' });
        s.filedLog = s.filedLog.slice(0, 60);
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
        return GU.tabs.todos.create(Object.assign({ title: r.title, due: r.due_date || '', notes: item.note && item.note !== r.title ? item.note : '' }, work ? Object.assign({ context: 'work' }, wl ? { listId: wl } : {}) : Object.assign({ context: 'home' }, r.list_id ? { listId: r.list_id } : {})), { onSaved: done });
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
        return choosePlace([item], null);
    }
  }
  /* Where a record saved by a form ended up, so Recently sorted says where it really went. */
  function whereNow(id) {
    for (const c of ['paperwork', 'bills', 'documents', 'tasks', 'sectionItems', 'transactions', 'visas', 'debts']) {
      const rec = (store.state[c] || []).find((x) => x.id === id);
      if (rec) return Object.assign({ ref: { c, id } }, S().recordPlace(c, rec));
    }
    return null;
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
      item.result.rule = null;
    });
  }
  /* Sets where an item will go (from the agent or the menu), without filing it. */
  function setSuggestion(id, result) {
    const it = store.state.inbox.find((x) => x.id === id);
    if (!it) return;
    store.commit(() => {
      it.result = result;
      it.status = 'ready';
      it.error = '';
    });
    ui.held.delete(id);
  }

  /* Lets you change where one item, or a group of them, should go. */
  function choosePlace(items, anchor) {
    items = items.filter(Boolean);
    if (!items.length) return;
    const first = items[0];
    const set = (patch, after) => {
      store.commit(() => {
        for (const item of items) {
          const base = item.result || Object.assign(GU.brain.blank(), { title: item.note || (item.files[0] && item.files[0].name) || 'Item', context: 'home' });
          item.result = Object.assign(base, { section_id: null, new_section_name: null, list_id: null, new_list_name: null, folder_id: null, new_category: null, section_part: null }, patch,
            { confidence: 1, rule: null, why: 'You chose this place', summary: base.summary || '' });
          item.status = 'ready';
          if (patch.context === 'home') toHome(item);
          // Offer to remember it for next time, for things from someone.
          const m = S().ruleMatchFor(item.result);
          const pid = S().placeIdOf(item.result);
          item.ruleOffer = m && pid && !S().rules().some((x) => S().norm(x.match).trim() === S().norm(m).trim() && x.place === pid) ? { match: m, place: pid, payer: item.result.payer || null } : null;
        }
      });
      items.forEach((i) => ui.held.delete(i.id));
      if (after) after();
    };
    const toPlace = (place, extra) => {
      store.commit(() => {
        for (const item of items) {
          const base = item.result || Object.assign(GU.brain.blank(), { title: item.note || (item.files[0] && item.files[0].name) || 'Item' });
          item.result = Object.assign(S().applyPlace(base, place, extra || {}), { rule: null, why: 'You chose this place', summary: base.summary || '' });
          item.status = 'ready';
          if (item.result.context === 'home') toHome(item);
          const m = S().ruleMatchFor(item.result);
          item.ruleOffer = m && !S().rules().some((x) => S().norm(x.match).trim() === S().norm(m).trim() && x.place === place.id) ? { match: m, place: place.id, payer: item.result.payer || null } : null;
        }
      });
      items.forEach((i) => ui.held.delete(i.id));
    };
    const s = store.state;
    const c = co();
    const r0 = first.result || {};
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
    const isWork = r0.context === 'work' || (first.scope && first.scope.kind === 'work');
    const wl = parts() ? parts().workListId(s) : null;
    const homeLists = (s.todoLists || []).filter((l) => l.id !== wl);
    const custom = ['out', 'in'].flatMap((k) => GU.finance.custom(s, k).map((name) => ({ name, k })));
    const moneyKind = ['transaction_in'].includes(r0.destination) ? 'in' : 'out';
    const ask = (title, label, placeholder, extra, onSubmit) => formDialog({
      title, fields: [{ name: 'name', label, required: true, placeholder }].concat(extra || []), submitLabel: 'Use it',
      values: { part: isWork ? 'work' : 'home', kind: moneyKind }, onSubmit,
    });
    const PARTS = [{ value: 'home', label: 'Home', icon: 'home' }, { value: 'work', label: 'Work', icon: 'briefcase' }];
    const opts = (isWork ? workOpts.concat(paperOpts) : paperOpts.concat(workOpts)).concat([
      { icon: 'bills', label: 'Regular bill', onClick: () => set({ destination: 'bill' }) },
      { icon: 'card', label: 'Debt', hint: 'Card, loan, Klarna, finance', onClick: () => set({ destination: 'debt' }) },
      { icon: 'folder', label: 'Important document', onClick: () => set({ destination: 'document', document_type: (first.result && first.result.document_type) || 'Other' }) },
    ].concat(s.visas.filter((v) => !['Refused', 'Withdrawn'].includes(v.status)).map((v) => ({ icon: 'globe', label: 'Visa: ' + v.visaType, hint: v.applicant || v.country, onClick: () => set({ destination: 'visa', visa_id: v.id }) })))
      .concat([
        { icon: 'globe', label: 'New visa application', onClick: () => set({ destination: 'visa', visa_id: null }) },
        { icon: 'todo', label: 'Task', hint: isWork ? 'Work › Tasks' : 'Home › To-do', onClick: () => set({ destination: 'task' }) },
      ])
      .concat(isWork ? [] : homeLists.map((l) => ({ icon: 'list', label: 'To-do list: ' + l.name, onClick: () => toPlace(S().placeById('list:' + l.id)) })))
      .concat([{ icon: 'plus', label: 'New list…', hint: 'A to-do list of its own', onClick: () => ask('New list', 'List name', 'e.g. Errands, Wedding jobs', [], (v) => set({ destination: 'task', context: 'home', new_list_name: v.name.trim() })) }])
      .concat([
        { icon: 'out', label: 'Money out', onClick: () => set({ destination: 'transaction_out' }) },
        { icon: 'in', label: 'Money in', onClick: () => set({ destination: 'transaction_in' }) },
      ])
      .concat(custom.map((x) => ({ icon: 'tag', label: 'Category: ' + x.name, hint: 'Your category', onClick: () => toPlace(S().placeById('category:' + x.name)) })))
      .concat([{ icon: 'tag', label: 'New category…', hint: 'Spending or money in, with budgets', onClick: () => ask('New category', 'Category name', 'e.g. Gym, Pets, Gifts',
        [{ name: 'kind', label: 'It’s for', type: 'segmented', options: [{ value: 'out', label: 'Money out' }, { value: 'in', label: 'Money in' }] }],
        (v) => {
          const name = GU.finance.tidyCategory(v.name);
          if (!name) return false;
          const found = GU.finance.findCategory(name);
          if (found && (GU.finance.WORK.includes(found) || found === GU.finance.TRANSFER)) {
            toast(found + ' is kept for the site’s own use. Choose another name.');
            return false;
          }
          const k = v.kind === 'in' ? 'in' : 'out';
          const dest = MONEY_DESTS.includes(r0.destination) && r0.destination !== 'invoice_owed_to_me' ? r0.destination : k === 'in' ? 'transaction_in' : 'receipt';
          set(Object.assign({ destination: k === 'in' && dest !== 'transaction_in' && !GU.brain.PAPER.includes(dest) ? 'transaction_in' : dest, context: 'home', payer: null }, found ? { category: found } : { category: name, new_category: name }));
        }) }])
      .concat((s.sections || []).map((x) => ({ icon: x.icon || 'star', label: x.name, hint: (x.part === 'work' ? 'Work' : 'Home') + ' section', onClick: () => set({ destination: 'section', section_id: x.id, context: x.part === 'work' ? 'work' : 'home', payer: null }) })))
      .concat([{ icon: 'plus', label: 'New section…', hint: 'Car, Pets, Wedding…', onClick: () => ask('New section', 'Section name', 'e.g. Car, Pets, Wedding',
        [{ name: 'part', label: 'Show it in', type: 'segmented', options: PARTS }],
        (v) => set({ destination: 'section', section_id: null, new_section_name: v.name.trim(), section_part: v.part === 'work' ? 'work' : 'home', context: v.part === 'work' ? 'work' : 'home', payer: null })) }]));
    menu(anchor || document.querySelector('.main'), opts);
  }
  const MONEY_DESTS = ['transaction_out', 'transaction_in', 'bill', 'receipt', 'invoice_to_pay', 'invoice_owed_to_me', 'warranty'];

  /* 'Tell me where…': the item is sorted again with your words. With Claude, the sorting agent does it (and can
     make the place); on this device, the words are read here and the item read again. */
  async function tellWhere(item, hint) {
    hint = String(hint || '').trim();
    if (!hint) return;
    if (reply && reply.busy) return toast('Claude is still working on the last one. Try again in a moment.');
    ui.telling.delete(item.id);
    ui.tellText.delete(item.id);
    await checkConn(true);
    if (conn && conn.tools >= 4) return runAgent(hint, item);
    const h = S().hintOverrides(hint, item.result);
    if (item.result && h.changed) {
      store.commit(() => {
        item.result = Object.assign(h.r, { rule: null });
        item.hint = hint;
      });
      ui.held.delete(item.id);
      const live = store.find('inbox', item.id);
      if (live && settle(live, false)) return;
      return showReply({ offline: true, q: hint, text: 'Moved it to ' + GU.brain.where(h.r) + '.' + (store.find('inbox', item.id) ? ' Check it and press File it.' : '') });
    }
    // Nothing here knew what that meant: read it again with your words as a note.
    store.commit(() => {
      item.hint = hint;
      item.status = 'reading';
    });
    pump();
    showReply({ offline: true, q: hint, text: 'Reading it again with what you said.' + (modeCache === 'offline' ? ' Connect Claude in Settings for much better sorting from your words.' : '') });
  }

  /* ---------- the sorting agent and typed instructions ---------- */
  let connAt = 0;
  let connKey = '';
  /* How Claude can be reached for instructions, checked again every few seconds or when the API key changes. */
  async function checkConn(force) {
    const key = (store.state.settings.apiKey || '').trim() ? 'key' : '';
    if (!force && conn !== undefined && key === connKey && Date.now() - connAt < 5000) return conn;
    try {
      conn = GU.assistant && GU.assistant.connection ? await GU.assistant.connection() : null;
    } catch (e) {
      conn = null;
    }
    connAt = Date.now();
    connKey = key;
    return conn;
  }
  /* What you typed in the box: something to keep, or an instruction. With Claude, the sorting agent decides. */
  async function submit(text) {
    text = String(text || '').trim();
    if (!text || (reply && reply.busy)) return;
    // A pasted email or letter is something to keep, never an instruction to follow.
    const pasted = text.length > 400 || (text.match(/\n/g) || []).length >= 3;
    if (pasted) {
      reply = null;
      return add({ note: text });
    }
    await checkConn(true);
    if (conn && conn.tools >= 4) return runAgent(text, null);
    return offlineSubmit(text);
  }
  /* Without Claude: the small offline reader for instructions, otherwise it's a note, sorted as always. */
  async function offlineSubmit(text, why) {
    if (S().looksLikeInstruction(text)) {
      const res = S().offline(text);
      if (res.handled) return showReply({ offline: true, q: text, text: res.reply, changes: res.changes });
      ui.draft = text;
      return showReply({ offline: true, q: text, note: why || 'Connect Claude in Settings to sort with instructions.', keep: true });
    }
    reply = null;
    const res = await add({ note: text });
    if (res && res.label) showReply({ offline: true, q: text, text: 'Filed in ' + res.label + '.', changes: res.logId ? [res.logId] : [] });
    else GU.render();
  }
  function showReply(o) {
    reply = Object.assign({ busy: false, q: '', text: '', status: '', note: '', error: false, changes: [] }, o);
    GU.render();
  }
  async function runAgent(text, item) {
    if (reply && reply.busy) return;
    const ctl = new AbortController();
    const mine = { busy: true, ctl, q: text, item: item ? item.id : null, text: '', status: item ? 'Sorting it out…' : 'Thinking…', note: '', error: false, changes: [] };
    reply = mine;
    GU.render();
    let last = 0;
    try {
      const r = await S().agent({
        text, item, history: memory.slice(-6), signal: ctl.signal,
        onText: (t) => {
          mine.text = t;
          mine.status = 'Writing…';
          const now = Date.now();
          if (now - last > 60) {
            last = now;
            paintReply();
          }
        },
        onStatus: (t) => {
          mine.status = t;
          paintReply();
        },
      });
      mine.text = r.text || '';
      mine.changes = r.changes || [];
      mine.truncated = !!r.truncated;
      if (!mine.text && !mine.changes.length && !mine.truncated) {
        mine.error = true;
        mine.note = 'Claude didn’t write anything back. Try saying it another way.';
      }
      memory.push({ role: 'user', content: item ? 'About "' + ((item.result && item.result.title) || 'an item') + '": ' + text : text },
        { role: 'assistant', content: (mine.text || 'Done.') + (mine.changes.length ? '\n[Changes made: ' + changeLabels(mine.changes).join('; ') + ']' : '') });
      while (memory.length > 8) memory.shift();
    } catch (e) {
      const code = (e && e.code) || '';
      const K = GU.assistant.kit;
      mine.changes = (e && e.changes) || mine.changes;
      if (code === 'cancelled' || ctl.signal.aborted || (e && e.name === 'AbortError')) {
        mine.text = (e && e.text) || mine.text;
        mine.stopped = true;
        mine.note = 'Stopped.' + (mine.changes.length ? ' What it did so far is below, with Undo.' : '');
      } else if ((code === 'unavailable' || K.HIDE.includes(code)) && !mine.changes.length && !mine.text) {
        // Claude can't be used here after all: sort it on this device.
        conn = null;
        mine.busy = false;
        if (reply === mine) reply = null;
        if (item) return tellWhere(item, text);
        return offlineSubmit(text, K.COPY[code] || 'Connect Claude in Settings to sort with instructions.');
      } else {
        if (e && e.message && e.message !== code) console.warn('[hub] sorting agent (' + (code || 'error') + '):', e.message);
        mine.text = code === 'refused' ? '' : (e && e.text) || mine.text;
        mine.error = true;
        mine.note = K.why(code, !!mine.text);
        // Nothing happened: put what you typed back, so you can try again.
        if (!mine.changes.length && !item && !ui.draft) ui.draft = text;
      }
    } finally {
      mine.busy = false;
      if (reply === mine) GU.render();
    }
  }
  const changeLabels = (ids) => ids.map((id) => store.state.filedLog.find((l) => l.id === id)).filter(Boolean).map((l) => (l.kind === 'change' ? l.summary : 'Filed “' + (l.title || '') + '” in ' + l.label));
  /* Undoes everything the last reply did, newest first. */
  function undoReply() {
    if (!reply || !reply.changes.length) return;
    let n = 0;
    let kept = 0;
    for (const id of reply.changes.slice().reverse()) {
      if (!undoers.has(id)) continue;
      if (undo(id)) n++;
      else kept++;
    }
    reply.undone = true;
    toast(n ? 'Undone: ' + plural(n, 'change') + (kept ? '. ' + kept + ' couldn’t be undone.' : '.') : 'Those changes can’t be undone any more.');
    GU.render();
  }

  /* ---------- the page ---------- */
  function confidenceLabel(c) {
    if (c >= 0.85) return pill('Sure', 'good', 'check');
    if (c >= 0.6) return pill('Fairly sure', 'info');
    return pill('Not sure', 'warn', 'alert');
  }
  /* The facts on one line: £65.00 · 1 Oct · Vets4Pets. */
  function factsOf(r) {
    const out = [];
    if (r.amount != null) out.push((r.destination === 'debt' ? 'balance ' : '') + money(r.amount));
    if (r.date) out.push(fmtDate(r.date, { short: true }));
    if (r.party && r.party !== r.title) out.push(r.party);
    if (r.due_date) out.push('due ' + fmtDate(r.due_date, { short: true }));
    if (r.expiry_date) out.push((r.destination === 'warranty' ? 'covered until ' : 'expires ') + fmtDate(r.expiry_date, { short: true }));
    if (r.monthly_payment != null) out.push(money(r.monthly_payment) + ' a month');
    if (r.reference) out.push('ref ' + r.reference);
    return out;
  }

  /* Destinations that can be yours or for work. */
  const EITHER = ['receipt', 'invoice_to_pay', 'invoice_owed_to_me', 'warranty', 'bill', 'document', 'task'];
  /* [Company's money] [Mine, get it back], for one item (an id) or for several (ids joined by commas). */
  function payerButtons(ids, all) {
    const n = esc(ids);
    return '<button type="button" class="btn btn--sm btn--ktk" data-payer="company" data-ids="' + n + '">' + icon('briefcase') + esc((all ? 'All ' + co() : co(true)) + '’s money') + '</button>' +
      '<button type="button" class="btn btn--sm btn--mine" data-payer="me" data-ids="' + n + '">' + icon('coin') + (all ? 'All mine, get them back' : 'Mine, get it back') + '</button>';
  }
  const btn = (attr, id, ico, label, cls) => '<button type="button" class="btn btn--sm' + (cls ? ' ' + cls : '') + '" ' + attr + '="' + esc(id) + '">' + (ico ? icon(ico) : '') + esc(label) + '</button>';

  function cardHTML(item, idx, nested) {
    const r = item.result;
    const id = esc(item.id);
    const thumbs = (item.files || []).length ? '<button type="button" class="doc-row__thumb hub-card__thumb" data-view="' + id + '" aria-label="View files">' + thumbHTML(item.files) + '</button>'
      : '<span class="thumb thumb--empty hub-card__thumb">' + icon('note') + '</span>';
    const label = (r && r.title) || item.note || (item.files[0] && item.files[0].name) || 'Item';
    if (item.status === 'reading') {
      return '<li class="hub-card is-reading">' + thumbs + '<div class="hub-card__main"><p class="hub-card__head"><b>' + esc(label) + '</b></p>' +
        '<p class="reading"><span class="spinner" aria-hidden="true"></span>' + (item.hint ? 'Sorting it again with what you said…' : 'Reading…') + '</p></div></li>';
    }
    const place = r && r.destination !== 'unsure' ? GU.brain.placeOf(r) : null;
    const dest = place ? place.label : 'Not sorted yet';
    const ask = asksPayer(r);
    const dup = r ? S().dupOf(item, idx) : null;
    const held = ui.held.get(item.id);
    // Things that can be either yours or for work get a Home / Work chip in place of the part's name.
    const part = r && /^(Home|Work) › /.test(dest) ? dest.slice(0, 4) : '';
    const flip = part && EITHER.includes(r.destination);
    const chip = part ? (flip ? '<button type="button" class="chip hub-card__part hub-card__part--' + part.toLowerCase() + '" data-flip="' + id + '" title="' +
      esc(part === 'Work' ? 'Not for ' + co() + '? Move it to Home' : 'For ' + co() + '? Move it to Work') + '">' + icon(part === 'Work' ? 'briefcase' : 'home') + part + '</button>'
      : '<span class="hub-card__part hub-card__part--static hub-card__part--' + part.toLowerCase() + '">' + icon(part === 'Work' ? 'briefcase' : 'home') + part + '</span>') : '';
    const { rest, fresh } = placeBits(part ? dest.slice(7) : dest, place);
    const facts = r ? factsOf(r) : [];
    const sum = r && r.summary && r.summary !== label ? r.summary : '';
    const why = r ? (r.rule ? icon('tag') + '<span>' + esc(r.why || 'By your rule') + '</span>' : r.why ? icon('info') + '<span>' + esc(r.why) + '</span>' : '') : '';
    const tell = ui.telling.has(item.id);
    return '<li class="hub-card' + (nested ? ' hub-card--nested' : '') + (dup ? ' has-dup' : '') + '" data-card="' + id + '">' + thumbs +
      '<div class="hub-card__main">' +
      '<p class="hub-card__head"><b>' + esc(label) + '</b>' + (facts.length ? '<span class="hub-card__facts">' + facts.map((f) => '<span>' + esc(f) + '</span>').join('') + '</span>' : '') + '</p>' +
      (sum ? '<p class="hub-card__sum">' + esc(sum) + '</p>' : !r ? '<p class="hub-card__sum">' + esc(item.error || 'I’m not sure what this is.') + '</p>' : '') +
      (item.note && r && item.note !== r.summary && item.note !== label ? '<p class="hub-card__note">You wrote: “' + esc(item.note.length > 160 ? item.note.slice(0, 160) + '…' : item.note) + '”</p>' : '') +
      (r ? '<p class="hub-card__dest">' + chip + '<span class="hub-card__to">' + icon('chevron') + '<b>' + esc(rest) + '</b></span>' + fresh + (ask || dup ? '' : confidenceLabel(r.confidence)) + '</p>' : '') +
      (why ? '<p class="hub-card__why">' + why + '</p>' : '') +
      (r && r.warning ? '<p class="field__help">' + esc(r.warning) + '</p>' : '') +
      (r && r.task_title ? '<p class="hub-card__why">' + icon('todo') + '<span>' + esc('Plus a task: ' + r.task_title + (r.task_due ? ' (' + fmtDate(r.task_due, { short: true }) + ')' : '')) + '</span></p>' : '') +
      (held && !dup ? '<p class="hub-card__held">' + icon('clock') + '<span>' + esc(held) + '</span></p>' : '') +
      (dup ? '<div class="hub-card__dup">' + icon('alert') + '<p>Looks like you already have this: <b>' + esc(dup.title) + '</b> in ' + esc(dup.label) + '.</p>' +
        '<span class="hub-card__dup-acts">' + btn('data-open-dup', item.id, 'eye', 'Open it') + ((item.files || []).length && ATTACHABLE.includes(dup.c) ? btn('data-dup-attach', item.id, 'clip', 'Add the file to it') : '') +
        btn('data-file-anyway', item.id, 'check', 'File anyway') + btn('data-discard', item.id, 'trash', 'Remove', 'btn--ghost') + '</span></div>' : '') +
      (ask ? '<p class="hub-card__ask">Whose money paid for this?</p>' : '') +
      (dup ? '' : '<div class="hub-card__actions">' +
        (ask ? payerButtons(item.id) : r && r.destination !== 'unsure' ? btn('data-file', item.id, 'check', ['bank_statement', 'order_history'].includes(r.destination) ? 'Open importer' : 'File it', 'btn--primary') : '') +
        btn('data-place', item.id, 'folder', r && r.destination !== 'unsure' ? 'Change place' : 'Choose where') +
        btn('data-tell', item.id, 'spark', 'Tell me where…', tell ? 'is-on' : '') +
        '<button type="button" class="btn btn--sm btn--ghost hub-card__more" data-more="' + id + '" aria-label="More for ' + esc(label) + '">' + icon('more') + '</button>' +
        btn('data-discard', item.id, 'trash', 'Remove', 'btn--ghost hub-card__remove') +
        '</div>') +
      (tell ? '<form class="hub-tell" data-tell-form="' + id + '"><label class="visually-hidden" for="tell-' + id + '">Tell me where this goes</label>' +
        '<input id="tell-' + id + '" name="hint" type="text" autocomplete="off" data-keep-focus value="' + esc(ui.tellText.get(item.id) || '') + '" placeholder="e.g. This is for the wedding · dad paid this · it’s a warranty for the fridge">' +
        '<button type="submit" class="btn btn--sm btn--primary">' + icon('send') + 'Sort it</button><button type="button" class="btn btn--sm btn--ghost" data-tell-cancel="' + id + '">Cancel</button></form>' : '') +
      (item.ruleOffer && S().placeById(item.ruleOffer.place) ? '<p class="hub-card__offer">' + icon('tag') + '<button type="button" class="link link--btn" data-rule-offer="' + id + '">' +
        esc('Always put “' + item.ruleOffer.match + '” in ' + S().placeById(item.ruleOffer.place).label) + '</button><button type="button" class="icon-btn icon-btn--sm" data-rule-skip="' + id + '" aria-label="No thanks">' + icon('x') + '</button></p>' : '') +
      '</div></li>';
  }

  /* A place's name without '(new section)', and the 'new section' marker that says so instead. */
  function placeBits(label, place) {
    const m = String(label).match(/\s*\((new [a-z ]+)\)$/);
    const rest = m ? label.slice(0, m.index) : label;
    const fresh = place && place.fresh ? '<span class="pill pill--new">' + icon('plus') + esc(m ? m[1] : 'new') + '</span>' : '';
    return { rest, fresh };
  }

  function groupHTML(g, idx) {
    const ids = g.items.map((i) => i.id);
    const key = esc(g.key);
    const open = ui.open.has(g.key);
    const asking = g.items.every((i) => asksPayer(i.result));
    const bits = placeBits(asking ? 'Work › Who paid?' : g.label, GU.brain.placeOf(g.items[0].result));
    return '<li class="hub-group' + (open ? ' is-open' : '') + '">' +
      '<div class="hub-group__head">' +
      '<span class="hub-group__stack" aria-hidden="true">' + thumbHTML(g.items[0].files) + '<em>' + g.items.length + '</em></span>' +
      '<div class="hub-group__text"><b>' + esc(g.title) + '</b><span class="hub-group__to"><span class="hub-card__to">' + icon('chevron') + '<b>' + esc(bits.rest) + '</b></span>' + bits.fresh + '</span>' +
      '<small>' + esc(g.items.map((i) => (i.result.amount != null ? money(i.result.amount) : i.result.title)).slice(0, 4).join(' · ') + (g.items.length > 4 ? ' …' : '')) + '</small></div>' +
      '<div class="hub-group__acts">' +
      (asking ? payerButtons(ids.join(','), true) : '<button type="button" class="btn btn--sm btn--primary" data-file-group="' + esc(ids.join(',')) + '">' + icon('check') + 'File all ' + g.items.length + '</button>') +
      '<button type="button" class="btn btn--sm" data-place-group="' + esc(ids.join(',')) + '">' + icon('folder') + 'Change place</button>' +
      '<button type="button" class="btn btn--sm btn--ghost" data-group-toggle="' + key + '" aria-expanded="' + open + '">' + (open ? 'Hide' : 'Show each') + '</button>' +
      '</div></div>' +
      (open ? '<ul class="hub-group__list">' + g.items.map((i) => cardHTML(i, idx, true)).join('') + '</ul>' : '') + '</li>';
  }

  /* Records a waiting file can be added to, when it looks like one you already have. */
  const ATTACHABLE = ['paperwork', 'sectionItems', 'documents', 'bills', 'visas', 'debts'];
  /* 'Add the file to it': the item's files join the record you already have, and the item goes (with Undo). */
  function attachToDup(item) {
    const d = S().dupOf(item);
    if (!d || !ATTACHABLE.includes(d.c)) return;
    const metas = (item.files || []).slice();
    const ids = metas.map((m) => m.id);
    const back = JSON.parse(JSON.stringify(item));
    store.commit((s) => {
      const rec = (s[d.c] || []).find((x) => x.id === d.rec.id);
      if (rec) rec.files = (rec.files || []).concat(metas);
      s.inbox = s.inbox.filter((i) => i.id !== item.id);
    });
    logChange({ label: 'Added ' + (metas.length > 1 ? plural(metas.length, 'file') : 'the file') + ' to “' + d.title + '”', where: d.label, tab: d.tab, ref: { c: d.c, id: d.rec.id }, by: 'you', undo: () => {
      store.commit((s) => {
        const rec = (s[d.c] || []).find((x) => x.id === d.rec.id);
        if (rec) rec.files = (rec.files || []).filter((f) => !ids.includes(f.id));
        if (!s.inbox.some((i) => i.id === back.id)) s.inbox.push(back);
      });
      return true;
    } });
    toast('Added to ' + d.title + ' in ' + d.label);
  }

  /* Clears waiting copies of files you've already filed: to Recently deleted, with one Undo for all of them. */
  function removeCopies(list) {
    const undos = list.map((it) => discard(it.id, { quiet: true })).filter(Boolean);
    logChange({ label: 'Removed ' + plural(undos.length, 'copy', 'copies') + ' of files you’d already filed', where: 'Settings › Recently deleted', by: 'you', undo: () => {
      undos.slice().reverse().forEach((u) => u());
      return true;
    } });
    toast('Removed ' + plural(undos.length, 'copy', 'copies') + '. Undo it from Recently sorted.');
  }

  /* Small, safe Markdown for the reply (bold and line breaks). */
  const mdLine = (t) => (GU.assistant && GU.assistant.kit ? GU.assistant.kit.md(t) : '<p>' + esc(t) + '</p>');
  function replyInner() {
    const r = reply;
    if (!r) return '';
    const changes = r.changes.map((id) => ({ id, l: store.state.filedLog.find((x) => x.id === id) })).filter((x) => x.l);
    const live = changes.filter((x) => undoers.has(x.id));
    return '<span class="hub-reply__mark">' + icon(r.offline ? 'funnel' : 'spark') + '</span>' +
      '<div class="hub-reply__body">' +
      (r.q ? '<p class="hub-reply__q"><span class="visually-hidden">You said: </span>“' + esc(r.q.length > 140 ? r.q.slice(0, 140) + '…' : r.q) + '”</p>' : '') +
      '<div class="hub-reply__text">' + (r.text ? mdLine(r.text) : '') +
      (r.busy ? '<p class="hub-reply__status"><span class="spinner" aria-hidden="true"></span><span>' + esc(r.status || 'Thinking…') + '</span></p>' : '') +
      (r.note ? '<p class="hub-reply__note' + (r.error ? ' is-error' : '') + '">' + esc(r.note) + (r.note === 'Connect Claude in Settings to sort with instructions.' ? ' <a class="link" href="#settings">Settings</a>' : '') + '</p>' : '') +
      (r.truncated ? '<p class="hub-reply__note">Claude stopped before the end. Ask for less at a time.</p>' : '') + '</div>' +
      (changes.length ? '<ul class="hub-reply__changes">' + changes.map((x) => '<li>' + icon('check') + '<span>' + esc(x.l.kind === 'change' ? x.l.summary : 'Filed “' + (x.l.title || '') + '” in ' + x.l.label) + '</span></li>').join('') + '</ul>' : '') +
      '</div>' +
      '<div class="hub-reply__acts">' +
      (r.busy ? '<button type="button" class="btn btn--sm" data-reply-stop>' + icon('stop') + 'Stop</button>'
        : (live.length && !r.undone ? '<button type="button" class="btn btn--sm" data-reply-undo>' + icon('undo') + (live.length > 1 ? 'Undo all' : 'Undo') + '</button>' : '') +
          (r.keep ? '<button type="button" class="btn btn--sm" data-reply-keep>' + icon('note') + 'Keep it as a note</button>' : '') +
          '<button type="button" class="icon-btn icon-btn--sm" data-reply-close aria-label="Dismiss">' + icon('x') + '</button>') +
      '</div>';
  }
  /* Redraws just the reply line (while Claude is writing). */
  function paintReply() {
    const el = document.querySelector('[data-hub-reply]');
    if (!el || !reply) return GU.render();
    el.innerHTML = replyInner();
    el.classList.toggle('is-busy', !!reply.busy);
  }

  function modeHTML(m) {
    const agent = conn && conn.tools >= 4;
    if (m === 'offline' && !agent) return icon('lock') + '<span>Sorting on this device. <a class="link" href="#settings">Connect Claude</a> to sort with instructions and read photos better.</span>';
    if (agent) return icon('spark') + '<span>Sorting with ' + esc(conn.kind === 'api' ? 'Claude (your API key)' : 'Claude') + '. Tell me what to do, or just drop things in.</span>';
    return icon('check') + '<span>Reading with ' + esc(GU.brain.modeLabel(m)) + '. Instructions are read on this device here.</span>';
  }
  function hints(agent) {
    const c = co();
    const list = agent
      ? ['Dentist 14 Nov 3pm', 'Paid £18 for printer paper for ' + c, 'Make a Pets section and put the vet bill in it', 'File everything you’re sure about', 'Move the Netlify receipt to Get paid back', 'Create a Gym category for PureGym payments']
      : ['Dentist 14 Nov 3pm', 'Paid £18 for printer paper', 'Make a Pets section', 'File everything you’re sure about', 'Always put Amazon in Get paid back'];
    return '<div class="hub-hints" aria-label="Things you can say"><span class="hub-hints__label">Try</span>' + list.map((h) => '<button type="button" class="chip hub-hint" data-hint="' + esc(h) + '">' + esc(h) + '</button>').join('') + '</div>';
  }

  function recentHTML(log) {
    if (!log.length) return '';
    const byLabel = { claude: 'by Claude', rule: 'by your rule', you: '' };
    return '<section class="panel hub-recent"><header class="panel__head"><h2>' + icon('check') + 'Recently sorted</h2><span class="muted">the last ' + Math.min(RECENT, log.length) + '</span></header><ul class="rows rows--tight">' + log.map((l) => {
      const ico = l.kind === 'change' ? (l.by === 'claude' ? 'spark' : 'funnel') : l.by === 'rule' ? 'tag' : l.by === 'claude' ? 'spark' : 'check';
      const meta = [fmtDate(l.date, { short: true }), l.kind === 'change' ? '' : l.label, byLabel[l.by] || (l.via && l.via !== 'offline' ? 'read by ' + GU.brain.modeLabel(l.via).replace(/ \(.*\)/, '') : '')].filter(Boolean).join(' · ');
      return '<li class="row-item' + (l.kind === 'change' ? ' row-item--change' : '') + '"><span class="row-item__icon">' + icon(ico) + '</span><span class="row-item__text"><b>' + esc(l.summary || l.title) + '</b><em>' + esc(meta) + '</em></span>' +
        '<span class="row-item__act">' + (l.ref || l.tab ? '<button type="button" class="btn btn--sm btn--ghost" data-open-log="' + esc(l.id) + '">Open</button>' : '') +
        (undoers.has(l.id) ? '<button type="button" class="btn btn--sm btn--ghost" data-undo="' + esc(l.id) + '">Undo</button>' : '') + '</span></li>';
    }).join('') + '</ul></section>';
  }
  function rulesHTML() {
    const list = S().rules();
    return '<details class="panel panel--details hub-rules"' + (ui.rulesOpen ? ' open' : '') + '><summary class="panel__head"><h2>' + icon('tag') + 'Your rules</h2><span class="muted">' +
      (list.length ? plural(list.length, 'rule') : 'none yet') + icon('chevron', 'hub-rules__chev') + '</span></summary>' +
      '<div class="panel__intro">Rules are used before anything is read: “Always put PureGym in Spending › Gym”. Make one here, from a card after you change its place, or by saying “always…”.</div>' +
      (list.length ? '<ul class="rows rows--tight">' + list.map((x) => '<li class="row-item"><span class="row-item__icon">' + icon('tag') + '</span><span class="row-item__text"><b>' + esc(S().ruleLabel(x)) + '</b><em>' + esc('Added ' + fmtDate(x.created, { short: true })) + '</em></span>' +
        '<span class="row-item__act"><button type="button" class="btn btn--sm btn--ghost" data-rule-remove="' + esc(x.id) + '">Remove</button></span></li>').join('') + '</ul>' : '') +
      '<div class="panel__foot"><button type="button" class="btn btn--sm" data-rule-new>' + icon('plus') + 'New rule</button>' +
      '<label class="check hub-rules__auto"><input type="checkbox" data-auto-file' + (store.state.settings.autoFile !== false ? ' checked' : '') + '><span>File automatically when I’m sure</span></label></div></details>';
  }
  function newRule() {
    const ps = S().places().filter((p) => p.kind !== 'doctype');
    const order = ['page', 'section', 'list', 'category', 'folder', 'visa'];
    const groupsOf = order.map((k) => ({ group: { page: 'Pages', section: 'Sections', list: 'To-do lists', category: 'Your categories', folder: 'Work folders', visa: 'Visa applications' }[k], options: ps.filter((p) => p.kind === k).map((p) => ({ value: p.id, label: p.label })) })).filter((g) => g.options.length);
    formDialog({
      title: 'New rule',
      intro: 'Anything from or mentioning these words goes straight to the place you choose.',
      fields: [
        { name: 'match', label: 'From or mentioning', required: true, placeholder: 'e.g. PureGym, Amazon, Vets4Pets' },
        { name: 'place', label: 'Always put it in', type: 'select', options: groupsOf },
        { name: 'payer', label: 'Who pays (work bills)', type: 'segmented', options: [{ value: 'company', label: co(true) + ' pays' }, { value: 'me', label: 'I pay, get it back' }], showIf: (v) => v.place === 'work-bills' },
      ],
      submitLabel: 'Add rule',
      onSubmit: (v) => {
        try {
          const res = S().addRule(v.match, v.place, { payer: v.place === 'work-bills' ? v.payer : null });
          logChange({ label: 'Added a rule: ' + res.label.replace(/^Always/, 'always'), where: S().placeById(v.place).label, by: 'you', undo: res.undo });
          toast(res.label);
        } catch (e) {
          toast(e.message);
          return false;
        }
      },
    });
  }

  function render(root) {
    const s = store.state;
    const all = s.inbox;
    const reading = all.filter((i) => i.status === 'reading');
    const ready = all.filter((i) => i.status !== 'reading');
    const idx = S().dupIndex(s);
    const asking = ready.filter((i) => asksPayer(i.result) && !S().dupOf(i, idx));
    const statements = ready.filter((i) => i.result && i.result.destination === 'bank_statement');
    const sortable = ready.filter((i) => !S().holdReason(i, idx));
    const work = inWork();
    const log = s.filedLog.slice(0, RECENT);
    const agent = !!(conn && conn.tools >= 4);
    GU.brain.mode().then((m) => {
      const changed = m !== modeCache;
      modeCache = m;
      return checkConn().then(() => {
        const el = root.querySelector('[data-mode]');
        if (el) el.innerHTML = modeHTML(m);
        const nowAgent = !!(conn && conn.tools >= 4);
        if ((changed && m !== 'offline') || nowAgent !== agent) GU.render();
      });
    });

    // Similar things together; the rest one by one, waiting ones first.
    const loose = ready.filter((i) => !S().dupOf(i, idx));
    // The very same file, already filed: one tap clears them all from here.
    const copies = ready.filter((i) => (S().dupOf(i, idx) || {}).same === 'file');
    const groups = S().groups(loose);
    const grouped = new Set(groups.flatMap((g) => g.items.map((i) => i.id)));
    const singles = ready.filter((i) => !grouped.has(i.id));
    const shownSingles = singles.slice(0, 60);
    const busy = !!(reply && reply.busy);

    root.innerHTML = GU.view.head({
      eyebrow: 'Home and Work · Your assistant',
      title: 'Sorting hub',
      text: 'Put anything here, or tell me what to do. I’ll work out where each thing goes and file it in Home or Work, and make a new place when nothing fits.',
      actions: '<button type="button" class="btn btn--ghost" data-where-help>' + icon('info') + 'Where does it go?</button>',
    }) +
      '<form class="hub-compose" data-compose>' +
      '<label class="visually-hidden" for="hub-box">Drop, paste or type anything, or tell me what to do</label>' +
      '<textarea id="hub-box" name="note" rows="3" data-keep-focus placeholder="Drop, paste or type anything, or tell me what to do.">' + esc(ui.draft) + '</textarea>' +
      '<div class="hub-compose__bar">' +
      '<span class="hub-compose__tools">' +
      '<button type="button" class="icon-btn" data-pick-files aria-label="Choose files" data-tip="Choose files">' + icon('file') + '</button>' +
      '<button type="button" class="icon-btn" data-pick-camera aria-label="Take a photo" data-tip="Take a photo">' + icon('camera') + '</button>' +
      '<button type="button" class="icon-btn" data-pick-folder aria-label="Choose a folder" data-tip="Choose a folder">' + icon('folder') + '</button>' +
      '<input type="file" multiple hidden accept="' + GU.ui.ACCEPT + '" data-file-input><input type="file" hidden accept="image/*" capture="environment" data-camera-input></span>' +
      '<p class="hub-compose__mode" data-mode>' + modeHTML(modeCache) + '</p>' +
      '<button type="submit" class="btn btn--primary hub-compose__send"' + (busy ? ' disabled title="Claude is still working on the last one"' : '') + '>' + icon('funnel') + 'Sort it</button>' +
      '</div>' +
      '<div class="hub-compose__over" aria-hidden="true">' + icon('upload') + '<b>Drop to sort</b></div>' +
      '</form>' +
      (reply ? '<div class="hub-reply' + (reply.busy ? ' is-busy' : '') + (reply.error ? ' is-error' : '') + '" data-hub-reply role="status" aria-live="polite">' + replyInner() + '</div>' : hints(agent)) +
      (work ? '<p class="hub-part">' + icon('briefcase') + '<span>You’re in Work, so what you add here is filed for ' + esc(co()) + '. <button type="button" class="link link--btn" data-part-home>File in Home instead</button></span></p>' : '') +
      (copies.length > 1 ? '<section class="ask-card hub-ask hub-copies" aria-label="Already filed"><header class="ask-card__head"><h2>' + icon('alert') + 'Already filed</h2>' +
        '<p>' + esc(plural(copies.length, 'thing') + ' here ' + (copies.length === 1 ? 'is' : 'are') + ' the very same file' + (copies.length === 1 ? '' : 's') + ' as something you’ve already filed. Remove them from here and keep the ones you have. You can undo it.') + '</p>' +
        '<div class="ask-card__opts"><button type="button" class="btn btn--sm btn--primary" data-remove-copies="' + esc(copies.map((i) => i.id).join(',')) + '">' + icon('trash') + 'Remove the ' + copies.length + ' copies</button></div></header></section>' : '') +
      (asking.length > 1 ? '<section class="ask-card hub-ask" aria-label="Whose money paid?"><header class="ask-card__head"><h2>' + icon('coin') + 'Whose money paid?</h2>' +
        '<p>' + esc(plural(asking.length, 'thing') + ' for ' + co() + ' need an answer. If ' + co() + ' paid, they go in ' + (parts() ? parts().paysLabel(s) : 'Company pays') + '. If you paid, they go in Get paid back so you can claim the money.') + '</p>' +
        '<div class="ask-card__opts">' + payerButtons(asking.map((i) => i.id).join(','), true) + '</div></header></section>' : '') +
      '<section class="panel hub-waiting"><header class="panel__head"><h2>' + icon('funnel') + 'Waiting to be sorted' + (all.length ? ' <span class="hub-count">' + all.length + '</span>' : '') + '</h2><span class="panel__tools">' +
      (reading.length ? '<span class="reading"><span class="spinner" aria-hidden="true"></span>Reading ' + reading.length + '…</span>' : '') +
      (statements.length > 1 ? '<button type="button" class="btn btn--sm" data-import-all>' + icon('bank') + 'Import all ' + statements.length + ' statements</button>' : '') +
      (ready.length ? '<button type="button" class="btn btn--sm' + (sortable.length ? ' btn--primary' : '') + '" data-sort-all title="Files everything I’m sure about. The rest stay, each with the reason.">' + icon('funnel') + 'Sort everything' + (sortable.length ? ' (' + sortable.length + ')' : '') + '</button>' : '') +
      '</span></header>' +
      (all.length ? '<ul class="hub-list">' + groups.map((g) => groupHTML(g, idx)).join('') + shownSingles.map((i) => cardHTML(i, idx)).join('') + reading.slice(0, 6).map((i) => cardHTML(i, idx)).join('') + '</ul>' +
        (singles.length > 60 ? '<p class="panel__foot muted">Showing 60 of ' + singles.length + '. Sort some to see the rest.</p>' : '')
        : '<div class="panel__body">' + emptyState({ icon: 'funnel', title: 'All sorted', text: 'Nothing is waiting. Drop files here, paste a screenshot, or type a note or an instruction above.' }) + '</div>') + '</section>' +
      recentHTML(log) +
      rulesHTML() +
      '<div class="dropcover" hidden><div>' + icon('upload') + '<b>Drop to sort it</b></div></div>';

    wire(root);
  }

  function wire(root) {
    const form = root.querySelector('[data-compose]');
    const box = form.elements.note;
    const fileInput = root.querySelector('[data-file-input]');
    const camInput = root.querySelector('[data-camera-input]');
    const takeText = () => {
      const note = box.value;
      box.value = '';
      ui.draft = '';
      return note;
    };
    const send = () => {
      const text = box.value;
      if (!text.trim()) return box.focus();
      if (reply && reply.busy) return;
      takeText();
      submit(text);
    };
    // The box grows with what's typed, up to about half the screen.
    const grow = () => {
      box.style.height = 'auto';
      box.style.height = Math.min(box.scrollHeight + 2, Math.round(window.innerHeight * 0.45)) + 'px';
    };
    if (ui.draft) grow();
    box.addEventListener('input', () => {
      ui.draft = box.value;
      grow();
    });
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      send();
    });
    box.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && (e.metaKey || e.ctrlKey || box.value.indexOf('\n') < 0)) {
        e.preventDefault();
        send();
      }
    });
    box.addEventListener('paste', (e) => {
      const files = Array.from((e.clipboardData && e.clipboardData.files) || []);
      if (files.length) {
        e.preventDefault();
        add({ files, note: takeText() });
      }
    });
    root.querySelector('[data-pick-files]').addEventListener('click', () => fileInput.click());
    root.querySelector('[data-pick-camera]').addEventListener('click', () => camInput.click());
    root.querySelector('[data-pick-folder]').addEventListener('click', async () => {
      const files = await GU.ui.pickFolder();
      if (!files.length) return toast('That folder has no files I can read.');
      add({ files, note: takeText() });
    });
    [fileInput, camInput].forEach((inp) => inp.addEventListener('change', () => {
      const files = Array.from(inp.files || []);
      if (files.length) add({ files, note: takeText() });
      inp.value = '';
    }));
    // Drop anywhere on the page.
    const cover = root.querySelector('.dropcover');
    let depth = 0;
    const hasFiles = (e) => e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files');
    root.addEventListener('dragenter', (e) => {
      if (!hasFiles(e)) return;
      depth++;
      cover.hidden = false;
      form.classList.add('is-over');
    });
    root.addEventListener('dragleave', () => {
      depth = Math.max(0, depth - 1);
      if (!depth) {
        cover.hidden = true;
        form.classList.remove('is-over');
      }
    });
    root.addEventListener('dragover', (e) => hasFiles(e) && e.preventDefault());
    root.addEventListener('drop', (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      cover.hidden = true;
      form.classList.remove('is-over');
      const note = takeText();
      GU.ui.filesFromDrop(e.dataTransfer).then((files) => (files.length ? add({ files, note }) : toast('There were no files I can read in that.')));
    });
    const auto = root.querySelector('[data-auto-file]');
    if (auto) auto.addEventListener('change', (e) => store.commit((st) => (st.settings.autoFile = e.target.checked)));
    const rulesBox = root.querySelector('.hub-rules');
    if (rulesBox) rulesBox.addEventListener('toggle', () => (ui.rulesOpen = rulesBox.open));
    root.querySelectorAll('[data-tell-form]').forEach((f) => {
      const id = f.getAttribute('data-tell-form');
      f.elements.hint.addEventListener('input', () => ui.tellText.set(id, f.elements.hint.value));
      f.addEventListener('submit', (e) => {
        e.preventDefault();
        const item = store.find('inbox', id);
        if (item) tellWhere(item, f.elements.hint.value);
      });
      f.elements.hint.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          ui.telling.delete(id);
          GU.render();
        }
      });
    });

    root.addEventListener('click', (e) => {
      const find = (attr) => {
        const b = e.target.closest('[' + attr + ']');
        return b ? { b, item: store.state.inbox.find((i) => i.id === b.getAttribute(attr)) } : null;
      };
      const items = (attr) => {
        const b = e.target.closest('[' + attr + ']');
        return b ? String(b.getAttribute(attr)).split(',').map((id) => store.state.inbox.find((i) => i.id === id)).filter(Boolean) : null;
      };
      let hit;
      const h = e.target.closest('[data-hint]');
      if (h) {
        box.value = h.dataset.hint;
        ui.draft = box.value;
        box.focus();
        box.setSelectionRange(box.value.length, box.value.length);
        return;
      }
      const pay = e.target.closest('[data-payer]');
      if (pay) return answerPayer(String(pay.dataset.ids || '').split(',').filter(Boolean), pay.dataset.payer);
      if ((hit = find('data-flip')) && hit.item) return flipPart(hit.item);
      if (e.target.closest('[data-part-home]') && parts()) {
        parts().set('home');
        return GU.render();
      }
      if (e.target.closest('[data-sort-all]')) return sortEverything();
      if (e.target.closest('[data-import-all]')) return importAllStatements();
      if (e.target.closest('[data-reply-stop]')) return reply && reply.ctl && reply.ctl.abort();
      if (e.target.closest('[data-reply-undo]')) return undoReply();
      if (e.target.closest('[data-reply-close]')) {
        reply = null;
        return GU.render();
      }
      if (e.target.closest('[data-reply-keep]')) {
        const text = reply && reply.q;
        reply = null;
        ui.draft = '';
        return text ? add({ note: text }).then(() => GU.render()) : null;
      }
      if (e.target.closest('[data-rule-new]')) return newRule();
      const rr = e.target.closest('[data-rule-remove]');
      if (rr) {
        const back = S().removeRule(rr.dataset.ruleRemove);
        if (back) toast('Rule removed', { action: 'Undo', onAction: back });
        return;
      }
      const g = e.target.closest('[data-group-toggle]');
      if (g) {
        const k = g.dataset.groupToggle;
        if (ui.open.has(k)) ui.open.delete(k);
        else ui.open.add(k);
        return GU.render();
      }
      let list;
      if ((list = items('data-file-group'))) return fileGroup(list.map((i) => i.id));
      if ((list = items('data-remove-copies'))) return removeCopies(list);
      if ((list = items('data-place-group'))) return choosePlace(list, e.target.closest('[data-place-group]'));
      if ((hit = find('data-file')) && hit.item) return fileItem(hit.item, hit.item.result);
      if ((hit = find('data-place')) && hit.item) return choosePlace([hit.item], hit.b);
      if ((hit = find('data-tell')) && hit.item) {
        if (ui.telling.has(hit.item.id)) ui.telling.delete(hit.item.id);
        else ui.telling.add(hit.item.id);
        GU.render();
        const inp = document.getElementById('tell-' + hit.item.id);
        if (inp) inp.focus();
        return;
      }
      if ((hit = find('data-tell-cancel')) && hit.item) {
        ui.telling.delete(hit.item.id);
        return GU.render();
      }
      if ((hit = find('data-more')) && hit.item) {
        const it = hit.item;
        const r = it.result;
        const opts = [];
        if (r && !NOT_FILEABLE.includes(r.destination)) opts.push({ icon: 'edit', label: 'Check details first', hint: 'Open its form, filled in', onClick: () => editAndFile(it) });
        if ((it.files || []).length) opts.push({ icon: 'eye', label: it.files.length > 1 ? 'View the ' + it.files.length + ' files' : 'View the file', onClick: () => viewFiles(it.files, 0, (r && r.title) || it.note || 'Files') });
        if ((it.files || []).length) opts.push({ icon: 'download', label: it.files.length > 1 ? 'Download all ' + it.files.length : 'Download', onClick: () => GU.ui.downloadFiles(it.files.map((f) => f.id), (r && r.title) || 'Files') });
        if (r && EITHER.includes(r.destination)) opts.push({ icon: r.context === 'work' ? 'home' : 'briefcase', label: r.context === 'work' ? 'Move to Home' : 'Move to Work', onClick: () => flipPart(it) });
        if ((it.files || []).length || it.note) opts.push({ icon: 'repeat', label: 'Read it again', onClick: () => {
          store.commit(() => {
            it.status = 'reading';
            it.result = null;
          });
          pump();
        } });
        opts.push({ icon: 'trash', label: 'Remove', hint: 'It goes to Recently deleted', onClick: () => discard(it.id) });
        return menu(hit.b, opts);
      }
      if ((hit = find('data-rule-offer')) && hit.item && hit.item.ruleOffer) {
        const o = hit.item.ruleOffer;
        try {
          const res = S().addRule(o.match, o.place, { payer: o.payer });
          logChange({ label: 'Added a rule: ' + res.label.replace(/^Always/, 'always'), where: S().placeById(o.place).label, by: 'you', undo: res.undo });
          store.commit(() => (hit.item.ruleOffer = null));
          toast(res.label + '. It’s used from now on.');
        } catch (err) {
          toast(err.message);
        }
        return;
      }
      if ((hit = find('data-rule-skip')) && hit.item) return store.commit(() => (hit.item.ruleOffer = null));
      if ((hit = find('data-open-dup')) && hit.item) {
        const d = S().dupOf(hit.item);
        if (d) {
          if (d.tab) GU.view.go(d.tab);
          setTimeout(() => GU.view.open({ c: d.c, id: d.rec.id }), 60);
        }
        return;
      }
      if ((hit = find('data-file-anyway')) && hit.item) return store.commit(() => (hit.item.dupOk = true));
      if ((hit = find('data-dup-attach')) && hit.item) return attachToDup(hit.item);
      if ((hit = find('data-discard')) && hit.item) return discard(hit.item.id);
      if ((hit = find('data-view')) && hit.item) return viewFiles(hit.item.files, 0, hit.item.note || 'Files');
      const u = e.target.closest('[data-undo]');
      if (u && undoers.has(u.dataset.undo)) return undo(u.dataset.undo);
      const o = e.target.closest('[data-open-log]');
      if (o) {
        const l = store.state.filedLog.find((x) => x.id === o.dataset.openLog);
        if (l) {
          if (l.tab) GU.view.go(l.tab);
          if (l.ref) setTimeout(() => GU.view.open(l.ref), 50);
        }
      }
    });
  }

  /* Pasting a screenshot anywhere on the hub (not into another box) adds it. */
  document.addEventListener('paste', (e) => {
    if (location.hash !== '#hub') return;
    const t = e.target;
    if (t && t.closest && (t.closest('input, textarea, [contenteditable]') || t.closest('dialog'))) return;
    const files = Array.from((e.clipboardData && e.clipboardData.files) || []);
    if (!files.length) return;
    e.preventDefault();
    add({ files });
  });

  /* Pick up anything left half-read when the page was closed. */
  function resume() {
    if (store.state.inbox.some((i) => i.status === 'reading')) pump();
  }

  /* Once only: whatever was waiting when the Sorting hub took over from the Inbox goes to Recently deleted
     (files kept, 30 days to change your mind), so the hub starts empty and only handles what you add from now on. */
  function startFresh() {
    const s = store.state;
    if (s.meta && s.meta.hubFreshV1) return;
    const old = (s.inbox || []).filter((i) => !i.demo);
    const entries = [];
    store.commit((st) => {
      st.meta = st.meta || {};
      st.meta.hubFreshV1 = { at: new Date().toISOString(), n: old.length };
      const ids = new Set(old.map((i) => i.id));
      st.inbox = st.inbox.filter((i) => !ids.has(i.id));
      old.forEach((item) => {
        entries.push(GU.trash.put(st, 'inbox', Object.assign({}, item, { status: item.status === 'reading' ? 'reading' : 'ready' }),
          (item.result && item.result.title) || (item.files && item.files[0] && item.files[0].name) || item.note || 'Sorting hub item'));
      });
    });
    if (!old.length) return;
    GU.ui.toast('Cleared ' + plural(old.length, 'item') + ' from the Sorting hub. They’re in Settings › Recently deleted for 30 days.', {
      timeout: 12000,
      action: 'Undo',
      onAction: () => {
        GU.ui.quietly(() => entries.forEach((e) => GU.trash.restore(e.id)));
        store.commit((st) => {
          st.meta.hubFreshV1 = Object.assign({}, st.meta.hubFreshV1, { undone: true });
        });
      },
    });
  }

  GU.hub = { add, resume, startFresh, fileItem, answerPayer, sortEverything, logChange, undo, discard, setSuggestion, submit, tellWhere, choosePlace, AUTO_FILE_AT };
  GU.inbox = GU.hub; // older callers
  GU.tabs.hub = { label: 'Sorting hub', short: 'Sorting hub', icon: 'funnel', part: 'shared', render };
})();
