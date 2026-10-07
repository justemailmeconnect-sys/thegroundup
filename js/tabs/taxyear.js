/* The Ground Up: Home › Tax year. What came in during a tax year (6 April to 5 April), or in each Universal
   Credit assessment period, from your statements and records: wages, benefits, side work and everything else,
   month by month, with the dates and amounts behind every figure.
   It's for checking your own figures, not for filing. Every total comes from the same bank lines the Income page
   uses (GU.finance.moneyIn: transfers and work money are left out), plus any invoices you sent that were paid
   but aren't in your statements. Work money (what you paid for work and were paid back) is shown apart, because
   it isn't your income. Wages come from your employer in Settings; benefits are found from your own categories
   and regular income, never from a fixed list of names. */
(function () {
  'use strict';
  const GU = window.GU;
  const { esc, today, addDays, shiftMonth, daysInMonth, toDays, fmtDate, money, plural, round2, sum } = GU.util;
  const { icon, pill, emptyState, chips, toast } = GU.ui;
  const F = GU.finance;
  const store = GU.store;

  const ui = { period: '', ucEdit: false, ucAll: false, open: new Set() };
  const pad = (n) => String(n).padStart(2, '0');
  const short = (iso) => fmtDate(iso, { short: true });
  const long = (iso) => fmtDate(iso);
  // '6 Apr', for the month table, where the tax year already says which year it is.
  const dm = (iso) => +iso.slice(8) + ' ' + GU.util.MONTHS[+iso.slice(5, 7) - 1];
  const fig = (x) => '<span class="nowrap">' + esc(money(x)) + '</span>';
  const ordinal = (n) => n + (n % 10 === 1 && n !== 11 ? 'st' : n % 10 === 2 && n !== 12 ? 'nd' : n % 10 === 3 && n !== 13 ? 'rd' : 'th');
  const ev = () => GU.evidence || null;

  /* ---------- the employer and your own wording ---------- */
  const wm = () => GU.workMoney || null;
  const employer = (s) => (wm() ? wm().employer(s) : { set: false, short: '', name: '', label: 'the company', Label: 'The company' });
  function isWages(s, t) {
    const T = GU.tabs.transactions;
    return !!(T && T.isWages && T.isWages(s, t));
  }
  const clean = (t) => (wm() && wm().clean ? wm().clean(t) : String(t == null ? '' : t).replace(/\d{5,}/g, '…').replace(/\s+/g, ' ').trim());
  const flat = (t) => ' ' + String(t || '').toLowerCase().replace(/['’]/g, '').replace(/[^a-z0-9]+/g, ' ').trim() + ' ';

  /* ---------- tax years and monthly periods ---------- */
  const startYearOf = (iso) => (iso.slice(5) >= '04-06' ? +iso.slice(0, 4) : +iso.slice(0, 4) - 1);
  /* The tax year that starts in year y: 6 April y to 5 April y + 1. */
  function yearRange(y) {
    return { y, key: 'ty' + y, from: y + '-04-06', to: y + 1 + '-04-05', label: y + '/' + String(y + 1).slice(2) };
  }
  /* Tax years covering your records, newest first (this year first, even with nothing in it yet). */
  function years(s) {
    const now = startYearOf(today());
    let first = now;
    const dates = (s.transactions || []).map((t) => t.date).concat((s.paperwork || []).filter((p) => p.kind === 'invoice-out' && (p.context || 'home') !== 'work').flatMap((p) => [p.paidDate].concat((p.payments || []).map((x) => x.date))));
    for (const d of dates) if (typeof d === 'string' && d >= '2000-01-01' && d <= today() && startYearOf(d) < first) first = startYearOf(d);
    first = Math.max(first, now - 9);
    const out = [];
    for (let y = now; y >= first; y--) out.push(yearRange(y));
    return out;
  }
  /* A month that starts on `day` (clamped to the length of the month). */
  const startIn = (key, day) => key + '-' + pad(Math.min(day, daysInMonth(+key.slice(0, 4), +key.slice(5))));
  /* The monthly period (starting on `day` each month) that holds a date. */
  function periodAt(iso, day) {
    let key = iso.slice(0, 7);
    let from = startIn(key, day);
    if (iso < from) {
      key = shiftMonth(key, -1);
      from = startIn(key, day);
    }
    return { from, to: addDays(startIn(shiftMonth(key, 1), day), -1) };
  }
  /* Every monthly period from the one holding `from` to the one holding `to`, oldest first. */
  function periodsBetween(from, to, day) {
    const out = [];
    let p = periodAt(from, day);
    while (p.from <= to && out.length < 400) {
      out.push(p);
      p = periodAt(addDays(p.to, 1), day);
    }
    return out;
  }

  /* ---------- which money in is a benefit ---------- */
  // Words that make a category or a regular income look like a benefit. Only your own names are tested with them.
  const BENEFIT_WORDS = /universal credit|\bpip\b|personal independence|child benefit|housing benefit|jobseeker|\bjsa\b|\besa\b|employment and support|attendance allowance|carer'?s? allowance|disability living|\bdla\b|pension credit|tax credit|council tax (support|reduction)|\bbenefits?\b|\ballowance\b|\bdwp\b/i;
  const GENERIC = new Set(['the', 'and', 'for', 'from', 'payment', 'payments', 'benefit', 'benefits', 'credit', 'income', 'weekly', 'monthly', 'allowance', 'regular', 'pay']);
  const benefitCat = (s, c) => !!c && (c === 'Benefits' || (F.custom(s, 'in').includes(c) && BENEFIT_WORDS.test(c)));
  const descKey = (d) => flat(d).trim().split(' ').filter((w) => w && !/^\d+$/.test(w)).slice(0, 2).join(' ');
  const descLabel = (d) => String(d || '').split(/[^A-Za-z0-9']+/).filter((w) => w && !/^\d+$/.test(w)).slice(0, 2).join(' ');

  /* The regular incomes that look like benefits, the words that name each, and how often each kind of
     description turns up in your benefit lines (so 'DWP UC' and 'DWP PIP' can be told apart). */
  function benefitContext(s) {
    const sources = (s.incomeSources || []).filter((x) => BENEFIT_WORDS.test((x.name || '') + ' ' + (x.from || ''))).map((x) => {
      const words = flat(x.name).trim().split(' ').filter(Boolean);
      const tokens = new Set(words.filter((w) => w.length >= 3 && !GENERIC.has(w)));
      if (words.length >= 2) tokens.add(words.map((w) => w[0]).join(''));
      return { src: x, label: x.name, phrase: flat(x.name), tokens: Array.from(tokens) };
    });
    const keys = {};
    for (const t of s.transactions || []) {
      if (!(t.amount > 0) || !benefitCat(s, t.category)) continue;
      const k = descKey(t.description);
      if (!k) continue;
      keys[k] = keys[k] || { n: 0, label: descLabel(t.description) };
      keys[k].n++;
    }
    return { sources, keys };
  }
  /* The regular income a bank line is from, by the words in its name: the longest word that matches wins. */
  function matchSource(ctx, t) {
    const text = flat((t.description || '') + ' ' + (t.notes || ''));
    let best = null;
    let len = 0;
    for (const x of ctx.sources) {
      const hit = text.includes(x.phrase) ? x.phrase.length : Math.max(0, ...x.tokens.filter((w) => text.includes(' ' + w + ' ')).map((w) => w.length));
      if (hit > len) {
        best = x;
        len = hit;
      }
    }
    return best;
  }
  function benefitLabel(ctx, t) {
    const m = matchSource(ctx, t);
    if (m) return m.label;
    const k = ctx.keys[descKey(t.description)];
    return k && k.n >= 2 ? k.label : 'Other benefit payments';
  }

  /* ---------- sorting each payment in into a source ---------- */
  const ORDER = { wages: 0, benefits: 1, freelance: 2, other: 3, unsorted: 4 };
  /* kind, a key that groups lines into one source, and that source's name. */
  function classify(s, t, ctx) {
    const e = employer(s);
    if (isWages(s, t)) return { kind: 'wages', key: 'wages', label: 'Wages from ' + e.label };
    const cat = t.category || '';
    if (cat === 'Salary') return e.set ? { kind: 'other', key: 'pay-other', label: 'Other pay (Salary)' } : { kind: 'wages', key: 'wages', label: 'Salary' };
    if (benefitCat(s, cat)) {
      const label = benefitLabel(ctx, t);
      return { kind: 'benefits', key: 'b:' + label, label };
    }
    if (!cat || cat === 'Other income') {
      const m = matchSource(ctx, t);
      if (m) return { kind: 'benefits', key: 'b:' + m.label, label: m.label };
    }
    if (cat === 'Freelance & side work') return { kind: 'freelance', key: 'freelance', label: 'Freelance and side work' };
    return cat ? { kind: 'other', key: 'c:' + cat, label: cat } : { kind: 'unsorted', key: 'c:', label: 'Not sorted yet' };
  }

  /* ---------- paid invoices ---------- */
  /* Invoices you sent for your own side work that were paid in the period. Each says whether its money is
     already one of your bank lines (counted there) or not (counted here, once). */
  function paidInvoices(s, from, to) {
    const pos = (s.transactions || []).filter((t) => t.amount > 0 && F.counts(t));
    const byId = new Map(pos.map((t) => [t.id, t]));
    const taken = new Set();
    const out = [];
    for (const p of s.paperwork || []) {
      if (p.kind !== 'invoice-out' || (p.context || 'home') === 'work') continue;
      const recs = F.received(p);
      recs.forEach((r, i) => {
        if (!r.date || !(r.amount > 0) || r.date < from || r.date > to) return;
        const link = i < (p.payments || []).length ? (p.payments[i] || {}).tx : '';
        let tx = link && byId.has(link) ? byId.get(link) : null;
        const linked = !!tx;
        if (!tx) {
          let gap = 6;
          for (const t of pos) {
            if (taken.has(t.id) || Math.abs(t.amount - r.amount) >= 0.005) continue;
            const g = Math.abs(toDays(t.date) - toDays(r.date));
            if (g < gap) {
              gap = g;
              tx = t;
            }
          }
        }
        if (tx) taken.add(tx.id);
        out.push({ p, date: r.date, amount: r.amount, party: p.party || '', title: p.title || '', ref: p.reference || '', tx, linked });
      });
    }
    return out.sort((a, b) => a.date.localeCompare(b.date));
  }

  /* ---------- the figures ---------- */
  /* Every payment in over [from, to], sorted into a source. bankIn is GU.finance.moneyIn over the same bank
     lines, so it matches the Income page; paper is paid invoices that aren't in your bank lines. */
  function collect(s, from, to) {
    const ctx = benefitContext(s);
    const txs = (s.transactions || []).filter((t) => t.date && t.date >= from && t.date <= to);
    const invoices = paidInvoices(s, from, to);
    // A bank line that settles an invoice you sent is side work, unless you've already put it somewhere specific.
    const settles = new Map(invoices.filter((x) => x.tx && (x.linked || !x.tx.category || x.tx.category === 'Other income')).map((x) => [x.tx.id, x]));
    const lines = [];
    for (const t of txs) {
      if (!(t.amount > 0) || !F.counts(t)) continue;
      const inv = settles.get(t.id);
      const c = inv && t.category !== 'Salary' ? { kind: 'freelance', key: 'freelance', label: 'Freelance and side work' } : classify(s, t, ctx);
      lines.push({ id: t.id, date: t.date, amount: t.amount, desc: clean(t.description), category: t.category || '', kind: c.kind, key: c.key, label: c.label, inv: inv && t.category !== 'Salary' ? inv.ref || 'invoice' : '' });
    }
    const paper = [];
    for (const x of invoices) {
      if (x.tx) continue;
      const ln = { id: 'inv-' + x.p.id + '-' + x.date, date: x.date, amount: x.amount, desc: 'Invoice' + (x.ref ? ' ' + clean(x.ref) : '') + (x.party ? ' to ' + clean(x.party) : '') + ' (not in your bank records)', category: '', kind: 'freelance', key: 'freelance', label: 'Freelance and side work', paper: true };
      paper.push(ln);
      lines.push(ln);
    }
    lines.sort((a, b) => a.date.localeCompare(b.date) || String(a.id).localeCompare(String(b.id)));
    return { txs, lines, invoices, bankIn: F.moneyIn(txs), paper: sum(paper, (l) => l.amount) };
  }
  /* Lines grouped into sources, in the order they're shown. */
  function groupLines(lines) {
    const map = new Map();
    for (const l of lines) {
      let g = map.get(l.key);
      if (!g) map.set(l.key, (g = { key: l.key, kind: l.kind, label: l.label, lines: [], total: 0, count: 0 }));
      g.lines.push(l);
    }
    const out = Array.from(map.values());
    for (const g of out) {
      g.total = sum(g.lines, (l) => l.amount);
      g.count = g.lines.length;
    }
    return out.sort((a, b) => ORDER[a.kind] - ORDER[b.kind] || (a.key === 'wages' ? -1 : b.key === 'wages' ? 1 : 0) || b.total - a.total || a.label.localeCompare(b.label));
  }
  const kindTotals = (lines) => {
    const o = { wages: 0, benefits: 0, freelance: 0, other: 0 };
    for (const l of lines) o[l.kind === 'unsorted' ? 'other' : l.kind] = round2(o[l.kind === 'unsorted' ? 'other' : l.kind] + l.amount);
    return o;
  };

  /* Work money in [from, to]: not income. What you paid for work, what came back, and what's still due today. */
  function workMoney(s, txs) {
    const out = sum(txs.filter((t) => t.category === F.WORK_OUT), (t) => -t.amount);
    const back = sum(txs.filter((t) => t.amount > 0 && t.category === F.WORK_IN), (t) => t.amount);
    const sentBack = sum(txs.filter((t) => t.amount < 0 && t.category === F.WORK_IN), (t) => -t.amount);
    const w = wm();
    const waiting = w && w.awaiting ? w.awaiting(s).total : 0;
    const due = w && w.dueBack ? Math.max(0, round2(w.dueBack(s).total - waiting)) : 0;
    return { paid: out, back, sentBack, due, waiting };
  }

  /* What your records cover, so a gap is said out loud: where they start and stop, and any tax month inside
     that stretch with no bank lines at all (a missing statement). */
  function coverage(s, from, to, periods) {
    const dates = (s.transactions || []).map((t) => t.date).filter(Boolean).sort();
    const first = dates[0] || '';
    const last = dates[dates.length - 1] || '';
    const end = to < today() ? to : today();
    const quiet = first ? (periods || []).filter((p) => p.from > first && p.to < last && !dates.some((d) => d >= p.from && d <= p.to)) : [];
    return { first, last, quiet, startsLate: !!first && first > from, endsEarly: !!last && last < end && addDays(last, 14) < end };
  }

  /* A whole tax year: sources, kinds, month by month, work money and coverage. */
  function summary(s, y) {
    const r = typeof y === 'object' ? y : yearRange(y);
    const upto = r.to < today() ? r.to : today();
    const c = collect(s, r.from, r.to);
    const groups = groupLines(c.lines);
    const months = periodsBetween(r.from, upto < r.from ? r.from : upto, 6).filter((p) => p.from <= r.to).map((p) => {
      const ls = c.lines.filter((l) => l.date >= p.from && l.date <= p.to);
      const k = kindTotals(ls);
      return Object.assign({ from: p.from, to: p.to, count: ls.length, total: sum(ls, (l) => l.amount) }, k);
    });
    const kinds = kindTotals(c.lines);
    return {
      year: r, partial: r.to >= today(), upto, groups, months, kinds, lines: c.lines, invoices: c.invoices, bankIn: c.bankIn, paper: c.paper,
      total: round2(c.bankIn + c.paper), work: workMoney(s, c.txs), cover: coverage(s, r.from, r.to, months),
      unsorted: sum(c.lines.filter((l) => l.kind === 'unsorted'), (l) => l.amount), unsortedCount: c.lines.filter((l) => l.kind === 'unsorted').length,
    };
  }
  /* The wages from your employer (all your Salary lines when no employer is set) over any dates: the lines
     the Income page marks 'Wages from …'. Used by the evidence pack's wages summary. */
  function wageLines(s, from, to) {
    return collect(s, from, to).lines.filter((l) => l.key === 'wages').map((l) => ({ id: l.id, date: l.date, amount: l.amount }));
  }

  /* Universal Credit assessment periods, newest first, from the first money in your records to today. */
  function ucPeriods(s, day) {
    day = Math.min(31, Math.max(1, Math.round(Number(day)) || 1));
    const dates = (s.transactions || []).filter((t) => t.date && t.amount > 0 && F.counts(t) && t.date >= '2000-01-01' && t.date <= today()).map((t) => t.date).sort();
    if (!dates.length) return [];
    const t = today();
    const c = collect(s, dates[0], t);
    const pays = c.lines.filter((l) => l.key === 'wages');
    return periodsBetween(dates[0], t, day).map((p) => {
      const ls = c.lines.filter((l) => l.date >= p.from && l.date <= p.to);
      return {
        from: p.from, to: p.to, current: t >= p.from && t <= p.to, lines: ls, groups: groupLines(ls), total: sum(ls, (l) => l.amount),
        payDates: Array.from(new Set(pays.filter((l) => l.date >= p.from && l.date <= p.to).map((l) => l.date))),
      };
    }).reverse();
  }
  const hasBenefits = (s) => (s.incomeSources || []).some((x) => BENEFIT_WORDS.test((x.name || '') + ' ' + (x.from || ''))) || (s.transactions || []).some((t) => t.amount > 0 && benefitCat(s, t.category));
  /* The day of the month your Universal Credit usually lands, to help you find your assessment day. */
  function usualPayDay(s) {
    const ctx = benefitContext(s);
    const days = {};
    for (const t of s.transactions || []) {
      if (!(t.amount > 0) || !t.date || !F.counts(t)) continue;
      const c = classify(s, t, ctx);
      if (c.kind !== 'benefits' || !/universal|credit|\buc\b/i.test(c.label + ' ' + (t.description || ''))) continue;
      const d = +t.date.slice(8);
      days[d] = (days[d] || 0) + 1;
    }
    const best = Object.entries(days).sort((a, b) => b[1] - a[1] || a[0] - b[0])[0];
    return best && best[1] >= 2 ? +best[0] : 0;
  }

  /* ---------- the printable summary, the spreadsheet and the lines for each source ---------- */
  const n2 = (x) => (ev() ? ev().n2(x) : (Math.round((Number(x) || 0) * 100) / 100).toFixed(2));
  const periodText = (from, to) => short(from) + ' to ' + short(to);
  const NOTE = 'This is what your statements and records show. Check it against your payslips and your Universal Credit journal before you report anything.';

  const TYPE_LABEL = { wages: 'Wages', benefits: 'Benefits', freelance: 'Freelance and side work', other: 'Other', unsorted: 'Not sorted yet' };
  const linesFile = (g, i) => ({ name: pad(i + 1) + ' ' + ev().fileSafe(g.label, 50) + '.csv', rows: [['Date', 'From', 'Amount']].concat(g.lines.map((l) => [l.date, l.desc, n2(l.amount)]), [['Total', '', n2(g.total)]]) });
  /* Notes about what the figures can't see, in plain words (the page and the printable summary both use them). */
  function notesFor(sm) {
    const out = [];
    const c = sm.cover;
    if (c.startsLate) out.push('Your bank records start on ' + long(c.first) + ', so anything earlier is not here.');
    if (c.endsEarly) out.push('Your latest bank line is from ' + long(c.last) + '.');
    for (const q of c.quiet) out.push('There are no bank lines at all for ' + periodText(q.from, q.to) + '. Is a statement missing?');
    if (sm.unsortedCount) out.push(plural(sm.unsortedCount, 'payment') + ' (' + money(sm.unsorted) + ') ' + (sm.unsortedCount === 1 ? 'has' : 'have') + ' no category yet, so ' + (sm.unsortedCount === 1 ? 'it is' : 'they are') + ' under “Not sorted yet”.');
    if (sm.paper) out.push(money(sm.paper) + ' comes from paid invoices that are not in your bank records.');
    return out;
  }

  function reportTaxYear(s, sm) {
    const e = employer(s);
    const r = sm.year;
    const title = 'Tax year ' + r.label;
    const count = sm.groups.reduce((a, g) => a + g.count, 0);
    const w = sm.work;
    const workRows = [['You paid for ' + e.label, w.paid], [e.Label + ' paid you back', w.back]].concat(w.sentBack ? [['You sent back', w.sentBack]] : [], [['Still due back, as of today', w.due]]);
    const notes = notesFor(sm);
    const k = sm.kinds;
    const csv = [[title], ['Period', r.from, r.to], [], ['What came in'], ['Source', 'Type', 'Payments', 'Total']]
      .concat(sm.groups.map((g) => [g.label, TYPE_LABEL[g.kind], g.count, n2(g.total)]), [['Total came in', '', count, n2(sm.total)], [], ['Month by month'], ['Tax month', 'From', 'To', 'Wages', 'Benefits', 'Freelance and side work', 'Everything else', 'Total']],
        sm.months.map((m) => [periodText(m.from, m.to), m.from, m.to, n2(m.wages), n2(m.benefits), n2(m.freelance), n2(m.other), n2(m.total)]),
        [['Total', '', '', n2(k.wages), n2(k.benefits), n2(k.freelance), n2(k.other), n2(sm.total)], [], ['Work money, not your income']], workRows.map((x) => [x[0], n2(x[1])]),
        notes.length ? [[], ['Worth knowing']].concat(notes.map((x) => [x])) : [], [[], [NOTE]]);
    return {
      title, slug: 'Tax year ' + r.label.replace('/', '-'), csv,
      html: ev().printPage({
        title, lede: 'What came in between ' + long(r.from) + ' and ' + long(r.to) + (sm.partial ? ' (so far)' : '') + ', from my bank statements and records.',
        meta: [['Period', long(r.from) + ' to ' + long(r.to)], ['Made on', long(today())], ['Came in', money(sm.total)]],
        blocks: [
          { heading: 'What came in', cols: [{ label: 'Source' }, { label: 'Type' }, { label: 'Payments', num: true }, { label: 'Total', num: true }], rows: sm.groups.map((g) => [g.label, TYPE_LABEL[g.kind], String(g.count), money(g.total)]), total: ['Total came in', '', String(count), money(sm.total)] },
          { heading: 'Month by month', intro: 'Tax months run from the 6th to the 5th.', cols: [{ label: 'Tax month' }, { label: 'Wages', num: true }, { label: 'Benefits', num: true }, { label: 'Freelance', num: true }, { label: 'Everything else', num: true }, { label: 'Total', num: true }],
            rows: sm.months.map((m) => [periodText(m.from, m.to), money(m.wages), money(m.benefits), money(m.freelance), money(m.other), money(m.total)]), total: ['Total', money(k.wages), money(k.benefits), money(k.freelance), money(k.other), money(sm.total)] },
          { heading: 'Work money, not your income', intro: 'What you paid for work and what was paid back. It is your own money going out and coming home, so it is kept out of the figures above.', cols: [{ label: 'What' }, { label: 'Amount', num: true }], rows: workRows.map((x) => [x[0], money(x[1])]) },
        ].concat(notes.length ? [{ heading: 'Worth knowing', intro: notes.join(' ') }] : []),
        note: NOTE, foot: 'Made with The Ground Up on ' + long(today()) + '. Each source’s dates and amounts are in the zip’s “Lines by source” folder.',
      }),
      lines: sm.groups.map(linesFile),
    };
  }

  function reportUC(s, periods, day) {
    const title = 'Universal Credit months';
    const rows = [];
    const csv = [[title], ['Assessment periods start on the ' + ordinal(day)], [], ['Period from', 'Period to', 'Date', 'Source', 'From', 'Amount']];
    const blocks = [];
    for (const p of periods) {
      for (const l of p.lines) {
        rows.push(l);
        csv.push([p.from, p.to, l.date, l.label, l.desc, n2(l.amount)]);
      }
      csv.push([p.from, p.to, '', 'Total for this period', '', n2(p.total)]);
      blocks.push({
        heading: periodText(p.from, p.to) + (p.current ? ' (so far)' : ''),
        intro: p.payDates.length ? 'Wages came in on ' + p.payDates.map(short).join(' and ') + '.' : 'No wages came in during this period.',
        cols: [{ label: 'Date' }, { label: 'From' }, { label: 'Amount', num: true }],
        rows: p.lines.map((l) => [short(l.date), l.label, money(l.amount)]), total: ['Total', '', money(p.total)],
      });
    }
    csv.push([], [NOTE]);
    const groups = groupLines(rows);
    return {
      title, slug: 'Universal Credit months', csv,
      html: ev().printPage({
        title, lede: 'Money received in each assessment period, from my bank statements and records. Periods start on the ' + ordinal(day) + ' of each month.',
        meta: [['Periods', String(periods.length)], ['Made on', long(today())]], blocks, note: NOTE, foot: 'Made with The Ground Up on ' + long(today()) + '.',
      }),
      lines: groups.map(linesFile),
    };
  }

  /* The report for what's on screen: {title, slug, csv, html, lines}. null when there's nothing to say. */
  function currentReport(s) {
    if (!ev()) return null;
    if (ui.period === 'uc') {
      const day = +s.settings.ucDay;
      if (!(day >= 1 && day <= 31)) return null;
      const ps = ucPeriods(s, day);
      return ps.length ? reportUC(s, ps, day) : null;
    }
    const r = years(s).find((y) => y.key === ui.period);
    return r ? reportTaxYear(s, summary(s, r)) : null;
  }
  async function downloadCSV() {
    const rep = currentReport(store.state);
    if (!rep) return toast('There’s nothing to download yet.');
    const saved = await GU.ui.saveFile(new Blob([ev().csvText(rep.csv)], { type: 'text/csv' }), rep.slug + '.csv');
    if (saved) toast('Saved ' + rep.slug + '.csv');
  }
  async function downloadPack() {
    const rep = currentReport(store.state);
    if (!rep) return toast('There’s nothing to download yet.');
    const entries = [
      { name: '00 Summary.html', blob: new Blob([rep.html], { type: 'text/html' }) },
      { name: '00 Summary.csv', blob: new Blob([ev().csvText(rep.csv)], { type: 'text/csv' }) },
    ].concat(rep.lines.map((f) => ({ name: 'Lines by source/' + f.name, blob: new Blob([ev().csvText(f.rows)], { type: 'text/csv' }) })));
    const saved = await GU.ui.saveFile(await GU.ui.makeZip(entries), rep.slug + '.zip');
    if (saved) toast('Saved ' + rep.slug + '.zip');
  }

  /* ---------- the page ---------- */
  function ledgerHTML(sm) {
    const k = sm.kinds;
    const e = employer(store.state);
    const cell = (label, value, note) => '<div><span>' + esc(label) + '</span><b>' + esc(money(value)) + '</b><em>' + esc(note) + '</em></div>';
    const n = (kind) => plural(sm.groups.filter((g) => (kind === 'other' ? g.kind === 'other' || g.kind === 'unsorted' : g.kind === kind)).reduce((a, g) => a + g.count, 0), 'payment');
    return '<div class="ledger">' + cell('Came in', sm.total, sm.year.label + (sm.partial ? ' so far' : '')) +
      cell(e.set ? 'Wages from ' + e.label : 'Wages', k.wages, n('wages')) +
      (k.benefits ? cell('Benefits', k.benefits, n('benefits')) : '') +
      (k.freelance ? cell('Freelance and side work', k.freelance, n('freelance')) : '') +
      (k.other || !sm.total ? cell('Everything else', k.other, n('other')) : '') + '</div>';
  }
  // Money in that isn't earnings, so it's said out loud next to its total.
  const HINT = { 'c:Refunds': 'money back, not income', 'c:Savings & investments': 'savings paid out, not income', 'c:Gifts received': 'gifts, not earnings' };
  /* Each source with its bar and total, which opens to every payment in it (the dates and amounts behind the figure). */
  function sourcesHTML(sm) {
    if (!sm.groups.length) return '';
    const max = Math.max(1, ...sm.groups.map((g) => g.total));
    return '<section class="panel ty-sources"><header class="panel__head"><h2>Income by source</h2><span class="muted">open a source to see each payment</span></header>' +
      sm.groups.map((g) => {
        const key = sm.year.key + '|' + g.key;
        const note = plural(g.count, 'payment') + (g.kind === 'unsorted' ? ' · needs a category' : HINT[g.key] ? ' · ' + HINT[g.key] : '');
        return '<details class="ty-src" data-key="' + esc(key) + '"' + (ui.open.has(key) ? ' open' : '') + '><summary><span class="ty-src__name">' + esc(g.label) + '</span>' +
          '<span class="ty-src__track" aria-hidden="true"><i style="width:' + Math.max(0, (g.total / max) * 100) + '%"></i></span>' +
          '<span class="ty-src__val"><b>' + esc(money(g.total)) + '</b><small>' + esc(note) + '</small></span></summary>' + linesTable(g.lines) + '</details>';
      }).join('') +
      (sm.paper ? '<p class="field__help ty-sources__paper">' + esc(money(sm.paper) + ' of this is from invoices you sent that were paid but aren’t in your bank records.') + '</p>' : '') + '</section>';
  }
  function monthsHTML(sm) {
    if (!sm.months.length) return '';
    const k = sm.kinds;
    const cols = [['wages', 'Wages'], ['benefits', 'Benefits'], ['freelance', 'Freelance'], ['other', 'Other']].filter(([key]) => k[key] || (key === 'other' && !k.wages && !k.benefits && !k.freelance));
    const dash = '<span class="muted">–</span>';
    // The total comes straight after the month, so it's still in view when the table scrolls on a phone.
    return '<section class="panel"><header class="panel__head"><h2>Month by month</h2><span class="muted">tax months run from the 6th to the 5th</span></header><div class="table-wrap"><table class="tbl tbl--compact ty-months">' +
      '<thead><tr><th>Tax month</th><th class="num">Total</th>' + cols.map(([, l]) => '<th class="num">' + esc(l) + '</th>').join('') + '</tr></thead><tbody>' +
      sm.months.map((m) => '<tr><td class="nowrap">' + esc(dm(m.from) + ' to ' + dm(m.to)) + '</td><td class="num"><b>' + (m.total ? esc(money(m.total)) : dash) + '</b></td>' +
        cols.map(([key]) => '<td class="num">' + (m[key] ? esc(money(m[key])) : dash) + '</td>').join('') + '</tr>').join('') +
      '</tbody><tfoot><tr><td><b>Total</b></td><td class="num"><b>' + esc(money(sm.total)) + '</b></td>' + cols.map(([key]) => '<td class="num"><b>' + esc(money(k[key])) + '</b></td>').join('') + '</tr></tfoot></table></div></section>';
  }
  function linesTable(lines) {
    return '<div class="table-wrap"><table class="tbl tbl--compact"><thead><tr><th>Date</th><th>From</th><th class="num">Amount</th></tr></thead><tbody>' +
      lines.map((l) => '<tr><td class="nowrap">' + esc(long(l.date)) + '</td><td class="wrap">' + esc(l.desc || '') + ((l.paper || l.inv) ? ' ' + pill('Invoice', 'info') : '') + '</td><td class="num">' + esc(money(l.amount)) + '</td></tr>').join('') +
      '</tbody></table></div>';
  }
  function invoicesHTML(sm) {
    if (!sm.invoices.length) return '';
    return '<section class="panel"><header class="panel__head"><h2>Invoices you sent that were paid</h2><span class="muted">your own side work</span></header><div class="table-wrap"><table class="tbl tbl--compact"><thead><tr><th>Paid</th><th>Invoice</th><th>Where it shows</th><th class="num">Amount</th></tr></thead><tbody>' +
      sm.invoices.map((x) => '<tr><td class="nowrap">' + esc(long(x.date)) + '</td><td class="wrap">' + esc([x.ref, x.party || x.title].filter(Boolean).join(' · ')) + '</td><td class="wrap">' +
        (x.tx ? esc('In your bank on ' + long(x.tx.date) + ', counted there') : esc('Not in your bank records, counted here')) + '</td><td class="num">' + esc(money(x.amount)) + '</td></tr>').join('') + '</tbody></table></div></section>';
  }
  function workHTML(s, sm) {
    const w = sm.work;
    const e = employer(s);
    if (!(w.paid > 0) && !(w.back > 0) && !(w.due > 0)) return '';
    const row = (label, v, note) => '<div class="ty-work__row"><span>' + esc(label) + (note ? '<em>' + esc(note) + '</em>' : '') + '</span><b>' + fig(v) + '</b></div>';
    return '<section class="panel ty-work"><header class="panel__head"><h2>' + icon('briefcase') + 'Work money</h2>' + pill('Not your income', 'info') + '</header><div class="panel__body">' +
      '<p class="ty-work__lede">' + esc('What you paid for ' + e.label + ' and what came back. It’s your own money going out and coming home, so it’s left out of everything on this page.') + '</p>' +
      row('You paid for ' + e.label, w.paid) + row(e.Label + ' paid you back', w.back, w.sentBack > 0 ? 'less ' + money(w.sentBack) + ' you sent back' : '') + row('Still due back', w.due, 'as of today' + (w.waiting > 0 ? ', after ' + money(w.waiting) + ' waiting to be confirmed' : '')) +
      '</div><div class="panel__foot"><a class="btn btn--sm btn--ghost" href="#work-back">Get paid back' + icon('chevron') + '</a></div></section>';
  }
  function coverHTML(sm) {
    const bits = notesFor(sm);
    if (!bits.length) return '';
    return '<section class="panel"><header class="panel__head"><h2>' + icon('alert') + 'Worth knowing</h2></header><div class="panel__body"><ul class="ty-bits">' + bits.map((b) => '<li>' + esc(b) + '</li>').join('') + '</ul>' +
      '<p class="ty-bits__links"><a class="link" href="#transactions">Open Bank' + icon('chevron') + '</a></p></div></section>';
  }

  function yearHTML(s, sm) {
    const r = sm.year;
    if (!sm.groups.length && !(sm.work.paid || sm.work.back)) {
      return '<section class="panel">' + emptyState({ icon: 'in', title: 'Nothing came in for ' + r.label, text: sm.cover.first ? 'Your bank records run from ' + esc(long(sm.cover.first)) + ' to ' + esc(long(sm.cover.last)) + '.' : 'Import a bank statement and I’ll add up what came in.',
        action: sm.cover.first ? '' : '<button type="button" class="btn btn--primary" data-import>' + icon('upload') + 'Import a statement</button>' }) + '</section>';
    }
    return ledgerHTML(sm) +
      '<div class="cols cols--main-side"><div class="stack">' + sourcesHTML(sm) + monthsHTML(sm) + invoicesHTML(sm) + '</div>' +
      '<aside class="stack">' + workHTML(s, sm) + coverHTML(sm) + '</aside></div>';
  }

  function ucFormHTML(s) {
    const set = +s.settings.ucDay;
    const usual = usualPayDay(s);
    return '<section class="panel ty-uc-set"><form data-uc-form><header class="panel__head"><h2>Your assessment period</h2></header><div class="panel__body">' +
      '<label class="field__label" for="uc-day">Which day of the month does your Universal Credit assessment period start?</label>' +
      '<div class="ty-uc-set__row"><input type="number" id="uc-day" name="day" min="1" max="31" inputmode="numeric" required value="' + (set >= 1 && set <= 31 ? set : '') + '" placeholder="e.g. 7" data-keep-focus>' +
      '<button type="submit" class="btn btn--primary">Save</button>' + (set ? '<button type="button" class="btn" data-uc-cancel>Cancel</button>' : '') + '</div>' +
      '<p class="field__help">' + esc('You’ll find it in your Universal Credit journal. ' + (usual ? 'Your payments have been landing around the ' + ordinal(usual) + '. ' : '') + 'It’s kept on every device you use, and you can change it at any time.') + '</p></div></form></section>';
  }
  function ucHTML(s) {
    const day = +s.settings.ucDay;
    if (!(day >= 1 && day <= 31) || ui.ucEdit) return ucFormHTML(s);
    const all = ucPeriods(s, day);
    if (!all.length) return '<section class="panel">' + emptyState({ icon: 'in', title: 'No money in yet', text: 'Import a bank statement and I’ll sort what came in into your assessment periods.' }) + '</section>';
    const shown = ui.ucAll ? all : all.slice(0, 12);
    const withWages = all.some((p) => p.payDates.length);
    const e = employer(s);
    // Which pay dates fall in which period, for the latest few.
    const dated = all.filter((p) => p.payDates.length).slice(0, 3);
    const payLine = dated.length ? (e.set ? 'Wages from ' + e.label + ': ' : 'Pay: ') + dated.map((p) => p.payDates.map(short).join(' and ') + ' ' + (p.payDates.length > 1 ? 'fall' : 'falls') + ' in ' + periodText(p.from, p.to)).join('; ') + '.' : '';
    const periodHTML = (p, i) => {
      const flag = !withWages ? '' : p.payDates.length > 1 ? pill(p.payDates.length + ' pay dates', 'warn', 'alert') : !p.payDates.length && !p.current ? pill('No pay date', 'muted') : '';
      const k = 'uc|' + p.from;
      const pays = !withWages ? '' : p.payDates.length ? (e.set ? 'Wages from ' + e.label : 'Pay') + ' came in on ' + p.payDates.map(short).join(' and ') + '.' : p.current ? 'No pay date yet.' : 'No pay date in this period.';
      return '<details class="panel panel--details ty-period" data-key="' + esc(k) + '"' + (ui.open.has(k) || (i === 0 && !ui.open.has('uc-closed')) ? ' open' : '') + '>' +
        '<summary class="panel__head"><h2>' + esc(periodText(p.from, p.to)) + '</h2>' + (p.current ? pill('This one, so far', 'info') : '') + flag + '<span class="spacer"></span><b>' + fig(p.total) + '</b></summary>' +
        (pays ? '<p class="ty-period__pays">' + esc(pays) + '</p>' : '') +
        (p.lines.length ? '<div class="table-wrap"><table class="tbl tbl--compact"><thead><tr><th>Date</th><th>From</th><th class="num">Amount</th></tr></thead><tbody>' +
          p.groups.map((g) => g.lines.map((l, j) => '<tr' + (j === 0 && p.groups.length > 1 ? ' class="ty-first"' : '') + '><td class="nowrap">' + esc(long(l.date)) + '</td><td class="wrap">' + esc(g.label) + ((l.paper || l.inv) ? ' ' + pill('Invoice', 'info') : '') + '</td><td class="num">' + esc(money(l.amount)) + '</td></tr>').join('')).join('') +
          '</tbody><tfoot><tr><td colspan="2"><b>Total for this period</b></td><td class="num"><b>' + esc(money(p.total)) + '</b></td></tr></tfoot></table></div>' : '<div class="panel__body"><p class="muted">Nothing came in during this period.</p></div>') +
        '</details>';
    };
    return '<p class="ty-uc-line">' + esc('Assessment periods start on the ' + ordinal(day) + ' of each month.') + ' <button type="button" class="link link--btn" data-uc-edit>Change</button></p>' +
      '<p class="ty-uc-line ty-uc-line--help">' + esc(payLine || 'Money is listed on the day it reached your account, from each source.') + '</p>' +
      '<div class="stack">' + shown.map(periodHTML).join('') + '</div>' +
      (all.length > shown.length ? '<div class="more-row"><button type="button" class="btn" data-uc-all>Show the ' + (all.length - shown.length) + ' earlier periods</button></div>' : '');
  }

  function render(root) {
    const s = store.state;
    const ys = years(s);
    if (!ui.period || (ui.period !== 'uc' && !ys.some((y) => y.key === ui.period))) ui.period = ys[0].key;
    const showUC = !!s.settings.ucDay || hasBenefits(s) || ui.period === 'uc';
    if (!showUC && ui.period === 'uc') ui.period = ys[0].key;
    const opts = ys.map((y) => ({ value: y.key, label: y.label })).concat(showUC ? [{ value: 'uc', label: 'Universal Credit months' }] : []);
    const uc = ui.period === 'uc';
    const sm = uc ? null : summary(s, ys.find((y) => y.key === ui.period));
    const ready = uc ? +s.settings.ucDay >= 1 : sm.groups.length > 0;
    root.innerHTML = GU.view.head({
      eyebrow: 'Money so far',
      title: 'Tax year',
      text: uc ? 'What came in during each Universal Credit assessment period, from your statements and records.' : 'What came in during a tax year, from your statements and records: wages, benefits and everything else, month by month.',
      actions: (ready ? '<button type="button" class="btn" data-dl-csv>' + icon('download') + 'Download CSV</button><button type="button" class="btn" data-dl-pack>' + icon('file') + 'Printable summary</button>' : '') +
        '<button type="button" class="btn btn--primary" data-evidence>' + icon('folder') + 'Evidence pack</button>',
    }) +
      '<div class="toolbar ty-toolbar">' + chips('period', opts, ui.period) + '</div>' +
      '<p class="note-line ty-note">' + icon('info') + '<span>' + esc(NOTE) + '</span></p>' +
      (uc ? ucHTML(s) : yearHTML(s, sm));

    root.addEventListener('click', (e) => {
      const c = e.target.closest('[data-chip="period"]');
      if (c) {
        ui.period = c.dataset.value;
        ui.ucEdit = false;
        return GU.render();
      }
      if (e.target.closest('[data-dl-csv]')) return downloadCSV();
      if (e.target.closest('[data-dl-pack]')) return downloadPack();
      if (e.target.closest('[data-evidence]')) return ev() && ev().open({});
      if (e.target.closest('[data-import]')) return GU.tabs.transactions.importStatement();
      if (e.target.closest('[data-uc-edit]')) {
        ui.ucEdit = true;
        return GU.render();
      }
      if (e.target.closest('[data-uc-cancel]')) {
        ui.ucEdit = false;
        return GU.render();
      }
      if (e.target.closest('[data-uc-all]')) {
        ui.ucAll = true;
        return GU.render();
      }
    });
    // Remember which sources and periods you've opened, so they stay open when the page redraws.
    root.addEventListener('toggle', (e) => {
      const d = e.target;
      if (!d || !d.matches || !d.matches('details[data-key]')) return;
      const k = d.getAttribute('data-key');
      if (d.open) ui.open.add(k);
      else ui.open.delete(k);
      if (!d.open && k.startsWith('uc|')) ui.open.add('uc-closed');
    }, true);
    const form = root.querySelector('[data-uc-form]');
    if (form) {
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        const n = Math.round(Number(form.elements.day.value));
        if (!(n >= 1 && n <= 31)) return form.elements.day.reportValidity();
        const was = store.state.settings.ucDay;
        store.commit((st) => (st.settings.ucDay = n));
        ui.ucEdit = false;
        GU.render();
        toast('Assessment periods now start on the ' + ordinal(n), { action: 'Undo', onAction: () => store.commit((st) => (st.settings.ucDay = was == null ? null : was)) });
      });
    }
  }

  GU.taxyear = { years, yearRange, periodAt, periodsBetween, summary, ucPeriods, wageLines, collect, classify, groupLines, paidInvoices, workMoney, hasBenefits, report: currentReport };
  GU.tabs.taxyear = { label: 'Tax year', short: 'Tax year', icon: 'coin', part: 'home', render };
})();
