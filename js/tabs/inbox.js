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
  const undoers = new Map();
  let running = false;
  let modeCache = 'offline';

  /* ---------- queue ---------- */
  async function add(input) {
    const files = input.files || [];
    const note = (input.note || '').trim();
    if (!files.length && !note) return;

    // Quick notes ("call the dentist tomorrow") are filed instantly without waiting for Claude.
    if (!files.length) {
      const quick = await GU.brain.quick(note).catch(() => null);
      if (quick && quick.destination === 'order_history') return GU.tabs.receipts.importOrders(note);
      if (quick && quick.confidence >= 0.8 && ['task', 'transaction_out', 'transaction_in'].includes(quick.destination)) {
        fileItem({ id: 'in-' + uid(), created: today(), note, files: [] }, quick);
        return;
      }
      const item = { id: 'in-' + uid(), created: today(), note, files: [], status: 'reading' };
      store.commit((s) => s.inbox.push(item));
      return pump();
    }
    // Each file is its own item: dropping 200 invoices (or a whole folder) gives 200 records.
    const from = GU.ui.folderSummary(files);
    if (files.length > 1 || from) readingToast = toast('Reading ' + plural(files.length, 'file') + (from ? ' from ' + from : '') + '. I’ll tell you when they’re filed.', { timeout: 60000 });
    let chunk = [];
    const flush = () => {
      const items = chunk;
      chunk = [];
      if (items.length) store.commit((s) => s.inbox.push(...items));
      pump();
    };
    for (const f of files) {
      const meta = await GU.files.add(f);
      const path = GU.ui.pathOf(f);
      if (path !== meta.name) meta.path = path;
      chunk.push({ id: 'in-' + uid(), created: today(), note, files: [meta], status: 'reading' });
      if (chunk.length >= 20) flush();
    }
    flush();
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

  /* Returns true when the item was filed automatically. */
  function settle(item, quiet) {
    const r = item.result;
    if (!r) return false;
    const auto = store.state.settings.autoFile !== false;
    if (auto && r.confidence >= AUTO_FILE_AT && !['unsure', 'bank_statement', 'order_history'].includes(r.destination)) {
      fileItem(item, r, { quiet });
      return true;
    }
    // A single spreadsheet opens its importer straight away (you still confirm there).
    if (!quiet && ['bank_statement', 'order_history'].includes(r.destination)) {
      fileItem(item, r);
      return true;
    }
    if (!quiet && location.hash !== '#inbox') toast('Something needs a quick check in your Inbox', { action: 'Review', onAction: () => GU.view.go('inbox') });
    return false;
  }

  /* Files an inbox item using a (possibly edited) result. */
  function fileItem(item, result, opts) {
    if (result.destination === 'bank_statement') return openImporter(item);
    if (result.destination === 'order_history') return openOrders(item);
    const res = GU.brain.file(result, item.files || [], item.note);
    if (!res) return;
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

  /* Files every item that has a suggestion, in one go. */
  function fileAll() {
    const items = store.state.inbox.filter((i) => i.status !== 'reading' && i.result && !['unsure', 'bank_statement', 'order_history'].includes(i.result.destination));
    let n = 0;
    for (const it of items) {
      const live = store.state.inbox.find((x) => x.id === it.id);
      if (!live) continue;
      fileItem(live, live.result, { quiet: true });
      n++;
    }
    toast('Filed ' + plural(n, 'item') + '. Each one can be undone from Filed recently.');
  }

  async function openOrders(item) {
    const m = (item.files || [])[0];
    const rec = m && (await GU.files.get(m.id));
    if (!rec) return toast('The order list is missing. Try uploading it again.');
    GU.tabs.receipts.importOrders(new File([rec.blob], m.name, { type: m.type || 'text/csv' }));
    discard(item.id, true);
  }

  async function openImporter(item) {
    const m = (item.files || [])[0];
    const rec = m && (await GU.files.get(m.id));
    if (!rec) return toast('The statement file is missing. Try uploading it again.');
    GU.tabs.transactions.importCSV(new File([rec.blob], m.name, { type: m.type || 'text/csv' }));
    discard(item.id, true);
  }

  function discard(id, keepQuiet) {
    const item = store.state.inbox.find((i) => i.id === id);
    if (!item) return;
    (item.files || []).forEach((f) => GU.files.remove(f.id));
    store.commit((s) => (s.inbox = s.inbox.filter((i) => i.id !== id)));
    if (!keepQuiet) toast('Removed from Inbox');
  }

  /* Opens the destination's own form, prefilled, so details can be checked before filing. */
  function editAndFile(item) {
    const r = item.result || {};
    const files = item.files || [];
    const done = () => {
      store.commit((s) => {
        s.inbox = s.inbox.filter((i) => i.id !== item.id);
        s.filedLog.unshift({ id: 'log-' + uid(), date: today(), summary: r.summary || r.title, title: r.title, label: GU.brain.where(r), tab: null, ref: null, via: r.via, files: files.length });
        s.filedLog = s.filedLog.slice(0, 40);
      });
    };
    const kinds = { receipt: 'receipt', invoice_to_pay: 'invoice-in', invoice_owed_to_me: 'invoice-out', warranty: 'warranty' };
    switch (r.destination) {
      case 'receipt': case 'invoice_to_pay': case 'invoice_owed_to_me': case 'warranty':
        return GU.tabs.receipts.create({ values: { kind: kinds[r.destination], context: r.context, title: r.title, party: r.party, amount: r.amount, date: r.date || today(), dueDate: r.due_date,
          status: r.paid ? 'paid' : 'unpaid', warrantyUntil: r.expiry_date, reference: r.reference, category: r.category, notes: r.notes || item.note, files }, onSaved: done });
      case 'bill':
        return GU.tabs.bills.create({ name: r.title, payee: r.party, amount: r.amount, frequency: r.frequency || 'monthly', nextDue: r.due_date || r.date || today(), category: r.category || 'Bills & utilities', notes: r.notes, files }, { onSaved: done });
      case 'document':
        return GU.tabs.documents.create({ title: r.title, type: r.document_type || 'Other', reference: r.reference, issueDate: r.date, expiryDate: r.expiry_date, notes: [r.summary, r.notes].filter(Boolean).join('\n'), files }, { onSaved: done });
      case 'visa':
        if (r.visa_id) return fileItem(item, r);
        return GU.tabs.visas.create({ visaType: r.title, reference: r.reference, notes: r.notes, files }, { onSaved: done });
      case 'task':
        return GU.tabs.todos.create({ title: r.title, due: r.due_date || '', notes: item.note && item.note !== r.title ? item.note : '' }, { onSaved: done });
      case 'transaction_out': case 'transaction_in':
        return GU.tabs.transactions.create({ direction: r.destination === 'transaction_in' ? 'in' : 'out', description: r.party || r.title, amount: r.amount, date: r.date || today(), category: r.category, notes: r.notes }, { onSaved: done });
      case 'section':
        return GU.sections.createItem(r.section_id || { name: r.new_section_name || 'New section' }, { title: r.title, party: r.party, amount: r.amount, date: r.date, dueDate: r.due_date || r.expiry_date, reference: r.reference, notes: [r.summary, r.notes].filter(Boolean).join('\n'), files }, { onSaved: done, byAssistant: true });
      case 'bank_statement':
        return openImporter(item);
      case 'order_history':
        return openOrders(item);
      default:
        return choosePlace(item, null);
    }
  }

  /* Lets you change where an item should go. */
  function choosePlace(item, anchor) {
    const set = (patch) => {
      store.commit(() => {
        item.result = Object.assign(item.result || { title: item.note || (item.files[0] && item.files[0].name) || 'Item', confidence: 1, context: 'home' }, patch, { confidence: 1, summary: (item.result && item.result.summary) || '' });
        item.status = 'ready';
      });
    };
    const s = store.state;
    const opts = [
      { icon: 'receipt', label: 'Receipt', onClick: () => set({ destination: 'receipt' }) },
      { icon: 'receipt', label: 'Invoice to pay', onClick: () => set({ destination: 'invoice_to_pay', paid: false }) },
      { icon: 'check', label: 'Paid invoice', onClick: () => set({ destination: 'invoice_to_pay', paid: true }) },
      { icon: 'coin', label: 'Invoice someone owes me', onClick: () => set({ destination: 'invoice_owed_to_me' }) },
      { icon: 'shield', label: 'Warranty or guarantee', onClick: () => set({ destination: 'warranty' }) },
      { icon: 'bills', label: 'Regular bill', onClick: () => set({ destination: 'bill' }) },
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
      }) }]);
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
    if (r.amount != null) out.push(money(r.amount));
    if (r.date) out.push(fmtDate(r.date, { short: true }));
    if (r.due_date) out.push('due ' + fmtDate(r.due_date, { short: true }));
    if (r.expiry_date) out.push((r.destination === 'warranty' ? 'covered until ' : 'expires ') + fmtDate(r.expiry_date, { short: true }));
    if (r.reference) out.push('ref ' + r.reference);
    if (r.context === 'work') out.push('Work');
    if (r.task_title) out.push('+ task: ' + r.task_title + (r.task_due ? ' (' + fmtDate(r.task_due, { short: true }) + ')' : ''));
    return out.map((x) => '<span class="detail">' + esc(x) + '</span>').join('');
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
    return '<li class="inbox-card">' + thumbs +
      '<div class="inbox-card__main">' +
      '<p class="inbox-card__summary">' + esc(r && r.summary ? r.summary : item.error || 'I’m not sure what this is.') + '</p>' +
      (item.note && r && item.note !== r.summary ? '<p class="inbox-card__note">You wrote: “' + esc(item.note) + '”</p>' : '') +
      (r ? '<p class="inbox-card__dest">' + icon('chevron') + '<b>' + esc(dest) + '</b>' + confidenceLabel(r.confidence) + '</p><p class="details">' + detailChips(r) + '</p>' : '') +
      (r && r.warning ? '<p class="field__help">' + esc(r.warning) + '</p>' : '') +
      '<div class="inbox-card__actions">' +
      (r && r.destination !== 'unsure' ? '<button type="button" class="btn btn--sm btn--primary" data-file="' + esc(item.id) + '">' + icon('check') + (['bank_statement', 'order_history'].includes(r.destination) ? 'Open importer' : 'File it') + '</button>' : '') +
      '<button type="button" class="btn btn--sm" data-place="' + esc(item.id) + '">' + icon('folder') + (r && r.destination !== 'unsure' ? 'Somewhere else' : 'Choose where') + '</button>' +
      (r && !['unsure', 'bank_statement', 'order_history'].includes(r.destination) ? '<button type="button" class="btn btn--sm" data-details="' + esc(item.id) + '">' + icon('edit') + 'Check details</button>' : '') +
      '<button type="button" class="btn btn--sm btn--ghost" data-discard="' + esc(item.id) + '">' + icon('trash') + 'Remove</button>' +
      '</div></div></li>';
  }

  function render(root) {
    const s = store.state;
    const reading = s.inbox.filter((i) => i.status === 'reading');
    const ready = s.inbox.filter((i) => i.status !== 'reading');
    const fileable = ready.filter((i) => i.result && !['unsure', 'bank_statement', 'order_history'].includes(i.result.destination));
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
      text: 'Throw anything at me: photos of receipts, invoices, letters, screenshots, emails or quick notes. I’ll work out what each one is and file it in the right place, or start a new section when nothing fits.',
    }) +
      '<form class="thrower" data-throw>' +
      '<label class="visually-hidden" for="inbox-note">Type or paste anything</label>' +
      '<textarea id="inbox-note" name="note" rows="3" placeholder="Type or paste anything: “Dentist on 14 Nov at 3pm”, “Paid £20 to the window cleaner”, an email from your landlord… or paste a screenshot."></textarea>' +
      '<div class="thrower__drop" tabindex="0" role="button" aria-label="Upload files">' + icon('upload') + '<span><b>Drop photos, PDFs, files or whole folders here</b><small>or tap to choose files or take a photo. Folders inside folders are included too.</small></span><input type="file" multiple accept="' + GU.ui.ACCEPT + '" hidden id="inbox-file"></div>' +
      '<div class="thrower__pick"><button type="button" class="btn btn--sm" data-pick-files>' + icon('file') + 'Choose files</button><button type="button" class="btn btn--sm" data-pick-folder>' + icon('folder') + 'Choose a folder</button></div>' +
      '<div class="thrower__foot"><p class="thrower__mode" data-mode>' + modeHTML(modeCache) + '</p>' +
      '<label class="check"><input type="checkbox" id="auto-file"' + (s.settings.autoFile !== false ? ' checked' : '') + '><span>File automatically when I’m sure</span></label>' +
      '<button type="submit" class="btn btn--primary">' + icon('check') + 'Sort it</button></div>' +
      '</form>' +
      '<section class="panel"><header class="panel__head"><h2>Waiting for you</h2><span class="panel__tools">' +
      (reading.length ? '<span class="reading"><span class="spinner" aria-hidden="true"></span>Reading ' + reading.length + ' more…</span>' : '') +
      (fileable.length > 1 ? '<button type="button" class="btn btn--sm btn--primary" data-file-all>' + icon('check') + 'File all ' + fileable.length + '</button>' : '') +
      (!reading.length && fileable.length <= 1 ? '<span class="muted">' + (waiting.length ? plural(waiting.length, 'item') : 'all clear') + '</span>' : '') + '</span></header>' +
      (waiting.length ? '<ul class="inbox-list">' + shown.map(cardHTML).join('') + '</ul>' +
        (ready.length > 60 ? '<p class="panel__foot muted">Showing 60 of ' + ready.length + '. File some to see the rest.</p>' : '')
        : '<div class="panel__body">' + emptyState({ icon: 'check', title: 'Nothing waiting', text: 'Everything you’ve sent me has been filed.' }) + '</div>') + '</section>' +
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
      if (e.target.closest('[data-file-all]')) return fileAll();
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

  GU.inbox = { add, resume, fileItem };
  GU.tabs.inbox = { label: 'Inbox', short: 'Inbox', icon: 'inbox', render };
})();
