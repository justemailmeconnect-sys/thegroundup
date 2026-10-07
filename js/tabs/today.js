/* The Ground Up: Home › Overview. The two doors (Home and Work), then where you stand and where you're heading:
   your balances now, the money coming in and going out from today with the lowest point and the month-end
   figure, then the other things coming up. Only your own things: work has its own Overview. */
(function () {
  'use strict';
  const GU = window.GU;
  const { esc, today, addDays, daysUntil, fmtDate, fmtLongDate, greeting, money, plural, monthLabel, weekday, sum } = GU.util;
  const { icon, emptyState } = GU.ui;
  const F = GU.finance;
  const store = GU.store;

  let horizon = 14;

  /* The employer's short name for sentences ('KTK'), or 'the company' when none is set. */
  const co = (s, cap) => (GU.parts && GU.parts.co ? GU.parts.co(s, cap) : cap ? 'The company' : 'the company');

  const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  /* "Call the council tomorrow" -> {title: 'Call the council', due: <tomorrow>} */
  function parseQuickTask(text) {
    let title = text.trim();
    let due = '';
    const t = today();
    const take = (re, date) => {
      if (due || !re.test(title)) return;
      due = date;
      title = title.replace(re, ' ').replace(/\s{2,}/g, ' ').trim();
    };
    take(/\b(?:by |on )?(today|tonight)\b/i, t);
    take(/\b(?:by |on )?tomorrow\b/i, addDays(t, 1));
    take(/\bnext week\b/i, addDays(t, 7));
    const explicit = title.match(/\b(?:on |by |for )?((\d{1,2})(?:st|nd|rd|th)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?(?:\s+(\d{4}))?|(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?)\b/i);
    if (explicit && !due) {
      const year = explicit[4] || explicit[7] || t.slice(0, 4);
      const iso = explicit[3] ? GU.util.parseLooseDate(explicit[2] + ' ' + explicit[3] + ' ' + year, 'dmy') : GU.util.parseLooseDate(explicit[5] + '/' + explicit[6] + '/' + year, 'dmy');
      if (iso) {
        const bump = !explicit[4] && !explicit[7] && iso < t ? GU.util.addMonths(iso, 12) : iso;
        take(new RegExp(explicit[0].replace(/[.*+?^${}()|[\]\\/]/g, '\\$&'), 'i'), bump);
      }
    }
    const inDays = title.match(/\bin (\d{1,3}) days?\b/i);
    if (inDays) take(/\bin \d{1,3} days?\b/i, addDays(t, +inDays[1]));
    for (let i = 0; i < 7 && !due; i++) {
      const re = new RegExp('\\b(?:by |on |this |next )?' + WEEKDAYS[i] + '\\b', 'i');
      const delta = ((i - weekday(t) + 7) % 7) || 7;
      take(re, addDays(t, delta));
    }
    title = title.replace(/[\s,.-]+$/, '');
    return { title: title.charAt(0).toUpperCase() + title.slice(1), due };
  }

  function groupLabel(date) {
    const n = daysUntil(date);
    if (n === 0) return 'Today';
    if (n === 1) return 'Tomorrow';
    const [y, m, d] = date.split('-').map(Number);
    const wd = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][weekday(date)];
    return wd + ' ' + d + (date.slice(0, 7) !== today().slice(0, 7) ? ' ' + GU.util.MONTHS[m - 1] : '') + (y !== new Date().getFullYear() ? ' ' + y : '');
  }

  function itemHTML(it) {
    const k = GU.agenda.KINDS[it.kind];
    const ref = it.ref.c + ':' + it.ref.id;
    let action = '';
    if (it.action === 'done') action = '<button type="button" class="btn btn--sm btn--soft" data-act="done" data-ref="' + esc(ref) + '">' + icon('check') + 'Done</button>';
    if (it.action === 'paid') action = '<button type="button" class="btn btn--sm btn--soft" data-act="paid" data-ref="' + esc(ref) + '">' + icon('check') + (it.kind === 'owed' ? 'Got paid' : 'Paid') + '</button>';
    if (it.action === 'ktkpaid') action = '<button type="button" class="btn btn--sm btn--soft" data-act="ktkpaid" data-ref="' + esc(ref) + '">' + icon('check') + 'Paid by ' + esc(co(store.state)) + '</button>';
    if (it.action === 'return' && GU.returns) action = GU.returns.actionsHTML(it.ref.id);
    const amount = it.amount != null ? '<span class="tl-item__amt' + (it.amount > 0 ? ' is-in' : '') + '">' + esc(money(it.amount, { sign: true })) + '</span>' : '';
    const late = it.overdue ? '<span class="tl-item__late">' + (it.kind === 'task' ? 'Was due ' : 'Due ') + esc(fmtDate(it.date, { short: true })) + '</span>' : '';
    return '<li class="tl-item' + (it.overdue ? ' is-overdue' : '') + (it.priority === 'high' ? ' is-high' : '') + '">' +
      '<span class="kind kind--' + it.kind + '">' + esc(k.label) + '</span>' +
      '<button type="button" class="tl-item__main" data-open="' + esc(ref) + '"><b>' + esc(it.title) + '</b>' +
      '<em>' + late + esc(it.meta || '') + '</em></button>' +
      '<span class="tl-item__end">' + amount + action + '</span></li>';
  }

  function timelineHTML(items) {
    const t = today();
    const overdue = items.filter((i) => i.overdue && i.kind !== 'income');
    const upcoming = items.filter((i) => !i.overdue);
    if (!overdue.length && !upcoming.length) {
      return emptyState({ icon: 'check', title: 'Nothing due in the next ' + horizon + ' days', text: 'Add a task above, or set up your bills so they show up here.' });
    }
    const groups = [];
    if (overdue.length) groups.push({ label: 'Overdue', key: 'overdue', items: overdue });
    const byDate = new Map();
    for (const it of upcoming) {
      if (!byDate.has(it.date)) byDate.set(it.date, []);
      byDate.get(it.date).push(it);
    }
    if (!byDate.has(t)) byDate.set(t, []);
    Array.from(byDate.keys()).sort().forEach((d) => groups.push({ label: groupLabel(d), key: d, items: byDate.get(d) }));
    return '<ol class="timeline">' + groups.map((g) =>
      '<li class="tl-day' + (g.key === 'overdue' ? ' tl-day--overdue' : '') + (g.key === t ? ' tl-day--today' : '') + '">' +
      '<h3 class="tl-day__label">' + esc(g.label) + '</h3>' +
      (g.items.length ? '<ul class="tl-day__items">' + g.items.map(itemHTML).join('') + '</ul>'
        : '<p class="tl-day__clear">' + icon('check') + 'Nothing else due today</p>') + '</li>').join('') + '</ol>';
  }

  /* ---------- money ahead ---------- */
  let range = 'month';
  const shortMonth = (iso) => monthLabel(iso.slice(0, 7), true).split(' ')[0];
  function windowFor(t) {
    const end = GU.forecast.monthEnd(t);
    if (range === '30') return { from: t, to: addDays(t, 30), label: 'Next 30 days', endLabel: 'By ' + fmtDate(addDays(t, 30), { short: true }) };
    if (range === 'next') {
      const s = addDays(end, 1);
      return { from: s, to: GU.forecast.monthEnd(s), label: monthLabel(s.slice(0, 7), true), endLabel: 'By ' + fmtDate(GU.forecast.monthEnd(s), { short: true }) };
    }
    return { from: t, to: end, label: 'Rest of ' + shortMonth(t), endLabel: 'By ' + fmtDate(end, { short: true }) };
  }
  const KIND_LABEL = {
    income: 'In', bill: 'Bill', debt: 'Debt', invoice: 'Invoice', owed: 'Invoice',
    // Money your employer should pay you back. The row itself says 'Back from <employer>', so the pill stays short.
    reclaim: 'Back',
  };

  /* The running total of what people owe you on invoices you've sent. */
  function owedCard(s) {
    const list = GU.finance.owedToMe(s);
    if (!list.length) return '';
    const total = sum(list, (x) => x.left);
    const late = list.filter((x) => x.late);
    const next = list.find((x) => !x.late && x.p.dueDate);
    return '<button type="button" class="now-card now-card--owed" data-owed><span>Owed to you</span><b>' + esc(money(total)) + '</b><em>' +
      esc(plural(list.length, 'invoice') + (late.length ? ' · ' + money(sum(late, (x) => x.left)) + ' late' : next ? ' · next due ' + fmtDate(next.p.dueDate, { short: true }) : '')) + '</em></button>';
  }

  /* What your employer owes you for things you paid for at work: not sent yet, and sent but not paid back.
     Amber once the oldest thing not sent is a week old. Opens Work › Get paid back. */
  function backCard(s) {
    const W = GU.workMoney;
    if (!W || !W.dueBack) return '';
    const d = W.dueBack(s);
    if (!(d.total > 0) && !d.count) return '';
    const late = d.amber && d.oldest;
    return '<button type="button" class="now-card now-card--owed now-card--back' + (late ? ' is-warn' : '') + '" data-claims><span>Due back from ' + esc(co(s)) + '</span><b>' + esc(money(d.total)) + '</b><em>' +
      esc(money(d.toSendTotal) + ' not sent · ' + money(d.sentTotal) + ' waiting') +
      (late ? '<i>' + icon('clock') + esc('Oldest not sent ' + plural(d.oldest.days, 'day') + ' ago') + '</i>' : '') + '</em></button>';
  }

  function nowHTML(s) {
    const list = GU.money.accounts(s).filter((x) => x.info || x.count);
    if (!list.length) {
      return '<section class="now"><header class="sec-head"><h2>Right now</h2></header><div class="now-empty">' + icon('bank') +
        '<p>Tell me what’s in your accounts and I’ll plan the rest of the month from there.</p><button type="button" class="btn btn--primary" data-balances>Add your balances</button></div>' +
        (owedCard(s) + backCard(s) ? '<div class="now-cards">' + owedCard(s) + backCard(s) + '</div>' : '') + '</section>';
    }
    const known = list.filter((x) => x.info);
    const total = sum(known, (x) => x.info.balance);
    const spare = sum(known, (x) => x.info.overdraftLimit || 0);
    const asOf = known.reduce((m, x) => (!m || x.info.asOf < m ? x.info.asOf : m), '');
    const stale = asOf && daysUntil(asOf) < -2;
    return '<section class="now"><header class="sec-head"><h2>Right now</h2><span class="muted">' + (asOf ? 'balances as of ' + esc(fmtDate(asOf, { weekday: true })) : '') + '</span>' +
      '<button type="button" class="btn btn--sm' + (stale ? ' btn--primary' : '') + '" data-balances>' + icon('edit') + 'Update balances</button></header>' +
      (stale ? '<p class="note-line">' + icon('clock') + '<span>These balances are ' + Math.abs(daysUntil(asOf)) + ' days old. Put in what your banking apps show now so the plan below stays right.</span></p>' : '') +
      '<div class="now-cards">' + list.map((x) => {
        const b = x.info;
        const neg = b && b.balance < 0;
        const od = b && b.overdraftLimit ? (neg ? money(b.overdraftLimit + b.balance, { whole: false }) + ' of ' + money(b.overdraftLimit, { whole: true }) + ' overdraft left' : money(b.overdraftLimit, { whole: true }) + ' overdraft available') : neg ? 'Overdrawn' : '';
        return '<button type="button" class="now-card' + (neg ? ' is-neg' : '') + '" data-account="' + esc(x.account.id) + '"><span>' + esc(x.account.name) + '</span><b>' + (b ? esc(money(b.balance)) : '–') + '</b><em>' + esc(od || (b ? 'in credit' : 'no balance yet')) + '</em></button>';
      }).join('') +
      (known.length > 1 ? '<div class="now-card now-card--total' + (total < 0 ? ' is-neg' : '') + '"><span>Together</span><b>' + esc(money(total)) + '</b><em>' + esc(spare ? money(total + spare) + ' available with overdrafts' : 'across your accounts') + '</em></div>' : '') +
      owedCard(s) + backCard(s) +
      '</div></section>';
  }

  function aheadHTML(s, t) {
    const win = windowFor(t);
    const plan = GU.forecast.plan(s, { to: win.to });
    const ev = plan.events.filter((e) => e.date >= win.from);
    const before = plan.events.filter((e) => e.date < win.from);
    const startShown = before.length ? before[before.length - 1].after : plan.start;
    const days = plan.days.filter((d) => d.date >= win.from);
    const low = days.reduce((m, d) => (d.value < m.value ? d : m), { date: win.from, value: startShown });
    const endShown = ev.length ? ev[ev.length - 1].after : startShown;
    const inn = sum(ev.filter((e) => e.amount > 0), (e) => e.amount);
    const out = sum(ev.filter((e) => e.amount < 0), (e) => -e.amount);
    const warns = plan.accounts.filter((a) => a.low < 0).map((a) => {
      const past = a.low < -a.limit;
      return '<li class="' + (past ? 'is-crit' : 'is-warn') + '">' + icon('alert') + '<span>' + esc(past
        ? a.name + ' would go ' + money(-a.low - a.limit) + ' past its ' + money(a.limit, { whole: true }) + ' overdraft limit by ' + fmtDate(a.lowDate, { weekday: true }) + '. Move money across before then.'
        : a.name + ' stays overdrawn, lowest ' + money(a.low) + ' on ' + fmtDate(a.lowDate, { short: true }) + (a.limit ? ' (' + money(a.limit + a.low) + ' of overdraft left)' : '') + '.') + '</span></li>';
    });
    const step = Math.max(1, Math.round(days.length / 4));
    const labels = [];
    for (let i = 0; i < days.length; i += step) labels.push({ i, text: fmtDate(days[i].date, { short: true }) });
    const groups = new Map();
    for (const e of ev) {
      if (!groups.has(e.date)) groups.set(e.date, []);
      groups.get(e.date).push(e);
    }
    const seg = [['month', 'Rest of ' + shortMonth(t)], ['30', 'Next 30 days'], ['next', shortMonth(addDays(GU.forecast.monthEnd(t), 1))]];
    return '<section class="panel ahead"><header class="panel__head"><h2>' + icon('trend') + 'Money ahead</h2>' +
      '<div class="seg seg--sm" role="radiogroup" aria-label="Period">' + seg.map(([v, l]) => '<label><input type="radio" name="ahead-range" value="' + v + '"' + (range === v ? ' checked' : '') + '><span>' + esc(l) + '</span></label>').join('') + '</div></header>' +
      '<div class="ahead__sum">' +
      '<div><span>Coming in</span><b class="is-in">' + esc(money(inn, { sign: true })) + '</b><em>' + esc(plural(ev.filter((e) => e.amount > 0).length, 'payment')) + '</em></div>' +
      '<div><span>Going out</span><b>' + esc(money(-out)) + '</b><em>' + esc(plural(ev.filter((e) => e.amount < 0).length, 'payment')) + '</em></div>' +
      '<div><span>' + esc(win.endLabel) + '</span><b class="' + (endShown < 0 ? 'is-crit' : '') + '">' + esc(money(endShown)) + '</b><em>across your accounts</em></div>' +
      '<div><span>Lowest point</span><b class="' + (low.value < 0 ? 'is-crit' : '') + '">' + esc(money(low.value)) + '</b><em>' + esc(fmtDate(low.date, { weekday: true })) + '</em></div>' +
      '</div>' +
      (warns.length ? '<ul class="ahead__warn">' + warns.join('') + '</ul>' : '') +
      (plan.owedNotCounted.length ? '<p class="note-line">' + icon('clock') + '<span>' + esc(money(sum(plan.owedNotCounted, (x) => x.left)) + ' owed to you on ' +
        plural(plan.owedNotCounted.length, 'invoice') + (plan.owedNotCounted.every((x) => x.late) ? ' that ' + (plan.owedNotCounted.length > 1 ? 'are' : 'is') + ' late' : ' that ' + (plan.owedNotCounted.length > 1 ? 'are' : 'is') + ' late or ' + (plan.owedNotCounted.length > 1 ? 'have' : 'has') + ' no due date') +
        ' isn’t counted here until it’s paid.') + ' <button type="button" class="link link--btn" data-owed>See them</button></span></p>' : '') +
      reclaimNote(plan) +
      (days.length > 2 && ev.length ? '<div class="panel__body ahead__chart">' + GU.charts.line(days.map((d) => ({ value: d.value, tip: fmtDate(d.date, { weekday: true }) + ': ' + money(d.value) })), { height: 150, labels, color: '--series-in' }) + '</div>' : '') +
      (ev.length ? '<ol class="flow">' + Array.from(groups).map(([d, items]) => '<li class="flow-day' + (d === t ? ' is-today' : '') + '"><h3>' + esc(d === t ? 'Today' : fmtDate(d, { weekday: true })) + '</h3><ul>' +
        items.map((e) => '<li class="flow-row' + (e.amount > 0 ? ' is-in' : '') + (e.review || e.rough || e.soft ? ' is-soft' : '') + '"><span class="kind kind--' + (e.kind === 'income' || e.kind === 'owed' || e.kind === 'reclaim' ? 'income' : e.kind === 'debt' ? 'debt' : 'bill') + '">' + esc(KIND_LABEL[e.kind] || '') + '</span>' +
          '<button type="button" class="flow-row__main" ' + (e.kind === 'reclaim' && e.tab ? 'data-go="' + esc(e.tab) + '"' : 'data-open="' + esc(e.ref.c + ':' + e.ref.id) + '"') + '><b>' + esc(e.label) + '</b><em>' + esc((e.overdue ? 'Overdue · ' : '') + (e.sub || '')) + '</em></button>' +
          '<span class="flow-row__amt">' + esc(money(e.amount, { sign: true })) + '</span><span class="flow-row__after' + (e.after < 0 ? ' is-neg' : '') + '">' + esc(money(e.after)) + '</span></li>').join('') + '</ul></li>').join('') + '</ol>'
        : '<div class="panel__body"><p class="muted">Nothing expected in this period yet. Add your income, bills and payment schedules and I’ll plan around them.</p></div>') +
      '<footer class="panel__foot ahead__add"><button type="button" class="btn btn--sm btn--ghost" data-add-income>' + icon('in') + 'Expected income</button>' +
      '<button type="button" class="btn btn--sm btn--ghost" data-add-bill>' + icon('bills') + 'A bill</button>' +
      '<button type="button" class="btn btn--sm btn--ghost" data-add-schedule>' + icon('card') + 'Klarna or PayPal schedule</button></footer>' +
      '</section>';
  }

  /* Money your employer owes you that the plan leaves out: things not sent yet, and things sent that are
     taking longer than usual to come back. One tap to send them. */
  function reclaimNote(plan) {
    const rc = plan.reclaimNotCounted;
    if (!rc || !(rc.total > 0 || rc.confirmTotal > 0)) return '';
    const c = co(store.state);
    let text;
    if (rc.toSendTotal > 0 && rc.lateTotal > 0) text = money(rc.total) + ' ' + c + ' owes you isn’t counted here: ' + money(rc.toSendTotal) + ' you haven’t sent yet, and ' + money(rc.lateTotal) + ' that’s taking longer than usual to come back.';
    else if (rc.toSendTotal > 0) text = money(rc.toSendTotal) + ' ' + c + ' owes you isn’t counted until you send it.';
    else if (rc.lateTotal > 0) text = money(rc.lateTotal) + ' you sent ' + c + ' isn’t counted here, because it’s taking longer than usual to come back.';
    else text = '';
    // Paid back already, but not ticked off: it's in your balance, so it isn't counted again as still to come.
    if (rc.confirmTotal > 0) text = (text ? text + ' ' : '') + money(rc.confirmTotal) + ' from ' + c + ' has come in already. Confirm what it was for in Get paid back.';
    const btn = rc.toSendTotal > 0
      ? '<button type="button" class="btn btn--sm btn--soft" data-send-back>' + icon('send') + esc('Send to ' + c) + '</button>'
      : '<button type="button" class="btn btn--sm btn--ghost" data-go="work-back">Get paid back' + icon('chevron') + '</button>';
    return '<p class="note-line note-line--back">' + icon('coin') + '<span>' + esc(text) + '</span>' + btn + '</p>';
  }

  /* The opening line, as HTML: each figure kept on one line so a sign never wraps away from its amount. */
  function summaryLine(s, t) {
    const plan = GU.forecast.plan(s, { to: GU.forecast.monthEnd(t) });
    if (!plan.known) return esc('Add your balances, income and bills and I’ll show you where you’re heading.');
    const m = (n) => '<span class="nowrap">' + esc(money(n)) + '</span>';
    const incomes = plan.events.filter((e) => e.kind === 'income').map((e) => e.label);
    const owedIn = sum(plan.events.filter((e) => e.kind === 'owed'), (e) => e.amount);
    const names = Array.from(new Set(incomes));
    const list = names.length > 1 ? names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1] : names[0];
    const lowAcct = plan.accounts.filter((a) => a.low < -a.limit)[0];
    const back = GU.workMoney && GU.workMoney.dueBack ? GU.workMoney.dueBack(s).total : 0;
    const backText = back > 0 ? m(back) + esc(' due back from ' + co(s)) : '';
    return (plan.start < 0 ? 'You’re ' + m(-plan.start) + ' overdrawn across your accounts' : 'You have ' + m(plan.start) + ' across your accounts') +
      (list ? ', with ' + esc(list) + ' still to come this month' : '') +
      (owedIn ? (list ? ', plus ' : ', with ') + m(owedIn) + ' due to you on invoices' : '') +
      (backText ? (owedIn ? ' and ' : list ? ', plus ' : ', with ') + backText : '') + '. ' +
      'By ' + esc(fmtDate(plan.to, { short: true })) + ' you should have about ' + m(plan.end) + '.' +
      (lowAcct ? ' Watch ' + esc(lowAcct.name) + ': it would go past its overdraft on ' + esc(fmtDate(lowAcct.lowDate, { short: true })) + '.' : '');
  }

  function listCard(title, items, emptyText) {
    if (!items.length) return emptyText ? '<section class="side-card"><h2>' + esc(title) + '</h2><p class="muted">' + esc(emptyText) + '</p></section>' : '';
    return '<section class="side-card"><h2>' + esc(title) + '</h2><ul class="side-list">' + items.slice(0, 6).map((a, i) =>
      '<li><button type="button" data-side="' + esc(title) + ':' + i + '">' +
      (a.level ? '<span class="dot dot--' + a.level + '">' + icon(a.level === 'info' ? 'info' : 'alert') + '</span>' : '<span class="dot">' + icon('clock') + '</span>') +
      '<span><b>' + esc(a.title) + '</b><em>' + esc(a.detail || '') + '</em></span></button>' +
      (a.dismiss ? '<button type="button" class="icon-btn icon-btn--sm side-x" data-gaps-dismiss="' + esc(a.dismiss.join('|')) + '" aria-label="Not now" data-tip="Not now">' + icon('x') + '</button>' : '') + '</li>').join('') + '</ul></section>';
  }

  /* Klarna, PayPal and the like without a payment schedule yet. */
  function scheduleCard(s) {
    const missing = (s.debts || []).filter((d) => !d.closed && d.type === 'Buy now pay later' && !GU.debts.summary(s, d).scheduled);
    const spotted = GU.debts.spotted(s).filter((x) => x.type === 'Buy now pay later' && daysUntil(x.last) > -45);
    const names = Array.from(new Set(missing.map((d) => d.lender || d.name).concat(spotted.map((x) => x.lender)))).filter((n) => n !== 'Monzo Flex' || missing.some((d) => (d.lender || d.name) === n));
    if (!names.length) return '';
    return '<section class="side-card side-card--ask"><h2>Add your payment schedules</h2><p class="side-card__foot">So the plan includes every instalment on the right day. Paste the list or add a screenshot from the app.</p>' +
      '<div class="side-card__btns">' + names.slice(0, 3).map((n) => '<button type="button" class="btn btn--sm" data-schedule-for="' + esc(n) + '">' + icon('card') + esc(n) + '</button>').join('') + '</div></section>';
  }

  function render(root) {
    const s = store.state;
    const t = today();
    // Home things only: work has its own checks on Work › Overview.
    const mine = (i) => i.part !== 'work';
    const items = GU.agenda.timeline(s, horizon, 'home').filter((i) => mine(i) && !['bill', 'income', 'invoice', 'owed', 'debt', 'ktk', 'reclaim'].includes(i.kind));
    const attention = GU.agenda.attention(s).filter((a) => mine(a) && !/need a category/.test(a.title));
    const waiting = GU.agenda.waiting(s).filter(mine);

    root.innerHTML =
      (GU.parts && GU.parts.doorsHTML ? GU.parts.doorsHTML(s, 'home') : '') +
      '<div class="brief">' +
      '<div class="brief__feed">' +
      '<p class="eyebrow">Home · ' + esc(fmtLongDate(t)) + '</p>' +
      '<h1 class="brief__title">' + esc(greeting() + (s.settings.name ? ', ' + s.settings.name : '')) + '. Here’s where you stand.</h1>' +
      '<p class="brief__summary">' + summaryLine(s, t) + '</p>' +
      '<form class="capture" data-capture>' +
      '<label class="capture__field">' + icon('plus') + '<input type="text" name="task" id="quick-task" autocomplete="off" placeholder="Tell me anything, e.g. Renew car tax on Friday" aria-label="Tell your assistant anything"></label>' +
      '<div class="capture__btns"><button type="submit" class="btn btn--soft">Add</button>' +
      '<button type="button" class="btn btn--primary" data-upload>' + icon('camera') + 'Upload</button></div>' +
      '</form>' +
      nowHTML(s) +
      aheadHTML(s, t) +
      '<section class="later"><header class="sec-head"><h2>Also coming up</h2><span class="muted">tasks, documents and deadlines</span></header>' +
      timelineHTML(items) +
      '<button type="button" class="btn btn--ghost brief__more" data-horizon>' + (horizon === 14 ? 'Show the next 30 days' : 'Show the next 14 days only') + '</button></section>' +
      '</div>' +
      '<aside class="brief__aside">' +
      listCard('Needs attention', attention, 'Nothing needs your attention right now.') +
      scheduleCard(s) +
      listCard('Waiting on', waiting) +
      '</aside></div>' +
      '<div class="dropcover" hidden><div>' + icon('upload') + '<b>Drop to let me sort it</b></div></div>';

    root.querySelectorAll('input[name="ahead-range"]').forEach((el) => el.addEventListener('change', () => {
      range = el.value;
      GU.render();
    }));
    const form = root.querySelector('[data-capture]');
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const raw = form.elements.task.value;
      if (!raw.trim()) {
        GU.tabs.todos.create();
        return;
      }
      form.elements.task.value = '';
      GU.inbox.add({ note: raw });
      setTimeout(() => {
        const inp = document.getElementById('quick-task');
        if (inp) inp.focus();
      }, 0);
    });
    root.querySelector('[data-upload]').addEventListener('click', async () => {
      const files = await GU.ui.pickFiles();
      if (files.length) GU.inbox.add({ files });
    });
    root.querySelector('[data-horizon]').addEventListener('click', () => {
      horizon = horizon === 14 ? 30 : 14;
      GU.render();
    });

    root.addEventListener('click', (e) => {
      const open = e.target.closest('[data-open]');
      if (open) {
        const [c, id] = open.dataset.open.split(':');
        GU.view.open({ c, id });
        return;
      }
      const act = e.target.closest('[data-act]');
      if (act) {
        const [c, id] = act.dataset.ref.split(':');
        if (act.dataset.act === 'done') GU.tabs.todos.complete(id);
        else if (act.dataset.act === 'ktkpaid') {
          if (GU.workMoney && GU.workMoney.markKtkPaid) GU.workMoney.markKtkPaid(id);
        } else if (c === 'bills') GU.tabs.bills.markPaid(id);
        else if (c === 'paperwork') GU.tabs.receipts.markPaid(id);
        return;
      }
      const side = e.target.closest('[data-side]');
      if (side) {
        const [title, i] = side.dataset.side.split(':');
        const a = (title === 'Waiting on' ? waiting : attention)[+i];
        if (a.account) GU.tabs.transactions.showAccount(a.account);
        else if (a.ref) GU.view.open(a.ref);
        else GU.view.go(a.tab, a.go ? { filter: a.go } : null);
        return;
      }
      if (e.target.closest('[data-balances]')) return GU.tabs.transactions.updateBalances();
      if (e.target.closest('[data-owed]')) return GU.tabs.receipts.showOwed ? GU.tabs.receipts.showOwed() : GU.view.go('receipts');
      if (e.target.closest('[data-claims]')) return GU.view.go(GU.tabs['work-back'] ? 'work-back' : 'work');
      if (e.target.closest('[data-send-back]')) {
        if (GU.payback && GU.payback.sendDialog) return GU.payback.sendDialog();
        return GU.view.go(GU.tabs['work-back'] ? 'work-back' : 'work');
      }
      const go = e.target.closest('[data-go]');
      if (go) return GU.view.go(GU.tabs[go.dataset.go] ? go.dataset.go : 'work');
      if (e.target.closest('[data-add-income]')) return GU.tabs.incomings.createSource();
      if (e.target.closest('[data-add-bill]')) return GU.tabs.bills.create();
      if (e.target.closest('[data-add-schedule]')) return GU.tabs.debts.scheduleDialog('');
      const sf = e.target.closest('[data-schedule-for]');
      if (sf) return GU.tabs.debts.scheduleDialog(sf.dataset.scheduleFor);
      const acct = e.target.closest('[data-account]');
      if (acct) {
        e.preventDefault();
        GU.tabs.transactions.showAccount(acct.dataset.account);
        return;
      }
      const view = e.target.closest('[data-view]');
      if (view) {
        const p = store.find('paperwork', view.dataset.view);
        if (p) GU.ui.viewFiles(p.files, 0, p.title);
      }
    });

    const cover = root.querySelector('.dropcover');
    let depth = 0;
    root.addEventListener('dragenter', (e) => {
      if (!e.dataTransfer || !Array.from(e.dataTransfer.types || []).includes('Files')) return;
      depth++;
      cover.hidden = false;
    });
    root.addEventListener('dragleave', () => {
      depth = Math.max(0, depth - 1);
      if (!depth) cover.hidden = true;
    });
    root.addEventListener('dragover', (e) => e.preventDefault());
    root.addEventListener('drop', (e) => {
      e.preventDefault();
      depth = 0;
      cover.hidden = true;
      GU.ui.filesFromDrop(e.dataTransfer).then((files) => files.length && GU.inbox.add({ files }));
    });
  }

  GU.tabs.today = { label: 'Home overview', short: 'Overview', icon: 'today', part: 'home', render, parseQuickTask };
})();
