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
      // A payment the bank dated a day ahead but which was already imported when you typed the balance is in it already.
      const ahead = addDays(base, 1);
      for (const x of txs) if (x.t.date > base && !(x.t.created && x.t.created <= base && x.t.date <= ahead)) balance += x.t.amount;
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

  /* Moves the transactions `pick` chooses into another account. Any that account already has
     (the same amount within 2 days, from an overlapping statement) are dropped instead of doubled. */
  function moveTransactions(st, pick, intoId, leaving) {
    const byAmount = new Map();
    for (const t of st.transactions) {
      if (t.account !== intoId || (leaving && leaving(t))) continue;
      const k = Math.round(t.amount * 100);
      if (!byAmount.has(k)) byAmount.set(k, []);
      byAmount.get(k).push(t);
    }
    const used = new Set();
    const drop = new Set();
    let moved = 0;
    const moving = st.transactions.filter((t) => t.account !== intoId && pick(t)).sort((a, b) => a.date.localeCompare(b.date));
    for (const t of moving) {
      const twins = (byAmount.get(Math.round(t.amount * 100)) || []).filter((x) => !used.has(x.id) && Math.abs(toDays(x.date) - toDays(t.date)) <= 2);
      if (twins.length) {
        const twin = twins.reduce((a, b) => (Math.abs(toDays(a.date) - toDays(t.date)) <= Math.abs(toDays(b.date) - toDays(t.date)) ? a : b));
        used.add(twin.id);
        if (!twin.category && t.category) twin.category = t.category;
        if (!twin.notes && t.notes) twin.notes = t.notes;
        drop.add(t.id);
      } else {
        t.account = intoId;
        moved++;
      }
    }
    st.transactions = st.transactions.filter((t) => !drop.has(t.id));
    return { moved, duplicates: drop.size };
  }

  /* Folds one account into another: its transactions move over (without doubling any) and the account goes. */
  function mergeAccounts(st, fromId, intoId) {
    const res = moveTransactions(st, (t) => t.account === fromId, intoId);
    for (const k of Object.keys(st)) if (Array.isArray(st[k])) for (const r of st[k]) if (r && r.account === fromId) r.account = intoId;
    const from = st.accounts.find((a) => a.id === fromId) || {};
    const into = st.accounts.find((a) => a.id === intoId);
    if (into) {
      if (!into.bank && from.bank) into.bank = from.bank;
      if (!into.overdraftLimit && from.overdraftLimit) into.overdraftLimit = from.overdraftLimit;
    }
    st.accounts = st.accounts.filter((a) => a.id !== fromId);
    return res;
  }

  /* ---------- payment schedules (Klarna, PayPal Pay in 3, Clearpay…) ---------- */
  const MON = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  const DATE_RE = /\b(\d{1,2})(?:st|nd|rd|th)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?(?:,?\s+(\d{4}))?|\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?|\b(\d{1,2})[\/.-](\d{1,2})(?:[\/.-](\d{2,4}))?\b|\b(\d{4})-(\d{2})-(\d{2})\b|\b(today|tomorrow)\b/i;
  const AMT_RE = /£\s?(\d[\d,]*(?:\.\d{2})?)|\b(\d[\d,]*\.\d{2})\b/;
  function isoFrom(m) {
    const t = today();
    if (m[13]) return m[13].toLowerCase() === 'today' ? t : addDays(t, 1);
    if (m[10]) return m[10] + '-' + m[11] + '-' + m[12];
    let d;
    let mo;
    let y;
    if (m[2]) [d, mo, y] = [+m[1], MON.indexOf(m[2].toLowerCase()) + 1, m[3]];
    else if (m[4]) [d, mo, y] = [+m[5], MON.indexOf(m[4].toLowerCase()) + 1, m[6]];
    else [d, mo, y] = [+m[7], +m[8], m[9]];
    if (!(mo >= 1 && mo <= 12 && d >= 1 && d <= 31)) return null;
    let year = y ? +y : +t.slice(0, 4);
    if (y && y.length === 2) year = 2000 + +y;
    let iso = year + '-' + String(mo).padStart(2, '0') + '-' + String(d).padStart(2, '0');
    if (!y && toDays(iso) < toDays(t) - 20) iso = (year + 1) + iso.slice(4); // "15 Jan" in October means next January
    return iso;
  }
  /* Reads a pasted list of upcoming payments, e.g. from the Klarna or PayPal app:
     "ASOS  £33.33  Due 15 Oct", or a shop name on one line and the amount and date on the next ones.
     A payment marked Paid (on its own line or the next) is left out. */
  const AMT_ALL = /£\s?\d[\d,]*(?:\.\d{2})?|\b\d[\d,]*\.\d{2}\b/g;
  const FILLER = /\b(due|on|by|payment|payments|instalment|installment|instalments|installments|next|upcoming|scheduled|amount|total|remaining|left|to pay|gbp|pay in 3|pay in 30 days|pay later|paid|of|status|date)\b/gi;
  function parseSchedule(text) {
    const lines = String(text || '').split(/\n+/).map((l) => l.trim()).filter(Boolean);
    const out = [];
    let merchant = '';
    let cur = {};
    const flush = () => {
      if (cur.date && cur.amount != null && !cur.skip) out.push({ date: cur.date, amount: cur.amount, merchant: cur.merchant || merchant, n: cur.n || null, of: cur.of || null });
      cur = {};
    };
    for (const line of lines) {
      const am = line.match(AMT_RE);
      const noAmt = line.replace(AMT_ALL, ' ');
      const dm = noAmt.match(DATE_RE);
      const noDate = dm ? noAmt.replace(DATE_RE, ' ') : noAmt;
      const no = noDate.match(/\b(\d{1,2})\s+of\s+(\d{1,2})\b/i);
      const paid = /\b(paid|completed|refunded|cancelled)\b/i.test(line) && !/\b(due|upcoming|scheduled|to pay|unpaid)\b/i.test(line);
      const rest = noDate.replace(/\b\d{1,2}\s+of\s+\d{1,2}\b/i, ' ').replace(FILLER, ' ').replace(/[·•|,:–—()*-]+/g, ' ').replace(/\s+/g, ' ').trim();
      const named = /[a-z]{3}/i.test(rest) && rest.length <= 50 ? rest : '';
      if (!dm && !am) {
        if (named) {
          flush();
          merchant = named;
        }
        if (no) {
          if (cur.date && cur.amount != null) flush(); // "Payment 3 of 3" starts the next one
          [cur.n, cur.of] = [+no[1], +no[2]];
        }
        if (paid) cur.skip = true;
        continue;
      }
      // A second date or amount after a complete payment starts the next payment.
      if (cur.date && cur.amount != null && (dm || am)) flush();
      if (dm) cur.date = isoFrom(dm) || cur.date;
      if (am && cur.amount == null) cur.amount = parseFloat((am[1] || am[2]).replace(/,/g, ''));
      if (no) [cur.n, cur.of] = [+no[1], +no[2]];
      if (paid) cur.skip = true;
      if (named) cur.merchant = named;
    }
    flush();
    const seen = new Set();
    return out.filter((i) => i.amount > 0 && i.date && !seen.has(i.date + '|' + i.amount + '|' + i.merchant) && seen.add(i.date + '|' + i.amount + '|' + i.merchant));
  }

  /* A section named after the lender (say "Klarna") with its upcoming payments listed under "Coming up",
     one item per payment with its date and amount, is used as the schedule as it stands. */
  function sectionSchedule(state, debt) {
    const l = lenderFor(debt.lender) || lenderFor(debt.name);
    const word = String(l ? l.name : debt.lender || debt.name || '').toLowerCase().split(/\s+/)[0];
    if (!word || word.length < 4) return null;
    const secs = (state.sections || []).filter((x) => x.name.toLowerCase().split(/\s+/)[0] === word);
    if (!secs.length) return null;
    const t = today();
    const items = (state.sectionItems || []).filter((i) => secs.some((x) => x.id === i.sectionId) && /coming up|upcoming|schedule|to pay/i.test(i.group || '') && i.date >= t && Number(i.amount) > 0);
    // Notes like "Autopay from bank account ••••1042 (Santander)" say which of your accounts pays it.
    const banks = state.accounts.filter((a) => a.bank);
    const bankIn = (txt) => (banks.find((a) => new RegExp('\\b' + a.bank.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i').test(txt || '')) || {}).id || null;
    const votes = {};
    for (const i of items) {
      const a = bankIn(i.notes);
      if (a) votes[a] = (votes[a] || 0) + 1;
    }
    const usual = Object.keys(votes).sort((a, b) => votes[b] - votes[a])[0] || null;
    const list = items.map((i) => {
      const no = String(i.title || '').match(/\b(\d{1,2})\s+of\s+(\d{1,2})\b/);
      return { id: i.id, date: i.date, amount: round2(Number(i.amount)), merchant: String(i.title || '').split(' · ')[0], n: no ? +no[1] : null, of: no ? +no[2] : null, account: bankIn(i.notes) || usual };
    });
    return list.length ? { name: secs[0].name, list } : null;
  }

  /* Saves a schedule onto the debt for that lender (adding the debt if it's new). Future instalments are replaced. */
  function setSchedule(st, lenderName, list) {
    const l = lenderFor(lenderName);
    const name = l ? l.name : lenderName;
    let d = (st.debts || []).find((x) => !x.closed && [x.lender, x.name].filter(Boolean).some((n) => n.toLowerCase() === name.toLowerCase()));
    if (!d) {
      d = { id: 'debt-' + GU.util.uid(), created: today(), name, lender: name, type: l ? l.type : 'Buy now pay later', history: [] };
      st.debts.push(d);
    }
    const t = today();
    d.schedule = (d.schedule || []).filter((i) => i.date < t).concat(list.filter((i) => i.date >= t).map((i) => ({ id: 'in-' + GU.util.uid(), date: i.date, amount: round2(i.amount), merchant: i.merchant || '', n: i.n || null, of: i.of || null })))
      .sort((a, b) => a.date.localeCompare(b.date));
    d.scheduleUpdated = t;
    return d;
  }

  /* ---------- tidying accounts ---------- */
  /* Runs of dates (a statement, or several back to back) with no gap longer than 6 days. */
  function ranges(list) {
    const ds = Array.from(new Set(list.map((t) => t.date))).sort();
    const out = [];
    for (const d of ds) {
      const last = out[out.length - 1];
      if (last && toDays(d) - toDays(last.to) <= 6) last.to = d;
      else out.push({ from: d, to: d });
    }
    return out;
  }
  /* How many transactions in `a` have a twin in `b`: the same amount within 2 days. */
  function twins(a, b) {
    const byAmount = new Map();
    for (const t of b) {
      const k = Math.round(t.amount * 100);
      if (!byAmount.has(k)) byAmount.set(k, []);
      byAmount.get(k).push(t);
    }
    const used = new Set();
    let n = 0;
    for (const t of a) {
      const hit = (byAmount.get(Math.round(t.amount * 100)) || []).find((x) => !used.has(x) && Math.abs(toDays(x.date) - toDays(t.date)) <= 2);
      if (hit) {
        used.add(hit);
        n++;
      }
    }
    return n;
  }

  /* Mix-ups worth fixing: statements filed under the wrong account, and one account imported twice. */
  let fixCache = null;
  function accountFixes(state) {
    const sig = [state.transactions.length, state.accounts.length, (state.settings.ignoredAccountFixes || []).length];
    if (fixCache && fixCache.tx === state.transactions && fixCache.sig.join() === sig.join()) return fixCache.out;
    const out = findFixes(state);
    fixCache = { tx: state.transactions, sig, out };
    return out;
  }
  function findFixes(state) {
    const ignored = new Set(state.settings.ignoredAccountFixes || []);
    const name = (id) => (state.accounts.find((a) => a.id === id) || {}).name || 'an account';
    const byAccount = {};
    for (const t of state.transactions) (byAccount[t.account] = byAccount[t.account] || []).push(t);
    const out = [];

    // 1. One import put some of a bank's statements in the wrong account: they sit exactly in the gaps
    //    between that bank's other statements from the same import, and aren't copies of anything.
    const batches = {};
    for (const t of state.transactions) if (t.importBatch) ((batches[t.importBatch] = batches[t.importBatch] || {})[t.account] = (batches[t.importBatch][t.account] || [])).push(t);
    for (const [batch, accts] of Object.entries(batches)) {
      const ids = Object.keys(accts);
      if (ids.length < 2) continue;
      for (const a of ids) for (const b of ids) {
        if (a === b || accts[a].length >= accts[b].length) continue;
        const ar = ranges(accts[a]);
        const br = ranges(accts[b]);
        const fits = ar.every((r) => !br.some((x) => x.from <= r.to && r.from <= x.to) &&
          br.some((x) => Math.abs(toDays(r.from) - toDays(x.to)) <= 4 || Math.abs(toDays(x.from) - toDays(r.to)) <= 4));
        if (!fits) continue;
        const others = (byAccount[a] || []).filter((t) => t.importBatch !== batch);
        if (twins(accts[a], others) > accts[a].length * 0.2) continue;
        const key = 'move:' + batch + ':' + a + '>' + b;
        if (ignored.has(key)) continue;
        out.push({ kind: 'move', key, from: a, into: b, batch, count: accts[a].length, ranges: ar,
          title: GU.util.plural(ar.length, 'statement period') + ' filed under ' + name(a) + ' look like ' + name(b) + ' statements',
          text: 'They were imported together with your ' + name(b) + ' statements and fit exactly into its gaps: ' + ar.map((r) => GU.util.fmtDate(r.from, { short: true }) + ' to ' + GU.util.fmtDate(r.to, { short: true })).join(', ') + ' (' + GU.util.plural(accts[a].length, 'transaction') + ').',
          action: 'Move them to ' + name(b) });
      }
    }
    // 1b. A whole import filed under the wrong bank's account: where it overlaps that account's other
    //     statements it matches almost none of them, and where it overlaps another bank's statements it
    //     matches them line for line.
    if (!out.length) {
      const acc = (id) => state.accounts.find((x) => x.id === id) || {};
      const within = (list, lo, hi) => list.filter((t) => t.date >= lo && t.date <= hi);
      const span = (list) => [list.reduce((m, t) => (t.date < m ? t.date : m), '9999'), list.reduce((m, t) => (t.date > m ? t.date : m), '')];
      for (const [batch, accts] of Object.entries(batches)) {
        for (const a of Object.keys(accts)) {
          const mine = accts[a];
          const [lo, hi] = span(mine);
          const others = within((byAccount[a] || []).filter((t) => t.importBatch !== batch), lo, hi);
          if (others.length < 10) continue;
          const [oLo, oHi] = span(others);
          const mineOverOthers = within(mine, oLo, oHi);
          if (twins(mineOverOthers, others) > mineOverOthers.length * 0.1) continue; // it does belong here
          for (const b of Object.keys(byAccount)) {
            if (b === a || !acc(b).bank || acc(b).bank === acc(a).bank || out.length) continue;
            const theirs = within(byAccount[b], lo, hi);
            if (theirs.length < 10) continue;
            const [bLo, bHi] = span(theirs);
            const overlap = within(mine, bLo, bHi);
            if (overlap.length < 10 || twins(overlap, theirs) < overlap.length * 0.8) continue;
            const key = 'move:' + batch + ':' + a + '>' + b;
            if (ignored.has(key)) continue;
            out.push({ kind: 'move', key, from: a, into: b, batch, count: mine.length, ranges: ranges(mine),
              title: 'An import of ' + GU.util.plural(mine.length, 'transaction') + ' filed under ' + name(a) + ' looks like ' + name(b),
              text: 'It runs from ' + GU.util.fmtDate(lo, { short: true }) + ' to ' + GU.util.fmtDate(hi, { short: true }) + '. Where it overlaps your ' + name(b) + ' statements it matches them line for line, but it matches almost nothing else in ' + name(a) + '. Moving it drops the copies.',
              action: 'Move it to ' + name(b) });
          }
        }
      }
    }
    // 2. The same account imported twice under two names: many payments appear in both.
    if (!out.length) {
      const ids = Object.keys(byAccount);
      for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
        const A = byAccount[ids[i]];
        const B = byAccount[ids[j]];
        const from = [A, B].map((l) => l.reduce((m, t) => (t.date < m ? t.date : m), '9999'));
        const to = [A, B].map((l) => l.reduce((m, t) => (t.date > m ? t.date : m), ''));
        const lo = from[0] > from[1] ? from[0] : from[1];
        const hi = to[0] < to[1] ? to[0] : to[1];
        if (lo > hi) continue;
        const inA = A.filter((t) => t.date >= lo && t.date <= hi);
        const inB = B.filter((t) => t.date >= lo && t.date <= hi);
        const n = twins(inA, inB);
        if (n < 15 || n < Math.min(inA.length, inB.length) * 0.3) continue;
        const acc = (id) => state.accounts.find((x) => x.id === id) || {};
        // Keep the one named after its bank (or with the newer statements); fold the other into it.
        const [x, y] = [ids[i], ids[j]];
        const keepY = (acc(y).bank && !acc(x).bank) || (!!acc(y).bank === !!acc(x).bank && to[1] >= to[0]);
        const fromId = keepY ? x : y;
        const intoId = keepY ? y : x;
        const key = 'merge:' + fromId + '>' + intoId;
        if (ignored.has(key)) continue;
        out.push({ kind: 'merge', key, from: fromId, into: intoId, count: n,
          title: name(fromId) + ' and ' + name(intoId) + ' look like the same account',
          text: GU.util.plural(n, 'payment') + ' appear in both, so they’re counted twice in your spending. Merging moves everything into ' + name(intoId) + ' and drops the copies.',
          action: 'Merge into ' + name(intoId) });
      }
    }
    return out.slice(0, 1);
  }

  /* Before an import: is this statement going into the right account? Returns a short warning or ''. */
  function importWarning(state, list, accountId, bank) {
    const acc = state.accounts.find((a) => a.id === accountId);
    if (acc && bank && acc.bank && acc.bank.toLowerCase() !== bank.toLowerCase()) return 'This looks like a ' + bank + ' statement, not ' + acc.name + '.';
    if (!list.length) return '';
    let best = null;
    for (const a of state.accounts) {
      if (a.id === accountId) continue;
      const theirs = state.transactions.filter((t) => t.account === a.id);
      if (!theirs.length) continue;
      const n = twins(list, theirs);
      if (n >= Math.max(5, list.length * 0.5) && (!best || n > best.n)) best = { a, n };
    }
    return best ? GU.util.plural(best.n, 'line') + ' of this are already in ' + best.a.name + '. Is it the same account?' : '';
  }

  function applyFix(st, fix, leaving) {
    if (fix.kind === 'move') {
      return moveTransactions(st, (t) => t.account === fix.from && t.importBatch === fix.batch, fix.into, leaving);
    }
    return mergeAccounts(st, fix.from, fix.into);
  }

  /* Every fix that's needed, worked out on a copy first. Applying them in order, transactions that a later
     fix will move out of an account aren't mistaken for copies of what's moving in. */
  function tidyAll(st) {
    const scratch = { accounts: st.accounts, settings: st.settings, transactions: st.transactions.map((t) => ({ id: t.id, date: t.date, amount: t.amount, account: t.account, importBatch: t.importBatch })) };
    const plan = [];
    for (let i = 0; i < 8; i++) {
      const f = accountFixes(scratch)[0];
      if (!f) break;
      plan.push(f);
      applyFix(scratch, f);
    }
    const results = [];
    plan.forEach((f, i) => {
      const later = plan.slice(i + 1).filter((x) => x.kind === 'move');
      const leaving = (t) => later.some((x) => x.from === t.account && x.batch === t.importBatch);
      results.push({ fix: f, result: applyFix(st, f, leaving) });
    });
    return results;
  }

  /* ---------- debts ---------- */
  const TYPES = ['Credit card', 'Loan', 'Buy now pay later', 'Car finance', 'Store or catalogue card', 'Overdraft', 'Mortgage', 'Student loan', 'Debt collection agency', 'Owed to a person', 'Other'];
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
    // Companies that buy or collect old debts.
    { name: 'Lowell', type: 'Debt collection agency', keys: ['lowell portfolio', 'lowell financial', 'lowell solicitors', 'lowell group'] },
    { name: 'Cabot Financial', type: 'Debt collection agency', keys: ['cabot financial', 'cabot credit'] },
    { name: 'Intrum', type: 'Debt collection agency', keys: ['intrum'] },
    { name: 'PRA Group', type: 'Debt collection agency', keys: ['pra group'] },
    { name: 'Asset Link Capital', type: 'Debt collection agency', keys: ['asset link capital', 'assetlink'] },
    { name: 'Allied International Credit', type: 'Debt collection agency', keys: ['allied international', 'aic uk'] },
    { name: 'Moorcroft', type: 'Debt collection agency', keys: ['moorcroft'] },
    { name: 'Link Financial', type: 'Debt collection agency', keys: ['link financial'] },
    { name: 'Hoist Finance', type: 'Debt collection agency', keys: ['hoist finance', 'hoist portfolio'] },
    { name: 'Capquest', type: 'Debt collection agency', keys: ['capquest'] },
    { name: 'Robinson Way', type: 'Debt collection agency', keys: ['robinson way'] },
    { name: 'Advantis', type: 'Debt collection agency', keys: ['advantis credit'] },
    { name: 'BW Legal', type: 'Debt collection agency', keys: ['bw legal'] },
    { name: 'Wescot', type: 'Debt collection agency', keys: ['wescot'] },
    { name: 'Arrow Global', type: 'Debt collection agency', keys: ['arrow global'] },
    { name: 'Overdales', type: 'Debt collection agency', keys: ['overdales'] },
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
    // A payment plan with a shop (Amazon, say) shows on statements the same as everything else bought there,
    // so only payments of the plan's own instalment amounts, from its first instalment on, count.
    const plan = !(debt.match || '').trim() && !lenderFor(debt.lender) && !lenderFor(debt.name) && (debt.schedule || []).length ? debt.schedule : null;
    const amounts = plan ? new Set(plan.map((i) => round2(i.amount).toFixed(2))) : null;
    const from = plan ? addDays(plan.reduce((m, i) => (i.date < m ? i.date : m), plan[0].date), -5) : '';
    return state.transactions.filter((t) => t.amount < 0 && matchesKeys(t, k) && (!plan || (t.date >= from && amounts.has(round2(-t.amount).toFixed(2)))))
      .sort((a, b) => b.date.localeCompare(a.date));
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
    let start = byTerm ? debt.termMonths * debt.monthlyPayment : Number(debt.startBalance) || (balanceKnown ? debt.balance : 0);
    // A payment schedule (from Klarna, PayPal…) is the most exact thing we have: what's left is what's still to pay.
    const own = (debt.schedule || []).filter((i) => i.date >= t);
    const fromSection = own.length ? null : sectionSchedule(state, debt);
    const plan = (own.length ? own : fromSection ? fromSection.list : []).slice().sort((a, b) => a.date.localeCompare(b.date));
    if (plan.length) {
      const left = round2(sum(plan, (i) => i.amount));
      const soon = round2(sum(plan.filter((i) => toDays(i.date) - toDays(t) < 31), (i) => i.amount));
      const last = plan[plan.length - 1].date;
      start = Math.max(start, left + sum((debt.schedule || []).filter((i) => i.date < t), (i) => i.amount));
      return {
        start, byTerm: false, scheduled: true, plan, scheduleFrom: fromSection ? fromSection.name : null, finished: false, quietDays, payments: pays, borrowed, paidSince, borrowedSince, interest: 0, asOf: end,
        paidTotal: sum(pays, (p) => -p.amount), paidThisMonth, monthlyAvg, payment: soon, estBalance: left, balanceKnown: true, nextPayment: plan[0].date,
        lastPayment: pays[0] || null, months: new Set(plan.map((i) => i.date.slice(0, 7))).size, clearBy: last,
        progress: start > 0 ? Math.min(1, Math.max(0, 1 - left / start)) : null,
      };
    }
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
      if (a.type === 'credit') continue; // a credit card owes: it's a debt (and in Debts already), not an overdraft
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
      if (s.scheduled) {
        for (const i of s.plan) if (i.date <= to) out.push({ debt: d, date: i.date, amount: i.amount, merchant: i.merchant });
        continue;
      }
      if (!s.nextPayment || s.nextPayment > to || s.finished) continue;
      out.push({ debt: d, date: s.nextPayment, amount: Number(d.monthlyPayment) || (s.lastPayment ? -s.lastPayment.amount : 0) });
    }
    return out;
  }

  /* ---------- setting balances ----------
     One place sets what an account holds, for the Bank page's Update balances, the Sorting hub (a screenshot or a typed
     line) and Ask Claude: matching what was read to your accounts, the date the balance is from, the new accounts, and
     Undo. A balance is an anchor ({date, amount}); the balance now is the anchor plus every later transaction. */
  const MAX_BALANCES = 12;
  const ACCOUNT_TYPES = ['current', 'savings', 'credit', 'joint', 'business'];
  const KNOWN_BANKS = ['HSBC', 'Santander', 'Monzo', 'Barclays', 'Barclaycard', 'Lloyds', 'Halifax', 'NatWest', 'RBS', 'Royal Bank of Scotland', 'Bank of Scotland', 'Nationwide', 'Starling', 'Revolut',
    'Chase', 'TSB', 'Metro Bank', 'First Direct', 'Virgin Money', 'Co-operative Bank', 'Tesco Bank', 'Sainsbury’s Bank', 'M&S Bank', 'Capital One', 'MBNA', 'American Express', 'Amex', 'Zopa',
    'Kroo', 'Cashplus', 'Post Office', 'Danske Bank', 'Clydesdale', 'Yorkshire Bank', 'Coventry Building Society', 'Skipton', 'Vanquis', 'Klarna', 'PayPal'];
  /* Words for what kind of account it is, which are not part of the bank's name: 'Monzo Flex' is Monzo's. */
  const PRODUCT_WORDS = new Set(['flex', 'credit', 'card', 'cards', 'current', 'account', 'accounts', 'savings', 'saver', 'joint', 'business', 'pot', 'pots', 'plus', 'premium', 'everyday', 'isa', 'ltd', 'limited', 'bank']);
  const keyOf = (t) => String(t == null ? '' : t).toLowerCase().replace(/['’]/g, '').replace(/[^a-z0-9&]+/g, ' ').replace(/\s+/g, ' ').trim();
  /* 'Monzo Flex' → 'monzo'; 'First Direct' → 'first direct'. Only trailing product words go. */
  function bankKey(t) {
    const w = keyOf(t).split(' ').filter(Boolean);
    while (w.length > 1 && PRODUCT_WORDS.has(w[w.length - 1])) w.pop();
    return w.join(' ');
  }
  /* The bank a text names (as written in KNOWN_BANKS), the longest one if several, or ''. */
  const knownBank = (text) => {
    const k = ' ' + keyOf(text) + ' ';
    let best = '';
    for (const b of KNOWN_BANKS) if (k.includes(' ' + keyOf(b) + ' ') && b.length > best.length) best = b;
    return best;
  };
  const knownBankIn = (text) => bankKey(knownBank(text));
  const typeOf = (t) => (ACCOUNT_TYPES.includes(String(t || '').toLowerCase()) ? String(t).toLowerCase() : 'current');
  /* current, joint and business accounts are all 'current' money; a credit card and savings are their own kind. */
  const familyOf = (t) => (t === 'credit' ? 'credit' : t === 'savings' ? 'savings' : 'current');
  /* The bank an account is with: what it says, otherwise a bank named in its name. */
  const bankOf = (a) => bankKey(a.bank) || knownBankIn(a.name);
  const providerKey = (r) => bankKey(r.provider) || knownBankIn(r.name) || '';

  /* Sort codes, account and card numbers must never be kept: this takes them out of any text. */
  function scrub(text) {
    return String(text == null ? '' : text)
      .replace(/\b\d{2}[-–−\s]\d{2}[-–−\s]\d{2}\b/g, ' ')
      .replace(/\b(?:ending|ends|ended)(?:\s+in)?\s*[:#]?\s*\d{3,4}\b/gi, ' ')
      .replace(/[•*·x]{2,}\s?\d{3,4}\b/gi, ' ')
      .replace(/\b\d(?:[ -]?\d){5,}\b/g, ' ')
      .replace(/\b(?:sort\s*code|account\s*(?:number|no\.?)|acc\s*no\.?|iban|card\s*number)\b[:\s]*/gi, ' ')
      .replace(/\(\s*\)|\[\s*\]/g, ' ')
      .replace(/\s+/g, ' ').trim();
  }
  /* A name for an account: one line, no brackets, no numbers that identify it, at most n characters. */
  const nameText = (v, n) => scrub(String(v == null ? '' : v).normalize('NFKC').replace(/[\s\u0000-\u001f\u007f-\u009f]+/g, ' ').replace(/[<>]/g, '')).slice(0, n || 40).trim();
  const isRealDate = (d) => GU.util.isISO(d) && GU.util.fromDays(GU.util.toDays(d)) === d;

  /* A balance typed in for today already includes every payment imported for that account, even ones the bank dated
     a day ahead, so the anchor goes on the latest of them. */
  function anchorDate(st, id, date) {
    const d = date || today();
    if (d < today()) return d;
    return st.transactions.reduce((m, t) => (t.account === id && t.date > m ? t.date : m), d);
  }

  /* The name a new account is given: a bare bank's name ('HSBC') becomes 'HSBC current account'; a name that already
     says what it is ('Monzo Flex', 'Joint account') stays as it is. */
  function accountNameFor(r) {
    const name = nameText((r && (r.name || r.provider)) || '', 40);
    if (!name) return '';
    const bank = knownBank(name);
    if (!bank || keyOf(name) !== keyOf(bank)) return name;
    const tail = { current: 'current account', savings: 'savings', credit: 'credit card', joint: 'joint account', business: 'business account' }[typeOf(r.type)];
    return nameText(name + ' ' + tail, 40);
  }

  /* Which of your accounts each reading ({provider, name, type, map?, skip?}) is. Passes from the surest: the account
     you chose; the same name; the same bank and the same type (when only one account fits); the same bank when it is
     your only one of that kind. Nothing matches across kinds (a credit card never overwrites a current account) and
     no account is matched twice. Returns, for each: {accountId, how: 'chosen'|'name'|'bank'|'only'|'new'|'skip'|'dup'}. */
  function matchReadings(state, rows) {
    const accts = state.accounts || [];
    const claimed = new Set();
    const out = rows.map((r) => ({ accountId: null, how: r && r.skip ? 'skip' : 'new' }));
    const fam = (r) => familyOf(typeOf(r.type));
    const open = (i) => out[i].how === 'new' && !out[i].accountId && !(rows[i] && rows[i].map === 'new');
    rows.forEach((r, i) => {
      if (!r || r.skip || !r.map || r.map === 'new') return;
      const a = accts.find((x) => x.id === r.map);
      if (a && !claimed.has(a.id) && familyOf(typeOf(a.type)) === fam(r)) {
        out[i] = { accountId: a.id, how: 'chosen' };
        claimed.add(a.id);
      }
    });
    const pass = (pick) => {
      rows.forEach((r, i) => {
        if (!r || !open(i)) return;
        const a = pick(r);
        if (a) {
          out[i] = { accountId: a.id, how: pick.how };
          claimed.add(a.id);
        }
      });
    };
    const free = (a) => !claimed.has(a.id);
    const byName = (r) => accts.find((a) => free(a) && keyOf(a.name) && [keyOf(r.name), keyOf(accountNameFor(r))].includes(keyOf(a.name)) && familyOf(typeOf(a.type)) === fam(r));
    byName.how = 'name';
    const byBank = (r) => {
      const k = providerKey(r);
      if (!k) return null;
      const same = accts.filter((a) => free(a) && bankOf(a) === k && typeOf(a.type) === typeOf(r.type));
      return same.length === 1 ? same[0] : null;
    };
    byBank.how = 'bank';
    const onlyOne = (r) => {
      const k = providerKey(r);
      if (!k) return null;
      const all = accts.filter((a) => bankOf(a) === k && familyOf(typeOf(a.type)) === fam(r));
      return all.length === 1 && free(all[0]) ? all[0] : null;
    };
    onlyOne.how = 'only';
    pass(byName);
    pass(byBank);
    pass(onlyOne);
    // The same reading twice (the same name and kind) is one account: the second is left out, never made again.
    for (let j = 0; j < rows.length; j++) {
      if (!rows[j] || out[j].how !== 'new' || rows[j].map === 'new') continue;
      for (let i = 0; i < j; i++) {
        if (rows[i] && out[i].how !== 'skip' && out[i].how !== 'dup' && keyOf(rows[i].name) === keyOf(rows[j].name) && fam(rows[i]) === fam(rows[j])) {
          out[j] = { accountId: null, how: 'dup', of: i };
          break;
        }
      }
    }
    return out;
  }

  /* A name for a new account that isn't one you already have. */
  function freeName(state, name, type) {
    const taken = new Set((state.accounts || []).map((a) => keyOf(a.name)));
    const base = nameText(name, 40) || 'New account';
    if (!taken.has(keyOf(base))) return base;
    const kind = { credit: 'credit card', savings: 'savings', joint: 'joint', business: 'business', current: 'current account' }[typeOf(type)];
    let n = nameText(base + ' (' + kind + ')', 40);
    for (let i = 2; taken.has(keyOf(n)); i++) n = nameText(base, 34) + ' ' + i;
    return n;
  }

  /* What setBalances would do, without doing it. list: [{accountId, amount, overdraftLimit?}] to set;
     opts.create: [{provider, name, type, amount, overdraftLimit?}] for accounts that don't exist yet; opts.date: the day
     the balances are from (default today). Throws a plain-English Error for anything that isn't sensible.
     Returns {ops, rows, date, label, accounts}: accounts is how your accounts would look. */
  function planBalances(state, list, opts) {
    opts = opts || {};
    const sets = Array.isArray(list) ? list : [];
    const makes = Array.isArray(opts.create) ? opts.create : [];
    if (!sets.length && !makes.length) throw new Error('There are no balances to set');
    if (sets.length + makes.length > MAX_BALANCES) throw new Error('That is more than ' + MAX_BALANCES + ' accounts at once');
    const amountOf = (v, who) => {
      const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v.replace(/[£,\s]/g, '').replace(/[−–—]/g, '-')) : NaN;
      if (!Number.isFinite(n) || Math.abs(n) >= 1e7) throw new Error('The balance for ' + (who || 'an account') + ' isn’t a sensible amount (it must be a number below 10,000,000)');
      return round2(n);
    };
    const limitOf = (v, who) => {
      if (v == null || v === '') return undefined;
      const n = typeof v === 'number' ? v : Number(String(v).replace(/[£,\s]/g, ''));
      if (!Number.isFinite(n) || n < 0 || n >= 1e7) throw new Error('The overdraft limit for ' + (who || 'an account') + ' isn’t a sensible amount');
      return round2(n);
    };
    // The day the balances are from, as given (the readings checked in the hub are never in the future); today when it isn't a date.
    const date = isRealDate(opts.date) ? opts.date : today();
    const accts = (state.accounts || []).map((a) => Object.assign({}, a));
    const ops = [];
    const rows = [];
    const seen = new Set();
    const idx = new Map(accts.map((a) => [a.id, a]));
    // Sets the balance on the copy; returns what it was, and whether it set an overdraft limit too.
    const apply = (a, amount, od) => {
      const before = { anchor: a.balanceAnchor ? Object.assign({}, a.balanceAnchor) : null, overdraftLimit: a.overdraftLimit };
      a.balanceAnchor = { date: anchorDate(state, a.id, date), amount };
      // An arranged overdraft only means something on a current account.
      const limitSet = od !== undefined && familyOf(typeOf(a.type)) === 'current';
      if (limitSet) a.overdraftLimit = od;
      return { before, limitSet };
    };
    const setOne = (a, amount, od) => {
      const r = apply(a, amount, od);
      ops.push({ kind: 'set', id: a.id, anchor: Object.assign({}, a.balanceAnchor), limit: r.limitSet ? od : undefined });
      rows.push({ id: a.id, name: a.name, created: false, amount, before: r.before, limitSet: r.limitSet, after: { anchor: Object.assign({}, a.balanceAnchor), overdraftLimit: a.overdraftLimit } });
    };
    for (const it of sets) {
      const a = it && idx.get(it.accountId);
      if (!a) throw new Error('One of those accounts doesn’t exist any more');
      if (seen.has(a.id)) throw new Error('The same account is in the list twice');
      seen.add(a.id);
      setOne(a, amountOf(it.amount, a.name), limitOf(it.overdraftLimit, a.name));
    }
    const madeKeys = [];
    for (const it of makes) {
      const type = typeOf(it && it.type);
      const provider = nameText(it && it.provider, 40);
      const label = nameText(it && it.name, 40) || provider;
      if (!label) throw new Error('A new account needs a name');
      const amount = amountOf(it.amount, label);
      const od = limitOf(it.overdraftLimit, label);
      // An account of this name and kind that's already there (made a moment ago, say) is updated, never made twice.
      const there = accts.find((a) => keyOf(a.name) === keyOf(label) && familyOf(typeOf(a.type)) === familyOf(type) && !seen.has(a.id));
      if (there) {
        seen.add(there.id);
        setOne(there, amount, od);
        continue;
      }
      const key = keyOf(label) + '|' + familyOf(type);
      if (madeKeys.includes(key)) continue;
      madeKeys.push(key);
      const id = 'acc-' + GU.util.uid() + madeKeys.length;
      const rec = { id, name: freeName({ accounts: accts }, label, type), bank: provider || knownBank(label), type };
      if (!rec.bank) delete rec.bank;
      if (od !== undefined && familyOf(type) === 'current') rec.overdraftLimit = od;
      rec.balanceAnchor = { date: anchorDate(state, id, date), amount };
      accts.push(rec);
      idx.set(id, rec);
      seen.add(id);
      ops.push({ kind: 'new', rec: Object.assign({}, rec, { balanceAnchor: Object.assign({}, rec.balanceAnchor) }) });
      rows.push({ id, name: rec.name, created: true, amount, before: null, limitSet: rec.overdraftLimit !== undefined, after: { anchor: Object.assign({}, rec.balanceAnchor), overdraftLimit: rec.overdraftLimit } });
    }
    const label = opts.label || 'Updated ' + GU.util.plural(rows.length, 'balance');
    return { ops, rows, date, label, accounts: accts };
  }

  /* What your accounts hold together: every account whose balance is known, leaving out credit cards (money you owe
     isn't money you have; it is in Debts). Same figure as Right now on Today. */
  function together(state) {
    const list = accounts(state).filter((x) => x.info && (x.account.type || 'current') !== 'credit');
    return { total: sum(list, (x) => x.info.balance), spare: sum(list, (x) => x.info.overdraftLimit || 0), count: list.length, savings: list.some((x) => x.account.type === 'savings') };
  }
  /* The figure together() would give if these accounts were yours (a preview). */
  const togetherIf = (state, accts) => together({ accounts: accts, transactions: state.transactions, settings: state.settings });

  /* Sets balances in one saved step, named in Undo ('Updated 4 balances'). Returns what changed:
     {label, count, rows: [{id, name, created, amount, before, after}], created, updated, together, undo()}. undo() puts back
     the exact old anchors and overdraft limits and takes away the accounts it made (unless payments have been put in
     them since); it returns false if it had to leave one. */
  function setBalances(list, opts) {
    opts = opts || {};
    const state = GU.store.state;
    const plan = planBalances(state, list, opts);
    GU.store.commit((st) => {
      for (const op of plan.ops) {
        if (op.kind === 'new') {
          if (!st.accounts.some((a) => a.id === op.rec.id)) st.accounts.push(Object.assign({}, op.rec));
          continue;
        }
        const a = st.accounts.find((x) => x.id === op.id);
        if (!a) continue;
        a.balanceAnchor = Object.assign({}, op.anchor);
        if (op.limit !== undefined) a.overdraftLimit = op.limit;
      }
    }, { label: plan.label });
    const res = {
      label: plan.label, count: plan.rows.length, rows: plan.rows, date: plan.date,
      created: plan.rows.filter((r) => r.created).map((r) => ({ id: r.id, name: r.name })),
      updated: plan.rows.filter((r) => !r.created).map((r) => ({ id: r.id, name: r.name })),
      together: together(GU.store.state).total,
      undo() {
        let kept = 0;
        GU.store.commit((st) => {
          for (const r of plan.rows) {
            if (r.created) {
              if (st.transactions.some((t) => t.account === r.id)) kept++;
              else st.accounts = st.accounts.filter((a) => a.id !== r.id);
              continue;
            }
            const a = st.accounts.find((x) => x.id === r.id);
            if (!a) continue;
            if (r.before.anchor) a.balanceAnchor = Object.assign({}, r.before.anchor);
            else delete a.balanceAnchor;
            if (r.limitSet) {
              if (r.before.overdraftLimit === undefined) delete a.overdraftLimit;
              else a.overdraftLimit = r.before.overdraftLimit;
            }
          }
        }, { label: 'Undid “' + plan.label + '”' });
        return kept === 0;
      },
    };
    return res;
  }

  /* From readings ({provider, name, type, amount, overdraft_limit, map?, skip?}) to what setBalances takes: each reading's
     account (see matchReadings), or a new account for the ones that match none. Returns {match, list, create, plan,
     error}: plan is what it would do (null with an error message when something isn't sensible). */
  function readingsPlan(state, rows, opts) {
    const match = matchReadings(state, rows);
    const list = [];
    const create = [];
    rows.forEach((r, i) => {
      const m = match[i];
      if (m.how === 'skip' || m.how === 'dup') return;
      if (m.accountId) list.push({ accountId: m.accountId, amount: r.amount, overdraftLimit: r.overdraft_limit });
      else create.push({ provider: r.provider, name: accountNameFor(r), type: r.type, amount: r.amount, overdraftLimit: r.overdraft_limit });
    });
    let plan = null;
    let error = '';
    try {
      plan = planBalances(state, list, Object.assign({}, opts, { create }));
    } catch (e) {
      error = e.message;
    }
    return { match, list, create, plan, error };
  }
  /* Sets the balances of readings in one saved step (see setBalances). */
  function setFromReadings(rows, opts) {
    const p = readingsPlan(GU.store.state, rows, opts);
    if (p.error) throw new Error(p.error);
    return setBalances(p.list, Object.assign({}, opts, { create: p.create }));
  }

  GU.money = { accountBalance, accounts, balanceSeries, moveTransactions, mergeAccounts, accountFixes, applyFix, tidyAll, twins, importWarning,
    anchorDate, accountNameFor, matchReadings, planBalances, setBalances, readingsPlan, setFromReadings, together, togetherIf, scrub, nameText, freeName, keyOf, bankKey, knownBank, knownBankIn, familyOf, typeOf, KNOWN_BANKS, ACCOUNT_TYPES, MAX_BALANCES };
  /* ---------- instalment plans (Klarna, PayPal Pay in 3, Amazon…) ---------- */
  // Days between payments for lenders that don't collect monthly.
  const EVERY = { Clearpay: 14, Zilch: 14, Laybuy: 7 };
  /* Splits each lender's payment schedule into its separate plans, so four "Pay in 3"s from one shop or two
     Samsung plans stay apart. Every way one payment could follow another is scored by how close its spacing is
     to the lender's usual one; the best links are taken first, each payment having one before and one after. */
  function instalments(state) {
    const out = [];
    for (const d of state.debts || []) {
      if (d.closed) continue;
      const s = summary(state, d);
      if (!s.scheduled || !s.plan.length) continue;
      const l = lenderFor(d.lender) || lenderFor(d.name);
      const lender = (l || {}).name || d.lender || d.name || 'Other';
      const every = (l && EVERY[l.name]) || 30;
      const lo = Math.round((every * 2) / 3);
      const hi = Math.round(every * 1.5);
      const shop = (i) => String(i.merchant || d.name || d.lender || '').trim();
      const key = (i) => shop(i).toLowerCase();
      const similar = (a, b) => Math.abs(a.amount - b.amount) <= Math.max(1, b.amount * 0.15);
      const gapOf = (p, q) => toDays(q.date) - toDays(p.date);
      const items = s.plan.slice().sort((a, b) => a.date.localeCompare(b.date) || a.amount - b.amount);
      const links = [];
      items.forEach((p, a) => {
        for (let b = a + 1; b < items.length; b++) {
          const q = items[b];
          const gap = gapOf(p, q);
          if (gap > Math.max(45, hi)) break;
          if (key(p) !== key(q)) continue;
          let cost;
          if (p.n && q.n) {
            // Numbered: "2 of 3" then "3 of 3", at any sensible spacing (Pay in 4 every two weeks too).
            if (q.n !== p.n + 1 || (p.of || 0) !== (q.of || 0) || gap < 5) continue;
            cost = Math.abs(gap - every);
          } else if (!p.n && !q.n) {
            if (gap < lo || gap > hi) continue;
            // A refund comes off the last payments, so a smaller one can end a plan when nothing like it follows.
            const tail = q.amount < p.amount && !items.some((r) => r !== q && !r.n && key(r) === key(q) && gapOf(q, r) >= lo && gapOf(q, r) <= hi && similar(r, q));
            if (!similar(q, p) && !tail) continue;
            cost = Math.abs(gap - every) + (similar(q, p) ? 0 : 10);
          } else continue;
          links.push({ p, q, cost, diff: Math.abs(q.amount - p.amount) });
        }
      });
      links.sort((x, y) => x.cost - y.cost || x.diff - y.diff);
      const next = new Map();
      const prev = new Map();
      for (const k of links) {
        if (next.has(k.p) || prev.has(k.q)) continue;
        next.set(k.p, k.q);
        prev.set(k.q, k.p);
      }
      for (const head of items.filter((i) => !prev.has(i))) {
        const chain = [];
        for (let x = head; x; x = next.get(x)) chain.push(x);
        const first = chain[0];
        const of = first.of || null;
        out.push({
          debt: d, lender, merchant: shop(first) || lender, of, items: chain, next: first,
          stage: first.n && of ? first.n : null,
          paid: first.n ? first.n - 1 : null,
          left: chain.length, leftTotal: round2(sum(chain, (x) => x.amount)), last: chain[chain.length - 1].date,
          account: first.account || d.account || (s.lastPayment && s.lastPayment.account) || null,
        });
      }
    }
    return out.sort((a, b) => a.next.date.localeCompare(b.next.date) || a.merchant.localeCompare(b.merchant));
  }

  GU.debts = { parseSchedule, setSchedule, dataEnd, TYPES, LENDERS, lenderFor, keysFor, payments, borrowing, summary, claim, spotted, overdrafts, totals, upcoming, monthsToClear, instalments };
})();
