/* The Ground Up: money logic. Categories, auto-categorising, recurring dates and totals. */
(function () {
  'use strict';
  const GU = window.GU;
  const { today, addDays, addMonths, monthKey, shiftMonth, sum, round2 } = GU.util;

  const EXPENSE = [
    'Housing', 'Bills & utilities', 'Groceries', 'Eating out', 'Transport', 'Shopping', 'Subscriptions',
    'Health & fitness', 'Entertainment', 'Travel', 'Personal care', 'Education', 'Family & kids',
    'Gifts & donations', 'Visa & immigration', 'Insurance', 'Fees & charges', 'Savings & investments',
    'Cash', 'Work expenses', 'Other spending',
  ];
  const INCOME = ['Salary', 'Freelance & side work', 'Benefits', 'Refunds', 'Interest', 'Gifts received', 'Rental income', 'Other income'];
  const TRANSFER = 'Transfers';

  /* Keyword rules for common UK merchants. User rules always win over these. Order matters. */
  const DEFAULT_RULES = [
    [['uber eats', 'deliveroo', 'just eat', 'justeat'], 'Eating out'],
    [['amazon prime', 'prime video', 'netflix', 'spotify', 'disney', 'apple.com/bill', 'icloud', 'google storage', 'youtube premium', 'now tv', 'audible', 'playstation', 'xbox', 'adobe', 'microsoft 365', 'patreon'], 'Subscriptions'],
    [['tesco', 'sainsbury', 'asda', 'morrisons', 'aldi', 'lidl', 'waitrose', 'co-op', 'coop food', 'iceland', 'ocado', 'm&s food', 'spar '], 'Groceries'],
    [['pret', 'costa', 'starbucks', 'greggs', 'mcdonald', 'kfc', 'nando', 'domino', 'pizza', 'wagamama', 'burger king', 'subway', 'leon ', 'itsu', 'wasabi', 'restaurant', 'cafe', 'coffee'], 'Eating out'],
    [['tfl', 'trainline', 'national rail', 'uber', 'bolt', 'shell', 'esso', 'texaco', 'parking', 'avanti', 'gwr', 'lner', 'stagecoach', 'dvla', 'citymapper', 'zipcar'], 'Transport'],
    [['british gas', 'octopus energy', 'edf', 'e.on', 'eon next', 'ovo', 'scottish power', 'thames water', 'severn trent', 'anglian water', 'united utilities', 'council tax', 'tv licen', 'bt group', 'virgin media', 'vodafone', 'giffgaff', 'plusnet', 'talktalk', 'hyperoptic', 'sky digital', 'o2 ', ' ee '], 'Bills & utilities'],
    [['rent', 'mortgage', 'letting', 'estate agent', 'openrent'], 'Housing'],
    [['home office', 'ukvi', 'vfs', 'tlscontact', 'tls contact', 'visa fee', 'immigration', 'ihs '], 'Visa & immigration'],
    [['aviva', 'admiral', 'direct line', 'axa', 'insurance', 'lv=', 'churchill'], 'Insurance'],
    [['boots', 'superdrug', 'pharmacy', 'dentist', 'optician', 'specsavers', 'puregym', 'gym', 'nuffield', 'bupa'], 'Health & fitness'],
    [['odeon', 'vue ', 'cineworld', 'ticketmaster', 'steam', 'cinema', 'theatre'], 'Entertainment'],
    [['ryanair', 'easyjet', 'british airways', 'jet2', 'wizz', 'booking.com', 'airbnb', 'expedia', 'hotel', 'premier inn'], 'Travel'],
    [['amazon', 'amzn', 'argos', 'ebay', 'asos', 'john lewis', 'ikea', 'primark', 'currys', 'b&q', 'wickes', 'tk maxx', 'zara', 'h&m', 'uniqlo', 'etsy'], 'Shopping'],
    [['atm', 'cash withdrawal', 'cashpoint'], 'Cash'],
    [['overdraft', 'interest charge', 'late fee', 'non-sterling', 'transaction fee'], 'Fees & charges'],
  ];
  const DEFAULT_INCOME_RULES = [
    [['refund', 'reversal'], 'Refunds'],
    [['salary', 'payroll', 'wages', 'pay '], 'Salary'],
    [['interest'], 'Interest'],
    [['universal credit', 'dwp', 'child benefit', 'hmrc'], 'Benefits'],
  ];
  const TRANSFER_WORDS = ['transfer to', 'transfer from', 'to savings', 'from savings', ' pot', 'tfr ', 'own account', 'internal transfer'];

  function matches(desc, kw) {
    return (' ' + desc + ' ').toLowerCase().includes(kw);
  }

  /* Picks a category for a bank description. Returns '' when unsure. */
  function categorise(description, amount, rules) {
    const d = String(description || '');
    for (const r of rules || []) {
      if (r.match && matches(d, r.match.toLowerCase())) return r.category;
    }
    if (TRANSFER_WORDS.some((k) => matches(d, k))) return TRANSFER;
    const table = amount > 0 ? DEFAULT_INCOME_RULES : DEFAULT_RULES;
    for (const [words, cat] of table) if (words.some((k) => matches(d, k))) return cat;
    return '';
  }

  const isTransfer = (t) => t.category === TRANSFER;
  const counts = (t) => !isTransfer(t);
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
    const exp = { group: 'Money out', options: EXPENSE };
    const inc = { group: 'Money in', options: INCOME };
    const other = { group: 'Neither', options: [TRANSFER] };
    if (kind === 'in') return [inc, other];
    if (kind === 'out') return [exp, other];
    return [exp, inc, other];
  }

  GU.finance = {
    EXPENSE, INCOME, TRANSFER, FREQUENCIES, PERIODS,
    categorise, isTransfer, moneyIn, moneyOut, inMonth, monthSeries, byCategory, periodFilter,
    freqLabel, nextDate, monthlyEquivalent, occurrences, rollForward, categoryOptions,
  };
})();
