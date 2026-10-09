/* The Ground Up: Bank transactions. One ledger for every account, CSV statement import,
   automatic categories and rules that learn from your corrections. */
(function () {
  'use strict';
  const GU = window.GU;
  const { esc, uid, today, money, fmtDate, monthKey, monthLabel, plural, parseCSV, parseLooseDate, guessDateOrder, parseAmount, debounce, sum } = GU.util;
  const { icon, pill, emptyState, selectOptions, formDialog, openDialog, toast, confirmBox } = GU.ui;
  const F = GU.finance;
  const store = GU.store;

  const ui = { q: '', month: '', account: '', category: '', type: '', limit: 100 };

  /* ---------- work money on a bank line ---------- */
  /* A line is work money by its category alone: 'Work expenses' is your money spent for your employer,
     'Work reimbursements' is them paying you back (or you sending money back to them). The links between
     a line and the things in Get paid back live on those records (purchaseTx, repaidTx), never on the line. */
  const wm = () => GU.workMoney || null;
  const co = (s, cap) => (GU.parts && GU.parts.co ? GU.parts.co(s, cap) : cap ? 'The company' : 'the company');
  const hasEmployer = (s) => !!(wm() && wm().employer(s || store.state).set);
  const WAGE_WORDS = /\bwages?\b|salary|payroll|\bbonus|overtime|holiday pay|sick pay|commission/i;
  /* Your wages from the employer: a 'Salary' line that names them, or one that says wages and is about
     your usual pay from them (some banks leave the name off). */
  function isWages(s, t) {
    const w = wm();
    if (!w || !t || !(t.amount > 0) || t.category !== 'Salary' || !w.employer(s).set) return false;
    const text = (t.description || '') + ' ' + (t.notes || '');
    if (w.isEmployerText(s, text)) return true;
    const src = w.wageSource(s);
    const pay = src ? Math.abs(Number(src.amount) || 0) : 0;
    return pay > 0 && WAGE_WORDS.test(text) && Math.abs(t.amount - pay) <= 0.2 * pay;
  }
  /* The things in Get paid back a line is linked to: as your payment, or as the employer paying you back. */
  function linksOf(s, id) {
    const list = s.paperwork || [];
    return {
      purchase: list.find((p) => p.purchaseTx === id) || null,
      repaid: list.filter((p) => p.repaidTx === id || (p.repayments || []).some((r) => r.tx === id)),
    };
  }
  /* The pill that says whose money a line is. */
  function workPill(s, t) {
    const c = co(s);
    if (t.category === F.WORK_OUT) {
      const l = linksOf(s, t.id).purchase;
      const st = l && wm() ? wm().stage(l) : '';
      const tip = l ? (st === 'paid-back' ? 'Paid back' : st === 'sent' ? 'Sent to ' + c + ', waiting' : 'In Get paid back, not sent yet') : 'Not in Get paid back yet';
      return '<span class="pill pill--mine" title="' + esc(tip) + '">' + esc('For ' + c) + '</span>';
    }
    if (t.category === F.WORK_IN) return pill(t.amount > 0 ? 'Back from ' + c : 'Back to ' + c, 'ktk');
    if (isWages(s, t)) return pill('Wages from ' + c, '', 'briefcase');
    return '';
  }
  /* A line's usual category if it weren't work money (its own rules and the built-in ones). */
  function homeCategory(s, t) {
    const l = t && t.amount < 0 ? linksOf(s, t.id).purchase : null;
    if (l && l.purchaseWas && !F.WORK.includes(l.purchaseWas)) return l.purchaseWas;
    if (t && t.category && !F.WORK.includes(t.category)) return t.category;
    const c = t ? F.categorise(t.description || '', t.amount, s.rules) : '';
    return c && !F.WORK.includes(c) && c !== 'Salary' ? c : '';
  }

  function accountName(id) {
    const a = store.state.accounts.find((x) => x.id === id);
    return a ? a.name : '';
  }
  function accountOptions() {
    return store.state.accounts.map((a) => ({ value: a.id, label: a.name })).concat([{ value: '__new', label: '+ Add another account…' }]);
  }
  function ensureAccount(v) {
    if (v.account !== '__new') return v.account;
    const name = (v.newAccount || '').trim() || 'New account';
    const id = 'acc-' + uid();
    store.state.accounts.push({ id, name });
    return id;
  }

  function filtered() {
    const s = store.state;
    const q = ui.q.toLowerCase();
    return s.transactions.filter((t) => {
      if (ui.month && t.date.slice(0, 7) !== ui.month) return false;
      if (ui.account && t.account !== ui.account) return false;
      if (ui.category === '__none' && t.category) return false;
      if (ui.category === '__work' && !F.isWork(t)) return false;
      if (ui.category && ui.category !== '__none' && ui.category !== '__work' && t.category !== ui.category) return false;
      if (ui.type === 'in' && t.amount <= 0) return false;
      if (ui.type === 'out' && t.amount >= 0) return false;
      if (q && !(t.description + ' ' + (t.notes || '') + ' ' + (t.category || '')).toLowerCase().includes(q)) return false;
      return true;
    }).sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  }

  function rowsHTML(list) {
    if (!list.length) {
      return '<tr><td colspan="6">' + emptyState({ icon: 'search', art: store.state.transactions.length ? 'search' : 'money', title: store.state.transactions.length ? 'No transactions match' : 'No transactions yet',
        text: store.state.transactions.length ? 'Try clearing the search or filters.' : 'Import a CSV statement from your bank, or add a payment by hand.' }) + '</td></tr>';
    }
    const s = store.state;
    return list.slice(0, ui.limit).map((t) => {
      const work = workPill(s, t);
      const cat = t.category ? pill(t.category, F.counts(t) ? '' : 'muted') : pill('Needs a category', 'warn', 'alert');
      return '<tr class="clickable" data-id="' + esc(t.id) + '" tabindex="0">' +
        '<td class="nowrap muted">' + esc(fmtDate(t.date, { short: true })) + '</td>' +
        '<td class="wrap"><b class="cell-title">' + esc(t.description) + '</b>' + (t.notes ? '<small class="cell-sub">' + esc(t.notes) + '</small>' : '') + '</td>' +
        '<td>' + (work ? '<span class="tx-pills">' + cat + work + '</span>' : cat) + '</td>' +
        '<td class="hide-sm muted">' + esc(accountName(t.account)) + '</td>' +
        '<td class="num ' + (t.amount > 0 ? 'is-in' : '') + '">' + esc(money(t.amount, { sign: true })) + '</td>' +
        '<td class="tbl__more">' + GU.organise.moreBtn('transactions', t.id, t.description) + '</td></tr>';
    }).join('');
  }

  /* ---------- account balances ---------- */
  const ACCOUNT_TYPES = [{ value: 'current', label: 'Current account' }, { value: 'savings', label: 'Savings' }, { value: 'joint', label: 'Joint account' }, { value: 'business', label: 'Business account' }, { value: 'credit', label: 'Credit card' }];
  function accountsStrip(s) {
    const list = GU.money.accounts(s).filter((x) => x.info || x.count);
    if (!list.length) return '';
    const D = GU.tabs.debts;
    return '<div class="acct-strip">' + list.map((x) => {
      const b = x.info;
      const on = ui.account === x.account.id;
      return '<div class="acct' + (on ? ' is-on' : '') + (b && b.balance < 0 ? ' is-neg' : '') + '">' +
        '<button type="button" class="acct__main" data-acct="' + esc(x.account.id) + '" aria-pressed="' + on + '">' +
        '<span class="acct__name">' + esc(x.account.name) + (x.account.bank && !x.account.name.toLowerCase().includes(x.account.bank.toLowerCase()) ? ' <small>' + esc(x.account.bank) + '</small>' : '') + '</span>' +
        '<b class="acct__bal">' + (b ? esc(money(b.balance)) : '–') + '</b>' + D.balanceLine(b, x.account) + '</button>' +
        '<span class="acct__foot">' + D.staleNote(b) + '<button type="button" class="btn btn--sm btn--ghost" data-acct-edit="' + esc(x.account.id) + '">' + icon('edit') + (b ? 'Update' : 'Set balance') + '</button></span></div>';
    }).join('') + '</div>';
  }

  function balanceChart(s) {
    const id = ui.account || (GU.money.accounts(s).filter((x) => x.info).length === 1 ? GU.money.accounts(s).find((x) => x.info).account.id : '');
    if (!id) return '';
    const info = GU.money.accountBalance(s, id);
    const pts = GU.money.balanceSeries(s, id, 120);
    if (!info || pts.length < 3) return '';
    const name = accountName(id);
    const low = pts.reduce((m, p) => (p.value < m.value ? p : m));
    const step = Math.max(1, Math.round(pts.length / 4));
    const labels = [];
    for (let i = 0; i < pts.length; i += step) labels.push({ i, text: fmtDate(pts[i].date, { short: true }) });
    const weekly = pts.filter((p, i) => (pts.length - 1 - i) % 7 === 0);
    const to = pts[pts.length - 1].date;
    return '<section class="panel balance-panel"><header class="panel__head"><h2>' + icon('trend') + esc(name) + ' balance' + (to < info.asOf ? ' from your statements' : '') + '</h2><span class="muted">' +
      esc('Lowest ' + money(low.value) + ' on ' + fmtDate(low.date, { short: true }) + ' · to ' + fmtDate(to, { short: true }) + (to < info.asOf ? ' · ' + money(info.balance) + ' now' : '')) + '</span></header><div class="panel__body">' +
      GU.charts.line(pts.map((p) => ({ value: p.value, tip: fmtDate(p.date, { weekday: true }) + ': ' + money(p.value) })), {
        height: 170, limit: info.overdraftLimit ? -info.overdraftLimit : null, labels,
        table: { head: ['Date', 'Balance'], rows: weekly.reverse().map((p) => [fmtDate(p.date), money(p.value)]) },
      }) + '</div></section>';
  }

  /* Suggested fixes for accounts that got mixed up on import. */
  function fixesHTML(s) {
    const fixes = GU.money.accountFixes(s);
    if (!fixes.length) return '';
    return '<section class="panel panel--spotted acct-fixes"><header class="panel__head"><h2>' + icon('alert') + 'Tidy up your accounts</h2></header><ul class="rows">' +
      fixes.map((f, i) => '<li class="spot"><span class="row-item__icon">' + icon(f.kind === 'merge' ? 'repeat' : 'bank') + '</span><span class="spot__text"><b>' + esc(f.title) + '</b><em>' + esc(f.text) + '</em></span>' +
        '<span class="spot__act"><button type="button" class="btn btn--sm btn--primary" data-fix="' + i + '">' + esc(f.action) + '</button><button type="button" class="btn btn--sm btn--ghost" data-fix-ignore="' + i + '">Leave it</button></span></li>').join('') +
      '</ul></section>';
  }
  function runFix(i) {
    const f = GU.money.accountFixes(store.state)[+i];
    if (!f) return;
    const before = { transactions: store.state.transactions, accounts: store.state.accounts, bills: store.state.bills };
    let r;
    store.commit((st) => {
      st.transactions = st.transactions.map((t) => Object.assign({}, t));
      st.accounts = st.accounts.map((a) => Object.assign({}, a));
      r = GU.money.applyFix(st, f);
      st.bills = st.bills.map((b) => Object.assign({}, b));
      GU.recurring.reassignBills(st);
    });
    toast((f.kind === 'merge' ? 'Merged. ' + plural(r.moved, 'transaction') + ' moved and ' + plural(r.duplicates, 'copy', 'copies') + ' removed.' : 'Moved ' + plural(r.moved, 'transaction') + '.'), {
      timeout: 12000, action: 'Undo', exact: true, onAction: () => store.commit((st) => Object.assign(st, before)),
    });
  }

  /* Once: put right statements that were imported into the wrong account (you can undo it, and the Bank tab
     offers any later fixes one at a time instead). */
  function autoTidy() {
    const s = store.state;
    if (s.meta.accountsTidied || !GU.money.accountFixes(s).length) return;
    const done = [];
    // Not yours to undo from the history (it happens by itself), but its own Undo takes back exactly what it changed, record by record.
    const cap = GU.history.capture(() => store.commit((st) => {
      st.transactions = st.transactions.map((t) => Object.assign({}, t));
      st.accounts = st.accounts.map((a) => Object.assign({}, a));
      st.bills = st.bills.map((b) => Object.assign({}, b));
      for (const x of GU.money.tidyAll(st)) done.push({ f: x.fix, r: x.result });
      GU.recurring.reassignBills(st);
      st.meta.accountsTidied = today();
    }, { history: false }));
    const moved = sum(done, (x) => x.r.moved);
    const copies = sum(done, (x) => x.r.duplicates);
    toast('I tidied up your accounts: ' + plural(moved, 'transaction') + ' moved to the right account and ' + plural(copies, 'copy', 'copies') + ' removed, so nothing is counted twice.', {
      timeout: 20000, action: 'Undo', onAction: () => GU.history.undoLoose(cap.step, 'Account tidy-up'),
    });
  }

  function editAccount(id) {
    const a = store.state.accounts.find((x) => x.id === id);
    if (!a) return;
    const info = GU.money.accountBalance(store.state, id);
    const n = store.state.transactions.filter((t) => t.account === id).length;
    formDialog({
      title: a.name,
      intro: info ? 'I work the balance out from your statements: ' + esc(money(info.balance)) + ' on ' + esc(fmtDate(info.asOf)) + '. If your banking app shows something different, put today’s figure below and I’ll carry on from there.' : 'Import a statement and I’ll read the balance from it, or put today’s balance below.',
      fields: [
        { name: 'name', label: 'Name', required: true },
        { name: 'bank', label: 'Bank', optional: true, half: true, list: ['Monzo', 'Santander', 'HSBC', 'Barclays', 'Lloyds', 'NatWest', 'Nationwide', 'Starling', 'Revolut', 'Halifax'] },
        { name: 'type', label: 'Type', type: 'select', options: ACCOUNT_TYPES, default: 'current', half: true },
        { name: 'overdraftLimit', label: 'Arranged overdraft', type: 'money', optional: true, half: true, showIf: (v) => v.type !== 'credit' && v.type !== 'savings' },
        { name: 'anchorAmount', label: 'Balance now', type: 'text', optional: true, half: true, placeholder: info ? money(info.balance) : 'e.g. 1250.00 or -85.40', help: 'Only if it’s different. Put a minus for overdrawn.' },
        { name: 'anchorDate', label: 'On', type: 'date', half: true },
        { name: 'noImports', type: 'checkbox', checkLabel: 'I don’t import statements for this one', help: 'I won’t ask you to import a statement for it.' },
      ],
      values: { name: a.name, bank: a.bank || '', type: a.type || 'current', overdraftLimit: a.overdraftLimit || null, anchorDate: today(), noImports: !!a.noImports },
      onSubmit: (v) => {
        const amt = v.anchorAmount ? parseAmount(v.anchorAmount) : null;
        if (v.anchorAmount && isNaN(amt)) {
          toast('Enter the balance as a number, for example -85.40');
          return false;
        }
        store.commit((st) => {
          const x = st.accounts.find((y) => y.id === id);
          Object.assign(x, { name: v.name, bank: v.bank, type: v.type, overdraftLimit: v.overdraftLimit || 0 });
          if (v.noImports) x.noImports = true;
          else delete x.noImports;
          if (amt != null) x.balanceAnchor = { date: anchorDate(st, id, v.anchorDate), amount: amt };
        });
      },
      onDelete: n || store.state.accounts.length < 2 ? null : () => store.commit((st) => (st.accounts = st.accounts.filter((x) => x.id !== id))),
      deleteMessage: 'This account has no transactions, so nothing else is removed.',
    });
  }

  /* A balance typed in for today already includes every payment imported for that account,
     even ones the bank dated a day ahead. */
  const anchorDate = (st, id, date) => GU.money.anchorDate(st, id, date);

  /* Tell me what every account holds right now, in one go. Blank boxes are left as they are. */
  function updateBalances() {
    const s = store.state;
    const list = GU.money.accounts(s).filter((x) => x.info || x.count);
    const accts = list.length ? list : GU.money.accounts(s);
    const fields = accts.map((x) => ({
      name: 'bal_' + x.account.id, label: x.account.name, type: 'text', optional: true, half: true, placeholder: x.info ? money(x.info.balance) : 'e.g. 250.00',
      help: x.info ? 'I have ' + esc(money(x.info.balance)) + ' from ' + (x.info.staleDays ? esc(fmtDate(x.info.asOf, { short: true })) : 'today') : 'No balance yet',
    })).concat([{ name: 'date', label: 'These are the balances on', type: 'date', required: true }]);
    formDialog({
      title: 'Update your balances',
      intro: 'Put in what your banking apps show right now. Use a minus for an overdrawn account, for example -233. Leave a box empty to keep my figure. From now on, everything you import after this date is added on top.',
      fields,
      values: { date: today() },
      submitLabel: 'Update balances',
      onSubmit: (v) => {
        const set = [];
        for (const x of accts) {
          const raw = v['bal_' + x.account.id];
          if (!raw) continue;
          const amt = parseAmount(raw);
          if (isNaN(amt)) {
            toast('“' + raw + '” for ' + x.account.name + ' isn’t an amount. Try something like -233.00');
            return false;
          }
          set.push([x.account.id, amt]);
        }
        if (!set.length) return;
        // The same code the Sorting hub and Ask Claude use, so the balance and its date are worked out one way.
        let res;
        try {
          res = GU.money.setBalances(set.map(([id, amount]) => ({ accountId: id, amount })), { date: v.date });
        } catch (e) {
          toast(e.message);
          return false;
        }
        toast('Balances updated. Together you have ' + money(res.together));
      },
    });
  }

  function showAccount(id) {
    ui.account = id;
    ui.limit = 100;
    if (location.hash === '#transactions') GU.render();
    else GU.view.go('transactions');
  }

  function render(root) {
    const s = store.state;
    const intent = GU.view.intent('transactions');
    if (intent && intent.filter === 'uncategorised') {
      Object.assign(ui, { q: '', month: '', account: '', type: '', category: '__none' });
    }
    const months = Array.from(new Set(s.transactions.map((t) => t.date.slice(0, 7)))).sort().reverse();
    const cats = Array.from(new Set(s.transactions.map((t) => t.category).filter(Boolean))).sort();
    const anyWork = hasEmployer(s) || s.transactions.some(F.isWork);
    const catFilters = [{ value: '__none', label: 'Needs a category' }].concat(anyWork ? [{ value: '__work', label: 'Work money' }] : []);
    if (ui.category === '__work' && !anyWork) ui.category = '';

    root.innerHTML = GU.view.head({
      eyebrow: 'Money so far',
      title: 'Bank transactions',
      text: 'Every payment in and out of your accounts, with each account’s balance worked out from your statements. I sort each line into a category.',
      actions: (s.transactions.length || s.accounts.length > 1 ? '<button type="button" class="btn" data-balances>' + icon('coin') + 'Update balances</button>' : '') +
        '<button type="button" class="btn" data-import>' + icon('upload') + 'Import statements</button>' + GU.organise.listButton('bank') +
        '<button type="button" class="btn btn--primary" data-add>' + icon('plus') + 'Add transaction</button>',
    }) +
      GU.ui.dropbar('Drop bank statements here, or a whole folder of them', 'PDF statements from Monzo, Santander, HSBC and most banks, or CSV, Excel, .txt, Quicken and Money files.') +
      (GU.gaps ? GU.gaps.cardHTML(s) : '') + fixesHTML(s) + accountsStrip(s) + balanceChart(s) +
      '<div class="toolbar">' +
      '<label class="search">' + icon('search') + '<input type="search" id="tx-search" placeholder="Search descriptions" value="' + esc(ui.q) + '" aria-label="Search transactions"></label>' +
      '<select id="tx-month" aria-label="Month">' + selectOptions(months.map((m) => ({ value: m, label: monthLabel(m, true) })), ui.month, 'All months') + '</select>' +
      '<select id="tx-account" aria-label="Account">' + selectOptions(s.accounts.map((a) => ({ value: a.id, label: a.name })), ui.account, 'All accounts') + '</select>' +
      '<select id="tx-category" aria-label="Category">' + selectOptions(catFilters.concat(cats), ui.category, 'All categories') + '</select>' +
      '<select id="tx-type" aria-label="Money in or out">' + selectOptions([{ value: 'in', label: 'Money in' }, { value: 'out', label: 'Money out' }], ui.type, 'In and out') + '</select>' +
      '</div>' +
      '<p class="summary-line" id="tx-summary"></p>' +
      '<div class="panel"><div class="table-wrap"><table class="tbl"><thead><tr><th>Date</th><th>Description</th><th>Category</th><th class="hide-sm">Account</th><th class="num">Amount</th><th class="tbl__more" aria-label="More"></th></tr></thead>' +
      '<tbody id="tx-rows"></tbody></table></div></div>' +
      '<div class="more-row" id="tx-more"></div>';

    const draw = () => {
      const list = filtered();
      root.querySelector('#tx-rows').innerHTML = rowsHTML(list);
      root.querySelector('#tx-summary').innerHTML = summaryHTML(s, list);
      root.querySelector('#tx-more').innerHTML = list.length > ui.limit
        ? '<button type="button" class="btn" data-more>Show ' + Math.min(100, list.length - ui.limit) + ' more of ' + (list.length - ui.limit) + '</button>' : '';
    };
    draw();

    GU.ui.wireDropbar(root, (files) => importStatement(files));
    root.querySelector('#tx-search').addEventListener('input', debounce((e) => {
      ui.q = e.target.value;
      ui.limit = 100;
      draw();
    }, 150));
    [['#tx-month', 'month'], ['#tx-account', 'account'], ['#tx-category', 'category'], ['#tx-type', 'type']].forEach(([sel, key]) => {
      root.querySelector(sel).addEventListener('change', (e) => {
        ui[key] = e.target.value;
        ui.limit = 100;
        if (key === 'account') GU.render();
        else draw();
      });
    });
    root.addEventListener('click', (e) => {
      if (e.target.closest('[data-add]')) return create();
      if (e.target.closest('[data-import]')) return importCSV();
      if (e.target.closest('[data-balances]')) return updateBalances();
      const fx = e.target.closest('[data-fix]');
      if (fx) return runFix(fx.dataset.fix);
      const fi = e.target.closest('[data-fix-ignore]');
      if (fi) {
        const f = GU.money.accountFixes(store.state)[+fi.dataset.fixIgnore];
        if (f) store.commit((st) => (st.settings.ignoredAccountFixes = (st.settings.ignoredAccountFixes || []).concat([f.key])));
        return;
      }
      const ae = e.target.closest('[data-acct-edit]');
      if (ae) return editAccount(ae.dataset.acctEdit);
      const ac = e.target.closest('[data-acct]');
      if (ac) {
        ui.account = ui.account === ac.dataset.acct ? '' : ac.dataset.acct;
        ui.limit = 100;
        return GU.render();
      }
      if (e.target.closest('[data-more]')) {
        ui.limit += 100;
        return draw();
      }
      const row = e.target.closest('tr[data-id]');
      if (row) edit(row.dataset.id);
    });
    root.addEventListener('keydown', (e) => {
      const row = e.target.closest && e.target.closest('tr[data-id]');
      if (row && e.key === 'Enter') edit(row.dataset.id);
    });
  }

  /* The line under the filters: totals of your own money in and out. Work money has its own totals when
     it's all you're looking at. */
  function summaryHTML(s, list) {
    if (!list.length) return '';
    const n = esc(plural(list.length, 'transaction'));
    const work = list.filter(F.isWork);
    if (work.length === list.length) {
      const c = co(s);
      // A shop's refund on something bought for work comes off what you paid; only the employer's own payments are 'paid back'.
      const out = sum(work.filter((t) => t.category === F.WORK_OUT), (t) => -t.amount);
      const back = sum(work.filter((t) => t.amount > 0 && t.category === F.WORK_IN), (t) => t.amount);
      const sent = sum(work.filter((t) => t.amount < 0 && t.category === F.WORK_IN), (t) => -t.amount);
      return n + ' · Paid for ' + esc(c) + ' <b>' + esc(money(out)) + '</b> · Paid back by ' + esc(c) + ' <b>' + esc(money(back)) + '</b>' +
        (sent > 0 ? ' · Sent back to ' + esc(c) + ' <b>' + esc(money(sent)) + '</b>' : '') + ' <span class="muted">(work money, kept out of your own totals)</span>';
    }
    const left = work.length ? 'transfers and work money are left out' : 'transfers between your own accounts are left out';
    return n + ' · In <b>' + esc(money(F.moneyIn(list))) + '</b> · Out <b>' + esc(money(F.moneyOut(list))) + '</b>' +
      ' · Net <b>' + esc(money(F.moneyIn(list) - F.moneyOut(list), { sign: true })) + '</b> <span class="muted">(' + left + ')</span>';
  }

  function suggestMatch(desc) {
    return String(desc || '').replace(/[*#\d]+/g, ' ').trim().split(/\s+/).slice(0, 2).join(' ');
  }

  /* The 'What is this?' choice on a line, once you've said who you work for. Money out: yours, or paid for
     your employer (you get it back). Money in: yours, your employer paying you back, or your wages. */
  function workFields(s, t) {
    if (!hasEmployer(s)) return [];
    const c = co(s);
    const out = [{ value: 'mine', label: 'Mine' }, { value: 'work', label: 'Paid for ' + c + ', get it back' }];
    // Money you sent back to your employer (an overpayment, say) is only offered on a line that's theirs.
    if (t && t.amount < 0 && (t.category === F.WORK_IN || wm().isEmployerText(s, (t.description || '') + ' ' + (t.notes || '')))) out.push({ value: 'to', label: 'Money back to ' + c });
    return [
      { name: 'workOut', label: 'What is this?', type: 'segmented', options: out, default: 'mine', showIf: (v) => v.direction !== 'in' },
      { name: 'workIn', label: 'What is this?', type: 'segmented', default: 'mine', showIf: (v) => v.direction === 'in',
        options: [{ value: 'mine', label: 'Mine' }, { value: 'back', label: c + ' paying me back' }, { value: 'wages', label: 'Wages from ' + c }] },
    ];
  }
  /* The choice for a line as it stands, from its category. */
  function workValues(s, t) {
    return {
      workOut: t.category === F.WORK_OUT ? 'work' : t.category === F.WORK_IN && t.amount < 0 ? 'to' : 'mine',
      workIn: t.category === F.WORK_IN && t.amount > 0 ? 'back' : isWages(s, t) ? 'wages' : 'mine',
    };
  }
  const choiceOf = (v) => (v.direction === 'in' ? v.workIn : v.workOut) || 'mine';
  /* Without the choice on the form, the category says it. */
  const choiceFromCategory = (v) => (v.category === F.WORK_OUT && v.direction !== 'in' ? 'work' : v.category === F.WORK_IN ? (v.direction === 'in' ? 'back' : 'to') : 'mine');
  const CATEGORY_FOR = { back: F.WORK_IN, to: F.WORK_IN, wages: 'Salary' };

  function fields(isNew, dir, t) {
    const work = workFields(store.state, t);
    // With the choice on the form, it's the only way to say a line is work money.
    const cats = work.length ? F.categoryOptions().filter((g) => !(g.options || []).some((o) => F.WORK.includes(typeof o === 'string' ? o : o.value))) : F.categoryOptions();
    const mine = (v) => !work.length || choiceOf(v) === 'mine';
    return [
      { name: 'direction', label: 'Type', type: 'segmented', options: [{ value: 'out', label: 'Money out', icon: 'out' }, { value: 'in', label: 'Money in', icon: 'in' }], default: dir || 'out' },
      { name: 'description', label: 'Description', required: true, placeholder: 'e.g. Tesco Express' },
      { name: 'amount', label: 'Amount', type: 'money', required: true, half: true },
      { name: 'date', label: 'Date', type: 'date', required: true, half: true },
    ].concat(work, [
      { name: 'category', label: 'Category', type: 'select', options: cats, placeholder: 'Choose later', half: true, showIf: mine },
      { name: 'account', label: 'Account', type: 'select', options: accountOptions(), half: true },
      { name: 'newAccount', label: 'New account name', placeholder: 'e.g. Monzo, Barclays savings', showIf: (v) => v.account === '__new' },
      { name: 'notes', label: 'Notes', type: 'textarea', rows: 2, optional: true },
      { name: 'remember', label: 'Remember', type: 'checkbox', checkLabel: 'Always use this category for similar payments', showIf: (v) => mine(v) && !!v.category },
      { name: 'match', label: 'When the description contains', showIf: (v) => mine(v) && v.remember && !!v.category, help: 'Applies to future imports and to existing transactions that have no category yet.' },
    ]);
  }
  /* Form values for a line: the work choice from its category, and the category it would have if it weren't
     work money (shown if you switch it to Mine). */
  function formValues(s, t, base) {
    if (!hasEmployer(s)) return base;
    const out = Object.assign(base, workValues(s, t));
    if (F.WORK.includes(out.category)) out.category = t.id ? homeCategory(s, t) : '';
    return out;
  }

  /* Saves the line. category: what to save instead of the form's (for work money). Returns the line's id. */
  function save(v, existing, extra, category) {
    const id = existing ? existing.id : 't-' + uid();
    store.commit((s) => {
      const account = ensureAccount(v);
      const cur = existing ? s.transactions.find((t) => t.id === existing.id) || existing : null;
      const rec = Object.assign(cur ? Object.assign({}, cur) : { id, source: 'manual', created: today() }, extra || {}, {
        date: v.date, description: v.description, amount: (v.direction === 'in' ? 1 : -1) * Math.abs(v.amount || 0),
        category: category === undefined ? v.category : category, account, notes: v.notes,
      });
      const i = s.transactions.findIndex((t) => t.id === rec.id);
      if (i >= 0) s.transactions[i] = rec;
      else s.transactions.push(rec);
      if (v.remember && v.category && v.match) {
        s.rules = s.rules.filter((r) => r.match.toLowerCase() !== v.match.toLowerCase());
        s.rules.push({ id: 'r-' + uid(), match: v.match, category: v.category });
        let n = 0;
        for (const t of s.transactions) {
          if (!t.category && (' ' + t.description + ' ').toLowerCase().includes(v.match.toLowerCase())) {
            t.category = v.category;
            n++;
          }
        }
        if (n) setTimeout(() => toast('Also categorised ' + plural(n, 'other transaction')), 0);
      }
    });
    return (extra && extra.id) || id;
  }

  /* Something in Get paid back made just from this line: no file, not sent, same day and amount. */
  function madeFromLine(p, t) {
    const w = wm();
    return !!(p && t && !(p.files || []).length && !p.billId && w && w.stage(p) === 'to-send' && p.date === t.date &&
      Math.abs(Math.abs(Number(p.amount) || 0) - Math.abs(t.amount)) < 0.005);
  }
  /* 'Mine' on a line that something in Get paid back was made from: that goes to Recently deleted and the
     line goes back to its usual category, in one step with Undo. It isn't suggested as work again. */
  function takeOut(claimId, txId) {
    let was = null;
    let entry = null;
    store.commit((st) => {
      const p = (st.paperwork || []).find((x) => x.id === claimId);
      if (!p) return;
      const t = st.transactions.find((x) => x.id === txId);
      st.meta = st.meta || {};
      was = { p, cat: t ? t.category : null, had: Object.prototype.hasOwnProperty.call(st.meta, 'notWorkTx'), notWork: st.meta.notWorkTx };
      st.paperwork = st.paperwork.filter((x) => x !== p);
      const rec = Object.assign({}, p);
      delete rec.purchaseTx;
      delete rec.purchaseWas;
      entry = GU.trash ? GU.trash.put(st, 'paperwork', rec, rec.title || rec.party) : null;
      if (t && t.category === F.WORK_OUT) t.category = p.purchaseWas || '';
      st.meta.notWorkTx = Array.from(new Set((Array.isArray(st.meta.notWorkTx) ? st.meta.notWorkTx : []).concat(txId)));
    });
    if (!was) return;
    toast('Took ' + (was.p.title || was.p.party || 'it') + ' out of Get paid back', {
      action: 'Undo',
      onAction: () => store.commit((st) => {
        if (!st.paperwork.some((x) => x.id === claimId)) st.paperwork.push(was.p);
        const t = st.transactions.find((x) => x.id === txId);
        if (t && was.cat != null) t.category = was.cat;
        if (entry) st.trash = (st.trash || []).filter((e) => e.id !== entry.id);
        if (was.had) st.meta.notWorkTx = was.notWork;
        else delete st.meta.notWorkTx;
      }),
    });
  }

  /* A payment you made for your employer goes into Get paid back: linked to the one thing already waiting
     for a payment like it, or added as something new. When a few could be it, you pick. was: the line's category
     before you said it was for work, put back if it's ever taken out of Get paid back. */
  function addToClaims(id, was) {
    const w = wm();
    const s = store.state;
    const tx = s.transactions.find((t) => t.id === id);
    if (!w || !tx || !(tx.amount < 0)) return;
    const fits = w.claims(s, 'open').filter((x) => !x.p.purchaseTx && w.purchaseFor(s, x.p).options.some((o) => o.id === id));
    if (fits.length < 2) return w.claimFromTx([id], { was });
    formDialog({
      title: 'Which one was this for?',
      intro: esc(money(Math.abs(tx.amount)) + ' on ' + fmtDate(tx.date, { short: true }) + ' could be any of these in Get paid back.'),
      fields: [{ name: 'claim', label: 'This payment is for', type: 'segmented', default: fits[0].p.id,
        options: fits.map((x) => ({ value: x.p.id, label: (x.p.title || x.p.party || 'Untitled') + (x.p.date ? ' · ' + fmtDate(x.p.date, { short: true }) : '') }))
          .concat([{ value: '__new', label: 'Something new' }]) }],
      submitLabel: 'Add to Get paid back',
      onSubmit: (v) => {
        if (v.claim === '__new') w.claimFromTx([id], { noLink: true, was });
        else w.linkPurchase(v.claim, id, { was });
      },
    });
  }

  /* Saves the form, then does what the work choice means: a payment for your employer goes into Get paid
     back, and a repayment is matched to what it paid back. Taking a line out of Get paid back asks first.
     Returns {id, choice}, or false to keep the form open. */
  async function submit(v, existing, extra) {
    const s = store.state;
    const w = wm();
    const shown = hasEmployer(s);
    const choice = shown ? choiceOf(v) : choiceFromCategory(v);
    const links = existing && w ? linksOf(s, existing.id) : { purchase: null, repaid: [] };
    const dropPurchase = links.purchase && !(choice === 'work' && v.direction !== 'in') ? links.purchase : null;
    const dropRepaid = choice === 'back' && v.direction === 'in' ? [] : links.repaid;
    const c = co(s);
    if (dropPurchase || dropRepaid.length) {
      const name = (p) => '‘' + esc(p.title || p.party || 'Untitled') + '’';
      const fromLine = dropPurchase && madeFromLine(dropPurchase, existing);
      const bits = [];
      if (dropPurchase) {
        bits.push(fromLine ? 'This payment is ' + name(dropPurchase) + ' in Get paid back (' + esc(money(Math.abs(existing.amount))) + '). I’ll take it out, so it’s not counted as owed to you.'
          : 'This payment is linked to ' + name(dropPurchase) + ' in Get paid back. I’ll unlink it, and ' + name(dropPurchase) + ' stays there without a bank payment.');
      }
      if (dropRepaid.length) {
        bits.push('It’s counted as ' + esc(c) + ' paying you back for ' + (dropRepaid.length === 1 ? name(dropRepaid[0]) : esc(plural(dropRepaid.length, 'thing'))) + '. I’ll mark ' +
          (dropRepaid.length === 1 ? 'it' : 'them') + ' as not paid back yet.');
      }
      const ok = await confirmBox({ title: 'Take this out of Get paid back?', message: bits.join(' '), confirmLabel: 'Take it out' });
      if (!ok) return false;
      if (dropRepaid.length && w) w.unrepay(dropRepaid.map((p) => p.id));
      if (dropPurchase && w) {
        if (fromLine) takeOut(dropPurchase.id, existing.id);
        else w.unlinkPurchase(dropPurchase.id);
      }
    }
    let category;
    let wasCat = '';
    if (shown && CATEGORY_FOR[choice]) category = CATEGORY_FOR[choice];
    else if (shown && choice === 'work') {
      // 'Work expenses' straight away, so it's out of your spending even if you close the picker that follows. The
      // category it had is kept on the claim, for Undo and 'Mine'.
      const cur = existing && s.transactions.find((t) => t.id === existing.id);
      wasCat = (cur && cur.category) || '';
      category = F.WORK_OUT;
    }
    const id = save(v, existing, extra, category);
    if (!shown || !w) return { id, choice };
    const now = linksOf(store.state, id);
    if (choice === 'work' && !now.purchase) setTimeout(() => addToClaims(id, wasCat), 0);
    else if (choice === 'back' && !now.repaid.length) {
      setTimeout(() => (GU.payback && GU.payback.repaymentDialog ? GU.payback.repaymentDialog(id) : w.reconcile && w.reconcile()), 0);
    } else if (choice === 'mine' && existing && existing.category === F.WORK_OUT && v.direction !== 'in' && !dropPurchase && w.notWork) w.notWork([id]);
    return { id, choice };
  }

  function create(prefill, opts) {
    prefill = prefill || {};
    opts = opts || {};
    const s = store.state;
    const dir = prefill.direction || (prefill.amount > 0 ? 'in' : 'out');
    const pseudo = { id: '', amount: dir === 'in' ? 1 : -1, category: prefill.category || '', description: prefill.description || '', notes: prefill.notes || '' };
    formDialog({
      title: dir === 'in' ? 'Add money in' : 'Add a transaction',
      fields: fields(true, dir),
      values: formValues(s, pseudo, Object.assign({ date: today(), account: s.accounts[0] && s.accounts[0].id, direction: dir }, prefill, { amount: prefill.amount != null ? Math.abs(prefill.amount) : null })),
      submitLabel: 'Add',
      onSubmit: async (v) => {
        const r = await submit(v, null, opts.extra);
        if (r === false) return false;
        // Get paid back says where a payment for work went; a repayment opens its own question.
        if (!['work', 'back'].includes(r.choice) || !hasEmployer(store.state)) toast('Transaction added');
        if (opts.onSaved) opts.onSaved();
      },
    });
  }

  function edit(id) {
    const t = store.find('transactions', id);
    if (!t) return;
    const s = store.state;
    const linked = linksOf(s, id).purchase;
    formDialog({
      title: 'Edit transaction',
      fields: fields(false, null, t),
      values: formValues(s, t, Object.assign({}, t, { direction: t.amount > 0 ? 'in' : 'out', amount: Math.abs(t.amount), match: suggestMatch(t.description) })),
      onSubmit: async (v) => ((await submit(v, t)) === false ? false : undefined),
      // The thing in Get paid back this paid for stays there, without a bank payment.
      deleteMessage: linked ? 'It’s your payment for ‘' + esc(linked.title || linked.party || 'Untitled') + '’ in Get paid back, which stays there without a bank payment. You can undo it, and it stays in Settings → Recently deleted for 30 days.' : undefined,
      onDelete: () => {
        store.remove('transactions', id);
        if (linked) {
          store.commit((st) => {
            const p = (st.paperwork || []).find((x) => x.id === linked.id);
            if (!p || p.purchaseTx !== id) return;
            delete p.purchaseTx;
            delete p.purchaseWas;
          });
        }
      },
    });
  }

  /* ---------- CSV statement import ---------- */
  function guessColumns(header, rows) {
    const h = header.map((x) => x.toLowerCase());
    const find = (...words) => h.findIndex((c) => words.some((w) => c.includes(w)));
    let date = find('transaction date', 'date', 'completed', 'posted');
    let desc = find('description', 'narrative', 'details', 'counter party', 'merchant', 'name', 'payee', 'memo', 'reference');
    let amount = find('amount', 'value');
    let paidIn = find('paid in', 'credit', 'money in', 'in (');
    let paidOut = find('paid out', 'debit', 'money out', 'out (');
    if (amount >= 0 && (h[amount].includes('balance'))) amount = -1;
    let balance = find('balance');
    const mode = paidIn >= 0 && paidOut >= 0 && (amount < 0 || paidIn !== amount) ? 'split' : 'single';
    if (date < 0 || desc < 0 || (mode === 'single' && amount < 0)) {
      // No useful headers (some banks, e.g. HSBC): look at the data itself.
      const sample = rows.slice(0, 10);
      const cols = header.length;
      const score = (fn) => Array.from({ length: cols }, (_, i) => sample.filter((r) => fn(r[i] || '')).length);
      const dateScore = score((v) => !!parseLooseDate(v, 'dmy'));
      const numScore = score((v) => /\d/.test(v) && !isNaN(parseAmount(v)) && !parseLooseDate(v, 'dmy'));
      const textScore = score((v) => /[a-z]{3}/i.test(v) && !parseLooseDate(v, 'dmy'));
      const best = (arr, skip) => arr.reduce((b, v, i) => (skip.includes(i) || v <= (arr[b] || -1) ? b : i), -1);
      if (date < 0) date = best(dateScore, []);
      if (desc < 0) desc = best(textScore, [date]);
      if (amount < 0 && mode === 'single') amount = best(numScore, [date, desc]);
      // HSBC's current layout has a running balance after the amount.
      if (balance < 0) {
        const b = best(numScore, [date, desc, amount]);
        if (b > amount && numScore[b] >= Math.max(2, sample.length * 0.8)) balance = b;
      }
    }
    return { date, desc, amount, paidIn, paidOut, mode, balance };
  }

  /* ---------- statement import (CSV, Excel, Santander .txt, QIF, OFX, PDF) ---------- */
  const ACCEPT_STATEMENTS = '.csv,.txt,.tsv,.qif,.ofx,.qfx,.xls,.xlsx,.pdf,text/csv,application/pdf';
  function accountFor(bank) {
    const a = bank && store.state.accounts.find((x) => x.name.toLowerCase().includes(bank.toLowerCase()));
    if (a) return a.id;
    if (bank) return '__new';
    return (store.state.accounts[0] || {}).id || '__new';
  }
  const dupKey = (t) => t.date + '|' + Number(t.amount).toFixed(2) + '|' + String(t.description || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 10);
  /* Leaves out lines already in this account. Two identical payments on the same day both stay. */
  function withoutDuplicates(list, accountId) {
    const seen = new Map();
    for (const t of store.state.transactions) {
      if (accountId && accountId !== '__new' && t.account !== accountId) continue;
      const k = dupKey(t);
      seen.set(k, (seen.get(k) || 0) + 1);
    }
    return list.filter((t) => {
      const k = dupKey(t);
      const n = seen.get(k) || 0;
      if (n) {
        seen.set(k, n - 1);
        return false;
      }
      return true;
    });
  }

  /* Works out which spreadsheet column is which. */
  function tableSetup(res) {
    const rows = res.rows || [];
    if (rows.length < 2) return null;
    let headerIdx = rows.findIndex((r) => r.some((c) => /date/i.test(c)) && r.length >= 3);
    if (headerIdx < 0 || headerIdx > 15) headerIdx = -1;
    const header = headerIdx >= 0 ? rows[headerIdx] : rows[0].map((_, i) => 'Column ' + (i + 1));
    const data = rows.slice(headerIdx + 1).filter((r) => r.length >= Math.min(3, header.length));
    const low = header.map((h) => h.toLowerCase());
    const map = guessColumns(header, data);
    map.order = map.date >= 0 ? guessDateOrder(data.map((r) => r[map.date])) : 'dmy';
    map.flip = false;
    map.category = low.findIndex((h) => h === 'category');
    map.type = low.findIndex((h) => h === 'type' || h === 'transaction type');
    return { header, data, map };
  }
  function tableRows(setup) {
    const { data, map } = setup;
    const out = [];
    for (const r of data) {
      const date = parseLooseDate(r[map.date], map.order);
      const raw = (r[map.desc] || '').replace(/\s+/g, ' ').trim();
      let amount;
      if (map.mode === 'split') {
        const pin = parseAmount(r[map.paidIn]);
        const pout = parseAmount(r[map.paidOut]);
        amount = (isNaN(pin) ? 0 : Math.abs(pin)) - (isNaN(pout) ? 0 : Math.abs(pout));
      } else amount = parseAmount(r[map.amount]);
      if (!date || !raw || isNaN(amount) || amount === 0) continue;
      if (map.flip) amount = -amount;
      const type = map.type >= 0 ? r[map.type] || '' : '';
      const bal = map.balance >= 0 ? parseAmount(r[map.balance]) : NaN;
      out.push({ date, raw: raw + (type ? ' ' + type : ''), description: GU.statements.cleanDescription(raw), amount, bankCategory: map.category >= 0 ? GU.statements.bankCategory(r[map.category]) : '', balance: isNaN(bal) ? null : bal });
    }
    // Most bank downloads list newest first: keep them in date order so the last line holds the latest balance.
    if (out.length > 1 && out[0].date > out[out.length - 1].date) out.reverse();
    return out;
  }

  /* Remembers what a statement tells us about the account: its bank and overdraft limit. */
  function noteAccount(st, accountId, res) {
    const a = st.accounts.find((x) => x.id === accountId);
    if (!a || !res) return;
    if (res.bank && !a.bank) a.bank = res.bank;
    if (!a.type) a.type = /credit card/i.test(res.format || '') ? 'credit' : 'current';
    if (res.overdraftLimit && !a.overdraftLimit) a.overdraftLimit = res.overdraftLimit;
  }

  /* After an import: link your payments for work and tick off what your employer paid back (it says what it
     matched, with Undo), then look for new regular bills. Returns what was matched, so undoing the import
     can undo that too. */
  function afterImport() {
    let matched = null;
    try {
      if (GU.workMoney && GU.workMoney.reconcile) matched = GU.workMoney.reconcile();
    } catch (e) {
      console.warn('matching work money failed', e);
    }
    GU.recurring.scan({ quiet: true });
    return matched;
  }

  /* Opens the importer. preset: one File, or several Files (a folder of statements). */
  function importStatement(presetFile) {
    const s = store.state;
    let file = null;
    const d = openDialog({
      title: 'Import a bank statement',
      wide: true,
      body: '<div data-step></div>',
      footer: '<span class="spacer"></span><button type="button" class="btn" data-close>Cancel</button><button type="submit" class="btn btn--primary" data-go disabled>Import</button>',
    });
    const step = d.body.querySelector('[data-step]');
    const go = d.el.querySelector('[data-go]');
    let onImport = null;

    function pickStep() {
      step.innerHTML = '<p class="dlg__intro">Choose a statement downloaded from your online banking or banking app. These all work:</p>' +
        '<ul class="bank-list"><li><b>Monzo</b>: the PDF statement, or the CSV export from the app</li>' +
        '<li><b>Santander</b>: the PDF statement, or the download in .txt, Excel or Quicken format</li>' +
        '<li><b>HSBC</b>: the PDF statement, or the CSV or Excel download</li>' +
        '<li>Most other banks: PDF, CSV, Excel, Quicken (.qif) or Money (.ofx) files</li></ul>' +
        '<label class="drop drop--big" tabindex="0"><input type="file" multiple accept="' + ACCEPT_STATEMENTS + '" hidden>' + icon('upload', 'drop__icon') +
        '<span><b>Choose statements</b><small>or drop them here: one file, several, or a whole folder</small></span></label>' +
        '<div class="thrower__pick"><button type="button" class="btn btn--sm" data-st-folder>' + icon('folder') + 'Choose a folder of statements</button></div>' +
        '<p class="field__help">' + icon('lock') + ' Files are read on this device. They aren’t uploaded anywhere.</p>';
      const drop = step.querySelector('.drop');
      const input = step.querySelector('input');
      const start = (files) => {
        files = files.filter((f) => /\.(csv|txt|tsv|qif|ofx|qfx|xls|xlsx|pdf)$/i.test(f.name));
        if (!files.length) return toast('None of those look like statements (PDF, CSV, Excel, .txt, .qif or .ofx).');
        if (files.length === 1) load(files[0]);
        else multiStep(files);
      };
      input.addEventListener('change', () => start(Array.from(input.files)));
      step.querySelector('[data-st-folder]').addEventListener('click', async () => start(await GU.ui.pickFolder()));
      drop.addEventListener('keydown', (e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), input.click()));
      drop.addEventListener('dragover', (e) => (e.preventDefault(), drop.classList.add('is-over')));
      drop.addEventListener('dragleave', () => drop.classList.remove('is-over'));
      drop.addEventListener('drop', (e) => {
        e.preventDefault();
        drop.classList.remove('is-over');
        GU.ui.filesFromDrop(e.dataTransfer).then(start);
      });
    }

    /* Several statements at once: read them all, show one summary, import together. */
    async function multiStep(files) {
      d.el.querySelector('.dlg__head h2').textContent = 'Import ' + files.length + ' statements';
      const entries = files.map((f) => ({ file: f, status: 'reading', list: [], res: null }));
      const opts = { pots: false, keepPdf: true };
      const draw = () => {
        // Skip lines already imported, including ones in earlier files of this batch.
        const seen = new Map();
        const keyOf = (acct, t) => acct + '#' + dupKey(t);
        for (const t of store.state.transactions) seen.set(keyOf(t.account, t), (seen.get(keyOf(t.account, t)) || 0) + 1);
        let total = 0;
        for (const e of entries) {
          e.fresh = [];
          if (e.status !== 'ok') continue;
          let list = e.list.slice();
          if (opts.pots && e.res && e.res.pots) for (const p of e.res.pots) list = list.concat(p.transactions.map((t) => Object.assign({}, t, { pot: p.name })));
          const accepted = [];
          for (const t of list) {
            const k = keyOf(e.account, t);
            const n = seen.get(k) || 0;
            if (n) seen.set(k, n - 1);
            else accepted.push(t);
          }
          for (const t of accepted) seen.set(keyOf(e.account, t), (seen.get(keyOf(e.account, t)) || 0) + 1);
          e.fresh = accepted;
          total += accepted.length;
        }
        const reading = entries.filter((e) => e.status === 'reading').length;
        const banks = Array.from(new Set(entries.map((e) => e.res && e.res.bank).filter(Boolean)));
        const acctOpts = store.state.accounts.map((a) => ({ value: a.id, label: a.name })).concat(banks.concat(['Other account']).map((b) => ({ value: '__new:' + b, label: '+ New: ' + b })));
        const anyPdf = entries.some((e) => e.res && e.res.isPdf);
        const potLines = entries.reduce((a, e) => a + ((e.res && e.res.pots) || []).reduce((b, p) => b + p.transactions.length, 0), 0);
        step.innerHTML = (reading ? '<p class="reading"><span class="spinner" aria-hidden="true"></span>Reading ' + (entries.length - reading + 1) + ' of ' + entries.length + '…</p>' : '<p class="dlg__intro">Here’s what I found. Check each statement goes into the right account, then import them all.</p>') +
          '<div class="table-wrap"><table class="tbl tbl--compact"><thead><tr><th>Statement</th><th>Dates</th><th class="num">Lines</th><th class="num">New</th><th>Account</th></tr></thead><tbody>' +
          entries.map((e, i) => {
            const dates = e.list.map((t) => t.date).sort();
            const warn = e.status === 'ok' && !String(e.account).startsWith('__new') ? GU.money.importWarning(store.state, e.list, e.account, e.res.bank) : '';
            const what = e.status === 'reading' ? '<span class="muted">Reading…</span>' : e.status === 'ok' ? (warn ? pill(warn, 'crit', 'alert') + ' ' : '') + esc([e.res.bank, e.res.format].filter(Boolean).join(' ')) +
              (e.res.check && e.res.check.ok && !e.res.check.bad ? ' ' + pill('Balances add up', 'good', 'check') : e.res.check && e.res.check.bad ? ' ' + pill(e.res.check.bad + ' to check', 'warn') : '') : pill('Couldn’t read', 'crit', 'alert');
            return '<tr><td class="wrap"><b class="cell-title">' + esc(GU.ui.pathOf(e.file)) + '</b><small class="cell-sub">' + what + '</small></td>' +
              '<td class="nowrap">' + (dates.length ? esc(fmtDate(dates[0], { short: true }) + ' to ' + fmtDate(dates[dates.length - 1], { short: true })) : '—') + '</td>' +
              '<td class="num">' + (e.status === 'ok' ? e.list.length : '—') + '</td><td class="num">' + (e.status === 'ok' ? e.fresh.length : '—') + '</td>' +
              '<td>' + (e.status === 'ok' ? '<select class="select-sm" data-acct="' + i + '" aria-label="Account for ' + esc(e.file.name) + '">' + selectOptions(acctOpts, e.account) + '</select>' : '') + '</td></tr>';
          }).join('') + '</tbody></table></div>' +
          (potLines ? '<label class="check"><input type="checkbox" id="ms-pots"' + (opts.pots ? ' checked' : '') + '><span>Also import Monzo Pots (' + esc(plural(potLines, 'line')) + '). Usually best left off.</span></label>' : '') +
          (anyPdf ? '<label class="check"><input type="checkbox" id="ms-keep"' + (opts.keepPdf ? ' checked' : '') + '><span>Keep a copy of each PDF statement in Important documents</span></label>' : '');
        go.disabled = !!reading || !total;
        go.textContent = reading ? 'Reading…' : total ? 'Import ' + plural(total, 'transaction') : 'Nothing new to import';
        step.querySelectorAll('[data-acct]').forEach((sel) => sel.addEventListener('change', () => ((entries[+sel.dataset.acct].account = sel.value), draw())));
        const pp = step.querySelector('#ms-pots');
        if (pp) pp.addEventListener('change', () => ((opts.pots = pp.checked), draw()));
        const kp = step.querySelector('#ms-keep');
        if (kp) kp.addEventListener('change', () => (opts.keepPdf = kp.checked));
        onImport = () => commitMany(entries.filter((e) => e.status === 'ok' && e.fresh.length), opts.keepPdf);
      };
      draw();
      for (const e of entries) {
        try {
          const res = await GU.statements.read(e.file);
          e.res = res;
          if (res.kind === 'table') {
            const setup = tableSetup(res);
            e.list = setup ? tableRows(setup) : [];
          } else e.list = res.transactions || [];
          const acct = accountFor(res.bank);
          e.account = acct === '__new' ? '__new:' + (res.bank || 'Other account') : acct;
          e.status = e.list.length ? 'ok' : 'empty';
        } catch (err) {
          console.warn('could not read', e.file.name, err);
          e.status = 'error';
        }
        draw();
      }
    }

    async function commitMany(entries, keepPdf) {
      if (!entries.length) return;
      const batch = 'imp-' + uid();
      let transfers = [];
      let count = 0;
      store.commit((st) => {
        const made = {};
        const ids = new Set();
        for (const e of entries) {
          let acct = e.account;
          if (acct.startsWith('__new:')) {
            const name = acct.slice(6);
            if (!made[name]) {
              made[name] = 'acc-' + uid();
              st.accounts.push({ id: made[name], name });
            }
            acct = made[name];
          }
          e.accountId = acct;
          for (const t of e.fresh) {
            const id = 't-' + uid();
            ids.add(id);
            count++;
            st.transactions.push({ id, date: t.date, description: t.description, amount: t.amount,
              category: t.pot ? F.TRANSFER : F.categorise(t.description + ' ' + (t.raw || ''), t.amount, st.rules) || t.bankCategory || '',
              account: acct, notes: t.pot ? t.pot + ' Pot' : '', source: 'import', importBatch: batch, created: today(),
              balance: !t.pot && typeof t.balance === 'number' && !isNaN(t.balance) ? t.balance : null });
          }
          noteAccount(st, acct, e.res);
        }
        transfers = GU.statements.matchTransfers(st, ids);
      });
      if (keepPdf) {
        for (const e of entries) {
          if (!e.res.isPdf) continue;
          const meta = await GU.files.add(e.file);
          const dates = e.list.map((t) => t.date).sort();
          store.upsert('documents', { id: 'd-' + uid(), created: today(), title: (e.res.bank || 'Bank') + ' statement ' + fmtDate(dates[0], { short: true }) + ' to ' + fmtDate(dates[dates.length - 1], { short: true }),
            type: 'Bank, savings and pension', holder: 'Me', reference: '', location: 'Uploaded', issueDate: dates[dates.length - 1], expiryDate: '', notes: '', files: [meta], statementBatch: batch });
        }
      }
      d.close();
      let matched = null;
      toast('Imported ' + plural(count, 'transaction') + ' from ' + plural(entries.length, 'statement') + (transfers.length ? '. ' + plural(transfers.length / 2, 'move') + ' between your own accounts marked as transfers' : ''), {
        action: 'Undo',
        onAction: () => {
          // What was matched to the new lines goes back first.
          if (matched && matched.undo) matched.undo();
          store.commit((st) => {
            st.transactions = st.transactions.filter((t) => t.importBatch !== batch);
            for (const c of transfers) {
              const t = st.transactions.find((x) => x.id === c.id);
              if (t) t.category = c.before;
            }
            st.documents.filter((x) => x.statementBatch === batch).forEach((doc) => (doc.files || []).forEach((f) => GU.files.remove(f.id)));
            st.documents = st.documents.filter((x) => x.statementBatch !== batch);
          });
        },
      });
      if (location.hash !== '#transactions') GU.view.go('transactions');
      setTimeout(() => {
        matched = afterImport();
      }, 1500);
    }

    async function load(f) {
      file = f;
      step.innerHTML = '<p class="reading" role="status"><span class="spinner" aria-hidden="true"></span>Reading ' + esc(f.name) + '…</p>' + (GU.art ? GU.art.skeleton(3) : '');
      let res;
      try {
        res = await GU.statements.read(f);
      } catch (e) {
        console.warn('statement read failed', e);
        res = { kind: 'error' };
      }
      if (res.kind === 'table') return tableStep(res);
      if (res.kind === 'transactions' && res.transactions.length) return reviewStep(res);
      failStep(res);
    }

    async function failStep(res) {
      const claude = res.isPdf && (await GU.brain.mode()) !== 'offline';
      step.innerHTML = '<p class="banner banner--crit">' + icon('alert') + '<span>' + esc(res.warning || 'I couldn’t find any transactions in ' + file.name + '.') +
        (claude ? ' I can ask Claude to read it instead.' : ' Try the CSV or Excel download from your online banking instead.') + '</span></p>' +
        (claude ? '<button type="button" class="btn btn--primary" data-claude>' + icon('check') + 'Read it with Claude</button>' : '') +
        '<button type="button" class="btn" data-again>Choose another file</button>';
      go.disabled = true;
      step.querySelector('[data-again]').addEventListener('click', pickStep);
      const b = step.querySelector('[data-claude]');
      if (b) b.addEventListener('click', async () => {
        step.innerHTML = '<p class="reading" role="status"><span class="spinner" aria-hidden="true"></span>Claude is reading your statement. Long statements take a minute or two…</p>' + (GU.art ? GU.art.skeleton(3) : '');
        try {
          const r = await GU.brain.readStatement(file);
          if (r && r.transactions.length) return reviewStep(r);
        } catch (e) {
          console.warn(e);
        }
        failStep({ isPdf: false, warning: 'Claude couldn’t read the transactions either.' });
      });
    }

    /* Statements that come as a list of transactions (PDF, Santander .txt, QIF, OFX). */
    function reviewStep(res) {
      const ui2 = { account: accountFor(res.bank), newAccount: res.bank || '', pots: false, keepPdf: !!res.isPdf };
      const draw = () => {
        let list = res.transactions.slice();
        if (ui2.pots) for (const p of res.pots || []) list = list.concat(p.transactions.map((t) => Object.assign({}, t, { pot: p.name })));
        const fresh = withoutDuplicates(list, ui2.account);
        const dupes = list.length - fresh.length;
        const inn = sum(res.transactions.filter((t) => t.amount > 0), (t) => t.amount);
        const out = sum(res.transactions.filter((t) => t.amount < 0), (t) => -t.amount);
        const dates = res.transactions.map((t) => t.date).sort();
        const potLines = (res.pots || []).reduce((a, p) => a + p.transactions.length, 0);
        step.innerHTML =
          '<p class="dlg__intro"><b>' + esc([res.bank, res.format].filter(Boolean).join(' ') || file.name) + '</b>, ' + esc(fmtDate(dates[0])) + ' to ' + esc(fmtDate(dates[dates.length - 1])) + ': ' +
          esc(plural(res.transactions.length, 'transaction')) + '. Money in <b>' + esc(money(inn)) + '</b>, money out <b>' + esc(money(out)) + '</b>.</p>' +
          (res.check && res.check.ok && !res.check.bad ? '<p class="check-ok">' + icon('check') + 'Every line adds up against the statement’s running balance.</p>' : '') +
          (res.check && res.check.bad ? '<p class="banner banner--warn">' + icon('alert') + '<span>' + esc(plural(res.check.bad, 'line')) + ' didn’t add up against the running balance. They’ll still be imported; check any that look wrong.</span></p>' : '') +
          '<div class="form-grid">' +
          '<div class="field field--half"><label class="field__label" for="st-account">Which account is this?</label><select id="st-account">' + selectOptions(accountOptions(), ui2.account) + '</select>' +
          (ui2.account !== '__new' && GU.money.importWarning(store.state, list, ui2.account, res.bank) ? '<p class="field__help is-crit">' + esc(GU.money.importWarning(store.state, list, ui2.account, res.bank)) + '</p>' : '') + '</div>' +
          (ui2.account === '__new' ? '<div class="field field--half"><label class="field__label" for="st-new">New account name</label><input id="st-new" type="text" value="' + esc(ui2.newAccount) + '" placeholder="e.g. Monzo"></div>' : '<div class="field field--half"></div>') +
          (potLines ? '<div class="field"><label class="check"><input type="checkbox" id="st-pots"' + (ui2.pots ? ' checked' : '') + '><span>Also import my Pots (' + esc(plural(potLines, 'line')) + ' across ' + esc(plural(res.pots.length, 'Pot')) + ')</span></label><p class="field__help">Usually best left off: money moving into and out of Pots already shows in your main account as “Transfer to Pot”.</p></div>' : '') +
          (res.isPdf ? '<div class="field"><label class="check"><input type="checkbox" id="st-keep"' + (ui2.keepPdf ? ' checked' : '') + '><span>Keep a copy of this statement in Important documents</span></label></div>' : '') +
          '</div>' +
          '<h3 class="subhead">Preview</h3>' +
          (fresh.length ? '<div class="table-wrap"><table class="tbl tbl--compact"><thead><tr><th>Date</th><th>Description</th><th>Category</th><th class="num">Amount</th></tr></thead><tbody>' +
            fresh.slice(-8).reverse().map((t) => {
              const c = F.categorise(t.description + ' ' + (t.raw || ''), t.amount, s.rules);
              return '<tr><td class="nowrap">' + esc(fmtDate(t.date, { short: true })) + '</td><td class="wrap">' + esc(t.description) + (t.pot ? ' <span class="muted">(' + esc(t.pot) + ' Pot)</span>' : '') + '</td><td>' + (c ? pill(c, c === F.TRANSFER ? 'muted' : '') : pill('Needs a category', 'warn')) + '</td><td class="num ' + (t.amount > 0 ? 'is-in' : '') + '">' + esc(money(t.amount, { sign: true })) + '</td></tr>';
            }).join('') + '</tbody></table></div>' : '<p class="muted">Everything in this statement is already imported.</p>') +
          '<p class="field__help">' + esc(plural(fresh.length, 'new transaction')) + ' ready (showing the latest 8)' + (dupes ? '. ' + plural(dupes, 'line') + ' already imported will be skipped' : '') + '.</p>';
        go.disabled = !fresh.length;
        go.textContent = fresh.length ? 'Import ' + plural(fresh.length, 'transaction') : 'Import';
        step.querySelector('#st-account').addEventListener('change', (e) => ((ui2.account = e.target.value), draw()));
        const nn = step.querySelector('#st-new');
        if (nn) nn.addEventListener('input', () => (ui2.newAccount = nn.value));
        const pp = step.querySelector('#st-pots');
        if (pp) pp.addEventListener('change', () => ((ui2.pots = pp.checked), draw()));
        const kp = step.querySelector('#st-keep');
        if (kp) kp.addEventListener('change', () => (ui2.keepPdf = kp.checked));
        onImport = () => commitImport(fresh, ui2.account, ui2.newAccount || res.bank || file.name.replace(/\.\w+$/, ''), res, ui2.keepPdf);
      };
      draw();
    }

    /* Spreadsheets: check which column is which, then import. */
    function tableStep(res) {
      const setup = tableSetup(res);
      if (!setup) return failStep({ warning: 'That file doesn’t have enough rows to be a statement.' });
      const { header, map } = setup;
      map.account = accountFor(res.bank);
      map.newAccount = res.bank || '';
      const build = () => tableRows(setup);

      function draw() {
        const colOpts = header.map((h, i) => ({ value: String(i), label: h || 'Column ' + (i + 1) }));
        const all = build();
        const fresh = withoutDuplicates(all, map.account);
        const dupes = all.length - fresh.length;
        step.innerHTML =
          '<p class="dlg__intro"><b>' + esc(file.name) + '</b>' + (res.bank ? ' (' + esc(res.bank) + ')' : '') + ': check the columns below look right. I guessed them from the file.</p>' +
          '<div class="form-grid">' +
          '<div class="field field--half"><label class="field__label" for="m-date">Date column</label><select id="m-date" data-m="date">' + selectOptions(colOpts, String(map.date)) + '</select></div>' +
          '<div class="field field--half"><label class="field__label" for="m-desc">Description column</label><select id="m-desc" data-m="desc">' + selectOptions(colOpts, String(map.desc)) + '</select></div>' +
          '<div class="field"><span class="field__label">Amounts</span><div class="seg"><label><input type="radio" name="m-mode" value="single"' + (map.mode === 'single' ? ' checked' : '') + '><span>One amount column</span></label>' +
          '<label><input type="radio" name="m-mode" value="split"' + (map.mode === 'split' ? ' checked' : '') + '><span>Separate “paid in” and “paid out” columns</span></label></div></div>' +
          (map.mode === 'single'
            ? '<div class="field field--half"><label class="field__label" for="m-amount">Amount column</label><select id="m-amount" data-m="amount">' + selectOptions(colOpts, String(map.amount)) + '</select></div>' +
              '<div class="field field--half"><span class="field__label">Signs</span><label class="check"><input type="checkbox" id="m-flip"' + (map.flip ? ' checked' : '') + '><span>Spending shows as positive (common on credit cards)</span></label></div>'
            : '<div class="field field--half"><label class="field__label" for="m-in">Paid in column</label><select id="m-in" data-m="paidIn">' + selectOptions(colOpts, String(map.paidIn)) + '</select></div>' +
              '<div class="field field--half"><label class="field__label" for="m-out">Paid out column</label><select id="m-out" data-m="paidOut">' + selectOptions(colOpts, String(map.paidOut)) + '</select></div>') +
          '<div class="field field--half"><label class="field__label" for="m-order">Date format</label><select id="m-order">' + selectOptions([{ value: 'dmy', label: 'Day first (31/12/2026)' }, { value: 'mdy', label: 'Month first (12/31/2026)' }], map.order) + '</select></div>' +
          '<div class="field field--half"><label class="field__label" for="m-account">Which account is this?</label><select id="m-account">' + selectOptions(accountOptions(), map.account) + '</select></div>' +
          (map.account === '__new' ? '<div class="field"><label class="field__label" for="m-newacc">New account name</label><input id="m-newacc" type="text" placeholder="e.g. Monzo current account" value="' + esc(map.newAccount || '') + '"></div>' : '') +
          '</div>' +
          '<h3 class="subhead">Preview</h3>' +
          (all.length
            ? '<div class="table-wrap"><table class="tbl tbl--compact"><thead><tr><th>Date</th><th>Description</th><th>Category</th><th class="num">Amount</th></tr></thead><tbody>' +
              fresh.slice(0, 8).map((r) => {
                const c = F.categorise(r.description + ' ' + r.raw, r.amount, s.rules) || r.bankCategory;
                return '<tr><td class="nowrap">' + esc(fmtDate(r.date, { short: true })) + '</td><td class="wrap">' + esc(r.description) + '</td><td>' + (c ? pill(c) : pill('Needs a category', 'warn')) + '</td><td class="num ' + (r.amount > 0 ? 'is-in' : '') + '">' + esc(money(r.amount, { sign: true })) + '</td></tr>';
              }).join('') + '</tbody></table></div>' +
              '<p class="field__help">' + esc(plural(fresh.length, 'new transaction')) + ' ready' + (dupes ? ', ' + plural(dupes, 'line') + ' already imported will be skipped' : '') + '.</p>'
            : '<p class="banner banner--crit">' + icon('alert') + 'I couldn’t read any transactions with these columns. Try different columns or date format.</p>');
        go.disabled = !fresh.length;
        go.textContent = fresh.length ? 'Import ' + plural(fresh.length, 'transaction') : 'Import';
        step.querySelectorAll('[data-m]').forEach((el) => el.addEventListener('change', () => ((map[el.dataset.m] = +el.value), draw())));
        step.querySelectorAll('input[name="m-mode"]').forEach((el) => el.addEventListener('change', () => {
          map.mode = el.value;
          if (map.mode === 'split' && (map.paidIn < 0 || map.paidOut < 0)) {
            map.paidIn = map.paidIn >= 0 ? map.paidIn : 0;
            map.paidOut = map.paidOut >= 0 ? map.paidOut : 0;
          }
          draw();
        }));
        const flip = step.querySelector('#m-flip');
        if (flip) flip.addEventListener('change', () => ((map.flip = flip.checked), draw()));
        step.querySelector('#m-order').addEventListener('change', (e) => ((map.order = e.target.value), draw()));
        step.querySelector('#m-account').addEventListener('change', (e) => ((map.account = e.target.value), draw()));
        const na = step.querySelector('#m-newacc');
        if (na) na.addEventListener('input', () => (map.newAccount = na.value));
        onImport = () => commitImport(fresh, map.account, map.newAccount || res.bank || file.name.replace(/\.\w+$/, ''), res, false);
      }
      draw();
    }

    async function commitImport(list, account, newName, res, keepPdf) {
      if (!list.length) return;
      const batch = 'imp-' + uid();
      let accountId = account;
      let transfers = [];
      store.commit((st) => {
        if (accountId === '__new') {
          accountId = 'acc-' + uid();
          st.accounts.push({ id: accountId, name: (newName || '').trim() || 'Bank account' });
        }
        const ids = new Set();
        for (const t of list) {
          const id = 't-' + uid();
          ids.add(id);
          const text = t.description + ' ' + (t.raw || '');
          st.transactions.push({ id, date: t.date, description: t.description, amount: t.amount,
            category: t.pot ? F.TRANSFER : F.categorise(text, t.amount, st.rules) || t.bankCategory || '',
            account: accountId, notes: t.pot ? t.pot + ' Pot' : '', source: 'import', importBatch: batch, created: today(),
            balance: !t.pot && typeof t.balance === 'number' && !isNaN(t.balance) ? t.balance : null });
        }
        noteAccount(st, accountId, res);
        transfers = GU.statements.matchTransfers(st, ids);
      });
      if (keepPdf && file) {
        const meta = await GU.files.add(file);
        const dates = list.map((t) => t.date).sort();
        store.upsert('documents', { id: 'd-' + uid(), created: today(), title: (res.bank || 'Bank') + ' statement ' + fmtDate(dates[0], { short: true }) + ' to ' + fmtDate(dates[dates.length - 1], { short: true }),
          type: 'Bank, savings and pension', holder: 'Me', reference: '', location: 'Uploaded', issueDate: dates[dates.length - 1], expiryDate: '', notes: plural(list.length, 'transaction') + ' imported into Bank transactions.', files: [meta], statementBatch: batch });
      }
      const n = list.length;
      d.close();
      let matched = null;
      toast('Imported ' + plural(n, 'transaction') + (res.bank ? ' from ' + res.bank : '') + (transfers.length ? '. ' + plural(transfers.length / 2, 'move') + ' between your own accounts marked as transfers' : ''), {
        action: 'Undo',
        onAction: () => {
          // What was matched to the new lines goes back first.
          if (matched && matched.undo) matched.undo();
          store.commit((st) => {
            st.transactions = st.transactions.filter((t) => t.importBatch !== batch);
            for (const c of transfers) {
              const t = st.transactions.find((x) => x.id === c.id);
              if (t) t.category = c.before;
            }
            const doc = st.documents.find((x) => x.statementBatch === batch);
            if (doc) {
              (doc.files || []).forEach((f) => GU.files.remove(f.id));
              st.documents = st.documents.filter((x) => x !== doc);
            }
          });
        },
      });
      if (location.hash !== '#transactions') GU.view.go('transactions');
      setTimeout(() => {
        matched = afterImport();
      }, 1500);
    }

    d.form.addEventListener('submit', (e) => {
      e.preventDefault();
      if (onImport) onImport();
    });

    if (Array.isArray(presetFile)) {
      if (presetFile.length === 1) load(presetFile[0]);
      else multiStep(presetFile);
    } else if (presetFile) load(presetFile);
    else pickStep();
  }
  const importCSV = importStatement;

  /* The ⋯ menu's own actions on a bank line. */
  GU.organise.extras.transactions = (t) => {
    const items = [];
    if (t.amount < 0 && t.category !== F.WORK_OUT && hasEmployer(store.state) && wm() && wm().claimFromTx) {
      items.push({ icon: 'briefcase', label: 'Paid for ' + co(store.state) + ', get it back', hint: 'Adds it to Get paid back', onClick: () => wm().claimFromTx([t.id]) });
    }
    return items;
  };
  /* The transactions the Bank page is showing now (its search and filters), for 'Download list'. */
  GU.organise.lists.bank = () => ({
    name: 'Bank transactions',
    head: ['Date', 'Description', 'Amount', 'Category', 'Account', 'Notes'],
    rows: filtered().map((t) => [t.date, t.description || '', Number(t.amount), t.category || '', accountName(t.account), t.notes || '']),
  });

  GU.tabs.transactions = { label: 'Bank transactions', short: 'Bank', icon: 'bank', part: 'home', render, create, edit, importCSV, importStatement, editAccount, showAccount, updateBalances, autoTidy, isWages, workPill };
})();
