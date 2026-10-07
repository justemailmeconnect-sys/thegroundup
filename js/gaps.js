/* The Ground Up: missing statements (GU.gaps).
   For each bank account you import statements into, works out which calendar months the imported lines cover,
   so a hole in the middle, or statements that stopped coming, can be pointed out.
   Only imported lines count (source 'import' or an importBatch). An account you fill in by hand is left alone,
   and so is one that has gone quiet for six months, one that only has a line now and then, and one you've said
   you don't import (account.noImports). 'Not now' hides what's showing until next month (meta.gapsSeen). */
(function () {
  'use strict';
  const GU = window.GU;
  const { esc, today, addDays, addMonths, toDays, isISO, fmtDate, relDays, shiftMonth, plural, sum } = GU.util;
  const { icon, toast } = GU.ui;
  const store = GU.store;

  const STALE_DAYS = 35; // an account whose latest imported line is older than this is behind
  const EARLY_DAYS = 7; // the first days of a month, when last month's statement is due
  const SLACK_DAYS = 3; // days short of last month's end that are let go before it asks
  const KEY_SEP = '|';

  /* Every month key from one to another, inclusive. */
  function monthKeys(from, to) {
    const out = [];
    for (let k = from, guard = 0; k <= to && guard++ < 600; k = shiftMonth(k, 1)) out.push(k);
    return out;
  }
  /* 'March 2026', 'March and April 2026', 'December 2025 and January 2026', 'March, April, May and 2 more'. */
  function monthsText(keys) {
    const shown = keys.slice(0, 3);
    const name = (k, year) => GU.util.MONTHS_LONG[+k.slice(5) - 1] + (year ? ' ' + k.slice(0, 4) : '');
    const oneYear = new Set(shown.map((k) => k.slice(0, 4))).size === 1;
    const names = shown.map((k, i) => name(k, !oneYear || (i === shown.length - 1 && keys.length <= 3)));
    if (keys.length > 3) return names.join(', ') + ' and ' + (keys.length - 3) + ' more';
    return names.length > 1 ? names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1] : names[0];
  }

  /* The usual number of days between one line and the next, over the latest ones: about 1 for an account you use every
     day, about 30 for one that gets a single payment a month. */
  function usualGap(days) {
    const list = Array.from(days).sort().slice(-60);
    const gaps = [];
    for (let i = 1; i < list.length; i++) gaps.push(toDays(list[i]) - toDays(list[i - 1]));
    gaps.sort((x, y) => x - y);
    return gaps.length ? gaps[Math.floor(gaps.length / 2)] : 0;
  }

  /* ---------- what each account covers ---------- */
  /* One entry for every account that has imported lines: its first and latest imported date, the months it covers,
     the months missing from the middle, and whether it's worth asking about at all.
     status: 'ok' (worth asking about), 'off' (you said you don't import it), 'dormant' (nothing for six months) or
     'sparse' (a line now and then, so an empty month isn't a missing statement). now: a date, for testing. */
  function coverage(state, now) {
    now = now || today();
    const by = new Map();
    for (const t of state.transactions || []) {
      if (!(t.source === 'import' || t.importBatch) || !isISO(t.date)) continue;
      let a = by.get(t.account);
      if (!a) by.set(t.account, (a = { months: new Set(), days: new Set(), first: t.date, last: t.date, lines: 0 }));
      a.months.add(t.date.slice(0, 7));
      a.days.add(t.date);
      a.lines++;
      if (t.date < a.first) a.first = t.date;
      if (t.date > a.last) a.last = t.date;
    }
    const out = [];
    for (const account of state.accounts || []) {
      const a = by.get(account.id);
      if (!a) continue;
      const span = monthKeys(a.first.slice(0, 7), a.last.slice(0, 7));
      const months = Array.from(a.months).sort();
      let status = 'ok';
      if (account.noImports) status = 'off';
      else if (a.last < addMonths(now, -6)) status = 'dormant';
      else if (months.length < 2 || months.length / span.length < 0.5) status = 'sparse';
      out.push({
        account, first: a.first, last: a.last, lines: a.lines, months, span: span.length, status, usualGap: usualGap(a.days),
        gapMonths: status === 'ok' ? span.filter((k) => !a.months.has(k)) : [],
        staleDays: toDays(now) - toDays(a.last),
      });
    }
    return out;
  }

  /* ---------- 'Not now' ---------- */
  /* The things you've hidden this month. */
  function seenKeys(state, now) {
    const g = state.meta && state.meta.gapsSeen;
    return new Set(g && g.month === (now || today()).slice(0, 7) && Array.isArray(g.keys) ? g.keys : []);
  }

  /* ---------- what to ask about ---------- */
  /* The accounts to ask about, oldest first: {id, name, last, after, gap, gapMonths, keys, seen, sentence, detail}.
     after: nothing since a while ago (more than 35 days, or in the first week of a month, nothing for the last few
     days of the month before). gap: whole months with no lines between two that have some.
     o.now: a date (for testing); o.all: include what's been hidden. */
  function issues(state, o) {
    o = o || {};
    const now = o.now || today();
    const seen = seenKeys(state, now);
    const early = +now.slice(8) <= EARLY_DAYS;
    const prevEnd = addDays(now.slice(0, 7) + '-01', -1);
    const out = [];
    for (const c of coverage(state, now)) {
      if (c.status !== 'ok') continue;
      // In the first week of a month, an account you use most days should have lines up to the end of last month.
      const after = c.staleDays > STALE_DAYS || (early && c.usualGap <= 7 && c.last < addDays(prevEnd, -SLACK_DAYS));
      const gap = c.gapMonths.length > 0;
      if (!after && !gap) continue;
      const keys = [];
      if (after) keys.push(c.account.id + ':after');
      if (gap) keys.push(c.account.id + ':gap:' + c.gapMonths.join('+'));
      const bits = [];
      if (after) bits.push('nothing after ' + fmtDate(c.last, { short: true }));
      if (gap) bits.push('nothing for ' + monthsText(c.gapMonths));
      const detail = [];
      if (after) detail.push('The latest line I have is from ' + fmtDate(c.last, { short: true }) + ' (' + relDays(c.last) + ').');
      if (gap) detail.push('There are statements either side of ' + (c.gapMonths.length === 1 ? 'it' : 'them') + ', so ' + (c.gapMonths.length === 1 ? 'one is' : 'some are') + ' probably missing.');
      const i = { id: c.account.id, name: c.account.name || 'This account', last: c.last, after, gap, gapMonths: c.gapMonths, staleDays: c.staleDays, keys, seen: keys.every((k) => seen.has(k)), detail: detail.join(' ') };
      i.sentence = i.name + ' has ' + bits.join(' and ');
      out.push(i);
    }
    out.sort((a, b) => a.last.localeCompare(b.last) || a.name.localeCompare(b.name));
    return o.all ? out : out.filter((i) => !i.seen);
  }

  /* Items for Home's 'Needs attention' list. An account that already has 'Import your latest statement' there
     (its balance is more than two weeks old) isn't told about being behind twice. */
  function attention(state, o) {
    try {
      return attentionItems(state, o || {});
    } catch (e) {
      console.error(e);
      return [];
    }
  }
  function attentionItems(state, o) {
    const told = (id) => {
      const b = GU.money ? GU.money.accountBalance(state, id) : null;
      return !!b && b.staleDays >= 14;
    };
    const out = [];
    for (const i of issues(state, o)) {
      const after = i.after && !told(i.id);
      if (!after && !i.gap) continue;
      const bits = [];
      if (after) bits.push('nothing after ' + fmtDate(i.last, { short: true }));
      if (i.gap) bits.push('nothing for ' + monthsText(i.gapMonths));
      out.push({ level: 'info', tab: 'transactions', account: i.id, title: 'Statements to import: ' + i.name + ' has ' + bits.join(' and '), detail: 'Import the statement and I’ll bring your balances and bills up to date', dismiss: i.keys });
    }
    return out;
  }

  /* The latest imported line across the accounts you do import, or '' when there's none. */
  function latest(state, now) {
    return coverage(state, now).filter((c) => c.status !== 'off').reduce((m, c) => (c.last > m ? c.last : m), '');
  }

  /* Things you paid for at work that can't have been matched to a bank payment yet, because your latest statement
     stops before they were bought. null when there are none, or no statements. */
  function claimsBehind(state, now) {
    const W = GU.workMoney;
    const last = W ? latest(state, now) : '';
    if (!last) return null;
    const rows = W.claims(state, 'open').filter((x) => !x.p.purchaseTx && !x.unpaid && x.p.date && x.p.date > last);
    if (!rows.length) return null;
    return { last, count: rows.length, oldest: rows.map((x) => x.p.date).sort()[0], total: sum(rows, (x) => x.left) };
  }

  /* ---------- changes, each with Undo ---------- */
  /* 'Not this one': stop asking about an account. */
  function setNoImports(id, on) {
    const a = store.find('accounts', id);
    if (!a) return;
    const was = !!a.noImports;
    const set = (v) => store.commit((s) => {
      const x = s.accounts.find((y) => y.id === id);
      if (!x) return;
      if (v) x.noImports = true;
      else delete x.noImports;
    });
    set(on);
    if (on === was) return;
    toast(on ? 'OK, I won’t ask about ' + a.name + ' again. You can turn it back on from its Update button on the Bank page.' : 'I’ll check ' + a.name + ' again', { action: 'Undo', onAction: () => set(was), timeout: 10000 });
  }
  /* 'Not now': hide these until next month. */
  function dismiss(keys) {
    keys = (keys || []).filter(Boolean);
    if (!keys.length) return;
    const month = today().slice(0, 7);
    const before = store.state.meta && store.state.meta.gapsSeen;
    store.commit((s) => {
      s.meta = s.meta || {};
      const g = s.meta.gapsSeen;
      const cur = g && g.month === month && Array.isArray(g.keys) ? g.keys : [];
      s.meta.gapsSeen = { month, keys: Array.from(new Set(cur.concat(keys))) };
    });
    toast('OK, I’ll leave it until next month', {
      action: 'Undo',
      onAction: () => store.commit((s) => {
        if (before === undefined) delete s.meta.gapsSeen;
        else s.meta.gapsSeen = before;
      }),
    });
  }

  /* ---------- the card on the Bank page ---------- */
  function cardHTML(state, o) {
    let list = [];
    try {
      list = issues(state, o);
    } catch (e) {
      console.error(e);
    }
    if (!list.length) return '';
    const keys = Array.from(new Set(list.flatMap((i) => i.keys)));
    return '<section class="panel panel--spotted stmt-gaps" aria-label="Statements to import"><header class="panel__head"><h2>' + icon('upload') + 'Statements to import</h2>' +
      '<button type="button" class="btn btn--sm btn--ghost" data-gaps-dismiss="' + esc(keys.join(KEY_SEP)) + '" data-tip="Hide this until next month">Not now</button></header><ul class="rows">' +
      list.map((i) => '<li class="spot"><span class="row-item__icon">' + icon('bank') + '</span><span class="spot__text"><b>' + esc(i.sentence) + '</b><em>' + esc(i.detail) + '</em></span>' +
        '<span class="spot__act"><button type="button" class="btn btn--sm btn--primary" data-gaps-import>' + icon('upload') + 'Import a statement</button>' +
        '<button type="button" class="btn btn--sm btn--ghost" data-gaps-off="' + esc(i.id) + '" data-tip="Stop asking about this account">Not this one</button></span></li>').join('') +
      '</ul></section>';
  }

  /* The note in Get paid back's 'From your bank' when the statements stop before what you paid for. */
  function claimsNoteHTML(state) {
    let b = null;
    try {
      b = claimsBehind(state);
    } catch (e) {
      console.error(e);
    }
    if (!b) return '';
    return '<div class="gaps-note">' + icon('clock') + '<span>' + esc('Your latest statement stops on ' + fmtDate(b.last, { short: true }) + ', so I can’t find the bank payment for ' +
      (b.count === 1 ? 'the thing' : plural(b.count, 'thing')) + ' you paid for after that.') + '</span>' +
      '<button type="button" class="btn btn--sm btn--soft" data-gaps-import>' + icon('upload') + 'Import a statement</button></div>';
  }

  document.addEventListener('click', (e) => {
    const t = e.target.closest && e.target.closest('[data-gaps-import],[data-gaps-off],[data-gaps-dismiss]');
    if (!t) return;
    if (t.hasAttribute('data-gaps-import')) {
      if (GU.tabs.transactions && GU.tabs.transactions.importStatement) GU.tabs.transactions.importStatement();
    } else if (t.hasAttribute('data-gaps-off')) setNoImports(t.getAttribute('data-gaps-off'), true);
    else dismiss((t.getAttribute('data-gaps-dismiss') || '').split(KEY_SEP));
  });

  GU.gaps = { coverage, issues, attention, latest, claimsBehind, setNoImports, dismiss, cardHTML, claimsNoteHTML, monthsText };
})();
