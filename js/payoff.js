/* The Ground Up: debt-free date and payoff plan (the card on the Debts page).
   It starts from the figures the Debts page already shows (GU.debts.summary) and the instalment plans on Bills
   (GU.debts.instalments), so the date and the totals agree with both.
     Fixed plans   Klarna, Pay in 3 and other schedules end on their last payment and can't be paid early.
     Cards, loans  a balance and a monthly payment (the one you set, or what you've been paying lately): the balance
                   runs down at its rate (APR / 12 a month, the same sum as GU.debts.monthsToClear).
     The rest      no payment set, or no balance yet: listed, but left out of the date.
   "What if I pay extra?" puts extra money towards the cards and loans, one at a time in the order you pick. */
(function () {
  'use strict';
  const GU = window.GU;
  const { esc, addMonths, shiftMonth, monthLabel, money, plural, round2, parseAmount, currencySymbol, fmtDate, daysUntil } = GU.util;
  const { icon, pill } = GU.ui;
  const D = GU.debts;

  const MAX_MONTHS = 600; // fifty years: a debt that hasn't cleared by then never will
  const MAX_POINTS = 120; // the chart and table draw at most this many months
  const ui = { extra: 0, order: 'small' }; // the "what if" box, kept while you move between pages
  let cur = null; // the figures behind the card on screen, so typing in the box doesn't work them all out again

  /* ---------- small helpers ---------- */
  const ym = (iso) => +iso.slice(0, 4) * 12 + +iso.slice(5, 7) - 1;
  const monthsApart = (from, to) => ym(to) - ym(from);
  const idxOf = (asOf, iso) => Math.max(0, monthsApart(asOf, iso));
  const mon = (iso) => GU.util.MONTHS[+iso.slice(5, 7) - 1] + ' ' + iso.slice(0, 4);
  const monLong = (iso) => monthLabel(iso.slice(0, 7), true);
  const pounds = (n) => money(n, { whole: Number.isInteger(n) });
  const wholeMoney = (n) => money(n, { whole: true });
  const names = (list) => (list.length > 1 ? list.slice(0, -1).join(', ') + ' and ' + list[list.length - 1] : list[0] || '');

  /* ---------- what's owed, debt by debt ---------- */
  /* One row per debt that still has something to pay (closed and paid-off ones are left out), worked out from
     the same summary the Debts page uses. kind: 'fixed', 'rev' (a card or loan with a payment), 'nopay', 'nobal'. */
  function rowsFor(state) {
    const asOf = D.dataEnd(state);
    const plans = D.instalments(state);
    const rows = [];
    for (const d of state.debts || []) {
      if (d.closed) continue;
      const s = D.summary(state, d);
      if (s.finished) continue;
      const known = s.balanceKnown && typeof s.estBalance === 'number';
      const bal = known ? round2(s.estBalance) : null;
      if (known && !(bal > 0)) continue; // nothing left, or a credit balance
      const r = {
        id: d.id, name: d.name || d.lender || 'Debt', type: d.type || '', kind: 'rev', balance: bal, payment: Number(s.payment) || 0, apr: Math.max(0, Number(d.apr) || 0),
        usual: !s.scheduled && !s.byTerm && !(Number(d.monthlyPayment) > 0), progress: s.progress, plans: 0, items: null, term: 0, idx: null, last: null,
      };
      if (s.scheduled) {
        r.kind = 'fixed';
        r.items = s.plan.map((i) => ({ idx: idxOf(asOf, i.date), amount: i.amount }));
        r.last = s.clearBy;
        r.idx = idxOf(asOf, r.last);
        r.plans = plans.filter((p) => p.debt.id === d.id).length;
      } else if (s.byTerm) {
        r.kind = 'fixed';
        r.term = s.months;
        r.last = s.clearBy;
        r.idx = s.months;
      } else if (bal == null) r.kind = 'nobal';
      else if (!(r.payment > 0)) r.kind = 'nopay';
      rows.push(r);
    }
    const od = D.overdrafts(state);
    return { asOf, rows, overdraft: round2(od.reduce((a, o) => a + o.used, 0)), overdrafts: od.length };
  }

  /* ---------- running the months forward ---------- */
  /* Every card and loan, month by month. Each month: interest is added, the usual payment comes off, then any
     extra goes to the first debt in the order (smallest balance, or highest interest rate), and on to the next
     once that one is clear. With no extra it ends the same month GU.debts.monthsToClear says, as the Debts page does. */
  function simulate(revs, extra, order) {
    const sims = {};
    const st = revs.map((r) => {
      const never = !(extra > 0) && D.monthsToClear(r.balance, r.payment, r.apr) === Infinity;
      return (sims[r.id] = { r, bal: r.balance, rate: r.apr / 1200, series: [r.balance], interest: 0, idx: null, off: never });
    });
    for (let k = 1; k <= MAX_MONTHS; k++) {
      const live = st.filter((x) => x.idx == null && !x.off);
      if (!live.length) break;
      const queue = extra > 0 ? live.slice().sort(order === 'apr' ? (a, b) => b.r.apr - a.r.apr || a.bal - b.bal : (a, b) => a.bal - b.bal) : [];
      for (const x of live) {
        const i = x.bal * x.rate;
        x.interest += i;
        x.bal += i;
        x.bal -= Math.min(x.r.payment, x.bal);
      }
      let pool = extra;
      for (const x of queue) {
        if (!(pool > 0)) break;
        const p = Math.min(pool, x.bal);
        x.bal -= p;
        pool -= p;
      }
      for (const x of live) {
        if (x.bal < 0.005) {
          x.bal = 0;
          x.idx = k;
        }
        x.series.push(x.bal);
      }
    }
    if (!(extra > 0)) {
      // Line up with the Debts page to the month, whatever pennies the sum above ends up with.
      for (const x of st) {
        if (x.off) continue;
        const n = D.monthsToClear(x.r.balance, x.r.payment, x.r.apr);
        if (!isFinite(n) || n > MAX_MONTHS) {
          x.idx = null;
          x.off = true;
        } else if (n !== x.idx) {
          x.idx = n;
          x.series.length = Math.min(x.series.length, n + 1);
          while (x.series.length < n) x.series.push(x.series[x.series.length - 1] || 0);
          x.series[n] = 0;
        }
      }
    }
    return sims;
  }

  /* What's still owed on a debt at the end of month `i` (0 is the month the figures run from). */
  function balanceAt(r, i) {
    if (r.kind === 'fixed') {
      if (i >= r.idx) return 0;
      if (r.items) return Math.max(0, round2(r.balance - r.items.reduce((a, x) => (x.idx <= i ? a + x.amount : a), 0)));
      return round2(Math.max(0, r.term - i) * r.payment);
    }
    return r.series ? r.series[i] || 0 : r.balance || 0;
  }

  /* The plan: each row with its payoff month, the date everything is clear, and the totals. `an` is rowsFor(state). */
  function project(an, o) {
    o = o || {};
    const extra = Math.max(0, Number(o.extra) || 0);
    const order = o.order === 'apr' ? 'apr' : 'small';
    const sims = simulate(an.rows.filter((r) => r.kind === 'rev'), extra, order);
    const rows = an.rows.map((r) => {
      const x = Object.assign({}, r, { never: false, payoff: null, interest: null });
      if (r.kind === 'fixed') x.payoff = r.last;
      else if (r.kind === 'rev') {
        const sim = sims[r.id];
        x.idx = sim.idx;
        x.series = sim.series;
        x.never = sim.idx == null;
        x.payoff = sim.idx == null ? null : addMonths(an.asOf, sim.idx);
        x.interest = sim.idx == null ? null : round2(sim.interest);
      }
      return x;
    });
    const planned = rows.filter((r) => r.payoff);
    const lastRow = planned.reduce((m, r) => (!m || r.payoff > m.payoff ? r : m), null);
    return {
      asOf: an.asOf, extra, order, rows, planned, lastRow,
      date: lastRow ? lastRow.payoff : null,
      never: rows.filter((r) => r.never),
      leftOut: rows.filter((r) => r.kind === 'nopay' || r.kind === 'nobal'),
      owed: round2(rows.reduce((a, r) => a + (r.balance || 0), 0)),
      monthly: round2(rows.reduce((a, r) => a + (r.payment || 0), 0)),
      interest: round2(planned.reduce((a, r) => a + (r.interest || 0), 0)),
      overdraft: an.overdraft, overdrafts: an.overdrafts,
    };
  }

  /* The whole thing for a state, e.g. plan(state) or plan(state, { extra: 50, order: 'apr' }). */
  function plan(state, o) {
    return project(rowsFor(state), o);
  }

  /* Total still owed on the given debts: now, then at the end of each month. The last month is when the last of them is paid. */
  function totalsSeries(res, ids) {
    const rows = res.rows.filter((r) => ids.has(r.id));
    const last = rows.reduce((m, r) => Math.max(m, r.idx || 0), 0);
    const out = [{ at: 0, label: 'Now', value: round2(rows.reduce((a, r) => a + r.balance, 0)), by: rows.map((r) => r.balance) }];
    for (let i = 0; i <= last; i++) {
      const by = rows.map((r) => balanceAt(r, i));
      out.push({ at: i + 1, label: mon(shiftMonth(res.asOf.slice(0, 7), i) + '-01'), value: round2(by.reduce((a, b) => a + b, 0)), by });
    }
    return { rows, points: out };
  }

  /* ---------- the card ---------- */
  function monthsSooner(a, b) {
    return a && b ? monthsApart(b, a) : null; // a is the later date
  }

  function whenCell(r, base, extra) {
    if (r.kind === 'nopay') return '<span class="muted">No payment set</span><em>left out of the date</em>';
    if (r.kind === 'nobal') return '<span class="muted">Add the balance</span><em>left out of the date</em>';
    if (r.never) {
      const interest = (r.balance * r.apr) / 1200;
      return interest >= r.payment + extra
        ? pill('Never at this payment', 'crit', 'alert') + '<em>this payment doesn’t even cover the interest, about ' + esc(money(interest)) + ' a month</em>'
        : pill('Not in 50 years', 'crit', 'alert') + '<em>at this payment</em>';
    }
    if (r.kind === 'fixed') return '<b>' + esc(mon(r.payoff)) + '</b><em>' + (r.items ? 'fixed plan' : plural(r.term, 'payment') + ' to go') + '</em>';
    const before = base && base.rows.find((x) => x.id === r.id);
    const sooner = before && before.payoff ? monthsSooner(before.payoff, r.payoff) : null;
    if (before && !before.payoff) return '<b class="payoff__better">' + esc(mon(r.payoff)) + '</b><em>it never clears at its usual payment</em>';
    if (sooner > 0) return '<b class="payoff__better">' + esc(mon(r.payoff)) + '</b><em>' + esc(plural(sooner, 'month')) + ' sooner</em>';
    return '<b>' + esc(mon(r.payoff)) + '</b><em>' + esc(plural(r.idx, 'payment')) + ' to go</em>';
  }

  function rowHTML(r, base, extra) {
    const sub = r.kind === 'fixed'
      ? (r.items ? plural(r.plans || 1, 'plan') + ' · last payment ' + fmtDate(r.last, { short: true }) : plural(r.term, 'payment') + ' to go')
      : [r.type, r.apr ? r.apr + '% APR' : ''].filter(Boolean).join(' · ');
    const pay = r.payment > 0 ? money(r.payment) : '–';
    const paySub = r.payment > 0 ? (r.kind === 'fixed' ? 'in the next 30 days' : 'a month' + (r.usual ? ', your usual' : '')) : '';
    const pct = r.progress != null && r.progress > 0.004 ? Math.round(r.progress * 100) : 0;
    return '<tr data-po-row="' + esc(r.id) + '"><td class="payoff__name"><button type="button" class="link link--btn" data-po-go="' + esc(r.id) + '">' + esc(r.name) + '</button>' +
      '<em>' + esc(sub) + '</em><em class="payoff__paysub">' + esc(r.payment > 0 ? pay + ' ' + paySub : 'no payment found') + '</em>' +
      (r.progress != null ? '<span class="payoff__bar" role="img" aria-label="' + pct + '% paid off"><i style="width:' + pct + '%"></i></span>' : '') + '</td>' +
      '<td class="num">' + (r.balance != null ? esc(money(r.balance)) : '–') + '</td>' +
      '<td class="num hide-sm">' + esc(pay) + (paySub ? '<em>' + esc(paySub) + '</em>' : '') + '</td>' +
      '<td class="num payoff__when">' + whenCell(r, base, extra) + '</td></tr>';
  }

  function summaryHTML(base) {
    const last = base.lastRow;
    let when;
    let sub;
    let crit = false;
    if (base.never.length) {
      when = 'Not yet';
      crit = true;
      sub = (base.never.length === 1 ? base.never[0].name + ' won’t clear' : plural(base.never.length, 'debt') + ' won’t clear') + ' at ' + (base.never.length === 1 ? 'its' : 'their') + ' current payment' + (base.never.length === 1 ? '' : 's') +
        (last ? '. The rest are clear by ' + monLong(base.date) : '');
    } else if (last) {
      when = monLong(base.date);
      sub = last.kind === 'fixed' ? 'your last payment is to ' + last.name : last.name + ' is the last one to clear';
    } else {
      when = '–';
      sub = 'add a monthly payment to a debt';
    }
    return '<div class="payoff__sum">' +
      '<div><span>Debt-free by</span><b class="' + (crit ? 'is-crit' : '') + '">' + esc(when) + '</b><em>' + esc(sub) + '</em></div>' +
      '<div><span>Still to pay</span><b>' + esc(money(base.owed)) + '</b><em>' + esc(plural(base.rows.length, 'debt') + (base.leftOut.length ? ', ' + base.leftOut.length + ' left out of the date' : '')) + '</em></div>' +
      (base.interest >= 0.5 ? '<div><span>Interest to come</span><b>' + esc(money(base.interest)) + '</b><em>on top, at the rates you’ve given me</em></div>' : '') +
      '</div>';
  }

  function notesHTML(base) {
    const notes = [];
    if (base.leftOut.length) {
      notes.push('Left out of the date: ' + names(base.leftOut.map((r) => r.name + (r.kind === 'nopay' ? ' (no payment set)' : ' (needs a balance)'))) + '. Add a ' +
        (base.leftOut.some((r) => r.kind === 'nopay') ? 'monthly payment' : 'balance') + ' from the debt’s Edit button and it joins the plan.');
    }
    if (base.overdrafts) {
      notes.push((base.overdrafts === 1 ? 'Your overdraft' : 'Your overdrafts') + ' (' + wholeMoney(base.overdraft) + (base.overdrafts === 1 ? '' : ' in all') + ') ' + (base.overdrafts === 1 ? 'isn’t' : 'aren’t') + ' in this plan, as ' + (base.overdrafts === 1 ? 'it has' : 'they have') + ' no set payment.');
    }
    return notes.map((n) => '<p class="payoff__note">' + icon('info') + '<span>' + esc(n) + '</span></p>').join('');
  }

  function topHTML(base, alt) {
    const rows = alt.rows;
    // The ones that clear, soonest first; then any that never clear; then those left out of the date.
    const rank = (r) => (r.payoff ? 0 : r.never ? 1 : 2);
    const sorted = rows.slice().sort((a, b) => rank(a) - rank(b) || (a.payoff || '').localeCompare(b.payoff || '') || (b.balance || 0) - (a.balance || 0));
    return summaryHTML(base) +
      '<div class="table-wrap"><table class="tbl payoff__tbl"><thead><tr><th>Debt</th><th class="num">Left<span class="payoff__long"> to pay</span></th><th class="num hide-sm">Payment</th><th class="num">Pays off</th></tr></thead><tbody>' +
      sorted.map((r) => rowHTML(r, base, alt.extra)).join('') +
      '</tbody><tfoot><tr><th scope="row">All ' + esc(plural(rows.length, 'debt')) + '</th><td class="num">' + esc(money(base.owed)) + '</td><td class="num hide-sm">' + esc(money(base.monthly)) + '<em>a month</em></td>' +
      '<td class="num">' + (alt.date ? esc(mon(alt.date)) : '–') + '</td></tr></tfoot></table></div>' +
      notesHTML(base);
  }

  /* The "what if" sentence. */
  function resultHTML(base, alt) {
    const extra = alt.extra;
    if (!(extra > 0)) return 'Put in an amount to see how much sooner you could be clear, and how much interest it would save.';
    const revs = alt.rows.filter((r) => r.kind === 'rev');
    const was = (r) => base.rows.find((x) => x.id === r.id);
    const gains = revs.map((r) => ({ r, was: was(r), sooner: was(r).payoff && r.payoff ? monthsSooner(was(r).payoff, r.payoff) : 0, rescued: !was(r).payoff && !!r.payoff }));
    const lead = 'Paying ' + pounds(extra) + ' extra a month';
    const rescued = gains.filter((g) => g.rescued);
    const better = gains.filter((g) => g.sooner > 0);
    const out = [];
    if (!better.length && !rescued.length) {
      const stuck = revs.filter((r) => r.never);
      return esc(lead + (stuck.length ? ' still isn’t enough to clear ' + names(stuck.map((r) => r.name)) + '. Try a bit more.' : ' doesn’t change anything yet.'));
    }
    if (better.length) {
      const finite = revs.filter((r) => was(r).payoff);
      const lastWas = finite.reduce((m, r) => (was(r).payoff > m ? was(r).payoff : m), '');
      const lastNow = finite.reduce((m, r) => (r.payoff > m ? r.payoff : m), '');
      const all = monthsSooner(lastWas, lastNow);
      let s;
      if (revs.length > 1 && all > 0) s = lead + ' clears your debts with a monthly payment ' + plural(all, 'month') + ' sooner (the last one in ' + monLong(lastNow) + ')';
      else {
        const top = better.reduce((m, g) => (g.sooner > m.sooner ? g : m), better[0]);
        s = lead + ' clears ' + top.r.name + ' ' + plural(top.sooner, 'month') + ' sooner (' + monLong(top.r.payoff) + ')';
      }
      const saved = round2(finite.reduce((a, r) => a + (was(r).interest || 0) - (r.interest || 0), 0));
      out.push(esc(s + (saved >= 1 ? ' and saves you about ' + wholeMoney(saved) + ' in interest.' : '.')));
    }
    for (const g of rescued) out.push(esc((out.length ? 'And ' + g.r.name + ' would clear' : lead + ' would clear ' + g.r.name) + ' in ' + monLong(g.r.payoff) + ', which it never would at its current payment.'));
    if (alt.date && base.date && alt.date !== base.date && !base.never.length) {
      const m = monthsSooner(base.date, alt.date);
      if (m > 0) out.push(esc('Your debt-free date moves from ' + monLong(base.date) + ' to ' + monLong(alt.date) + '.'));
    } else if (alt.date && alt.lastRow && alt.lastRow.kind === 'fixed' && base.date === alt.date) {
      out.push(esc('Your debt-free date stays ' + monLong(alt.date) + ', because ' + alt.lastRow.name + ' is a fixed plan that runs until then.'));
    }
    return out.join(' ');
  }

  function ifHTML(base, alt) {
    const revs = base.rows.filter((r) => r.kind === 'rev');
    const head = '<h3>What if I pay extra?</h3>';
    if (!revs.length) {
      return head + '<p class="payoff__help">' + esc('Your instalment plans are fixed, so they can’t be paid off early.' + (base.date ? ' They end by ' + monLong(base.date) + '.' : '')) + '</p>';
    }
    const fixed = base.rows.some((r) => r.kind === 'fixed');
    const opt = (v, label, hint) => '<label><input type="radio" name="payoff-order" value="' + v + '"' + (ui.order === v ? ' checked' : '') + '><span title="' + esc(hint) + '">' + esc(label) + '</span></label>';
    return head + '<p class="payoff__help">' + esc('Put extra money towards ' + (revs.length > 1 ? 'your debts' : revs[0].name) + ' each month, on top of what you pay now.' + (fixed ? ' Instalment plans are fixed, so they stay as they are.' : '')) + '</p>' +
      '<div class="payoff__ctl">' +
      '<div class="field"><label class="field__label" for="payoff-extra">Extra each month</label><div class="money-input"><span>' + esc(currencySymbol()) + '</span>' +
      '<input id="payoff-extra" data-keep-focus type="text" inputmode="decimal" autocomplete="off" placeholder="0" value="' + (ui.extra > 0 ? esc(String(ui.extra)) : '') + '"></div></div>' +
      (revs.length > 1 && new Set(revs.map((r) => r.apr)).size > 1 ? '<div class="field"><span class="field__label" id="payoff-order-label">Pay off first</span><div class="seg seg--sm" role="radiogroup" aria-labelledby="payoff-order-label">' +
        opt('small', 'Smallest first', 'The debt with the smallest balance gets the extra first') + opt('apr', 'Highest interest first', 'The debt with the highest interest rate gets the extra first') + '</div></div>' : '') +
      '</div><p class="payoff__result" data-po="result" role="status">' + resultHTML(base, alt) + '</p>';
  }

  function chartHTML(base, alt) {
    const ids = new Set(base.planned.map((r) => r.id));
    if (!ids.size) return '';
    const a = totalsSeries(alt, ids);
    const b = alt.extra > 0 ? totalsSeries(base, ids) : null;
    const len = Math.max(a.points.length, b ? b.points.length : 0);
    const at = (s, i) => (s.points[i] ? s.points[i].value : 0);
    if (len < 2) return '';
    const stride = Math.ceil(len / MAX_POINTS);
    const pick = [];
    for (let i = 0; i < len; i++) if (i === 0 || i === len - 1 || i % stride === 0) pick.push(i);
    const label = (i) => (a.points[i] ? a.points[i].label : b.points[i].label);
    const points = pick.map((i) => ({ value: at(a, i), tip: label(i) + ': ' + wholeMoney(at(a, i)) + (i ? ' left' : ' to pay') }));
    const marks = [0, Math.floor((points.length - 1) / 2), points.length - 1].filter((v, i, all) => all.indexOf(v) === i);
    const left = base.rows.length - ids.size;
    const fig = GU.charts.line(points, {
      height: 150, color: '--series-out', base: b ? pick.map((i) => at(b, i)) : null,
      labels: marks.map((m) => ({ i: m, text: m === 0 ? 'Now' : label(pick[m]) })),
      table: a.rows.length > 1 && a.rows.length <= 8
        ? { head: ['End of', 'All'].concat(a.rows.map((r) => r.name)), rows: pick.map((i) => [label(i), money(at(a, i))].concat(a.rows.map((r, k) => money(a.points[i] ? a.points[i].by[k] : 0)))) }
        : { head: ['End of', 'Left to pay'], rows: pick.map((i) => [label(i), money(at(a, i))]) },
    });
    return '<div class="payoff__chart"><h3>What you’ll still owe, month by month</h3>' + fig +
      (b ? '<p class="payoff__cap">The dashed line is how it looks without the extra.</p>' : '') +
      (left ? '<p class="payoff__cap">Only the debts with a payment plan are drawn.</p>' : '') + '</div>';
  }

  function innerHTML(an) {
    const base = project(an);
    const alt = ui.extra > 0 && base.rows.some((r) => r.kind === 'rev') ? project(an, { extra: ui.extra, order: ui.order }) : base;
    return '<header class="panel__head"><h2>' + icon('trend') + 'Debt-free date</h2><span class="muted">' + esc(daysUntil(an.asOf) < -14 ? 'worked out from your statements to ' + fmtDate(an.asOf, { short: true }) : 'at what you pay now') + '</span></header>' +
      '<div data-po="top">' + topHTML(base, alt) + '</div>' +
      '<div class="payoff__if" data-po="if">' + ifHTML(base, alt) + '</div>' +
      '<div data-po="chart">' + chartHTML(base, alt) + '</div>';
  }

  /* The card for the Debts page, or '' when there's nothing to plan. Never lets a problem here break that page. */
  function card(state) {
    try {
      const an = rowsFor(state);
      cur = an;
      if (!an.rows.length) return '';
      return '<section class="panel payoff" data-payoff aria-label="Debt-free date and payoff plan">' + innerHTML(an) + '</section>';
    } catch (e) {
      console.error(e);
      return '';
    }
  }

  /* Hooks up the extra box and the order switch. The rest of the card is redrawn as you type; the box itself isn't. */
  function wire(root) {
    const el = root.querySelector('[data-payoff]');
    if (!el || !cur) return;
    const an = cur;
    const part = (name) => el.querySelector('[data-po="' + name + '"]');
    const update = () => {
      try {
        const base = project(an);
        const alt = ui.extra > 0 && base.rows.some((r) => r.kind === 'rev') ? project(an, { extra: ui.extra, order: ui.order }) : base;
        part('top').innerHTML = topHTML(base, alt);
        const res = part('result');
        if (res) res.innerHTML = resultHTML(base, alt);
        part('chart').innerHTML = chartHTML(base, alt);
      } catch (e) {
        console.error(e);
      }
    };
    el.addEventListener('input', (e) => {
      if (e.target.id !== 'payoff-extra') return;
      const raw = e.target.value.trim();
      const v = raw ? parseAmount(raw) : 0;
      ui.extra = isNaN(v) ? 0 : Math.min(1e6, Math.abs(v));
      update();
      if (raw && isNaN(v)) part('result').textContent = 'Put in an amount, for example 50.';
    });
    el.addEventListener('change', (e) => {
      if (e.target.name !== 'payoff-order') return;
      ui.order = e.target.value === 'apr' ? 'apr' : 'small';
      update();
    });
    el.addEventListener('click', (e) => {
      const go = e.target.closest('[data-po-go]');
      if (!go) return;
      const art = root.querySelector('[data-debt="' + String(go.dataset.poGo).replace(/["\\]/g, '\\$&') + '"]');
      if (!art) return;
      art.scrollIntoView({ block: 'start', behavior: window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
      art.setAttribute('tabindex', '-1');
      art.focus({ preventScroll: true });
    });
  }

  GU.payoff = { plan, rowsFor, project, card, wire, ui };
})();
