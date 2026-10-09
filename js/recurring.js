/* The Ground Up: finding your bills in your bank statements.
   A monthly bill is a payment to the same company in 3 months in a row on the same day of the month;
   weekly, fortnightly, quarterly and yearly payments are found by their steady spacing. Those still
   going are added to Bills for you to check. Everyday spending (groceries, eating out, travel), savings,
   transfers and debts (they live on the Debts tab) are left out. */
(function () {
  'use strict';
  const GU = window.GU;
  const { today, addDays, toDays, round2, sum } = GU.util;
  const F = GU.finance;

  const SKIP_CATEGORIES = ['Groceries', 'Eating out', 'Transport', 'Shopping', 'Cash', 'Transfers', 'Debt repayments', 'Fees & charges', 'Savings & investments', 'Gifts & donations', 'Personal care', 'Travel'];
  const BILL_CATEGORIES = ['Bills & utilities', 'Housing', 'Insurance', 'Subscriptions', 'Health & fitness', 'Education', 'Family & kids', 'Visa & immigration', 'Work expenses'];
  const SAVINGS = /help to save|moneybox|investment|savings|\bisa\b|premium bonds|vanguard|trading 212|freetrade|nutmeg|chip\b|plum\b|\bpot\b/;
  const PROCESSORS = /^(stripe|paypal|gocardless|sumup|worldpay|checkout|square|sq)$/;
  const NOISE = /\b(gbr|gb|uk|london|ltd|limited|plc|co|com|www|payment|payments|to|on|dd|so|bp|fpo|card|direct|debit|standing|order|ref|reference|mandate|no)\b/g;

  /* The company a payment went to, as a stable key ("O2", "Acme Insurance S", "Fit Gyms"). */
  function parts(desc) {
    const raw = String(desc || '').toLowerCase();
    const [head, ...rest] = raw.split(/\s+·\s+/);
    // Reference codes change every month ("Spotify P1234567BA"): drop any longer word with a digit in it, but keep "O2".
    const clean = (s) => s.replace(/^(crv|sq|sumup|zettle_?|paypal|pp|iz|sp)\s*\*\s*/g, '').replace(/[^a-z0-9&+ ]+/g, ' ').split(' ').filter((w) => !(w.length > 3 && /\d/.test(w))).join(' ')
      .replace(/\d{3,}/g, ' ').replace(NOISE, ' ').replace(/\s+/g, ' ').trim();
    let payee = clean(head);
    // Paid through a payment company: the real company is in the reference ("Stripe · …ACME LTD").
    if ((PROCESSORS.test(payee) || !payee) && rest.length) {
      const ref = clean(rest.join(' ').split(/\s+/).filter((w) => !/\d/.test(w) && w.length > 2).join(' '));
      if (ref) payee = ref;
    }
    return payee.split(' ').filter(Boolean).slice(0, 3).join(' ');
  }
  const keyOf = parts;
  const titleCase = (s) => s.replace(/\b[a-z]/g, (c) => c.toUpperCase()).replace(/\bO2\b/i, 'O2');

  const FREQ = [
    { value: 'weekly', days: 7, tol: 2, min: 4 },
    { value: 'fortnightly', days: 14, tol: 3, min: 3 },
    { value: '4-weekly', days: 28, tol: 1, min: 3 },
    { value: 'monthly', days: 30.4, tol: 6, min: 3 },
    { value: 'quarterly', days: 91, tol: 14, min: 3 },
    { value: 'yearly', days: 365, tol: 25, min: 2 },
  ];
  function median(list) {
    const s = list.slice().sort((a, b) => a - b);
    return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : 0;
  }

  /* The latest run of 3 or more months in a row with a payment on the same day of the month
     (give or take 3 days, as direct debits move when the date falls on a weekend or bank holiday).
     The run can end at any of the last three payments, so one odd payment at the end doesn't hide it. */
  function monthlyChain(days, covered) {
    for (const last of days.slice(-3).reverse()) {
      const day = +last.date.slice(8, 10);
      const chain = [last];
      let gaps = 0;
      for (let k = 1; k < 120; k++) {
        // The same day k months earlier (the 31st becomes the 30th, or the 28th in February), give or take 3 days.
        const wantIso = GU.util.addMonths(last.date, -k, day);
        const want = toDays(wantIso);
        const near = days.filter((d) => d.date < chain[0].date && Math.abs(toDays(d.date) - want) <= 3);
        if (near.length) {
          chain.unshift(near.reduce((a, b) => (Math.abs(toDays(a.date) - want) <= Math.abs(toDays(b.date) - want) ? a : b)));
          gaps = 0;
        } else if (covered && !covered(chain[0].account, wantIso.slice(0, 7)) && ++gaps <= 2) {
          continue; // no statement for that month: a gap in your statements isn't a missed payment
        } else break;
      }
      if (chain.length >= 3) return chain;
    }
    return null;
  }

  /* The same payment imported from two overlapping statements (or two accounts) only counts once. */
  function dedupe(list) {
    const out = [];
    for (const t of list.slice().sort((a, b) => a.date.localeCompare(b.date))) {
      const twin = out.find((o) => o.account !== t.account && Math.abs(o.amount - t.amount) < 0.005 && Math.abs(toDays(o.date) - toDays(t.date)) <= 2);
      if (!twin) out.push(t);
    }
    return out;
  }

  /* The last day each account's statements cover. Two accounts holding the same payments (the same
     account imported twice under different names) share the later of their two end dates. */
  function accountEnds(state) {
    const end = {};
    const byAmount = new Map();
    for (const x of state.transactions) {
      if (!end[x.account] || x.date > end[x.account]) end[x.account] = x.date;
      const k = Math.round(x.amount * 100);
      if (!byAmount.has(k)) byAmount.set(k, []);
      byAmount.get(k).push(x);
    }
    const pairs = {};
    for (const list of byAmount.values()) {
      if (list.length < 2 || list.length > 400) continue;
      for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
        const a = list[i];
        const b = list[j];
        if (a.account === b.account || Math.abs(toDays(a.date) - toDays(b.date)) > 2) continue;
        const key = [a.account, b.account].sort().join('|');
        pairs[key] = (pairs[key] || 0) + 1;
      }
    }
    const count = {};
    for (const x of state.transactions) count[x.account] = (count[x.account] || 0) + 1;
    const out = Object.assign({}, end);
    for (const [key, n] of Object.entries(pairs)) {
      const [a, b] = key.split('|');
      if (n < 15 || n < Math.min(count[a], count[b]) * 0.1) continue;
      const later = end[a] > end[b] ? end[a] : end[b];
      if (later > out[a]) out[a] = later;
      if (later > out[b]) out[b] = later;
    }
    return out;
  }

  /* Regular payments that aren't bills yet. Returns [{key, name, amount, frequency, nextDue, …}]. */
  function find(state) {
    const t = today();
    const ignored = new Set(state.settings.ignoredBills || []);
    const have = new Set((state.bills || []).flatMap((b) => [b.foundKey, keyOf(b.payee || ''), keyOf(b.name || '')]).filter(Boolean));
    const debtTx = new Set();
    if (GU.debts) for (const d of state.debts || []) GU.debts.payments(state, d).forEach((p) => debtTx.add(p.id));
    const lastByAccount = accountEnds(state);
    const months = {};
    for (const x of state.transactions) (months[x.account] = months[x.account] || new Set()).add(x.date.slice(0, 7));
    const covered = (account, month) => !!(months[account] && months[account].has(month));

    const groups = new Map();
    for (const x of state.transactions) {
      if (x.amount >= 0 || x.demo || debtTx.has(x.id) || SKIP_CATEGORIES.includes(x.category) || /pot\b/i.test(x.notes || '')) continue;
      const text = (x.description || '').toLowerCase();
      if (SAVINGS.test(text) || (GU.debts && GU.debts.lenderFor(text)) || /overdraft|interest charge|transfer to|transfer from/.test(text)) continue;
      const k = keyOf(x.description);
      if (!k || k.length < 2 || ignored.has(k) || have.has(k)) continue;
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(x);
    }

    const out = [];
    for (const [k, all] of groups) {
      const pays = dedupe(all);
      // One payment per day (a bill split into two lines on the same day counts as one).
      const days = [];
      for (const p of pays) {
        const last = days[days.length - 1];
        if (last && last.date === p.date) last.amount = round2(last.amount + p.amount);
        else days.push({ date: p.date, amount: p.amount, account: p.account, category: p.category, description: p.description });
      }
      if (days.length < 2) continue;
      const cat = days[days.length - 1].category || '';
      const billLike = BILL_CATEGORIES.includes(cat);
      // Monthly bills: taken in 3 months in a row on the same day of the month.
      const chain = monthlyChain(days, covered);
      let f = null;
      let run = null;
      if (chain) {
        f = FREQ.find((x) => x.value === 'monthly');
        run = chain;
      } else {
        // Weekly, fortnightly, 4-weekly, quarterly and yearly payments: a steady gap between them.
        const gaps = [];
        for (let i = 1; i < days.length; i++) gaps.push(toDays(days[i].date) - toDays(days[i - 1].date));
        const recent = gaps.slice(-8);
        const m = median(recent);
        f = FREQ.find((x) => x.value !== 'monthly' && Math.abs(m - x.days) <= x.tol);
        if (f && f.value === '4-weekly' && recent.filter((g) => Math.abs(g - 28) <= 1).length < recent.length * 0.7) f = null;
        if (!f || days.length < f.min || recent.filter((g) => Math.abs(g - f.days) <= f.tol).length / recent.length < 0.7) continue;
        run = days.slice(-(recent.length + 1));
      }
      const amounts = run.map((d) => -d.amount);
      const typical = median(amounts.slice(-4));
      const even = amounts.filter((a) => Math.abs(a - typical) <= Math.max(1, typical * 0.15)).length / amounts.length;
      // Everyday spending can look regular too: unless it's a bill category, the amount must be steady.
      if (!billLike && even < 0.75) continue;
      if ((f.value === 'weekly' || f.value === 'fortnightly') && even < 0.8) continue;
      const lastPay = days[days.length - 1];
      const runEnd = run[run.length - 1];
      const end = lastByAccount[lastPay.account] || t;
      // Still going: paid recently, and the regular run isn't long in the past.
      if (toDays(end) - toDays(lastPay.date) > f.days * 1.6 + 5 || toDays(end) - toDays(runEnd.date) > f.days * 2.6 + 5) continue;
      const anchorDay = +runEnd.date.slice(8, 10);
      let next = runEnd.date;
      let guard = 0;
      do next = F.nextDate(next, f.value, anchorDay);
      while (next && next < t && guard++ < 500);
      if (!next) continue;
      const desc = lastPay.description;
      const name = titleCase(k);
      out.push({
        // A trial or part-month charge at the end isn't the real price: use the usual amount then.
        key: k, name, payee: name, amount: round2(Math.abs(-runEnd.amount - typical) > typical * 0.15 ? typical : -runEnd.amount), typical: round2(typical), varies: even < 0.75, low: round2(Math.min(...amounts)), high: round2(Math.max(...amounts)),
        frequency: f.value, anchorDay, nextDue: next, first: days[0].date, last: lastPay.date, count: days.length, account: lastPay.account,
        category: cat || F.categorise(desc, -1, state.rules, { spend: true }) || 'Bills & utilities', sure: run.length >= 4,
        history: days.slice(-24).map((d) => ({ date: d.date, amount: round2(-d.amount) })),
      });
    }
    return out.sort((a, b) => F.monthlyEquivalent(b.amount, b.frequency) - F.monthlyEquivalent(a.amount, a.frequency));
  }

  const WORK_OUT = F.WORK_OUT || 'Work expenses';
  /* A regular payment in 'Work expenses' comes out of your account for work: it's a work bill you pay and
     get back from your employer. */
  const isWorkFind = (b) => b.category === WORK_OUT;

  /* Adds what find() returned as bills to check. Returns the new bill ids. */
  function addAsBills(st, found) {
    const ids = [];
    for (const b of found) {
      const id = 'b-' + GU.util.uid();
      ids.push(id);
      st.bills.push(Object.assign({
        id, created: today(), name: b.name, payee: b.payee, amount: b.amount, frequency: b.frequency, nextDue: b.nextDue, anchorDay: b.anchorDay,
        method: b.category === 'Subscriptions' ? 'Card (automatic)' : 'Direct debit', autopay: true, category: b.category, account: b.account, active: true,
        history: b.history, found: true, review: true, foundKey: b.key,
        notes: 'Found in your bank statements: ' + b.count + ' payments from ' + GU.util.fmtDate(b.first) + ' to ' + GU.util.fmtDate(b.last) + '.' +
          (b.varies ? ' The amount varies (' + GU.util.money(b.low) + ' to ' + GU.util.money(b.high) + '), so I used the latest.' : ''),
      }, isWorkFind(b) ? { context: 'work', payer: 'me' } : {}));
    }
    return ids;
  }

  /* Looks for new bills and adds them. quiet: no message when nothing is found. */
  function scan(opts) {
    opts = opts || {};
    const store = GU.store;
    const found = find(store.state);
    if (!found.length) {
      if (!opts.quiet) GU.ui.toast('No new regular payments in your statements. Every bill I can see is already on your list.');
      store.commit((st) => (st.meta.billsScanned = today()), opts.quiet ? { history: false } : null);
      return [];
    }
    let ids = [];
    store.commit((st) => {
      ids = addAsBills(st, found);
      st.meta.billsScanned = today();
    }, opts.quiet ? { history: false } : null);
    // Work bills live in Work › Bills, so say where each went.
    const work = found.filter(isWorkFind).length;
    const home = found.length - work;
    const plural = GU.util.plural;
    const workTab = GU.tabs && GU.tabs['work-bills'] ? 'work-bills' : 'work';
    let msg;
    if (!work) msg = 'I found ' + plural(found.length, 'regular payment') + ' in your statements and added ' + (found.length === 1 ? 'it' : 'them') + ' to Bills.';
    else if (!home) msg = 'I found ' + plural(work, 'regular work payment') + ' in your statements and added ' + (work === 1 ? 'it' : 'them') + ' to ' + (GU.parts && GU.parts.pathOf && GU.tabs['work-bills'] ? GU.parts.pathOf('work-bills') : 'Work › Regular costs') + '.';
    else msg = 'I found ' + plural(found.length, 'regular payment') + ' in your statements: ' + plural(home, 'bill') + ' added to Bills, and ' + work + ' for work added to ' + (GU.parts && GU.parts.pathOf && GU.tabs['work-bills'] ? GU.parts.pathOf('work-bills') : 'Work › Regular costs') + '.';
    GU.ui.toast(msg + ' Have a quick look and tell me which aren’t right.', {
      timeout: 12000,
      action: found.length === 1 ? 'Check it' : 'Check them',
      onAction: () => GU.view.go(home ? 'bills' : workTab),
    });
    return ids;
  }

  /* After transactions move between accounts, each found bill follows the account it's actually paid from. */
  function reassignBills(st) {
    const latest = {};
    for (const t of st.transactions) {
      if (t.amount >= 0) continue;
      const k = keyOf(t.description);
      if (!latest[k] || t.date > latest[k].date) latest[k] = t;
    }
    for (const b of st.bills || []) if (b.foundKey && latest[b.foundKey]) b.account = latest[b.foundKey].account;
  }

  GU.recurring = { find, scan, addAsBills, keyOf, accountEnds, reassignBills, SKIP_CATEGORIES, BILL_CATEGORIES };
})();
