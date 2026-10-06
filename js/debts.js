/* The Ground Up: account balances and debts.
   Balances come from the running balance on your imported statements (or a balance you set yourself).
   Debt payments are found in your bank transactions by the lender's name. */
(function () {
  'use strict';
  const GU = window.GU;
  const { today, addDays, addMonths, daysUntil, toDays, round2, sum } = GU.util;

  /* ---------- balances ---------- */
  function accountTx(state, accountId) {
    const list = [];
    state.transactions.forEach((t, i) => {
      if (t.account === accountId) list.push({ t, i });
    });
    return list;
  }

  /* Of several transactions with balances on one day, the last one is the one no other follows on from. */
  function lastOfDay(list) {
    const follows = new Set();
    for (const y of list) for (const x of list) if (x !== y && Math.abs(round2(y.t.balance - y.t.amount) - x.t.balance) < 0.005) follows.add(x);
    const ends = list.filter((x) => !follows.has(x));
    return (ends.length ? ends : list).reduce((m, x) => (x.i > m.i ? x : m));
  }

  /* The latest balance we can work out for an account, or null if we can't yet. */
  function accountBalance(state, accountId, statementOnly) {
    const acct = state.accounts.find((a) => a.id === accountId) || {};
    const txs = accountTx(state, accountId);
    const withBal = txs.filter((x) => typeof x.t.balance === 'number');
    const lastDate = withBal.reduce((m, x) => (x.t.date > m ? x.t.date : m), '');
    const best = lastDate ? lastOfDay(withBal.filter((x) => x.t.date === lastDate)) : null;
    const anchor = !statementOnly && acct.balanceAnchor && typeof acct.balanceAnchor.amount === 'number' ? acct.balanceAnchor : null;
    let balance;
    let base;
    let source;
    if (best && (!anchor || best.t.date > anchor.date)) {
      balance = best.t.balance;
      base = best.t.date;
      source = 'statement';
      // Anything added later by hand, or imported without a balance, moves it on.
      for (const x of txs) if (x.t.date > base && typeof x.t.balance !== 'number') balance += x.t.amount;
    } else if (anchor) {
      balance = anchor.amount;
      base = anchor.date;
      source = 'you';
      for (const x of txs) if (x.t.date > base) balance += x.t.amount;
    } else return null;
    const latest = txs.reduce((m, x) => (x.t.date > m ? x.t.date : m), base);
    const limit = Number(acct.overdraftLimit) || 0;
    return { balance: round2(balance), asOf: latest, source, overdraftLimit: limit, available: round2(balance + limit), staleDays: Math.max(0, -daysUntil(latest)) };
  }

  /* Every account with what we know about its balance. */
  function accounts(state) {
    return state.accounts.map((a) => ({ account: a, info: accountBalance(state, a.id), count: state.transactions.filter((t) => t.account === a.id).length }));
  }

  /* End-of-day balances for the last `days` days your statements cover, worked backwards from the latest balance.
     A balance you typed in after a gap in your statements isn't drawn back across that gap. */
  function balanceSeries(state, accountId, days) {
    const txs = accountTx(state, accountId);
    let cur = accountBalance(state, accountId);
    if (!cur || !txs.length) return [];
    const lastTx = txs.reduce((m, x) => (x.t.date > m ? x.t.date : m), '');
    const anchor = (state.accounts.find((a) => a.id === accountId) || {}).balanceAnchor;
    if (cur.source === 'you' && anchor && toDays(anchor.date) - toDays(lastTx) > 3) {
      cur = accountBalance(state, accountId, true);
      if (!cur) return [];
    }
    const byDay = new Map();
    for (const { t } of txs) byDay.set(t.date, (byDay.get(t.date) || 0) + t.amount);
    const first = Array.from(byDay.keys()).sort()[0] || cur.asOf;
    const start = addDays(cur.asOf, -(days || 90));
    const out = [];
    let bal = cur.balance;
    for (let d = cur.asOf; d >= start && d >= addDays(first, -1); d = addDays(d, -1)) {
      out.push({ date: d, value: round2(bal) });
      bal -= byDay.get(d) || 0;
    }
    return out.reverse();
  }

  /* ---------- debts ---------- */
  const TYPES = ['Credit card', 'Loan', 'Buy now pay later', 'Car finance', 'Store or catalogue card', 'Overdraft', 'Mortgage', 'Student loan', 'Owed to a person', 'Other'];
  /* Lenders and how they appear on bank statements. */
  const LENDERS = [
    { name: 'Klarna', type: 'Buy now pay later', keys: ['klarna'] },
    { name: 'PayPal Pay in 3', type: 'Buy now pay later', keys: ['payin3', 'pay in 3', 'paypal pay in'] },
    { name: 'PayPal Credit', type: 'Credit card', keys: ['paypal credit', 'ppcredit'], borrows: true },
    { name: 'Clearpay', type: 'Buy now pay later', keys: ['clearpay'] },
    { name: 'Zilch', type: 'Buy now pay later', keys: ['zilch'] },
    { name: 'Laybuy', type: 'Buy now pay later', keys: ['laybuy'] },
    { name: 'Monzo Flex', type: 'Buy now pay later', keys: ['flex'], exact: true, borrows: true },
    { name: 'Barclaycard', type: 'Credit card', keys: ['barclaycard'] },
    { name: 'Capital One', type: 'Credit card', keys: ['capital one', 'capitalone'] },
    { name: 'Vanquis', type: 'Credit card', keys: ['vanquis'] },
    { name: 'Aqua', type: 'Credit card', keys: ['aqua card', 'aqua cc', 'newday aqua'] },
    { name: 'American Express', type: 'Credit card', keys: ['american express', 'amex'] },
    { name: 'MBNA', type: 'Credit card', keys: ['mbna'] },
    { name: 'NewDay', type: 'Credit card', keys: ['newday'] },
    { name: 'Tymit', type: 'Credit card', keys: ['tymit'] },
    { name: 'Tesco Bank', type: 'Credit card', keys: ['tesco bank'] },
    { name: 'Zopa', type: 'Loan', keys: ['zopa'], borrows: true },
    { name: 'Lendable', type: 'Loan', keys: ['lendable'], borrows: true },
    { name: 'Moneybarn', type: 'Car finance', keys: ['moneybarn'] },
    { name: 'Close Brothers', type: 'Car finance', keys: ['close brothers', 'close motor'] },
    { name: 'Black Horse', type: 'Car finance', keys: ['black horse'] },
    { name: 'Very', type: 'Store or catalogue card', keys: ['very.co.uk', 'shop direct'] },
    { name: 'Littlewoods', type: 'Store or catalogue card', keys: ['littlewoods'] },
    { name: 'JD Williams', type: 'Store or catalogue card', keys: ['jd williams'] },
    { name: 'Student Loans Company', type: 'Student loan', keys: ['student loan', 'slc '] },
  ];
  function lenderFor(name) {
    const n = String(name || '').toLowerCase();
    return LENDERS.find((l) => n.includes(l.name.toLowerCase()) || l.keys.some((k) => !l.exact && n.includes(k.trim())));
  }
  function keysFor(debt) {
    const l = lenderFor(debt.lender) || lenderFor(debt.name);
    const borrows = debt.type === 'Loan' || (l ? !!l.borrows : false);
    if (debt.match && debt.match.trim()) return { keys: debt.match.split(',').map((k) => k.trim().toLowerCase()).filter(Boolean), exact: false, borrows };
    if (l) return { keys: l.keys, exact: !!l.exact, borrows };
    return { keys: [String(debt.lender || debt.name || '').toLowerCase().trim()].filter((k) => k.length > 2), exact: false, borrows };
  }
  const reEsc = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  function matchesKeys(t, k) {
    const text = (' ' + (t.description || '') + ' ').toLowerCase();
    // Short, common words ("Flex") only count when they are the whole description.
    return k.keys.some((key) => (k.exact ? new RegExp('(^|[^a-z])' + reEsc(key) + '([^a-z]|$)').test(text) && text.trim().length <= key.length + 12 : text.includes(key)));
  }
  /* Money out of your accounts that went to this lender. */
  function payments(state, debt) {
    const k = keysFor(debt);
    if (!k.keys.length) return [];
    return state.transactions.filter((t) => t.amount < 0 && matchesKeys(t, k)).sort((a, b) => b.date.localeCompare(a.date));
  }
  /* Money from the lender into your accounts that added to the debt (a loan paid out, a purchase moved to Flex). */
  function borrowing(state, debt) {
    const k = keysFor(debt);
    if (!k.keys.length || !k.borrows) return [];
    return state.transactions.filter((t) => t.amount > 0 && matchesKeys(t, k)).sort((a, b) => b.date.localeCompare(a.date));
  }

  /* Whole monthly payments made from the first payment date up to `to`. */
  function monthsBetween(from, to) {
    const [y1, m1, d1] = from.split('-').map(Number);
    const [y2, m2, d2] = to.split('-').map(Number);
    return Math.max(0, (y2 - y1) * 12 + (m2 - m1) + (d2 >= d1 ? 1 : 0));
  }

  function monthsToClear(balance, payment, apr) {
    if (!(balance > 0) || !(payment > 0)) return null;
    const r = (Number(apr) || 0) / 100 / 12;
    if (!r) return Math.ceil(balance / payment);
    if (payment <= balance * r) return Infinity;
    return Math.ceil(-Math.log(1 - (r * balance) / payment) / Math.log(1 + r));
  }

  /* The last day your imported statements cover (averages are worked out up to here, not today). */
  function lastData(state) {
    const t = today();
    return state.transactions.reduce((m, x) => (x.date > m && x.date <= t ? x.date : m), '');
  }
  function dataEnd(state) {
    return lastData(state) || today();
  }
  const within = (date, end, days) => date <= end && toDays(end) - toDays(date) < days;

  /* What you usually pay a month: the average of the last three full months since payments began. */
  function usualMonthly(pays, end) {
    if (!pays.length) return 0;
    const endMonth = end.slice(0, 7);
    const firstMonth = pays.reduce((m, p) => (p.date < m ? p.date : m), end).slice(0, 7);
    const months = [];
    for (let k = 1; k <= 3; k++) {
      const m = GU.util.shiftMonth(endMonth, -k);
      if (m >= firstMonth) months.push(m);
    }
    if (!months.length) months.push(endMonth);
    const total = sum(pays.filter((p) => months.includes(p.date.slice(0, 7))), (p) => -p.amount);
    return round2(total / months.length);
  }

  /* Works the balance forward from the figure you gave: payments take it down, new borrowing and interest put it up. */
  function project(debt, pays, borrowed, end) {
    const daily = (Number(debt.apr) || 0) / 100 / 365;
    const since = debt.balanceDate || '';
    const events = pays.concat(borrowed).filter((p) => p.date > since && p.date <= end).sort((a, b) => a.date.localeCompare(b.date));
    let bal = debt.balance;
    let at = since || end;
    let interest = 0;
    const accrue = (to) => {
      const days = toDays(to) - toDays(at);
      if (daily && bal > 0 && days > 0) {
        const add = bal * (Math.pow(1 + daily, days) - 1);
        interest += add;
        bal += add;
      }
      at = to > at ? to : at;
    };
    for (const e of events) {
      accrue(e.date);
      bal = Math.max(0, bal + e.amount);
    }
    if (end > at) accrue(end);
    return { balance: Math.max(0, round2(bal)), interest: round2(interest) };
  }

  function summary(state, debt) {
    const t = today();
    const end = dataEnd(state);
    const pays = payments(state, debt);
    const since = debt.balanceDate || '';
    const paidSince = sum(pays.filter((p) => p.date > since), (p) => -p.amount);
    const borrowed = borrowing(state, debt);
    const borrowedSince = sum(borrowed.filter((p) => p.date > since), (p) => p.amount);
    const month = t.slice(0, 7);
    const paidThisMonth = sum(pays.filter((p) => p.date.slice(0, 7) === month), (p) => -p.amount);
    const monthlyAvg = usualMonthly(pays, end);
    // A fixed-term loan with no balance from a statement: what's left is the payments still to make.
    const byTerm = typeof debt.balance !== 'number' && debt.termMonths > 0 && !!debt.startDate && Number(debt.monthlyPayment) > 0;
    const termLeft = byTerm ? Math.max(0, debt.termMonths - monthsBetween(debt.startDate, end)) : null;
    const balanceKnown = typeof debt.balance === 'number' || byTerm;
    // Only work the balance forward over days your statements cover: no data, no guessing at interest.
    const covered = lastData(state);
    const proj = typeof debt.balance === 'number' ? project(debt, pays, borrowed, covered && covered > (debt.balanceDate || '') ? covered : debt.balanceDate || end) : null;
    const estBalance = proj ? proj.balance : byTerm ? round2(termLeft * debt.monthlyPayment) : null;
    // No balance and no payments for two months: probably a finished plan (Klarna, Pay in 3).
    const quietDays = pays.length ? toDays(end) - toDays(pays[0].date) : null;
    const finished = balanceKnown ? estBalance === 0 : quietDays != null && quietDays > 60;
    const payment = finished ? 0 : Number(debt.monthlyPayment) || monthlyAvg || 0;
    const months = byTerm ? termLeft : estBalance != null ? monthsToClear(estBalance, payment, debt.apr) : null;
    let nextPayment = null;
    const payDay = debt.paymentDay || (byTerm ? +debt.startDate.slice(8, 10) : null);
    if (payDay && !finished && !(byTerm && termLeft === 0)) {
      const day = Math.min(28, Math.max(1, +payDay));
      const thisMonth = t.slice(0, 8) + String(day).padStart(2, '0');
      nextPayment = thisMonth >= t ? thisMonth : addMonths(thisMonth, 1, day);
    } else if (pays.length >= 2 && !finished && quietDays <= 45) {
      const gaps = [];
      for (let i = 1; i < Math.min(pays.length, 8); i++) gaps.push(toDays(pays[i - 1].date) - toDays(pays[i].date));
      gaps.sort((a, b) => a - b);
      const gap = gaps[Math.floor(gaps.length / 2)];
      if (gap >= 6 && gap <= 40) {
        let n = addDays(pays[0].date, gap);
        while (n < t) n = addDays(n, gap);
        nextPayment = n;
      }
    }
    const start = byTerm ? debt.termMonths * debt.monthlyPayment : Number(debt.startBalance) || (balanceKnown ? debt.balance : 0);
    return {
      start, byTerm, finished, quietDays, payments: pays, borrowed, paidSince, borrowedSince, interest: proj ? proj.interest : 0, asOf: end, paidTotal: sum(pays, (p) => -p.amount), paidThisMonth, monthlyAvg, payment, estBalance, balanceKnown, nextPayment,
      lastPayment: pays[0] || null, months, clearBy: months && isFinite(months) ? addMonths(end, months) : null,
      progress: start > 0 && estBalance != null ? Math.min(1, Math.max(0, 1 - estBalance / start)) : null,
    };
  }

  /* Labels the payments to a debt as Debt repayments (and its new borrowing as a refund or transfer).
     Returns the changes so they can be undone. */
  function claim(st, debt) {
    const changed = [];
    for (const t of payments(st, debt)) {
      if (t.category === 'Debt repayments') continue;
      changed.push({ id: t.id, before: t.category });
      t.category = 'Debt repayments';
    }
    const l = lenderFor(debt.lender) || lenderFor(debt.name);
    for (const t of borrowing(st, debt)) {
      const cat = debt.type === 'Loan' ? 'Transfers' : 'Refunds';
      if (t.category === cat || (t.category && t.category !== 'Other income')) continue;
      changed.push({ id: t.id, before: t.category });
      t.category = cat;
      if (!t.notes) t.notes = 'Added to ' + (l ? l.name : debt.name);
    }
    return changed;
  }

  /* Regular payments to lenders you haven't added yet. */
  function spotted(state) {
    const tracked = (state.debts || []).map((d) => keysFor(d));
    const out = [];
    for (const l of LENDERS) {
      const k = { keys: l.keys, exact: !!l.exact };
      if (tracked.some((tk) => tk.keys.some((key) => l.keys.includes(key)))) continue;
      if ((state.settings.ignoredLenders || []).includes(l.name)) continue;
      const pays = state.transactions.filter((t) => t.amount < 0 && matchesKeys(t, k));
      if (pays.length < 2) continue;
      const months = new Set(pays.map((p) => p.date.slice(0, 7))).size;
      const end = dataEnd(state);
      out.push({ lender: l.name, type: l.type, count: pays.length, months, total: sum(pays, (p) => -p.amount), last: pays.reduce((m, p) => (p.date > m ? p.date : m), ''), monthlyAvg: usualMonthly(pays, end) });
    }
    return out.sort((a, b) => b.total - a.total);
  }

  /* Overdrafts are debts too: any account below zero. */
  function overdrafts(state) {
    const out = [];
    for (const a of state.accounts) {
      const b = accountBalance(state, a.id);
      if (!b || b.balance >= 0) continue;
      const fees = state.transactions.filter((t) => t.account === a.id && t.amount < 0 && /overdraft|interest charge/i.test(t.description) && within(t.date, b.asOf, 91));
      out.push({ account: a, used: -b.balance, limit: b.overdraftLimit, asOf: b.asOf, fees90: sum(fees, (t) => -t.amount) });
    }
    return out;
  }

  function totals(state) {
    const list = (state.debts || []).filter((d) => !d.closed).map((d) => ({ d, s: summary(state, d) }));
    const od = overdrafts(state);
    const owed = sum(list, (x) => x.s.estBalance || 0) + sum(od, (o) => o.used);
    const unknown = list.filter((x) => !x.s.balanceKnown && !x.s.finished).length;
    const monthly = sum(list, (x) => x.s.payment || 0);
    const clear = list.map((x) => x.s.clearBy).filter(Boolean).sort();
    const end = dataEnd(state);
    const paid90 = sum(list, (x) => sum(x.s.payments.filter((p) => within(p.date, end, 91)), (p) => -p.amount));
    return { owed: round2(owed), monthly: round2(monthly), paid90: round2(paid90), dataEnd: end, clearBy: clear.length && !list.some((x) => x.s.months === Infinity) ? clear[clear.length - 1] : null, count: list.length + od.length, unknown, never: list.some((x) => x.s.months === Infinity) };
  }

  /* Debt payments expected between today and `to` (for the Today timeline). */
  function upcoming(state, to) {
    const out = [];
    for (const d of state.debts || []) {
      if (d.closed) continue;
      const s = summary(state, d);
      if (!s.nextPayment || s.nextPayment > to || s.finished) continue;
      out.push({ debt: d, date: s.nextPayment, amount: Number(d.monthlyPayment) || (s.lastPayment ? -s.lastPayment.amount : 0) });
    }
    return out;
  }

  GU.money = { accountBalance, accounts, balanceSeries };
  GU.debts = { dataEnd, TYPES, LENDERS, lenderFor, keysFor, payments, borrowing, summary, claim, spotted, overdrafts, totals, upcoming, monthsToClear };
})();
