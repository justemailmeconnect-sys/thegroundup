/* The Ground Up: work money (GU.workMoney).
   Whose money paid for each work thing, and getting your own money back from the business you work for.
   - The employer (settings.employer) and how money from them splits into wages and repayments.
   - Readers that give every older record sensible defaults: payerOf, lane, stage, isClaim.
   - Things you paid for yourself: totals, finding your bank payment and the employer's repayment,
     the claim pack (a zip with a printable summary) and every change, each with Undo.
   Nothing here names a business, shop, person or amount: it all comes from your settings and records. */
(function () {
  'use strict';
  const GU = window.GU;
  const { esc, uid, today, addDays, toDays, daysUntil, round2, sum, money, fmtDate, plural, monthLabel } = GU.util;
  const F = GU.finance;
  const store = GU.store;

  const WORK_OUT = F.WORK_OUT || 'Work expenses';
  const WORK_IN = F.WORK_IN || 'Work reimbursements';
  const TRANSFER = F.TRANSFER || 'Transfers';
  const DEFAULTS = { repayDays: 14, nudgeDays: 3, chaseDays: 21 };
  const STAGES = ['to-send', 'sent', 'paid-back'];

  /* ---------- small helpers ---------- */
  const amountOf = (p) => Math.abs(Number(p && p.amount) || 0);
  const noAmount = (p) => p.amount == null || p.amount === '';
  const byDate = (a, b) => (a.date || '9').localeCompare(b.date || '9') || (a.created || '').localeCompare(b.created || '') || String(a.id).localeCompare(String(b.id));
  const byTxDate = (a, b) => (a.date || '').localeCompare(b.date || '') || String(a.id).localeCompare(String(b.id));
  const findIn = (st, c, id) => (id ? (st[c] || []).find((x) => x.id === id) || null : null);
  const idList = (ids) => (Array.isArray(ids) ? ids : ids == null ? [] : [ids]).filter(Boolean);
  const short = (iso) => fmtDate(iso, { short: true });
  const isImported = (t) => t.source === 'import' || !!t.importBatch;
  const toast = (msg, o) => (GU.ui && GU.ui.toast ? GU.ui.toast(msg, o) : null);
  function taxYearStart(iso) {
    const d = iso || today();
    const y = +d.slice(0, 4);
    return (d.slice(5) >= '04-06' ? y : y - 1) + '-04-06';
  }
  /* Takes out anything that looks like an account, card or sort-code number, or another long reference. */
  function clean(text) {
    return String(text == null ? '' : text)
      .replace(/\b\d{4}[ -]?\d{4}[ -]?\d{4}[ -]?\d{1,7}\b/g, '…')
      .replace(/\b\d{2}[ -]\d{2}[ -]\d{2}\b/g, '…')
      .replace(/\d{5,}/g, '…')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /* ---------- the employer ---------- */
  const LEGAL = /[\s,]+(limited|ltd\.?|plc|llp|llc|inc\.?|co\.?)$/i;
  /* settings.employer with defaults filled in. Never null: `set` says whether one has been chosen.
     label is the short name to use in sentences (e.g. 'Acme', or 'the company' when none is set). */
  function employer(s) {
    s = s || store.state || {};
    const e = (s.settings && s.settings.employer) || null;
    const set = !!(e && typeof e === 'object' && (e.name || e.short));
    const name = set ? String(e.name || e.short).trim() : '';
    const shortName = set ? String(e.short || e.name).trim() : '';
    let match = set ? (Array.isArray(e.match) ? e.match : String(e.match || '').split(',')) : [];
    match = match.map((m) => String(m || '').trim().toLowerCase()).filter(Boolean);
    if (set && !match.length) match = [shortName.replace(LEGAL, '').toLowerCase()].filter(Boolean);
    const num = (v, d) => (v !== '' && v != null && Number.isFinite(Number(v)) && Number(v) >= 0 ? Number(v) : d);
    return {
      set,
      name,
      short: shortName,
      fullName: name.replace(LEGAL, '').trim(),
      label: shortName || 'the company',
      Label: shortName || 'The company',
      match,
      wageSource: (set && e.wageSource) || '',
      payInto: (set && e.payInto) || '',
      repayDays: num(e && e.repayDays, DEFAULTS.repayDays),
      nudgeDays: num(e && e.nudgeDays, DEFAULTS.nudgeDays),
      chaseDays: num(e && e.chaseDays, DEFAULTS.chaseDays),
      since: (set && e.since) || '',
      contact: (set && e.contact) || '',
    };
  }
  const flat = (text) => ' ' + String(text || '').toLowerCase().replace(/['’]/g, '').replace(/[^a-z0-9]+/g, ' ').trim() + ' ';
  /* Whether a bank description (or any text) names the employer, as whole words. */
  function isEmployerText(s, text) {
    if (typeof s === 'string' && text === undefined) {
      text = s;
      s = null;
    }
    const e = employer(s);
    if (!e.match.length || !text) return false;
    const t = flat(text);
    return e.match.some((m) => {
      const k = flat(m).trim();
      return !!k && t.includes(' ' + k + ' ');
    });
  }
  /* The income source your wages come in as. */
  function wageSource(s) {
    s = s || store.state;
    const e = employer(s);
    const list = (s && s.incomeSources) || [];
    return list.find((i) => i.id === e.wageSource) || (e.set ? list.find((i) => isEmployerText(s, (i.from || '') + ' ' + (i.name || ''))) : null) || null;
  }
  // Pay words: wages, and the extras that come with them (a bonus, overtime, holiday or sick pay).
  const WAGE = /\bwages?\b|salary|payroll|\bbonus|overtime|holiday pay|sick pay|commission/i;
  /* Whether a payment could be the employer paying you back: there is something owed to you and it is no more than
     that (one claim, a sent pack, a part of the lot, or all of it). A payment like that is them paying you back,
     however close it is to your pay; only one bigger than anything owed can be mistaken for wages. */
  function couldBeRepaid(s, a) {
    if (!(a > 0) || !claims(s, 'open').length) return false;
    return a <= dueBack(s).total + 0.005;
  }
  /* Money to or from the employer, before your own rules: 'Salary' for wages, 'Work reimbursements' for
     anything else (repayments in, money you sent back out). '' when the line isn't the employer's. */
  function employerCategory(desc, amount) {
    const s = store.state;
    const a = Number(amount);
    if (!s || !a || !Number.isFinite(a) || !isEmployerText(s, desc)) return '';
    if (a < 0) return WORK_IN;
    if (WAGE.test(String(desc))) return 'Salary';
    if (couldBeRepaid(s, round2(a))) return WORK_IN;
    const src = wageSource(s);
    const w = src ? Math.abs(Number(src.amount) || 0) : 0;
    if (w > 0 && Math.abs(a - w) <= 0.2 * w) return 'Salary';
    return WORK_IN;
  }

  /* ---------- readers: every older record gets sensible defaults ---------- */
  function kindOf(rec, c) {
    if (c) return c;
    if (!rec) return 'paperwork';
    if ('nextDue' in rec || 'frequency' in rec) return 'bills';
    if ('kind' in rec) return 'paperwork';
    return 'costIdeas';
  }
  /* 'company' (the business pays), 'me' (you paid, get it back) or null (not sorted yet). */
  function payerOf(rec, c) {
    if (!rec) return null;
    if (rec.payer === 'me' || rec.payer === 'company') return rec.payer;
    const k = kindOf(rec, c);
    if (k === 'bills') return rec.foundKey || (rec.history || []).length ? 'me' : 'company';
    if (k === 'paperwork') {
      if (rec.claim === true) return 'me';
      if (rec.kind === 'invoice-out') return 'me'; // an older invoice to the business for your expenses
      // A work warranty isn't money anyone gets back: it's kept with the business's own records. Nothing asks
      // 'whose money?' for one, so it would otherwise wait in 'Who paid?' for good.
      if (rec.kind === 'warranty') return 'company';
    }
    return null;
  }
  function isWorkRecord(rec, c) {
    const k = kindOf(rec, c);
    if (k === 'bills') return GU.parts && GU.parts.isWorkBill ? GU.parts.isWorkBill(rec) : rec.context === 'work' || (!rec.context && rec.category === WORK_OUT);
    if (k === 'costIdeas') return (rec.context || 'work') === 'work';
    return rec.context === 'work';
  }
  /* 'home' | 'ktk' (the business pays; the id is kept for the page names) | 'back' (you paid, get it back) | 'unsorted'. */
  function lane(p, c) {
    if (!p || !isWorkRecord(p, c)) return 'home';
    const who = payerOf(p, c);
    return who === 'company' ? 'ktk' : who === 'me' ? 'back' : 'unsorted';
  }
  /* 'to-send' | 'sent' | 'paid-back'. A tick from an older copy of the app (claimed) always reads as at least sent. */
  function stage(p) {
    if (!p) return 'to-send';
    const st = p.claimStatus;
    if (st === 'paid-back' || st === 'sent') return st;
    if (!st && (p.repaidTx || p.repaidDate)) return 'paid-back';
    if (p.claimed === true) return 'sent';
    return 'to-send';
  }
  /* Something you paid for work with your own money (a work invoice-out is not: it only shows in the re-sort). */
  const isClaim = (p) => !!p && lane(p, 'paperwork') === 'back' && p.kind !== 'invoice-out';
  const repaidSoFar = (p) => round2(sum(p.repayments || [], (x) => Number(x.amount) || 0));
  /* What's still to come back on a claim, after any part repayments. */
  function left(p) {
    if (stage(p) === 'paid-back') return 0;
    return Math.max(0, round2(amountOf(p) - repaidSoFar(p)));
  }

  /* The legacy claim / claimed flags, so an older copy of the app still behaves. */
  function mirrorValues(p) {
    const c = isClaim(p);
    return { claim: c, claimed: c && stage(p) !== 'to-send' };
  }
  function mirror(p) {
    if (!p) return p;
    const m = mirrorValues(p);
    for (const k of ['claim', 'claimed']) if (m[k] || k in p) p[k] = m[k];
    return p;
  }

  /* ---------- totals ---------- */
  /* Claims at a stage ('to-send', 'sent', 'paid-back', 'open' for the first two, or all), oldest first,
     each with the running total up to it: {p, amount, noAmount, running, left, stage, unpaid}. */
  function claims(s, which) {
    s = s || store.state;
    const want = which == null || which === 'all' ? null : which === 'open' ? ['to-send', 'sent'] : [].concat(which);
    let run = 0;
    return ((s && s.paperwork) || [])
      .filter((p) => isClaim(p) && (!want || want.includes(stage(p))))
      .sort(byDate)
      .map((p) => {
        const st = stage(p);
        const amount = amountOf(p);
        const l = st === 'paid-back' ? 0 : left(p);
        return { p, amount, noAmount: noAmount(p), running: (run = round2(run + (st === 'paid-back' ? amount : l))), left: l, stage: st, unpaid: p.kind === 'invoice-in' && p.status !== 'paid' };
      });
  }
  const packKey = (p) => p.packId || (p.claimedDate ? 'sent-' + p.claimedDate : 'sent');
  /* Sent claims grouped by the pack they went in, oldest first. */
  function packs(s, rows) {
    s = s || store.state;
    const e = employer(s);
    rows = rows || claims(s, 'sent');
    const map = new Map();
    for (const x of rows) {
      const k = packKey(x.p);
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(x);
    }
    return Array.from(map, ([key, items]) => {
      const date = items.map((x) => x.p.claimedDate).filter(Boolean).sort()[0] || '';
      const days = date ? Math.max(0, -daysUntil(date)) : 0;
      return { key, packId: items[0].p.packId || '', date, days, items, total: sum(items, (x) => x.amount), left: sum(items, (x) => x.left),
        late: !!date && days > e.repayDays, chase: !!date && days > e.chaseDays };
    }).sort((a, b) => (a.date || '9').localeCompare(b.date || '9'));
  }
  /* What the employer owes you: not sent yet, and sent but not paid back. An invoice you haven't paid yet
     isn't owed to you yet, so it's listed in `unpaid` and left out of the totals. */
  function dueBack(s) {
    s = s || store.state;
    const e = employer(s);
    const t = today();
    const all = claims(s, 'to-send');
    const toSend = all.filter((x) => !x.unpaid);
    const sent = claims(s, 'sent');
    const toSendTotal = sum(toSend, (x) => x.left);
    const sentTotal = sum(sent, (x) => x.left);
    const first = toSend.find((x) => x.p.date);
    const oldest = first ? { p: first.p, date: first.p.date, days: Math.max(0, -daysUntil(first.p.date)) } : null;
    const pk = packs(s, sent);
    const lateSent = sent.filter((x) => x.p.claimedDate && addDays(x.p.claimedDate, e.repayDays) < t);
    return {
      toSend, sent, toSendTotal, sentTotal, total: round2(toSendTotal + sentTotal), oldest, lateSent,
      lateTotal: sum(lateSent, (x) => x.left), packs: pk, chase: pk.filter((p) => p.chase), unpaid: all.filter((x) => x.unpaid),
      count: toSend.length + sent.length, nudge: !!(oldest && oldest.days >= e.nudgeDays), amber: !!(oldest && oldest.days >= 7),
    };
  }
  /* Paid back to you since a date (the start of this tax year if none): the employer's repayments in your
     statements, less any money you sent back to them, plus anything you marked paid back with no bank line. */
  function paidBackSince(s, iso) {
    s = s || store.state;
    iso = iso || taxYearStart(today());
    const work = (s.transactions || []).filter((t) => t.category === WORK_IN && (t.date || '') >= iso);
    const credits = sum(work.filter((t) => t.amount > 0), (t) => t.amount);
    const sentBack = sum(work.filter((t) => t.amount < 0), (t) => -t.amount);
    let manual = 0;
    for (const p of s.paperwork || []) {
      if (!isClaim(p)) continue;
      for (const r of p.repayments || []) if (!r.tx && (r.date || '') >= iso) manual += Number(r.amount) || 0;
      if (stage(p) === 'paid-back' && !p.repaidTx && (p.repaidDate || '') >= iso) manual += Math.max(0, amountOf(p) - repaidSoFar(p));
    }
    return round2(Math.max(0, credits - sentBack + manual));
  }

  /* ---------- words, for matching shops and references ---------- */
  const STOP = new Set(('the and for from with via you your our thanks thank ltd limited plc llp llc inc corp company group holding holdings ' +
    'service services solution solutions international intl payment payments pay paid invoice inv order orders ref reference receipt ' +
    'refund repay repayment reimburse reimbursement expense expenses claim claims back faster transfer transfers bank giro credit debit ' +
    'card visa mastercard contactless online www com net org gbp usd eur gbr fpi fpo bgc tfr std bacs chaps mob ' +
    'jan feb mar apr may jun jul aug sep sept oct nov dec january february march april june july august september october november december').split(/\s+/));
  /* Lowercase words: 'tp-link' becomes 'tplink', plural 's' is trimmed, and numbers on their own, short words
     and company or banking words are dropped. */
  function words(text) {
    const out = [];
    const raw = String(text || '').toLowerCase().replace(/['’]/g, '').replace(/([a-z0-9])-(?=[a-z0-9])/g, '$1');
    for (let w of raw.split(/[^a-z0-9]+/)) {
      if (w.length < 3 || /^\d+$/.test(w) || STOP.has(w)) continue;
      if (w.length > 3 && w.endsWith('s') && !/(ss|us|is)$/.test(w)) w = w.slice(0, -1);
      if (STOP.has(w) || out.includes(w)) continue;
      out.push(w);
    }
    return out;
  }
  const shopWords = (p) => words((p.party || '') + ' ' + (p.title || ''));
  /* Words too general to name a shop by their start alone. */
  const GENERAL = new Set('shop store online mobile direct market trade trading house home food travel express global digital world best super'.split(' '));
  /* Whether a bank word names the shop on a record: a word of its shop or title; one starting with the shop's name,
     as bank lines run names together ('ACMEOFFICELT', 'ADOBESYSTEM', 'JUSTEATCOUK'); or Amazon's own shorthand
     ('AMZNMKTPLACE'). */
  function namesShop(p) {
    const set = new Set(shopWords(p));
    const shop = words(p.party || '').length ? words(p.party || '') : words(p.title || '');
    const joined = shop.slice(0, 2).join('');
    const stems = shop.filter((k) => k.length >= 4 && !GENERAL.has(k));
    return (w) => {
      if (set.has(w)) return true;
      if (/^amzn/.test(w) && (set.has('amazon') || shop.includes('amazon'))) return true;
      if (w.length < 5) return false;
      return stems.some((k) => w.startsWith(k)) || (joined.length >= 5 && shop.length > 1 && w.startsWith(joined));
    };
  }
  const txWords = (t) => words((t.description || '') + ' ' + (t.notes || ''));
  const employerWords = (s) => {
    const e = employer(s);
    return words(e.name + ' ' + e.short + ' ' + e.match.join(' '));
  };
  /* The words in the employer's payment reference, without their own name. */
  function creditWords(s, t) {
    const emp = new Set(employerWords(s));
    return txWords(t).filter((w) => !emp.has(w));
  }

  /* ---------- matching ---------- */
  function usedPurchases(s, except) {
    const set = new Set();
    for (const p of s.paperwork || []) if (p.purchaseTx && p.id !== except) set.add(p.purchaseTx);
    return set;
  }
  function usedCredits(s) {
    const set = new Set();
    for (const p of s.paperwork || []) {
      if (p.repaidTx) set.add(p.repaidTx);
      for (const r of p.repayments || []) if (r.tx) set.add(r.tx);
    }
    return set;
  }
  const metaList = (s, k) => new Set((s.meta && Array.isArray(s.meta[k]) && s.meta[k]) || []);

  /* Your bank payment for something you paid for: a debit of exactly the same amount from 2 days before to
     10 days after its date (or the date you paid it), not a transfer and not already linked. Lines from
     imported statements are preferred over ones added by hand. Sure when exactly one fits, or exactly one
     shares a word with the shop.
     `near` is a payment that names the shop but for a different amount (a receipt in another currency, say).
     When there's one, a lone exact match that doesn't name the shop is only suggested, not linked; and a
     receipt in another currency is never matched on its amount. */
  function purchaseFor(s, p, taken) {
    s = s || store.state;
    const none = { tx: null, sure: false, shared: false, options: [], near: null };
    const d = p && (p.date || p.paidDate);
    if (!p || !d) return none;
    const amt = amountOf(p);
    const end = p.paidDate && p.paidDate > d ? p.paidDate : d;
    const lo = addDays(d, -2);
    const hi = addDays(end, 10);
    const used = usedPurchases(s, p.id);
    const no = new Set(p.notPurchases || []);
    const notWork = metaList(s, 'notWorkTx');
    const pool = (s.transactions || []).filter((t) => t.amount < 0 && t.date >= lo && t.date <= hi && t.category !== TRANSFER && t.category !== WORK_IN &&
      !used.has(t.id) && !no.has(t.id) && !notWork.has(t.id) && !(taken && taken.has(t.id)));
    const mine = new Set(shopWords(p));
    const names = namesShop(p);
    const shares = (t) => mine.size > 0 && txWords(t).some(names);
    const gap = (t) => Math.abs(toDays(t.date) - toDays(d));
    const exact = (t) => Math.abs(-t.amount - amt) < 0.005;
    const home = String((s.settings && s.settings.currency) || 'GBP').toUpperCase();
    const cur = p.originalAmount ? '' : currencyOf(p);
    const foreign = !!cur && cur !== home;
    let cands = amt > 0 && !foreign ? pool.filter(exact) : [];
    const imported = cands.filter(isImported);
    if (imported.length) cands = imported;
    const ranked = cands.map((t) => ({ t, shared: shares(t), gap: gap(t) }))
      .sort((a, b) => (b.shared - a.shared) || (a.gap - b.gap) || byTxDate(a.t, b.t));
    const best = ranked[0] || null;
    let near = null;
    if (!best || !best.shared) {
      // The bank line may quote the receipt's own amount ('USD 9.00'), or name the shop for a similar amount.
      const fx = foreign && amt > 0 ? fxPattern(cur, amt) : null;
      const similar = (t) => !(amt > 0) || (-t.amount / amt >= 0.5 && -t.amount / amt <= 1.5);
      const other = pool.filter((t) => !exact(t)).map((t) => ({ t, fx: !!(fx && fx.test(t.description || '')), shared: shares(t) }))
        .filter((x) => x.fx || (x.shared && similar(x.t)))
        .sort((a, b) => (b.fx - a.fx) || (b.shared - a.shared) || (isImported(b.t) - isImported(a.t)) || (gap(a.t) - gap(b.t)) || byTxDate(a.t, b.t));
      near = other.length ? other[0].t : null;
    }
    const sharedN = ranked.filter((x) => x.shared).length;
    // Linked by itself only with the exact amount AND a word in common with the shop; anything less is asked.
    let sure = !!best && best.shared && sharedN === 1;
    // Paid through PayPal, eBay or the like, the bank line names only the go-between, not any shop: the only debit
    // of the exact amount, within 3 days, with nothing else naming the shop, is it.
    if (!sure && best && ranked.length === 1 && !near && best.gap <= 3 && onlyGoBetween(best.t)) sure = true;
    // A monthly work bill's payment: the only debit of its amount, named the way your statements name the bill
    // (or, for a bill not found in your statements, from its own account within 3 days).
    if (!sure && best && ranked.length === 1 && p.billId) {
      const b = findIn(s, 'bills', p.billId);
      const key = b && b.foundKey ? flat(b.foundKey).trim() : '';
      if (b && (key ? flat(best.t.description).includes(' ' + key + ' ') : !!b.account && best.t.account === b.account && best.gap <= 3)) sure = true;
    }
    return { tx: best ? best.t : null, sure, shared: !!(best && best.shared), options: ranked.map((x) => x.t), near, currency: cur };
  }

  /* Payment services whose bank lines name themselves rather than the shop. */
  const GO_BETWEEN = new Set(['paypal', 'ebay', 'klarna', 'clearpay', 'stripe', 'sumup', 'zettle', 'izettle']);
  /* A bank line naming nothing but a payment service (its references aside): 'PAYPAL PAYMENT', not 'PAYPAL *TRAINLINE'. */
  function onlyGoBetween(t) {
    const w = words(t.description).filter((x) => !/\d/.test(x));
    return w.length > 0 && w.every((x) => GO_BETWEEN.has(x));
  }
  const SYMBOL = { USD: '\\$', EUR: '€', GBP: '£', JPY: '¥', CAD: '\\$', AUD: '\\$' };
  /* Finds a foreign amount quoted in a bank line: 'USD 9.00', 'USD -9.00', '$9.00' or '9.00 USD'. */
  function fxPattern(cur, amt) {
    const a = Number.isInteger(amt) ? amt + '(?:\\.00?)?' : amt.toFixed(2).replace('.', '\\.');
    const c = cur + (SYMBOL[cur] ? '|' + SYMBOL[cur] : '');
    return new RegExp('(?:' + c + ')\\s?[-−]?\\s?' + a + '(?!\\.?\\d)|(?:^|[^\\d.])' + a + '\\s?(?:' + cur + ')\\b', 'i');
  }

  /* What a repayment from the employer was for. Candidates are open claims dated on or before it (not ones
     you've said No to for this payment): one claim of exactly the same amount, or a pack whose sent items
     add up exactly. A word shared between the payment reference and the claim ranks higher, then sent
     ones, then the nearest date. Sure when exactly one claim has the exact amount and a shared word, or
     exactly one pack adds up. opts.pool: records to treat as the open claims; opts.days: only claims this
     many days before the payment; opts.lone: also sure when there's only one candidate at all (for records
     already filed as yours, such as a work purchase with no claim yet). */
  function repaymentFor(s, credit, taken, opts) {
    s = s || store.state;
    opts = opts || {};
    const out = { claims: [], sure: false, shared: false, pack: '', options: [] };
    if (!credit || !(credit.amount > 0) || !credit.date) return out;
    const amt = round2(credit.amount);
    const ref = new Set(creditWords(s, credit));
    const lo = opts.days ? addDays(credit.date, -opts.days) : '';
    const pool = (opts.pool || (s.paperwork || []).filter((p) => isClaim(p) && stage(p) !== 'paid-back'))
      .filter((p) => p && p.date && p.date <= credit.date && p.date >= lo && !(p.notRepayments || []).includes(credit.id) && !(taken && taken.has(p.id)));
    const shares = (p) => ref.size > 0 && shopWords(p).some((w) => ref.has(w));
    const gap = (p) => toDays(credit.date) - toDays(p.date);
    const options = [];
    for (const p of pool) {
      if (Math.abs(left(p) - amt) < 0.005) options.push({ claims: [p], pack: '', shared: shares(p), sent: stage(p) === 'sent', gap: gap(p), amount: amt });
    }
    const groups = new Map();
    for (const p of pool) {
      if (stage(p) !== 'sent') continue;
      const k = packKey(p);
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(p);
    }
    for (const [k, items] of groups) {
      if (items.length < 2 || Math.abs(sum(items, left) - amt) >= 0.005) continue;
      items.sort(byDate);
      options.push({ claims: items, pack: k, shared: items.some(shares), sent: true, gap: Math.min.apply(null, items.map(gap)), amount: amt });
    }
    options.sort((a, b) => (b.shared - a.shared) || (!!b.pack - !!a.pack) || (b.sent - a.sent) || (a.gap - b.gap));
    const packMatches = options.filter((o) => o.pack);
    const sharedSingles = options.filter((o) => !o.pack && o.shared);
    let best = options[0] || null;
    let sure = false;
    if (packMatches.length === 1 && !sharedSingles.length) {
      best = packMatches[0];
      sure = true;
    } else if (sharedSingles.length === 1 && !packMatches.length) {
      best = sharedSingles[0];
      sure = true;
    } else if (opts.lone && options.length === 1) {
      sure = true;
    }
    return { claims: best ? best.claims : [], sure, shared: !!(best && best.shared), pack: best ? best.pack : '', options };
  }

  /* Claims the Home/Work re-sort put back when you undid it: matching leaves them as they are, so the undo stays
     undone. Anything added since is matched as usual. */
  function held(s) {
    const m = s && s.meta && s.meta.refileV1;
    return new Set((m && m.undone && Array.isArray(m.hold) && m.hold) || []);
  }
  /* Sure matches not applied yet: bank payments to link, repayments to tick off, and repayments that are the
     bank line for something you marked paid back by hand. */
  function planMatches(s) {
    const links = [];
    const repaid = [];
    const attach = [];
    const hold = held(s);
    const takenTx = usedPurchases(s);
    for (const p of (s.paperwork || []).filter((x) => isClaim(x) && !x.purchaseTx && !hold.has(x.id)).sort(byDate)) {
      const r = purchaseFor(s, p, takenTx);
      if (!r.sure) continue;
      links.push({ id: p.id, tx: r.tx.id });
      takenTx.add(r.tx.id);
    }
    const usedC = usedCredits(s);
    const takenClaims = new Set(hold);
    const credits = (s.transactions || []).filter((t) => t.amount > 0 && t.category === WORK_IN && !usedC.has(t.id)).sort(byTxDate);
    // Marked paid back with just a date: a repayment of exactly what was left, within 30 days of that date, is it.
    const manual = (s.paperwork || []).filter((p) => isClaim(p) && !hold.has(p.id) && stage(p) === 'paid-back' && !p.repaidTx && p.repaidDate && !(p.repayments || []).some((r) => r && r.tx));
    const usedM = new Set();
    for (const c of credits) {
      const fits = manual.filter((p) => !usedM.has(p.id) && Math.abs(amountOf(p) - repaidSoFar(p) - c.amount) < 0.005 &&
        Math.abs(toDays(c.date) - toDays(p.repaidDate)) <= 30 && !(p.notRepayments || []).includes(c.id));
      // Not when it could as well be for something still waiting: then it's matched or asked about as usual.
      if (fits.length !== 1 || repaymentFor(s, c, takenClaims).options.length) continue;
      attach.push({ id: fits[0].id, tx: c.id });
      usedM.add(fits[0].id);
      usedC.add(c.id);
    }
    for (const c of credits) {
      if (usedC.has(c.id)) continue;
      const r = repaymentFor(s, c, takenClaims);
      if (!r.sure) continue;
      repaid.push({ tx: c.id, ids: r.claims.map((p) => p.id) });
      r.claims.forEach((p) => takenClaims.add(p.id));
    }
    return { links, repaid, attach };
  }

  /* The 'From your bank' lists and the matches waiting for a Yes or No. Worked out again only when
     something changes (or the day changes). */
  let promptCache = null;
  function prompts(s) {
    s = s || store.state;
    const key = (store.rev || 0) + '|' + today();
    if (promptCache && promptCache.key === key && promptCache.s === s) return promptCache.out;
    const out = buildPrompts(s);
    promptCache = { key, s, out };
    return out;
  }
  function buildPrompts(s) {
    const t = today();
    const notWork = metaList(s, 'notWorkTx');
    const okCredits = metaList(s, 'okCredits');
    const usedP = usedPurchases(s);
    const usedC = usedCredits(s);
    const tx = s.transactions || [];
    // Repayments by amount, to tell which work payments have already come back.
    const creditDates = new Map();
    for (const c of tx) if (c.amount > 0 && c.category === WORK_IN) {
      const k = round2(c.amount).toFixed(2);
      if (!creditDates.has(k)) creditDates.set(k, []);
      creditDates.get(k).push(c.date);
    }
    const repaidAlready = (d) => (creditDates.get(round2(-d.amount).toFixed(2)) || []).some((cd) => cd >= d.date && cd <= addDays(d.date, 90));
    const workOutBefore = new Map();
    for (const d of tx) if (d.amount < 0 && d.category === WORK_OUT) {
      const k = round2(-d.amount).toFixed(2);
      if (!workOutBefore.has(k)) workOutBefore.set(k, []);
      workOutBefore.get(k).push(d.date);
    }
    // Money you sent back to the employer explains a repayment of the same amount before it (an overpayment, say).
    const sentBackAfter = new Map();
    for (const d of tx) if (d.amount < 0 && d.category === WORK_IN) {
      const k = round2(-d.amount).toFixed(2);
      if (!sentBackAfter.has(k)) sentBackAfter.set(k, []);
      sentBackAfter.get(k).push(d.date);
    }
    const explained = (c) => (workOutBefore.get(round2(c.amount).toFixed(2)) || []).some((dd) => dd <= c.date && dd >= addDays(c.date, -90)) ||
      (sentBackAfter.get(round2(c.amount).toFixed(2)) || []).some((dd) => dd >= c.date && dd <= addDays(c.date, 90));

    // 1. Repayments that might be for a claim, and ones with no claim at all.
    const repayments = [];
    const noClaimCredits = [];
    let sureRepayments = 0;
    const takenClaims = new Set();
    for (const c of tx.filter((x) => x.amount > 0 && x.category === WORK_IN && !usedC.has(x.id)).sort(byTxDate)) {
      const r = repaymentFor(s, c, takenClaims);
      if (r.sure) {
        sureRepayments++;
        r.claims.forEach((p) => takenClaims.add(p.id));
      } else if (r.options.length) repayments.push({ tx: c, claims: r.claims, options: r.options, shared: r.shared, pack: r.pack });
      else if (!okCredits.has(c.id) && !explained(c)) noClaimCredits.push({ tx: c });
    }

    // 2. Claims whose bank payment I think I've found but am not sure about.
    const purchases = [];
    let surePurchases = 0;
    const takenTx = new Set(usedP);
    const suggested = new Set();
    for (const x of claims(s, 'open')) {
      if (x.p.purchaseTx) continue;
      const r = purchaseFor(s, x.p, takenTx);
      if (r.sure) {
        surePurchases++;
        takenTx.add(r.tx.id);
        continue;
      }
      if (!r.tx && !r.near) continue;
      r.options.forEach((o) => suggested.add(o.id));
      if (r.near) suggested.add(r.near.id);
      purchases.push({ p: x.p, tx: r.tx, options: r.options, near: r.near, amountDiffers: !!r.near && !r.shared });
    }

    // 3. Money out that may be for work but isn't claimed: lines marked 'Work expenses' with no claim, and
    //    lines from shops you mostly buy from for work.
    const shops = workShops(s);
    const unclaimedSpend = [];
    const since90 = addDays(t, -90);
    const since60 = addDays(t, -60);
    for (const d of tx) {
      if (!(d.amount < 0) || usedP.has(d.id) || takenTx.has(d.id) || suggested.has(d.id) || notWork.has(d.id) || d.category === TRANSFER || d.category === WORK_IN) continue;
      if (d.category === WORK_OUT) {
        if (d.date >= since90 && !repaidAlready(d)) unclaimedSpend.push({ tx: d, why: 'work', shop: '' });
        continue;
      }
      if (d.date < since60 || !shops.length) continue;
      const w = new Set(txWords(d));
      const shop = shops.find((sh) => sh.words.every((k) => w.has(k)));
      if (shop && !repaidAlready(d)) unclaimedSpend.push({ tx: d, why: 'shop', shop: shop.name });
    }
    unclaimedSpend.sort((a, b) => byTxDate(b.tx, a.tx));

    // 4. Claims added by monthly work bills you pay, for reassurance.
    const fromBills = claims(s).filter((x) => x.p.billId && (x.p.date || '') >= since60)
      .map((x) => ({ p: x.p, bill: (s.bills || []).find((b) => b.id === x.p.billId) || null }));

    return { repayments, purchases, unclaimedSpend, noClaimCredits, fromBills, sure: { repayments: sureRepayments, purchases: surePurchases }, count: repayments.length };
  }
  /* Claims a repayment already in your bank looks like it's for, waiting for your Yes: the money has come in,
     so it isn't still to come. {ids, rows (as claims()), total}. */
  function awaiting(s) {
    s = s || store.state;
    const ids = new Set();
    for (const r of prompts(s).repayments) for (const p of r.claims || []) ids.add(p.id);
    const rows = ids.size ? claims(s, 'open').filter((x) => ids.has(x.p.id)) : [];
    return { ids, rows, total: sum(rows, (x) => x.left) };
  }
  /* Shops you've claimed from where most of what you spend there in the last year is for work. */
  function workShops(s) {
    const seen = new Map();
    for (const p of s.paperwork || []) {
      if (!isClaim(p) || !p.party) continue;
      const w = words(p.party).slice(0, 2);
      if (!w.length) continue;
      const k = w.join(' ');
      if (!seen.has(k)) seen.set(k, { name: clean(p.party), words: w });
    }
    if (!seen.size) return [];
    const yearAgo = addDays(today(), -365);
    const linked = usedPurchases(s);
    const recent = (s.transactions || []).filter((t) => t.amount < 0 && t.date >= yearAgo && t.category !== TRANSFER).map((t) => ({ t, w: new Set(txWords(t)) }));
    return Array.from(seen.values()).filter((sh) => {
      const at = recent.filter((x) => sh.words.every((k) => x.w.has(k)));
      if (!at.length) return true;
      const work = at.filter((x) => linked.has(x.t.id) || x.t.category === WORK_OUT).length;
      return work * 2 >= at.length;
    });
  }

  /* ---------- changes, each with Undo ---------- */
  const same = (a, b) => a === b || (typeof a === 'object' && typeof b === 'object' && JSON.stringify(a) === JSON.stringify(b));
  const copy = (v) => (v && typeof v === 'object' ? JSON.parse(JSON.stringify(v)) : v);
  /* Records every field it changes, so the whole change can be undone. */
  function tracker(log) {
    return {
      set(c, rec, k, v) {
        const had = Object.prototype.hasOwnProperty.call(rec, k);
        if (had ? same(rec[k], v) : v === undefined) return false;
        log.push({ c, id: rec.id, k, had, was: copy(rec[k]) });
        if (v === undefined) delete rec[k];
        else rec[k] = v;
        return true;
      },
      add(st, c, rec) {
        (st[c] = st[c] || []).push(rec);
        log.push({ c, id: rec.id, add: true });
      },
      /* Takes a record out into Recently deleted. */
      remove(st, c, rec, label) {
        const list = st[c] || [];
        const at = list.findIndex((x) => x.id === rec.id);
        if (at < 0) return false;
        list.splice(at, 1);
        const bin = GU.trash ? GU.trash.put(st, c, rec, label).id : null;
        log.push({ c, id: rec.id, del: true, rec: copy(rec), at, bin });
        return true;
      },
      log,
    };
  }
  function undoer(log) {
    return (st) => {
      for (let i = log.length - 1; i >= 0; i--) {
        const e = log[i];
        if (e.add) {
          st[e.c] = (st[e.c] || []).filter((x) => x.id !== e.id);
          continue;
        }
        if (e.del) {
          if (e.bin) st.trash = (st.trash || []).filter((x) => x.id !== e.bin);
          const list = (st[e.c] = st[e.c] || []);
          if (!list.some((x) => x.id === e.id)) list.splice(Math.min(e.at, list.length), 0, copy(e.rec));
          continue;
        }
        const rec = findIn(st, e.c, e.id);
        if (!rec) continue;
        if (e.had) rec[e.k] = copy(e.was);
        else delete rec[e.k];
      }
    };
  }
  /* Runs one commit and offers Undo. msg is text, or a function of what fn returned ('' for no toast).
     opts.afterUndo(st): anything more Undo puts back, in the same commit. */
  function change(fn, msg, opts) {
    const log = [];
    let out;
    store.commit((st) => {
      out = fn(st, tracker(log));
    });
    const undo = () => store.commit((st) => {
      undoer(log)(st);
      if (opts && opts.afterUndo) opts.afterUndo(st);
    });
    const res = { changed: log.length, out, undo };
    if (!log.length) return res;
    const text = typeof msg === 'function' ? msg(out) : msg;
    if (text && !(opts && opts.quiet)) toast(text, { action: 'Undo', onAction: undo });
    return res;
  }
  const P = 'paperwork';
  const T = 'transactions';
  function mirrorT(tr, p) {
    const m = mirrorValues(p);
    for (const k of ['claim', 'claimed']) if (m[k] || k in p) tr.set(P, p, k, m[k]);
  }
  /* Moves a claim to a stage, with the legacy flags to match (so an old tick can't hold it back). */
  function setStage(tr, p, st) {
    tr.set(P, p, 'claimStatus', st);
    tr.set(P, p, 'claim', true);
    tr.set(P, p, 'claimed', st !== 'to-send');
  }
  function accountName(s, id) {
    const a = (s.accounts || []).find((x) => x.id === id);
    return clean((a && (a.name || a.bank)) || '') || 'your account';
  }
  /* Links a claim to your bank payment: the line becomes 'Work expenses', its old category kept for Undo.
     was: the category to keep instead, for a line you've only just marked 'Work expenses' yourself. */
  const wasOf = (tx, was) => (was != null && tx.category === WORK_OUT && !(F.WORK || [WORK_OUT, WORK_IN]).includes(was) ? was : tx.category || '');
  function linkT(st, tr, p, tx, was) {
    tr.set(P, p, 'purchaseTx', tx.id);
    tr.set(P, p, 'purchaseWas', wasOf(tx, was));
    tr.set(T, tx, 'category', WORK_OUT);
    if ((p.notPurchases || []).includes(tx.id)) tr.set(P, p, 'notPurchases', p.notPurchases.filter((x) => x !== tx.id));
  }
  function unlinkT(st, tr, p) {
    const tx = findIn(st, T, p.purchaseTx);
    if (tx && tx.category === WORK_OUT) tr.set(T, tx, 'category', p.purchaseWas || '');
    tr.set(P, p, 'purchaseTx', undefined);
    tr.set(P, p, 'purchaseWas', undefined);
    return tx;
  }
  function repayT(tr, p, date, txId) {
    setStage(tr, p, 'paid-back');
    tr.set(P, p, 'repaidDate', date);
    tr.set(P, p, 'repaidTx', txId || undefined);
    if (txId && (p.notRepayments || []).includes(txId)) tr.set(P, p, 'notRepayments', p.notRepayments.filter((x) => x !== txId));
    mirrorT(tr, p);
  }
  const claimsIn = (st, ids) => idList(ids).map((id) => findIn(st, P, id)).filter(Boolean);
  const forWhat = (list) => (list.length === 1 ? list[0].title || list[0].party || '1 item' : plural(list.length, 'item'));

  /* A pack reference for a send date, e.g. 'ABC-2026-10-07', with -2, -3… when that day already has a pack. */
  function newPackId(s, date, ids) {
    const e = employer(s);
    const base = ((e.short || 'Claim').toUpperCase().replace(/[^A-Z0-9]+/g, '') || 'CLAIM') + '-' + (date || today());
    const mine = new Set(idList(ids));
    const taken = new Set((s.paperwork || []).filter((p) => p.packId && !mine.has(p.id)).map((p) => p.packId));
    let id = base;
    for (let i = 2; taken.has(id); i++) id = base + '-' + i;
    return id;
  }

  /* Marks claims as sent to the employer today, all in one pack. */
  function markSent(ids, opts) {
    opts = opts || {};
    const e = employer();
    const d = opts.date || today();
    let packId = opts.packId || '';
    return change((st, tr) => {
      packId = packId || newPackId(st, d, ids);
      let n = 0;
      for (const p of claimsIn(st, ids)) {
        if (!isClaim(p) || stage(p) !== 'to-send') continue;
        setStage(tr, p, 'sent');
        tr.set(P, p, 'claimedDate', d);
        tr.set(P, p, 'packId', packId);
        n++;
      }
      return { n, packId };
    }, (o) => (o.n === 1 ? 'Marked as sent to ' + e.label : o.n ? 'Marked ' + o.n + ' as sent to ' + e.label : ''));
  }
  /* Takes claims back out of their pack: 'Not sent yet' again. */
  function unsend(ids) {
    return change((st, tr) => {
      let n = 0;
      for (const p of claimsIn(st, ids)) {
        if (!isClaim(p) || stage(p) !== 'sent') continue;
        setStage(tr, p, 'to-send');
        tr.set(P, p, 'claimedDate', undefined);
        tr.set(P, p, 'packId', undefined);
        n++;
      }
      return n;
    }, (n) => (n === 1 ? 'Moved back to Not sent yet' : n ? plural(n, 'item') + ' moved back to Not sent yet' : ''));
  }
  /* Marks claims as paid back, from a repayment in your bank (txId) or just a date and amount. If the amount
     is less than what's owed, the oldest are ticked off first and the rest stays waiting; opts.close ticks
     everything off anyway. Any claim not yet linked to your bank payment is linked when that's sure. */
  function markPaidBack(ids, opts) {
    opts = opts || {};
    const e = employer();
    return change((st, tr) => {
      const tx = findIn(st, T, opts.txId);
      const date = opts.date || (tx && tx.date) || today();
      const list = claimsIn(st, ids).filter((p) => isClaim(p) && stage(p) !== 'paid-back').sort(byDate);
      if (!list.length) return null;
      const due = sum(list, left);
      let budget = opts.amount != null && opts.amount !== '' ? Math.abs(Number(opts.amount) || 0) : tx ? Math.abs(tx.amount) : null;
      const total = budget;
      const full = [];
      let part = null;
      if (budget == null || budget >= due - 0.005 || opts.close) {
        list.forEach((p) => full.push(p));
      } else {
        for (const p of list) {
          const l = left(p);
          if (budget >= l - 0.005) {
            full.push(p);
            budget = round2(budget - l);
          } else if (budget > 0.005) {
            part = { p, amount: round2(budget) };
            budget = 0;
          }
        }
      }
      for (const p of full) repayT(tr, p, date, tx ? tx.id : undefined);
      if (part) {
        tr.set(P, part.p, 'repayments', (part.p.repayments || []).concat({ date, amount: part.amount, tx: tx ? tx.id : undefined }));
        if (stage(part.p) === 'to-send') {
          setStage(tr, part.p, 'sent');
          tr.set(P, part.p, 'claimedDate', part.p.claimedDate || date);
        }
      }
      if (tx && tx.category !== WORK_IN) tr.set(T, tx, 'category', WORK_IN);
      const takenTx = usedPurchases(st);
      for (const p of full) {
        if (p.purchaseTx) continue;
        const r = purchaseFor(st, p, takenTx);
        if (!r.sure) continue;
        linkT(st, tr, p, r.tx);
        takenTx.add(r.tx.id);
      }
      const still = round2(due - (total == null ? due : total));
      return { full, part, total: total == null ? due : total, still: opts.close ? 0 : Math.max(0, still) };
    }, (o) => {
      if (!o) return '';
      const got = money(o.total);
      if (o.still > 0) return 'Got ' + got + ' from ' + e.label + '. ' + money(o.still) + ' still to come.';
      return e.Label + ' paid you back ' + got + ' for ' + forWhat(o.full) + '.';
    });
  }
  /* 'Not paid back yet': back to waiting. The repayment isn't suggested for these again. */
  function unrepay(ids) {
    return change((st, tr) => {
      let n = 0;
      for (const p of claimsIn(st, ids)) {
        if (!isClaim(p) || (stage(p) !== 'paid-back' && !(p.repayments || []).length)) continue;
        const txs = [p.repaidTx].concat((p.repayments || []).map((r) => r.tx)).filter(Boolean);
        if (txs.length) tr.set(P, p, 'notRepayments', Array.from(new Set((p.notRepayments || []).concat(txs))));
        setStage(tr, p, p.claimedDate || p.packId ? 'sent' : 'to-send');
        tr.set(P, p, 'repaidDate', undefined);
        tr.set(P, p, 'repaidTx', undefined);
        tr.set(P, p, 'repayments', undefined);
        n++;
      }
      return n;
    }, (n) => (n ? 'Marked as not paid back yet' : ''));
  }
  function currencyOf(p) {
    if (p.currency) return String(p.currency).toUpperCase();
    const text = (p.notes || '') + ' ' + (p.title || '') + ' ' + (p.originalAmount || '');
    if (/\$|\busd\b|\bdollars?\b/i.test(text)) return 'USD';
    if (/€|\beur\b|\beuros?\b/i.test(text)) return 'EUR';
    return '';
  }
  /* Links a claim to the bank payment you picked. useBankAmount: the claim takes the amount your bank took,
     and keeps the receipt's own amount as originalAmount (e.g. '9.00 USD'). was: as for claimFromTx. */
  function linkPurchase(id, txId, opts) {
    opts = opts || {};
    const s = store.state;
    const other = (s.paperwork || []).find((x) => x.purchaseTx === txId && x.id !== id);
    if (other) {
      toast('That payment is already linked to ' + (other.title || other.party || 'another item') + '.');
      return { changed: 0 };
    }
    return change((st, tr) => {
      const p = findIn(st, P, id);
      const tx = findIn(st, T, txId);
      if (!p || !tx) return null;
      if (p.purchaseTx && p.purchaseTx !== tx.id) unlinkT(st, tr, p);
      if (p.purchaseTx !== tx.id) linkT(st, tr, p, tx, opts.was);
      const bank = round2(Math.abs(tx.amount));
      if (opts.useBankAmount && Math.abs(amountOf(p) - bank) >= 0.005) {
        if (!p.originalAmount && amountOf(p) > 0) tr.set(P, p, 'originalAmount', (amountOf(p).toFixed(2) + ' ' + currencyOf(p)).trim());
        tr.set(P, p, 'amount', bank);
      }
      return { tx, s: st };
    }, (o) => (o ? 'Linked to your ' + accountName(o.s, o.tx.account) + ' payment on ' + short(o.tx.date) : ''), { afterUndo: wasBack([txId], opts.was) });
  }
  /* Unlinks a claim's bank payment: the line goes back to its old category and isn't suggested again. */
  function unlinkPurchase(id) {
    return change((st, tr) => {
      const p = findIn(st, P, id);
      if (!p || !p.purchaseTx) return 0;
      const txId = p.purchaseTx;
      unlinkT(st, tr, p);
      tr.set(P, p, 'notPurchases', Array.from(new Set((p.notPurchases || []).concat(txId))));
      if (p.originalAmount) {
        const n = parseFloat(String(p.originalAmount).replace(/[^0-9.]/g, ''));
        if (n > 0) tr.set(P, p, 'amount', n);
        tr.set(P, p, 'originalAmount', undefined);
      }
      mirrorT(tr, p);
      return 1;
    }, (n) => (n ? 'Unlinked the bank payment' : ''));
  }
  const titleCase = (t) => t.replace(/\b[a-z]/g, (c) => c.toUpperCase());
  /* A tidy shop name from a bank line, without card numbers or references. */
  function shopFromTx(t) {
    const k = GU.recurring && GU.recurring.keyOf ? GU.recurring.keyOf(t.description || '') : words(t.description).slice(0, 3).join(' ');
    return clean(titleCase(k || '')) || 'Bank payment';
  }
  function blankClaim(over) {
    return Object.assign({ id: 'p-' + uid(), created: today(), kind: 'receipt', status: '', paidDate: '', context: 'work', payer: 'me', claimStatus: 'to-send',
      title: '', party: '', amount: 0, date: today(), dueDate: '', warrantyUntil: '', reference: '', category: WORK_OUT, notes: '', files: [] }, over);
  }
  /* Bank payments you made for work become claims, each linked to its line (now 'Work expenses').
     A line that fits an open claim with no bank payment yet is linked to it instead (opts.noLink to skip).
     opts.was: the line's category before you marked it 'Work expenses', put back if it's ever unlinked. */
  function claimFromTx(txIds, opts) {
    opts = opts || {};
    return change((st, tr) => {
      const created = [];
      const linked = [];
      const used = usedPurchases(st);
      for (const tx of idList(txIds).map((id) => findIn(st, T, id)).filter(Boolean)) {
        if (!(tx.amount < 0) || used.has(tx.id)) continue;
        if (!opts.noLink) {
          const fits = (st.paperwork || []).filter((p) => isClaim(p) && !p.purchaseTx && stage(p) !== 'paid-back' && purchaseFor(st, p).options.some((o) => o.id === tx.id));
          if (fits.length === 1) {
            linkT(st, tr, fits[0], tx, opts.was);
            used.add(tx.id);
            linked.push(fits[0].id);
            continue;
          }
        }
        const name = shopFromTx(tx);
        const rec = blankClaim({ title: name, party: name, amount: round2(-tx.amount), date: tx.date, purchaseTx: tx.id, purchaseWas: wasOf(tx, opts.was) });
        mirror(rec);
        tr.add(st, P, rec);
        tr.set(T, tx, 'category', WORK_OUT);
        used.add(tx.id);
        created.push(rec.id);
      }
      return { created, linked };
    }, (o) => {
      const n = o.created.length + o.linked.length;
      return n ? (n === 1 ? 'Added to Get paid back' : plural(n, 'payment') + ' added to Get paid back') + (o.created.length ? '. Add the receipt when you have it.' : '.') : '';
    }, { afterUndo: wasBack(idList(txIds), opts.was) });
  }
  /* For Undo after a line you'd just marked 'Work expenses' was added to Get paid back: the line goes back to the
     category it had before, unless something still links to it. */
  function wasBack(txIds, was) {
    if (was == null || (F.WORK || [WORK_OUT, WORK_IN]).includes(was)) return null;
    return (st) => {
      const used = usedPurchases(st);
      for (const id of txIds) {
        const tx = findIn(st, T, id);
        if (tx && tx.category === WORK_OUT && !used.has(id)) tx.category = was;
      }
    };
  }
  /* Who pays: 'company' (the business), 'me' (you, get it back) or null (not sorted). */
  function setPayer(c, id, payer) {
    c = c || P;
    payer = payer === 'me' || payer === 'company' ? payer : null;
    const e = employer();
    return change((st, tr) => {
      const rec = findIn(st, c, id);
      if (!rec) return null;
      let linkedTx = null;
      if (c === P) {
        tr.set(P, rec, 'context', 'work');
        tr.set(P, rec, 'payer', payer || undefined);
        // An invoice you sent the business for your own spending is a claim you've sent: paid back once they paid it.
        // When it's the same money as something already in Get paid back, its files go on that instead.
        if (payer === 'me' && rec.kind === 'invoice-out') {
          const twin = outTwin(st, rec);
          if (twin) {
            mergeOutT(st, tr, rec, twin);
            return { merged: twin, s: st };
          }
          outToClaimT(st, tr, rec);
        }
        if (payer === 'me' && rec.kind !== 'invoice-out') {
          if (!rec.claimStatus) setStage(tr, rec, stage(rec));
          if (!rec.purchaseTx) {
            const r = purchaseFor(st, rec);
            if (r.sure) {
              linkT(st, tr, rec, r.tx);
              linkedTx = r.tx;
            }
          }
        } else {
          if (rec.purchaseTx) unlinkT(st, tr, rec);
          for (const k of ['claimStatus', 'claimedDate', 'packId', 'repaidDate', 'repaidTx', 'repayments']) tr.set(P, rec, k, undefined);
        }
        mirrorT(tr, rec);
      } else {
        // Saying who pays makes it a work record.
        if (payer && !isWorkRecord(rec, c)) tr.set(c, rec, 'context', 'work');
        tr.set(c, rec, 'payer', payer || undefined);
      }
      return { linkedTx, s: st };
    }, (o) => {
      if (!o) return '';
      if (o.merged) return 'Same money as ' + (o.merged.title || o.merged.party || 'a claim') + ' in Get paid back: its files are on that now';
      if (c !== P) return payer === 'company' ? e.Label + ' pays it' : payer === 'me' ? 'You pay, ' + e.label + ' pays you back' : 'Set to not sorted yet';
      const where = payer === 'me' ? 'Moved to Get paid back' : payer === 'company' ? 'Moved to ' + e.Label + ' pays' : 'Moved to Who paid?';
      return where + (o.linkedTx ? '. Linked to your ' + accountName(o.s, o.linkedTx.account) + ' payment on ' + short(o.linkedTx.date) : '');
    });
  }
  /* For a work invoice you sent the business: the claim already in Get paid back for the same money (the same
     amount, within a month, a word in common), as the re-sort's 'same money' question finds it. */
  function outTwin(st, rec) {
    st = st || store.state;
    const amt = amountOf(rec);
    const mine = new Set(shopWords(rec || {}));
    if (!rec || !amt || !rec.date || !mine.size) return null;
    const gap = (p) => Math.abs(toDays(p.date) - toDays(rec.date));
    return claims(st).map((x) => x.p).filter((p) => p.id !== rec.id && p.date && Math.abs(amountOf(p) - amt) < 0.005 && gap(p) <= 31 && shopWords(p).some((w) => mine.has(w)))
      .sort((a, b) => gap(a) - gap(b))[0] || null;
  }
  /* The invoice's files go on the claim (marked sent, if it wasn't), and the invoice into Recently deleted. */
  function mergeOutT(st, tr, rec, twin) {
    const ids = new Set((twin.files || []).map((f) => f && f.id));
    const extra = (rec.files || []).filter((f) => f && !ids.has(f.id));
    if (extra.length) tr.set(P, twin, 'files', (twin.files || []).concat(copy(extra)));
    if (stage(twin) === 'to-send') {
      setStage(tr, twin, 'sent');
      tr.set(P, twin, 'claimedDate', rec.date || today());
      tr.set(P, twin, 'packId', newPackId(st, rec.date || today(), [twin.id]));
    }
    tr.remove(st, P, rec, (rec.title || 'Invoice') + ' (merged into Get paid back)');
  }
  /* A work invoice you sent the business becomes a claim you've sent (paid back when it's marked paid), the way
     the Inbox and the re-sort file one. Call inside a change. */
  function outToClaimT(st, tr, rec) {
    const paid = rec.status === 'paid';
    const d = rec.date || today();
    tr.set(P, rec, 'kind', 'receipt');
    tr.set(P, rec, 'status', '');
    tr.set(P, rec, 'dueDate', '');
    tr.set(P, rec, 'payer', 'me');
    tr.set(P, rec, 'category', WORK_OUT);
    setStage(tr, rec, paid ? 'paid-back' : 'sent');
    if (!rec.claimedDate) tr.set(P, rec, 'claimedDate', d);
    if (!rec.packId) tr.set(P, rec, 'packId', newPackId(st, rec.claimedDate || d, [rec.id]));
    if (paid && !rec.repaidDate) tr.set(P, rec, 'repaidDate', rec.paidDate || d);
    mirrorT(tr, rec);
  }
  /* 'Not for work': moves a record to Home. Any linked bank payment goes back to its old category, and so does
     the record's own 'Work expenses' category. */
  function moveToHome(c, id) {
    c = c || P;
    return change((st, tr) => {
      const rec = findIn(st, c, id);
      if (!rec) return 0;
      const was = rec.purchaseWas;
      tr.set(c, rec, 'context', 'home');
      tr.set(c, rec, 'payer', undefined);
      if (rec.category === WORK_OUT) {
        if (c === 'bills') tr.set(c, rec, 'category', 'Bills & utilities');
        else if (c === P) tr.set(c, rec, 'category', was && !(F.WORK || [WORK_OUT, WORK_IN]).includes(was) ? was : '');
      }
      if (c === P) {
        if (rec.purchaseTx) unlinkT(st, tr, rec);
        for (const k of ['claimStatus', 'claimedDate', 'packId', 'repaidDate', 'repaidTx', 'repayments', 'handedDate', 'billId']) tr.set(P, rec, k, undefined);
        tr.set(P, rec, 'notWork', true);
        mirrorT(tr, rec);
      }
      return 1;
    }, (n) => (n ? 'Moved to Home' : ''));
  }
  /* The business has paid this invoice itself. */
  function markKtkPaid(id, opts) {
    opts = opts || {};
    const e = employer();
    return change((st, tr) => {
      let n = 0;
      for (const p of claimsInAny(st, id)) {
        if (lane(p, P) === 'back') continue;
        tr.set(P, p, 'context', 'work');
        if (!p.payer) tr.set(P, p, 'payer', 'company');
        if (p.kind === 'invoice-in' || p.kind === 'invoice-out') {
          tr.set(P, p, 'status', 'paid');
          tr.set(P, p, 'paidDate', opts.date || p.paidDate || today());
        }
        mirrorT(tr, p);
        n++;
      }
      return n;
    }, (n) => (n === 1 ? 'Marked as paid by ' + e.label : n ? 'Marked ' + n + ' as paid by ' + e.label : ''));
  }
  /* You've passed these on to the business to pay. */
  function handOver(ids, opts) {
    opts = opts || {};
    const e = employer();
    return change((st, tr) => {
      let n = 0;
      for (const p of claimsInAny(st, ids)) {
        if (lane(p, P) === 'back') continue;
        tr.set(P, p, 'handedDate', opts.date || today());
        n++;
      }
      return n;
    }, (n) => (n === 1 ? 'Marked as sent to ' + e.label : n ? 'Marked ' + n + ' as sent to ' + e.label : ''));
  }
  const claimsInAny = (st, ids) => idList(ids).map((id) => findIn(st, P, id)).filter(Boolean);
  /* 'No' to a suggested repayment: it isn't suggested for these claims again. */
  function notRepayment(ids, txId) {
    return change((st, tr) => {
      let n = 0;
      for (const p of claimsInAny(st, ids)) if (tr.set(P, p, 'notRepayments', Array.from(new Set((p.notRepayments || []).concat(txId))))) n++;
      return n;
    }, (n) => (n ? 'OK, I won’t suggest that payment for it again' : ''));
  }
  /* 'No' to a suggested bank payment for a claim. */
  function notPurchase(id, txId) {
    return change((st, tr) => {
      const p = findIn(st, P, id);
      if (!p) return 0;
      return tr.set(P, p, 'notPurchases', Array.from(new Set((p.notPurchases || []).concat(txId)))) ? 1 : 0;
    }, (n) => (n ? 'OK, I won’t suggest that payment again' : ''));
  }
  function addToMeta(st, tr, k, ids) {
    st.meta = st.meta || {};
    const cur = Array.isArray(st.meta[k]) ? st.meta[k] : [];
    const next = Array.from(new Set(cur.concat(ids)));
    if (next.length === cur.length) return false;
    log0(tr, st.meta, k, next);
    return true;
  }
  // meta isn't a collection, so its change is logged against a pseudo-record and undone by hand.
  function log0(tr, meta, k, v) {
    tr.log.push({ meta: true, k, had: Object.prototype.hasOwnProperty.call(meta, k), was: copy(meta[k]) });
    meta[k] = v;
  }
  /* 'Not work': the bank lines go back to their usual category and aren't suggested again. */
  function notWork(txIds) {
    const ids = idList(txIds);
    return metaChange((st, tr) => {
      let n = 0;
      for (const tx of ids.map((id) => findIn(st, T, id)).filter(Boolean)) {
        if (tx.category === WORK_OUT && !usedPurchases(st).has(tx.id)) {
          let cat = F.categorise ? F.categorise(tx.description, tx.amount, st.rules) : '';
          if (cat === WORK_OUT || cat === WORK_IN) cat = '';
          tr.set(T, tx, 'category', cat);
        }
        n++;
      }
      addToMeta(st, tr, 'notWorkTx', ids);
      return n;
    }, (n) => (n === 1 ? 'Marked as not for work' : n ? 'Marked ' + n + ' as not for work' : ''));
  }
  /* 'That's fine': a repayment with no claim stops being listed. */
  function creditOk(txIds) {
    return metaChange((st, tr) => (addToMeta(st, tr, 'okCredits', idList(txIds)) ? idList(txIds).length : 0), (n) => (n ? 'OK, I’ll leave it' : ''));
  }
  /* 'It's my wages': a payment from the employer counts as your pay. */
  function markWages(txId) {
    return change((st, tr) => {
      const tx = findIn(st, T, txId);
      return tx && tr.set(T, tx, 'category', 'Salary') ? 1 : 0;
    }, (n) => (n ? 'Moved to your income as wages' : ''));
  }
  function metaChange(fn, msg) {
    const log = [];
    let out;
    store.commit((st) => {
      out = fn(st, tracker(log));
    });
    const undo = () => store.commit((st) => {
      const rest = log.filter((e) => !e.meta);
      undoer(rest)(st);
      for (let i = log.length - 1; i >= 0; i--) {
        const e = log[i];
        if (!e.meta) continue;
        st.meta = st.meta || {};
        if (e.had) st.meta[e.k] = copy(e.was);
        else delete st.meta[e.k];
      }
    });
    const text = log.length ? (typeof msg === 'function' ? msg(out) : msg) : '';
    if (text) toast(text, { action: 'Undo', onAction: undo });
    return { changed: log.length, out, undo };
  }

  /* ---------- matching everything at once ---------- */
  /* Links sure bank payments and ticks off sure repayments, in one commit with Undo. Runs after every
     statement import and on start. quiet: only say something when a repayment was matched. */
  function reconcile(opts) {
    opts = opts || {};
    const s = store.state;
    if (!s || !s.paperwork) return { linked: 0, repaid: 0, changed: 0 };
    const plan = planMatches(s);
    if (!plan.links.length && !plan.repaid.length && !plan.attach.length) return { linked: 0, repaid: 0, changed: 0 };
    const e = employer(s);
    const res = change((st, tr) => {
      let linked = 0;
      const repaid = [];
      for (const l of plan.links) {
        const p = findIn(st, P, l.id);
        const tx = findIn(st, T, l.tx);
        if (!p || !tx || p.purchaseTx) continue;
        linkT(st, tr, p, tx);
        linked++;
      }
      // The bank line for something you'd already marked paid back: linked, so it's counted once.
      for (const a of plan.attach) {
        const p = findIn(st, P, a.id);
        if (p && !p.repaidTx && findIn(st, T, a.tx)) tr.set(P, p, 'repaidTx', a.tx);
      }
      for (const r of plan.repaid) {
        const tx = findIn(st, T, r.tx);
        if (!tx) continue;
        const list = r.ids.map((id) => findIn(st, P, id)).filter((p) => p && stage(p) !== 'paid-back');
        for (const p of list) repayT(tr, p, tx.date, tx.id);
        if (list.length) repaid.push({ tx, list });
      }
      return { linked, repaid };
    }, (o) => {
      const parts = [];
      if (o.repaid.length === 1) parts.push(e.Label + ' paid you back ' + money(o.repaid[0].tx.amount) + ' for ' + forWhat(o.repaid[0].list) + '.');
      else if (o.repaid.length) parts.push(e.Label + ' paid you back ' + money(sum(o.repaid, (r) => r.tx.amount)) + ' for ' + plural(sum(o.repaid, (r) => r.list.length), 'item') + '.');
      if (o.linked && !(opts.quiet && !o.repaid.length)) parts.push('Linked ' + plural(o.linked, 'bank payment') + ' to Get paid back.');
      return opts.quiet && !o.repaid.length ? '' : parts.join(' ');
    });
    return { linked: res.out ? res.out.linked : 0, repaid: res.out ? res.out.repaid.reduce((a, r) => a + r.list.length, 0) : 0, changed: res.changed, undo: res.undo };
  }

  /* ---------- monthly work bills you pay ---------- */
  const billWords = (b) => (b ? words([b.name, b.payee, b.foundKey].filter(Boolean).join(' ')) : []);
  /* Inside a commit: every payment of a work bill you pay yourself, on or after employer.since (today when
     none is set), gets its claim 'p-bill-<billId>-<date>' unless there's one already: that id, one for the same
     bill and amount within 3 days, or something you filed yourself for it (the same amount within 3 days, with a
     word in common with the bill), which is then marked as the bill's. Each payment remembers its claim
     (claimId), so one you delete stays deleted. Returns the new claims. */
  function billClaims(st) {
    const e = employer(st);
    const since = e.since || today();
    const created = [];
    const binned = new Set((st.trash || []).filter((x) => x && x.c === P && x.record).map((x) => x.record.id));
    st.paperwork = st.paperwork || [];
    for (const b of st.bills || []) {
      if (!isWorkRecord(b, 'bills') || payerOf(b, 'bills') !== 'me') continue;
      const bw = new Set(billWords(b));
      for (const h of b.history || []) {
        if (!h || !h.date || h.date < since || h.claimId) continue;
        const amt = round2(Math.abs(Number(h.amount != null && h.amount !== '' ? h.amount : b.amount) || 0));
        if (!amt) continue;
        const id = 'p-bill-' + b.id + '-' + h.date;
        const near = (p) => !!p.date && Math.abs(amountOf(p) - amt) < 0.005 && Math.abs(toDays(p.date) - toDays(h.date)) <= 3;
        const have = st.paperwork.find((p) => p.id === id) || st.paperwork.find((p) => p.billId === b.id && near(p)) ||
          st.paperwork.find((p) => !p.billId && isClaim(p) && near(p) && shopWords(p).some((w) => bw.has(w)));
        if (have) {
          if (!have.billId) {
            have.billId = b.id;
            // Its invoice, filed before the payment left: paid now, so it's owed to you.
            if (have.kind === 'invoice-in' && have.status !== 'paid') {
              have.status = 'paid';
              have.paidDate = h.date;
            }
          }
          h.claimId = have.id;
          continue;
        }
        if (binned.has(id)) {
          h.claimId = id;
          continue;
        }
        const rec = blankClaim({ id, title: (b.name || 'Bill') + ' (' + monthLabel(h.date.slice(0, 7)) + ')', party: b.payee || b.name || '', amount: amt, date: h.date, billId: b.id });
        mirror(rec);
        st.paperwork.push(rec);
        h.claimId = id;
        created.push(rec);
      }
    }
    return created;
  }
  /* The claim a monthly work bill already made for the payment a record you're filing is for: the same
     amount, within a week, and a word in common. File the record's files onto it rather than claiming twice. */
  function billTwin(st, rec) {
    st = st || store.state;
    if (!st || !rec || rec.billId || !isClaim(rec)) return null;
    const amt = amountOf(rec);
    const d = rec.paidDate || rec.date;
    const mine = new Set(shopWords(rec));
    if (!amt || !d || !mine.size) return null;
    return (st.paperwork || []).find((p) => p && p.id !== rec.id && p.billId && isClaim(p) && p.date && Math.abs(amountOf(p) - amt) < 0.005 &&
      Math.abs(toDays(p.date) - toDays(d)) <= 7 && shopWords(p).concat(billWords(findIn(st, 'bills', p.billId))).some((w) => mine.has(w))) || null;
  }

  /* ---------- every paperwork save goes through this ---------- */
  /* Fills in defaults and dates, clears fields that don't apply to its lane and stage, and writes the legacy
     flags. Pass `prev` (the record before an edit) so a stage changed in a form is taken as meant. A record
     leaving Get paid back gives its bank payment back its old category. */
  function normalise(rec, prev) {
    if (!rec) return rec;
    if (!rec.context) rec.context = 'home';
    if ((rec.kind === 'invoice-in' || rec.kind === 'invoice-out') && rec.status === 'paid' && !rec.paidDate) rec.paidDate = today();
    if (rec.context !== 'work') {
      for (const k of ['payer', 'claimStatus', 'claimedDate', 'packId', 'repaidDate', 'repaidTx', 'repayments', 'handedDate']) delete rec[k];
    } else if (rec.payer !== 'me' && rec.payer !== 'company') {
      const who = payerOf(rec, P);
      if (who && rec.kind !== 'invoice-out') rec.payer = who;
      else delete rec.payer;
    }
    const shown = rec._stageShown;
    delete rec._stageShown;
    if (isClaim(rec)) {
      let st = stage(rec);
      // Changed in a form: different from the stage the form showed (or, with no form, from both what was stored
      // and what it read as). Otherwise an old tick wins.
      if (prev && STAGES.includes(rec.claimStatus) && (STAGES.includes(shown) ? rec.claimStatus !== shown : rec.claimStatus !== prev.claimStatus && rec.claimStatus !== stage(prev))) st = rec.claimStatus;
      // No longer paid back: the repayment it was ticked off with isn't matched to it again (as 'Not paid back yet').
      if (prev && st !== 'paid-back' && isClaim(prev) && stage(prev) === 'paid-back') {
        const txs = [prev.repaidTx].concat((prev.repayments || []).map((r) => r && r.tx)).filter(Boolean);
        if (txs.length) rec.notRepayments = Array.from(new Set((rec.notRepayments || []).concat(txs)));
        for (const k of ['repaidDate', 'repaidTx', 'repayments']) delete rec[k];
      }
      rec.claimStatus = st;
      if (st === 'to-send') for (const k of ['claimedDate', 'packId', 'repaidDate', 'repaidTx', 'repayments']) delete rec[k];
      if (st === 'sent') {
        if (!rec.claimedDate) rec.claimedDate = today();
        delete rec.repaidDate;
        delete rec.repaidTx;
      }
      if (st === 'paid-back' && !rec.repaidDate) rec.repaidDate = today();
      rec.claimed = st !== 'to-send'; // set before mirror so the stage above isn't read back from an old tick
    } else {
      for (const k of ['claimStatus', 'packId', 'repaidDate', 'repaidTx', 'repayments']) delete rec[k];
      if (rec.claimedDate && !(rec.context === 'work' && rec.kind === 'invoice-out')) delete rec.claimedDate;
      // Moved to Home or to the business's money: your bank payment counts as your own spending again.
      if (rec.purchaseTx && (rec.context !== 'work' || rec.payer === 'company')) {
        const tx = store.state && findIn(store.state, T, rec.purchaseTx);
        if (tx && tx.category === WORK_OUT && rec.purchaseWas !== WORK_OUT) tx.category = rec.purchaseWas || '';
        delete rec.purchaseTx;
        delete rec.purchaseWas;
      }
    }
    return mirror(rec);
  }

  /* ---------- sending to the employer: the claim pack and the message ---------- */
  function packRecords(ids, flow) {
    const s = store.state;
    return claimsInAny(s, ids).filter((p) => (flow === 'ktk' ? lane(p, P) !== 'back' : isClaim(p))).sort(byDate);
  }
  const firstName = (s) => clean(String((s.settings && s.settings.name) || '').trim().split(/\s+/)[0] || '');
  function rangeText(recs) {
    const d = recs.map((p) => p.date).filter(Boolean).sort();
    if (!d.length) return '';
    return d[0] === d[d.length - 1] ? short(d[0]) : short(d[0]) + ' to ' + short(d[d.length - 1]);
  }
  /* A reminder (everything in it sent already) asks for what's still owed on each, after any part repayments. */
  const isReminder = (recs, flow) => flow !== 'ktk' && recs.length > 0 && recs.every((p) => stage(p) === 'sent');
  const owedOf = (p, reminder) => (reminder ? left(p) : amountOf(p));
  const lineAmount = (p, reminder) => (noAmount(p) ? 'no amount' : money(owedOf(p, reminder)) + (reminder && repaidSoFar(p) > 0 ? ' (' + money(repaidSoFar(p)) + ' paid so far)' : ''));
  function numberedLines(recs, flow) {
    const reminder = isReminder(recs, flow);
    return recs.map((p, i) => (i + 1) + '. ' + [p.date ? short(p.date) : '', shopName(p), clean(p.title), lineAmount(p, reminder) + (flow === 'ktk' && p.dueDate ? ' by ' + short(p.dueDate) : '')]
      .filter(Boolean).join(' · '));
  }
  /* The message to send with the pack (opts.lines adds the numbered list and total, for Copy message). */
  function message(ids, flow, opts) {
    opts = opts || {};
    flow = flow === 'ktk' ? 'ktk' : 'back';
    const s = store.state;
    const e = employer(s);
    const recs = packRecords(ids, flow);
    if (!recs.length) return '';
    const hi = 'Hi' + (e.contact ? ' ' + clean(e.contact) : '') + ',';
    const total = sum(recs, amountOf);
    let text;
    if (flow === 'ktk') {
      const files = recs.filter((p) => (p.files || []).length).length;
      if (recs.length === 1) {
        const p = recs[0];
        text = hi + ' this needs paying: ' + (shopName(p) || clean(p.title)) + ' ' + lineAmount(p) + (p.dueDate ? ' by ' + short(p.dueDate) : '') + '.' + (files ? ' The invoice is attached.' : '') + ' Thanks!';
        return text;
      }
      return hi + ' these need paying, ' + money(total) + ' in total:\n' + numberedLines(recs, 'ktk').join('\n') + (files ? '\nThe invoices are in the zip.' : '') + '\nThanks!';
    }
    const who = e.fullName || e.name || 'work';
    const missing = recs.filter((p) => !(p.files || []).length).length;
    const receipts = missing === recs.length ? 'The details are in the zip.' : missing ? 'Receipts are in the zip; ' + missing + ' to follow.' : 'Receipts are in the zip.';
    const sentAlready = recs.every((p) => stage(p) === 'sent');
    if (sentAlready) {
      const d = recs.map((p) => p.claimedDate).filter(Boolean).sort()[0];
      text = hi + ' just a reminder about the ' + (recs.length === 1 ? 'thing' : recs.length + ' things') + ' I paid for ' + who + (d ? ', sent on ' + short(d) : '') + ': ' + money(sum(recs, left)) + ' still to pay back. ' + receipts + ' Thanks!';
    } else {
      const range = rangeText(recs);
      text = hi + ' here ' + (recs.length === 1 ? 'is 1 thing' : 'are ' + recs.length + ' things') + ' I paid for ' + who + (range ? ' (' + range + ')' : '') + ', ' + money(total) + (recs.length === 1 ? '' : ' in total') + '. ' + receipts + ' Thanks!';
    }
    if (opts.lines) text += '\n\n' + numberedLines(recs, 'back').join('\n') + '\nTotal: ' + money(sum(recs, (p) => owedOf(p, sentAlready)));
    return text;
  }
  const fileSafe = (t) => clean(t).replace(/…/g, ' ').replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim().slice(0, 40).trim();
  const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'image/heic': 'heic', 'application/pdf': 'pdf', 'text/plain': 'txt', 'text/csv': 'csv' };
  function extOf(name, type) {
    const m = String(name || '').match(/\.([a-z0-9]{1,5})$/i);
    return (m ? m[1] : EXT[type] || 'bin').toLowerCase();
  }
  const pad2 = (n) => String(n).padStart(2, '0');
  const BOM = String.fromCharCode(0xfeff); // so spreadsheet apps read the CSV as UTF-8 (the £ sign, accents)
  function csvCell(v) {
    let t = String(v == null ? '' : v);
    if (/^[=+\-@]/.test(t)) t = "'" + t;
    return /[",\n\r]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t;
  }
  /* The printable summary: a self-contained page that saves as a PDF invoice. On a phone each line stacks. */
  function summaryHTML(o) {
    const head = o.cols.map((c) => '<th' + (c.cls ? ' class="' + c.cls + '"' : '') + '>' + esc(c.label) + '</th>').join('');
    const body = o.rows.map((r) => '<tr>' + o.cols.map((c) => '<td data-label="' + esc(c.label) + '"' + (c.cls ? ' class="' + c.cls + '"' : '') + '>' + (r[c.key] || '–') + '</td>').join('') + '</tr>').join('');
    const meta = o.meta.map(([k, v]) => '<dt>' + esc(k) + '</dt><dd>' + esc(v) + '</dd>').join('');
    return '<!doctype html>\n<html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">' +
      '<title>' + esc(o.title) + '</title><style>' +
      ':root{--ink:#1d2622;--muted:#5f6b66;--line:#dce2df;--soft:#f1f5f3}' +
      '*{box-sizing:border-box}html{background:#eef1ef}body{margin:0;color:var(--ink);font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}' +
      '.sheet{max-width:900px;margin:24px auto;background:#fff;padding:40px 44px;border:1px solid var(--line);border-radius:10px}' +
      'header{display:flex;justify-content:space-between;align-items:flex-start;gap:24px;flex-wrap:wrap;border-bottom:2px solid var(--ink);padding-bottom:18px;margin-bottom:22px}' +
      'h1{font-size:22px;line-height:1.25;margin:0 0 6px;letter-spacing:-.01em;max-width:32ch}.lede{margin:0;color:var(--muted)}' +
      'dl{display:grid;grid-template-columns:auto auto;gap:3px 16px;margin:0;font-size:13px}dt{color:var(--muted)}dd{margin:0;font-weight:600;text-align:right}' +
      'table{width:100%;border-collapse:collapse;font-size:13px}' +
      'th{text-align:left;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);border-bottom:1px solid var(--ink);padding:8px 10px 8px 0}' +
      'td{border-bottom:1px solid var(--line);padding:9px 10px 9px 0;vertical-align:top;overflow-wrap:break-word}.wrap{overflow-wrap:anywhere}' +
      '.num{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums;padding-right:0}.nowrap{white-space:nowrap}.n{color:var(--muted);width:2em}' +
      'td small{display:block;color:var(--muted);font-size:12px;white-space:normal}.file{color:var(--muted);font-size:12px}' +
      'tfoot td{border-bottom:0;border-top:2px solid var(--ink);font-weight:700;font-size:15px;padding-top:12px}' +
      '.note{margin:24px 0 0;padding:12px 14px;background:var(--soft);border-radius:8px}' +
      '.end{display:flex;justify-content:space-between;align-items:center;gap:16px;flex-wrap:wrap;margin:28px 0 0}.foot{margin:0;color:var(--muted);font-size:11px}' +
      '.print{border:0;border-radius:999px;background:var(--ink);color:#fff;font:600 14px/1 inherit;padding:12px 18px;cursor:pointer}' +
      '@page{size:A4;margin:16mm}@media print{html{background:#fff}.sheet{margin:0;border:0;padding:0;max-width:none}.print{display:none}tr{break-inside:avoid}}' +
      '@media screen and (max-width:640px){.sheet{margin:0;padding:24px 16px;border:0;border-radius:0}h1{font-size:19px}' +
      'thead{display:none}table,tbody,tr,td,tfoot{display:block;width:100%}tr{padding:10px 0;border-bottom:1px solid var(--line)}' +
      'td{border:0;padding:1px 0;text-align:left}td.num{text-align:left}td.n{display:none}' +
      'td::before{content:attr(data-label) ": ";color:var(--muted);font-size:12px}' +
      'tfoot tr{display:flex;justify-content:space-between;border-bottom:0;border-top:2px solid var(--ink);margin-top:-1px}tfoot td{border:0;width:auto;padding-top:12px}tfoot td::before{content:none}}' +
      '</style></head><body><main class="sheet"><header><div><h1>' + esc(o.title) + '</h1><p class="lede">' + esc(o.lede) + '</p></div><dl>' + meta + '</dl></header>' +
      '<table><thead><tr>' + head + '</tr></thead><tbody>' + body + '</tbody>' +
      '<tfoot><tr><td colspan="' + (o.cols.length - 1) + '">Total</td><td class="num">' + esc(o.total) + '</td></tr></tfoot></table>' +
      (o.note ? '<p class="note">' + esc(o.note) + '</p>' : '') +
      '<div class="end"><p class="foot">' + esc(o.foot) + '</p><button class="print" type="button" onclick="window.print()">Print or save as PDF</button></div></main></body></html>';
  }
  /* A shop name short enough for a file name: the trading name in brackets if there is one, without 'Ltd'. */
  function shopName(p) {
    let t = clean(p.party || p.title || '');
    const br = t.match(/\(([^()]{2,})\)\s*$/);
    if (br) t = br[1];
    for (let i = 0; i < 3; i++) t = t.replace(LEGAL, '').replace(/[\s,]+$/, '');
    return t;
  }
  /* Builds the claim pack: '00 Claim summary.html' (prints as an invoice), '00 Claim summary.csv' and every
     receipt renamed to match ('01 2026-09-17 Shop 4.79.pdf'). Only shop names, item titles and account
     nicknames go in it, never bank descriptions or account, card or sort-code numbers.
     flow 'ktk' builds the invoices for the business to pay instead.
     opts: share (try the share sheet first), save (false: just build it), markSent (mark them sent, or handed
     over for 'ktk', once it's shared or saved), text (the message to share with), date.
     Returns {blob, name, packId, files, missing, shared, saved, cancelled}. */
  async function pack(ids, flow, opts) {
    opts = opts || {};
    flow = flow === 'ktk' ? 'ktk' : 'back';
    const s = store.state;
    const e = employer(s);
    const recs = packRecords(ids, flow);
    if (!recs.length) {
      toast('Nothing to send.');
      return null;
    }
    const d = opts.date || today();
    const reminder = isReminder(recs, flow);
    const packs0 = Array.from(new Set(recs.map((p) => p.packId).filter(Boolean)));
    const packId = flow === 'back' ? (packs0.length === 1 && recs.every((p) => p.packId === packs0[0]) ? packs0[0] : newPackId(s, d, ids)) : '';
    const entries = [];
    let missing = 0;
    const rows = [];
    const csv = [];
    for (let i = 0; i < recs.length; i++) {
      const p = recs[i];
      const no = pad2(i + 1);
      const names = [];
      const fl = (p.files || []).filter((f) => f && f.id);
      for (let k = 0; k < fl.length; k++) {
        let r = null;
        try {
          r = await GU.files.get(fl[k].id);
        } catch (err) {
          r = null;
        }
        if (!r || !r.blob) {
          missing++;
          continue;
        }
        const nm = [no, p.date || '', fileSafe(shopName(p)) || 'Item', amountOf(p).toFixed(2)].filter(Boolean).join(' ') + (k ? ' part ' + (k + 1) : '') + '.' + extOf(r.name || fl[k].name, r.type || fl[k].type);
        entries.push({ name: nm, blob: r.blob });
        names.push(nm);
      }
      const tx = p.purchaseTx ? findIn(s, T, p.purchaseTx) : null;
      const from = tx ? accountName(s, tx.account) : '';
      const proof = names.length ? names.join(', ') : tx ? 'bank payment on ' + short(tx.date) + ', receipt to follow' : flow === 'ktk' ? 'no file' : 'receipt to follow';
      const amt = noAmount(p) ? '' : owedOf(p, reminder).toFixed(2);
      const orig = p.originalAmount ? clean(p.originalAmount) : '';
      const part = reminder && repaidSoFar(p) > 0 ? money(repaidSoFar(p)) + ' of ' + money(amountOf(p)) + ' paid so far' : '';
      rows.push({
        n: String(i + 1), date: esc(p.date ? fmtDate(p.date) : ''), party: esc(clean(p.party)), what: esc(clean(p.title)),
        amount: esc(noAmount(p) ? '–' : money(owedOf(p, reminder))) + (part ? '<small>' + esc(part) + '</small>' : '') + (orig ? '<small>receipt says ' + esc(orig) + '</small>' : ''),
        from: esc(from), proof: '<span class="file">' + esc(proof) + '</span>', due: esc(p.dueDate ? fmtDate(p.dueDate) : ''),
      });
      csv.push(flow === 'ktk'
        ? [i + 1, p.date || '', clean(p.party), clean(p.title), amt, p.dueDate || '', names.join('; ') || 'no file']
        : [i + 1, p.date || '', clean(p.party), clean(p.title), amt, from, proof]);
    }
    const total = sum(recs, (p) => owedOf(p, reminder));
    const who = e.name || 'Work';
    const me = firstName(s);
    const cols = flow === 'ktk'
      ? [{ key: 'n', label: 'No.', cls: 'n' }, { key: 'date', label: 'Date', cls: 'nowrap' }, { key: 'party', label: 'Supplier' }, { key: 'what', label: 'What it’s for', cls: 'wrap' }, { key: 'due', label: 'Due by', cls: 'nowrap' }, { key: 'proof', label: 'File' }, { key: 'amount', label: 'Amount', cls: 'num' }]
      : [{ key: 'n', label: 'No.', cls: 'n' }, { key: 'date', label: 'Date', cls: 'nowrap' }, { key: 'party', label: 'Supplier' }, { key: 'what', label: 'What it was', cls: 'wrap' }, { key: 'from', label: 'Paid from', cls: 'nowrap' }, { key: 'proof', label: 'Receipt' }, { key: 'amount', label: 'Amount', cls: 'num' }];
    const html = summaryHTML({
      title: (flow === 'ktk' ? 'Invoices to pay: ' : 'Expenses to pay back: ') + who,
      lede: flow === 'ktk' ? plural(recs.length, 'invoice') + ' for ' + (e.fullName || who) + ' to pay.' : plural(recs.length, 'thing') + ' I paid for with my own money' + (rangeText(recs) ? ', ' + rangeText(recs) : '') + '.',
      meta: [].concat(me ? [['From', me]] : [], [['Date', fmtDate(d)]], packId ? [['Reference', packId]] : [], [['Items', String(recs.length)]]),
      cols, rows, total: money(total),
      note: flow === 'ktk' ? 'Please pay these directly. Thank you.' : 'Please pay this back to my usual account. Thank you.',
      foot: 'Made with The Ground Up' + (packId ? ' · ' + packId : '') + '.',
    });
    const csvHead = flow === 'ktk' ? ['No.', 'Date', 'Supplier', 'What it’s for', 'Amount', 'Due by', 'File'] : ['No.', 'Date', 'Supplier', 'What it was', 'Amount', 'Paid from', 'Receipt'];
    const csvText = BOM + [csvHead].concat(csv, [['', '', '', 'Total', total.toFixed(2), '', '']]).map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
    const base = flow === 'ktk' ? '00 Invoices to pay' : '00 Claim summary';
    const receipts = entries.slice();
    entries.unshift({ name: base + '.html', blob: new Blob([html], { type: 'text/html' }) }, { name: base + '.csv', blob: new Blob([csvText], { type: 'text/csv' }) });
    let zip;
    let name;
    if (flow === 'ktk' && recs.length === 1 && receipts.length === 1) {
      // One invoice for the business to pay: send the file itself.
      zip = receipts[0].blob;
      name = receipts[0].name.replace(/^01 /, '');
    } else {
      zip = await GU.ui.makeZip(entries);
      name = (e.short || 'Work') + (flow === 'ktk' ? ' invoices to pay ' : ' expenses ') + fmtDate(d) + '.zip';
    }
    const text = opts.text || message(ids, flow);
    const out = { blob: zip, name, packId, files: entries.map((x) => x.name), missing, shared: false, saved: false, cancelled: false, text };
    if (missing) toast(plural(missing, 'receipt') + (missing === 1 ? ' isn’t' : ' aren’t') + ' on this device yet, so ' + (missing === 1 ? 'it’s' : 'they’re') + ' left out.');
    if (opts.save === false) return out;
    if (opts.share) {
      const r = await shareFile(zip, name, text);
      if (r === 'cancel') return Object.assign(out, { cancelled: true });
      out.shared = !!r;
    }
    if (!out.shared) out.saved = !!(await GU.ui.saveFile(zip, name));
    if ((out.shared || out.saved) && opts.markSent) {
      if (flow === 'ktk') handOver(recs.map((p) => p.id));
      else markSent(recs.map((p) => p.id), { how: out.shared ? 'share' : 'download', packId });
    }
    return out;
  }
  /* The share sheet with a file, where the browser allows it. true, false (not possible) or 'cancel'. */
  async function shareFile(blob, name, text) {
    try {
      if (!navigator.share || !navigator.canShare || typeof File !== 'function') return false;
      const file = new File([blob], name, { type: blob.type || 'application/octet-stream' });
      if (!navigator.canShare({ files: [file] })) return false;
      await navigator.share({ files: [file], title: name.replace(/\.zip$/i, ''), text });
      return true;
    } catch (err) {
      return err && err.name === 'AbortError' ? 'cancel' : false;
    }
  }
  /* Shares the pack (or downloads it when sharing isn't possible). */
  const share = (ids, flow, opts) => pack(ids, flow, Object.assign({}, opts, { share: true }));
  async function copyText(text) {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch (err) {
      /* fall through to the old way */
    }
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch (err) {
      return false;
    }
  }
  /* Copies the message plus the numbered list. opts.text: the message as edited; opts.markSent as in pack. */
  async function copyMessage(ids, flow, opts) {
    opts = opts || {};
    flow = flow === 'ktk' ? 'ktk' : 'back';
    const recs = packRecords(ids, flow);
    if (!recs.length) return false;
    let text = opts.text || message(ids, flow);
    if (flow === 'back' && !/\n1\. /.test(text)) text += '\n\n' + numberedLines(recs, 'back').join('\n') + '\nTotal: ' + money(sum(recs, (p) => owedOf(p, isReminder(recs, flow))));
    const ok = await copyText(text);
    if (!ok) {
      toast('I couldn’t copy it here. Select the message and copy it yourself.');
      return false;
    }
    if (opts.markSent) {
      if (flow === 'ktk') handOver(recs.map((p) => p.id));
      else markSent(recs.map((p) => p.id), { how: 'copy' });
    } else toast('Message copied');
    return true;
  }

  /* ---------- the Get paid back badge ---------- */
  /* 1 when anything unsent is older than nudgeDays, plus 1 per pack waiting longer than chaseDays,
     plus 1 per bank match waiting for a Yes or No. */
  function badge(s) {
    s = s || store.state;
    const d = dueBack(s);
    return (d.nudge ? 1 : 0) + d.chase.length + prompts(s).count;
  }

  GU.workMoney = {
    WORK_IN, WORK_OUT, STAGES, WAGE,
    employer, isEmployerText, employerCategory, wageSource,
    payerOf, lane, stage, isClaim, left,
    claims, packs, dueBack, paidBackSince, taxYearStart, words, awaiting,
    purchaseFor, repaymentFor, prompts, reconcile, billClaims, billTwin, outTwin, badge,
    markSent, unsend, markPaidBack, unrepay, linkPurchase, unlinkPurchase, claimFromTx,
    setPayer, moveToHome, markKtkPaid, handOver, notRepayment, notPurchase, notWork, creditOk, markWages,
    mirror, normalise, newPackId,
    pack, share, message, copyMessage, clean,
  };
})();
