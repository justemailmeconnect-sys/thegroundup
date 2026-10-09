/* The Ground Up: the calendar file (GU.calendar).
   A web page can't ring your phone, but your calendar app can: this gathers every date the site knows into one
   .ics file (RFC 5545) that Android, iPhone and Google Calendar all open, with an alert on each. It is a snapshot of
   today, so download it again after you change things.

   Where the dates come from (checked against the code, not just the Today page):
   - GU.agenda.timeline, the same list Today uses: tasks, bills and direct debits, invoices to pay and the ones the
     business pays, money owed to you, income, documents ending, warranties ending, return-by dates, debt payments,
     Work and Home projects, things to buy, and the due dates on your own categories.
   - What the timeline misses, added here: later dates of a bill that is already late (the timeline stops at the late one),
     when to send or chase on Get paid back (GU.workMoney.dueBack), when a plan is wanted by (Home › Plans), and the tax
     year (5 April, the 31 January Self Assessment deadline for people with side work, and the Universal Credit
     assessment period starts from Home › Money › Tax year).
   Every date is an all-day event with its own alerts. Nothing relies on RRULE: a monthly bill is twelve events, so a bill
   on the 31st lands on the last day of the shorter months, exactly as the Bills page shows. A UID names the record (and the
   date, for things that come round again), so downloading again updates the dates that moved in most calendar apps
   rather than adding a second copy. Amounts are left out unless asked for, and so are references, holders and file names.

   GU.calendar.build(options) -> the .ics text      options: { kinds, part, months, alarms, includeAmounts, skip }
   GU.calendar.download(options) -> saves it (GU.ui.saveFile)     GU.calendar.count(options) -> how many dates
   GU.calendar.openDialog(preset) -> the same choices as a dialog, from anywhere (preset: the same options)
   kinds: ['warranty'] and so on; part: 'home' | 'work' | 'both'; skip: ['home:income'] leaves one kind of one part out.
   alarms: 'smart' (the usual for each kind), 'none', 'day' (on the day), '1d' or '1w'. months: 1 to 24, default 12.
   The Settings panel keeps its choices in settings.calendar: { skip, alarms, amounts }. */
