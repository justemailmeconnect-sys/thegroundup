/* The Ground Up: Receipts. Your own receipts, invoices to pay, invoices someone owes you, paid invoices
   and warranties, each with its photo or PDF. Paperwork for work lives in Work (Get paid back, and what the
   business pays); the same form files both, so it asks who it's for and whose money paid. */
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
  const FILTERS = ['all', 'receipt', 'to-pay', 'owed', 'paid', 'warranty'];
  const ui = { filter: 'all', q: '' };

  /* ---------- home or work ---------- */
  const WORK_OUT = F.WORK_OUT || 'Work expenses';
  const WORK_IN = F.WORK_IN || 'Work reimbursements';
  const WORK = F.WORK || [WORK_OUT, WORK_IN];
  const wm = () => GU.workMoney || null;
  const parts = () => GU.parts || null;
  /* The business's short name ('the company' with none set); cap for the start of a sentence. */
  const co = (cap) => (parts() ? parts().co(store.state, cap) : cap ? 'The company' : 'the company');
  const paysLabel = () => (parts() ? parts().paysLabel(store.state) : 'Company pays');
  const isWork = (p) => !!p && p.context === 'work';
  const laneOf = (p) => (wm() ? wm().lane(p, 'paperwork') : isWork(p) ? 'unsorted' : 'home');
  /* The Work page a work record shows on: Get paid back when you paid, otherwise the business's own page. */
  function workPage(p) {
    const l = laneOf(p);
    const pg = l === 'back' && p.kind !== 'invoice-out' ? { tab: 'work-back', label: 'Get paid back' }
      : l === 'ktk' || l === 'unsorted' ? { tab: 'work-ktk', label: paysLabel() } : { tab: 'work', label: 'Overview' };
    if (GU.tabs && !GU.tabs[pg.tab]) pg.tab = 'work';
    return pg;
  }
  function accountName(s, id) {
    const a = (s.accounts || []).find((x) => x.id === id);
    return (a && a.name) || 'bank';
  }
  /* 'Filed in Work › Get paid back' (lead 'Filed in' or 'Moved to'), with Open unless you're already on that page. */
  function workToast(rec, lead, linked) {
    const pg = workPage(rec);
    const msg = lead + ' Work › ' + pg.label + (linked ? '. Linked to your ' + accountName(store.state, linked.account) + ' payment on ' + fmtDate(linked.date, { short: true }) : '');
    toast(msg, location.hash === '#' + pg.tab ? {} : { action: 'Open', onAction: () => GU.view.go(pg.tab) });
  }

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

  /* This page is Home only: work paperwork is in Work. */
  function matches(p) {
    if (isWork(p)) return false;
    if (ui.filter === 'receipt' && p.kind !== 'receipt') return false;
    if (ui.filter === 'to-pay' && !(p.kind === 'invoice-in' && p.status !== 'paid')) return false;
    if (ui.filter === 'owed' && !(p.kind === 'invoice-out' && p.status !== 'paid')) return false;
    if (ui.filter === 'paid' && !(isInvoice(p) && p.status === 'paid')) return false;
    if (ui.filter === 'warranty' && !(p.kind === 'warranty' || (p.warrantyUntil && p.warrantyUntil >= today()))) return false;
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
      '<em>' + esc([p.party, fmtDate(p.date, { short: true }), p.reference, p.folder ? 'Folder: ' + p.folder : ''].filter(Boolean).join(' · ')) + '</em>' +
      '<span class="doc-row__chips">' + pill(KIND_SHORT[p.kind] || 'Item', 'kind-' + p.kind) + statusPill(p) + '</span></button>' +
      '<span class="doc-row__end">' + (p.amount != null ? '<b class="' + (p.kind === 'invoice-out' ? 'is-in' : '') + '">' + esc(money(p.amount)) + '</b>' : '') +
      (p.kind === 'invoice-out' && p.status !== 'paid' && (p.payments || []).length ? '<small class="muted">' + esc(money(F.outstanding(p)) + ' still to come') + '</small>' : '') + '<span class="doc-row__btns">' + GU.ui.dlButton(p.files, p.title) + act + '</span></span></li>';
  }

  /* Since 6 April: the UK tax year, which is what you'd report invoice income against. */
  function taxYearStart(t) {
    const y = +t.slice(0, 4);
    return (t.slice(5) >= '04-06' ? y : y - 1) + '-04-06';
  }

  /* Invoices you've sent for your own side work that haven't been paid: the total, soonest due first, with a
     running total. An old invoice to the business for your expenses isn't here: that's in Get paid back. */
  function owedHTML(s, t) {
    const list = F.owedToMe(s);
    if (!list.length) return '';
    const total = sum(list, (x) => x.left);
    const late = list.filter((x) => x.late);
    const soon = list.filter((x) => !x.late && x.p.dueDate && daysUntil(x.p.dueDate) <= 30);
    const ty = taxYearStart(t);
    const got = sum(s.paperwork.filter((p) => p.kind === 'invoice-out' && !isWork(p)), (p) => sum(F.received(p).filter((r) => r.date >= ty), (r) => r.amount));
    const taken = new Set();
    const rows = list.map((x) => {
      const p = x.p;
      const match = F.paymentFor(s, p, taken);
      if (match) taken.add(match.id);
      const n = p.dueDate ? daysUntil(p.dueDate) : null;
      const due = !p.dueDate ? '<b>No due date</b>' : '<b>' + esc(fmtDate(p.dueDate, { short: true })) + '</b><em class="' + (x.late ? 'is-crit' : n <= 7 ? 'is-warn' : '') + '">' + esc(x.late ? -n + (n === -1 ? ' day late' : ' days late') : relDays(p.dueDate)) + '</em>';
      return '<li class="tally-row' + (x.late ? ' is-late' : '') + '">' +
        '<span class="tally-row__due">' + due + '</span>' +
        '<button type="button" class="tally-row__main" data-edit="' + esc(p.id) + '"><b>' + esc(p.party || p.title) + '</b><em>' + esc([p.party ? p.title : '', p.reference, p.date ? 'sent ' + fmtDate(p.date, { short: true }) : ''].filter(Boolean).join(' · ')) + '</em></button>' +
        '<span class="tally-row__amt">' + (x.noAmount ? '<b class="muted">No amount</b>' : '<b>' + esc(money(x.left)) + '</b>' + (x.paid ? '<em>' + esc(money(x.paid) + ' of ' + money(p.amount) + ' paid') + '</em>' : '')) + '</span>' +
        '<span class="tally-row__run"><b>' + esc(money(x.running)) + '</b><em>running total</em></span>' +
        '<span class="tally-row__act"><button type="button" class="btn btn--sm btn--soft" data-pay="' + esc(p.id) + '">' + icon('check') + 'Got paid</button></span>' +
        (match ? '<p class="tally-row__match">' + icon('bank') + '<span>Looks paid: <b>' + esc(money(match.amount)) + '</b> came in from ' + esc(match.description || 'someone') + ' on ' + esc(fmtDate(match.date, { short: true })) + '.</span>' +
          '<button type="button" class="btn btn--sm btn--primary" data-match="' + esc(p.id + ':' + match.id) + '">Yes, that’s it</button><button type="button" class="btn btn--sm btn--ghost" data-nomatch="' + esc(p.id + ':' + match.id) + '">No</button></p>' : '') +
        '</li>';
    });
    return '<section class="panel tally"><header class="panel__head"><h2>' + icon('in') + 'Owed to you</h2>' +
      '<span class="muted">soonest due first</span>' +
      '<button type="button" class="btn btn--sm" data-new-owed>' + icon('plus') + 'Invoice you’ve sent</button></header>' +
      '<div class="tally__sum">' +
      '<div><span>Still to come</span><b class="is-in">' + esc(money(total)) + '</b><em>' + esc(plural(list.length, 'invoice')) + (list.some((x) => x.noAmount) ? ', some without an amount' : '') + '</em></div>' +
      '<div><span>Late</span><b class="' + (late.length ? 'is-crit' : '') + '">' + esc(money(sum(late, (x) => x.left))) + '</b><em>' + esc(late.length ? plural(late.length, 'invoice') + ' past the due date' : 'nothing late') + '</em></div>' +
      '<div><span>Due in the next 30 days</span><b>' + esc(money(sum(soon, (x) => x.left))) + '</b><em>' + esc(soon.length ? plural(soon.length, 'invoice') : 'nothing due soon') + '</em></div>' +
      '<div><span>Paid to you since ' + esc(fmtDate(ty, { short: true })) + '</span><b>' + esc(money(got)) + '</b><em>this tax year</em></div>' +
      '</div>' +
      '<ol class="tally__list">' + rows.join('') + '</ol>' +
      '<footer class="tally__foot"><span>Total owed to you</span><b class="is-in">' + esc(money(total)) + '</b></footer></section>';
  }

  /* One line pointing to Work, where the business's paperwork and the things you paid for it live now. */
  function workLineHTML(s) {
    const work = s.paperwork.filter(isWork);
    const back = work.filter((p) => laneOf(p) === 'back' && p.kind !== 'invoice-out').length;
    const pays = work.filter((p) => laneOf(p) === 'ktk' || laneOf(p) === 'unsorted').length;
    if (!back && !pays) return '';
    const link = (tab, label, n) => (n ? '<a class="link" href="#' + (GU.tabs && !GU.tabs[tab] ? 'work' : tab) + '">' + esc(label + ' (' + n + ')') + '</a>' : '');
    const lead = 'Receipts for ' + co() + ' are in ';
    // On one page: 'are in Work › Get paid back (9).' On both: 'are in Work (10): Get paid back (9) · … pays (1)'.
    const text = back && pays ? esc(lead + 'Work (' + (back + pays) + '): ') + link('work-back', 'Get paid back', back) + ' · ' + link('work-ktk', paysLabel(), pays)
      : esc(lead) + (back ? link('work-back', 'Work › Get paid back', back) : link('work-ktk', 'Work › ' + paysLabel(), pays)) + '.';
    return '<p class="note-line note-line--signpost">' + icon('briefcase') + '<span>' + text + '</span></p>';
  }

  /* Marks things you paid for as sent to the business, in one pack, with Undo. */
  function markClaimed(ids) {
    if (wm()) return wm().markSent(ids);
    return null;
  }

  function render(root) {
    const s = store.state;
    const t = today();
    const all = s.paperwork.filter((p) => !isWork(p));
    const toPay = all.filter((p) => p.kind === 'invoice-in' && p.status !== 'paid');
    const owed = all.filter((p) => p.kind === 'invoice-out' && p.status !== 'paid');
    const warranties = all.filter((p) => p.warrantyUntil && p.warrantyUntil >= t);
    if (!FILTERS.includes(ui.filter)) ui.filter = 'all';
    const thisMonth = all.filter((p) => (p.created || p.date || '').slice(0, 7) === t.slice(0, 7));
    const counts = {
      all: all.length, receipt: all.filter((p) => p.kind === 'receipt').length, 'to-pay': toPay.length, owed: owed.length,
      paid: all.filter((p) => isInvoice(p) && p.status === 'paid').length, warranty: warranties.length,
    };
    const filterOpts = [
      { value: 'all', label: 'Everything' }, { value: 'receipt', label: 'Receipts' }, { value: 'to-pay', label: 'To pay' },
      { value: 'owed', label: 'Owed to me' }, { value: 'paid', label: 'Paid invoices' }, { value: 'warranty', label: 'Warranties' },
    ].map((o) => Object.assign(o, { count: counts[o.value] }));

    const sorted = () => {
      const list = all.filter(matches);
      if (ui.filter === 'to-pay' || ui.filter === 'owed') return list.sort((a, b) => (a.dueDate || '9').localeCompare(b.dueDate || '9'));
      if (ui.filter === 'warranty') return list.sort((a, b) => (a.warrantyUntil || '').localeCompare(b.warrantyUntil || ''));
      return list.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    };

    root.innerHTML = GU.view.head({
      eyebrow: 'Paperwork',
      title: 'Receipts',
      text: 'Snap or upload every receipt, invoice and warranty the moment you get it. Your assistant reads it and fills in the details.',
      actions: '<button type="button" class="btn" data-import-orders>' + icon('download') + 'Import Amazon orders</button><button type="button" class="btn btn--primary" data-upload>' + icon('camera') + 'Upload</button>',
    }) +
      workLineHTML(s) +
      GU.ui.dropbar('Drop receipts, invoices or warranties here, or a whole folder', 'Photos and PDFs both work. Subfolders like Warranties or Paid are used.') +
      '<div class="ledger">' +
      '<div><span>Invoices to pay</span><b>' + esc(money(sum(toPay, (p) => p.amount || 0))) + '</b><em>' + esc(plural(toPay.length, 'invoice')) + (toPay.filter((p) => p.dueDate && p.dueDate < t).length ? ' · ' + toPay.filter((p) => p.dueDate && p.dueDate < t).length + ' overdue' : '') + '</em></div>' +
      '<div><span>Owed to you</span><b class="' + (owed.length ? 'is-in' : '') + '">' + esc(money(sum(owed, (p) => F.outstanding(p)))) + '</b><em>' + esc(plural(owed.length, 'invoice')) + (owed.filter((p) => p.dueDate && p.dueDate < t).length ? ' · ' + owed.filter((p) => p.dueDate && p.dueDate < t).length + ' late' : ' sent') + '</em></div>' +
      '<div><span>Under warranty</span><b>' + warranties.length + '</b><em>' + (warranties.length ? 'next ends ' + esc(fmtDate(warranties.map((p) => p.warrantyUntil).sort()[0], { short: true })) : 'items covered') + '</em></div>' +
      '<div><span>Filed this month</span><b>' + thisMonth.length + '</b><em>' + esc(plural(all.length, 'item')) + ' in total</em></div>' +
      '</div>' +
      '<div class="toolbar">' + chips('filter', filterOpts, ui.filter) + '<span class="toolbar__gap"></span>' +
      '<label class="search">' + icon('search') + '<input type="search" id="rc-search" placeholder="Search" value="' + esc(ui.q) + '" aria-label="Search receipts and invoices"></label></div>' +
      (ui.filter === 'all' || ui.filter === 'owed' ? owedHTML(s, t) : '') +
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
    GU.ui.wireDropbar(root, (files) => create({ files }));
    root.addEventListener('click', (e) => {
      const c = e.target.closest('[data-chip]');
      if (c) {
        ui[c.dataset.chip] = c.dataset.value;
        return GU.render();
      }
      if (e.target.closest('[data-upload]')) return create({ pick: true });
      if (e.target.closest('[data-import-orders]')) return importOrders();
      if (e.target.closest('[data-new-owed]')) return create({ values: { kind: 'invoice-out', context: 'home', date: today(), status: 'unpaid' } });
      const m = e.target.closest('[data-match]');
      if (m) {
        const [pid, tid] = m.dataset.match.split(':');
        const tx = store.find('transactions', tid);
        if (tx) addPayment(pid, { date: tx.date, amount: tx.amount, tx: tx.id });
        return;
      }
      const nm = e.target.closest('[data-nomatch]');
      if (nm) {
        const [pid, tid] = nm.dataset.nomatch.split(':');
        return store.commit((st) => {
          const p = st.paperwork.find((x) => x.id === pid);
          if (p) p.notPayments = (p.notPayments || []).concat(tid);
        });
      }
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

  /* ---------- the form: home or work, and whose money ---------- */
  /* Whose money is asked for work receipts and invoices (not a warranty, or an old invoice you sent the business). */
  const payerAsked = (v) => v.context === 'work' && v.kind !== 'invoice-out' && v.kind !== 'warranty';
  /* How far getting it back has got, for things you paid for yourself. */
  const stageAsked = (v) => payerAsked(v) && v.payer === 'me';

  /* The fields. values: what the form opens with, so 'Not sure yet' is only offered while it isn't sorted. */
  function fields(values) {
    values = values || {};
    const c = co();
    const C = co(true);
    const e = wm() ? wm().employer(store.state) : { set: false };
    const unsorted = values.payer !== 'me' && values.payer !== 'company';
    // Home spending categories; 'Work expenses' only for an older home record that already has it.
    const cats = F.EXPENSE.filter((x) => !WORK.includes(x) || x === values.category);
    return [
      { name: 'files', label: 'Photo or PDF', type: 'files', dropLabel: 'Add the receipt, invoice or warranty' },
      { name: 'kind', label: 'What is it?', type: 'select', options: KINDS, half: true },
      { name: 'context', label: 'For', type: 'segmented', options: [{ value: 'home', label: 'Home', icon: 'home' }, { value: 'work', label: e.set ? 'Work (' + c + ')' : 'Work', icon: 'briefcase' }], half: true },
      { name: 'payer', label: 'Whose money?', type: 'segmented', default: '',
        options: [{ value: 'company', label: C + '’s money (' + c + ' paid or will pay)' }, { value: 'me', label: 'My money, get it back' }].concat(unsorted ? [{ value: '', label: 'Not sure yet' }] : []),
        help: 'Your money means it came out of your own account, card, cash, PayPal or Amazon.', showIf: payerAsked },
      { name: 'claimStatus', label: 'Where it’s at', type: 'segmented', default: 'to-send',
        options: [{ value: 'to-send', label: 'Not sent yet' }, { value: 'sent', label: 'Sent to ' + c }, { value: 'paid-back', label: 'Paid back' }], showIf: stageAsked },
      { name: 'claimedDate', label: 'Date sent to ' + c, type: 'date', half: true, optional: true, showIf: (v) => stageAsked(v) && v.claimStatus !== 'to-send' },
      { name: 'repaidDate', label: 'Date paid back', type: 'date', half: true, optional: true, showIf: (v) => stageAsked(v) && v.claimStatus === 'paid-back' },
      { name: 'outNote', type: 'html', showIf: (v) => v.context === 'work' && v.kind === 'invoice-out',
        html: '<p class="field__help">' + esc('Claiming back what you paid for ' + c + '? Choose Receipt and ‘My money, get it back’ instead. Get paid back puts the claim together for you.') + '</p>' },
      { name: 'title', label: 'Description', required: true, placeholder: 'e.g. New TV, Boiler repair, Website design' },
      { name: 'party', label: 'Shop, company or person', placeholder: 'e.g. Currys, Hart & Sons Plumbing', optional: true },
      { name: 'amount', label: 'Amount', type: 'money', half: true, optional: true },
      { name: 'date', label: 'Date on it', type: 'date', half: true },
      { name: 'dueDate', label: 'Due date', type: 'date', half: true, optional: true, showIf: (v) => v.kind === 'invoice-in' || v.kind === 'invoice-out' },
      { name: 'status', label: 'Paid yet?', type: 'segmented', options: [{ value: 'unpaid', label: 'Not paid' }, { value: 'paid', label: 'Paid' }], half: true, showIf: (v) => v.kind === 'invoice-in' || v.kind === 'invoice-out' },
      { name: 'paidDate', label: 'Date paid', type: 'date', half: true, showIf: (v) => (v.kind === 'invoice-in' || v.kind === 'invoice-out') && v.status === 'paid' },
      { name: 'warrantyUntil', label: 'Warranty or returns until', type: 'date', half: true, optional: true, help: 'I’ll remind you before it ends.' },
      { name: 'reference', label: 'Invoice, order or policy number', half: true, optional: true },
      { name: 'category', label: 'Spending category', type: 'select', options: cats, placeholder: 'Choose a category', half: true, showIf: (v) => v.context !== 'work' && v.kind !== 'invoice-out' },
      { name: 'notes', label: 'Notes', type: 'textarea', rows: 2, optional: true },
    ];
  }
  /* The paid question names who paid, for the business's own invoices. */
  function relabel(v, form) {
    const set = (name, text) => {
      const el = form.querySelector('[data-field="' + name + '"] .field__label');
      if (el && el.firstChild) el.firstChild.textContent = text;
    };
    const theirs = v.context === 'work' && v.payer === 'company';
    set('status', theirs ? 'Paid by ' + co() + ' yet?' : 'Paid yet?');
    set('paidDate', theirs ? 'Date ' + co() + ' paid' : 'Date paid');
  }
  /* What the form opens with for a saved record: who paid and the stage read through their defaults. */
  function formValues(p) {
    const v = Object.assign({}, p);
    if (isWork(p) && wm()) {
      v.payer = wm().payerOf(p, 'paperwork') || '';
      v.claimStatus = wm().stage(p);
    }
    if (isWork(p) && WORK.includes(v.category)) v.category = '';
    return v;
  }

  /* Saves the form in one commit: defaults and legacy flags through GU.workMoney.normalise, and for something
     you just started claiming back, your bank payment when it's sure. A new claim for a monthly work bill's payment
     that already has its claim adds its files to that one instead (twin). stageShown: the stage the form opened
     with. Returns {rec, linked, twin}. */
  function save(v, existing, stageShown) {
    const W = wm();
    const prev = existing ? JSON.parse(JSON.stringify(existing)) : null;
    const rec = Object.assign(existing ? Object.assign({}, existing) : { id: 'p-' + uid(), created: today() }, v);
    delete rec.outNote;
    // An invoice you've sent the business for your own spending is a claim, sent to them (paid back once they've
    // paid it), as the Inbox files one: otherwise it would show on no page at all.
    let outClaim = false;
    if (rec.context === 'work' && rec.kind === 'invoice-out') {
      outClaim = true;
      const paid = rec.status === 'paid';
      Object.assign(rec, { kind: 'receipt', payer: 'me', claimStatus: paid ? 'paid-back' : 'sent', claimedDate: rec.claimedDate || rec.date || today() });
      if (paid && !rec.repaidDate) rec.repaidDate = rec.paidDate || today();
      v = Object.assign({}, v, { kind: 'receipt', payer: 'me', claimStatus: rec.claimStatus });
    }
    // Questions that weren't asked keep what the record had.
    const keep = (k) => {
      if (existing && existing[k] !== undefined) rec[k] = existing[k];
      else delete rec[k];
    };
    if (!payerAsked(v)) keep('payer');
    else if (v.payer !== 'me' && v.payer !== 'company') delete rec.payer;
    if (!stageAsked(v)) ['claimStatus', 'claimedDate', 'repaidDate'].forEach(keep);
    else ['claimedDate', 'repaidDate'].forEach((k) => !rec[k] && delete rec[k]);
    if (rec.context === 'work') rec.category = (existing && existing.category) || WORK_OUT;
    if (!isInvoice(rec)) {
      rec.status = '';
      rec.dueDate = '';
    } else if (rec.status === 'paid' && !rec.paidDate) rec.paidDate = today();
    // Set back to not paid: start the running total for it again from the full amount.
    if (existing && existing.status === 'paid' && rec.status !== 'paid') {
      rec.payments = [];
      rec.paidDate = '';
    }
    let linked = null;
    let twin = null;
    if (prev && W && W.isClaim(prev) && STAGES_SHOWN.includes(stageShown)) rec._stageShown = stageShown;
    store.commit((st) => {
      if (W) W.normalise(rec, prev);
      if (outClaim && W && !rec.packId) rec.packId = W.newPackId(st, rec.claimedDate || today(), [rec.id]);
      // New, and already in Get paid back: the claim a monthly work bill made for this payment, or (for an invoice
      // you sent) the claim for the same money. Its files go on that claim rather than claiming it twice.
      twin = existing || !W ? null : (outClaim && W.outTwin ? W.outTwin(st, rec) : null) || (W.billTwin ? W.billTwin(st, rec) : null);
      if (twin) {
        const before = {};
        for (const k of ['files', 'reference', 'notes', 'claimStatus', 'claim', 'claimed', 'claimedDate', 'packId']) before[k] = twin[k] === undefined ? undefined : JSON.parse(JSON.stringify(twin[k]));
        const ids = new Set((twin.files || []).map((f) => f && f.id));
        twin.files = (twin.files || []).concat((rec.files || []).filter((f) => f && !ids.has(f.id)));
        if (!twin.reference && rec.reference) twin.reference = rec.reference;
        if (rec.notes && !String(twin.notes || '').includes(rec.notes)) twin.notes = [twin.notes, rec.notes].filter(Boolean).join('\n');
        if (outClaim && W.stage(twin) === 'to-send') {
          Object.assign(twin, { claimStatus: 'sent', claimedDate: rec.claimedDate || today(), packId: W.newPackId(st, rec.claimedDate || today(), [twin.id]) });
          W.mirror(twin);
        }
        twin = { rec: twin, before };
        return;
      }
      if (W && W.isClaim(rec) && !rec.purchaseTx && !(prev && W.isClaim(prev))) {
        const r = W.purchaseFor(st, rec);
        if (r.sure && r.tx) {
          rec.purchaseTx = r.tx.id;
          rec.purchaseWas = r.tx.category || '';
          r.tx.category = WORK_OUT;
          linked = r.tx;
        }
      }
      const i = st.paperwork.findIndex((x) => x.id === rec.id);
      if (i >= 0) st.paperwork[i] = rec;
      else st.paperwork.push(rec);
    });
    if (twin) {
      const id = twin.rec.id;
      const before = twin.before;
      toast('Added to ‘' + (twin.rec.title || 'the claim') + '’ in Get paid back: ' + (outClaim ? 'it’s the same money.' : 'your monthly bill had already claimed this payment.'), {
        action: 'Undo',
        onAction: () => store.commit((st) => {
          const x = st.paperwork.find((p) => p.id === id);
          if (!x) return;
          for (const k of Object.keys(before)) {
            if (before[k] === undefined) delete x[k];
            else x[k] = before[k];
          }
        }),
      });
      return { rec: twin.rec, linked: null, twin: true };
    }
    return { rec, linked };
  }
  const STAGES_SHOWN = ['to-send', 'sent', 'paid-back'];

  /* Opens the form for a new item. opts.files: files to attach; opts.pick: open the file picker first;
     opts.values: details to prefill; opts.onSaved(rec): called after saving. It's for Home or Work by the
     part you're in, unless opts.values says. */
  async function create(opts) {
    opts = opts || {};
    let files = opts.files || null;
    if (opts.pick) {
      files = await GU.ui.pickFiles();
      if (!files.length) return;
    }
    const inWork = !!(parts() && parts().get() === 'work');
    // Several files (or a folder) are several receipts: the assistant reads each one and files it.
    if (files && !opts.values && (files.length > 1 || GU.ui.pathOf(files[0]).includes('/'))) {
      GU.inbox.add({ files, scope: inWork ? { kind: 'work', area: null, name: 'Work' } : { kind: 'paperwork', name: 'Receipts' } });
      return null;
    }
    const kind = inWork ? 'receipt' : ui.filter === 'to-pay' ? 'invoice-in' : ui.filter === 'owed' ? 'invoice-out' : ui.filter === 'warranty' ? 'warranty' : 'receipt';
    const values = Object.assign({ kind, context: inWork ? 'work' : 'home', date: today(), status: 'unpaid' }, opts.values || {});
    if (values.context === 'work' && values.payer !== 'me' && values.payer !== 'company') values.payer = (wm() && wm().payerOf(values, 'paperwork')) || '';
    if (values.payer === 'me' && !values.claimStatus) values.claimStatus = 'to-send';
    const c = co();
    const d = formDialog({
      title: values.context !== 'work' ? 'File a receipt or invoice' : values.payer === 'me' ? 'Something you paid for ' + c : values.payer === 'company' ? 'Something ' + c + ' is paying' : 'File something for ' + c,
      fields: fields(values),
      values,
      initialFiles: files,
      submitLabel: 'File it',
      noAutofocus: !!(files && files.length),
      onChange: relabel,
      onSubmit: (v) => {
        const { rec, linked, twin } = save(v, null);
        if (twin) return;
        if (isWork(rec)) workToast(rec, 'Filed in', linked);
        else toast('Filed ' + rec.title);
        if (opts.onSaved) opts.onSaved(rec);
      },
    });
    if (files && files.length && !opts.values && GU.brain) GU.brain.prefillForm(d, files, 'paperwork');
    return d;
  }

  function edit(id) {
    const p = store.find('paperwork', id);
    if (!p) return;
    const values = formValues(p);
    formDialog({
      title: KIND_SHORT[p.kind] ? 'Edit ' + KIND_SHORT[p.kind].toLowerCase() : 'Edit',
      fields: fields(values),
      values,
      onChange: relabel,
      onSubmit: (v) => {
        const pageWas = isWork(p) ? workPage(p).tab : 'receipts';
        const { rec, linked } = save(v, p, values.claimStatus);
        const page = isWork(rec) ? workPage(rec).tab : 'receipts';
        if (page !== pageWas) {
          if (isWork(rec)) workToast(rec, 'Moved to', linked);
          else toast('Moved to Home › Receipts', location.hash === '#receipts' ? {} : { action: 'Open', onAction: () => GU.view.go('receipts') });
        } else if (linked) toast('Linked to your ' + accountName(store.state, linked.account) + ' payment on ' + fmtDate(linked.date, { short: true }));
      },
      onDelete: () => {
        store.remove('paperwork', id, p.title);
      },
      deleteMessage: 'This deletes the record and its attached files. You can undo it, and it stays in Settings → Recently deleted for 30 days.',
    });
  }

  /* Records money received on an invoice you sent. Less than what's left keeps it open with the rest still owed,
     unless `settle` says that's all that's coming. */
  function addPayment(id, pay, settle) {
    let msg = '';
    store.commit((s) => {
      const rec = s.paperwork.find((x) => x.id === id);
      if (!rec) return;
      if (rec.amount == null || rec.amount === '') rec.amount = pay.amount;
      rec.payments = (rec.payments || []).concat({ date: pay.date, amount: GU.util.round2(pay.amount), tx: pay.tx || undefined });
      const left = F.outstanding(rec);
      if (left <= 0 || settle) {
        rec.status = 'paid';
        rec.paidDate = pay.date;
        msg = 'Marked as paid to you';
      } else msg = 'Got ' + money(pay.amount) + ' from ' + (rec.party || rec.title) + '. ' + money(left) + ' still to come.';
    });
    if (msg) toast(msg);
  }

  /* Marks an invoice paid. Who paid decides what happens: your own invoices as before; the business's are just
     'Paid by …', never a bank line; one you paid for work stays in Get paid back and is linked to your bank
     payment instead of adding a transaction. */
  function markPaid(id) {
    const p = store.find('paperwork', id);
    if (!p) return;
    const lane = laneOf(p);
    if (isWork(p) && p.kind !== 'invoice-out' && lane !== 'home') return workPaid(p, lane);
    const owedToMe = p.kind === 'invoice-out';
    const left = owedToMe ? F.outstanding(p) : null;
    const partPaid = owedToMe && (p.payments || []).length > 0;
    formDialog({
      title: owedToMe ? 'Record payment from ' + (p.party || p.title) : 'Mark ' + p.title + ' as paid',
      intro: partPaid ? esc(money(F.received(p).reduce((a, r) => a + r.amount, 0)) + ' of ' + money(p.amount) + ' paid so far. ' + money(left) + ' still to come.') : undefined,
      fields: [
        { name: 'paidDate', label: owedToMe ? 'Date you were paid' : 'Date paid', type: 'date', required: true, half: true },
        { name: 'amount', label: owedToMe ? 'Amount you got' : 'Amount', type: 'money', half: true, help: owedToMe ? 'If it’s less than what’s owed, the rest stays in your running total.' : undefined },
      ].concat(owedToMe ? [{ name: 'settle', label: 'Settled', type: 'checkbox', checkLabel: 'That’s all that’s coming, even if it’s less than the invoice' }] : []).concat([
        { name: 'record', label: 'Also add', type: 'checkbox', checkLabel: 'Add this to my bank transactions', help: 'Only if it won’t be in a statement you import.' },
        { name: 'files', label: 'Proof of payment', type: 'files', dropLabel: 'Add a payment confirmation (optional)' },
      ]),
      values: { paidDate: today(), amount: owedToMe ? left || p.amount : p.amount, record: false, settle: false, files: [] },
      submitLabel: owedToMe ? 'Record payment' : 'Mark paid',
      onSubmit: (v) => {
        if (owedToMe && !(v.amount > 0) && !v.settle) {
          toast('Put in how much you got.');
          return false;
        }
        let txId = null;
        store.commit((s) => {
          const rec = s.paperwork.find((x) => x.id === id);
          rec.files = (rec.files || []).concat(v.files || []);
          if (!owedToMe) {
            rec.status = 'paid';
            rec.paidDate = v.paidDate;
            if (v.amount != null) rec.amount = v.amount;
          }
          if (v.record && v.amount) {
            txId = 't-' + uid();
            s.transactions.push({ id: txId, date: v.paidDate, description: (rec.party || rec.title), amount: owedToMe ? v.amount : -v.amount,
              category: owedToMe ? (isWork(rec) ? WORK_IN : 'Freelance & side work') : rec.category || '', account: (s.accounts[0] || {}).id, notes: (owedToMe ? 'Invoice paid: ' : 'Invoice: ') + rec.title, source: 'paperwork', created: today() });
          }
        });
        if (!owedToMe) return toast('Marked as paid');
        if (v.amount > 0) addPayment(id, { date: v.paidDate, amount: v.amount, tx: txId }, v.settle);
        else if (v.settle) {
          store.commit((s) => {
            const rec = s.paperwork.find((x) => x.id === id);
            rec.status = 'paid';
            rec.paidDate = v.paidDate;
          });
          toast('Closed. Nothing more is expected on it.');
        }
      },
    });
  }

  /* A work invoice paid: by the business ('ktk'), by you ('back'), or not sorted yet, when it asks who paid. */
  function workPaid(p, lane) {
    const W = wm();
    const c = co();
    const C = co(true);
    const ask = lane === 'unsorted';
    const mine = lane === 'back';
    formDialog({
      title: mine || ask ? 'Mark ' + p.title + ' as paid' : 'Paid by ' + c,
      intro: esc(mine ? 'You paid it, so it stays in Get paid back, ready to send to ' + c + '.'
        : ask ? 'If ' + c + ' paid, it’s kept out of your money. If you paid, it goes to Get paid back.'
          : (p.title + (p.party && p.party !== p.title ? ' from ' + p.party : '')) + '. It isn’t your money, so nothing is added to your bank.'),
      fields: (ask ? [{ name: 'who', label: 'Who paid it?', type: 'segmented', options: [{ value: 'company', label: C + ' paid' }, { value: 'me', label: 'I paid, get it back' }], default: 'company' }] : []).concat([
        { name: 'paidDate', label: 'Date paid', type: 'date', required: true, half: true },
        { name: 'amount', label: 'Amount', type: 'money', half: true },
        { name: 'files', label: 'Proof of payment', type: 'files', dropLabel: 'Add a payment confirmation (optional)' },
      ]),
      values: { who: 'company', paidDate: today(), amount: p.amount, files: [] },
      submitLabel: mine || ask ? 'Mark paid' : 'Paid by ' + c,
      onSubmit: (v) => {
        const who = mine ? 'me' : ask ? v.who : 'company';
        const before = JSON.parse(JSON.stringify(p));
        const was = {}; // bank lines whose category changes, for Undo
        let rec = null;
        let linked = null;
        let options = 0;
        store.commit((st) => {
          const r0 = st.paperwork.find((x) => x.id === p.id);
          if (!r0) return;
          const prev = JSON.parse(JSON.stringify(r0));
          const note = (txId) => {
            const t = st.transactions.find((x) => x.id === txId);
            if (t && !(txId in was)) was[txId] = t.category;
            return t;
          };
          r0.files = (r0.files || []).concat(v.files || []);
          if (isInvoice(r0)) r0.status = 'paid';
          r0.paidDate = v.paidDate;
          if (v.amount != null) r0.amount = v.amount;
          r0.context = 'work';
          r0.payer = who;
          if (r0.purchaseTx) note(r0.purchaseTx);
          if (W) W.normalise(r0, prev);
          if (W && who === 'me' && !r0.purchaseTx) {
            const r = W.purchaseFor(st, r0);
            if (r.sure && r.tx) {
              note(r.tx.id);
              r0.purchaseTx = r.tx.id;
              r0.purchaseWas = r.tx.category || '';
              r.tx.category = WORK_OUT;
              linked = r.tx;
            } else options = r.options.length + (r.near ? 1 : 0);
          }
          rec = r0;
        });
        if (!rec) return;
        const undo = () => store.commit((st) => {
          st.paperwork = st.paperwork.map((x) => (x.id === before.id ? before : x));
          for (const txId in was) {
            const t = st.transactions.find((x) => x.id === txId);
            if (t) t.category = was[txId];
          }
        });
        if (who === 'company') return toast('Marked as paid by ' + c, { action: 'Undo', onAction: undo });
        toast('Marked as paid. It’s in Get paid back, ready to send to ' + c +
          (linked ? '. Linked to your ' + accountName(store.state, linked.account) + ' payment on ' + fmtDate(linked.date, { short: true }) : options ? '' : '. I’ll link your bank payment when it’s in a statement you import'),
        { action: 'Undo', onAction: undo });
        // Not sure which bank payment it was: ask, instead of adding a transaction.
        if (!linked && options && GU.payback && GU.payback.findPaymentDialog) setTimeout(() => GU.payback.findPaymentDialog(rec.id), 60);
      },
    });
  }

  /* Opens Receipts on what's owed to you; what you paid for work is in Work › Get paid back. */
  function showOwed() {
    ui.filter = 'owed';
    GU.view.go('receipts');
  }
  function showClaims() {
    GU.view.go(GU.tabs && GU.tabs['work-back'] ? 'work-back' : 'work');
  }

  /* ---------- online order lists (Amazon "Request your data", or a list made by Claude in Chrome) ---------- */
  function readOrders(text) {
    const rows = GU.util.parseCSV(text);
    const hi = rows.findIndex((r) => r.some((c) => /order\s*(id|number|no|#)/i.test(c)));
    if (hi < 0) return null;
    const header = rows[hi].map((h) => h.toLowerCase().trim());
    const pick = (words) => {
      for (const w of words) {
        const i = header.findIndex((h) => h.includes(w));
        if (i >= 0) return i;
      }
      return -1;
    };
    const c = {
      id: pick(['order id', 'order number', 'order no', 'order #']),
      date: pick(['order date', 'date']),
      total: pick(['total owed', 'order total', 'grand total', 'total', 'amount', 'price']),
      items: pick(['product name', 'items', 'item', 'product', 'description', 'title']),
      status: pick(['order status', 'status']),
      site: pick(['website', 'site', 'store']),
    };
    if (c.id < 0 || c.date < 0) return null;
    const order = GU.util.guessDateOrder(rows.slice(hi + 1, hi + 60).map((r) => r[c.date]));
    const map = new Map();
    let sites = '';
    for (const r of rows.slice(hi + 1)) {
      const id = (r[c.id] || '').trim();
      if (!id || (c.status >= 0 && /cancel/i.test(r[c.status] || ''))) continue;
      const date = GU.util.parseLooseDate(r[c.date], order);
      if (!date) continue;
      const amt = c.total >= 0 ? GU.util.parseAmount(r[c.total]) : NaN;
      const item = c.items >= 0 ? (r[c.items] || '').replace(/\s+/g, ' ').trim() : '';
      const o = map.get(id) || { id, date, total: 0, items: [] };
      if (!isNaN(amt)) o.total = GU.util.round2(o.total + Math.abs(amt));
      for (const part of item.split(/\s*;\s*/)) if (part && !o.items.includes(part)) o.items.push(part);
      if (date < o.date) o.date = date;
      map.set(id, o);
      if (c.site >= 0 && sites.length < 200) sites += ' ' + (r[c.site] || '');
    }
    const orders = Array.from(map.values()).sort((a, b) => b.date.localeCompare(a.date));
    const amazon = /amazon/i.test(sites) || orders.some((o) => /^(\d{3}|D\d{2})-\d{7}-\d{7}$/.test(o.id));
    const domain = (sites.match(/amazon\.[a-z.]+/i) || ['amazon.co.uk'])[0].toLowerCase();
    return { orders, amazon, domain };
  }

  /* Imports an order history. preset {context, payer} picks who they were for: Home, Work and you paid (they
     join Get paid back), or Work on the business's card (paid by the business). With no preset it's Home,
     or the business's card when you're in Work. */
  async function importOrders(source, preset) {
    preset = preset || {};
    if (!source) {
      const picked = await GU.ui.pickFiles('.csv,text/csv,.txt,.zip');
      if (!picked.length) return;
      source = picked[0];
    }
    if (source && typeof source !== 'string' && /\.zip$/i.test(source.name)) {
      return toast('Open the zip file first, then choose the file inside it called Retail.OrderHistory (it ends in .csv).');
    }
    const text = typeof source === 'string' ? source : await source.text();
    const parsed = readOrders(text);
    if (!parsed || !parsed.orders.length) return toast('I couldn’t find any orders in that file. It needs columns for the order number and order date.');
    const s = store.state;
    const t = today();
    const c = co();
    const MODES = [
      { value: 'home', label: 'Home', icon: 'home', where: 'Receipts', tab: 'receipts' },
      { value: 'back', label: 'Work, I paid (get it back)', icon: 'coin', where: 'Work › Get paid back', tab: 'work-back' },
      { value: 'ktk', label: 'Work, ' + c + '’s card', icon: 'briefcase', where: 'Work › ' + paysLabel(), tab: 'work-ktk' },
    ];
    const inWork = !preset.context && !!(parts() && parts().get() === 'work');
    const ui2 = { from: GU.util.addMonths(t, -36), mode: preset.context === 'work' || inWork ? (preset.payer === 'me' ? 'back' : 'ktk') : 'home' };
    const known = new Set(s.paperwork.map((p) => String(p.reference || '').toLowerCase()).filter(Boolean));
    const party = parsed.amazon ? 'Amazon' : 'Online shop';
    const d = GU.ui.openDialog({
      title: parsed.amazon ? 'Import your Amazon orders' : 'Import your orders',
      wide: true,
      body: '<div data-orders></div>',
      footer: '<span class="spacer"></span><button type="button" class="btn" data-close>Cancel</button><button type="submit" class="btn btn--primary" data-go>Import</button>',
    });
    const box = d.body.querySelector('[data-orders]');
    const go = d.el.querySelector('[data-go]');
    let chosen = [];
    function draw() {
      const mode = MODES.find((m) => m.value === ui2.mode) || MODES[0];
      const inRange = parsed.orders.filter((o) => o.date >= ui2.from);
      chosen = inRange.filter((o) => !known.has(o.id.toLowerCase()));
      const dupes = inRange.length - chosen.length;
      const first = parsed.orders[parsed.orders.length - 1].date;
      box.innerHTML =
        '<p class="dlg__intro">I found <b>' + esc(plural(parsed.orders.length, 'order')) + '</b> from ' + esc(fmtDate(first)) + ' to ' + esc(fmtDate(parsed.orders[0].date)) +
        '. Each one becomes a paid invoice in ' + esc(mode.where) + ', with its items and order number' +
        (ui2.mode === 'back' ? ', ready to send to ' + esc(c) + '. I’ll link each one to your bank payment when I’m sure' : ui2.mode === 'ktk' ? ', marked as paid by ' + esc(c) + '. None of it counts as your money' : '') +
        '. Invoice PDFs you drop in the Inbox later are matched to their order automatically.</p>' +
        '<div class="form-grid">' +
        '<div class="field field--half"><label class="field__label" for="ord-from">Import orders from</label><input type="date" id="ord-from" value="' + esc(ui2.from) + '"></div>' +
        '<div class="field"><span class="field__label">These were for</span><div class="seg" role="radiogroup" aria-label="These were for">' +
        MODES.map((m) => '<label><input type="radio" name="ord-ctx" value="' + m.value + '"' + (ui2.mode === m.value ? ' checked' : '') + '><span>' + icon(m.icon) + esc(m.label) + '</span></label>').join('') + '</div></div></div>' +
        '<h3 class="subhead">Preview</h3>' +
        (chosen.length ? '<div class="table-wrap"><table class="tbl tbl--compact"><thead><tr><th>Date</th><th>Items</th><th>Order</th><th class="num">Total</th></tr></thead><tbody>' +
          chosen.slice(0, 8).map((o) => '<tr><td class="nowrap">' + esc(fmtDate(o.date, { short: true })) + '</td><td class="wrap">' + esc(o.items.join('; ') || '—') + '</td><td class="nowrap muted">' + esc(o.id) + '</td><td class="num">' + (o.total ? esc(money(o.total)) : '—') + '</td></tr>').join('') +
          '</tbody></table></div>' : '<p class="muted">No new orders in this date range.</p>') +
        '<p class="field__help">' + esc(plural(chosen.length, 'new order')) + (chosen.length ? ', ' + esc(money(sum(chosen, (o) => o.total))) + ' in total' : '') + (dupes ? '. ' + plural(dupes, 'order') + ' already filed will be skipped' : '') + '.</p>';
      go.disabled = !chosen.length;
      go.textContent = chosen.length ? 'Import ' + plural(chosen.length, 'order') : 'Import';
      box.querySelector('#ord-from').addEventListener('change', (e) => {
        if (e.target.value) ui2.from = e.target.value;
        draw();
      });
      box.querySelectorAll('input[name="ord-ctx"]').forEach((el) => el.addEventListener('change', () => {
        ui2.mode = el.value;
        draw();
      }));
    }
    draw();
    d.form.addEventListener('submit', (e) => {
      e.preventDefault();
      if (!chosen.length) return;
      const W = wm();
      const mode = MODES.find((m) => m.value === ui2.mode) || MODES[0];
      const batch = 'ord-' + uid();
      const was = {}; // bank lines linked as your payment, with their old category for Undo
      let linked = 0;
      store.commit((st) => {
        const taken = new Set();
        for (const o of chosen) {
          const items = o.items.join('; ');
          const rec = {
            id: 'p-' + uid(), created: t, kind: 'invoice-in', status: 'paid', paidDate: o.date, context: mode.value === 'home' ? 'home' : 'work',
            title: items ? (items.length > 90 ? items.slice(0, 88) + '…' : items) : party + ' order',
            party, amount: o.total || null, date: o.date, dueDate: '', warrantyUntil: '', reference: o.id,
            category: mode.value === 'home' ? F.categorise(items, -1, st.rules, { spend: true }) || 'Shopping' : WORK_OUT,
            notes: (items ? 'Items: ' + items : '') + (parsed.amazon ? '\nOrder details: https://www.' + parsed.domain + '/gp/your-account/order-details?orderID=' + o.id : ''),
            files: [], source: 'order-import', importBatch: batch,
          };
          if (mode.value !== 'home') rec.payer = mode.value === 'back' ? 'me' : 'company';
          if (mode.value === 'back') rec.claimStatus = 'to-send';
          if (W) W.normalise(rec);
          if (W && mode.value === 'back' && rec.amount) {
            const r = W.purchaseFor(st, rec, taken);
            if (r.sure && r.tx) {
              if (!(r.tx.id in was)) was[r.tx.id] = r.tx.category;
              rec.purchaseTx = r.tx.id;
              rec.purchaseWas = r.tx.category || '';
              r.tx.category = WORK_OUT;
              taken.add(r.tx.id);
              linked++;
            }
          }
          st.paperwork.push(rec);
        }
      });
      const n = chosen.length;
      d.close();
      toast('Imported ' + plural(n, 'order') + (linked ? ' and linked ' + plural(linked, 'bank payment') : ''), { action: 'Undo', onAction: () => store.commit((st) => {
        st.paperwork = st.paperwork.filter((p) => p.importBatch !== batch);
        for (const txId in was) {
          const tx = st.transactions.find((x) => x.id === txId);
          if (tx) tx.category = was[txId];
        }
      }) });
      if (mode.value === 'home') {
        ui.filter = 'paid';
        GU.view.go('receipts');
      } else GU.view.go(GU.tabs && GU.tabs[mode.tab] ? mode.tab : 'work');
    });
  }

  GU.tabs.receipts = { label: 'Receipts', short: 'Receipts', icon: 'receipt', part: 'home', render, create, edit, markPaid, showOwed, showClaims, markClaimed, importOrders, KINDS };
})();
