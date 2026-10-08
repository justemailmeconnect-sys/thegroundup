/* The Ground Up: what's coming. Starting from what's in your accounts now, adds the income you expect and
   takes off bills, debt payments, instalments and invoices as they fall due, so you can see where you'll be.
   Work money runs in two lanes: what the business pays itself is left out, and what you pay for it goes out
   with a soft 'Back from …' coming in later, once it's on its way to being paid back. */
(function () {
  'use strict';
  const GU = window.GU;
  const { today, addDays, addMonths, round2, sum, fmtDate, plural } = GU.util;
  const F = GU.finance;

  const monthEnd = (iso) => addDays(addMonths(iso.slice(0, 8) + '01', 1), -1);

  /* ---------- work money, read through GU.workMoney when it's there ---------- */
  const WM = () => GU.workMoney || null;
  const employerOf = (state) => (WM() ? WM().employer(state) : { set: false, label: 'the company', Label: 'The company', repayDays: 14, payInto: '' });
  const isWorkBill = (b) => (GU.parts && GU.parts.isWorkBill ? GU.parts.isWorkBill(b) : b.context === 'work' || (!b.context && b.category === (F.WORK_OUT || 'Work expenses')));
  const billPayer = (b) => (WM() ? WM().payerOf(b, 'bills') : b.payer === 'company' ? 'company' : 'me');
  /* 'home', 'ktk' (the business pays), 'back' (you pay, get it back) or 'unsorted'. */
  const laneOf = (p) => (WM() ? WM().lane(p, 'paperwork') : p.context === 'work' ? 'unsorted' : 'home');
  const stageOf = (p) => (WM() ? WM().stage(p) : p.claimed ? 'sent' : 'to-send');
  const leftOf = (p) => (WM() ? WM().left(p) : Math.abs(Number(p.amount) || 0));

  /* Claims a repayment already in your bank looks like it's for (waiting for your Yes): that money is in your
     balance already, so it isn't counted as still to come. */
  const awaitingOf = (state) => (WM() && WM().awaiting ? WM().awaiting(state) : { ids: new Set(), rows: [], total: 0 });
  /* Sent claims grouped as they went, each with the day the money should be back. Not counted when that day
     has passed (late) or there's no sent date to go on. */
  function sentPacks(state) {
    const W = WM();
    if (!W) return [];
    const e = employerOf(state);
    const wait = awaitingOf(state).ids;
    return W.packs(state).map((pk) => {
      const items = wait.size ? pk.items.filter((x) => !wait.has(x.p.id)) : pk.items;
      return Object.assign({}, pk, { items, left: items === pk.items ? pk.left : round2(sum(items, (x) => x.left)), due: pk.date ? addDays(pk.date, e.repayDays) : '' });
    }).filter((pk) => pk.left > 0 && pk.items.length);
  }

  /* Whether an invoice you're paying for work is a monthly work bill's payment: a bill you pay with the same
     amount, falling due within 3 days of it, that it belongs to or shares a word with. */
  function billPaysIt(state, p) {
    const words = WM() && WM().words ? WM().words : null;
    const mine = words ? new Set(words((p.party || '') + ' ' + (p.title || ''))) : new Set();
    const amt = Math.abs(Number(p.amount) || 0);
    return (state.bills || []).some((b) => b.active !== false && b.nextDue && isWorkBill(b) && billPayer(b) === 'me' &&
      Math.abs(Math.abs(Number(b.amount) || 0) - amt) < 0.005 &&
      (p.billId === b.id || (words && words([b.name, b.payee, b.foundKey].filter(Boolean).join(' ')).some((w) => mine.has(w)))) &&
      F.occurrences(b.nextDue, b.frequency, b.anchorDay, addDays(p.dueDate, -3), addDays(p.dueDate, 3)).length > 0);
  }

  /* Everything expected to come in or go out from `from` to `to`, oldest first. */
  function events(state, from, to) {
    const out = [];
    for (const s of state.incomeSources || []) {
      if (!s.nextDate || s.active === false) continue;
      for (const d of F.occurrences(s.nextDate, s.frequency, s.anchorDay, from, to)) {
        out.push({ date: d, amount: Math.abs(Number(s.amount) || 0), label: s.name, sub: s.from || 'Income', kind: 'income', ref: { c: 'incomeSources', id: s.id }, account: s.account });
      }
    }
    const emp = employerOf(state);
    /* A soft 'Back from …' when the business should pay you back, if it falls in the period. */
    const reclaim = (date, amount, sub, ref, account, extra) => {
      if (!(amount > 0) || !date || date < from || date > to) return;
      out.push(Object.assign({ date, amount: round2(amount), label: 'Back from ' + emp.label, sub, soft: true, kind: 'reclaim', ref, account: emp.payInto || account }, extra));
    };
    for (const b of state.bills || []) {
      if (b.active === false || !b.nextDue) continue;
      // A work bill the business pays isn't your money. One you pay comes back after its usual wait.
      const work = isWorkBill(b);
      if (work && billPayer(b) !== 'me') continue;
      const ref = { c: 'bills', id: b.id };
      const back = work ? 'Work · ' + emp.Label + ' pays you back' : '';
      const soon = b.name + ', if you send it straight away';
      if (b.nextDue < from) {
        if (!b.autopay) {
          out.push({ date: from, overdue: true, amount: -b.amount, label: b.name, sub: back || 'Pay by hand', kind: 'bill', ref, account: b.account });
          if (work) reclaim(addDays(from, emp.repayDays), b.amount, soon, ref, b.account);
        }
        continue;
      }
      for (const d of F.occurrences(b.nextDue, b.frequency, b.anchorDay, from, to)) {
        out.push({ date: d, amount: -b.amount, label: b.name, sub: back || (b.review ? 'Found in your statements, not checked yet' : b.autopay ? b.method || 'Automatic' : 'Pay by hand'), review: !!b.review, kind: 'bill', ref, account: b.account });
        if (work) reclaim(addDays(d, emp.repayDays), b.amount, soon, ref, b.account);
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
      // Work invoices the business pays (or not sorted yet) are left out. One you pay yourself goes out,
      // and comes back later if you send it straight away.
      const lane = laneOf(p);
      if (lane === 'ktk' || lane === 'unsorted') continue;
      // The invoice for a monthly work bill you pay: the bill's own payment above counts it already.
      if (lane === 'back' && billPaysIt(state, p)) continue;
      const when = p.dueDate < from ? from : p.dueDate;
      const ref = { c: 'paperwork', id: p.id };
      const back = lane === 'back';
      out.push({ date: when, overdue: p.dueDate < from, amount: -p.amount, label: p.title, sub: back ? 'Work · ' + emp.Label + ' pays you back' + (p.party ? ' · ' + p.party : '') : 'Invoice to pay' + (p.party ? ' · ' + p.party : ''), kind: 'invoice', ref });
      if (back && stageOf(p) === 'to-send') reclaim(addDays(when, emp.repayDays), leftOf(p), (p.title || p.party || 'Invoice') + ', if you send it straight away', ref, null, { tab: 'work-back' });
    }
    // Things you've sent to the business: back after its usual wait, if it pays as usual.
    for (const pk of sentPacks(state)) {
      if (!pk.due) continue;
      const one = pk.items.length === 1 ? pk.items[0].p : null;
      const what = one ? one.title || one.party || 'Your claim' : plural(pk.items.length, 'thing');
      reclaim(pk.due, pk.left, what + ' sent ' + fmtDate(pk.date, { short: true }) + ', if ' + emp.label + ' pays as usual', { c: 'paperwork', id: pk.items[0].p.id }, null, { tab: 'work-back', pack: pk.key });
    }
    return out.sort((a, b) => a.date.localeCompare(b.date) || b.amount - a.amount);
  }

  /* What the business owes you that the plan leaves out: things not sent yet, and sent ones that should have
     been paid back before `from`. Counting them would flatter the lowest point. Repayments that have come in but
     wait for your Yes are listed apart (confirm): that money is in your balance already. */
  function reclaimNotCounted(state, from) {
    const W = WM();
    const none = { toSend: [], late: [], confirm: [], toSendTotal: 0, lateTotal: 0, confirmTotal: 0, total: 0, count: 0, oldest: null };
    if (!W) return none;
    const d = W.dueBack(state);
    const wait = awaitingOf(state);
    const late = [];
    for (const pk of sentPacks(state)) if (!pk.due || pk.due < from) for (const x of pk.items) if (x.left > 0) late.push(x);
    const toSend = d.toSend.filter((x) => (x.left > 0 || x.noAmount) && !wait.ids.has(x.p.id));
    const toSendTotal = round2(sum(toSend, (x) => x.left));
    const lateTotal = round2(sum(late, (x) => x.left));
    return { toSend, late, confirm: wait.rows, toSendTotal, lateTotal, confirmTotal: round2(wait.total), total: round2(toSendTotal + lateTotal), count: toSend.length + late.length, oldest: d.oldest };
  }

  /* Where you'll be: running totals overall and for each account, the lowest point and the end figure. */
  function plan(state, opts) {
    opts = opts || {};
    const t = today();
    const from = opts.from || t;
    const to = opts.to || monthEnd(t);
    // A credit card is money you owe (its payments are in the plan already), not money you have.
    const accts = GU.money.accounts(state).filter((x) => x.info && x.account.type !== 'credit');
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
    for (let d = from, i = 0; d <= to && i < 800; d = addDays(d, 1), i++) {
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
      reclaimNotCounted: reclaimNotCounted(state, from),
    };
  }

  GU.forecast = { events, plan, monthEnd, reclaimNotCounted };
})();
