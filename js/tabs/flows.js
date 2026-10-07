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

  /* ---------- work money ---------- */
  /* Your employer's short name for sentences ('the company' when none is set). */
  const co = (s, cap) => (GU.parts && GU.parts.co ? GU.parts.co(s, cap) : cap ? 'The company' : 'the company');
  const wm = () => GU.workMoney || null;
  const isWorkBill = (b) => (GU.parts && GU.parts.isWorkBill ? GU.parts.isWorkBill(b) : b.context === 'work' || (!b.context && b.category === F.WORK_OUT));
  /* Your wages from the employer: the line names them, or it says wages and is about your usual pay. */
  function isWages(s, t) {
    const T = GU.tabs.transactions;
    return !!(T && T.isWages && T.isWages(s, t));
  }
  /* The regular income your wages from the employer come in as. */
  function isWageSource(s, x) {
    const w = wm();
    if (!w || !w.employer(s).set) return false;
    const src = w.wageSource(s);
    return !!src && src.id === x.id;
  }
  const wagePill = (s) => ' ' + pill('Wages from ' + co(s), '', 'briefcase');
  const PERIOD_WORDS = { 'this-month': 'this month', 'last-month': 'last month', '3m': 'in the last 3 months', '12m': 'in the last 12 months', all: 'so far' };

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

  /* Your own money in or out: transfers between your accounts and work money are left out. */
  function txList(list, dir, limit) {
    const s = store.state;
    const rows = list.filter((t) => (dir === 'in' ? t.amount > 0 : t.amount < 0) && F.counts(t))
      .sort((a, b) => (dir === 'out' ? a.amount - b.amount : b.date.localeCompare(a.date))).slice(0, limit);
    if (!rows.length) return emptyState({ icon: dir === 'in' ? 'in' : 'out', title: dir === 'in' ? 'No money in for this period' : 'No spending in this period', text: 'Import a bank statement or add entries by hand.' });
    return '<ul class="rows rows--tight">' + rows.map((t) =>
      '<li class="row-item"><button type="button" class="row-item__main" data-tx="' + esc(t.id) + '"><span class="row-item__text"><b>' + esc(t.description) + '</b><em>' +
      esc(fmtDate(t.date, { short: true }) + ' · ' + (dir === 'in' && isWages(s, t) ? 'Wages from ' + co(s) : t.category || 'Needs a category')) + '</em></span></button>' +
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

    const upcoming = [];
    for (const x of sources) {
      if (!x.nextDate) continue;
      for (const d of F.occurrences(x.nextDate, x.frequency, x.anchorDay, today(), GU.util.addDays(today(), 62))) upcoming.push({ d, x });
    }
    upcoming.sort((a, b) => a.d.localeCompare(b.d));
    root.innerHTML = GU.view.head({
      eyebrow: 'Money ahead',
      title: 'Income',
      text: 'The money you expect: benefits, salary and anything else that comes in on a schedule. It’s all in the plan on your Home page.',
      actions: '<button type="button" class="btn btn--primary" data-add-source>' + icon('plus') + 'Add expected income</button>',
    }) +
      '<div class="cols cols--main-side">' +
      '<div class="stack">' +
      '<section class="panel"><header class="panel__head"><h2>Coming in</h2><span class="muted">next 2 months</span></header>' +
      (upcoming.length ? '<ul class="rows rows--tight">' + upcoming.map(({ d, x }) =>
        '<li class="row-item"><button type="button" class="row-item__main" data-source="' + esc(x.id) + '"><span class="row-item__icon">' + icon('in') + '</span><span class="row-item__text"><b>' + esc(x.name) + (isWageSource(s, x) ? wagePill(s) : '') + '</b><em>' + esc([x.from, F.freqLabel(x.frequency)].filter(Boolean).join(' · ')) + '</em></span></button>' +
        '<span class="row-item__date"><b>' + esc(fmtDate(d, { weekday: true })) + '</b><em>' + esc(relDays(d)) + '</em></span><span></span><span class="row-item__amt is-in">' + esc(money(x.amount, { sign: true })) + '</span><span></span></li>').join('') + '</ul>'
        : '<div class="panel__body"><p class="muted">Add your salary, benefits or any income you get on a schedule and I’ll plan around it.</p></div>') + '</section>' +
      '<details class="panel panel--details"><summary class="panel__head"><h2>Past income</h2><span class="muted">from your statements</span></summary>' +
      '<div class="panel__body">' + (chartHTML(list, 'in') || '<p class="muted">Nothing to chart yet.</p>') + '</div>' +
      '<header class="panel__head"><h3>Payments received</h3>' + chips('period', F.PERIODS, period.in) + '</header>' + txList(filt, 'in', 40) + '</details>' +
      '</div><aside class="stack">' +
      '<section class="panel"><header class="panel__head"><h2>Regular income</h2><button type="button" class="btn btn--sm btn--ghost" data-add-source>' + icon('plus') + 'Add</button></header>' +
      (sources.length ? '<ul class="rows rows--tight">' + sources.map((x) =>
        '<li class="row-item"><button type="button" class="row-item__main" data-source="' + esc(x.id) + '"><span class="row-item__text"><b>' + esc(x.name) + (isWageSource(s, x) ? wagePill(s) : '') + '</b><em>' +
        esc([F.freqLabel(x.frequency), x.nextDate ? 'next ' + fmtDate(x.nextDate, { short: true }) : ''].filter(Boolean).join(' · ')) + '</em></span></button>' +
        '<span class="row-item__amt is-in">' + esc(money(x.amount)) + '</span></li>').join('') + '</ul>'
        : '<div class="panel__body"><p class="muted">Nothing yet.</p></div>') + '</section>' +
      '<section class="panel"><div class="panel__body"><p><b>' + esc(money(next30)) + '</b> <span class="muted">expected in the next 30 days</span></p></div></section>' +
      paidBackNote(s) +
      '</aside></div>';

    root.addEventListener('click', (e) => {
      const c = e.target.closest('[data-chip="period"]');
      if (c) {
        period.in = c.dataset.value;
        return GU.render();
      }
      if (e.target.closest('[data-import]')) return GU.tabs.transactions.importStatement();
      if (e.target.closest('[data-add]')) return GU.tabs.transactions.create({ direction: 'in', category: 'Salary' });
      if (e.target.closest('[data-add-source]')) return createSource();
      const src = e.target.closest('[data-source]');
      if (src) return editSource(src.dataset.source);
      const tx = e.target.closest('[data-tx]');
      if (tx) GU.tabs.transactions.edit(tx.dataset.tx);
    });
  }

  /* Money your employer paid you back isn't income: it's your own money coming home. Says how much this
     tax year, with the way to Get paid back. */
  function paidBackNote(s) {
    const w = wm();
    if (!w || !w.paidBackSince) return '';
    const from = w.taxYearStart(today());
    const total = w.paidBackSince(s, from);
    if (!(total > 0)) return '';
    return '<p class="note-line note-line--back flows-note">' + icon('coin') + '<span>' +
      esc(money(total) + ' paid back by ' + co(s) + ' since ' + fmtDate(from, { short: true }) + ' isn’t income, so it’s left out here.') + '</span>' +
      '<a class="btn btn--sm btn--ghost" href="#work-back">Get paid back' + icon('chevron') + '</a></p>';
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
        store.remove('incomeSources', id, x.name);
      },
    });
  }

  /* ---------- Outgoings ---------- */
  function renderOut(root) {
    const s = store.state;
    const list = s.transactions;
    const filt = list.filter(F.periodFilter(period.out));
    const single = period.out === 'this-month' || period.out === 'last-month';
    // Work money never has a budget: it isn't your spending.
    const budgets = Object.fromEntries(Object.entries(s.settings.budgets || {}).filter(([c]) => !F.WORK.includes(c)));
    const cats = F.byCategory(filt, 'out').map((c) => ({ label: c.category, value: c.total, budget: single ? budgets[c.category] : null }));
    if (single) for (const [c, b] of Object.entries(budgets)) if (b && !cats.some((x) => x.label === c)) cats.push({ label: c, value: 0, budget: b });
    const cur = monthKey(today());
    const spentByCat = new Map(F.byCategory(F.inMonth(list, cur), 'out').map((c) => [c.category, c.total]));
    const budgetTotal = sum(Object.values(budgets).filter(Boolean));
    const budgetUsed = sum(Object.entries(budgets).filter(([, b]) => b), ([c]) => spentByCat.get(c) || 0);
    const billsMonthly = sum(s.bills.filter((b) => b.active !== false && !isWorkBill(b)), (b) => F.monthlyEquivalent(b.amount, b.frequency));

    root.innerHTML = GU.view.head({
      eyebrow: 'Money so far',
      title: 'Spending',
      text: 'Where your money goes, by category. Set a monthly budget for any category and I’ll warn you when you go over.',
      actions: '<button type="button" class="btn" data-import>' + icon('upload') + 'Import statements</button><button type="button" class="btn" data-budgets>' + icon('flag') + 'Set budgets</button><button type="button" class="btn btn--primary" data-add>' + icon('plus') + 'Add spending</button>',
    }) +
      ledger(list, 'out', budgetTotal
        ? '<div><span>Budget left this month</span><b class="' + (budgetUsed > budgetTotal ? 'is-crit' : '') + '">' + esc(money(budgetTotal - budgetUsed)) + '</b><em>of ' + esc(money(budgetTotal, { whole: true })) + ' budgeted</em></div>'
        : '<div><span>Regular bills</span><b>' + esc(money(billsMonthly)) + '</b><em>per month · <a class="link" href="#bills">see bills</a></em></div>') +
      workStripHTML(s, filt) +
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
      if (e.target.closest('[data-import]')) return GU.tabs.transactions.importStatement();
      if (e.target.closest('[data-add]')) return GU.tabs.transactions.create({ direction: 'out' });
      if (e.target.closest('[data-budgets]')) return editBudgets();
      const tx = e.target.closest('[data-tx]');
      if (tx) return GU.tabs.transactions.edit(tx.dataset.tx);
    });
  }

  /* Work money left out of Spending: what you paid for your employer in this period, what they paid back,
     and what's still to come back, with the way to Get paid back. */
  function workStripHTML(s, filt) {
    // A shop's refund on something bought for work comes off what you paid, as on the Bank page's Work money.
    const out = sum(filt.filter((t) => t.category === F.WORK_OUT), (t) => -t.amount);
    const back = sum(filt.filter((t) => t.amount > 0 && t.category === F.WORK_IN), (t) => t.amount);
    const w = wm();
    // A repayment that's come in but isn't ticked off yet is paid back, not still due.
    const waiting = w && w.awaiting ? w.awaiting(s).total : 0;
    const due = w && w.dueBack ? Math.max(0, GU.util.round2(w.dueBack(s).total - waiting)) : 0;
    if (!(out > 0) && !(back > 0) && !(due > 0)) return '';
    const c = co(s);
    let text;
    if (out > 0 || back > 0) {
      const bits = [money(out) + ' you paid for ' + c + ' ' + (PERIOD_WORDS[period.out] || ''), money(back) + ' paid back'];
      if (due > 0) bits.push(money(due) + ' still due back');
      if (waiting > 0) bits.push(money(waiting) + ' come in, to confirm in Get paid back');
      text = '<b>Not counted here:</b> ' + esc(bits.join(' · '));
    } else text = esc(co(s, true) + ' owes you ' + money(due) + '. Work money is kept out of your spending.');
    return '<p class="note-line note-line--back flows-note">' + icon('briefcase') + '<span>' + text + '</span>' +
      '<a class="btn btn--sm btn--ghost" href="#work-back">Get paid back' + icon('chevron') + '</a></p>';
  }

  function editBudgets() {
    const b = store.state.settings.budgets || {};
    // Work money is kept out of your spending, so it can't have a budget.
    const cats = F.EXPENSE.filter((c) => c !== 'Savings & investments' && !F.WORK.includes(c));
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

  GU.tabs.incomings = { label: 'Income', short: 'Income', icon: 'in', part: 'home', render: renderIn, edit: editSource, createSource };
  GU.tabs.outgoings = { label: 'Spending', short: 'Spending', icon: 'out', part: 'home', render: renderOut, editBudgets };
})();
