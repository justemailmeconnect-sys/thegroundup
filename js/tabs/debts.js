/* The Ground Up: Debts. Cards, loans, buy now pay later, car finance and overdrafts in one place.
   You add what you owe; your imported bank statements show what you've been paying, so the balance,
   monthly cost and debt-free date keep themselves up to date. */
(function () {
  'use strict';
  const GU = window.GU;
  const { esc, uid, today, money, fmtDate, relDays, daysUntil, plural, sum, monthLabel } = GU.util;
  const { icon, pill, emptyState, formDialog, toast, confirmBox, thumbHTML, viewFiles } = GU.ui;
  const D = GU.debts;
  const store = GU.store;

  const TYPE_ICON = { 'Credit card': 'card', 'Store or catalogue card': 'card', 'Car finance': 'car', Mortgage: 'home', 'Student loan': 'book', 'Owed to a person': 'heart', Overdraft: 'bank' };
  const open = {}; // 'payments found in your statements' lists left open, by debt
  const folds = {}; // a debt's card, open or shut, once you've chosen (otherwise it opens when a payment is due within a week, or the balance is missing)
  const notesOpen = {}; // 'Notes from the import', by debt
  let howOpen = false;

  const clearLabel = (s) => (s.months === Infinity ? 'Never at this rate' : s.clearBy ? monthLabel(s.clearBy.slice(0, 7), true) : '');
  const pct = (x) => Math.round(x * 100) + '%';

  /* ---------- balances, shared with the Bank and Today tabs ---------- */
  function balanceLine(info) {
    if (!info) return '<em>No balance yet. Import a statement or set it by hand.</em>';
    const od = info.balance < 0 && info.overdraftLimit ? money(-info.balance, { whole: true }) + ' of ' + money(info.overdraftLimit, { whole: true }) + ' overdraft used'
      : info.balance < 0 ? 'Overdrawn' : info.overdraftLimit ? money(info.available, { whole: true }) + ' available with overdraft' : '';
    return '<em>' + esc([od, info.staleDays ? 'as of ' + fmtDate(info.asOf, { short: true }) : 'up to today'].filter(Boolean).join(' · ')) + '</em>';
  }
  function staleNote(info) {
    if (!info || info.staleDays < 14) return '';
    return pill(info.staleDays >= 60 ? Math.round(info.staleDays / 30) + ' months old' : info.staleDays + ' days old', info.staleDays >= 45 ? 'warn' : 'muted', 'clock');
  }
  function accountsCard(s) {
    const list = GU.money.accounts(s).filter((x) => x.info || x.count);
    if (!list.length) return '';
    const known = list.filter((x) => x.info);
    const total = sum(known, (x) => x.info.balance);
    const old = known.some((x) => x.info.staleDays >= 3) || known.length < list.length;
    return '<section class="side-card"><div class="side-card__head"><h2>Your accounts</h2><button type="button" class="btn btn--sm' + (old ? ' btn--soft' : ' btn--ghost') + '" data-balances>' + icon('edit') + 'Update balances</button></div>' +
      (old ? '<p class="side-card__note">Some of these are from older statements. Tap Update balances and put in what your banking apps show now.</p>' : '') +
      '<ul class="acct-mini">' + list.map((x) =>
      '<li><a href="#transactions" data-account="' + esc(x.account.id) + '"><span><b>' + esc(x.account.name) + '</b>' + balanceLine(x.info) + '</span>' +
      '<strong class="' + (x.info && x.info.balance < 0 ? 'is-neg' : '') + '">' + (x.info ? esc(money(x.info.balance)) : '–') + '</strong></a></li>').join('') + '</ul>' +
      (known.length > 1 ? '<p class="side-card__foot">Together <b class="' + (total < 0 ? 'is-neg' : '') + '">' + esc(money(total)) + '</b></p>' : '') +
      '</section>';
  }
  /* Overdrafts and your accounts in one panel: every account with its balance, and for the ones that are overdrawn how much of the
     overdraft is used, the limit and the fees. One Update balances button. */
  function overdraftsPanel(s, ods) {
    const list = GU.money.accounts(s).filter((x) => x.info || x.count);
    if (!list.length && !ods.length) return '';
    const known = list.filter((x) => x.info);
    const total = sum(known, (x) => x.info.balance);
    const old = known.some((x) => x.info.staleDays >= 3) || known.length < list.length;
    const odOf = (id) => ods.find((o) => o.account.id === id);
    const row = (x) => {
      const o = odOf(x.account.id);
      const neg = x.info && x.info.balance < 0;
      const text = o
        ? (o.limit ? money(o.used) + ' of your ' + money(o.limit, { whole: true }) + ' overdraft used' : money(o.used) + ' overdrawn') + (o.fees90 ? ' · ' + money(o.fees90) + ' in overdraft fees over 3 months' : '') + ' · ' + fmtDate(o.asOf, { short: true })
        : x.info ? (x.info.overdraftLimit ? money(x.info.available, { whole: true }) + ' available with overdraft' : 'in credit') + ' · ' + (x.info.staleDays ? 'as of ' + fmtDate(x.info.asOf, { short: true }) : 'up to today') : 'No balance yet. Import a statement or set it by hand.';
      return '<li class="spot od-row"><span class="spot__text"><b>' + esc(x.account.name) + '</b><em>' + esc(text) + '</em></span>' +
        (o && o.limit ? '<span class="od-meter" role="img" aria-label="' + esc(pct(Math.min(1, o.used / o.limit)) + ' of the overdraft used') + '"><i style="width:' + Math.min(100, (o.used / o.limit) * 100) + '%"></i></span>' : '') +
        '<a class="od-row__bal ' + (neg ? 'is-neg' : '') + '" href="#transactions" data-account="' + esc(x.account.id) + '">' + (x.info ? esc(money(x.info.balance)) : '–') + '</a></li>';
    };
    return '<section class="panel od-panel"><header class="panel__head"><h2>' + icon('bank') + (ods.length ? 'Overdrafts' : 'Your accounts') + '</h2>' +
      '<button type="button" class="btn btn--sm' + (old ? ' btn--soft' : ' btn--ghost') + '" data-balances>' + icon('edit') + 'Update balances</button></header>' +
      (old ? '<p class="panel__intro">Some of these are from older statements. Tap Update balances and put in what your banking apps show now.</p>' : '') +
      '<ul class="rows">' + list.map(row).join('') + '</ul>' +
      (known.length > 1 ? '<footer class="panel__foot od-total">Together <b class="' + (total < 0 ? 'is-neg' : '') + '">' + esc(money(total)) + '</b></footer>' : '') + '</section>';
  }

  /* ---------- page ---------- */
  /* A debt opens by itself when a payment is due within a week or the balance is missing; once you open or shut it, that stays. */
  function startsOpen(s) {
    if (!s.balanceKnown && !s.finished) return true;
    return !!(s.nextPayment && !s.finished && daysUntil(s.nextPayment) <= 7);
  }
  const isOpen = (d, s) => (d.id in folds ? folds[d.id] : startsOpen(s));

  /* Each debt is one row: the name, what's left, what you pay, when it's clear, the next payment and Update balance.
     It opens for the rest: the payments still to make, the payments found in your statements and the notes. */
  function debtCard(d) {
    const s = D.summary(store.state, d);
    const pills = [];
    if (s.finished && !s.balanceKnown) pills.push(pill('No payments since ' + fmtDate(s.lastPayment.date, { short: true }) + '. Paid off?', 'info'));
    else if (!s.balanceKnown) pills.push(pill('Add the balance', 'warn', 'alert'));
    else if (s.estBalance === 0) pills.push(pill('Paid off', 'good', 'check'));
    if (s.nextPayment && !s.finished) {
      const n = daysUntil(s.nextPayment);
      pills.push(pill('Next payment ' + relDays(s.nextPayment) + (d.paymentDay || s.scheduled ? '' : ' (estimate)'), n <= 3 ? 'warn' : 'muted', 'clock'));
    }
    if (s.months === Infinity) pills.push(pill('Payments don’t cover the interest', 'crit', 'alert'));
    const lender = D.lenderFor(d.lender) || D.lenderFor(d.name);
    const files = d.files || [];
    const rows = s.payments.map((p) => ({ t: p, kind: 'pay' })).concat(s.borrowed.map((p) => ({ t: p, kind: 'borrow' }))).sort((a, b) => b.t.date.localeCompare(a.t.date));
    const acct = (id) => (store.state.accounts.find((a) => a.id === id) || {}).name || '';
    const isOpenNow = isOpen(d, s);
    const sub = [d.lender && d.lender !== d.name ? d.lender : '', d.type, d.apr ? d.apr + '% APR' : ''].filter(Boolean).join(' · ');
    const importNote = /^Copied from /i.test(d.notes || '');
    const longNote = importNote || String(d.notes || '').length > 160;
    const extra = [];
    if (s.progress != null && (s.progress >= 0.005 || s.byTerm)) {
      extra.push('<div class="debt__bar" role="img" aria-label="' + esc(pct(s.progress) + ' paid off') + '"><i style="width:' + s.progress * 100 + '%"></i></div><p class="debt__barlabel"><span>' + esc(pct(s.progress)) + ' paid off</span><span>' +
        esc(s.byTerm ? money(s.start, { whole: true }) + ' to pay in all' : 'of ' + money(s.start, { whole: true })) + '</span></p>');
    }
    if (s.scheduled) {
      extra.push('<div class="debt__plan"><h3>Still to pay <span class="muted">' + esc(plural(s.plan.length, 'payment') + (s.scheduleFrom ? ', from your ' + s.scheduleFrom + ' section' : ', updated ' + fmtDate(d.scheduleUpdated || today(), { short: true }))) + '</span></h3><ul>' +
        s.plan.slice(0, 8).map((i) => '<li><span>' + esc(fmtDate(i.date, { weekday: true })) + '</span><span class="muted">' + esc([i.merchant, i.of ? i.n + ' of ' + i.of : ''].filter(Boolean).join(' · ')) + '</span><b>' + esc(money(i.amount)) + '</b></li>').join('') +
        (s.plan.length > 8 ? '<li class="muted">and ' + (s.plan.length - 8) + ' more</li>' : '') + '</ul>' +
        '<button type="button" class="btn btn--sm btn--ghost" data-schedule="' + esc(d.id) + '">' + icon('upload') + 'Update the schedule</button></div>');
    } else if (d.type === 'Buy now pay later') {
      extra.push('<p class="debt__none">' + icon('clock') + '<span>Add the payment schedule from the ' + esc(d.lender || d.name) + ' app so I know exactly what’s due and when. <button type="button" class="link-btn" data-schedule="' + esc(d.id) + '">Add the schedule</button></span></p>');
    }
    extra.push(rows.length
      ? '<details class="debt__pays"' + (open[d.id] ? ' open' : '') + ' data-pays="' + esc(d.id) + '"><summary>' + icon('chevron') + '<span>' + esc(plural(s.payments.length, 'payment') + ' found in your statements, ' + money(s.paidTotal) + ' in all') +
        (s.lastPayment ? '<span class="muted"> · last ' + esc(money(-s.lastPayment.amount)) + ' on ' + esc(fmtDate(s.lastPayment.date, { short: true })) + '</span>' : '') + '</span></summary>' +
        '<div class="table-wrap"><table class="tbl tbl--compact"><tbody>' + rows.slice(0, 60).map((r) =>
          '<tr class="clickable" data-tx="' + esc(r.t.id) + '" tabindex="0"><td class="nowrap muted">' + esc(fmtDate(r.t.date, { short: true })) + '</td><td>' + esc(r.t.description) +
          (r.kind === 'borrow' ? ' ' + pill('Added to the debt', 'info') : '') + '</td><td class="hide-sm muted">' + esc(acct(r.t.account)) + '</td><td class="num' + (r.kind === 'borrow' ? ' is-in' : '') + '">' + esc(money(r.t.amount, { sign: true })) + '</td></tr>').join('') +
        '</tbody></table></div>' + (rows.length > 60 ? '<p class="muted small">Showing the latest 60.</p>' : '') + '</details>'
      : '<p class="debt__none">' + icon('search') + '<span>No payments to ' + esc(lender ? lender.name : d.lender || d.name) + ' in your bank statements yet. ' +
        (store.state.transactions.length ? 'If they show up under another name, add it under “How it shows on your statement”.' : 'Import a statement from the Bank tab and I’ll find them.') + '</span></p>');
    if (d.notes) {
      extra.push(longNote
        ? '<details class="debt__notefold"' + (notesOpen[d.id] ? ' open' : '') + ' data-notes="' + esc(d.id) + '"><summary>' + icon('chevron') + '<span>' + (importNote ? 'Notes from the import' : 'Notes') + '</span></summary><p class="debt__notes">' + esc(d.notes) + '</p></details>'
        : '<p class="debt__notes">' + esc(d.notes) + '</p>');
    }
    // The row says each figure briefly; how it was worked out ('estimated from £3,000 on 1 Aug…') is the first line when it opens.
    const leftLong = s.byTerm ? s.months + ' of ' + d.termMonths + ' payments to go' : s.balanceKnown ? (s.paidSince || s.borrowedSince || s.interest >= 1 ? 'estimated from ' + money(d.balance, { whole: true }) + ' on ' + fmtDate(d.balanceDate, { short: true }) + (s.interest >= 1 ? ', with about ' + money(s.interest, { whole: true }) + ' interest' : '') : 'as of ' + fmtDate(d.balanceDate, { short: true })) : 'not set yet';
    const leftShort = s.byTerm ? s.months + ' of ' + d.termMonths + ' to go' : s.balanceKnown ? (s.paidSince || s.borrowedSince || s.interest >= 1 ? 'estimated' : 'as of ' + fmtDate(d.balanceDate, { short: true })) : 'not set yet';
    const payLong = d.monthlyPayment ? 'a month' + (s.monthlyAvg && Math.abs(s.monthlyAvg - d.monthlyPayment) > 1 ? ', ' + money(s.monthlyAvg) + ' on average lately' : '') : s.monthlyAvg ? 'a month, on average lately' : 'no payments found yet';
    const payShort = d.monthlyPayment ? 'a month' : s.monthlyAvg ? 'a month, average' : 'none found yet';
    const how = [leftLong !== leftShort ? 'Left to pay: ' + leftLong : '', payLong !== payShort ? 'Paying: ' + payLong : ''].filter(Boolean);
    if (how.length) extra.unshift('<p class="debt__howline muted">' + esc(how.join(' · ')) + '</p>');
    if (files.length) extra.push('<div class="debt__files"><button type="button" class="thumb-btn" data-files="' + esc(d.id) + '" aria-label="View ' + plural(files.length, 'file') + '">' + thumbHTML(files) + '</button>' + GU.ui.dlButton(files, d.name) + '<span>' + esc(plural(files.length, 'file') + ' attached') + '</span></div>');
    const fig = (label, value, note, o) => '<span class="debt__fig' + (o && o.date ? ' debt__fig--date' : '') + '"><span>' + esc(label) + '</span><b' + (o && o.crit ? ' class="is-crit"' : '') + '>' + value + '</b><em>' + esc(note) + '</em></span>';
    const figs = fig('Left to pay', s.balanceKnown ? esc(money(s.estBalance)) : '–', leftShort) +
      fig('Paying', s.payment ? esc(money(s.payment)) : '–', payShort) +
      fig('Clear by', clearLabel(s) ? esc(clearLabel(s)) : '–', s.months && isFinite(s.months) ? plural(s.months, 'more payment') + (s.asOf < today() ? ' from ' + fmtDate(s.asOf, { short: true }) : '') : s.finished ? 'nothing left, it seems' : s.balanceKnown ? 'add a monthly payment' : 'needs the balance', { date: true, crit: s.months === Infinity });
    return '<article class="debt debt--fold' + (isOpenNow ? ' is-open' : '') + '" data-debt="' + esc(d.id) + '">' +
      '<div class="debt__row">' +
      '<button type="button" class="debt__toggle" data-fold="' + esc(d.id) + '" aria-expanded="' + isOpenNow + '" aria-label="' + esc(d.name + ': ' + (isOpenNow ? 'hide' : 'show') + ' the details') + '">' +
      '<span class="debt__icon">' + icon(TYPE_ICON[d.type] || 'coin') + '</span>' +
      '<span class="debt__id"><b class="debt__name">' + esc(d.name) + '</b>' + (sub ? '<em class="muted">' + esc(sub) + '</em>' : '') + (pills.length ? '<span class="debt__pills">' + pills.join('') + '</span>' : '') + '</span>' +
      figs +
      '<span class="debt__chev" aria-hidden="true">' + icon('chevron') + '</span></button>' +
      '<div class="debt__actions">' +
      (s.finished ? '<button type="button" class="btn btn--sm" data-close="' + esc(d.id) + '">' + icon('check') + 'Mark paid off</button>' : '<button type="button" class="btn btn--sm" data-balance="' + esc(d.id) + '">Update balance</button>') +
      '<button type="button" class="btn btn--sm btn--ghost" data-edit="' + esc(d.id) + '" aria-label="Edit ' + esc(d.name) + '">' + icon('edit') + '</button></div></div>' +
      '<div class="debt__body"' + (isOpenNow ? '' : ' hidden') + '>' + extra.join('') + '</div>' +
      '</article>';
  }

  /* Opens or shuts a debt's card in place, and remembers it for the next redraw. */
  function setFold(card, open) {
    if (!card) return;
    const id = card.dataset.debt;
    const btn = card.querySelector('[data-fold]');
    folds[id] = open;
    btn.setAttribute('aria-expanded', String(open));
    card.classList.toggle('is-open', open);
    card.querySelector('.debt__body').hidden = !open;
    const d = store.find('debts', id);
    if (d) btn.setAttribute('aria-label', d.name + ': ' + (open ? 'hide' : 'show') + ' the details');
  }

  function render(root) {
    const s = store.state;
    const active = (s.debts || []).filter((d) => !d.closed);
    const closed = (s.debts || []).filter((d) => d.closed);
    const tot = D.totals(s);
    const spotted = D.spotted(s);
    const ods = D.overdrafts(s);
    const stale = daysUntil(tot.dataEnd) < -14;

    root.innerHTML = GU.view.head({
      eyebrow: 'Money ahead',
      title: 'Debts',
      text: 'Everything you owe in one place, with what’s left to pay and when you’ll be clear.',
      actions: '<button type="button" class="btn" data-schedule>' + icon('list') + 'Add a payment schedule</button><button type="button" class="btn btn--primary" data-add>' + icon('plus') + 'Add a debt</button>',
    }) +
      GU.ui.dropbar('Drop credit card statements, loan agreements or Klarna screenshots here', 'I’ll read the balance, monthly payment and interest rate, and add it to the right debt.') +
      '<div class="ledger">' +
      '<div><span>You owe about</span><b class="' + (tot.owed ? 'is-crit' : '') + '">' + esc(money(tot.owed)) + '</b><em>' + esc(tot.count ? plural(tot.count, 'debt') + (ods.length ? ' incl. overdraft' : '') + (tot.unknown ? ', ' + tot.unknown + ' without a balance' : '') : 'nothing added yet') + '</em></div>' +
      '<div><span>Monthly payments</span><b>' + esc(money(tot.monthly)) + '</b><em>' + esc(tot.monthly ? money(tot.monthly * 12, { whole: true }) + ' a year' : 'none found yet') + '</em></div>' +
      '<div><span>Paid in the last 3 months</span><b>' + esc(money(tot.paid90)) + '</b><em>' + esc(!s.transactions.length ? 'import a statement to see this' : stale ? 'to ' + fmtDate(tot.dataEnd, { short: true }) + ', your latest statement' : 'from your statements') + '</em></div>' +
      '<div><span>Debt-free by</span><b class="' + (tot.never ? 'is-crit' : '') + '">' + esc(tot.never ? 'Not yet' : tot.clearBy ? monthLabel(tot.clearBy.slice(0, 7), true) : '–') + '</b><em>' + esc(tot.never ? 'one debt won’t clear at its current payment' : tot.clearBy ? 'at your current payments' : 'add balances and payments') + '</em></div>' +
      '</div>' +
      (stale && s.transactions.length ? '<p class="note-line">' + icon('clock') + '<span>Your latest bank statement runs to ' + esc(fmtDate(tot.dataEnd)) + '. Import newer statements and I’ll bring these figures up to date.</span><button type="button" class="btn btn--sm" data-import>Import statements</button></p>' : '') +
      '<div class="cols cols--main-side cols--debts"><div class="stack">' +
      (spotted.length ? '<section class="panel panel--spotted"><header class="panel__head"><h2>' + icon('search') + 'Payments that look like debts</h2><span class="muted">from your statements</span></header><ul class="rows">' +
        spotted.map((x, i) => '<li class="spot"><span class="row-item__icon">' + icon(TYPE_ICON[x.type] || 'coin') + '</span><span class="spot__text"><b>' + esc(x.lender) + '</b><em>' +
          esc(plural(x.count, 'payment') + ' over ' + plural(x.months, 'month') + ', ' + money(x.total) + ' in all · last ' + fmtDate(x.last, { short: true })) + '</em></span>' +
          '<span class="spot__act"><button type="button" class="btn btn--sm btn--primary" data-track="' + i + '">Track it</button><button type="button" class="btn btn--sm btn--ghost" data-ignore="' + i + '">Not a debt</button></span></li>').join('') +
        '</ul></section>' : '') +
      (GU.payoff ? GU.payoff.card(s) : '') +
      (active.length ? active.map(debtCard).join('')
        : '<section class="panel">' + emptyState({ icon: 'card', title: 'No debts added yet', text: spotted.length ? 'Start with the payments I found above, or add a card, loan or finance agreement yourself.' : 'Add a credit card, loan, Klarna, car finance or money you owe someone. Your bank statements fill in the payments.', action: '<button type="button" class="btn btn--primary" data-add>' + icon('plus') + 'Add a debt</button>' }) + '</section>') +
      (closed.length ? '<details class="panel panel--details"><summary class="panel__head"><h2>Paid off</h2><span class="muted">' + closed.length + '</span></summary><ul class="rows">' + closed.map((d) =>
        '<li class="spot"><span class="row-item__icon">' + icon('check') + '</span><span class="spot__text"><b>' + esc(d.name) + '</b><em>' + esc(['Closed ' + (d.closedDate ? fmtDate(d.closedDate, { short: true }) : ''), d.lender].filter(Boolean).join(' · ')) + '</em></span><span class="spot__act"><button type="button" class="btn btn--sm btn--ghost" data-edit="' + esc(d.id) + '">' + icon('edit') + 'Edit</button></span></li>').join('') + '</ul></details>' : '') +
      '</div><aside class="stack">' +
      overdraftsPanel(s, ods) +
      '<details class="panel panel--details debt__how"' + (howOpen ? ' open' : '') + '><summary class="panel__head"><h2>' + icon('info') + 'How these figures are worked out</h2></summary><div class="panel__body tip"><p>I match payments by the lender’s name on your bank statement (for example KLARNA, PAYPAL PAYIN3 or Flex on Monzo). Left to pay is the balance you gave me, less what you’ve paid since, plus interest if you gave me the rate. Update the balance now and then from a real statement to keep it exact.</p></div></details>' +
      '</aside></div>';

    GU.ui.wireDropbar(root, (files) => GU.inbox.add({ files, scope: { kind: 'debts', name: 'Debts' } }));
    if (GU.payoff) GU.payoff.wire(root);
    root.querySelectorAll('[data-pays]').forEach((el) => el.addEventListener('toggle', () => (open[el.dataset.pays] = el.open)));
    root.querySelectorAll('[data-notes]').forEach((el) => el.addEventListener('toggle', () => (notesOpen[el.dataset.notes] = el.open)));
    const how = root.querySelector('.debt__how');
    if (how) how.addEventListener('toggle', () => (howOpen = how.open));
    root.addEventListener('click', async (e) => {
      const b = (sel) => e.target.closest(sel);
      if (b('[data-add]')) return create();
      if (b('[data-import]')) return GU.tabs.transactions.importStatement();
      if (b('[data-balances]')) return GU.tabs.transactions.updateBalances();
      let el;
      if ((el = b('[data-fold]'))) return setFold(el.closest('.debt'), el.getAttribute('aria-expanded') !== 'true');
      // A debt's name in the Debt-free date table scrolls to its card (that's the card's own code): open it as well.
      if ((el = b('[data-po-go]'))) {
        const card = Array.from(root.querySelectorAll('.debt')).find((c) => c.dataset.debt === el.dataset.poGo);
        if (card) setFold(card, true);
        return;
      }
      if ((el = b('[data-track]'))) {
        const x = spotted[+el.dataset.track];
        return create({ name: x.lender, lender: x.lender, type: x.type, monthlyPayment: x.monthlyAvg || null });
      }
      if ((el = b('[data-ignore]'))) {
        const x = spotted[+el.dataset.ignore];
        store.commit((st) => (st.settings.ignoredLenders = (st.settings.ignoredLenders || []).concat([x.lender])));
        toast('I won’t suggest ' + x.lender + ' again', { action: 'Undo', onAction: () => store.commit((st) => (st.settings.ignoredLenders = (st.settings.ignoredLenders || []).filter((n) => n !== x.lender))) });
        return;
      }
      if ((el = b('[data-schedule]'))) {
        const d = el.dataset.schedule && store.find('debts', el.dataset.schedule);
        return scheduleDialog(d ? d.lender || d.name : '');
      }
      if ((el = b('[data-balance]'))) return updateBalance(el.dataset.balance);
      if ((el = b('[data-close]'))) {
        const id = el.dataset.close;
        const d = store.find('debts', id);
        store.commit((st) => Object.assign(st.debts.find((x) => x.id === id), { closed: true, closedDate: today() }));
        toast(d.name + ' marked as paid off', { action: 'Undo', onAction: () => store.commit((st) => Object.assign(st.debts.find((x) => x.id === id), { closed: false, closedDate: undefined })) });
        return;
      }
      if ((el = b('[data-edit]'))) return edit(el.dataset.edit);
      if ((el = b('[data-files]'))) {
        const d = store.find('debts', el.dataset.files);
        if (d) viewFiles(d.files, 0, d.name);
        return;
      }
      if ((el = b('tr[data-tx]'))) return GU.tabs.transactions.edit(el.dataset.tx);
      if ((el = b('[data-account]'))) {
        e.preventDefault();
        GU.tabs.transactions.showAccount(el.dataset.account);
      }
    });
    root.addEventListener('keydown', (e) => {
      const row = e.target.closest && e.target.closest('tr[data-tx]');
      if (row && e.key === 'Enter') GU.tabs.transactions.edit(row.dataset.tx);
    });
  }

  /* ---------- add and edit ---------- */
  function fields(isNew) {
    return [
      { name: 'name', label: 'What is it?', required: true, placeholder: 'e.g. Barclaycard, Car finance, Klarna', list: D.LENDERS.map((l) => l.name) },
      { name: 'type', label: 'Type', type: 'select', options: D.TYPES, default: 'Credit card', half: true },
      { name: 'lender', label: 'Lender', optional: true, half: true, placeholder: 'Who you pay', list: D.LENDERS.map((l) => l.name) },
      { name: 'balance', label: 'Balance owed', type: 'money', optional: true, half: true, help: 'From your latest statement or app.' },
      { name: 'balanceDate', label: 'Balance on', type: 'date', half: true },
      { name: 'monthlyPayment', label: 'Monthly payment', type: 'money', optional: true, half: true, help: 'Leave empty and I’ll use what you’ve been paying.' },
      { name: 'paymentDay', label: 'Payment day', type: 'number', optional: true, half: true, placeholder: '1 to 31', help: 'Day of the month it’s taken.' },
      { name: 'apr', label: 'Interest rate (APR %)', type: 'number', optional: true, half: true, placeholder: 'e.g. 24.9' },
      { name: 'startBalance', label: 'Amount first borrowed', type: 'money', optional: true, half: true, help: 'Shows how much you’ve paid off.' },
      { name: 'termMonths', label: 'Number of monthly payments', type: 'number', optional: true, half: true, placeholder: 'e.g. 48', help: 'For loans and finance with a fixed end.' },
      { name: 'startDate', label: 'First payment date', type: 'date', optional: true, half: true },
      { name: 'match', label: 'How it shows on your statement', optional: true, placeholder: 'e.g. BARCLAYCARD, PAYPAL *PAYIN3', help: 'Leave empty for well-known lenders. Separate several names with commas.' },
      { name: 'files', label: 'Statements and agreements', type: 'files', dropLabel: 'Attach a statement, agreement or screenshot' },
      { name: 'notes', label: 'Notes', type: 'textarea', rows: 2, optional: true, placeholder: 'Account number, promo end date, how to pay it off early…' },
    ].concat(isNew ? [] : [{ name: 'closed', label: 'Paid off', type: 'checkbox', checkLabel: 'This debt is paid off and closed' }]);
  }

  /* Previews how many statement payments a debt would pick up, inside the form. */
  function matchHint(v, form) {
    const wrap = form.querySelector('[data-field="match"] .field__help');
    if (!wrap) return;
    if (!v.name && !v.lender && !v.match) return;
    const n = D.payments(store.state, v).length;
    wrap.textContent = store.state.transactions.length
      ? (n ? 'I can see ' + plural(n, 'payment') + ' to this in your statements.' : 'No matching payments in your statements yet. Try the name exactly as your bank shows it.') + ' Separate several names with commas.'
      : 'Leave empty for well-known lenders. Separate several names with commas.';
  }

  function save(v, existing) {
    const t = today();
    const rec = Object.assign(existing ? Object.assign({}, existing) : { id: 'debt-' + uid(), created: t, history: [] }, v);
    if (!rec.lender) {
      const l = D.lenderFor(rec.name);
      if (l) rec.lender = l.name;
    }
    if (rec.balance != null && !rec.balanceDate) rec.balanceDate = t;
    if (rec.paymentDay != null) rec.paymentDay = Math.min(31, Math.max(1, Math.round(rec.paymentDay))) || null;
    if (rec.balance != null && (!existing || existing.balance !== rec.balance || existing.balanceDate !== rec.balanceDate)) {
      rec.history = (rec.history || []).concat([{ date: rec.balanceDate, balance: rec.balance }]).slice(-60);
      if (rec.startBalance == null && (!existing || existing.startBalance == null)) rec.startBalance = rec.balance;
    }
    if (rec.closed && !rec.closedDate) rec.closedDate = t;
    if (!rec.closed) delete rec.closedDate;
    let changed = [];
    store.commit((st) => {
      const i = st.debts.findIndex((x) => x.id === rec.id);
      if (i >= 0) st.debts[i] = rec;
      else st.debts.push(rec);
      changed = D.claim(st, rec);
    });
    return { rec, changed };
  }
  function undoClaim(st, changed) {
    for (const c of changed) {
      const t = st.transactions.find((x) => x.id === c.id);
      if (t) t.category = c.before;
    }
  }

  function create(prefill, opts) {
    opts = opts || {};
    prefill = prefill || {};
    if (!prefill.type && prefill.name) {
      const l = D.lenderFor(prefill.name);
      if (l) prefill.type = l.type;
    }
    formDialog({
      title: 'Add a debt',
      intro: 'Add what you owe. I’ll find the payments in your bank statements and keep the balance up to date.',
      fields: fields(true),
      values: Object.assign({ balanceDate: today(), type: 'Credit card' }, prefill),
      initialFiles: opts.files,
      submitLabel: 'Add debt',
      onChange: matchHint,
      onSubmit: (v) => {
        const { rec, changed } = save(v, null);
        const s = D.summary(store.state, rec);
        toast('Added ' + rec.name + (s.payments.length ? '. Found ' + plural(s.payments.length, 'payment') + ' in your statements' : ''),
          changed.length ? { action: 'Undo', onAction: () => store.commit((st) => {
            undoClaim(st, changed);
            st.debts = st.debts.filter((x) => x.id !== rec.id);
          }) } : undefined);
        if (opts.onSaved) opts.onSaved(rec);
      },
    });
  }

  function edit(id) {
    const d = store.find('debts', id);
    if (!d) return;
    formDialog({
      title: 'Edit ' + d.name,
      fields: fields(false),
      values: d,
      onChange: matchHint,
      onSubmit: (v) => {
        save(v, d);
      },
      onDelete: () => {
        store.remove('debts', id, d.name);
      },
      deleteMessage: 'This removes the debt and its notes. Your bank transactions are kept. You can undo it, and it stays in Settings → Recently deleted for 30 days.',
    });
  }

  function updateBalance(id) {
    const d = store.find('debts', id);
    if (!d) return;
    const s = D.summary(store.state, d);
    formDialog({
      title: 'Update the balance for ' + d.name,
      intro: s.balanceKnown ? 'I estimate ' + esc(money(s.estBalance)) + ' is left. Put in the figure from your latest statement or app and I’ll work forward from there.' : 'Put in the figure from your latest statement or app.',
      fields: [
        { name: 'balance', label: 'Balance owed', type: 'money', required: true, half: true },
        { name: 'balanceDate', label: 'On', type: 'date', required: true, half: true },
      ],
      values: { balance: s.balanceKnown ? s.estBalance : null, balanceDate: today() },
      submitLabel: 'Update',
      onSubmit: (v) => {
        save(Object.assign({}, d, v, { closed: v.balance === 0 ? d.closed : false }), d);
        toast(d.name + ' updated');
      },
    });
  }

  /* ---------- payment schedules ---------- */
  const SCHEDULE_FROM = ['Klarna', 'PayPal Pay in 3', 'PayPal Credit', 'Clearpay', 'Zilch', 'Laybuy', 'Monzo Flex'];
  const HOW = {
    Klarna: 'In the Klarna app, tap Payments to see everything that’s upcoming. Select the list and copy it, or take screenshots of it.',
    'PayPal Pay in 3': 'In the PayPal app, go to Pay Later, open each plan and copy or screenshot its payment schedule.',
    'PayPal Credit': 'In the PayPal app, open PayPal Credit and screenshot your statement balance, minimum payment and due date.',
    'Monzo Flex': 'In the Monzo app, open Flex and screenshot your upcoming payments.',
  };
  function scheduleDialog(lender) {
    const known = (store.state.debts || []).filter((d) => !d.closed).map((d) => d.lender || d.name);
    const options = Array.from(new Set(SCHEDULE_FROM.concat(known)));
    formDialog({
      title: 'Add a payment schedule',
      intro: 'Paste the list of upcoming payments, or add screenshots of it. I’ll read each payment’s date and amount and put them in your plan.',
      fields: [
        { name: 'lender', label: 'From', type: 'select', options, default: lender && options.includes(lender) ? lender : 'Klarna' },
        { name: 'how', type: 'html', html: '<p class="field__help" data-how></p>' },
        { name: 'text', label: 'Paste the upcoming payments', type: 'textarea', rows: 7, optional: true, placeholder: 'For example:\nASOS  £25.00  Due 15 Oct\nArgos  £40.00  Due 25 Oct' },
        { name: 'files', label: 'Or add screenshots', type: 'files', dropLabel: 'Add screenshots from the app' },
      ],
      values: { lender: lender && options.includes(lender) ? lender : 'Klarna' },
      submitLabel: 'Read it',
      onChange: (v, form) => {
        const el = form.querySelector('[data-how]');
        if (el) el.textContent = HOW[v.lender] || 'Copy the list of upcoming payments from the app or website, or take screenshots of it.';
      },
      onSubmit: async (v) => {
        const metas = v.files || [];
        if (!v.text && !metas.length) {
          toast('Paste the payments or add a screenshot first.');
          return false;
        }
        const files = [];
        for (const m of metas) {
          const r = await GU.files.get(m.id);
          if (r && r.blob) files.push(new File([r.blob], m.name, { type: m.type }));
        }
        const done = toast('Reading your ' + v.lender + ' payments…', { timeout: 90000 });
        let res;
        try {
          res = await GU.brain.readSchedule({ text: v.text, files });
        } finally {
          if (typeof done === 'function') done();
        }
        if (!res.payments.length) {
          toast('I couldn’t find any payments still to pay in that. Try copying the list again, or a clearer screenshot.');
          return false;
        }
        setTimeout(() => checkSchedule(v.lender, res.payments, metas), 50);
      },
    });
  }
  function checkSchedule(lender, list, metas) {
    const total = sum(list, (p) => p.amount);
    formDialog({
      title: 'Check your ' + lender + ' payments',
      intro: 'I found ' + esc(plural(list.length, 'payment')) + ' still to pay, ' + esc(money(total)) + ' in all. Untick anything that isn’t right. Saving replaces the upcoming payments I had for ' + esc(lender) + '.',
      fields: [{ name: 'list', type: 'html', html: '<ul class="sched-pick">' + list.map((p, i) => '<li><label class="check"><input type="checkbox" data-pick="' + i + '" checked><span><b>' + esc(fmtDate(p.date, { weekday: true })) + '</b> ' +
        esc([p.merchant, p.of ? p.n + ' of ' + p.of : ''].filter(Boolean).join(' · ')) + '</span></label><span class="sched-pick__amt">' + esc(money(p.amount)) + '</span></li>').join('') + '</ul>' }],
      submitLabel: 'Save schedule',
      noAutofocus: true,
      onSubmit: () => {
        const picked = list.filter((p, i) => {
          const el = document.querySelector('[data-pick="' + i + '"]');
          return !el || el.checked;
        });
        let id = null;
        store.commit((st) => {
          const d = GU.debts.setSchedule(st, lender, picked);
          if (metas.length) d.files = (d.files || []).concat(metas);
          GU.debts.claim(st, d);
          id = d.id;
        });
        const d = store.find('debts', id);
        const s = GU.debts.summary(store.state, d);
        toast('Saved ' + plural(picked.length, 'payment') + ' for ' + lender + (s.clearBy ? '. The last one is on ' + fmtDate(s.clearBy) : '') + '.');
      },
    });
  }

  /* From the inbox: a statement or agreement for a debt, read by the assistant. Adds to the debt you already have from that lender. */
  function fromInbox(r, metas) {
    const s = store.state;
    const name = String(r.party || r.title || '').trim();
    const l = D.lenderFor(name) || D.lenderFor(r.title);
    const key = (l ? l.name : name).toLowerCase();
    const existing = key && s.debts.find((d) => [d.name, d.lender].filter(Boolean).some((n) => n.toLowerCase() === key || (key.length > 3 && n.toLowerCase().includes(key))));
    const v = {};
    if (r.amount != null) {
      v.balance = r.amount;
      v.balanceDate = r.date || today();
    }
    if (r.monthly_payment != null) v.monthlyPayment = r.monthly_payment;
    if (r.borrowed_amount != null) v.startBalance = r.borrowed_amount;
    // An agreement with a fixed term: what's left comes from the payments still to make.
    if (r.term_months && r.amount == null) {
      v.termMonths = r.term_months;
      v.startDate = r.date ? GU.util.addMonths(r.date, 1) : today();
    }
    if (r.interest_rate != null) v.apr = r.interest_rate;
    if (r.due_date) v.paymentDay = +r.due_date.slice(8, 10);
    if (existing) {
      const keep = {};
      for (const k of Object.keys(v)) if (v[k] != null && !(k === 'balance' && existing.balanceDate && v.balanceDate < existing.balanceDate)) keep[k] = v[k];
      if (keep.balance == null) delete keep.balanceDate;
      const before = JSON.parse(JSON.stringify(existing));
      const { rec, changed } = save(Object.assign({}, existing, keep, { files: (existing.files || []).concat(metas) }), existing);
      return { rec, added: false, undo: () => store.commit((st) => {
        undoClaim(st, changed);
        st.debts = st.debts.map((x) => (x.id === rec.id ? before : x));
      }) };
    }
    const type = (r.debt_type && D.TYPES.includes(r.debt_type) && r.debt_type) || (l ? l.type : 'Other');
    const { rec, changed } = save(Object.assign({ name: l ? l.name : r.title || name || 'Debt', lender: l ? l.name : name, type, files: metas, notes: [r.reference ? 'Ref ' + r.reference : '', r.notes].filter(Boolean).join('\n') }, v), null);
    return { rec, added: true, undo: () => store.commit((st) => {
      undoClaim(st, changed);
      st.debts = st.debts.filter((x) => x.id !== rec.id);
    }) };
  }

  GU.tabs.debts = { label: 'Debts', short: 'Debts', icon: 'card', render, create, edit, updateBalance, fromInbox, accountsCard, balanceLine, staleNote, scheduleDialog };
})();
