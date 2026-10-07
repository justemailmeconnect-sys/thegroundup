/* The Ground Up: cost forecast. Takes the ideas you want to spend on, and works out from your money ahead
   (income, bills, debts and instalments, plus your usual everyday spending) when each one could be done
   without your accounts dropping below the amount you want to keep, and which account it could come from.
   Work ideas the business pays for aren't planned on your money (see ktkFund). Ones you pay for and get
   back are a dip that comes back after the business's usual wait. */
(function () {
  'use strict';
  const GU = window.GU;
  const { today, addDays, addMonths, shiftMonth, round2, sum, toDays, money } = GU.util;
  const F = GU.finance;

  const DEFAULTS = { buffer: 0, overdraft: false, months: 12, everyday: null };
  const PRIORITY = { must: 0, should: 1, could: 2 };
  const settings = (s) => Object.assign({}, DEFAULTS, s.settings.costForecast || {});
  const isOpen = (i) => i.status !== 'done' && i.status !== 'dropped';

  /* ---------- whose money ---------- */
  /* Ideas were first made in Work, so one with no context is a work idea. */
  const ideaPart = (i) => (GU.parts && GU.parts.ideaPart ? GU.parts.ideaPart(i) : i && i.context === 'home' ? 'home' : 'work');
  /* For a work idea: 'company' (the business pays), 'me' (you pay, it pays you back) or null (not sorted yet).
     Your own ideas are always your money, so null. */
  function ideaPayer(i) {
    if (!i || ideaPart(i) !== 'work') return null;
    const p = GU.workMoney ? GU.workMoney.payerOf(i, 'costIdeas') : i.payer;
    return p === 'company' || p === 'me' ? p : null;
  }
  const companyPays = (i) => ideaPayer(i) === 'company';
  /* Paid with your money and paid back: the cost only dips your balance until it comes back. */
  const fronted = (i) => ideaPayer(i) === 'me';
  const repayDays = (s) => Math.max(1, Math.round(GU.workMoney ? GU.workMoney.employer(s).repayDays : 14));

  /* What everyday spending (food, fuel, shopping…) comes to in a usual month: money out over the last 3 full
     months of statements, leaving out bills, debt and instalment payments, savings and moves between your accounts. */
  function everydayEstimate(s) {
    const end = GU.debts.dataEnd(s);
    const endMonth = end.slice(0, 7);
    const last = end.slice(8) >= '28' ? endMonth : shiftMonth(endMonth, -1);
    const months = [shiftMonth(last, -2), shiftMonth(last, -1), last].filter((m) => s.transactions.some((t) => t.date.slice(0, 7) === m));
    if (!months.length) return null;
    const skip = new Set();
    for (const d of s.debts || []) for (const p of GU.debts.payments(s, d)) skip.add(p.id);
    // A bill's name as whole words in the statement line ("hartley lettings" in "HARTLEY LETTINGS RENT").
    const bills = Array.from(new Set((s.bills || []).flatMap((b) => [b.foundKey, GU.recurring.keyOf(b.payee || ''), GU.recurring.keyOf(b.name || '')]).filter(Boolean)));
    const isBill = (t) => {
      const k = ' ' + GU.recurring.keyOf(t.description || '') + ' ';
      return bills.some((b) => k.includes(' ' + b + ' '));
    };
    const byAccount = {};
    let total = 0;
    for (const t of s.transactions) {
      if (!(t.amount < 0) || !months.includes(t.date.slice(0, 7)) || F.isTransfer(t) || skip.has(t.id)) continue;
      if (F.isWork && F.isWork(t)) continue; // bought for work and paid back: not your everyday spending
      if (t.category === 'Debt repayments' || t.category === 'Savings & investments') continue;
      if (isBill(t)) continue;
      total += -t.amount;
      byAccount[t.account] = (byAccount[t.account] || 0) - t.amount;
    }
    const share = {};
    for (const [a, v] of Object.entries(byAccount)) share[a] = total ? v / total : 0;
    return { monthly: round2(total / months.length), months, share };
  }

  /* Day-by-day balances ahead, overall and for each account, before any ideas. */
  function baseline(s) {
    const cfg = settings(s);
    const t = today();
    const to = addDays(addMonths(t, cfg.months), -1);
    const plan = GU.forecast.plan(s, { from: t, to });
    const est = everydayEstimate(s);
    const everyday = cfg.everyday != null && cfg.everyday !== '' ? Number(cfg.everyday) : est ? est.monthly : 0;
    const perDay = (everyday * 12) / 365;
    const n = plan.days.length;
    const total = plan.days.map((d, i) => round2(d.value - perDay * i));
    const accounts = plan.accounts.map((a) => {
      const share = est && est.share[a.id] != null ? est.share[a.id] : 1 / Math.max(1, plan.accounts.length);
      const ev = plan.events.filter((e) => e.account === a.id);
      const vals = [];
      let bal = a.start;
      for (let i = 0; i < n; i++) {
        const day = plan.days[i].date;
        for (const e of ev) if (e.date === day) bal += e.amount;
        vals.push(round2(bal - perDay * share * i));
      }
      return { id: a.id, name: a.name, limit: a.limit || 0, vals };
    });
    const floor = cfg.buffer - (cfg.overdraft ? plan.overdraft : 0);
    return { cfg, plan, dates: plan.days.map((d) => d.date), total, accounts, everyday, est, perDay, floor, known: plan.known };
  }

  /* The lowest the balance gets from each day to the end. */
  function suffixMin(vals) {
    const out = new Array(vals.length);
    let m = Infinity;
    for (let i = vals.length - 1; i >= 0; i--) {
      m = Math.min(m, vals[i]);
      out[i] = m;
    }
    return out;
  }
  const indexOf = (dates, date) => {
    if (!date || date <= dates[0]) return 0;
    const i = dates.indexOf(date);
    return i >= 0 ? i : date > dates[dates.length - 1] ? dates.length : 0;
  };

  /* Places each idea, most important first, on the earliest day it fits. Ideas with a fixed date go where they're booked.
     Ideas the business pays for are left out. One you pay for and get back only counts from its day until it's
     back (its monthly cost belongs in a work bill instead). */
  let cache = null;
  function schedule(s) {
    const key = (GU.store.rev || 0) + '|' + today();
    if (cache && cache.key === key && cache.s === s) return cache.out;
    const out = work(s);
    cache = { key, s, out };
    return out;
  }
  function work(s) {
    const b = baseline(s);
    const n = b.total.length;
    const ser = b.total.slice();
    const acc = b.accounts.map((a) => ({ id: a.id, name: a.name, vals: a.vals.slice() }));
    const back = repayDays(s);
    const ideas = (s.costIdeas || []).filter((i) => isOpen(i) && !companyPays(i)).sort((x, y) =>
      (y.plannedDate ? 1 : 0) - (x.plannedDate ? 1 : 0) ||
      (PRIORITY[x.priority] ?? 1) - (PRIORITY[y.priority] ?? 1) ||
      (x.wantBy || '9999').localeCompare(y.wantBy || '9999') ||
      (x.created || '').localeCompare(y.created || ''));
    const results = [];
    // The last day (not included) an idea placed on day d still costs you: the end, or when a dip is paid back.
    const until = (d, dip) => (dip ? Math.min(n, d + back) : n);
    const lowestFrom = (vals, d, cost, perDay, dip) => {
      let m = Infinity;
      for (let t = d, end = until(d, dip); t < end; t++) m = Math.min(m, vals[t] - cost - perDay * (t - d));
      return m;
    };
    for (const idea of ideas) {
      const dip = fronted(idea);
      const cost = Math.abs(Number(idea.cost) || 0);
      const monthly = Math.abs(Number(idea.monthly) || 0);
      const perDay = dip ? 0 : (monthly * 12) / 365;
      const lo = Math.min(n - 1, indexOf(b.dates, idea.notBefore));
      let d = -1;
      let short = 0;
      let fixed = false;
      if (idea.plannedDate) {
        fixed = true;
        d = Math.min(n - 1, indexOf(b.dates, idea.plannedDate));
        short = Math.max(0, round2(b.floor - lowestFrom(ser, d, cost, perDay, dip)));
      } else if (dip) {
        for (let t = lo; t < n; t++) if (lowestFrom(ser, t, cost, 0, true) >= b.floor) {
          d = t;
          break;
        }
      } else if (!perDay) {
        const sm = suffixMin(ser);
        for (let t = lo; t < n; t++) if (sm[t] - cost >= b.floor) {
          d = t;
          break;
        }
      } else {
        for (let t = lo; t < n; t++) if (lowestFrom(ser, t, cost, perDay) >= b.floor) {
          d = t;
          break;
        }
      }
      const part = ideaPart(idea);
      const r = { idea, cost, monthly, fixed, short, date: null, account: null, accountRoom: null, onTime: null, lateDays: 0, shortfall: 0,
        part, context: part, payer: ideaPayer(idea), dip, back: null, note: dip && monthly ? 'The ' + money(monthly) + ' a month isn’t planned here. Add it as a work bill.' : '' };
      if (d >= 0 && d < n) {
        const end = until(d, dip);
        for (let t = d; t < end; t++) ser[t] = round2(ser[t] - cost - perDay * (t - d));
        // Where from: the account with the most room from that day on (until it's back, for a dip).
        let best = null;
        for (const a of acc) {
          const room = Math.min(...a.vals.slice(d, end));
          if (!best || room > best.room) best = { a, room };
        }
        if (best) {
          for (let t = d; t < end; t++) best.a.vals[t] = round2(best.a.vals[t] - cost - perDay * (t - d));
          r.account = best.a.name;
          r.accountRoom = round2(best.room);
        }
        r.date = b.dates[d];
        if (dip) r.back = addDays(r.date, back);
        if (idea.wantBy) {
          r.onTime = r.date <= idea.wantBy;
          r.lateDays = r.onTime ? 0 : toDays(r.date) - toDays(idea.wantBy);
        }
      } else {
        // Doesn't fit in the time ahead: how much more it would need.
        let best = -Infinity;
        if (dip) {
          for (let t = lo; t < n; t++) best = Math.max(best, lowestFrom(ser, t, 0, 0, true) - b.floor);
        } else {
          const sm = suffixMin(ser);
          for (let t = lo; t < n; t++) best = Math.max(best, sm[t] - b.floor - (monthly ? perDay * (n - 1 - t) : 0));
        }
        r.shortfall = round2(Math.max(0, cost - Math.max(0, best)));
      }
      results.push(r);
    }
    // Room to spend: from the start of each month, the most you could spend and still never drop below what you keep.
    const sm = suffixMin(ser);
    const months = [];
    for (let i = 0; i < n; i++) {
      const m = b.dates[i].slice(0, 7);
      if (!months.length || months[months.length - 1].key !== m) months.push({ key: m, date: b.dates[i], room: round2(Math.max(0, sm[i] - b.floor)) });
    }
    const baseSm = suffixMin(b.total);
    const spare = n > 1 ? round2(((b.total[n - 1] - b.total[0]) / (n - 1)) * (365 / 12)) : 0;
    return {
      base: b, after: ser, results, months,
      freeNow: round2(Math.max(0, baseSm[0] - b.floor)),
      freeNowAfter: round2(Math.max(0, sm[0] - b.floor)),
      spare,
      outstanding: round2(sum(ideas, (i) => Math.abs(Number(i.cost) || 0))),
      fronting: results.filter((r) => r.dip),
      repayDays: back,
      allBy: results.length && results.every((r) => r.date) ? results.reduce((m, r) => (r.date > m ? r.date : m), '') : null,
      notFitting: results.filter((r) => !r.date).length,
    };
  }

  /* Work ideas the business pays for: not tested against your money (its balance isn't known), just listed
     with what they cost, soonest wanted first, and grouped by the month they're wanted ('' for no date). */
  function ktkFund(s) {
    s = s || GU.store.state;
    const items = ((s && s.costIdeas) || []).filter((i) => isOpen(i) && companyPays(i)).map((i) => ({
      idea: i,
      cost: Math.abs(Number(i.cost) || 0),
      monthly: Math.abs(Number(i.monthly) || 0),
      date: i.plannedDate || i.wantBy || '',
      booked: !!i.plannedDate,
    })).sort((x, y) => (x.date || '9999').localeCompare(y.date || '9999') ||
      (PRIORITY[x.idea.priority] ?? 1) - (PRIORITY[y.idea.priority] ?? 1) ||
      (x.idea.created || '').localeCompare(y.idea.created || ''));
    const months = [];
    for (const x of items) {
      const key = x.date.slice(0, 7);
      let m = months.find((g) => g.key === key);
      if (!m) months.push((m = { key, items: [], total: 0, monthly: 0 }));
      m.items.push(x);
      m.total = round2(m.total + x.cost);
      m.monthly = round2(m.monthly + x.monthly);
    }
    return { items, count: items.length, total: round2(sum(items, (x) => x.cost)), monthly: round2(sum(items, (x) => x.monthly)), months };
  }

  GU.costs = { settings, everydayEstimate, schedule, isOpen, PRIORITY, ktkFund, ideaPart, ideaPayer, companyPays, fronted };
})();
