/* The Ground Up: money logic. Categories, auto-categorising, recurring dates and totals. */
(function () {
  'use strict';
  const GU = window.GU;
  const { today, addDays, addMonths, monthKey, shiftMonth, sum, round2 } = GU.util;

  const EXPENSE = [
    'Housing', 'Bills & utilities', 'Groceries', 'Eating out', 'Transport', 'Shopping', 'Subscriptions',
    'Health & fitness', 'Entertainment', 'Travel', 'Personal care', 'Education', 'Family & kids',
    'Gifts & donations', 'Visa & immigration', 'Insurance', 'Fees & charges', 'Debt repayments', 'Savings & investments',
    'Cash', 'Work expenses', 'Other spending',
  ];
  const INCOME = ['Salary', 'Freelance & side work', 'Benefits', 'Refunds', 'Interest', 'Gifts received', 'Rental income', 'Other income'];
  const TRANSFER = 'Transfers';
  /* Work money: what you spend for your employer and what they pay you back. Real money in your accounts,
     but not yours to spend, so it's kept out of income, spending, budgets and charts. */
  const WORK_OUT = 'Work expenses';
  const WORK_IN = 'Work reimbursements';
  const WORK = [WORK_OUT, WORK_IN];
  INCOME.push(WORK_IN); // so it validates as a money-in category; WORK_OUT stays in EXPENSE for old records

  /* Keyword rules for common UK merchants. User rules always win over these. Order matters. */
  const DEFAULT_RULES = [
    [['uber eats', 'deliveroo', 'just eat', 'justeat'], 'Eating out'],
    [['amazon prime', 'prime video', 'netflix', 'spotify', 'disney', 'apple.com/bill', 'icloud', 'google storage', 'google one', 'youtube premium', 'now tv', 'audible', 'playstation', 'xbox', 'adobe', 'microsoft 365', 'patreon', 'canva', 'chatgpt', 'openai', 'uber *one', 'uber one', 'dropbox', 'apple developer', 'google play', 'paramount+', 'crunchyroll'], 'Subscriptions'],
    [['tesco', 'sainsbury', 'asda', 'morrisons', 'aldi', 'lidl', 'waitrose', 'co-op', 'coop food', 'iceland', 'ocado', 'm&s food', 'spar '], 'Groceries'],
    [['pret', 'costa', 'starbucks', 'greggs', 'mcdonald', 'kfc', 'nando', 'domino', 'pizza', 'wagamama', 'burger king', 'subway', 'leon ', 'itsu', 'wasabi', 'restaurant', 'cafe', 'coffee', 'grill', 'kebab', 'chicken', 'takeaway', 'soul food', 'tim hortons', 'five guys', 'taco', 'sushi', 'bakery'], 'Eating out'],
    [['tfl', 'trainline', 'national rail', 'uber', 'bolt', 'shell', 'esso', 'texaco', 'parking', 'avanti', 'gwr', 'lner', 'stagecoach', 'dvla', 'citymapper', 'zipcar'], 'Transport'],
    [['british gas', 'octopus energy', 'edf', 'e.on', 'eon next', 'ovo', 'scottish power', 'thames water', 'severn trent', 'anglian water', 'united utilities', 'council tax', 'tv licen', 'bt group', 'virgin media', 'vodafone', 'giffgaff', 'plusnet', 'talktalk', 'hyperoptic', 'sky digital', 'o2 ', ' ee '], 'Bills & utilities'],
    [['rent', 'mortgage', 'letting', 'estate agent', 'openrent'], 'Housing'],
    [['home office', 'ukvi', 'vfs', 'tlscontact', 'tls contact', 'visa fee', 'immigration', 'ihs '], 'Visa & immigration'],
    [['aviva', 'admiral', 'direct line', 'axa', 'insurance', 'lv=', 'churchill'], 'Insurance'],
    [['boots', 'superdrug', 'pharmacy', 'dentist', 'optician', 'specsavers', 'puregym', 'gym', 'nuffield', 'bupa'], 'Health & fitness'],
    [['odeon', 'vue ', 'cineworld', 'ticketmaster', 'steam', 'cinema', 'theatre'], 'Entertainment'],
    [['ryanair', 'easyjet', 'british airways', 'jet2', 'wizz', 'booking.com', 'airbnb', 'expedia', 'hotel', 'premier inn'], 'Travel'],
    [['klarna', 'clearpay', 'payin3', 'pay in 3', 'zilch', 'laybuy', 'barclaycard', 'capital one', 'vanquis', 'mbna', 'american express', 'amex', 'paypal credit', 'zopa', 'lendable', 'moneybarn', 'student loan', 'tymit', 'aqua card', 'newday', 'lowell portfolio', 'cabot financial', 'intrum', 'pra group', 'asset link capital', 'allied international', 'moorcroft', 'link financial', 'capquest', 'robinson way', 'wescot', 'bw legal'], 'Debt repayments'],
    [['amazon', 'amzn', 'argos', 'ebay', 'asos', 'john lewis', 'ikea', 'primark', 'currys', 'b&q', 'wickes', 'tk maxx', 'zara', 'h&m', 'uniqlo', 'etsy', 'tiktok', 'temu', 'shein', 'jd sports', 'sports direct', 'sportsdirect', 'footlocker', 'foot locker', 'menswear', 'fashion', 'clothing', 'shoes', 'next retail', 'matalan', 'b&m', 'home bargains', 'poundland', 'the range', 'wilko', 'boohoo', 'very.co.uk'], 'Shopping'],
    [['moneybox', 'vanguard', 'trading 212', 'freetrade', 'hargreaves', 'premium bonds', 'ns&i'], 'Savings & investments'],
    [['atm', 'cash withdrawal', 'cashpoint'], 'Cash'],
    [['overdraft', 'interest charge', 'late fee', 'non-sterling', 'transaction fee', 'overdraft fees', 'arranged overdraft'], 'Fees & charges'],
    [['council', 'dvla', 'gov.uk', 'hmrc'], 'Bills & utilities'],
  ];
  const DEFAULT_INCOME_RULES = [
    [['refund', 'reversal'], 'Refunds'],
    [['salary', 'payroll', 'wages', 'wage ', 'pay '], 'Salary'],
    [['interest'], 'Interest'],
    [['universal credit', 'dwp', 'child benefit', 'hmrc'], 'Benefits'],
  ];
  const TRANSFER_WORDS = ['transfer to', 'transfer from', 'to savings', 'from savings', ' pot', 'tfr ', 'own account', 'internal transfer'];

  function matches(desc, kw) {
    return (' ' + desc + ' ').toLowerCase().includes(kw);
  }

  /* Picks a category for a bank description. Returns '' when unsure.
     Money to or from your employer is split first (wages or work money), before your own rules. */
  /* opts.spend: the text is a receipt, invoice or bill, not a bank line, so the employer split (wages or
     money paid back) doesn't apply to it. */
  function categorise(description, amount, rules, opts) {
    const d = String(description || '');
    const wm = GU.workMoney;
    const e = !(opts && opts.spend) && wm && typeof wm.employerCategory === 'function' ? wm.employerCategory(d, amount) : '';
    if (e) return e;
    for (const r of rules || []) {
      if (r.match && matches(d, r.match.toLowerCase())) return r.category;
    }
    if (TRANSFER_WORDS.some((k) => matches(d, k))) return TRANSFER;
    const table = amount > 0 ? DEFAULT_INCOME_RULES : DEFAULT_RULES;
    for (const [words, cat] of table) if (words.some((k) => matches(d, k))) return cat;
    return '';
  }

  const isTransfer = (t) => t.category === TRANSFER;
  const isWork = (t) => !!t && WORK.includes(t.category);
  /* Whether a bank line counts towards your own money in and out (not a transfer, not work money). */
  const counts = (t) => !isTransfer(t) && !isWork(t);
  const moneyIn = (list) => sum(list.filter((t) => t.amount > 0 && counts(t)), (t) => t.amount);
  const moneyOut = (list) => sum(list.filter((t) => t.amount < 0 && counts(t)), (t) => -t.amount);

  function inMonth(list, key) {
    return list.filter((t) => t.date && t.date.slice(0, 7) === key);
  }
  function monthSeries(list, months, endKey) {
    const end = endKey || monthKey(today());
    const out = [];
    for (let i = months - 1; i >= 0; i--) {
      const key = shiftMonth(end, -i);
      const rows = inMonth(list, key);
      out.push({ key, in: moneyIn(rows), out: moneyOut(rows) });
    }
    return out;
  }
  function byCategory(list, dir) {
    const map = new Map();
    for (const t of list) {
      if (!counts(t)) continue;
      if (dir === 'in' ? t.amount <= 0 : t.amount >= 0) continue;
      const c = t.category || 'Uncategorised';
      map.set(c, round2((map.get(c) || 0) + Math.abs(t.amount)));
    }
    return Array.from(map, ([category, total]) => ({ category, total })).sort((a, b) => b.total - a.total);
  }

  const PERIODS = [
    { value: 'this-month', label: 'This month' },
    { value: 'last-month', label: 'Last month' },
    { value: '3m', label: 'Last 3 months' },
    { value: '12m', label: 'Last 12 months' },
    { value: 'all', label: 'All time' },
  ];
  function periodFilter(period) {
    const cur = monthKey(today());
    if (period === 'this-month') return (t) => t.date.slice(0, 7) === cur;
    if (period === 'last-month') {
      const k = shiftMonth(cur, -1);
      return (t) => t.date.slice(0, 7) === k;
    }
    if (period === '3m') {
      const k = shiftMonth(cur, -2);
      return (t) => t.date.slice(0, 7) >= k;
    }
    if (period === '12m') {
      const k = shiftMonth(cur, -11);
      return (t) => t.date.slice(0, 7) >= k;
    }
    return () => true;
  }

  /* ---------- recurring dates ---------- */
  const FREQUENCIES = [
    { value: 'weekly', label: 'Weekly' },
    { value: 'fortnightly', label: 'Every 2 weeks' },
    { value: '4-weekly', label: 'Every 4 weeks' },
    { value: 'monthly', label: 'Monthly' },
    { value: 'quarterly', label: 'Every 3 months' },
    { value: 'yearly', label: 'Yearly' },
    { value: 'once', label: 'One-off' },
  ];
  const freqLabel = (v) => (FREQUENCIES.find((f) => f.value === v) || { label: v }).label;
  function nextDate(date, freq, anchorDay) {
    switch (freq) {
      case 'weekly': return addDays(date, 7);
      case 'fortnightly': return addDays(date, 14);
      case '4-weekly': return addDays(date, 28);
      case 'monthly': return addMonths(date, 1, anchorDay);
      case 'quarterly': return addMonths(date, 3, anchorDay);
      case 'yearly': return addMonths(date, 12, anchorDay);
      default: return null;
    }
  }
  function monthlyEquivalent(amount, freq) {
    const a = Number(amount) || 0;
    switch (freq) {
      case 'weekly': return (a * 52) / 12;
      case 'fortnightly': return (a * 26) / 12;
      case '4-weekly': return (a * 13) / 12;
      case 'monthly': return a;
      case 'quarterly': return a / 3;
      case 'yearly': return a / 12;
      default: return 0;
    }
  }
  /* Every date a recurring item falls on between from and to (inclusive). */
  function occurrences(start, freq, anchorDay, from, to) {
    const out = [];
    let d = start;
    let guard = 0;
    while (d && d <= to && guard++ < 400) {
      if (d >= from) out.push(d);
      if (freq === 'once') break;
      d = nextDate(d, freq, anchorDay);
    }
    return out;
  }

  /* Moves automatic payments (direct debits, standing orders) and expected income past today.
     Returns true if anything changed. */
  function rollForward(state) {
    const t = today();
    let changed = false;
    for (const b of state.bills) {
      if (b.active === false || !b.autopay || !b.nextDue) continue;
      let guard = 0;
      while (b.nextDue < t && guard++ < 400) {
        b.history = b.history || [];
        b.history.push({ date: b.nextDue, amount: b.amount, auto: true });
        if (b.history.length > 60) b.history = b.history.slice(-60);
        const n = nextDate(b.nextDue, b.frequency, b.anchorDay);
        changed = true;
        if (!n) {
          b.active = false;
          break;
        }
        b.nextDue = n;
      }
    }
    for (const s of state.incomeSources) {
      if (!s.nextDate) continue;
      let guard = 0;
      while (s.nextDate < t && guard++ < 400) {
        const n = nextDate(s.nextDate, s.frequency, s.anchorDay);
        changed = true;
        if (!n) {
          s.nextDate = '';
          break;
        }
        s.nextDate = n;
      }
    }
    return changed;
  }

  function categoryOptions(kind) {
    const exp = { group: 'Money out', options: EXPENSE.filter((c) => !WORK.includes(c)) };
    const inc = { group: 'Money in', options: INCOME.filter((c) => !WORK.includes(c)) };
    const work = { group: 'Work money (kept out of your own totals)', options: WORK };
    const other = { group: 'Neither', options: [TRANSFER] };
    if (kind === 'in') return [inc, work, other];
    if (kind === 'out') return [exp, work, other];
    return [exp, inc, work, other];
  }

  /* ---------- invoices you've sent: what's still owed to you ---------- */
  const paidSoFar = (p) => round2(sum(p.payments || [], (x) => Number(x.amount) || 0));
  /* What's left to come on an invoice after any part payments. */
  function outstanding(p) {
    if (p.status === 'paid') return 0;
    return Math.max(0, round2((Number(p.amount) || 0) - paidSoFar(p)));
  }
  /* Every payment received on an invoice: part payments, plus the rest on the day it was marked paid. */
  function received(p) {
    const out = (p.payments || []).map((x) => ({ date: x.date, amount: Number(x.amount) || 0 }));
    const rest = round2((Number(p.amount) || 0) - paidSoFar(p));
    if (p.status === 'paid' && rest > 0) out.push({ date: p.paidDate || p.date || '', amount: rest });
    return out;
  }
  /* Everything still owed to you, soonest due first (no due date last), each with the running total up to it.
     Home invoices unless you ask for another context. A work invoice-out (an old way of claiming expenses
     back from your employer) only shows with context 'all': that money is in Get paid back instead. */
  function owedToMe(state, context) {
    const t = today();
    const ctx = context === undefined ? 'home' : context;
    const inCtx = (p) => {
      const c = p.context || 'home';
      if (ctx === 'all') return true;
      if (c === 'work') return false;
      return !ctx || c === ctx;
    };
    let run = 0;
    return (state.paperwork || [])
      .filter((p) => p.kind === 'invoice-out' && p.status !== 'paid' && inCtx(p))
      .map((p) => ({ p, left: outstanding(p), paid: paidSoFar(p), late: !!(p.dueDate && p.dueDate < t), noAmount: p.amount == null || p.amount === '' }))
      .filter((x) => x.left > 0 || x.noAmount)
      .sort((a, b) => (a.p.dueDate || '9').localeCompare(b.p.dueDate || '9') || (a.p.date || '').localeCompare(b.p.date || ''))
      .map((x) => Object.assign(x, { running: (run = round2(run + x.left)) }));
  }
  /* A payment in your bank statements that looks like it settles this invoice: the amount left, from the
     person or company on it (or quoting its reference), on or after the invoice date. */
  const NOT_NAMES = new Set(['ltd', 'limited', 'the', 'and', 'plc', 'llp', 'company', 'services', 'group', 'from', 'payment', 'invoice']);
  function paymentFor(state, p, taken) {
    const left = outstanding(p);
    if (!(left > 0)) return null;
    const words = String(p.party || '').toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && !NOT_NAMES.has(w));
    const ref = String(p.reference || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    if (!words.length && ref.length < 4) return null;
    const used = new Set();
    for (const x of state.paperwork || []) for (const y of x.payments || []) if (y.tx) used.add(y.tx);
    const no = new Set(p.notPayments || []);
    return (state.transactions || []).find((t) => {
      if (!(t.amount > 0) || Math.abs(t.amount - left) >= 0.005 || (p.date && t.date < p.date) || used.has(t.id) || no.has(t.id) || (taken && taken.has(t.id))) return false;
      const text = ((t.description || '') + ' ' + (t.notes || '')).toLowerCase();
      return words.some((w) => text.includes(w)) || (ref.length >= 4 && text.replace(/[^a-z0-9]/g, '').includes(ref));
    }) || null;
  }

  /* ---------- work expenses to claim back ---------- */
  /* Things you paid for work and haven't sent to your employer yet, oldest first, each with the running total
     up to it. Kept for older callers: the list comes from GU.workMoney.claims(state, 'to-send'). */
  function toClaim(state) {
    const wm = GU.workMoney;
    const list = wm && typeof wm.claims === 'function'
      ? wm.claims(state, 'to-send') || []
      : (state.paperwork || []) // before work money is loaded: the old claim / claimed flags
        .filter((p) => p.claim && !p.claimed)
        .sort((a, b) => (a.date || '9').localeCompare(b.date || '9') || (a.created || '').localeCompare(b.created || ''));
    let run = 0;
    return list.map((x) => {
      const p = x && x.p ? x.p : x;
      const amount = x && x.p && Number.isFinite(x.amount) ? x.amount : Math.abs(Number(p.amount) || 0);
      return Object.assign({}, x && x.p ? x : {}, { p, amount, noAmount: p.amount == null || p.amount === '', running: (run = round2(run + amount)) });
    });
  }

  GU.finance = {
    outstanding, received, owedToMe, paymentFor, toClaim,
    EXPENSE, INCOME, TRANSFER, WORK, WORK_IN, WORK_OUT, FREQUENCIES, PERIODS,
    categorise, isTransfer, isWork, counts, moneyIn, moneyOut, inMonth, monthSeries, byCategory, periodFilter,
    freqLabel, nextDate, monthlyEquivalent, occurrences, rollForward, categoryOptions,
  };
})();
