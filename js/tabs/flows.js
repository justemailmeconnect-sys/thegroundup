/* The Ground Up: Incomings and Outgoings. Two views over the same bank ledger:
   where money comes from, and where it goes (with optional monthly budgets). */
(function () {
  'use strict';
  const GU = window.GU;
  const { esc, uid, today, money, fmtDate, relDays, monthKey, shiftMonth, monthLabel, sum, plural } = GU.util;
  const { icon, pill, emptyState, chips, formDialog, toast } = GU.ui;
  const F = GU.finance;
  const store = GU.store;

  const period = { in: 'this-month', out: 'this-month' };

  function monthsBack(list, dir, n) {
    const series = F.monthSeries(list, n);
    return series.map((m) => ({ key: m.key, value: dir === 'in' ? m.in : m.out }));
  }

  function chartHTML(list, dir) {
    const months = monthsBack(list, dir, 12);
    if (!months.some((m) => m.value)) return '';
    return GU.charts.columns({
      data: months.map((m) => ({ label: monthLabel(m.key), values: [m.value], tip: monthLabel(m.key, true) + ': ' + money(m.value) + (dir === 'in' ? ' in' : ' out') })),
      series: [{ name: dir === 'in' ? 'Money in' : 'Money out', color: dir === 'in' ? '--series-in' : '--series-out' }],
      height: 160,
      table: { head: ['Month', dir === 'in' ? 'Money in' : 'Money out'], rows: months.slice().reverse().map((m) => [monthLabel(m.key, true), money(m.value)]) },
    });
  }

  function txList(list, dir, limit) {
    const rows = list.filter((t) => (dir === 'in' ? t.amount > 0 : t.amount < 0) && !F.isTransfer(t))
      .sort((a, b) => (dir === 'out' ? a.amount - b.amount : b.date.localeCompare(a.date))).slice(0, limit);
    if (!rows.length) return emptyState({ icon: dir === 'in' ? 'in' : 'out', title: dir === 'in' ? 'No money in for this period' : 'No spending in this period', text: 'Import a bank statement or add entries by hand.' });
    return '<ul class="rows rows--tight">' + rows.map((t) =>
      '<li class="row-item"><button type="button" class="row-item__main" data-tx="' + esc(t.id) + '"><span class="row-item__text"><b>' + esc(t.description) + '</b><em>' + esc(fmtDate(t.date, { short: true }) + ' · ' + (t.category || 'Needs a category')) + '</em></span></button>' +
      '<span class="row-item__amt ' + (t.amount > 0 ? 'is-in' : '') + '">' + esc(money(t.amount, { sign: true })) + '</span></li>').join('') + '</ul>';
  }

  function ledger(list, dir, extra) {
    const cur = monthKey(today());
    const val = (key) => (dir === 'in' ? F.moneyIn : F.moneyOut)(F.inMonth(list, key));
    const thisM = val(cur);
    const lastM = val(shiftMonth(cur, -1));
    const prev = [1, 2, 3, 4, 5, 6].map((i) => val(shiftMonth(cur, -i)));
    const active = prev.filter((v) => v > 0);
    const avg = active.length ? sum(active) / active.length : 0;
    return '<div class="ledger">' +
      '<div><span>' + (dir === 'in' ? 'In' : 'Spent') + ' this month</span><b>' + esc(money(thisM)) + '</b><em>' + esc(monthLabel(cur, true)) + ' so far</em></div>' +
      '<div><span>Last month</span><b>' + esc(money(lastM)) + '</b><em>' + esc(monthLabel(shiftMonth(cur, -1), true)) + '</em></div>' +
      '<div><span>Average per month</span><b>' + esc(money(avg)) + '</b><em>last 6 months</em></div>' +
      extra + '</div>';
  }

  /* ---------- Incomings ---------- */
  function renderIn(root) {
    const s = store.state;
    const list = s.transactions;
    const filt = list.filter(F.periodFilter(period.in));
    const sources = s.incomeSources.slice().sort((a, b) => (a.nextDate || '9').localeCompare(b.nextDate || '9'));
    const next30 = sum(sources, (x) => (x.nextDate ? F.occurrences(x.nextDate, x.frequency, x.anchorDay, today(), GU.util.addDays(today(), 30)).length * x.amount : 0));
    const cats = F.byCategory(filt, 'in').map((c) => ({ label: c.category, value: c.total }));

    root.innerHTML = GU.view.head({
      eyebrow: 'Money',
      title: 'Incomings',
      text: 'Money coming in: salary, side work, refunds, benefits. Worked out from your bank transactions, plus the regular income you expect.',
      actions: '<button type="button" class="btn" data-add-source>' + icon('repeat') + 'Add regular income</button><button type="button" class="btn btn--primary" data-add>' + icon('plus') + 'Add money in</button>',
    }) +
      ledger(list, 'in', '<div><span>Expected in the next 30 days</span><b>' + esc(money(next30)) + '</b><em>from ' + esc(plural(sources.length, 'regular source')) + '</em></div>') +
      '<div class="cols cols--main-side">' +
      '<div class="stack">' +
      '<section class="panel"><header class="panel__head"><h2>Money in, last 12 months</h2></header><div class="panel__body">' + (chartHTML(list, 'in') || '<p class="muted">Nothing to chart yet.</p>') + '</div></section>' +
      '<section class="panel"><header class="panel__head"><h2>Payments received</h2>' + chips('period', F.PERIODS, period.in) + '</header>' + txList(filt, 'in', 40) + '</section>' +
      '</div><aside class="stack">' +
      '<section class="panel"><header class="panel__head"><h2>Regular income</h2><button type="button" class="btn btn--sm btn--ghost" data-add-source>' + icon('plus') + 'Add</button></header>' +
      (sources.length ? '<ul class="rows rows--tight">' + sources.map((x) =>
        '<li class="row-item"><button type="button" class="row-item__main" data-source="' + esc(x.id) + '"><span class="row-item__text"><b>' + esc(x.name) + '</b><em>' +
        esc([F.freqLabel(x.frequency), x.nextDate ? 'next ' + fmtDate(x.nextDate, { short: true }) + ' (' + relDays(x.nextDate) + ')' : ''].filter(Boolean).join(' · ')) + '</em></span></button>' +
        '<span class="row-item__amt is-in">' + esc(money(x.amount)) + '</span></li>').join('') + '</ul>'
        : '<div class="panel__body"><p class="muted">Add your salary or any income you get on a schedule, and I’ll show when it’s due on your Today page.</p></div>') + '</section>' +
      '<section class="panel"><header class="panel__head"><h2>Where it comes from</h2><span class="muted">' + esc(F.PERIODS.find((p) => p.value === period.in).label.toLowerCase()) + '</span></header><div class="panel__body">' +
      (cats.length ? GU.charts.barList(cats, { color: '--series-in' }) : '<p class="muted">No money in for this period.</p>') + '</div></section>' +
      '</aside></div>';

    root.addEventListener('click', (e) => {
      const c = e.target.closest('[data-chip="period"]');
      if (c) {
        period.in = c.dataset.value;
        return GU.render();
      }
      if (e.target.closest('[data-add]')) return GU.tabs.transactions.create({ direction: 'in', category: 'Salary' });
      if (e.target.closest('[data-add-source]')) return createSource();
      const src = e.target.closest('[data-source]');
      if (src) return editSource(src.dataset.source);
      const tx = e.target.closest('[data-tx]');
      if (tx) GU.tabs.transactions.edit(tx.dataset.tx);
    });
  }

  function sourceFields() {
    return [
      { name: 'name', label: 'Name', required: true, placeholder: 'e.g. Salary, Rent from lodger' },
      { name: 'from', label: 'Paid by', optional: true, placeholder: 'e.g. employer name' },
      { name: 'amount', label: 'Usual amount', type: 'money', required: true, half: true },
      { name: 'frequency', label: 'How often', type: 'select', options: F.FREQUENCIES.filter((f) => f.value !== 'once'), default: 'monthly', half: true },
      { name: 'nextDate', label: 'Next payment expected', type: 'date', required: true, half: true },
      { name: 'account', label: 'Into account', type: 'select', options: store.state.accounts.map((a) => ({ value: a.id, label: a.name })), half: true },
      { name: 'notes', label: 'Notes', type: 'textarea', rows: 2, optional: true },
    ];
  }
  function saveSource(v, existing) {
    store.upsert('incomeSources', Object.assign(existing ? Object.assign({}, existing) : { id: 'i-' + uid(), created: today() }, v, { anchorDay: +String(v.nextDate).slice(8, 10) }));
  }
  function createSource(prefill, opts) {
    formDialog({
      title: 'Add regular income',
      fields: sourceFields(),
      values: Object.assign({ frequency: 'monthly', nextDate: today() }, prefill || {}),
      submitLabel: 'Add',
      onSubmit: (v) => {
        saveSource(v, null);
        toast('Added ' + v.name);
        if (opts && opts.onSaved) opts.onSaved();
      },
    });
  }
  function editSource(id) {
    const x = store.find('incomeSources', id);
    if (!x) return;
    formDialog({
      title: 'Edit regular income',
      fields: sourceFields(),
      values: x,
      onSubmit: (v) => saveSource(v, x),
      onDelete: () => {
        store.remove('incomeSources', id);
        toast('Removed ' + x.name);
      },
    });
  }

  /* ---------- Outgoings ---------- */
  function renderOut(root) {
    const s = store.state;
    const list = s.transactions;
    const filt = list.filter(F.periodFilter(period.out));
    const single = period.out === 'this-month' || period.out === 'last-month';
    const budgets = s.settings.budgets || {};
    const cats = F.byCategory(filt, 'out').map((c) => ({ label: c.category, value: c.total, budget: single ? budgets[c.category] : null }));
    if (single) for (const [c, b] of Object.entries(budgets)) if (b && !cats.some((x) => x.label === c)) cats.push({ label: c, value: 0, budget: b });
    const cur = monthKey(today());
    const spentByCat = new Map(F.byCategory(F.inMonth(list, cur), 'out').map((c) => [c.category, c.total]));
    const budgetTotal = sum(Object.values(budgets).filter(Boolean));
    const budgetUsed = sum(Object.entries(budgets).filter(([, b]) => b), ([c]) => spentByCat.get(c) || 0);
    const billsMonthly = sum(s.bills.filter((b) => b.active !== false), (b) => F.monthlyEquivalent(b.amount, b.frequency));

    root.innerHTML = GU.view.head({
      eyebrow: 'Money',
      title: 'Outgoings',
      text: 'Where your money goes, by category. Set a monthly budget for any category and I’ll warn you when you go over.',
      actions: '<button type="button" class="btn" data-budgets>' + icon('flag') + 'Set budgets</button><button type="button" class="btn btn--primary" data-add>' + icon('plus') + 'Add spending</button>',
    }) +
      ledger(list, 'out', budgetTotal
        ? '<div><span>Budget left this month</span><b class="' + (budgetUsed > budgetTotal ? 'is-crit' : '') + '">' + esc(money(budgetTotal - budgetUsed)) + '</b><em>of ' + esc(money(budgetTotal, { whole: true })) + ' budgeted</em></div>'
        : '<div><span>Regular bills</span><b>' + esc(money(billsMonthly)) + '</b><em>per month · <a class="link" href="#bills">see bills</a></em></div>') +
      '<div class="cols cols--main-side">' +
      '<div class="stack">' +
      '<section class="panel"><header class="panel__head"><h2>Spending by category</h2>' + chips('period', F.PERIODS, period.out) + '</header><div class="panel__body">' +
      (cats.length ? GU.charts.barList(cats.map((c) => Object.assign(c, { key: c.label }))) : '<p class="muted">No spending in this period.</p>') +
      (single ? '' : '<p class="field__help">Budgets show when you pick this month or last month.</p>') + '</div></section>' +
      '<section class="panel"><header class="panel__head"><h2>Money out, last 12 months</h2></header><div class="panel__body">' + (chartHTML(list, 'out') || '<p class="muted">Nothing to chart yet.</p>') + '</div></section>' +
      '</div><aside class="stack">' +
      '<section class="panel"><header class="panel__head"><h2>Biggest payments</h2><span class="muted">' + esc(F.PERIODS.find((p) => p.value === period.out).label.toLowerCase()) + '</span></header>' + txList(filt, 'out', 10) +
      '<div class="panel__foot"><a class="link" href="#transactions">All transactions ' + icon('chevron') + '</a></div></section>' +
      '</aside></div>';

    root.addEventListener('click', (e) => {
      const c = e.target.closest('[data-chip="period"]');
      if (c) {
        period.out = c.dataset.value;
        return GU.render();
      }
      if (e.target.closest('[data-add]')) return GU.tabs.transactions.create({ direction: 'out' });
      if (e.target.closest('[data-budgets]')) return editBudgets();
      const tx = e.target.closest('[data-tx]');
      if (tx) return GU.tabs.transactions.edit(tx.dataset.tx);
    });
  }

  function editBudgets() {
    const b = store.state.settings.budgets || {};
    const cats = F.EXPENSE.filter((c) => c !== 'Savings & investments');
    formDialog({
      title: 'Monthly budgets',
      intro: 'Set a monthly limit for the categories you want to keep an eye on. Leave the rest empty.',
      fields: cats.map((c, i) => ({ name: 'b' + i, label: c, type: 'money', half: true, placeholder: 'No limit' })),
      values: Object.fromEntries(cats.map((c, i) => ['b' + i, b[c] || null])),
      submitLabel: 'Save budgets',
      onSubmit: (v) => {
        store.commit((s) => {
          s.settings.budgets = {};
          cats.forEach((c, i) => {
            if (v['b' + i]) s.settings.budgets[c] = v['b' + i];
          });
        });
        toast('Budgets saved');
      },
    });
  }

  GU.tabs.incomings = { label: 'Incomings', short: 'In', icon: 'in', render: renderIn, edit: editSource, createSource };
  GU.tabs.outgoings = { label: 'Outgoings', short: 'Out', icon: 'out', render: renderOut, editBudgets };
})();
