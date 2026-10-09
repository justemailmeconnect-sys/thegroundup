/* The Ground Up: charge alerts. Two things worth a second look in your bank statements:
     1. a regular payment that went up in price (a subscription, a gym, the rent), and
     2. the same payment taken twice.
   It would rather say nothing than cry wolf, so both are strict (the rules are written out in RULES below and in
   skin/alerts.md). An alert resolves itself when a matching refund turns up. 'Looks right' and 'Ask for a refund'
   are kept in state.alertStates (one record per alert, by the alert's own id): they sync, they are in backups, Clear
   examples leaves them alone, and they never go into Undo history. Everything runs on this device. */
(function () {
  'use strict';
  const GU = window.GU;
  const { esc, uid, today, addDays, toDays, isISO, money, fmtDate, plural, round2 } = GU.util;
  const F = GU.finance;
  const store = GU.store;
  const { icon, pill, toast } = GU.ui;

  /* Everything that decides what counts. Pence are whole numbers; days are whole numbers of days. */
  const RULES = {
    horizon: 120, // an event older than this is forgotten
    // The same payment taken twice
    doubleMin: 500, // at least £5.00
    doubleWithin: 3, // lines this close (same day counts) are one cluster
    doubleLone: 7, // another payment of the same amount this close either side means a rhythm, not a mistake
    doubleHabit: 120, // ...and so do two or more such close pairs elsewhere in this many days either side
    doubleActive: 60, // still worth a look this long after the last charge
    // A regular payment that went up
    riseMin: 50, // pence: the larger of this...
    riseShare: 0.03, // ...and this share of the old price
    riseMaxRatio: 2, // more than double is a trial ending or a plan change, not a price rise
    riseOldRuns: 2, // payments at the old price, one after another, just before the rise
    riseNewRuns: 3, // at most this many payments at the new price so far
    riseSteady: 0.75, // of the (up to 12) payments before the rise, this share were at the old price
    // Refunds
    refundDays: 30,
  };
  // The cadences a price rise is looked for in: [gap range in days, payments a year, 'a month', how long the news stays fresh].
  const CADENCES = [
    { id: 'weekly', lo: 5, hi: 9, perYear: 52, unit: 'a week', fresh: 35 },
    { id: 'fortnightly', lo: 12, hi: 16, perYear: 26, unit: 'every 2 weeks', fresh: 35 },
    { id: '4-weekly', lo: 27, hi: 29, perYear: 13, unit: 'every 4 weeks', fresh: 56 },
    { id: 'quarterly', lo: 84, hi: 98, perYear: 4, unit: 'every 3 months', fresh: 100 },
    { id: 'yearly', lo: 350, hi: 380, perYear: 1, unit: 'a year', fresh: 100 },
  ];
  const MONTHLY = { id: 'monthly', lo: 24, hi: 38, perYear: 12, unit: 'a month', fresh: 61 };

  // Everyday spending is left out of price rises, as recurring.js leaves it out of bills. Cash, savings, debts and gifts are left out of doubles.
  const EVERYDAY = (GU.recurring && GU.recurring.SKIP_CATEGORIES) || ['Groceries', 'Eating out', 'Transport', 'Shopping', 'Cash', 'Transfers', 'Debt repayments', 'Fees & charges', 'Savings & investments', 'Gifts & donations', 'Personal care', 'Travel'];
  const NOT_DOUBLES = ['Cash', 'Transfers', 'Savings & investments', 'Debt repayments', 'Gifts & donations'];
  const HELD = /\b(pending|declined|card authori[sz]ation|auth(?:ori[sz]ation)? hold|pre-?auth)\b/i;

  /* ---------- reading a bank line ---------- */
  const keyFor = (desc) => (GU.recurring && GU.recurring.keyOf ? GU.recurring.keyOf(desc) : String(desc || '').toLowerCase().replace(/[^a-z0-9& ]+/g, ' ').replace(/\s+/g, ' ').trim().split(' ').slice(0, 3).join(' '));
  const titleCase = (s) => s.replace(/\b[a-z]/g, (c) => c.toUpperCase()).replace(/\bO2\b/i, 'O2');
  const infoCache = new Map();
  /* What a description says, worked out once per distinct description: the company, its words, whether the bank still has it on hold. */
  function info(desc) {
    let r = infoCache.get(desc);
    if (r) return r;
    const raw = String(desc || '');
    r = {
      key: keyFor(raw),
      held: HELD.test(raw),
      flat: ' ' + raw.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim() + ' ',
    };
    if (infoCache.size > 30000) infoCache.clear();
    infoCache.set(desc, r);
    return r;
  }
  const pounds = (cents) => money(cents / 100);
  const when = (iso) => fmtDate(iso, { short: true });
  /* 3 Oct and 4 Oct: the dates of a few payments, written out. */
  const dateList = (dates) => {
    const d = dates.map(when);
    return d.length > 1 ? d.slice(0, -1).join(', ') + ' and ' + d[d.length - 1] : d[0] || '';
  };
  /* What the earliest letters of every description have in common, to search the Bank page for. */
  function commonStart(descs, fallback) {
    let p = String(descs[0] || '').toLowerCase();
    for (const d of descs.slice(1)) {
      const x = String(d || '').toLowerCase();
      let i = 0;
      while (i < p.length && i < x.length && p[i] === x[i]) i++;
      p = p.slice(0, i);
    }
    p = p.replace(/[\s·*\-–]+$/, '').trim();
    return p.length >= 3 ? p : fallback;
  }

  /* ---------- finding them ---------- */
  /* detect(state, {today}) -> alerts, newest first. Pure: no memory, nothing saved. compute() is what the app uses. */
  function detect(st, opts) {
    const t = (opts && opts.today) || today();
    const now = toDays(t);
    const txs = (st && st.transactions) || [];
    const rules = (st && st.rules) || [];
    const ignored = new Set((st && st.settings && st.settings.ignoredBills) || []);
    // The name you gave a bill you already track beats a name worked out from a bank line.
    const named = new Map();
    for (const b of (st && st.bills) || []) {
      if (b.context === 'work') continue;
      for (const k of [b.foundKey, keyFor(b.payee || ''), keyFor(b.name || '')]) if (k && b.name && !named.has(k)) named.set(k, b.name);
    }

    // One pass over the bank lines: payments out grouped by company, and money in by amount (for refunds and for your own transfers).
    const groups = new Map();
    const into = new Map();
    for (const x of txs) {
      const amount = Number(x.amount);
      if (!amount || !isISO(x.date) || x.pending || x.declined) continue;
      const day = toDays(x.date);
      if (day > now + 1 || F.isWork(x) || x.category === F.TRANSFER) continue; // a future date, work money, a move between your own accounts
      const d = info(x.description);
      if (d.held || !d.key || d.key.length < 2) continue;
      const cents = Math.round(Math.abs(amount) * 100);
      const line = { id: x.id, date: x.date, day, cents, key: d.key, flat: d.flat, account: x.account, category: x.category || '', desc: x.description, demo: !!x.demo };
      if (amount > 0) {
        let list = into.get(cents);
        if (!list) into.set(cents, (list = []));
        list.push(line);
      } else {
        let list = groups.get(d.key);
        if (!list) groups.set(d.key, (list = []));
        list.push(line);
      }
    }
    const words = (key) => key.replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter((w) => w.length >= 2);
    /* A refund: money back from the same company for the same amount, no later than 30 days after. */
    const refundFor = (key, amounts, from, to) => {
      const w = words(key);
      for (const c of amounts) {
        for (const x of into.get(c) || []) {
          if (x.day >= from && x.day <= to + RULES.refundDays && (x.key === key || (w.length && w.every((k) => x.flat.includes(' ' + k + ' '))))) return x;
        }
      }
      return null;
    };
    /* The other half of a move between your own accounts: the same amount arriving in a different account within 2 days. */
    const movedBetween = (l) => (into.get(l.cents) || []).some((x) => x.account !== l.account && Math.abs(x.day - l.day) <= 2);
    /* Savings pots, transfers and card payments by what they say, when the line has no category yet. */
    const ruledOut = (l, skip) => {
      const c = l.category || F.categorise(l.desc, -1, rules);
      return skip.includes(c);
    };
    const alerts = [];
    const nameOf = (key) => named.get(key) || titleCase(key);

    for (const [key, all] of groups) {
      all.sort((a, b) => a.day - b.day);
      if (all[all.length - 1].day < now - RULES.horizon - 100) continue; // nothing lately from this company
      const doubles = doublesIn(key, all);
      for (const a of doubles) alerts.push(a);
      const rise = riseIn(key, all);
      if (rise) alerts.push(rise);
    }
    alerts.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.id < b.id ? -1 : 1));
    return alerts;

    /* The same company, the same amount to the penny, taken out twice (or three times) within 3 days. */
    function doublesIn(key, all) {
      const out = [];
      const byCents = new Map();
      for (const l of all) {
        if (l.cents < RULES.doubleMin || l.day < now - RULES.horizon - RULES.doubleHabit) continue;
        let list = byCents.get(l.cents);
        if (!list) byCents.set(l.cents, (list = []));
        list.push(l);
      }
      for (const [cents, ls] of byCents) {
        if (ls.length < 2) continue;
        // Chains of payments no more than 3 days apart.
        const chains = [];
        for (const l of ls) {
          const c = chains[chains.length - 1];
          if (c && l.day - c[c.length - 1].day <= RULES.doubleWithin) c.push(l);
          else chains.push([l]);
        }
        for (const c of chains) {
          if (c.length < 2 || c.length > 3) continue; // a long chain is a habit
          const first = c[0];
          const last = c[c.length - 1];
          if (last.day < now - RULES.horizon) continue;
          if (c.some((l) => l.account !== first.account)) continue; // the same payment imported under two accounts is not a double charge
          if (c.some((l) => l.flat !== first.flat)) continue; // the bank has to have written them identically; anything else may be two different payments
          const others = ls.filter((l) => !c.includes(l));
          // Another payment of this amount close by, either side: a daily or weekly rhythm.
          if (others.some((l) => l.day >= first.day - RULES.doubleLone && l.day <= last.day + RULES.doubleLone)) continue;
          // Pairs like this elsewhere (two regular payments for the same thing): a habit.
          const near = others.filter((l) => l.day >= first.day - RULES.doubleHabit && l.day <= last.day + RULES.doubleHabit);
          if (near.filter((l) => near.some((m) => m !== l && Math.abs(m.day - l.day) <= RULES.doubleLone)).length >= 2) continue;
          if (movedBetween(first) || ruledOut(first, NOT_DOUBLES)) continue;
          const refund = refundFor(key, [cents], last.day, last.day);
          const active = now - last.day <= RULES.doubleActive;
          const n = c.length;
          const dates = c.map((l) => l.date);
          const same = dates.every((d) => d === dates[0]);
          const merchant = nameOf(key);
          out.push({
            id: 'dc|' + key + '|' + first.date + '|' + cents,
            kind: 'double-charge', level: 'warn', title: merchant + ' took ' + pounds(cents) + (n === 2 ? ' twice' : ' ' + n + ' times'),
            detail: same ? (n === 2 ? 'Twice' : n + ' times') + ' on ' + when(first.date) + ', the same amount.' : 'On ' + dateList(dates) + ', the same amount each time.',
            merchant, dates, amounts: c.map((l) => round2(l.cents / 100)), txIds: c.map((l) => l.id), perYear: 0,
            date: last.date, account: first.account, active, demo: c.every((l) => l.demo), search: commonStart(c.map((l) => l.desc), key.split(' ')[0]),
            refund: refund ? { txId: refund.id, date: refund.date, amount: round2(refund.cents / 100) } : null,
          });
        }
      }
      return out;
    }

    /* A payment at a steady price, then the same payment for more. */
    function riseIn(key, all) {
      if (ignored.has(key) || all.length < 3) return null;
      // A payment taken twice in a few days is a double charge (above), not part of the run.
      const seq = [];
      for (const l of all) {
        const p = seq[seq.length - 1];
        if (p && Math.abs(p.cents - l.cents) <= 1 && l.day - p.day <= RULES.doubleWithin) continue;
        seq.push(l);
      }
      if (seq.length < 3) return null;
      const last = seq[seq.length - 1];
      let s = seq.length - 1; // where the new price starts
      while (s > 0 && Math.abs(seq[s - 1].cents - last.cents) <= 1) s--;
      if (s < RULES.riseOldRuns || seq.length - s > RULES.riseNewRuns) return null;
      const before = seq[s - 1];
      let o = s - 1; // where the old price starts
      while (o > 0 && Math.abs(seq[o - 1].cents - before.cents) <= 1) o--;
      if (s - o < RULES.riseOldRuns) return null;
      const oldC = before.cents;
      const newC = last.cents;
      const rise = newC - oldC;
      if (rise < Math.max(RULES.riseMin, Math.ceil(oldC * RULES.riseShare)) || newC > oldC * RULES.riseMaxRatio) return null;
      // Mostly steady before: a bill whose amount normally varies isn't a price rise.
      const back = seq.slice(Math.max(0, s - 12), s);
      if (back.filter((x) => Math.abs(x.cents - oldC) <= 1).length / back.length < RULES.riseSteady) return null;
      // A steady rhythm, week by week, month by month or year by year, through the last few payments at the old price and into the new.
      const run = seq.slice(Math.max(o, s - 5));
      const gaps = [];
      for (let i = 1; i < run.length; i++) gaps.push(run[i].day - run[i - 1].day);
      const months = (x) => +x.date.slice(0, 4) * 12 + +x.date.slice(5, 7);
      // Exactly 28 days, twice or more, is every 4 weeks: no calendar month does that twice running.
      const fourWeekly = gaps.length >= 2 && gaps.every((g) => g === 28);
      const monthly = !fourWeekly && gaps.every((g) => g >= MONTHLY.lo && g <= MONTHLY.hi) && run.every((x, i) => !i || months(x) - months(run[i - 1]) === 1);
      const cadence = monthly ? MONTHLY : CADENCES.find((c) => gaps.every((g) => g >= c.lo && g <= c.hi));
      if (!cadence) return null;
      const first = seq[s];
      if (first.day < now - RULES.horizon) return null;
      const startsHere = seq.slice(s);
      if (ruledOut(last, EVERYDAY) || movedBetween(last)) return null;
      const refund = refundFor(key, [rise, newC], first.day, last.day);
      const perYear = round2((rise * cadence.perYear) / 100);
      const merchant = nameOf(key);
      const yr = perYear >= 10 ? money(perYear, { whole: true }) : money(perYear);
      return {
        id: 'pr|' + key + '|' + first.date + '|' + newC,
        kind: 'price-rise', level: 'warn', title: merchant + ' went up in price',
        detail: 'From ' + pounds(oldC) + ' to ' + pounds(newC) + ' ' + cadence.unit + ' on ' + when(first.date) + ', about ' + yr + ' a year more.',
        merchant, dates: run.map((l) => l.date), amounts: [round2(oldC / 100), round2(newC / 100)], txIds: run.map((l) => l.id), perYear,
        date: first.date, account: last.account, active: now - first.day <= cadence.fresh, demo: startsHere.every((l) => l.demo), cadence: cadence.id,
        search: commonStart(run.map((l) => l.desc), key.split(' ')[0]),
        refund: refund ? { txId: refund.id, date: refund.date, amount: round2(refund.cents / 100) } : null,
      };
    }
  }

  /* ---------- remembering what was found ---------- */
  /* A cheap fingerprint of everything the finding reads: the bank lines (date, amount, words, category, account), the
     rules, the bills you track and the 'not a bill' list. */
  function fingerprint(st) {
    const txs = st.transactions || [];
    let h = 0x811c9dc5 ^ txs.length;
    const mix = (n) => {
      h = Math.imul(h ^ n, 0x01000193);
    };
    const text = (s) => {
      s = s == null ? '' : String(s);
      for (let i = 0; i < s.length; i++) mix(s.charCodeAt(i));
      mix(0x7c);
    };
    for (let i = 0; i < txs.length; i++) {
      const x = txs[i];
      text(x.id);
      text(x.date);
      text(x.description);
      text(x.category);
      text(x.account);
      mix(Math.round((Number(x.amount) || 0) * 100));
      mix((x.pending ? 1 : 0) | (x.declined ? 2 : 0));
    }
    text((st.settings && st.settings.ignoredBills || []).join(','));
    text((st.rules || []).length);
    text((st.bills || []).map((b) => (b.name || '') + (b.foundKey || '')).join(','));
    return (h >>> 0).toString(36) + '.' + txs.length;
  }

  let found = null; // {state, rev, fp, day, alerts}: what the last look at the bank lines found
  let shown = null; // {found, key, list}: the same, with each alert's status
  const revOf = (st) => (store.state === st ? store.rev || 0 : null);

  /* Every alert, with a status: 'open', 'following' (a to-do is open), 'followed' (that to-do is done), 'dismissed'
     ('Looks right') or 'refunded'. Old alerts nobody has acted on are left out. Costs nothing when nothing changed. */
  function compute(state) {
    const st = state || store.state;
    const day = today();
    const rev = revOf(st);
    if (!(found && found.state === st && found.day === day && rev !== null && found.rev === rev)) {
      const fp = fingerprint(st);
      if (found && found.fp === fp && found.day === day) {
        found.state = st;
        found.rev = rev;
      } else found = { state: st, rev, fp, day, alerts: detect(st, { today: day }) };
    }
    const recs = st.alertStates || [];
    const tasks = st.tasks || [];
    // What the answer depends on besides the bank lines: your records, and whether the to-dos you made are done.
    const key = recs.map((r) => r.id + ':' + r.status + ':' + (r.taskId ? (tasks.find((k) => k.id === r.taskId) || {}).done : '')).join(',');
    if (shown && shown.found === found && shown.key === key) return shown.list;
    const byId = new Map(recs.map((r) => [r.id, r]));
    const list = [];
    for (const a of found.alerts) {
      const r = byId.get(a.id);
      let status = 'open';
      if (r && r.status === 'dismissed') status = 'dismissed';
      else if (a.refund && !(r && r.status === 'reopened')) status = 'refunded';
      else if (r && r.status === 'following') {
        const task = tasks.find((k) => k.id === r.taskId);
        status = !task ? 'open' : task.done ? 'followed' : 'following'; // a to-do taken away (Undo) puts it back
      }
      if (status === 'open' && !a.active) continue; // old news nobody acted on
      list.push(Object.assign({}, a, { status, at: r ? r.at : '' }));
    }
    shown = { found, key, list };
    return list;
  }
  const open = (state) => compute(state).filter((a) => a.status === 'open');
  const byId = (id) => compute(store.state).find((a) => a.id === id) || null;

  /* ---------- what you tell me ---------- */
  /* Sets (or, with null, clears) the record for one alert. Kept out of Undo history. */
  function setRecord(id, rec) {
    store.commit((st) => {
      const list = (st.alertStates || []).filter((r) => r.id !== id);
      if (rec) list.push(rec);
      st.alertStates = list;
    }, { history: false });
  }
  const recordOf = (id) => (store.state.alertStates || []).find((r) => r.id === id) || null;
  const stamp = (a, status, extra) => Object.assign({ id: a.id, status, at: today(), kind: a.kind }, a.demo ? { demo: true } : null, extra || null);

  /* 'Looks right': stop mentioning it. */
  function dismiss(id) {
    const a = byId(id);
    if (!a) return false;
    const was = recordOf(id);
    setRecord(id, stamp(a, 'dismissed'));
    toast(a.merchant + ' marked as fine. It’s under Earlier if you change your mind.', { action: 'Undo', plain: true, onAction: () => setRecord(id, was) });
    return true;
  }
  /* Puts a dismissed, refunded or followed-up alert back among the open ones. */
  function reopen(id) {
    const a = byId(id);
    if (!a) return false;
    const was = recordOf(id);
    if (a.status === 'refunded') setRecord(id, stamp(a, 'reopened'));
    else setRecord(id, null);
    toast(a.merchant + ' is back in the list.', { action: 'Undo', plain: true, onAction: () => setRecord(id, was) });
    return true;
  }
  const todoList = (st) => {
    const work = GU.parts && GU.parts.workListId ? GU.parts.workListId(st) : null;
    const lists = (st.todoLists || []).filter((l) => l.id !== work);
    return (lists.find((l) => /admin/i.test(l.name)) || lists.find((l) => l.id === 'list-personal') || lists[0] || {}).id || '';
  };
  /* 'Ask for a refund' (double charges): a to-do to ask the company, and the alert shows as Following up. */
  function askRefund(id) {
    const a = byId(id);
    // Only an open one: a second tap before the row has redrawn (or a stale button) must not make a second to-do.
    if (!a || a.kind !== 'double-charge' || a.status !== 'open') return false;
    const taskId = 'k-' + uid();
    const same = a.dates.every((d) => d === a.dates[0]);
    const title = 'Ask ' + a.merchant + ' to refund ' + pounds(Math.round(a.amounts[0] * 100)) + ' (charged ' + (a.dates.length === 2 ? 'twice' : a.dates.length + ' times') + (same ? ' on ' + when(a.dates[0]) : ', ' + dateList(a.dates)) + ')';
    // Following up is kept out of Undo; the to-do is not, so Undo takes the to-do back and the alert reopens by itself.
    setRecord(id, stamp(a, 'following', { taskId }));
    store.commit((st) => {
      // A to-do made from an example alert is an example too, so Clear examples takes it away with the made-up company.
      st.tasks.push(Object.assign({ id: taskId, listId: todoList(st), title, due: addDays(today(), 3), priority: 'normal', notes: 'Taken from your account on ' + dateList(a.dates) + '. Shown under Charge alerts on the Bills page.', done: false, created: today() }, a.demo ? { demo: true } : null));
    }, { label: 'Added a to-do to ask ' + a.merchant + ' for a refund' });
    toast('Added a to-do to ask ' + a.merchant + ' for a refund. The alert now says Following up.', {
      action: 'Undo', exact: true,
      onAction: () => store.commit((st) => {
        st.tasks = st.tasks.filter((k) => k.id !== taskId);
      }),
    });
    return true;
  }
  /* 'See the payments': Money › Bank, on the account, searching for the company, with these lines marked. */
  function showPayments(idOrAlert) {
    const a = typeof idOrAlert === 'string' ? byId(idOrAlert) : idOrAlert;
    if (!a) return false;
    const T = GU.tabs.transactions;
    if (T && T.showAccount && a.account && (store.state.accounts || []).some((x) => x.id === a.account)) T.showAccount(a.account);
    else GU.view.go('transactions');
    const mark = (tries) => {
      const box = document.getElementById('tx-search');
      if (!box) {
        if (tries < 10) setTimeout(() => mark(tries + 1), 120);
        return;
      }
      if (box.value !== a.search) {
        box.value = a.search;
        box.dispatchEvent(new Event('input', { bubbles: true }));
      }
      setTimeout(() => {
        const rows = a.txIds.map((id) => document.querySelector('tr[data-id="' + (window.CSS && CSS.escape ? CSS.escape(id) : id) + '"]')).filter(Boolean);
        rows.forEach((r) => r.classList.add('al-flag'));
        const calm = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        if (rows[0]) rows[0].scrollIntoView({ block: 'center', behavior: calm ? 'auto' : 'smooth' });
      }, 300);
    };
    setTimeout(() => mark(0), 120);
    return true;
  }

  /* ---------- the panel at the top of Bills ---------- */
  let earlierOpen = false;
  const KIND = { 'price-rise': { label: 'Went up', icon: 'trend' }, 'double-charge': { label: 'Taken twice', icon: 'copy' } };
  const PAST = { dismissed: 'Looks right', refunded: 'Refunded', followed: 'Followed up' };

  function rowHTML(a, past) {
    const k = KIND[a.kind];
    const sub = a.status === 'refunded' && a.refund ? 'Refunded ' + money(a.refund.amount) + ' on ' + when(a.refund.date) + '. ' + a.detail
      : a.status === 'followed' ? 'You followed this up. ' + a.detail : a.detail;
    const tag = past ? pill(PAST[a.status], a.status === 'refunded' ? 'good' : 'muted', a.status === 'refunded' ? 'check' : null) : a.status === 'following' ? pill('Following up', 'info', 'clock') : pill(k.label, 'warn');
    const see = '<button type="button" class="btn btn--sm" data-al-see="' + esc(a.id) + '">' + icon('search') + 'See the payments</button>';
    const acts = past
      ? '<button type="button" class="btn btn--sm btn--ghost" data-al-undo="' + esc(a.id) + '" aria-label="Undo: show ' + esc(a.merchant) + ' again">' + icon('undo') + 'Undo</button>' + see
      : (a.kind === 'double-charge' && a.status === 'open' ? '<button type="button" class="btn btn--sm btn--soft" data-al-refund="' + esc(a.id) + '">' + icon('send') + 'Ask for a refund</button>' : '') + see +
        '<button type="button" class="btn btn--sm btn--ghost" data-al-ok="' + esc(a.id) + '" aria-label="Looks right: stop showing ' + esc(a.merchant) + '">' + icon('check') + 'Looks right</button>';
    return '<li class="spot al-row al-row--' + a.kind + (past ? ' is-past' : '') + '" data-alert="' + esc(a.id) + '">' +
      '<span class="row-item__icon">' + icon(k.icon) + '</span>' +
      '<div class="spot__text al-row__text"><b>' + esc(a.merchant) + ' <span class="spot__amt">' + esc(pounds(Math.round(a.amounts[a.amounts.length - 1] * 100))) + '</span></b>' +
      '<em>' + esc(sub) + '</em><span class="al-row__tags">' + tag + '</span></div>' +
      '<span class="spot__act al-row__act">' + acts + GU.organise.readOnlyBtn('chargealert', a.id, 'More for ' + a.merchant) + '</span></li>';
  }

  /* The panel, or '' when there is nothing to show. With only old ones, just a slim 'Earlier' line. */
  function panelHTML(state) {
    const all = compute(state);
    const live = all.filter((a) => a.status === 'open' || a.status === 'following');
    const past = all.filter((a) => a.status === 'dismissed' || a.status === 'refunded' || a.status === 'followed').sort((a, b) => (a.at < b.at ? 1 : -1));
    if (!live.length && !past.length) return '';
    const earlier = past.length
      ? '<details class="al-earlier" data-al-fold' + (earlierOpen ? ' open' : '') + '><summary><span>Earlier</span><span class="muted">' + past.length + '</span>' + icon('chevron') + '</summary><ul class="rows">' + past.map((a) => rowHTML(a, true)).join('') + '</ul></details>' : '';
    if (!live.length) return '<section class="panel panel--details al-panel al-panel--quiet" aria-label="Charge alerts">' + earlier + '</section>';
    return '<section class="panel panel--spotted al-panel" aria-label="Charge alerts"><header class="panel__head"><h2>' + icon('coin') + 'Charge alerts</h2><span class="muted">' + esc(plural(live.length, 'thing') + ' to look at') + '</span></header>' +
      '<p class="panel__intro">I looked through your statements for a regular payment that went up, and for the same payment taken twice. If one is fine, say so and I’ll stop mentioning it.</p>' +
      '<ul class="rows">' + live.map((a) => rowHTML(a, false)).join('') + '</ul>' + earlier + '</section>';
  }

  /* Makes the panel's buttons work. Call after drawing it into `root`. */
  function wire(root) {
    root.addEventListener('click', (e) => {
      const b = e.target.closest('[data-al-ok], [data-al-refund], [data-al-see], [data-al-undo]');
      if (!b || !root.contains(b)) return;
      if (b.dataset.alOk != null) dismiss(b.dataset.alOk);
      else if (b.dataset.alRefund != null) askRefund(b.dataset.alRefund);
      else if (b.dataset.alSee != null) showPayments(b.dataset.alSee);
      else reopen(b.dataset.alUndo);
    });
    const d = root.querySelector('[data-al-fold]');
    if (d) d.addEventListener('toggle', () => (earlierOpen = d.open));
  }

  /* ---------- on Today, in the menu counts, in each row's ⋯ menu ---------- */
  GU.agenda.extra.push((state) => open(state).map((a) => ({ level: a.level, tab: 'bills', title: a.title, detail: a.detail })));

  GU.organise.readOnly.chargealert = (id) => {
    const a = byId(id);
    if (!a) return null;
    return {
      name: a.merchant + ' charge alert', why: 'It comes from your bank statements', openHint: 'Shows the payments in Money › Bank',
      open: () => showPayments(a),
      head: ['Merchant', 'What happened', 'Dates', 'Amount', 'A year more', 'Status'],
      row: [a.merchant, a.kind === 'price-rise' ? 'Went up in price' : 'Taken twice', a.dates.join(' '), a.amounts[a.amounts.length - 1], a.perYear || '', a.status],
    };
  };

  /* Records for example alerts go with the examples: once none are left, so do they. */
  let tidying = 0;
  store.subscribe(() => {
    const s = store.state;
    if (tidying || !s || !(s.alertStates || []).some((r) => r.demo) || (s.transactions || []).some((x) => x.demo)) return;
    tidying = setTimeout(() => {
      tidying = 0;
      if ((store.state.transactions || []).some((x) => x.demo)) return;
      store.commit((st) => {
        st.alertStates = (st.alertStates || []).filter((r) => !r.demo);
      }, { history: false });
    }, 60);
  });

  GU.alerts = { RULES, detect, compute, open, panelHTML, wire, dismiss, reopen, askRefund, showPayments, fingerprint };
})();