(function () {
  'use strict';
  const GU = window.GU;
  const { esc, today, addDays, addMonths, daysUntil, fmtLongDate, money, plural, isISO } = GU.util;
  const store = GU.store;

  const CRLF = '\r\n';
  const MONTHS_AHEAD = 12;
  const WARRANTY_MONTHS = 120; // a warranty is one date, often years away and not going to move: every one goes in, not only the next 12 months
  const ALARM_HOUR = 9; // alerts ring at 9am, whatever the day they're counted from
  const DEFAULT_SKIP = ['home:income']; // pay days are in your calendar already for most people: off until asked for

  /* ---------- the kinds of date, in the order the checklist shows them ---------- */
  const ORDER = {
    home: ['bill', 'debt', 'invoice', 'owed', 'document', 'warranty', 'return', 'task', 'homeproject', 'item', 'plan', 'tax', 'income'],
    work: ['bill', 'invoice', 'ktk', 'claim', 'request', 'document', 'warranty', 'return', 'task', 'project', 'item'],
  };
  /* The checklist wording: [in Home, in Work]. */
  const LABELS = {
    bill: ['Bills and direct debits', 'Regular costs'],
    debt: ['Debt payments'],
    invoice: ['Invoices to pay', 'Invoices you pay and get back'],
    owed: ['Money owed to you'],
    ktk: ['Invoices the company pays'],
    claim: ['Get paid back: things to send or chase'],
    request: ['Things to buy'],
    document: ['Documents that expire', 'Contracts and documents ending'],
    warranty: ['Warranties ending'],
    return: ['Last days to return things'],
    task: ['To-dos with a date', 'Tasks with a date'],
    homeproject: ['Home projects'],
    project: ['Work projects'],
    item: ['Dates in your own categories'],
    plan: ['Things you’re saving for'],
    tax: ['Tax year dates'],
    income: ['Pay days and expected income'],
  };
  const KEYS = Object.keys(ORDER).flatMap((part) => ORDER[part].map((k) => part + ':' + k));
  /* How many days before each kind rings. 0 is on the day. Anything not listed: the day before. */
  const USUAL = { document: [30, 7], warranty: [30, 7], return: [2], task: [0] };
  const ALARMS = [
    { value: 'smart', label: 'The usual for each kind' },
    { value: 'none', label: 'No alerts' },
    { value: 'day', label: 'On the day' },
    { value: '1d', label: '1 day before' },
    { value: '1w', label: '1 week before' },
  ];
  const ALARM_IDS = ALARMS.map((a) => a.value);
  const ALIASES = { default: 'smart', usual: 'smart', off: 'none', on: 'day', today: 'day', '0': 'day', '1': '1d', '7': '1w', day1: '1d', week: '1w' };

  const coOf = (s) => {
    const e = GU.workMoney && GU.workMoney.employer ? GU.workMoney.employer(s) : null;
    return e ? { set: e.set, label: e.label, Label: e.Label, short: e.short } : { set: false, label: 'the company', Label: 'The company', short: '' };
  };
  const labelOf = (kind, part, co) => {
    if (kind === 'ktk') return co.set ? 'Invoices ' + co.short + ' pays' : LABELS.ktk[0];
    const l = LABELS[kind] || [kind];
    return part === 'work' && l[1] ? l[1] : l[0];
  };

  /* ---------- text safety ---------- */
  /* One line of plain text: no control characters, no stray surrogates, one space between words, and numbers that
     could identify an account (sort codes, long runs of digits) hidden. */
  function clean(v) {
    let t = String(v == null ? '' : v);
    if (t.toWellFormed) t = t.toWellFormed();
    else t = t.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?:[^\uD800-\uDBFF]|^)[\uDC00-\uDFFF]/g, (m) => (m.length > 1 ? m[0] : ''));
    return t
      .replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g, ' ')
      .replace(/[\u202a-\u202e\u2066-\u2069]/g, '') // text-direction overrides would flip the words around them in a calendar
      .replace(/\b\d{2}[- ]\d{2}[- ]\d{2}\b(?![-/ ]\d)/g, '…')
      .replace(/\b\d{4}[ -]\d{4}[ -]\d{4}(?:[ -]\d{1,4})?\b/g, '…')
      .replace(/\d{6,}/g, '…')
      .replace(/\s+/g, ' ')
      .trim();
  }
  const clip = (t, n) => {
    const c = Array.from(t);
    return c.length > n ? c.slice(0, n - 1).join('').trim() + '…' : t;
  };
  /* Takes written-out amounts (£35, $12.50, 40 GBP) out of text. Used when amounts are off. */
  const MONEY = /[£$€¥₹]\s?\d[\d,]*(?:\.\d+)?(?:\s?[kKmM]\b)?|\b\d[\d,]*(?:\.\d+)?\s?(?:GBP|USD|EUR|pounds?|quid)\b/g;
  const noMoney = (t) => t.replace(MONEY, '').replace(/\s{2,}/g, ' ').replace(/\s+([.,;:!?])/g, '$1').replace(/\(\s*\)/g, '').trim();

  /* RFC 5545 TEXT: backslash, semicolon, comma and line breaks are escaped. */
  function escapeText(v) {
    return String(v == null ? '' : v).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r\n|\r|\n/g, '\\n');
  }
  const octets = (cp) => (cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4);
  /* Lines are at most 75 octets: longer ones continue on the next line after a space. A character is never split. */
  function fold(line) {
    let out = '';
    let used = 0;
    for (const ch of line) {
      const n = octets(ch.codePointAt(0));
      if (used + n > 75) {
        out += CRLF + ' ';
        used = 1;
      }
      out += ch;
      used += n;
    }
    return out;
  }
  const prop = (name, value) => fold(name + ':' + value);
  const compact = (iso) => iso.replace(/-/g, '');
  const stamp = (d) => d.toISOString().replace(/[-:]|\.\d{3}/g, '');
  const uidPart = (v) => String(v == null ? '' : v).replace(/[^A-Za-z0-9._-]/g, '');

  /* The alert's time as an offset from the start of the all-day event (midnight): 9am, `days` before. */
  function trigger(days) {
    const hours = days * 24 - ALARM_HOUR;
    if (hours <= 0) return 'PT' + -hours + 'H';
    const d = Math.floor(hours / 24);
    const h = hours % 24;
    return '-P' + (d ? d + 'D' : '') + (h || !d ? 'T' + h + 'H' : '');
  }

  /* ---------- gathering the dates ---------- */
  const find = (state, c, id) => (state[c] || []).find((x) => x.id === id) || null;
  const path = (tab) => {
    try {
      return tab && GU.parts && GU.parts.pathOf ? GU.parts.pathOf(tab) : '';
    } catch (e) {
      return '';
    }
  };

  /* A date from the Today timeline, as {id, kind, part, date, title, lines, amount, tab}, or null to leave it out. */
  function fromTimeline(state, it, co) {
    const rec = it.ref ? find(state, it.ref.c, it.ref.id) : null;
    const part = it.part === 'work' ? 'work' : 'home';
    const AK = GU.agenda.KINDS[it.kind];
    const e = { kind: it.kind, part, date: it.date, tab: it.tab || (AK && AK.tab) || null, amount: null, lines: [] };
    const on = fmtLongDate(it.date);
    const abs = (n) => (Number.isFinite(Number(n)) && Number(n) !== 0 ? Math.abs(Number(n)) : null);
    const suffix = /^(.*) (starts|due)$/.exec(it.title || '');
    switch (it.kind) {
      case 'task': {
        if (!rec) return null;
        const list = find(state, 'todoLists', rec.listId);
        return Object.assign(e, { id: 'task.' + rec.id, title: 'To do: ' + rec.title, lines: ['A to-do for ' + on + (list ? ', on your ' + list.name + ' list' : '') + '.'] });
      }
      case 'bill': {
        if (!rec || rec.review) return null; // a bill I only guessed at from your statements isn't yours yet
        const how = rec.autopay ? (rec.method === 'Standing order' ? 'Standing order' : rec.method === 'Card (automatic)' ? 'Card payment' : 'Direct debit') : 'Pay';
        const lines = [rec.autopay ? 'Leaves your account on ' + on + ' by ' + how.toLowerCase() + '.' : 'Due on ' + on + '. You pay this one by hand, then tick it off.'];
        if (part === 'work' && GU.workMoney && GU.workMoney.payerOf) lines.push(GU.workMoney.payerOf(rec, 'bills') === 'company' ? co.Label + ' pays this one.' : 'You pay it and ' + co.label + ' pays you back.');
        return Object.assign(e, { id: 'bill.' + rec.id + '.' + compact(it.date), title: how + ': ' + (rec.name || 'a bill'), lines, amount: abs(rec.amount) });
      }
      case 'invoice':
        if (!rec) return null;
        return Object.assign(e, { id: 'invoice.' + rec.id, title: 'Pay invoice: ' + (rec.title || rec.party || 'an invoice'), amount: abs(rec.amount),
          lines: ['An invoice is due on ' + on + '.'].concat(part === 'work' ? ['You pay it, then ' + co.label + ' pays you back.'] : []) });
      case 'ktk':
        if (!rec) return null;
        return Object.assign(e, { id: 'ktk.' + rec.id, title: co.Label + ' pays: ' + (rec.title || rec.party || 'an invoice'), lines: ['An invoice is due on ' + on + '. ' + co.Label + ' pays this one.'] });
      case 'owed':
        if (!rec) return null;
        return Object.assign(e, { id: 'owed.' + rec.id, title: 'Payment due to you: ' + (rec.party || rec.title || 'an invoice'), amount: abs(it.amount),
          lines: ['A payment you’re owed is due on ' + on + '. Chase it if it hasn’t arrived.'] });
      case 'income':
        if (!rec) return null;
        return Object.assign(e, { id: 'income.' + rec.id + '.' + compact(it.date), title: 'Money in: ' + (rec.name || 'income'), amount: abs(rec.amount), lines: ['Expected on ' + on + '.'] });
      case 'document':
        if (!rec) return null;
        return Object.assign(e, { id: 'document.' + rec.id, title: 'Expires: ' + (rec.title || 'a document'), lines: ['Expires on ' + on + '. Start the renewal early.'] });
      case 'warranty':
        if (!rec) return null;
        return Object.assign(e, { id: 'warranty.' + rec.id, title: 'Warranty ends: ' + (rec.title || rec.party || 'an item'), lines: ['The warranty ends on ' + on + '. Make any claims before then.'] });
      case 'return':
        if (!rec) return null;
        return Object.assign(e, { id: 'return.' + rec.id, title: 'Last day to return: ' + (rec.title || rec.party || 'this'), amount: abs(rec.amount),
          lines: ['Take it back by ' + on + '. If you’re keeping it, choose Keep it and the reminders stop.'] });
      case 'debt':
        if (!rec) return null;
        return Object.assign(e, { id: 'debt.' + rec.id + '.' + compact(it.date), title: 'Pay: ' + (rec.name || 'a debt'), amount: abs(it.amount), lines: ['A payment to ' + (rec.name || 'a lender') + ' is due on ' + on + '.'] });
      case 'project':
      case 'homeproject': {
        if (!rec) return null;
        const starts = !!suffix && suffix[2] === 'starts';
        return Object.assign(e, { id: 'project.' + rec.id + '.' + (starts ? 'start' : 'due'), title: (starts ? 'Project starts: ' : 'Project due: ') + (rec.name || (suffix && suffix[1]) || 'a project'),
          lines: [(it.kind === 'project' ? 'A Work' : 'A Home') + ' project ' + (starts ? 'starts' : 'is due') + ' on ' + on + '.'] });
      }
      case 'request':
        if (!rec) return null;
        return Object.assign(e, { id: 'request.' + rec.id, title: (rec.status === 'ordered' ? 'Due to arrive: ' : 'Needed: ') + (rec.title || 'something to get'),
          lines: [(rec.status === 'ordered' ? 'Ordered, due to arrive' : 'Something ' + co.label + ' asked you to get, needed') + ' on ' + on + '.'] });
      case 'item': {
        if (!rec) return null;
        const sec = find(state, 'sections', rec.sectionId);
        return Object.assign(e, { id: 'item.' + rec.id, title: 'Due: ' + (rec.title || 'something'), lines: ['A date on your ' + (sec ? sec.name : 'own') + ' page: ' + on + '.'] });
      }
      default:
        if (!it.title) return null;
        return Object.assign(e, { id: 'x.' + it.kind + '.' + (rec ? rec.id : uidPart(clean(it.title)).slice(0, 40)) + '.' + compact(it.date), title: (AK && AK.label ? AK.label + ': ' : '') + it.title, lines: ['Due ' + on + '.'] });
    }
  }

  /* Every date between today and `months` ahead: {id, kind, part, date, title, lines, amount, tab, alarms?}, oldest first. */
  function collect(state, months) {
    const t = today();
    const end = addMonths(t, months);
    const co = coOf(state);
    const out = [];
    const put = (e, until) => {
      if (e && isISO(e.date) && e.date >= t && e.date <= (until || end) && e.title) out.push(e);
    };
    // Each source stands on its own: one bad record must not take the rest (or the Settings page that counts them) down.
    const source = (fn) => {
      try {
        fn();
      } catch (err) {
        console.error(err);
      }
    };
    const F = GU.finance;

    // What Today shows, which already follows work or home, who pays, and what's done or paid.
    source(() => {
      for (const it of GU.agenda.timeline(state, daysUntil(end))) source(() => put(fromTimeline(state, it, co)));
    });

    // Warranties that end after the 12 months (a 3 or 5 year guarantee): the same lines, with the same lanes, just further out.
    // A shorter file than a year was asked for on purpose, so it stays shorter.
    source(() => {
      if (months < MONTHS_AHEAD) return;
      const far = addMonths(t, WARRANTY_MONTHS);
      const later = (state.paperwork || []).filter((p) => isISO(p.warrantyUntil) && p.warrantyUntil > end && p.warrantyUntil <= far);
      if (!later.length) return;
      const slim = Object.assign({}, state);
      for (const k of Object.keys(slim)) if (Array.isArray(slim[k])) slim[k] = [];
      slim.paperwork = later;
      for (const it of GU.agenda.timeline(slim, daysUntil(far))) if (it.kind === 'warranty') source(() => put(fromTimeline(state, it, co), far));
    });

    // The timeline stops at a bill that is already late. Its later dates are still coming.
    source(() => {
      for (const b of state.bills || []) {
        if (b.active === false || b.review || b.autopay || !b.nextDue || b.nextDue >= t || !F || !F.occurrences) continue;
        const w = GU.parts && GU.parts.isWorkBill && GU.parts.isWorkBill(b);
        for (const d of F.occurrences(b.nextDue, b.frequency, b.anchorDay, t, end)) {
          const lines = ['Due on ' + fmtLongDate(d) + '. You pay this one by hand, then tick it off.'];
          if (w && GU.workMoney && GU.workMoney.payerOf) lines.push(GU.workMoney.payerOf(b, 'bills') === 'company' ? co.Label + ' pays this one.' : 'You pay it and ' + co.label + ' pays you back.');
          put({ id: 'bill.' + b.id + '.' + compact(d), kind: 'bill', part: w ? 'work' : 'home', date: d, title: 'Pay: ' + (b.name || 'a bill'), lines, amount: Number(b.amount) || null, tab: w ? 'work-bills' : 'bills' });
        }
      }
    });

    // Get paid back: when to send what you paid for, and when to chase what you sent.
    source(() => {
      const W = GU.workMoney;
      if (!W || !W.dueBack) return;
      const e = W.employer(state);
      const d = W.dueBack(state);
      if (d.toSend.length && d.oldest) {
        const nudge = addDays(d.oldest.date, e.nudgeDays);
        put({ id: 'claim.send.' + d.oldest.p.id, kind: 'claim', part: 'work', date: nudge < t ? t : nudge, tab: 'work-back', amount: d.toSendTotal || null,
          title: 'Send to ' + co.label + ': things you paid for',
          lines: [plural(d.toSend.length, 'thing') + ' you paid for ' + (d.toSend.length === 1 ? 'is' : 'are') + ' waiting to go to ' + co.label + ', so they can pay you back.'] });
      }
      for (const pk of d.packs) {
        if (!(pk.left > 0) || !pk.date) continue;
        const chase = addDays(pk.date, e.chaseDays + 1);
        put({ id: 'claim.chase.' + uidPart(pk.key), kind: 'claim', part: 'work', date: chase < t ? t : chase, tab: 'work-back', amount: pk.left || null,
          title: 'Chase ' + co.label + ': not paid back yet',
          lines: ['You sent ' + plural(pk.items.length, 'thing') + ' to ' + co.label + ' on ' + fmtLongDate(pk.date) + ' and it has not been paid back. Time to remind them.'] });
      }
    });

    // Plans: the date you want each thing by.
    source(() => {
      const open = GU.costs && GU.costs.isOpen ? GU.costs.isOpen : (i) => (i.status || 'open') === 'open';
      for (const i of state.costIdeas || []) {
        if (!isISO(i.wantBy) || i.movedToRequest || !open(i) || (GU.parts && GU.parts.ideaPart ? GU.parts.ideaPart(i) : 'home') !== 'home') continue;
        put({ id: 'plan.' + i.id, kind: 'plan', part: 'home', date: i.wantBy, title: 'Want by: ' + (i.name || 'a plan'), tab: 'plans', amount: Number(i.cost) || null,
          lines: ['The date you set for something you’re saving for: ' + fmtLongDate(i.wantBy) + '.'] });
      }
    });

    // The tax year (6 April to 5 April), Self Assessment for people with side work, and Universal Credit periods.
    source(() => {
      const yearOf = (iso) => +iso.slice(0, 4);
      const label = (a) => a + '/' + String(a + 1).slice(2);
      const side = !!(state.settings && state.settings.business) || (state.paperwork || []).some((p) => p.kind === 'invoice-out' && p.context !== 'work');
      // Only for people who keep their money here: a new, empty site has no use for tax year dates.
      const keepsMoney = (state.transactions || []).length || (state.incomeSources || []).length;
      for (let y = yearOf(t); keepsMoney && y <= yearOf(end); y++) {
        put({ id: 'tax.end.' + y, kind: 'tax', part: 'home', date: y + '-04-05', tab: 'taxyear', title: 'Tax year ends', lines: ['The ' + label(y - 1) + ' tax year ends today. What came in: Money › Tax year.'] });
        if (side) {
          put({ id: 'tax.sa.' + y, kind: 'tax', part: 'home', date: y + '-01-31', tab: 'taxyear', title: 'Self Assessment deadline', alarms: [30, 7],
            lines: ['The usual deadline to file your online Self Assessment return for ' + label(y - 2) + ' and pay what you owe. Check GOV.UK if yours differs.'] });
        }
      }
      const ucDay = Math.round(Number(state.settings && state.settings.ucDay));
      if (ucDay >= 1 && ucDay <= 31) {
        for (let m = t.slice(0, 7), n = 0; m <= end.slice(0, 7) && n < 26; m = addMonths(m + '-01', 1).slice(0, 7), n++) {
          const last = new Date(Date.UTC(+m.slice(0, 4), +m.slice(5), 0)).getUTCDate();
          put({ id: 'tax.uc.' + m.replace('-', ''), kind: 'tax', part: 'home', date: m + '-' + String(Math.min(ucDay, last)).padStart(2, '0'), tab: 'taxyear', title: 'Universal Credit period starts', alarms: [1],
            lines: ['A new assessment period starts today. What came in: Money › Tax year.'] });
        }
      }
    });

    out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.title < b.title ? -1 : a.title > b.title ? 1 : 0));
    return out;
  }

  /* collect() is the slow part and the Settings page asks for it every time it draws: keep the last answer until something changes. */
  let memo = null;
  function gather(state, months) {
    const live = state === store.state;
    const key = live ? store.rev + '|' + today() + '|' + months : null;
    if (key && memo && memo.key === key) return memo.list;
    const list = collect(state, months);
    if (key) memo = { key, list };
    return list;
  }

  /* ---------- the options ---------- */
  function savedChoices(state) {
    const c = ((state || store.state).settings || {}).calendar;
    const o = c && typeof c === 'object' && !Array.isArray(c) ? c : {};
    return {
      skip: Array.isArray(o.skip) ? o.skip.filter((k) => typeof k === 'string') : DEFAULT_SKIP.slice(),
      alarms: ALARM_IDS.includes(o.alarms) ? o.alarms : 'smart',
      amounts: o.amounts === true,
    };
  }
  /* Whatever was asked for, as exact choices: which kind of which part, what rings, whether amounts go in. */
  function normalise(options) {
    const o = options || {};
    const state = o.state || store.state;
    const saved = savedChoices(state);
    const part = o.part === 'home' || o.part === 'work' ? o.part : 'both';
    const kinds = Array.isArray(o.kinds) ? o.kinds : null;
    // Kinds named outright win over the saved choices; with none named, the saved (or given) ones apply.
    const skip = new Set(Array.isArray(o.skip) ? o.skip : kinds ? [] : saved.skip);
    let alarms = ALIASES[String(o.alarms)] || o.alarms;
    if (!ALARM_IDS.includes(alarms)) alarms = saved.alarms;
    const months = Math.min(24, Math.max(1, Math.round(Number(o.months)) || MONTHS_AHEAD));
    return {
      state, months, alarms, part, skip, kinds,
      amounts: typeof o.includeAmounts === 'boolean' ? o.includeAmounts : saved.amounts,
      now: o.now instanceof Date ? o.now : new Date(),
    };
  }
  const wanted = (n, e) => (n.part === 'both' || n.part === e.part) && (!n.kinds || n.kinds.includes(e.kind)) && !n.skip.has(e.part + ':' + e.kind);

  /* The dates a download would hold, ready to write: {uid, date, summary, description, part, kind, alarms (days before)}. */
  function events(options) {
    const n = normalise(options);
    const seen = new Map();
    return gather(n.state, n.months).filter((e) => wanted(n, e)).map((e) => {
      const shown = n.amounts && e.amount ? e.amount : null;
      let title = clip(clean(e.title), 90);
      if (!n.amounts) title = noMoney(title);
      if (shown) title += ' (' + money(shown) + ')';
      const where = path(e.tab);
      const lines = e.lines.map((l) => (n.amounts ? l : noMoney(l)));
      if (shown) lines.push('Amount: ' + money(shown) + '.');
      if (e.part === 'work') lines.unshift('Work' + (coOf(n.state).set ? ' · ' + coOf(n.state).short : ''));
      if (where) lines.push('In The Ground Up: ' + where + '.');
      let uid = 'gu.' + uidPart(e.id) + '@groundup.invalid';
      const dup = seen.get(uid) || 0;
      seen.set(uid, dup + 1);
      if (dup) uid = uid.replace('@', '-' + (dup + 1) + '@');
      let days = e.alarms || USUAL[e.kind] || [1];
      if (n.alarms === 'none') days = [];
      else if (n.alarms === 'day') days = [0];
      else if (n.alarms === '1d') days = [1];
      else if (n.alarms === '1w') days = [7];
      // An alert that should already have rung is left out, so importing never sets off a burst of old ones.
      const [y, m, d] = e.date.split('-').map(Number);
      days = days.filter((k) => new Date(y, m - 1, d - k, ALARM_HOUR, 0, 0) > n.now);
      return { uid, date: e.date, summary: title, description: lines.map((l) => clean(l)).filter(Boolean).join('\n'), part: e.part, kind: e.kind, alarms: days };
    });
  }

  /* ---------- the file ---------- */
  function make(options) {
    const n = normalise(options);
    const list = events(options);
    const stampNow = stamp(n.now);
    const seq = Math.floor(n.now.getTime() / 60000); // grows with every download, so a later file wins over an earlier one
    const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//The Ground Up//Dates that matter//EN', 'CALSCALE:GREGORIAN', 'X-WR-CALNAME:The Ground Up'];
    for (const e of list) {
      lines.push('BEGIN:VEVENT', prop('UID', e.uid), 'DTSTAMP:' + stampNow, 'LAST-MODIFIED:' + stampNow, 'SEQUENCE:' + seq,
        'DTSTART;VALUE=DATE:' + compact(e.date), 'DTEND;VALUE=DATE:' + compact(addDays(e.date, 1)),
        prop('SUMMARY', escapeText(e.summary)));
      if (e.description) lines.push(prop('DESCRIPTION', escapeText(e.description)));
      lines.push('CATEGORIES:' + (e.part === 'work' ? 'Work' : 'Home'), 'TRANSP:TRANSPARENT');
      for (const k of e.alarms) lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', prop('DESCRIPTION', escapeText(e.summary)), 'TRIGGER:' + trigger(k), 'END:VALARM');
      lines.push('END:VEVENT');
    }
    lines.push('END:VCALENDAR');
    return { text: lines.join(CRLF) + CRLF, events: list };
  }
  const build = (options) => make(options).text;
  const count = (options) => events(options).length;

  /* Inside Claude, files are saved through the page's downloads permission, which doesn't take .ics: they arrive in a .zip. */
  const inClaude = () => !!(window.claude && typeof window.claude.use === 'function');

  let saving = false;
  async function download(options) {
    let made;
    try {
      made = make(options);
    } catch (err) {
      console.error(err);
      GU.ui.toast('Couldn’t make the calendar file just now. Nothing has changed.');
      return false;
    }
    const { text, events: list } = made;
    if (!list.length) {
      GU.ui.toast('There are no dates to add yet.');
      return false;
    }
    if (saving) return false; // a second tap while the first is still being saved
    saving = true;
    let ok = false;
    try {
      ok = await GU.ui.saveFile(new Blob([text], { type: 'text/calendar' }), 'the-ground-up-' + today() + '.ics');
    } finally {
      saving = false;
    }
    if (ok) GU.ui.toast('Saved your calendar file with ' + plural(list.length, 'date') + '. ' + (inClaude() ? 'Open the .ics file inside the zip to add them.' : 'Open it to add them to your calendar.'));
    return ok;
  }

  /* ---------- the choices: the Settings panel and the dialog share them ---------- */
  const calIcon = '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3.5" y="5" width="17" height="15.5" rx="3"/><path d="M3.5 10h17M8 3v4M16 3v4"/></svg>';

  /* What the controls hold: the kinds left out, what rings, whether amounts go in. */
  function modelFrom(preset) {
    const saved = savedChoices(store.state);
    const p = preset || {};
    let skip = new Set(saved.skip);
    const part = p.part === 'home' || p.part === 'work' ? p.part : null;
    if (Array.isArray(p.skip)) skip = new Set(p.skip);
    else if (Array.isArray(p.kinds) || part) skip = new Set(KEYS.filter((k) => (part && k.split(':')[0] !== part) || (Array.isArray(p.kinds) && !p.kinds.includes(k.split(':')[1]))));
    let alarms = ALIASES[String(p.alarms)] || p.alarms;
    if (!ALARM_IDS.includes(alarms)) alarms = saved.alarms;
    return { skip, alarms, amounts: typeof p.includeAmounts === 'boolean' ? p.includeAmounts : saved.amounts };
  }
  const optionsOf = (m) => ({ skip: Array.from(m.skip), alarms: m.alarms, includeAmounts: m.amounts, months: MONTHS_AHEAD });
  /* How many dates there are for each kind of each part ('home:bill': 12), whatever is ticked. */
  function counts(state) {
    const c = {};
    for (const e of gather(state || store.state, MONTHS_AHEAD)) c[e.part + ':' + e.kind] = (c[e.part + ':' + e.kind] || 0) + 1;
    return c;
  }
  /* How many of a file's dates are warranties that end after the 12 months. */
  const laterCount = (options) => {
    const edge = addMonths(today(), MONTHS_AHEAD);
    return events(options).filter((e) => e.kind === 'warranty' && e.date > edge).length;
  };
  function countText(n, later) {
    if (n && !later) return '<b>' + esc(plural(n, 'date')) + '</b> in the next ' + MONTHS_AHEAD + ' months';
    if (n) return '<b>' + esc(plural(n, 'date')) + '</b>: ' + (later === n ? 'warranties that end after the next ' + MONTHS_AHEAD + ' months' : n - later + ' in the next ' + MONTHS_AHEAD + ' months and ' + esc(plural(later, 'warranty', 'warranties')) + ' ending after that');
    // Nothing ticked is not the same as nothing to add.
    if (Object.keys(counts(store.state)).length) return 'Nothing is ticked. Tick the kinds of date you want in your calendar.';
    return 'Nothing to add yet. Give a bill, document, warranty or to-do a date and it shows up here.';
  }

  /* The kinds of one part that have dates, and whether they're all ticked: the link on each group ticks or unticks the lot. */
  const shown = (part, c) => ORDER[part].filter((k) => c[part + ':' + k]).map((k) => part + ':' + k);
  const allLabel = (model, part, c) => (shown(part, c).every((k) => !model.skip.has(k)) ? 'Untick all' : 'Tick all');

  /* The checklist, the alerts, the amounts switch, the live count and the button. ns keeps ids apart when two are on a page. */
  function controlsHTML(model, ns, noButton) {
    const state = store.state;
    const c = counts(state);
    const co = coOf(state);
    const group = (part, title, ico) => {
      const rows = ORDER[part].filter((k) => c[part + ':' + k]).map((k) => {
        const key = part + ':' + k;
        return '<label class="check cal-check"><input type="checkbox" data-cal-key="' + esc(key) + '"' + (model.skip.has(key) ? '' : ' checked') + '><span>' + esc(labelOf(k, part, co)) + ' <b class="cal-n">(' + c[key] + ')</b></span></label>';
      }).join('');
      return '<div class="cal-group cal-group--' + part + '" role="group" aria-labelledby="' + ns + '-g-' + part + '"><div class="cal-group__head"><h3 id="' + ns + '-g-' + part + '">' + GU.ui.icon(ico) + esc(title) + '</h3>' +
        (rows ? '<button type="button" class="link link--btn cal-all" data-cal-all="' + part + '">' + allLabel(model, part, c) + '</button>' : '') + '</div>' +
        (rows || '<p class="muted cal-none">Nothing with a date yet.</p>') + '</div>';
    };
    const total = count(optionsOf(model));
    return '<div class="cal-groups">' + group('home', 'Home', 'home') + group('work', co.set ? 'Work · ' + co.short : 'Work', 'briefcase') + '</div>' +
      '<div class="field"><label class="field__label" for="' + ns + '-alarms">Alerts</label>' +
      '<select id="' + ns + '-alarms" data-cal-alarms>' + GU.ui.selectOptions(ALARMS, model.alarms) + '</select>' +
      '<p class="field__help cal-smart"' + (model.alarms === 'smart' ? '' : ' hidden') + ' data-cal-smart>Documents and warranties ring 30 days and 7 days before, returns 2 days before, to-dos on the day, and everything else the day before.</p>' +
      '<p class="field__help">Your calendar app rings these, at 9am. It also decides how they sound.</p></div>' +
      '<div class="field"><span class="field__label" id="' + ns + '-amt-l">Include amounts</span>' +
      '<div class="seg" role="radiogroup" aria-labelledby="' + ns + '-amt-l">' +
      '<label><input type="radio" name="' + ns + '-amt" value="0" data-cal-amounts' + (model.amounts ? '' : ' checked') + '><span>Off</span></label>' +
      '<label><input type="radio" name="' + ns + '-amt" value="1" data-cal-amounts' + (model.amounts ? ' checked' : '') + '><span>On</span></label></div>' +
      '<p class="field__help">Off keeps every amount out of the file. Your calendar app may sync it to its own cloud, so only turn this on if you’re happy for it to hold them.</p></div>' +
      '<p class="cal-count" data-cal-count aria-live="polite">' + countText(total, laterCount(optionsOf(model))) + '</p>' +
      (noButton ? '' : '<div class="cal-actions">' + downloadButton(total) + '</div>');
  }
  const downloadButton = (total) => '<button type="button" class="btn btn--primary cal-download" data-cal-download' + (total ? '' : ' disabled') + '>' + GU.ui.icon('download') + 'Download calendar file</button>';
  /* Reads a click or change on the controls into the model. Returns true if the model changed. */
  function readControl(model, el) {
    if (el.matches('[data-cal-key]')) {
      if (el.checked) model.skip.delete(el.dataset.calKey);
      else model.skip.add(el.dataset.calKey);
    } else if (el.matches('[data-cal-alarms]')) model.alarms = ALARM_IDS.includes(el.value) ? el.value : 'smart';
    else if (el.matches('[data-cal-amounts]')) model.amounts = el.value === '1';
    else if (el.matches('[data-cal-all]')) {
      const keys = shown(el.dataset.calAll, counts(store.state));
      const every = keys.every((k) => !model.skip.has(k));
      for (const k of keys) {
        if (every) model.skip.add(k);
        else model.skip.delete(k);
      }
    } else return false;
    return true;
  }
  /* Brings the boxes, the count line, the button and the note about the usual alerts up to date in place. */
  function refresh(root, model) {
    const c = counts(store.state);
    root.querySelectorAll('[data-cal-key]').forEach((box) => (box.checked = !model.skip.has(box.dataset.calKey)));
    root.querySelectorAll('[data-cal-all]').forEach((b) => (b.textContent = allLabel(model, b.dataset.calAll, c)));
    const n = count(optionsOf(model));
    const line = root.querySelector('[data-cal-count]');
    if (line) line.innerHTML = countText(n, laterCount(optionsOf(model)));
    root.querySelectorAll('[data-cal-download]').forEach((b) => (b.disabled = !n));
    const smart = root.querySelector('[data-cal-smart]');
    if (smart) smart.hidden = model.alarms !== 'smart';
  }
  /* The same wiring for the panel and the dialog: a change or a click on the controls updates the model, then onChange(el). */
  function wireControls(root, model, onChange) {
    root.addEventListener('change', (e) => {
      const el = e.target.closest && e.target.closest('[data-cal-key],[data-cal-alarms],[data-cal-amounts]');
      if (el && readControl(model, el)) onChange(el);
    });
    root.addEventListener('click', (e) => {
      const el = e.target.closest && e.target.closest('[data-cal-all]');
      if (el && readControl(model, el)) onChange(el);
    });
  }

  function stepsHTML() {
    return '<ul class="cal-steps">' +
      '<li><b>Android:</b> open the file you downloaded (from the notification, or in Files › Downloads). Choose Google Calendar, then pick which calendar to add the dates to.</li>' +
      '<li><b>iPhone and iPad:</b> tap the file in Files or Safari’s downloads, then tap <b>Add All</b> and pick a calendar.</li>' +
      '<li><b>Google Calendar on a computer:</b> go to calendar.google.com, open <b>Settings › Import &amp; export</b>, choose the file and pick a calendar.</li></ul>' +
      '<p class="muted cal-tip">Pick a calendar of its own (call it The Ground Up), so you can delete the lot and start again if you like.</p>' +
      '<p class="tip cal-snapshot">' + GU.ui.icon('info') + '<span><b>This is a snapshot.</b> Download it again after you change things. Dates that moved replace the old ones in most calendar apps, but anything you delete or finish here is not taken out of your calendar for you.</span></p>' +
      (inClaude() ? '<p class="tip">' + GU.ui.icon('info') + '<span>In the Claude app the file arrives inside a .zip. Open the zip, then the .ics file inside it.</span></p>' : '');
  }

  /* ---------- the Settings panel ---------- */
  function panelHTML() {
    try {
      return panelBody();
    } catch (err) {
      console.error(err); // the rest of Settings still draws
      return '';
    }
  }
  function panelBody() {
    const model = modelFrom(null);
    return '<section class="panel cal-panel" id="calendar" aria-labelledby="cal-title"><header class="panel__head"><h2 id="cal-title">' + calIcon + 'Calendar</h2>' +
      '<span class="muted">dates that matter, in your phone’s calendar</span></header>' +
      '<div class="panel__body stack cal-body"><p>Put your bills, expiry dates, warranties, returns and deadlines into your phone’s calendar and it will ring before they arrive. This page can’t send alerts to your phone by itself, but your calendar app can.</p>' +
      controlsHTML(model, 'cal') + '<div class="cal-how"><h3>Adding it to your calendar</h3>' + stepsHTML() + '</div></div></section>';
  }
  /* Saves the choices as you make them (they sync with the rest of your settings), and keeps the keyboard where it was. */
  function wirePanel(root) {
    const panel = root.querySelector('#calendar');
    if (!panel) return;
    const model = modelFrom(null);
    wireControls(panel, model, (el) => {
      const again = el.matches('[data-cal-key]') ? '[data-cal-key="' + el.dataset.calKey + '"]' : el.matches('[data-cal-all]') ? '[data-cal-all="' + el.dataset.calAll + '"]'
        : el.matches('[data-cal-alarms]') ? '[data-cal-alarms]' : '[data-cal-amounts][value="' + (model.amounts ? 1 : 0) + '"]';
      refresh(panel, model);
      store.commit((s) => {
        s.settings.calendar = { skip: Array.from(model.skip), alarms: model.alarms, amounts: model.amounts };
      }, { history: false });
      // Saving redraws Settings: put the focus back on the control that was used.
      const next = document.querySelector('#calendar ' + again);
      if (next) next.focus({ preventScroll: true });
    });
    panel.addEventListener('click', (e) => {
      if (e.target.closest('[data-cal-download]')) download(optionsOf(model));
    });
  }

  /* ---------- the dialog ---------- */
  function openDialog(preset) {
    const model = modelFrom(preset);
    const d = GU.ui.openDialog({
      title: 'Add dates to my calendar',
      className: 'dlg--cal',
      body: '<div class="stack cal-body"><p class="dlg__intro">Your calendar app can ring you before a date arrives. This page can’t, so it makes a file your calendar app opens.</p>' +
        controlsHTML(model, 'caldlg', true) + '<details class="cal-how"><summary>How to add it to your calendar</summary>' + stepsHTML() + '</details></div>',
      footer: '<span class="spacer"></span><button type="button" class="btn" data-close>Close</button>' + downloadButton(count(optionsOf(model))),
    });
    wireControls(d.el, model, () => refresh(d.el, model));
    d.el.addEventListener('click', async (e) => {
      if (!e.target.closest('[data-cal-download]')) return;
      if (await download(optionsOf(model))) d.close();
    });
    return d;
  }

  /* ---------- from Today ---------- */
  // Anything marked data-cal-open opens the dialog. data-cal-open="warranty" starts with only that kind ticked.
  document.addEventListener('click', (e) => {
    const b = e.target.closest && e.target.closest('[data-cal-open]');
    if (!b) return;
    e.preventDefault();
    const kinds = String(b.dataset.calOpen || '').split(',').map((k) => k.trim()).filter(Boolean);
    openDialog(kinds.length ? { kinds } : null);
  });
  /* Today's Needs attention card gets a small link underneath. Today is drawn by js/tabs/today.js, which this doesn't touch:
     the link is added after each draw, and if the page changes shape it simply isn't there. */
  function addTodayLink() {
    const view = document.querySelector('#view .view--today');
    if (!view || view.querySelector('[data-cal-link]')) return;
    if (!count({})) return; // nothing with a date yet: a link to an empty list is only noise
    const card = Array.from(view.querySelectorAll('.side-card')).find((c) => /^needs attention$/i.test(((c.querySelector('h2') || {}).textContent || '').trim()));
    const host = card || view.querySelector('.later');
    if (!host) return;
    const p = document.createElement('p');
    p.className = 'side-card__foot cal-link-row';
    p.innerHTML = '<button type="button" class="link link--btn cal-link" data-cal-open data-cal-link>' + calIcon + 'Add dates to my calendar</button>';
    host.appendChild(p);
  }
  let queued = false;
  const app = document.getElementById('app');
  if (app && typeof MutationObserver === 'function') {
    new MutationObserver(() => {
      if (queued) return;
      queued = true;
      Promise.resolve().then(() => {
        queued = false;
        try {
          addTodayLink();
        } catch (err) {
          console.error(err);
        }
      });
    }).observe(app, { childList: true, subtree: true });
  }

  GU.calendar = { build, download, count, events, counts, openDialog, panelHTML, wirePanel, escapeText, fold, trigger, KEYS, ALARMS };
})();
