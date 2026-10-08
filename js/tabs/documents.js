/* The Ground Up: Important documents, in Home. Passports, licences, certificates, contracts and policies,
   with expiry reminders, where the paper copy lives, and scans attached.
   Documents for work (context 'work') live in Work › Contracts & documents, so this page leaves them out and
   says where they are. The form is shared with Work: its 'For' field moves a document across. */
(function () {
  'use strict';
  const GU = window.GU;
  const { esc, uid, today, fmtDate, relDays, daysUntil, mask, debounce, plural } = GU.util;
  const { icon, pill, emptyState, chips, formDialog, toast, thumbHTML, viewFiles } = GU.ui;
  const store = GU.store;
  /* Where a page is in the menu, for toasts and signposts: 'Work › Orders & claims › Get paid back'. */
  const at = (tab, fallback) => (GU.parts && GU.parts.pathOf && GU.tabs && GU.tabs[tab] ? GU.parts.pathOf(tab) : fallback);

  const TYPES = [
    'Passport', 'ID card or driving licence', 'Residence permit or eVisa', 'Birth, marriage or death certificate',
    'Education and qualifications', 'Employment and payslips', 'Contract or agreement', 'Tax', 'Insurance policy', 'Home and tenancy',
    'Vehicle', 'Medical and health', 'Bank, savings and pension', 'Legal (will, power of attorney)', 'Other',
  ];
  /* open / shut: the type groups you've opened or closed yourself, kept here so a redraw doesn't undo them. */
  const ui = { type: 'all', q: '', open: new Set(), shut: new Set() };
  const OPEN_GROUPS = 3; // the first groups with documents in them start open, the rest are a line with their count
  const revealed = new Set();
  const isWork = (d) => (GU.parts ? GU.parts.isWorkDoc(d) : !!d && d.context === 'work');
  const workDocsTab = () => (GU.tabs['work-docs'] ? 'work-docs' : 'work');
  const WORK_PAGE = () => at('work-docs', 'Work › Contracts & documents');
  function employer() {
    return GU.workMoney ? GU.workMoney.employer(store.state) : { set: false, short: '', label: 'the company' };
  }

  /* One line pointing to Work, so work documents don't look lost. */
  function signpostHTML(work) {
    if (!work.length) return '';
    const names = work.map((d) => d.title).filter(Boolean);
    const shown = names.slice(0, 2).join(', ') + (names.length > 2 ? ' and ' + (names.length - 2) + ' more' : '');
    return '<p class="note-line note-line--signpost">' + icon('briefcase') + '<span>' + esc(plural(work.length, 'work document') + (shown ? ' (' + shown + ')' : '') + (work.length === 1 ? ' is' : ' are') + ' in ') +
      '<a class="link" href="#' + workDocsTab() + '">' + esc(WORK_PAGE) + '</a>.</span></p>';
  }

  function expiryPill(d) {
    if (!d.expiryDate) return pill('No expiry', 'muted');
    const n = daysUntil(d.expiryDate);
    const warn = store.state.settings.docWarnDays || 90;
    if (n < 0) return pill('Expired ' + fmtDate(d.expiryDate, { short: true }), 'crit', 'alert');
    if (n <= warn) return pill('Expires ' + relDays(d.expiryDate), n <= 30 ? 'crit' : 'warn', 'clock');
    return pill('Valid until ' + fmtDate(d.expiryDate, { short: true }), 'good', 'check');
  }

  /* grouped: inside its type's group, so the type and 'No expiry' (most of them) aren't said on every row. */
  function rowHTML(d, grouped) {
    const ref = d.reference ? '<span class="ref">' + esc(revealed.has(d.id) ? d.reference : mask(d.reference)) +
      ' <button type="button" class="link link--btn" data-reveal="' + esc(d.id) + '">' + (revealed.has(d.id) ? 'Hide' : 'Show') + '</button></span>' : '';
    return '<li class="doc-row">' +
      '<button type="button" class="doc-row__thumb" data-view="' + esc(d.id) + '" aria-label="' + (d.files && d.files.length ? 'View scans of ' : 'Add a scan to ') + esc(d.title) + '">' + thumbHTML(d.files) + '</button>' +
      '<div class="doc-row__main"><button type="button" class="doc-row__title" data-edit="' + esc(d.id) + '"><b>' + esc(d.title) + '</b></button>' +
      '<em>' + esc([d.holder, d.location ? 'Kept: ' + d.location : '', d.folder ? 'Folder: ' + d.folder : ''].filter(Boolean).join(' · ')) + (ref ? (d.holder || d.location || d.folder ? ' · ' : '') + ref : '') + '</em>' +
      '<span class="doc-row__chips">' + (grouped ? '' : pill(d.type || 'Other', 'muted')) + (grouped && !d.expiryDate ? '' : expiryPill(d)) + '</span></div>' +
      '<span class="doc-row__end"><span class="doc-row__btns">' + GU.ui.dlButton(d.files, d.title) + '<button type="button" class="icon-btn" data-edit="' + esc(d.id) + '" aria-label="Edit ' + esc(d.title) + '">' + icon('edit') + '</button></span></span></li>';
  }

  function render(root) {
    const s = store.state;
    const warn = s.settings.docWarnDays || 90;
    const docs = s.documents.filter((d) => !isWork(d)).sort((a, b) => (a.title || '').localeCompare(b.title || ''));
    const work = s.documents.filter(isWork);
    const soon = docs.filter((d) => d.expiryDate && daysUntil(d.expiryDate) <= warn).sort((a, b) => a.expiryDate.localeCompare(b.expiryDate));
    const present = TYPES.filter((t) => docs.some((d) => d.type === t));
    const q = ui.q.toLowerCase();
    const list = docs.filter((d) => (ui.type === 'all' || d.type === ui.type) && (!q || [d.title, d.holder, d.type, d.location, d.notes].join(' ').toLowerCase().includes(q)));
    // A document that's due for renewal is listed under Renew soon; it isn't repeated in its type below, unless you're searching or looking at one type.
    const dedupe = ui.type === 'all' && !q;
    const soonIds = new Set(soon.map((d) => d.id));
    const grouped = TYPES.map((t) => ({ type: t, items: list.filter((d) => (d.type || 'Other') === t && !(dedupe && soonIds.has(d.id))) })).filter((g) => g.items.length);

    root.innerHTML = GU.view.head({
      eyebrow: 'Paperwork',
      title: 'Important documents',
      text: 'Passports, licences, certificates, contracts and policies. Keep a scan of each, note where the original is, and I’ll warn you ' + warn + ' days before anything expires.',
      actions: '<button type="button" class="btn btn--primary" data-add>' + icon('plus') + 'Add document</button>',
    }) +
      signpostHTML(work) +
      GU.ui.dropbar('Drop documents here, or a whole folder of them', 'Scans, photos and PDFs. I’ll read each one for its type, number and expiry date. Subfolders like Passports or Insurance set the type.') +
      (soon.length ? '<section class="panel panel--alert"><header class="panel__head"><h2>' + icon('alert') + 'Renew soon</h2></header><ul class="doc-rows">' + soon.map(rowHTML).join('') + '</ul></section>' : '') +
      '<div class="toolbar">' + chips('type', [{ value: 'all', label: 'All', count: docs.length }].concat(present.map((t) => ({ value: t, label: t, count: docs.filter((d) => d.type === t).length }))), ui.type) +
      '<label class="search">' + icon('search') + '<input type="search" id="doc-search" placeholder="Search documents" value="' + esc(ui.q) + '" aria-label="Search documents"></label></div>' +
      (grouped.length ? grouped.map((g, i) => {
        // Looking for something (a search, or one type chosen) opens what matches; otherwise the first few groups are open.
        const auto = !!q || ui.type !== 'all' || i < OPEN_GROUPS;
        const isOpen = ui.open.has(g.type) || (!ui.shut.has(g.type) && auto);
        return '<section class="panel doc-group' + (isOpen ? ' is-open' : '') + '"><h2 class="doc-group__h"><button type="button" class="doc-group__btn" data-group="' + esc(g.type) + '" aria-expanded="' + isOpen + '">' + icon('chevron') +
          '<span class="doc-group__name">' + esc(g.type) + '</span><span class="muted">' + g.items.length + '</span></button></h2>' +
          (isOpen ? '<ul class="doc-rows">' + g.items.map((d) => rowHTML(d, true)).join('') + '</ul>' : '') + '</section>';
      }).join('')
        : dedupe && list.length ? '' : '<section class="panel">' + emptyState({ icon: 'folder', title: docs.length ? 'Nothing matches' : 'No documents yet', text: docs.length ? 'Try another search.' : 'Start with your passport, driving licence and tenancy or mortgage papers.', action: docs.length ? '' : '<button type="button" class="btn btn--primary" data-add>' + icon('plus') + 'Add a document</button>' }) + '</section>') +
      '<p class="privacy-note">' + icon('lock') + 'Documents and scans are stored only in this browser. Reference numbers are hidden until you tap Show.</p>';

    GU.ui.wireDropbar(root, (files) => GU.inbox.add({ files, scope: { kind: 'documents', name: 'Important documents' } }));
    const search = root.querySelector('#doc-search');
    search.addEventListener('input', debounce(() => {
      ui.q = search.value;
      ui.shut.clear();
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
        ui.shut.clear();
        return GU.render();
      }
      const grp = e.target.closest('[data-group]');
      if (grp) {
        const k = grp.dataset.group;
        const now = grp.getAttribute('aria-expanded') === 'true';
        ui.open[now ? 'delete' : 'add'](k);
        ui.shut[now ? 'add' : 'delete'](k);
        return GU.render();
      }
      if (e.target.closest('[data-add]')) return create({ context: 'home' });
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
    const e = employer();
    return [
      { name: 'title', label: 'Document', required: true, placeholder: 'e.g. Passport, Tenancy agreement, Car insurance' },
      { name: 'context', label: 'For', type: 'segmented', default: 'home',
        options: [{ value: 'home', label: 'Home', icon: 'home' }, { value: 'work', label: e.set ? 'Work (' + e.short + ')' : 'Work', icon: 'briefcase' }],
        help: 'Payslips, P60s and tax papers ' + (e.set ? 'from ' + e.short + ' ' : '') + 'are about your own pay, so they stay in Home.' },
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

  const goWork = () => GU.view.go(workDocsTab());
  /* Says where a document went when it isn't on the page you're looking at. */
  function filedToast(rec, verb, undo) {
    const work = rec.context === 'work';
    const here = (GU.parts ? GU.parts.get() : 'home') === (work ? 'work' : 'home');
    if (here && !undo) return toast('Added ' + rec.title);
    toast(verb + ' ' + rec.title + ' to ' + (work ? WORK_PAGE() : at('documents', 'Home › Documents')),
      undo ? { action: 'Undo', onAction: undo } : { action: 'Open', onAction: work ? goWork : () => GU.view.go('documents') });
  }

  /* prefill.context says Home or Work; with none, it's the part you're in. */
  function create(prefill, opts) {
    opts = opts || {};
    prefill = Object.assign({}, prefill || {});
    const context = prefill.context === 'work' || prefill.context === 'home' ? prefill.context : GU.parts && GU.parts.get() === 'work' ? 'work' : 'home';
    formDialog({
      title: context === 'work' ? 'Add a work document' : 'Add a document',
      fields: fields(),
      values: Object.assign({ type: 'Other' }, prefill, { context }),
      initialFiles: opts.files,
      submitLabel: 'Add document',
      onSubmit: (v) => {
        const rec = Object.assign({ id: 'd-' + uid(), created: today() }, v);
        store.upsert('documents', rec);
        filedToast(rec, 'Added');
        if (opts.onSaved) opts.onSaved(rec);
      },
    });
  }

  function edit(id) {
    const d = store.find('documents', id);
    if (!d) return;
    const was = isWork(d) ? 'work' : 'home';
    formDialog({
      title: 'Edit ' + d.title,
      fields: fields(),
      values: Object.assign({}, d, { context: was }),
      onSubmit: (v) => {
        const rec = Object.assign({}, d, v);
        store.upsert('documents', rec);
        if (v.context !== was) filedToast(rec, 'Moved', () => store.upsert('documents', d));
      },
      onDelete: () => {
        store.remove('documents', id, d.title);
      },
      deleteMessage: 'This deletes the record and its scans. You can undo it, and it stays in Settings → Recently deleted for 30 days.',
    });
  }

  GU.tabs.documents = { label: 'Important documents', short: 'Documents', icon: 'folder', part: 'home', render, create, edit, TYPES };
})();
