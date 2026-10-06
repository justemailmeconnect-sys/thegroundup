/* The Ground Up: Receipts & invoices. Every receipt, invoice to pay, invoice someone owes you,
   paid invoice and warranty, for home and for work, each with its photo or PDF. */
(function () {
  'use strict';
  const GU = window.GU;
  const { esc, uid, today, money, fmtDate, relDays, daysUntil, sum, plural, debounce } = GU.util;
  const { icon, pill, emptyState, chips, formDialog, toast, thumbHTML, viewFiles } = GU.ui;
  const F = GU.finance;
  const store = GU.store;

  const KINDS = [
    { value: 'receipt', label: 'Receipt' },
    { value: 'invoice-in', label: 'Invoice I need to pay' },
    { value: 'invoice-out', label: 'Invoice I’ve sent (someone owes me)' },
    { value: 'warranty', label: 'Warranty or guarantee' },
  ];
  const KIND_SHORT = { receipt: 'Receipt', 'invoice-in': 'Invoice', 'invoice-out': 'Sent invoice', warranty: 'Warranty' };
  const ui = { filter: 'all', context: 'all', q: '' };

  const isInvoice = (p) => p.kind === 'invoice-in' || p.kind === 'invoice-out';
  function statusPill(p) {
    if (isInvoice(p)) {
      if (p.status === 'paid') return pill(p.kind === 'invoice-out' ? 'Paid to you' : 'Paid', 'good', 'check');
      if (p.dueDate) {
        const n = daysUntil(p.dueDate);
        if (n < 0) return pill((p.kind === 'invoice-out' ? 'Late ' : 'Overdue ') + -n + 'd', 'crit', 'alert');
        if (n <= 7) return pill('Due ' + relDays(p.dueDate), 'warn', 'clock');
        return pill('Due ' + fmtDate(p.dueDate, { short: true }), 'muted', 'clock');
      }
      return pill(p.kind === 'invoice-out' ? 'Not paid yet' : 'To pay', 'warn');
    }
    if (p.warrantyUntil) {
      const n = daysUntil(p.warrantyUntil);
      if (n < 0) return pill('Warranty ended', 'muted');
      return pill('Covered until ' + fmtDate(p.warrantyUntil, { short: true }), n <= 30 ? 'warn' : 'good', 'shield');
    }
    return '';
  }

  function matches(p) {
    if (ui.context !== 'all' && p.context !== ui.context) return false;
    if (ui.filter === 'receipt' && p.kind !== 'receipt') return false;
    if (ui.filter === 'to-pay' && !(p.kind === 'invoice-in' && p.status !== 'paid')) return false;
    if (ui.filter === 'owed' && !(p.kind === 'invoice-out' && p.status !== 'paid')) return false;
    if (ui.filter === 'paid' && !(isInvoice(p) && p.status === 'paid')) return false;
    if (ui.filter === 'warranty' && !(p.kind === 'warranty' || (p.warrantyUntil && p.warrantyUntil >= today()))) return false;
    if (ui.filter === 'claim' && !(p.claim && !p.claimed)) return false;
    const q = ui.q.toLowerCase();
    if (q && ![p.title, p.party, p.reference, p.notes, p.category].join(' ').toLowerCase().includes(q)) return false;
    return true;
  }

  function rowHTML(p) {
    let act = '';
    if (isInvoice(p) && p.status !== 'paid') act = '<button type="button" class="btn btn--sm btn--soft" data-pay="' + esc(p.id) + '">' + icon('check') + (p.kind === 'invoice-out' ? 'Got paid' : 'Paid') + '</button>';
    return '<li class="doc-row">' +
      '<button type="button" class="doc-row__thumb" data-view="' + esc(p.id) + '" aria-label="' + (p.files && p.files.length ? 'View files for ' : 'Add a file to ') + esc(p.title) + '">' + thumbHTML(p.files) + '</button>' +
      '<button type="button" class="doc-row__main" data-edit="' + esc(p.id) + '">' +
      '<b>' + esc(p.title) + '</b>' +
      '<em>' + esc([p.party, fmtDate(p.date, { short: true }), p.reference].filter(Boolean).join(' · ')) + '</em>' +
      '<span class="doc-row__chips">' + pill(KIND_SHORT[p.kind] || 'Item', 'kind-' + p.kind) + pill(p.context === 'work' ? 'Work' : 'Home', 'muted', p.context === 'work' ? 'briefcase' : 'home') +
      statusPill(p) + (p.claim && !p.claimed ? pill('Claim back', 'info', 'flag') : '') + '</span></button>' +
      '<span class="doc-row__end">' + (p.amount != null ? '<b class="' + (p.kind === 'invoice-out' ? 'is-in' : '') + '">' + esc(money(p.amount)) + '</b>' : '') + act + '</span></li>';
  }

  function render(root) {
    const s = store.state;
    const t = today();
    const all = s.paperwork;
    const toPay = all.filter((p) => p.kind === 'invoice-in' && p.status !== 'paid');
    const owed = all.filter((p) => p.kind === 'invoice-out' && p.status !== 'paid');
    const warranties = all.filter((p) => p.warrantyUntil && p.warrantyUntil >= t);
    const claims = all.filter((p) => p.claim && !p.claimed);
    const thisMonth = all.filter((p) => (p.created || p.date || '').slice(0, 7) === t.slice(0, 7));
    const counts = {
      all: all.length, receipt: all.filter((p) => p.kind === 'receipt').length, 'to-pay': toPay.length, owed: owed.length,
      paid: all.filter((p) => isInvoice(p) && p.status === 'paid').length, warranty: warranties.length, claim: claims.length,
    };
    const filterOpts = [
      { value: 'all', label: 'Everything' }, { value: 'receipt', label: 'Receipts' }, { value: 'to-pay', label: 'To pay' },
      { value: 'owed', label: 'Owed to me' }, { value: 'paid', label: 'Paid invoices' }, { value: 'warranty', label: 'Warranties' },
    ].concat(claims.length ? [{ value: 'claim', label: 'To claim back' }] : []).map((o) => Object.assign(o, { count: counts[o.value] }));

    const sorted = () => {
      const list = all.filter(matches);
      if (ui.filter === 'to-pay' || ui.filter === 'owed') return list.sort((a, b) => (a.dueDate || '9').localeCompare(b.dueDate || '9'));
      if (ui.filter === 'warranty') return list.sort((a, b) => (a.warrantyUntil || '').localeCompare(b.warrantyUntil || ''));
      return list.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    };

    root.innerHTML = GU.view.head({
      eyebrow: 'Paperwork',
      title: 'Receipts & invoices',
      text: 'Snap or upload every receipt, invoice and warranty the moment you get it. Your assistant reads it and fills in the details.',
      actions: '<button type="button" class="btn btn--primary" data-upload>' + icon('camera') + 'Upload</button>',
    }) +
      '<label class="dropbar" tabindex="0"><input type="file" multiple accept="' + GU.ui.ACCEPT + '" hidden id="rc-file">' + icon('upload', 'drop__icon') +
      '<span><b>Drop receipts, invoices or warranty cards here</b><small>or tap to take a photo or choose files. Photos and PDFs both work.</small></span></label>' +
      '<div class="ledger">' +
      '<div><span>Invoices to pay</span><b>' + esc(money(sum(toPay, (p) => p.amount || 0))) + '</b><em>' + esc(plural(toPay.length, 'invoice')) + (toPay.filter((p) => p.dueDate && p.dueDate < t).length ? ' · ' + toPay.filter((p) => p.dueDate && p.dueDate < t).length + ' overdue' : '') + '</em></div>' +
      '<div><span>Owed to you</span><b>' + esc(money(sum(owed, (p) => p.amount || 0))) + '</b><em>' + esc(plural(owed.length, 'invoice')) + ' sent</em></div>' +
      '<div><span>Under warranty</span><b>' + warranties.length + '</b><em>' + (warranties.length ? 'next ends ' + esc(fmtDate(warranties.map((p) => p.warrantyUntil).sort()[0], { short: true })) : 'items covered') + '</em></div>' +
      '<div><span>Filed this month</span><b>' + thisMonth.length + '</b><em>' + esc(plural(all.length, 'item')) + ' in total</em></div>' +
      '</div>' +
      '<div class="toolbar">' + chips('filter', filterOpts, ui.filter) + '<span class="toolbar__gap"></span>' +
      chips('context', [{ value: 'all', label: 'Home & work' }, { value: 'home', label: 'Home' }, { value: 'work', label: 'Work' }], ui.context) +
      '<label class="search">' + icon('search') + '<input type="search" id="rc-search" placeholder="Search" value="' + esc(ui.q) + '" aria-label="Search receipts and invoices"></label></div>' +
      '<section class="panel"><ul class="doc-rows" id="rc-list"></ul></section>';

    const draw = () => {
      const list = sorted();
      root.querySelector('#rc-list').innerHTML = list.length ? list.map(rowHTML).join('')
        : '<li>' + emptyState({ icon: 'receipt', title: all.length ? 'Nothing matches' : 'Nothing filed yet', text: all.length ? 'Try another filter or search.' : 'Upload your first receipt or invoice above.' }) + '</li>';
      GU.ui.hydrate(root);
    };
    draw();

    root.querySelector('#rc-search').addEventListener('input', debounce((e) => {
      ui.q = e.target.value;
      draw();
    }, 150));
    const input = root.querySelector('#rc-file');
    input.addEventListener('change', () => input.files.length && create({ files: Array.from(input.files) }));
    const bar = root.querySelector('.dropbar');
    bar.addEventListener('keydown', (e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), input.click()));
    bar.addEventListener('dragover', (e) => (e.preventDefault(), bar.classList.add('is-over')));
    bar.addEventListener('dragleave', () => bar.classList.remove('is-over'));
    bar.addEventListener('drop', (e) => {
      e.preventDefault();
      bar.classList.remove('is-over');
      const files = Array.from(e.dataTransfer.files || []);
      if (files.length) create({ files });
    });
    root.addEventListener('click', (e) => {
      const c = e.target.closest('[data-chip]');
      if (c) {
        ui[c.dataset.chip] = c.dataset.value;
        return GU.render();
      }
      if (e.target.closest('[data-upload]')) return create({ pick: true });
      const pay = e.target.closest('[data-pay]');
      if (pay) return markPaid(pay.dataset.pay);
      const v = e.target.closest('[data-view]');
      if (v) {
        const p = store.find('paperwork', v.dataset.view);
        if (p && p.files && p.files.length) viewFiles(p.files, 0, p.title);
        else edit(v.dataset.view);
        return;
      }
      const ed = e.target.closest('[data-edit]');
      if (ed) edit(ed.dataset.edit);
    });
  }

  function fields() {
    const exp = F.EXPENSE;
    return [
      { name: 'files', label: 'Photo or PDF', type: 'files', dropLabel: 'Add the receipt, invoice or warranty' },
      { name: 'kind', label: 'What is it?', type: 'select', options: KINDS, half: true },
      { name: 'context', label: 'For', type: 'segmented', options: [{ value: 'home', label: 'Home', icon: 'home' }, { value: 'work', label: 'Work', icon: 'briefcase' }], half: true },
      { name: 'title', label: 'Description', required: true, placeholder: 'e.g. New TV, Boiler repair, Website design' },
      { name: 'party', label: 'Shop, company or person', placeholder: 'e.g. Currys, Hart & Sons Plumbing', optional: true },
      { name: 'amount', label: 'Amount', type: 'money', half: true, optional: true },
      { name: 'date', label: 'Date on it', type: 'date', half: true },
      { name: 'dueDate', label: 'Due date', type: 'date', half: true, optional: true, showIf: (v) => v.kind === 'invoice-in' || v.kind === 'invoice-out' },
      { name: 'status', label: 'Paid yet?', type: 'segmented', options: [{ value: 'unpaid', label: 'Not paid' }, { value: 'paid', label: 'Paid' }], half: true, showIf: (v) => v.kind === 'invoice-in' || v.kind === 'invoice-out' },
      { name: 'paidDate', label: 'Date paid', type: 'date', half: true, showIf: (v) => (v.kind === 'invoice-in' || v.kind === 'invoice-out') && v.status === 'paid' },
      { name: 'warrantyUntil', label: 'Warranty or returns until', type: 'date', half: true, optional: true, help: 'I’ll remind you before it ends.' },
      { name: 'reference', label: 'Invoice, order or policy number', half: true, optional: true },
      { name: 'category', label: 'Spending category', type: 'select', options: exp, placeholder: 'Choose a category', half: true, showIf: (v) => v.kind !== 'invoice-out' },
      { name: 'claim', label: 'Claim back', type: 'checkbox', checkLabel: 'I need to claim this back (work expenses)', showIf: (v) => v.context === 'work' && v.kind !== 'invoice-out' },
      { name: 'claimed', label: 'Claimed', type: 'checkbox', checkLabel: 'Already claimed back', showIf: (v) => v.claim && v.context === 'work' },
      { name: 'notes', label: 'Notes', type: 'textarea', rows: 2, optional: true },
    ];
  }

  function save(v, existing) {
    const rec = Object.assign(existing ? Object.assign({}, existing) : { id: 'p-' + uid(), created: today() }, v);
    if (!isInvoice(rec)) {
      rec.status = '';
      rec.dueDate = '';
    } else if (rec.status === 'paid' && !rec.paidDate) rec.paidDate = today();
    store.upsert('paperwork', rec);
    return rec;
  }

  /* Opens the form for a new item. opts.files: files to attach; opts.pick: open the file picker first;
     opts.values: details to prefill; opts.onSaved(rec): called after saving. */
  async function create(opts) {
    opts = opts || {};
    let files = opts.files || null;
    if (opts.pick) {
      files = await GU.ui.pickFiles();
      if (!files.length) return;
    }
    const defaults = { kind: ui.filter === 'to-pay' ? 'invoice-in' : ui.filter === 'owed' ? 'invoice-out' : ui.filter === 'warranty' ? 'warranty' : 'receipt', context: ui.context === 'work' ? 'work' : 'home', date: today(), status: 'unpaid' };
    const d = formDialog({
      title: 'File a receipt or invoice',
      fields: fields(),
      values: Object.assign(defaults, opts.values || {}),
      initialFiles: files,
      submitLabel: 'File it',
      noAutofocus: !!(files && files.length),
      onSubmit: (v) => {
        const rec = save(v, null);
        toast('Filed ' + rec.title);
        if (opts.onSaved) opts.onSaved(rec);
      },
    });
    if (files && files.length && !opts.values && GU.brain) GU.brain.prefillForm(d, files, 'paperwork');
    return d;
  }

  function edit(id) {
    const p = store.find('paperwork', id);
    if (!p) return;
    formDialog({
      title: KIND_SHORT[p.kind] ? 'Edit ' + KIND_SHORT[p.kind].toLowerCase() : 'Edit',
      fields: fields(),
      values: p,
      onSubmit: (v) => {
        save(v, p);
      },
      onDelete: () => {
        store.remove('paperwork', id);
        toast('Deleted ' + p.title);
      },
      deleteMessage: 'This deletes the record and its attached files from this browser.',
    });
  }

  function markPaid(id) {
    const p = store.find('paperwork', id);
    if (!p) return;
    const owedToMe = p.kind === 'invoice-out';
    formDialog({
      title: owedToMe ? 'Record payment from ' + (p.party || p.title) : 'Mark ' + p.title + ' as paid',
      fields: [
        { name: 'paidDate', label: owedToMe ? 'Date you were paid' : 'Date paid', type: 'date', required: true, half: true },
        { name: 'amount', label: 'Amount', type: 'money', half: true },
        { name: 'record', label: 'Also add', type: 'checkbox', checkLabel: 'Add this to my bank transactions' },
        { name: 'files', label: 'Proof of payment', type: 'files', dropLabel: 'Add a payment confirmation (optional)' },
      ],
      values: { paidDate: today(), amount: p.amount, record: false, files: [] },
      submitLabel: owedToMe ? 'Mark as paid to me' : 'Mark paid',
      onSubmit: (v) => {
        store.commit((s) => {
          const rec = s.paperwork.find((x) => x.id === id);
          rec.status = 'paid';
          rec.paidDate = v.paidDate;
          if (v.amount != null) rec.amount = v.amount;
          rec.files = (rec.files || []).concat(v.files || []);
          if (v.record && v.amount) {
            s.transactions.push({ id: 't-' + uid(), date: v.paidDate, description: (rec.party || rec.title), amount: owedToMe ? v.amount : -v.amount,
              category: owedToMe ? 'Freelance & side work' : rec.category || '', account: (s.accounts[0] || {}).id, notes: (owedToMe ? 'Invoice paid: ' : 'Invoice: ') + rec.title, source: 'paperwork', created: today() });
          }
        });
        toast(owedToMe ? 'Marked as paid to you' : 'Marked as paid');
      },
    });
  }

  GU.tabs.receipts = { label: 'Receipts & invoices', short: 'Receipts', icon: 'receipt', render, create, edit, markPaid, KINDS };
})();
