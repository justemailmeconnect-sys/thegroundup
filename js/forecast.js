/* The Ground Up: what's coming. Starting from what's in your accounts now, adds the income you expect and
   takes off bills, debt payments, instalments and invoices as they fall due, so you can see where you'll be. */
(function () {
  'use strict';
  const GU = window.GU;
  const { today, addDays, addMonths, round2, sum } = GU.util;
  const F = GU.finance;

  const monthEnd = (iso) => addDays(addMonths(iso.slice(0, 8) + '01', 1), -1);

  /* Everything expected to come in or go out from `from` to `to`, oldest first. */
  function events(state, from, to) {
    const out = [];
    for (const s of state.incomeSources || []) {
      if (!s.nextDate || s.active === false) continue;
      for (const d of F.occurrences(s.nextDate, s.frequency, s.anchorDay, from, to)) {
        out.push({ date: d, amount: Math.abs(Number(s.amount) || 0), label: s.name, sub: s.from || 'Income', kind: 'income', ref: { c: 'incomeSources', id: s.id }, account: s.account });
      }
    }
    for (const b of state.bills || []) {
      if (b.active === false || !b.nextDue) continue;
      if (b.nextDue < from) {
        if (!b.autopay) out.push({ date: from, overdue: true, amount: -b.amount, label: b.name, sub: 'Overdue, pay by hand', kind: 'bill', ref: { c: 'bills', id: b.id }, account: b.account });
        continue;
      }
      for (const d of F.occurrences(b.nextDue, b.frequency, b.anchorDay, from, to)) {
        out.push({ date: d, amount: -b.amount, label: b.name, sub: b.review ? 'Found in your statements, not checked yet' : b.autopay ? b.method || 'Automatic' : 'Pay by hand', review: !!b.review, kind: 'bill', ref: { c: 'bills', id: b.id }, account: b.account });
      }
    }
    for (const d of state.debts || []) {
      if (d.closed) continue;
      const s = GU.debts.summary(state, d);
      const account = d.account || (s.lastPayment && s.lastPayment.account);
      if (s.scheduled) {
        for (const i of s.plan) {
          if (i.date < from || i.date > to) continue;
          out.push({ date: i.date, amount: -i.amount, label: d.name + (i.merchant ? ': ' + i.merchant : ''), sub: i.of ? 'Payment ' + i.n + ' of ' + i.of : 'Instalment', kind: 'debt', ref: { c: 'debts', id: d.id }, account: i.account || account });
        }
        continue;
      }
      if (s.finished) continue;
      // No dates to go on, only a monthly amount: count it at the end of each month, marked as rough.
      if (!s.nextPayment && Number(d.monthlyPayment) > 0) {
        for (let m = from.slice(0, 7); m <= to.slice(0, 7); m = GU.util.shiftMonth(m, 1)) {
          const end = monthEnd(m + '-01');
          if (end < from || end > to) continue;
          out.push({ date: end, amount: -Number(d.monthlyPayment), label: d.name, sub: 'About this much a month. Add the schedule for exact dates', rough: true, kind: 'debt', ref: { c: 'debts', id: d.id }, account });
        }
        continue;
      }
      if (!s.nextPayment || !s.payment) continue;
      for (const dt of F.occurrences(s.nextPayment, 'monthly', +s.nextPayment.slice(8, 10), from, to)) {
        out.push({ date: dt, amount: -s.payment, label: d.name, sub: d.paymentDay ? 'Monthly payment' : 'Roughly, going by what you’ve been paying', rough: !d.paymentDay && !d.monthlyPayment, kind: 'debt', ref: { c: 'debts', id: d.id }, account });
      }
    }
    // Invoices you've sent count on their due date. Late ones aren't counted: there's no telling when they'll come.
    for (const x of F.owedToMe(state)) {
      const p = x.p;
      if (!(x.left > 0) || !p.dueDate || p.dueDate < from || p.dueDate > to) continue;
      out.push({ date: p.dueDate, amount: x.left, label: p.party || p.title, sub: 'Invoice owed to you' + (p.party && p.title ? ': ' + p.title : '') + (x.paid ? ' (the rest of it)' : '') + ', if paid on time', soft: true, kind: 'owed', ref: { c: 'paperwork', id: p.id } });
    }
    for (const p of state.paperwork || []) {
      if (p.kind !== 'invoice-in' || p.status === 'paid' || !p.dueDate || !(p.amount > 0)) continue;
      if (p.dueDate > to) continue;
      out.push({ date: p.dueDate < from ? from : p.dueDate, overdue: p.dueDate < from, amount: -p.amount, label: p.title, sub: 'Invoice to pay' + (p.party ? ' · ' + p.party : ''), kind: 'invoice', ref: { c: 'paperwork', id: p.id } });
    }
    return out.sort((a, b) => a.date.localeCompare(b.date) || b.amount - a.amount);
  }

  /* Where you'll be: running totals overall and for each account, the lowest point and the end figure. */
  function plan(state, opts) {
    opts = opts || {};
    const t = today();
    const from = opts.from || t;
    const to = opts.to || monthEnd(t);
    const accts = GU.money.accounts(state).filter((x) => x.info);
    const start = round2(sum(accts, (x) => x.info.balance));
    const per = {};
    for (const x of accts) per[x.account.id] = { id: x.account.id, name: x.account.name, start: x.info.balance, end: x.info.balance, low: x.info.balance, lowDate: from, limit: x.info.overdraftLimit || 0, asOf: x.info.asOf };
    const ev = events(state, from, to);
    let run = start;
    let low = { date: from, value: start };
    for (const e of ev) {
      run = round2(run + e.amount);
      e.after = run;
      if (run < low.value) low = { date: e.date, value: run };
      const a = per[e.account];
      if (a) {
        a.end = round2(a.end + e.amount);
        if (a.end < a.low) {
          a.low = a.end;
          a.lowDate = e.date;
        }
      }
    }
    const days = [];
    let bal = start;
    for (let d = from, i = 0; d <= to && i < 400; d = addDays(d, 1), i++) {
      bal = round2(bal + sum(ev.filter((e) => e.date === d), (e) => e.amount));
      days.push({ date: d, value: bal });
    }
    const asOf = accts.reduce((m, x) => (!m || x.info.asOf < m ? x.info.asOf : m), '');
    return {
      from, to, start, end: run, low, events: ev, days, asOf,
      income: sum(ev.filter((e) => e.amount > 0), (e) => e.amount),
      spending: sum(ev.filter((e) => e.amount < 0), (e) => -e.amount),
      overdraft: sum(accts, (x) => x.info.overdraftLimit || 0),
      accounts: Object.values(per),
      known: accts.length,
      owedNotCounted: F.owedToMe(state).filter((x) => x.left > 0 && (!x.p.dueDate || x.p.dueDate < from)),
    };
  }

  GU.forecast = { events, plan, monthEnd };
})();
