/* The Ground Up: Important documents. Passports, licences, certificates, contracts and policies,
   with expiry reminders, where the paper copy lives, and scans attached. */
(function () {
  'use strict';
  const GU = window.GU;
  const { esc, uid, today, fmtDate, relDays, daysUntil, mask, debounce } = GU.util;
  const { icon, pill, emptyState, chips, formDialog, toast, thumbHTML, viewFiles } = GU.ui;
  const store = GU.store;

  const TYPES = [
    'Passport', 'ID card or driving licence', 'Residence permit or eVisa', 'Birth, marriage or death certificate',
    'Education and qualifications', 'Employment and payslips', 'Tax', 'Insurance policy', 'Home and tenancy',
    'Vehicle', 'Medical and health', 'Bank, savings and pension', 'Legal (will, power of attorney)', 'Other',
  ];
  const ui = { type: 'all', q: '' };
  const revealed = new Set();

  function expiryPill(d) {
    if (!d.expiryDate) return pill('No expiry', 'muted');
    const n = daysUntil(d.expiryDate);
    const warn = store.state.settings.docWarnDays || 90;
    if (n < 0) return pill('Expired ' + fmtDate(d.expiryDate, { short: true }), 'crit', 'alert');
    if (n <= warn) return pill('Expires ' + relDays(d.expiryDate), n <= 30 ? 'crit' : 'warn', 'clock');
    return pill('Valid until ' + fmtDate(d.expiryDate, { short: true }), 'good', 'check');
  }

  function rowHTML(d) {
    const ref = d.reference ? '<span class="ref">' + esc(revealed.has(d.id) ? d.reference : mask(d.reference)) +
      ' <button type="button" class="link link--btn" data-reveal="' + esc(d.id) + '">' + (revealed.has(d.id) ? 'Hide' : 'Show') + '</button></span>' : '';
    return '<li class="doc-row">' +
      '<button type="button" class="doc-row__thumb" data-view="' + esc(d.id) + '" aria-label="' + (d.files && d.files.length ? 'View scans of ' : 'Add a scan to ') + esc(d.title) + '">' + thumbHTML(d.files) + '</button>' +
      '<div class="doc-row__main"><button type="button" class="doc-row__title" data-edit="' + esc(d.id) + '"><b>' + esc(d.title) + '</b></button>' +
      '<em>' + esc([d.holder, d.location ? 'Kept: ' + d.location : ''].filter(Boolean).join(' · ')) + (ref ? (d.holder || d.location ? ' · ' : '') + ref : '') + '</em>' +
      '<span class="doc-row__chips">' + pill(d.type || 'Other', 'muted') + expiryPill(d) + '</span></div>' +
      '<span class="doc-row__end"><button type="button" class="icon-btn" data-edit="' + esc(d.id) + '" aria-label="Edit ' + esc(d.title) + '">' + icon('edit') + '</button></span></li>';
  }

  function render(root) {
    const s = store.state;
    const warn = s.settings.docWarnDays || 90;
    const docs = s.documents.slice().sort((a, b) => a.title.localeCompare(b.title));
    const soon = docs.filter((d) => d.expiryDate && daysUntil(d.expiryDate) <= warn).sort((a, b) => a.expiryDate.localeCompare(b.expiryDate));
    const present = TYPES.filter((t) => docs.some((d) => d.type === t));
    const q = ui.q.toLowerCase();
    const list = docs.filter((d) => (ui.type === 'all' || d.type === ui.type) && (!q || [d.title, d.holder, d.type, d.location, d.notes].join(' ').toLowerCase().includes(q)));
    const grouped = TYPES.map((t) => ({ type: t, items: list.filter((d) => (d.type || 'Other') === t) })).filter((g) => g.items.length);

    root.innerHTML = GU.view.head({
      eyebrow: 'Paperwork',
      title: 'Important documents',
      text: 'Passports, licences, certificates, contracts and policies. Keep a scan of each, note where the original is, and I’ll warn you ' + warn + ' days before anything expires.',
      actions: '<button type="button" class="btn btn--primary" data-add>' + icon('plus') + 'Add document</button>',
    }) +
      (soon.length ? '<section class="panel panel--alert"><header class="panel__head"><h2>' + icon('alert') + 'Renew soon</h2></header><ul class="doc-rows">' + soon.map(rowHTML).join('') + '</ul></section>' : '') +
      '<div class="toolbar">' + chips('type', [{ value: 'all', label: 'All', count: docs.length }].concat(present.map((t) => ({ value: t, label: t, count: docs.filter((d) => d.type === t).length }))), ui.type) +
      '<label class="search">' + icon('search') + '<input type="search" id="doc-search" placeholder="Search documents" value="' + esc(ui.q) + '" aria-label="Search documents"></label></div>' +
      (grouped.length ? grouped.map((g) => '<section class="panel"><header class="panel__head"><h2>' + esc(g.type) + '</h2><span class="muted">' + g.items.length + '</span></header><ul class="doc-rows">' + g.items.map(rowHTML).join('') + '</ul></section>').join('')
        : '<section class="panel">' + emptyState({ icon: 'folder', title: docs.length ? 'Nothing matches' : 'No documents yet', text: docs.length ? 'Try another search.' : 'Start with your passport, driving licence and tenancy or mortgage papers.', action: docs.length ? '' : '<button type="button" class="btn btn--primary" data-add>' + icon('plus') + 'Add a document</button>' }) + '</section>') +
      '<p class="privacy-note">' + icon('lock') + 'Documents and scans are stored only in this browser. Reference numbers are hidden until you tap Show.</p>';

    const search = root.querySelector('#doc-search');
    search.addEventListener('input', debounce(() => {
      ui.q = search.value;
      GU.render();
      const again = document.getElementById('doc-search');
      if (again) {
        again.focus();
        again.setSelectionRange(again.value.length, again.value.length);
      }
    }, 250));
    root.addEventListener('click', (e) => {
      const c = e.target.closest('[data-chip]');
      if (c) {
        ui.type = c.dataset.value;
        return GU.render();
      }
      if (e.target.closest('[data-add]')) return create();
      const r = e.target.closest('[data-reveal]');
      if (r) {
        const id = r.dataset.reveal;
        if (revealed.has(id)) revealed.delete(id);
        else revealed.add(id);
        return GU.render();
      }
      const v = e.target.closest('[data-view]');
      if (v) {
        const d = store.find('documents', v.dataset.view);
        if (d && d.files && d.files.length) viewFiles(d.files, 0, d.title);
        else edit(v.dataset.view);
        return;
      }
      const ed = e.target.closest('[data-edit]');
      if (ed) edit(ed.dataset.edit);
    });
  }

  function fields() {
    return [
      { name: 'title', label: 'Document', required: true, placeholder: 'e.g. Passport, Tenancy agreement, Car insurance' },
      { name: 'type', label: 'Type', type: 'select', options: TYPES, default: 'Other', half: true },
      { name: 'holder', label: 'Whose is it?', placeholder: 'e.g. Me, Mum, the car', half: true, optional: true },
      { name: 'reference', label: 'Number or reference', half: true, optional: true, help: 'Hidden on screen until you choose to show it.' },
      { name: 'location', label: 'Where the original is kept', placeholder: 'e.g. Blue folder, top drawer', half: true, optional: true },
      { name: 'issueDate', label: 'Issued', type: 'date', half: true, optional: true },
      { name: 'expiryDate', label: 'Expires or renews', type: 'date', half: true, optional: true },
      { name: 'files', label: 'Scans or photos', type: 'files', dropLabel: 'Add a scan or photo of each page' },
      { name: 'notes', label: 'Notes', type: 'textarea', rows: 2, optional: true },
    ];
  }

  function create(prefill, opts) {
    opts = opts || {};
    formDialog({
      title: 'Add a document',
      fields: fields(),
      values: Object.assign({ type: 'Other' }, prefill || {}),
      initialFiles: opts.files,
      submitLabel: 'Add document',
      onSubmit: (v) => {
        const rec = Object.assign({ id: 'd-' + uid(), created: today() }, v);
        store.upsert('documents', rec);
        toast('Added ' + rec.title);
        if (opts.onSaved) opts.onSaved(rec);
      },
    });
  }

  function edit(id) {
    const d = store.find('documents', id);
    if (!d) return;
    formDialog({
      title: 'Edit ' + d.title,
      fields: fields(),
      values: d,
      onSubmit: (v) => store.upsert('documents', Object.assign({}, d, v)),
      onDelete: () => {
        store.remove('documents', id);
        toast('Deleted ' + d.title);
      },
      deleteMessage: 'This deletes the record and its scans from this browser. Keep a backup if you might need them.',
    });
  }

  GU.tabs.documents = { label: 'Important documents', short: 'Documents', icon: 'folder', render, create, edit, TYPES };
})();
