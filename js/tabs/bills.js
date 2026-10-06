/* The Ground Up: Bills. Regular payments with their next due date. Direct debits and standing
   orders move on by themselves; bills you pay by hand wait for you to mark them paid. */
(function () {
  'use strict';
  const GU = window.GU;
  const { esc, uid, today, money, fmtDate, relDays, daysUntil, plural, sum } = GU.util;
  const { icon, pill, emptyState, formDialog, toast } = GU.ui;
  const F = GU.finance;
  const store = GU.store;

  const METHODS = ['Direct debit', 'Standing order', 'Card (automatic)', 'Pay manually'];
  const isAuto = (m) => m !== 'Pay manually';
  let showStopped = false;

  function status(b) {
    if (b.active === false) return pill('Stopped', 'muted');
    const n = daysUntil(b.nextDue);
    if (!b.autopay && n < 0) return pill('Overdue', 'crit', 'alert');
    if (n === 0) return pill(b.autopay ? 'Leaves today' : 'Due today', b.autopay ? 'info' : 'warn', 'clock');
    if (n <= 7) return pill('Due ' + relDays(b.nextDue), b.autopay ? 'info' : 'warn', 'clock');
    return b.autopay ? pill('Automatic', 'muted', 'repeat') : pill('Pay by hand', 'muted');
  }

  function rowHTML(b) {
    const canPay = b.active !== false && !b.autopay;
    return '<li class="row-item" data-id="' + esc(b.id) + '">' +
      '<button type="button" class="row-item__main" data-edit="' + esc(b.id) + '">' +
      '<span class="row-item__icon">' + icon(b.autopay ? 'repeat' : 'bills') + '</span>' +
      '<span class="row-item__text"><b>' + esc(b.name) + '</b><em>' + esc([b.payee, F.freqLabel(b.frequency), b.method, (b.files || []).length ? plural(b.files.length, 'file') : ''].filter(Boolean).join(' · ')) + '</em></span></button>' +
      '<span class="row-item__date">' + (b.active === false ? '' : '<b>' + esc(fmtDate(b.nextDue, { weekday: true })) + '</b><em>' + esc(relDays(b.nextDue)) + '</em>') + '</span>' +
      '<span class="row-item__status">' + status(b) + '</span>' +
      '<span class="row-item__amt">' + esc(money(b.amount)) + '</span>' +
      '<span class="row-item__act">' + (canPay ? '<button type="button" class="btn btn--sm btn--soft" data-pay="' + esc(b.id) + '">' + icon('check') + 'Paid</button>' : '') + '</span></li>';
  }

  function render(root) {
    const s = store.state;
    const t = today();
    const active = s.bills.filter((b) => b.active !== false).sort((a, b) => (a.nextDue < b.nextDue ? -1 : 1));
    const stopped = s.bills.filter((b) => b.active === false);
    const monthly = sum(active, (b) => F.monthlyEquivalent(b.amount, b.frequency));
    const week = active.filter((b) => daysUntil(b.nextDue) >= 0 && daysUntil(b.nextDue) <= 7);
    const overdue = active.filter((b) => !b.autopay && b.nextDue < t);
    const groups = [
      { title: 'Overdue', items: overdue },
      { title: 'Next 30 days', items: active.filter((b) => !overdue.includes(b) && daysUntil(b.nextDue) <= 30) },
      { title: 'Later', items: active.filter((b) => !overdue.includes(b) && daysUntil(b.nextDue) > 30) },
    ].filter((g) => g.items.length);

    const byCat = new Map();
    for (const b of active) {
      const c = b.category || 'Other spending';
      byCat.set(c, (byCat.get(c) || 0) + F.monthlyEquivalent(b.amount, b.frequency));
    }
    const catItems = Array.from(byCat, ([label, value]) => ({ label, value: Math.round(value * 100) / 100 })).sort((a, b) => b.value - a.value);

    root.innerHTML = GU.view.head({
      eyebrow: 'Money',
      title: 'Bills',
      text: 'Your regular payments. Direct debits and standing orders roll on by themselves; bills you pay by hand show up on your Today list until you mark them paid.',
      actions: '<button type="button" class="btn btn--primary" data-add>' + icon('plus') + 'Add bill</button>',
    }) +
      GU.ui.dropbar('Drop bills and contracts here, or a whole folder', 'Each new company becomes a bill. Letters from a company you already have are added to its bill, not duplicated.') +
      '<div class="ledger">' +
      '<div><span>Bills per month</span><b>' + esc(money(monthly)) + '</b><em>on average</em></div>' +
      '<div><span>Bills per year</span><b>' + esc(money(monthly * 12, { whole: true })) + '</b><em>' + esc(plural(active.length, 'active bill')) + '</em></div>' +
      '<div><span>Due in the next 7 days</span><b>' + esc(money(sum(week, (b) => b.amount))) + '</b><em>' + esc(plural(week.length, 'bill')) + '</em></div>' +
      '<div><span>Overdue</span><b class="' + (overdue.length ? 'is-crit' : '') + '">' + overdue.length + '</b><em>' + (overdue.length ? esc(money(sum(overdue, (b) => b.amount))) + ' to pay' : 'all paid') + '</em></div>' +
      '</div>' +
      '<div class="cols cols--main-side">' +
      '<div class="stack">' +
      (groups.length ? groups.map((g) => '<section class="panel"><header class="panel__head"><h2>' + esc(g.title) + '</h2><span class="muted">' + esc(money(sum(g.items, (b) => b.amount))) + '</span></header><ul class="rows">' + g.items.map(rowHTML).join('') + '</ul></section>').join('')
        : '<section class="panel">' + emptyState({ icon: 'bills', title: 'No bills yet', text: 'Add your rent, energy, phone, subscriptions and anything else you pay regularly.', action: '<button type="button" class="btn btn--primary" data-add>' + icon('plus') + 'Add your first bill</button>' }) + '</section>') +
      (stopped.length ? '<details class="panel panel--details"' + (showStopped ? ' open' : '') + '><summary class="panel__head"><h2>Stopped bills</h2><span class="muted">' + stopped.length + '</span></summary><ul class="rows">' + stopped.map(rowHTML).join('') + '</ul></details>' : '') +
      '</div>' +
      '<aside class="stack">' +
      (catItems.length ? '<section class="panel"><header class="panel__head"><h2>Where your bills go</h2><span class="muted">per month</span></header><div class="panel__body">' + GU.charts.barList(catItems, { color: '--series-out' }) + '</div></section>' : '') +
      '<section class="panel"><div class="panel__body tip">' + icon('info') + '<p>Bills paid by direct debit or standing order move to their next date automatically. If you also import your bank statements, leave “add to transactions” unticked when you mark a bill paid, so it isn’t counted twice.</p></div></section>' +
      '</aside></div>';

    GU.ui.wireDropbar(root, (files) => GU.inbox.add({ files, scope: { kind: 'bills', name: 'Bills' } }));
    const det = root.querySelector('.panel--details');
    if (det) det.addEventListener('toggle', () => (showStopped = det.open));
    root.addEventListener('click', (e) => {
      if (e.target.closest('[data-add]')) return create();
      const pay = e.target.closest('[data-pay]');
      if (pay) return markPaid(pay.dataset.pay);
      const ed = e.target.closest('[data-edit]');
      if (ed) edit(ed.dataset.edit);
    });
  }

  function fields() {
    return [
      { name: 'name', label: 'What is it?', required: true, placeholder: 'e.g. Electricity, Netflix, Rent' },
      { name: 'payee', label: 'Paid to', placeholder: 'e.g. Octopus Energy', optional: true },
      { name: 'amount', label: 'Amount', type: 'money', required: true, half: true },
      { name: 'frequency', label: 'How often', type: 'select', options: F.FREQUENCIES, default: 'monthly', half: true },
      { name: 'nextDue', label: 'Next payment date', type: 'date', required: true, half: true },
      { name: 'method', label: 'How it’s paid', type: 'select', options: METHODS, default: 'Direct debit', half: true },
      { name: 'category', label: 'Category', type: 'select', options: F.EXPENSE, default: 'Bills & utilities', half: true },
      { name: 'account', label: 'From account', type: 'select', options: store.state.accounts.map((a) => ({ value: a.id, label: a.name })), half: true },
      { name: 'notes', label: 'Notes', type: 'textarea', rows: 2, optional: true, placeholder: 'Account number, contract end date, how to cancel…' },
      { name: 'files', label: 'Paperwork', type: 'files', dropLabel: 'Attach the contract or latest bill' },
      { name: 'active', label: 'Active', type: 'checkbox', checkLabel: 'I still pay this bill' },
    ];
  }

  function save(v, existing) {
    const rec = Object.assign(existing ? Object.assign({}, existing) : { id: 'b-' + uid(), history: [], created: today() }, v, {
      autopay: isAuto(v.method),
      anchorDay: +String(v.nextDue).slice(8, 10),
      active: existing ? v.active : true,
    });
    store.upsert('bills', rec);
    return rec;
  }

  function create(prefill, opts) {
    opts = opts || {};
    formDialog({
      title: 'Add a bill',
      fields: fields().filter((f) => f.name !== 'active'),
      values: Object.assign({ nextDue: today(), frequency: 'monthly', method: 'Direct debit', category: 'Bills & utilities' }, prefill || {}),
      submitLabel: 'Add bill',
      onSubmit: (v) => {
        const rec = save(v, null);
        toast('Added ' + rec.name);
        if (opts.onSaved) opts.onSaved(rec);
      },
    });
  }

  function edit(id) {
    const b = store.find('bills', id);
    if (!b) return;
    formDialog({
      title: 'Edit bill',
      fields: fields(),
      values: Object.assign({}, b, { active: b.active !== false }),
      onSubmit: (v) => {
        save(v, b);
      },
      onDelete: () => {
        store.remove('bills', id);
        toast('Bill deleted');
      },
      deleteMessage: 'This removes the bill and its payment history. Transactions already in your bank list are kept.',
    });
  }

  function markPaid(id) {
    const b = store.find('bills', id);
    if (!b) return;
    formDialog({
      title: 'Mark ' + b.name + ' as paid',
      fields: [
        { name: 'amount', label: 'Amount paid', type: 'money', required: true, half: true },
        { name: 'date', label: 'Date paid', type: 'date', required: true, half: true },
        { name: 'record', label: 'Also add', type: 'checkbox', checkLabel: 'Add this payment to my bank transactions' },
      ],
      values: { amount: b.amount, date: today(), record: false },
      submitLabel: 'Mark paid',
      onSubmit: (v) => {
        const before = JSON.parse(JSON.stringify(b));
        let txId = null;
        store.commit((s) => {
          const bill = s.bills.find((x) => x.id === id);
          bill.history = (bill.history || []).concat([{ date: v.date, amount: v.amount }]).slice(-60);
          const n = F.nextDate(bill.nextDue, bill.frequency, bill.anchorDay);
          if (n) bill.nextDue = n;
          else bill.active = false;
          if (v.record) {
            txId = 't-' + uid();
            s.transactions.push({ id: txId, date: v.date, description: bill.payee || bill.name, amount: -Math.abs(v.amount), category: bill.category || 'Bills & utilities', account: bill.account || (s.accounts[0] || {}).id, notes: 'Bill: ' + bill.name, source: 'bill', created: today() });
          }
        });
        const nb = store.find('bills', id);
        toast(b.name + ' paid' + (nb.active !== false ? '. Next due ' + fmtDate(nb.nextDue, { short: true }) : ''), {
          action: 'Undo',
          onAction: () => store.commit((s) => {
            s.bills = s.bills.map((x) => (x.id === id ? before : x));
            if (txId) s.transactions = s.transactions.filter((t) => t.id !== txId);
          }),
        });
      },
    });
  }

  GU.tabs.bills = { label: 'Bills', short: 'Bills', icon: 'bills', render, create, edit, markPaid, METHODS };
})();
