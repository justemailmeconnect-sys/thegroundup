/* The Ground Up: the one-off Home/Work re-sort (GU.refile).
   When the site is first split into Home and Work, this sorts what's already there:
   - it finds the business you work for in your own data (an income source whose name also appears in your
     bank lines and in one of your 'Salary' rules) and sets it up in Settings;
   - it splits money from them into wages and repayments, links the work things you paid for to your bank
     payments, and moves home orders they've clearly paid you back for into Work;
   - anything it can't be sure about becomes a one-tap question, with a suggestion where the evidence
     points one way.
   Every field it changes is logged in meta.refileV1, so undo() puts things back exactly (offered for 30 days).
   Nothing is deleted unless you answer a question that says so. Nothing here names a business, shop,
   person or amount: it all comes from your records. */
(function () {
  'use strict';
  const GU = window.GU;
  const { esc, today, addDays, addMonths, toDays, round2, sum, money, fmtDate, plural, daysInMonth } = GU.util;
  const store = GU.store;
  const F = GU.finance;
  const wm = () => GU.workMoney;

  const KEY = 'refileV1';
  const WORK_OUT = F.WORK_OUT || 'Work expenses';
  const WORK_IN = F.WORK_IN || 'Work reimbursements';
  const WORK = F.WORK || [WORK_OUT, WORK_IN];
  const TRANSFER = F.TRANSFER || 'Transfers';
  const P = 'paperwork';
  const T = 'transactions';
  const UNDO_DAYS = 30;
  const WINDOW = 90; // the longest gap between a purchase and the repayment for it
  const WAGE = /\bwages?\b|salary|payroll/i;
  /* Words for things a business buys for its office. Used only to ask, never to move anything by itself. */
  const SUPPLIES = new Set(('toner cartridge printer label stationery envelope stapler staple laminator shredder ream copier ' +
    'postage franking barcode whiteboard clipboard highlighter').split(' '));
  /* Words that say nothing about who someone is, so they can't identify an employer. */
  const GENERIC = new Set(('salary wage wages pay payroll income job work employer main monthly weekly pension bonus ' +
    'the and ltd limited plc llp company group services uk').split(' '));
  /* Bank wording around a payment reference. */
  const BANK_WORDS = new Set(('faster payments payment receipt ref reference from to bank giro credit debit transfer on via made ' +
    'bgc fpi fpo tfr std bacs chaps mob card').split(' '));

  /* ---------- small helpers ---------- */
  const amountOf = (r) => Math.abs(Number(r && r.amount) || 0);
  const same = (a, b) => Math.abs(a - b) < 0.005;
  const copy = (v) => (v && typeof v === 'object' ? JSON.parse(JSON.stringify(v)) : v);
  const sameValue = (a, b) => a === b || (typeof a === 'object' && typeof b === 'object' && JSON.stringify(a) === JSON.stringify(b));
  const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  const isImported = (t) => t.source === 'import' || !!t.importBatch;
  const short = (iso) => fmtDate(iso, { short: true });
  const byDate = (a, b) => (a.date || '').localeCompare(b.date || '') || String(a.id).localeCompare(String(b.id));
  const gapDays = (from, to) => toDays(to) - toDays(from);
  const findIn = (st, c, id) => (id ? (st[c] || []).find((x) => x.id === id) || null : null);
  const metaOf = (s) => (s && s.meta && s.meta[KEY] && typeof s.meta[KEY] === 'object' ? s.meta[KEY] : null);
  const words = (t) => wm().words(t);
  const shares = (a, b) => {
    const set = new Set(a);
    return b.some((w) => set.has(w));
  };
  function median(list) {
    const a = list.slice().sort((x, y) => x - y);
    const m = a.length >> 1;
    return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
  }
  const ordinal = (n) => n + (n % 10 === 1 && n % 100 !== 11 ? 'st' : n % 10 === 2 && n % 100 !== 12 ? 'nd' : n % 10 === 3 && n % 100 !== 13 ? 'rd' : 'th');
  const toast = (msg, o) => (GU.ui && GU.ui.toast ? GU.ui.toast(msg, o) : null);
  const clean = (t) => (wm() && wm().clean ? wm().clean(t) : String(t || '').trim());
  /* A short name for a record: its title without '(sold by …)', cut at a word near 42 characters. */
  function nameOf(r) {
    let t = clean(r.title || r.name || r.party || r.description || '').replace(/\s*\(sold by[^)]*\)?\s*$/i, '');
    if (t.length > 42) t = t.slice(0, 42).replace(/[\s,;:–-]+\S*$/, '') + '…';
    return t || 'Item';
  }
  /* The shop on a record, without 'Ltd' and the like. */
  function shopOf(r) {
    const t = clean(r.party || r.title || '').replace(/[\s,]+(limited|ltd\.?|plc|llp|llc|inc\.?)\.?$/i, '').trim();
    return t.length > 30 ? nameOf({ title: t }) : t;
  }
  const accountName = (s, id) => {
    const a = (s.accounts || []).find((x) => x.id === id);
    return clean((a && (a.name || a.bank)) || '') || 'your account';
  };

  /* Bank lines already linked to a record, and repayments already used. */
  function usedPurchases(s) {
    const set = new Set();
    for (const p of s.paperwork || []) if (p.purchaseTx) set.add(p.purchaseTx);
    return set;
  }
  function usedCredits(s) {
    const set = new Set();
    for (const p of s.paperwork || []) {
      if (p.repaidTx) set.add(p.repaidTx);
      for (const r of p.repayments || []) if (r && r.tx) set.add(r.tx);
    }
    return set;
  }
  /* The words in a payment reference that aren't the employer's own name. */
  function employerWordSet(s) {
    const e = wm().employer(s);
    return new Set(words([e.name, e.short].concat(e.match).join(' ')));
  }
  const refWords = (s, t, emp) => words((t.description || '') + ' ' + (t.notes || '')).filter((w) => !(emp || employerWordSet(s)).has(w));
  /* The reference on a bank line as written: the part after 'REF' (up to 'FROM'), or the parts between dots
     that don't name the employer, without bank wording or long numbers. drop: words to leave out too (and
     then single letters, such as an initial). */
  function refText(s, t, drop) {
    const emp = employerWordSet(s);
    const desc = String(t.description || '');
    const m = desc.match(/\bref(?:erence)?[.:\s]+(.+?)(?:\s+from\b.*)?$/i);
    const parts = m ? [m[1]] : desc.split(/\s+·\s+/).filter((x, i, all) => all.length < 2 || !words(x).some((w) => emp.has(w)));
    const out = (parts.join(' ') || desc).replace(/\b\d{1,2}[-/]\d{1,2}[-/]\d{2,4}\b/g, ' ').split(/[\s.·,|*]+/).filter((w) => {
      const k = w.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (!k || /^\d{4,}$/.test(k) || (/^\d+$/.test(k) && k.length > 2)) return false;
      if (BANK_WORDS.has(k) || /^(ltd|limited|plc|llp|on)$/.test(k)) return false;
      if (emp.has(k) || (drop && (drop.has(k) || k.length < 2))) return false;
      return true;
    });
    return clean(out.join(' ')).slice(0, 40).trim();
  }
  const quoteRef = (text) => (text ? '‘' + text + '’' : 'with no reference');
  /* Home records that might really be for work: orders, receipts and invoices you paid, not ones you sent. */
  const homeOrders = (s) => (s.paperwork || []).filter((p) => p && p.context !== 'work' && p.kind !== 'invoice-out' && !p.notWork && !p.claim && amountOf(p) > 0 && p.date);
  /* Debits that are the bank payment of a record already (same amount, from 2 days before to 10 days after it). */
  function recordDebits(s) {
    const byAmount = new Map();
    for (const t of s.transactions || []) {
      if (!(t.amount < 0)) continue;
      const k = round2(-t.amount).toFixed(2);
      if (!byAmount.has(k)) byAmount.set(k, []);
      byAmount.get(k).push(t);
    }
    const out = new Set();
    for (const p of s.paperwork || []) {
      if (!p || !p.date || !(amountOf(p) > 0)) continue;
      const lo = addDays(p.date, -2);
      const hi = addDays(p.paidDate && p.paidDate > p.date ? p.paidDate : p.date, 10);
      for (const t of byAmount.get(round2(amountOf(p)).toFixed(2)) || []) if (t.date >= lo && t.date <= hi) out.add(t.id);
    }
    return out;
  }

  /* ---------- the change log ---------- */
  /* Records the old value of every field it changes, so undo() can put it back exactly. Entries:
     {c, id, k, was} (no `was`: the field wasn't there before), {c, id, add} for a record made here, and
     {c, id, del, rec, at, bin} for one taken out (bin: its Recently deleted entry). c 'settings' and 'meta'
     are the settings and meta, with no id. `b` marks the answer it came from. */
  function logger(st, log, batch) {
    const push = (e) => {
      if (batch) e.b = batch;
      log.push(e);
    };
    function change(c, id, holder, k, v) {
      const had = has(holder, k);
      if (had ? sameValue(holder[k], v) : v === undefined) return false;
      const e = { c, id, k };
      if (had) e.was = copy(holder[k]);
      push(e);
      if (v === undefined) delete holder[k];
      else holder[k] = v;
      return true;
    }
    return {
      log,
      set: (c, rec, k, v) => change(c, rec.id, rec, k, v),
      setting: (k, v) => change('settings', null, st.settings, k, v),
      meta: (k, v) => change('meta', null, st.meta, k, v),
      add(c, rec) {
        (st[c] = st[c] || []).push(rec);
        push({ c, id: rec.id, add: true });
      },
      /* Takes a record out; with bin, it goes to Recently deleted (kept 30 days). */
      remove(c, rec, opts) {
        const list = st[c] || [];
        const at = list.findIndex((x) => x.id === rec.id);
        if (at < 0) return false;
        const e = { c, id: rec.id, del: true, rec: copy(rec), at };
        list.splice(at, 1);
        if (opts && opts.bin && GU.trash) e.bin = GU.trash.put(st, c, rec, opts.label).id;
        push(e);
        return true;
      },
    };
  }
  /* Puts back everything in a log, newest first. */
  function revert(st, log) {
    for (let i = log.length - 1; i >= 0; i--) {
      const e = log[i];
      if (!e) continue;
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
      const holder = e.c === 'settings' ? st.settings : e.c === 'meta' ? (st.meta = st.meta || {}) : findIn(st, e.c, e.id);
      if (!holder) continue;
      if (has(e, 'was')) holder[e.k] = copy(e.was);
      else delete holder[e.k];
    }
  }

  /* ---------- shared moves ---------- */
  function setStage(tr, p, stage) {
    tr.set(P, p, 'claimStatus', stage);
    tr.set(P, p, 'claim', true);
    tr.set(P, p, 'claimed', stage !== 'to-send');
  }
  /* Links a record to your bank payment: the line becomes 'Work expenses', its old category kept for Undo. */
  function link(tr, p, tx, taken) {
    tr.set(P, p, 'purchaseTx', tx.id);
    tr.set(P, p, 'purchaseWas', tx.category || '');
    tr.set(T, tx, 'category', WORK_OUT);
    if (taken) taken.add(tx.id);
  }
  function linkSure(st, tr, p, taken) {
    if (p.purchaseTx) return null;
    const r = wm().purchaseFor(st, p, taken);
    if (!r.sure || !r.tx) return null;
    link(tr, p, r.tx, taken);
    return r.tx;
  }
  /* Something you paid for that the employer paid you back for: Get paid back, 'Paid back', linked both ways. */
  function paidBack(st, tr, p, credit, taken) {
    if (p.context !== 'work') {
      tr.set(P, p, 'context', 'work');
      tr.set(P, p, 'movedFrom', 'home');
    }
    tr.set(P, p, 'payer', 'me');
    setStage(tr, p, 'paid-back');
    tr.set(P, p, 'repaidDate', credit.date);
    tr.set(P, p, 'repaidTx', credit.id);
    if (credit.category !== WORK_IN) tr.set(T, credit, 'category', WORK_IN);
    linkSure(st, tr, p, taken);
  }
  /* A home record you'll claim back: Get paid back, 'Not sent yet'. */
  function toClaim(st, tr, p) {
    tr.set(P, p, 'context', 'work');
    tr.set(P, p, 'movedFrom', 'home');
    tr.set(P, p, 'payer', 'me');
    tr.set(P, p, 'notWork', undefined);
    setStage(tr, p, 'to-send');
    linkSure(st, tr, p, usedPurchases(st));
  }

  /* ---------- 1. who you work for ---------- */
  const titleCase = (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
  const reEsc = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  /* The evidence that you're paid by a business: an income source whose 'from' or name shares a word with
     one of your 'Salary' rules, where that word is also in money coming into your accounts. */
  function evidence(s) {
    const rules = (s.rules || []).filter((r) => r && r.category === 'Salary' && r.match);
    if (!rules.length) return null;
    const ins = (s.transactions || []).filter((t) => t.amount > 0).map((t) => ' ' + words(t.description).join(' ') + ' ');
    const seenIn = (w) => ins.filter((d) => d.includes(' ' + w + ' ')).length;
    let best = null;
    for (const src of s.incomeSources || []) {
      for (const field of ['from', 'name']) {
        const text = String(src[field] || '').trim();
        const mine = words(text).filter((w) => !GENERIC.has(w));
        if (!mine.length) continue;
        for (const r of rules) {
          const ruleWords = words(r.match);
          const both = mine.filter((w) => ruleWords.includes(w) && seenIn(w) > 0);
          if (!both.length) continue;
          const n = Math.max.apply(null, both.map(seenIn));
          if (!best || n > best.n) best = { src, field, text, rule: r, words: both, n };
        }
      }
    }
    return best;
  }
  /* The employer's names, from the evidence: 'Acme Care' becomes {name: 'Acme Care Limited', short: 'Acme'}
     when your records write it with 'Ltd' or 'Limited'. */
  function namesFrom(s, ev) {
    const base = ev.text.replace(/[\s,]+(limited|ltd\.?|plc|llp)$/i, '').trim();
    const suffixes = {};
    const re = new RegExp('\\b' + reEsc(base).replace(/\s+/g, '\\s+') + '[\\s,.]*(limited|ltd|plc|llp)\\b', 'gi');
    const texts = [].concat(
      (s.transactions || []).map((t) => t.description || ''),
      (s.paperwork || []).map((p) => (p.party || '') + ' ' + (p.title || '') + ' ' + (p.notes || '')),
      (s.documents || []).map((d) => (d.title || '') + ' ' + (d.notes || '')),
      [ev.rule.match]);
    for (const t of texts) {
      let m;
      re.lastIndex = 0;
      while ((m = re.exec(t))) {
        const k = m[1].toLowerCase() === 'ltd' ? 'limited' : m[1].toLowerCase();
        suffixes[k] = (suffixes[k] || 0) + 1;
      }
    }
    const top = Object.keys(suffixes).sort((a, b) => suffixes[b] - suffixes[a] || a.localeCompare(b))[0];
    const name = base + (top ? ' ' + (top === 'limited' ? 'Limited' : top === 'plc' ? 'plc' : 'LLP') : '');
    const parts = base.split(/\s+/);
    const first = parts.find((w) => ev.words.includes(words(w)[0])) || parts[0];
    const raw = first.replace(/[^A-Za-z0-9&-]/g, '');
    // Written in capitals, or short enough to be letters (an acronym): capitals. Otherwise as a name.
    const shortName = raw === raw.toUpperCase() || raw.length <= 3 ? raw.toUpperCase() : titleCase(raw);
    return { name, short: shortName, match: [words(raw)[0] || raw.toLowerCase()] };
  }

  /* ---------- the run ---------- */
  /* Every step of the re-sort, in one go, inside a commit. Returns what it did, or null when there's
     nothing to go on (no employer in Settings and no evidence of one). */
  function sortAll(st, tr) {
    const W = wm();
    const sum0 = () => ({ n: 0, total: 0 });
    const add = (o, a) => {
      o.n++;
      o.total = round2(o.total + a);
    };
    const out = {
      employer: '', rules: 0, wages: sum0(), repayments: sum0(), sentBack: sum0(), claims: sum0(), linked: 0, paidBack: sum0(),
      moved: sum0(), workDebits: 0, bills: 0, billLinks: 0, budgets: 0, repayDays: null, removedRules: [],
    };

    // 1. The employer: the one you've set up, or one found in your data.
    const cur = st.settings.employer;
    const ev = evidence(st);
    let mine; // whether this run has logged the employer already, so it can be filled in below without logging again
    if (cur && typeof cur === 'object' && !Array.isArray(cur) && (cur.name || cur.short)) {
      const next = Object.assign({}, cur);
      if (!next.wageSource && ev) next.wageSource = ev.src.id;
      if (!next.since) next.since = today();
      mine = tr.setting('employer', next);
    } else {
      if (!ev) return null;
      const n = namesFrom(st, ev);
      mine = tr.setting('employer', { name: n.name, short: n.short, match: n.match, wageSource: ev.src.id, payInto: '', repayDays: '', nudgeDays: 3, chaseDays: 21, since: today() });
    }
    out.employer = W.employer(st).label;

    // 2. Rules: a rule sending the employer's money to 'Salary' would hide repayments in your income. The
    //    employer split runs before your rules now, so it isn't needed.
    for (const r of (st.rules || []).slice()) {
      if (r && r.category === 'Salary' && r.match && W.isEmployerText(st, r.match)) {
        out.removedRules.push(copy(r));
        tr.remove('rules', r);
        out.rules++;
      }
    }

    // 3–5. Money to and from the employer: wages, repayments, and money you sent back. Wage lines that
    //      don't name them are caught by the wage words in the default rules.
    for (const t of st.transactions || []) {
      if (!t || !Number(t.amount)) continue;
      const desc = t.description || '';
      if (W.isEmployerText(st, desc)) {
        const cat = W.employerCategory(desc, t.amount);
        if (!cat) continue;
        if (t.category !== cat) tr.set(T, t, 'category', cat);
        if (t.amount < 0) add(out.sentBack, -t.amount);
        else add(cat === 'Salary' ? out.wages : out.repayments, t.amount);
      } else if (t.amount > 0 && !t.category && WAGE.test(desc) && F.categorise(desc, t.amount, st.rules) === 'Salary') {
        tr.set(T, t, 'category', 'Salary');
        add(out.wages, t.amount);
      }
    }

    // 6. Things you've been claiming back: your money, not sent yet (or sent, if ticked), linked to your
    //    bank payment when it's clear which one it is.
    const takenTx = usedPurchases(st);
    for (const p of (st.paperwork || []).filter((x) => x && x.claim === true && x.kind !== 'invoice-out' && !x.payer).sort(byDate)) {
      if (p.context !== 'work') {
        tr.set(P, p, 'context', 'work');
        tr.set(P, p, 'movedFrom', 'home');
      }
      tr.set(P, p, 'payer', 'me');
      const stage = W.stage(p);
      tr.set(P, p, 'claimStatus', stage);
      tr.set(P, p, 'claimed', stage !== 'to-send');
      if (stage !== 'paid-back') add(out.claims, W.left(p));
      if (linkSure(st, tr, p, takenTx)) out.linked++;
    }

    // 7. Work things with no payer that the employer has since paid you back for, to the penny.
    const usedC = usedCredits(st);
    const credits = () => (st.transactions || []).filter((t) => t.amount > 0 && t.category === WORK_IN && !usedC.has(t.id)).sort(byDate);
    const takenP = new Set();
    const unsorted = (st.paperwork || []).filter((p) => p && p.context === 'work' && p.kind !== 'invoice-out' && W.lane(p, P) === 'unsorted' && amountOf(p) > 0 && p.date);
    if (unsorted.length) {
      for (const c of credits()) {
        const r = W.repaymentFor(st, c, takenP, { pool: unsorted, days: WINDOW, lone: true });
        if (!r.sure || r.claims.length !== 1) continue;
        const p = r.claims[0];
        paidBack(st, tr, p, c, takenTx);
        takenP.add(p.id);
        usedC.add(c.id);
        add(out.paidBack, amountOf(p));
      }
    }

    // 8. Home orders the employer paid you back for, where their reference names the item: exact amount,
    //    within 90 days, a word in common. They move to Work as paid back.
    const pool = homeOrders(st);
    for (const c of credits()) {
      const r = W.repaymentFor(st, c, takenP, { pool, days: WINDOW });
      if (!r.sure || r.claims.length !== 1) continue;
      const p = r.claims[0];
      paidBack(st, tr, p, c, takenTx);
      takenP.add(p.id);
      usedC.add(c.id);
      add(out.paidBack, amountOf(p));
      add(out.moved, amountOf(p));
    }

    // 9. Repaid purchases with no record: a debit becomes 'Work expenses' when it's the only one (or one of
    //    as many as there are repayments that day) with the same amount in the 90 days before a repayment
    //    and a word in common with its reference. Debits that belong to a record are asked about instead.
    const belongs = recordDebits(st);
    const emp0 = employerWordSet(st);
    const groups = new Map();
    for (const c of credits()) {
      const k = c.date + '|' + round2(c.amount).toFixed(2);
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(c);
    }
    for (const list of groups.values()) {
      const c0 = list[0];
      const ref = new Set([].concat.apply([], list.map((c) => refWords(st, c, emp0))));
      if (!ref.size) continue;
      const lo = addDays(c0.date, -WINDOW);
      const cands = (st.transactions || []).filter((d) => d.amount < 0 && same(-d.amount, c0.amount) && d.date >= lo && d.date <= c0.date &&
        d.category !== TRANSFER && d.category !== WORK_IN && !takenTx.has(d.id) && !belongs.has(d.id) && words(d.description).some((w) => ref.has(w)));
      if (!cands.length || cands.length !== list.length) continue;
      for (const d of cands) {
        if (d.category !== WORK_OUT) {
          tr.set(T, d, 'category', WORK_OUT);
          out.workDebits++;
        }
        takenTx.add(d.id);
      }
    }

    // 10. Work bills: marked as work, with who pays. A claim already made for one of its payments gets its billId.
    const isWorkBill = GU.parts && GU.parts.isWorkBill ? GU.parts.isWorkBill : (b) => b.context === 'work' || (!b.context && b.category === WORK_OUT);
    for (const b of st.bills || []) {
      if (!b || !isWorkBill(b)) continue;
      if (b.context !== 'work') tr.set('bills', b, 'context', 'work');
      if (!b.payer) tr.set('bills', b, 'payer', W.payerOf(b, 'bills'));
      out.bills++;
      const bw = words((b.name || '') + ' ' + (b.payee || ''));
      for (const h of b.history || []) {
        if (!h || !h.date) continue;
        const amt = amountOf({ amount: h.amount != null && h.amount !== '' ? h.amount : b.amount });
        const p = (st.paperwork || []).find((x) => W.isClaim(x) && !x.billId && same(amountOf(x), amt) && x.date && Math.abs(gapDays(h.date, x.date)) <= 3 &&
          shares(bw, words((x.party || '') + ' ' + (x.title || ''))));
        if (p && tr.set(P, p, 'billId', b.id)) out.billLinks++;
      }
    }

    // 12. Budgets: work money is kept out of your own totals, so a budget on it means nothing now. The whole
    //     budgets object is logged, so undo puts them back just as they were.
    const budgets = st.settings.budgets || {};
    const gone = Object.keys(budgets).filter((k) => WORK.includes(k));
    if (gone.length) {
      const next = Object.assign({}, budgets);
      gone.forEach((k) => delete next[k]);
      tr.setting('budgets', next);
      out.budgets = gone.length;
    }

    // 1, again. Where repayments land, and how long they usually take, from what's now linked.
    const emp = Object.assign({}, st.settings.employer);
    const lastIn = (st.transactions || []).filter((t) => t.amount > 0 && t.category === WORK_IN && W.isEmployerText(st, t.description)).sort(byDate).pop();
    if (!emp.payInto && lastIn && lastIn.account) emp.payInto = lastIn.account;
    const days = learnRepayDays(st);
    if ((emp.repayDays === '' || emp.repayDays == null) && days != null) emp.repayDays = days;
    if (emp.repayDays === '') delete emp.repayDays;
    if (mine) st.settings.employer = emp; // its old value is logged already
    else tr.setting('employer', emp);
    out.repayDays = W.employer(st).repayDays;
    return out;
  }

  /* How long the employer usually takes to pay you back: the median number of days from your bank payment
     (or the record's date) to their repayment, across everything linked both ways. null with nothing to go on. */
  function learnRepayDays(s) {
    s = s || store.state;
    if (!s) return null;
    const tx = new Map((s.transactions || []).map((t) => [t.id, t]));
    const gaps = [];
    for (const p of s.paperwork || []) {
      if (!p || p.context !== 'work') continue;
      const paid = [];
      if (p.repaidTx) paid.push((tx.get(p.repaidTx) || {}).date || p.repaidDate);
      for (const r of p.repayments || []) if (r && r.tx) paid.push((tx.get(r.tx) || {}).date || r.date);
      const from = (p.purchaseTx && (tx.get(p.purchaseTx) || {}).date) || p.date;
      for (const to of paid) if (from && to) gaps.push(Math.max(0, gapDays(from, to)));
    }
    return gaps.length ? Math.round(median(gaps)) : null;
  }

  /* The examples are there: the re-sort waits until they're cleared, so it sorts your own records. */
  const EXAMPLE_KEYS = ['transactions', 'paperwork', 'bills', 'incomeSources', 'costIdeas', 'tasks', 'documents'];
  const hasExamples = (s) => EXAMPLE_KEYS.some((c) => (s[c] || []).some((x) => x && x.demo));

  /* The one-off re-sort. Runs once (guarded by meta.refileV1), in one commit, then says what it did.
     opts.force runs it again on top (adding to the same log), e.g. after undo. opts.quiet: no toast.
     Returns what it did, {skipped} when there's no employer to go on, {waiting} while the examples are
     there (nothing is marked, so it runs once they're cleared), or null when it has run already. */
  function run(opts) {
    opts = opts || {};
    const s = store.state;
    if (!s || !wm()) return null;
    const prev = metaOf(s);
    if (prev && !opts.force) return null;
    if (hasExamples(s)) return { waiting: 'examples' };
    let out = null;
    store.commit((st) => {
      if (!st.meta || typeof st.meta !== 'object' || Array.isArray(st.meta)) st.meta = {};
      st.settings = st.settings || {};
      const log = [];
      const tr = logger(st, log);
      out = sortAll(st, tr);
      const was = metaOf(st);
      if (!out) {
        if (!was) st.meta[KEY] = { at: today(), skipped: true };
        return;
      }
      const keep = was && !was.skipped && !was.undone ? was : null;
      st.meta[KEY] = {
        at: keep ? keep.at : today(),
        changes: (keep ? keep.changes || [] : []).concat(log),
        removedRules: (keep ? keep.removedRules || [] : []).concat(out.removedRules),
        done: keep ? keep.done || {} : {},
        summary: keep && keep.summary ? keep.summary : Object.assign({}, out, { removedRules: undefined, changed: log.length }),
      };
      out.changed = log.length;
    });
    qCache = null;
    if (!out) return { skipped: true };
    if (!opts.quiet && out.changed) {
      const e = wm().employer();
      toast('I’ve split your site into Home and Work, and sorted your ' + e.label + ' money.', {
        action: 'See what changed', timeout: 15000,
        onAction: () => {
          if (GU.parts) GU.parts.set('work');
          if (GU.view) GU.view.go('work');
        },
      });
    }
    return out;
  }

  /* What the re-sort did, for the 'Check these' card and Settings. */
  function info(s) {
    s = s || store.state;
    const m = metaOf(s);
    if (!m) return null;
    return { at: m.at || '', skipped: !!m.skipped, undone: m.undone || '', summary: m.summary || null, canUndo: canUndo(s), answered: Object.keys(m.done || {}).length };
  }
  /* Whether 'Undo the Home/Work re-sort' is still offered: for 30 days. */
  function canUndo(s) {
    const m = metaOf(s || store.state);
    return !!(m && m.at && !m.skipped && !m.undone && (m.changes || []).length && today() <= addDays(m.at, UNDO_DAYS));
  }
  /* Puts back everything the re-sort changed, answers included. The re-sort doesn't run again by itself. */
  function undo(opts) {
    opts = opts || {};
    const m = metaOf(store.state);
    if (!m || m.skipped || m.undone) return 0;
    const n = (m.changes || []).length;
    store.commit((st) => {
      const mm = metaOf(st);
      revert(st, mm.changes || []);
      st.meta[KEY] = { at: mm.at, undone: today() };
    });
    qCache = null;
    if (!opts.quiet) toast('Put back as it was before the Home and Work re-sort.');
    return n;
  }

  /* ---------- the questions ---------- */
  /* What's needed by more than one question, worked out once per look. */
  function factsOf(s) {
    const W = wm();
    const e = W.employer(s);
    return { s, W, e, co: e.label, Co: e.Label, tx: s.transactions || [], usedC: usedCredits(s), usedP: usedPurchases(s), emp: employerWordSet(s), orders: homeOrders(s), askedCredits: new Set(), askedOrders: new Set() };
  }
  const opt = (id, label, apply, extra) => Object.assign({ id, label, suggested: false, apply: apply || (() => {}) }, extra);
  const suggest = (o) => Object.assign(o, { suggested: true });

  /* 1. A work invoice you sent the employer for something that's also a claim: the same money twice. */
  function qMerge(f) {
    const { s, W, co } = f;
    const out = [];
    for (const inv of (s.paperwork || []).filter((p) => p.context === 'work' && p.kind === 'invoice-out' && p.status !== 'paid').sort(byDate)) {
      const iw = words((inv.party || '') + ' ' + (inv.title || ''));
      const claim = W.claims(s).map((x) => x.p).filter((p) => same(amountOf(p), amountOf(inv)) && p.date && inv.date && Math.abs(gapDays(p.date, inv.date)) <= 31 &&
        shares(iw, words((p.party || '') + ' ' + (p.title || '')))).sort((a, b) => Math.abs(gapDays(a.date, inv.date)) - Math.abs(gapDays(b.date, inv.date)))[0];
      const name = shopOf(inv) || nameOf(inv);
      const when = inv.date ? ' (' + short(inv.date) + ')' : '';
      const asClaim = (st, tr) => {
        const x = findIn(st, P, inv.id);
        if (!x) return;
        tr.set(P, x, 'kind', 'receipt');
        tr.set(P, x, 'status', '');
        tr.set(P, x, 'payer', 'me');
        setStage(tr, x, 'sent');
        tr.set(P, x, 'claimedDate', x.date || today());
        tr.set(P, x, 'packId', W.newPackId(st, x.date || today(), [x.id]));
      };
      if (!claim) {
        out.push({ key: 'merge:' + inv.id, kind: 'merge', ref: { c: P, id: inv.id },
          title: 'Your ' + money(amountOf(inv)) + ' ' + name + ' invoice to ' + co + when + ' isn’t in Get paid back.',
          detail: 'Invoices you send ' + co + ' for your own spending are claims now.',
          options: [suggest(opt('claim', 'Add it to Get paid back as sent', asClaim)), opt('leave', 'Leave it out')] });
        continue;
      }
      const merge = (sent) => (st, tr) => {
        const x = findIn(st, P, inv.id);
        const c = findIn(st, P, claim.id);
        if (!x || !c) return;
        const ids = new Set((c.files || []).map((fl) => fl && fl.id));
        const extra = (x.files || []).filter((fl) => fl && !ids.has(fl.id));
        if (extra.length) tr.set(P, c, 'files', (c.files || []).concat(copy(extra)));
        if (sent && W.stage(c) === 'to-send') {
          setStage(tr, c, 'sent');
          tr.set(P, c, 'claimedDate', x.date || today());
          tr.set(P, c, 'packId', W.newPackId(st, x.date || today(), [c.id]));
        }
        tr.remove(P, x, { bin: true, label: (x.title || 'Invoice') + ' (merged into Get paid back)' });
      };
      out.push({ key: 'merge:' + inv.id, kind: 'merge', ref: { c: P, id: inv.id },
        title: 'Your ' + money(amountOf(inv)) + ' ' + name + ' invoice to ' + co + when + ' and the ' + (shopOf(claim) || nameOf(claim)) + ' expense in Get paid back look like the same money.',
        detail: 'Merging moves its files onto the claim and puts the invoice in Recently deleted.',
        options: [suggest(opt('sent', 'Same: merge, I sent it' + (inv.date ? ' on ' + short(inv.date) : ''), merge(true))), opt('unsent', 'Same: merge, not sent yet', merge(false)), opt('different', 'Different', asClaim)] });
    }
    return out;
  }

  /* 2. A payment you added by hand that's also on an imported statement. Work money only. */
  function qDupes(f) {
    const { s, tx } = f;
    const workRef = new Set();
    for (const p of s.paperwork || []) if (p.context === 'work') ['purchaseTx', 'repaidTx'].forEach((k) => p[k] && workRef.add(p[k]));
    const imported = tx.filter(isImported);
    const out = [];
    for (const t of tx.filter((x) => !isImported(x) && Number(x.amount)).sort(byDate)) {
      const tw = words((t.description || '') + ' ' + (t.notes || ''));
      const twin = imported.filter((o) => same(o.amount, t.amount) && o.date && t.date && Math.abs(gapDays(o.date, t.date)) <= 3 && shares(tw, words(o.description)))
        .sort((a, b) => Math.abs(gapDays(a.date, t.date)) - Math.abs(gapDays(b.date, t.date)))[0];
      if (!twin || !(WORK.includes(t.category) || WORK.includes(twin.category) || workRef.has(t.id))) continue;
      const how = t.source === 'paperwork' ? ' when you marked the invoice paid' : t.source === 'bill' ? ' when you marked the bill paid' : '';
      const name = clean(t.description);
      out.push({ key: 'dupe:' + t.id, kind: 'dupe', ref: { c: T, id: t.id },
        title: 'There are two ' + money(amountOf(t)) + (name ? ' ' + name : '') + ' payments: one on ' + short(t.date) + ' (' + accountName(s, t.account) + ') was added by hand' + how +
          '; the ' + short(twin.date) + ' one is on your ' + accountName(s, twin.account) + ' statement.',
        detail: 'Removing it puts it in Recently deleted for 30 days.',
        options: [suggest(opt('remove', 'Remove the hand-added one', (st, tr) => {
          const x = findIn(st, T, t.id);
          if (!x) return;
          for (const p of st.paperwork || []) {
            if (p.purchaseTx === x.id) {
              tr.set(P, p, 'purchaseTx', undefined);
              tr.set(P, p, 'purchaseWas', undefined);
            }
            if (p.repaidTx === x.id) tr.set(P, p, 'repaidTx', undefined);
          }
          tr.remove(T, x, { bin: true });
        })), opt('keep', 'Keep both')] });
    }
    return out;
  }

  /* 3. A claim whose bank payment is for a different amount: a receipt in another currency, say. */
  const CURRENCY = { USD: 'dollars', EUR: 'euros', GBP: 'pounds' };
  function qForeign(f) {
    const { s, W } = f;
    const out = [];
    for (const x of W.claims(s, 'open')) {
      const p = x.p;
      if (p.purchaseTx) continue;
      const r = W.purchaseFor(s, p);
      if (r.sure || r.tx || !r.near || f.usedP.has(r.near.id)) continue;
      const bank = round2(-r.near.amount);
      const own = amountOf(p).toFixed(2);
      const cur = r.currency && r.currency !== String((s.settings && s.settings.currency) || 'GBP').toUpperCase() ? r.currency : '';
      out.push({ key: 'fx:' + p.id, kind: 'fx', ref: { c: P, id: p.id },
        title: (shopOf(p) || nameOf(p)) + ': the receipt says ' + (cur ? own + ' (' + (CURRENCY[cur] || cur) + ')' : money(amountOf(p))) + ', your bank took ' + money(bank) + '.',
        detail: 'Paid from ' + accountName(s, r.near.account) + ' on ' + short(r.near.date) + '.',
        options: [suggest(opt('bank', 'Use ' + money(bank), (st, tr) => {
          const c = findIn(st, P, p.id);
          const t = findIn(st, T, r.near.id);
          if (!c || !t || c.purchaseTx || usedPurchases(st).has(t.id)) return;
          link(tr, c, t);
          if (!c.originalAmount && amountOf(c) > 0) tr.set(P, c, 'originalAmount', (amountOf(c).toFixed(2) + ' ' + (cur || '')).trim());
          tr.set(P, c, 'amount', bank);
        })), opt('keep', 'Keep ' + (cur ? own : money(amountOf(p))))] });
    }
    return out;
  }

  /* 4. Money you sent the employer close to a payment from them of about the same amount. */
  function qSentBack(f) {
    const { s, W, co, tx } = f;
    const out = [];
    const ins = tx.filter((t) => t.amount > 0 && W.isEmployerText(s, t.description));
    for (const d of tx.filter((t) => t.amount < 0 && W.isEmployerText(s, t.description)).sort(byDate)) {
      const a = -d.amount;
      const c = ins.filter((t) => Math.abs(gapDays(d.date, t.date)) <= 3 && Math.abs(t.amount - a) <= 0.05 * t.amount)
        .sort((x, y) => Math.abs(gapDays(d.date, x.date)) - Math.abs(gapDays(d.date, y.date)))[0];
      if (!c) continue;
      const g = gapDays(c.date, d.date);
      const when = g === 0 ? 'the same day' : plural(Math.abs(g), 'day') + (g > 0 ? ' after' : ' before');
      const what = refText(s, c);
      out.push({ key: 'sentback:' + d.id, kind: 'sentback', ref: { c: T, id: d.id },
        title: money(a) + ' went to ' + co + ' on ' + short(d.date) + ', ' + when + ' ' + co + ' paid you ' + money(c.amount) + (what ? ' for ' + what : '') + '.',
        detail: 'If you sent it back, it stays as work money and out of your spending.',
        options: [suggest(opt('back', 'I sent it back to ' + co)), opt('remove', 'It’s a duplicate line: remove it', (st, tr) => {
          const x = findIn(st, T, d.id);
          if (x) tr.remove(T, x, { bin: true });
        })] });
    }
    return out;
  }

  /* 5. A repayment of exactly the amount of a home order, soon after it, where the reference doesn't name
     it (or the payment doesn't name the employer but is written the way theirs are). */
  function qRepaid(f) {
    const { s, W, co, Co, tx, emp } = f;
    const items = [];
    const takenP = new Set();
    const usedC = f.usedC;
    const okC = new Set((s.meta && Array.isArray(s.meta.okCredits) && s.meta.okCredits) || []);
    const debitFor = (p) => {
      const r = W.purchaseFor(s, p);
      return r.tx || null;
    };
    const item = (c, p, fromEmployer, ref) => {
      const d = debitFor(p);
      const cw = refWords(s, c, emp);
      const strong = p.category === WORK_OUT || (d && shares(cw, words(d.description)));
      takenP.add(p.id);
      f.askedCredits.add(c.id);
      f.askedOrders.add(p.id);
      const yes = opt('yes', 'Yes, ' + co + ' paid me back', (st, tr) => {
        const x = findIn(st, P, p.id);
        const t = findIn(st, T, c.id);
        if (!x || !t || x.context === 'work' || usedCredits(st).has(t.id)) return;
        paidBack(st, tr, x, t, usedPurchases(st));
      });
      const no = opt('no', 'No, mine', (st, tr) => {
        const x = findIn(st, P, p.id);
        if (x && x.context !== 'work') tr.set(P, x, 'notWork', true);
      });
      items.push({ key: 'repaid:' + c.id, ref: { c: P, id: p.id }, tx: c.id, amount: amountOf(p), date: p.date,
        label: nameOf(p) + ' · ' + money(amountOf(p)) + ' · ' + short(p.date),
        detail: fromEmployer ? Co + ' paid you ' + money(c.amount) + ' on ' + short(c.date) + ', ' + quoteRef(ref) + '.'
          : money(c.amount) + ' came in on ' + short(c.date) + ', ' + quoteRef(ref) + ', but it doesn’t say it’s from ' + co + '.',
        options: [strong ? suggest(yes) : yes, no] });
    };
    // From the employer: credits not used yet with an exact home order before them.
    for (const c of tx.filter((t) => t.amount > 0 && t.category === WORK_IN && !usedC.has(t.id) && !okC.has(t.id)).sort(byDate)) {
      const r = W.repaymentFor(s, c, takenP, { pool: f.orders, days: WINDOW });
      const best = r.options.filter((o) => !o.pack && o.claims.length === 1)[0];
      if (best) item(c, best.claims[0], true, refText(s, c));
    }
    // Not naming the employer, but with a word only their payments use (how they write your name, say).
    const empLines = tx.filter((t) => W.isEmployerText(s, t.description));
    const empCount = new Map();
    for (const t of empLines) for (const w of new Set(words(t.description))) empCount.set(w, (empCount.get(w) || 0) + 1);
    const otherCount = new Map();
    for (const t of tx) {
      if (W.isEmployerText(s, t.description)) continue;
      for (const w of new Set(words(t.description))) if (empCount.has(w)) otherCount.set(w, (otherCount.get(w) || 0) + 1);
    }
    const sig = new Set(Array.from(empCount).filter(([w, n]) => n >= 2 && (otherCount.get(w) || 0) <= 2 && !emp.has(w) && !WAGE.test(w)).map(([w]) => w));
    if (sig.size) {
      for (const c of tx.filter((t) => t.amount > 0 && ['', TRANSFER, 'Refunds', 'Other income'].includes(t.category || '') && !W.isEmployerText(s, t.description) &&
        !WAGE.test(t.description || '') && !usedC.has(t.id) && !okC.has(t.id)).sort(byDate)) {
        const cw = words(c.description);
        if (!cw.some((w) => sig.has(w))) continue;
        const lo = addDays(c.date, -WINDOW);
        const p = f.orders.filter((x) => !takenP.has(x.id) && same(amountOf(x), c.amount) && x.date <= c.date && x.date >= lo)
          .sort((a, b) => gapDays(a.date, c.date) - gapDays(b.date, c.date))[0];
        if (p) item(c, p, false, refText(s, c, sig));
      }
    }
    if (!items.length) return [];
    return [{ key: 'repaid', kind: 'repaid', items,
      title: Co + ' paid you the same amount soon after these, but the reference doesn’t name them. Were they for ' + co + '?',
      detail: '‘Yes’ moves it to Get paid back as paid back.',
      options: [opt('yes', 'Yes, ' + co + ' paid me back'), opt('no', 'No, mine')] }];
  }

  /* 6. Repayments from the employer that don't match anything. */
  function qUnmatched(f) {
    const { s, W, Co, tx } = f;
    const okC = new Set((s.meta && Array.isArray(s.meta.okCredits) && s.meta.okCredits) || []);
    const outs = tx.filter((t) => t.amount < 0 && (t.category === WORK_OUT || t.category === WORK_IN));
    const backUsed = new Set();
    const list = [];
    for (const c of tx.filter((t) => t.amount > 0 && t.category === WORK_IN && !f.usedC.has(t.id) && !okC.has(t.id) && !f.askedCredits.has(t.id)).sort(byDate)) {
      // Explained by a purchase marked as work, or by money you sent back to them.
      if (outs.some((d) => d.category === WORK_OUT && same(-d.amount, c.amount) && d.date <= c.date && d.date >= addDays(c.date, -WINDOW))) continue;
      const back = outs.find((d) => d.category === WORK_IN && !backUsed.has(d.id) && same(-d.amount, c.amount) && d.date >= c.date && d.date <= addDays(c.date, WINDOW));
      if (back) {
        backUsed.add(back.id);
        continue;
      }
      if (W.repaymentFor(s, c).options.length) continue; // a match for a claim is asked about in Get paid back
      list.push(c);
    }
    if (!list.length) return [];
    const ids = list.map((c) => c.id);
    return [{ key: 'unmatched', kind: 'unmatched', txIds: ids,
      title: Co + ' repayments I couldn’t match to a purchase.',
      detail: plural(list.length, 'payment') + ', ' + money(sum(list, (c) => c.amount)) + ' in total: ' +
        list.slice(0, 6).map((c) => money(c.amount) + ' on ' + short(c.date) + (refText(s, c) ? ' (' + refText(s, c) + ')' : '')).join('; ') + (list.length > 6 ? '; and ' + (list.length - 6) + ' more' : '') + '.',
      lines: list.map((c) => ({ tx: c.id, amount: c.amount, date: c.date, ref: refText(s, c) })),
      options: [opt('pick', 'Pick what each was for', null, { go: 'work-back' }), suggest(opt('fine', 'That’s fine', (st, tr) => {
        const cur = Array.isArray(st.meta.okCredits) ? st.meta.okCredits : [];
        const next = Array.from(new Set(cur.concat(ids)));
        if (next.length !== cur.length) tr.meta('okCredits', next);
      }))] }];
  }

  /* 7. Home orders that might have been for work and haven't been paid back: bought from the same shop on the
     same day as something the employer paid you back for, office supplies, or already filed as a work expense. */
  function qMaybeWork(f) {
    const { s, W, co, Co, tx } = f;
    const repaid = (s.paperwork || []).filter((p) => p.context === 'work' && W.lane(p, P) === 'back' && W.stage(p) === 'paid-back' && p.date);
    const repaidOn = new Map();
    for (const p of repaid) {
      if (!repaidOn.has(p.date)) repaidOn.set(p.date, []);
      repaidOn.get(p.date).push(p);
    }
    const shopWords = (p) => words(p.party || '');
    const firstIn = tx.filter((t) => t.amount > 0 && t.category === WORK_IN).map((t) => t.date).sort()[0];
    const from = addDays(firstIn || today(), firstIn ? -WINDOW : -365);
    const work = (s.paperwork || []).filter((p) => p.context === 'work');
    const copyOfWork = (p) => work.some((w) => same(amountOf(w), amountOf(p)) && w.date && Math.abs(gapDays(w.date, p.date)) <= 3 &&
      shares(words((w.party || '') + ' ' + (w.title || '')), words((p.party || '') + ' ' + (p.title || ''))));
    const items = [];
    for (const p of f.orders.filter((x) => x.date >= from && !f.askedOrders.has(x.id)).sort(byDate)) {
      if (copyOfWork(p)) continue;
      const pw = words(p.title || '');
      const pw0 = shopWords(p);
      // Only when the title says what was bought (not just '<shop> payment').
      const day = pw0.length && pw.some((w) => !pw0.includes(w)) ? (repaidOn.get(p.date) || []).find((x) => shares(pw0, shopWords(x))) : null;
      const supply = pw.find((w) => SUPPLIES.has(w));
      const why = p.category === WORK_OUT ? 'Filed as a work expense' : day ? 'Bought the same day as ' + nameOf(day) + ', which ' + co + ' paid you back for' : supply ? 'Looks like office supplies' : '';
      if (!why) continue;
      items.push({ key: 'maybe:' + p.id, ref: { c: P, id: p.id }, amount: amountOf(p), date: p.date,
        label: nameOf(p) + ' · ' + money(amountOf(p)) + ' · ' + short(p.date), detail: why + '.',
        options: [opt('claim', 'Claim it back', (st, tr) => {
          const x = findIn(st, P, p.id);
          if (x && x.context !== 'work') toClaim(st, tr, x);
        }), opt('mine', 'Mine', (st, tr) => {
          const x = findIn(st, P, p.id);
          if (x && x.context !== 'work') tr.set(P, x, 'notWork', true);
        })] });
    }
    if (!items.length) return [];
    return [{ key: 'maybe', kind: 'maybe', items,
      title: 'Were any of these for ' + co + '? None has been paid back yet.',
      detail: '‘Claim it back’ adds it to Get paid back, not sent yet. ' + Co + ' won’t know until you send it.',
      options: [opt('claim', 'Claim it back'), opt('mine', 'Mine')] }];
  }

  /* 8. Cost ideas with no payer: the employer's, yours to claim back, or just yours. The suggestion comes from
     which of your records share their words; with no clue, the employer pays. */
  function qIdeas(f) {
    const { s, co, Co, tx, emp } = f;
    const ideas = (s.costIdeas || []).filter((i) => i && !i.payer && i.context !== 'home' && i.status !== 'done' && i.status !== 'dropped');
    if (!ideas.length) return [];
    const home = new Set();
    const work = new Set();
    const put = (set, text) => words(text).forEach((w) => !emp.has(w) && set.add(w));
    for (const p of s.paperwork || []) put(p.context === 'work' ? work : home, (p.party || '') + ' ' + (p.title || ''));
    for (const t of tx) {
      if (t.category === TRANSFER) continue;
      put(WORK.includes(t.category) ? work : home, t.description);
    }
    const isWorkBill = GU.parts && GU.parts.isWorkBill ? GU.parts.isWorkBill : (b) => b.context === 'work';
    for (const b of s.bills || []) put(isWorkBill(b) ? work : home, b.name);
    for (const x of s.sectionItems || []) put(home, (x.title || '') + ' ' + (x.party || ''));
    for (const d of s.documents || []) put(d.context === 'work' ? work : home, d.title);
    for (const d of s.debts || []) put(home, d.name);
    const isWorkTask = GU.parts && GU.parts.isWorkTask ? (t) => GU.parts.isWorkTask(s, t) : (t) => t.context === 'work';
    for (const t of s.tasks || []) put(isWorkTask(t) ? work : home, t.title);
    for (const p of s.projects || []) put(work, p.name || p.title);
    const items = ideas.map((i) => {
      const iw = words((i.name || '') + ' ' + (i.notes || ''));
      const h = iw.filter((w) => home.has(w)).length;
      const k = iw.filter((w) => work.has(w)).length;
      const mine = h > k;
      const setTo = (context, payer) => (st, tr) => {
        const x = findIn(st, 'costIdeas', i.id);
        if (!x) return;
        tr.set('costIdeas', x, 'context', context);
        tr.set('costIdeas', x, 'payer', payer);
      };
      const cost = money(Number(i.cost) || 0, { whole: true }) + (Number(i.monthly) ? ' + ' + money(Number(i.monthly), { whole: true }) + ' a month' : '');
      return { key: 'idea:' + i.id, ref: { c: 'costIdeas', id: i.id }, amount: Number(i.cost) || 0, label: clean(i.name) + ' · ' + cost,
        detail: mine ? 'It sounds like one of your own things.' : '',
        options: [Object.assign(opt('company', Co + ' pays', setTo('work', 'company')), { suggested: !mine }),
          opt('me', 'I pay, get it back', setTo('work', 'me')),
          Object.assign(opt('home', 'Mine', setTo('home', undefined), { hint: 'Moves it to Home › Plans' }), { suggested: mine })] };
    });
    return [{ key: 'ideas', kind: 'ideas', items,
      title: 'Your ' + plural(ideas.length, 'cost idea') + ': who pays?',
      detail: 'Ideas ' + co + ' pays for aren’t planned on your money.',
      options: [opt('company', Co + ' pays'), opt('me', 'I pay, get it back'), opt('home', 'Mine')] }];
  }

  /* 9. A to-do to pay something that's already paid and in Get paid back. */
  const AMOUNT = /£\s?(\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)/g;
  function qTasks(f) {
    const { s, W } = f;
    const claims = W.claims(s).map((x) => x.p).filter((p) => p.kind === 'receipt' || p.status === 'paid' || p.purchaseTx);
    if (!claims.length) return [];
    const out = [];
    for (const t of (s.tasks || []).filter((x) => x && !x.done)) {
      const text = (t.title || '') + ' ' + (t.notes || '');
      const amounts = Array.from(text.matchAll(AMOUNT)).map((m) => Number(m[1].replace(/,/g, '')));
      const from = ((t.notes || '').match(/from:\s*(.+)$/im) || [])[1];
      const tw = words(text);
      const p = claims.find((c) => (from && clean(from).toLowerCase() === clean(c.title).toLowerCase() && (!amounts.length || amounts.some((a) => same(a, amountOf(c))))) ||
        (amounts.some((a) => same(a, amountOf(c))) && shares(tw, words((c.party || '') + ' ' + (c.title || '')))));
      if (!p) continue;
      out.push({ key: 'task:' + t.id, kind: 'task', ref: { c: 'tasks', id: t.id },
        title: 'Your task ‘' + clean(t.title) + '’ is already paid, and it’s in Get paid back.',
        detail: nameOf(p) + ', ' + money(amountOf(p)) + (p.date ? ' on ' + short(p.date) : '') + '.',
        options: [suggest(opt('done', 'Mark done', (st, tr) => {
          const x = findIn(st, 'tasks', t.id);
          if (!x || x.done) return;
          tr.set('tasks', x, 'done', true);
          tr.set('tasks', x, 'doneAt', today());
        })), opt('keep', 'Keep')] });
    }
    return out;
  }

  /* 10. Your pay lately compared with the plan: the day it lands and how much. */
  function qWages(f) {
    const { s, W, co, tx } = f;
    const src = W.wageSource(s);
    if (!src || !(Number(src.amount) > 0) || (src.frequency && src.frequency !== 'monthly')) return [];
    const plan = Number(src.amount);
    const lines = tx.filter((t) => t.amount > 0 && t.category === 'Salary' && (W.isEmployerText(s, t.description) || WAGE.test(t.description || '')) &&
      Math.abs(t.amount - plan) <= 0.5 * plan && t.date >= addDays(today(), -120)).sort(byDate).slice(-3);
    if (lines.length < 2) return [];
    const amt = round2(median(lines.map((t) => t.amount)));
    const days = lines.map((t) => +t.date.slice(8));
    const day = Math.round(median(days));
    const planDay = Number(src.anchorDay) || (src.nextDate ? +src.nextDate.slice(8) : 0);
    if (Math.abs(amt - plan) < 1 && (!planDay || Math.abs(day - planDay) < 2)) return [];
    const lo = Math.min.apply(null, days);
    const hi = Math.max.apply(null, days);
    const last = lines[lines.length - 1].date;
    return [{ key: 'wages', kind: 'wages', ref: { c: 'incomeSources', id: src.id },
      title: 'Your pay from ' + co + ' lately lands around the ' + ordinal(lo) + (hi !== lo ? '–' + ordinal(hi) : '') + ', about ' + money(amt, { whole: true }) +
        '. The plan uses ' + money(plan, { whole: true }) + (planDay ? ' on the ' + ordinal(planDay) : '') + '.',
      detail: 'From your last ' + plural(lines.length, 'payment') + '. Updating moves your next pay day in Money ahead.',
      options: [suggest(opt('update', 'Update', (st, tr) => {
        const x = findIn(st, 'incomeSources', src.id);
        if (!x) return;
        const t = today();
        let next = t.slice(0, 8) + String(Math.min(day, daysInMonth(+t.slice(0, 4), +t.slice(5, 7)))).padStart(2, '0');
        if (next < t || next <= addDays(last, 20)) next = addMonths(next, 1, day);
        tr.set('incomeSources', x, 'amount', amt);
        tr.set('incomeSources', x, 'anchorDay', day);
        tr.set('incomeSources', x, 'nextDate', next);
      })), opt('keep', 'Keep')] }];
  }

  const MAKERS = [qMerge, qDupes, qForeign, qSentBack, qRepaid, qUnmatched, qMaybeWork, qIdeas, qTasks, qWages];
  let qCache = null;
  /* The questions still open: [{key, kind, title, detail, options:[{id, label, suggested, apply(st, tr)}], items?}].
     A question with items (several things to decide, each one tap) has items [{key, label, detail, options}];
     answering the question's own key answers every item still open. Worked out again only when something changes. */
  function questions(s) {
    s = s || store.state;
    const m = metaOf(s);
    if (!s || !m || m.skipped || m.undone || !wm()) return [];
    const key = (store.rev || 0) + '|' + today();
    if (qCache && qCache.key === key && qCache.s === s) return qCache.out;
    const done = m.done || {};
    const f = factsOf(s);
    const out = [];
    for (const make of MAKERS) {
      let list = [];
      try {
        list = make(f) || [];
      } catch (err) {
        if (window.console) console.warn('Re-sort question failed', make.name, err);
      }
      for (const q of list) {
        if (has(done, q.key)) continue;
        if (q.items) {
          q.items = q.items.filter((it) => !has(done, it.key));
          if (!q.items.length) continue;
        }
        out.push(q);
      }
    }
    qCache = { key, s, out };
    return out;
  }
  /* How many one-tap decisions are still open. */
  const count = (s) => questions(s).reduce((n, q) => n + (q.items ? q.items.length : 1), 0);

  /* The decisions a key stands for: an item, or a question (all its open items). */
  function targets(qs, key) {
    for (const q of qs) {
      if (q.key === key) return q.items ? q.items.map((it) => ({ key: it.key, opts: it.options, parent: q })) : [{ key: q.key, opts: q.options, parent: q }];
      for (const it of q.items || []) if (it.key === key) return [{ key: it.key, opts: it.options, parent: q }];
    }
    return [];
  }
  const pick = (opts, choice) => (typeof choice === 'number' ? opts[choice] : opts.find((o) => o.id === choice)) || null;
  /* Applies answers in one commit, logged with the re-sort so undo() covers them too. Returns an undo for just these. */
  function applyAnswers(list) {
    const batch = 'a' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
    let log = [];
    store.commit((st) => {
      const m = metaOf(st);
      if (!m) return;
      const tr = logger(st, [], batch);
      const done = Object.assign({}, m.done || {});
      for (const x of list) {
        if (has(done, x.key)) continue;
        if (typeof x.opt.apply === 'function') x.opt.apply(st, tr);
        done[x.key] = x.opt.id;
      }
      log = tr.log;
      st.meta[KEY] = Object.assign({}, m, { changes: (m.changes || []).concat(log), done });
    });
    qCache = null;
    const keys = list.map((x) => x.key);
    return () => {
      store.commit((st) => {
        const m = metaOf(st);
        if (!m || m.undone) return;
        revert(st, log);
        const done = Object.assign({}, m.done || {});
        keys.forEach((k) => delete done[k]);
        st.meta[KEY] = Object.assign({}, m, { changes: (m.changes || []).filter((e) => e.b !== batch), done });
      });
      qCache = null;
    };
  }
  /* Answers a question (or one of its items) with option i (its index or id). opts.quiet: no toast. */
  function answer(key, i, opts) {
    opts = opts || {};
    const list = targets(questions(store.state), key).map((x) => ({ key: x.key, opt: pick(x.opts, i), parent: x.parent })).filter((x) => x.opt);
    if (!list.length) return null;
    const undoIt = applyAnswers(list);
    const o = list[0].opt;
    if (!opts.quiet) toast(list.length > 1 ? 'Done: ' + plural(list.length, 'answer') : 'Done', { action: 'Undo', onAction: undoIt });
    if (o.go && GU.view && !opts.quiet) GU.view.go(o.go);
    return { answered: list.length, undo: undoIt };
  }
  /* Answers everything that has a suggestion, in one go. Things with no suggestion stay for you to decide. */
  function useSuggestions(opts) {
    opts = opts || {};
    const list = [];
    let left = 0;
    for (const q of questions(store.state)) {
      for (const x of q.items ? q.items : [q]) {
        const o = (x.options || []).find((y) => y.suggested);
        if (o) list.push({ key: x.key, opt: o });
        else left++;
      }
    }
    if (!list.length) return { answered: 0, left };
    const undoIt = applyAnswers(list);
    if (!opts.quiet) toast('Done: ' + plural(list.length, 'answer') + (left ? '. ' + left + ' left for you to decide' : ''), { action: 'Undo', onAction: undoIt });
    return { answered: list.length, left, undo: undoIt };
  }

  /* ---------- the 'Check these' card ---------- */
  /* The open questions as a card, one tap each, the suggestions highlighted ('' when there's nothing to ask).
     A question with several things to decide gets a heading row, then one row per thing. */
  function cardHTML(s) {
    s = s || store.state;
    const qs = questions(s);
    if (!qs.length) return '';
    const icon = GU.ui.icon;
    const btns = (key, opts) => '<div class="ask-card__opts">' + opts.map((o) => '<button type="button" class="btn btn--sm' + (o.suggested ? ' is-suggested' : '') +
      '" data-refile-key="' + esc(key) + '" data-refile-opt="' + esc(o.id) + '"' + (o.hint ? ' title="' + esc(o.hint) + '"' : '') + '>' + esc(o.label) + '</button>').join('') + '</div>';
    const q = (title, detail) => '<div class="ask-card__q"><b>' + esc(title) + '</b>' + (detail ? '<em>' + esc(detail) + '</em>' : '') + '</div>';
    const n = count(s);
    const anySuggested = qs.some((x) => (x.items || [x]).some((y) => (y.options || []).some((o) => o.suggested)));
    const rows = qs.map((x) => (x.items
      ? '<li class="ask-card__item rf-group">' + q(x.title, x.detail) + '</li>' + x.items.map((it) => '<li class="ask-card__item rf-sub">' + q(it.label, it.detail) + btns(it.key, it.options) + '</li>').join('')
      : '<li class="ask-card__item">' + q(x.title, x.detail) + btns(x.key, x.options) + '</li>')).join('');
    return '<section class="ask-card rf-card" aria-label="Check these">' +
      '<header class="ask-card__head"><h2>' + icon('check') + 'Check these</h2>' +
      (anySuggested ? '<button type="button" class="btn btn--sm" data-refile-all>' + icon('spark') + 'Use my suggestions</button>' : '') +
      '<p>' + esc(plural(n, 'thing') + ' I wasn’t sure about when I sorted Home and Work. One tap each' + (anySuggested ? '; my suggestions are marked.' : '.')) + '</p></header>' +
      '<ul class="ask-card__list">' + rows + '</ul>' +
      (canUndo(s) ? '<footer class="ask-card__foot"><span>Every change I made can be undone for 30 days.</span><button type="button" class="link link--btn" data-refile-undo>Undo the re-sort</button></footer>' : '') +
      '</section>';
  }
  document.addEventListener('click', (ev) => {
    const t = ev.target;
    if (!t || !t.closest) return;
    const b = t.closest('[data-refile-key]');
    if (b) {
      ev.preventDefault();
      answer(b.getAttribute('data-refile-key'), b.getAttribute('data-refile-opt'));
      return;
    }
    if (t.closest('[data-refile-all]')) {
      ev.preventDefault();
      useSuggestions();
      return;
    }
    if (t.closest('[data-refile-undo]')) {
      ev.preventDefault();
      if (!canUndo()) return;
      const go = () => undo();
      if (GU.ui && GU.ui.confirmBox) GU.ui.confirmBox({ title: 'Undo the Home/Work re-sort?', message: 'Everything it changed goes back as it was, including your answers.', confirmLabel: 'Undo it', danger: true }).then((yes) => yes && go());
      else go();
    }
  });

  GU.refile = { run, undo, canUndo, info, questions, count, answer, useSuggestions, learnRepayDays, cardHTML };
})();
