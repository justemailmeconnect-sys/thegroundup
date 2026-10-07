/* The Ground Up: Work › To buy. Things the business you work for has asked you to get, noted down before you've
   bought them: to order, on its way, bought. It is also the cost calculator for work: each thing has how many and
   a price each, the page adds them up ('What it will cost'), and the rows show the working (2 × £12.00 = £24.00).
   Buying one opens the receipt form (or links a receipt you already filed), so it lands in Get paid back by
   itself. Every change has Undo. Ideas made on the old Cost forecast page can be added here (they are never lost).
   The business's name comes from Settings, never from here. */
(function () {
  'use strict';
  const GU = window.GU;
  const { esc, uid, today, addDays, daysUntil, fmtDate, relDays, money, plural, sum, round2, isISO } = GU.util;
  const { icon, pill, formDialog, openDialog, toast, menu } = GU.ui;
  const store = GU.store;

  const SOON = 3; // days before it's needed when it turns amber
  const TAB = 'work-requests';
  // Which lanes are open: kept for this visit only.
  const ui = { boughtOpen: false, droppedOpen: false, ideasOpen: false, pricing: null, draft: '' };

  /* ---------- small helpers ---------- */
  const parts = () => GU.parts || null;
  const wm = () => GU.workMoney || null;
  /* The business's short name ('the company' with none set); cap for the start of a sentence. */
  const co = (cap) => (parts() ? parts().co(store.state, cap) : cap ? 'The company' : 'the company');
  const coName = () => (wm() && parts() && wm().employer(store.state).set ? parts().coName(store.state) : '');
  const short = (iso) => fmtDate(iso, { short: true });
  const clip = (t, n) => {
    t = String(t == null ? '' : t).replace(/\s+/g, ' ').trim();
    return t.length > n ? t.slice(0, n - 1).trim() + '…' : t;
  };
  const dateOf = (v) => (isISO(v) ? v : '');
  const list = (s) => ((s || store.state).requests || []).filter((r) => r && r.id);
  const find = (id) => list().find((r) => r.id === id) || null;
  /* 'asked' (to order), 'ordered' (on its way), 'bought' or 'dropped' (not needed): anything else counts as asked. */
  const stateOf = (r) => (['ordered', 'bought', 'dropped'].includes(r.status) ? r.status : 'asked');
  const isOpen = (r) => stateOf(r) === 'asked' || stateOf(r) === 'ordered';
  const est = (r) => (Number(r.estimate) > 0 ? round2(Number(r.estimate)) : 0);
  const qtyOf = (r) => (Number(r.qty) > 1 ? Math.round(Number(r.qty)) : 1);
  const payerOf = (r) => (r.payer === 'company' ? 'company' : 'me');
  const paperOf = (r) => (r.paperId ? (store.state.paperwork || []).find((p) => p.id === r.paperId) || null : null);

  /* ---------- the sums ---------- */
  /* The price is each; how many × the price each is the line. A thing saved before that (more than one, and no
     'priceEach' mark) had its estimate as the whole line, so it still counts as that rather than being multiplied. */
  const MAX_EACH = 1e6; // the most one of anything can cost here
  const MAX_QTY = 999;
  const wholeLine = (r) => qtyOf(r) > 1 && est(r) > 0 && r.priceEach !== true;
  /* The price of one: 0 when there's no price yet. */
  const unitOf = (r) => (wholeLine(r) ? round2(est(r) / qtyOf(r)) : est(r));
  /* What the line comes to (how many × each): 0 when there's no price yet. */
  const lineTotal = (r) => (wholeLine(r) ? est(r) : round2(est(r) * qtyOf(r)));
  /* Can the line be shown as 'n × £each = £line'? (Not when an older whole-line price doesn't divide to the penny.) */
  const showsWorking = (r) => qtyOf(r) > 1 && lineTotal(r) > 0 && round2(unitOf(r) * qtyOf(r)) === lineTotal(r);
  /* What was paid: the receipt's amount when there is one, otherwise the line. */
  const spent = (r) => {
    const p = paperOf(r);
    const a = p ? Math.abs(Number(p.amount) || 0) : 0;
    return a > 0 ? a : lineTotal(r);
  };
  /* A price typed or pasted: {value} (null when there isn't one), or {error} in words. Negative, silly-big and not-a-number are refused. */
  function readPrice(raw) {
    if (raw == null || (typeof raw === 'string' && !raw.trim())) return { value: null };
    // Typed text must be an amount and nothing else (so '1e12' or '12 apples' is refused, not read as some other number).
    const text = typeof raw === 'number' ? '' : String(raw).replace(/[£$€\s]/g, '');
    const n = typeof raw === 'number' ? raw : /^[-−(]?(?:\d|\.\d)[\d.,]*\)?$/.test(text) ? GU.util.parseAmount(text) : NaN;
    if (!Number.isFinite(n)) return { error: 'That doesn’t look like a price. Try something like 12.50.' };
    if (n < 0) return { error: 'A price can’t be less than nothing.' };
    if (n >= MAX_EACH) return { error: 'That price looks far too big. Check the figure.' };
    return { value: n > 0 ? round2(n) : null };
  }
  /* How many, as a whole number from 1 to 999 (a number or text like '3'; nothing means 1), or {error}. */
  function readQty(raw) {
    if (raw == null || (typeof raw === 'string' && !raw.trim())) return { value: 1 };
    const n = typeof raw === 'number' ? raw : Number(String(raw).trim());
    if (!Number.isFinite(n) || n !== Math.round(n)) return { error: 'How many has to be a whole number, like 3.' };
    if (n < 1 || n > MAX_QTY) return { error: 'How many has to be between 1 and ' + MAX_QTY + '.' };
    return { value: n };
  }
  /* The first thing wrong with a thing's price or how many, in words, or '' when it's fine. */
  function problem(f) {
    return readPrice(f.estimate).error || readQty(f.qty).error || '';
  }
  /* '£35.00', or '3 × £12.00 = £36.00'. */
  const workingText = (r) => (showsWorking(r) ? qtyOf(r) + ' × ' + money(unitOf(r)) + ' = ' + money(lineTotal(r)) : money(lineTotal(r)));

  /* The forecast: what everything still to get (to order and on its way) comes to. Only things with a price are
     added up; the others are counted apart, never as £0. 'Needed within 7 days' includes anything already late.
     o.today: pretend it's another day. */
  function forecast(s, o) {
    const t = (o && o.today) || today();
    const week = addDays(t, 7);
    const all = list(s);
    const open = all.filter(isOpen);
    const priced = open.filter((r) => lineTotal(r) > 0);
    const of = (rows) => sum(rows, lineTotal);
    const me = priced.filter((r) => payerOf(r) === 'me');
    const them = priced.filter((r) => payerOf(r) === 'company');
    const soon = priced.filter((r) => dateOf(r.needBy) && r.needBy <= week);
    const bought = all.filter((r) => stateOf(r) === 'bought' && (r.boughtDate || r.created || '').slice(0, 7) === t.slice(0, 7));
    return {
      open: open.length, count: priced.length, unpriced: open.length - priced.length, total: of(priced),
      me: of(me), meCount: me.length, company: of(them), companyCount: them.length, soon: of(soon), soonCount: soon.length,
      bought: round2(sum(bought, spent)), boughtCount: bought.length,
    };
  }
  /* Earliest needed-by first, then the ones with no date, each in the order they were noted. */
  const byNeed = (a, b) => (dateOf(a.needBy) || '9999').localeCompare(dateOf(b.needBy) || '9999') || (a.created || '').localeCompare(b.created || '') || String(a.id).localeCompare(String(b.id));
  const escRe = (t) => String(t).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const badLink = () => {
    toast('That doesn’t look like a web link. Paste the whole address, starting with https://');
    return false;
  };

  /* ---------- links ---------- */
  /* A web address you can open: http or https only, with https:// added when it's missing. '' when it isn't one. */
  function cleanLink(raw) {
    let t = String(raw == null ? '' : raw).trim();
    if (!t || /\s/.test(t) || t.length > 2000) return '';
    if (!/^https?:\/\//i.test(t)) {
      if (/^[a-z][a-z0-9+.-]*:/i.test(t)) return ''; // javascript:, mailto: and the like
      if (!/^[^\s/?#]+\.[a-z]{2,}(?:[/?#:].*)?$/i.test(t)) return '';
      t = 'https://' + t;
    }
    try {
      const u = new URL(t);
      return /^https?:$/.test(u.protocol) && u.hostname.includes('.') ? u.href : '';
    } catch (e) {
      return '';
    }
  }
  const hostOf = (link) => {
    try {
      return new URL(link).hostname.replace(/^www\./, '');
    } catch (e) {
      return '';
    }
  };
  /* A guess at what a product link is called: the most readable bit of its address
     ('/hp-305a-black-toner/dp/B0…' gives 'Hp 305a black toner'). '' when it says nothing. */
  function titleFromLink(link) {
    let u;
    try {
      u = new URL(link);
    } catch (e) {
      return '';
    }
    const decode = (x) => {
      try {
        return decodeURIComponent(x);
      } catch (e) {
        return x;
      }
    };
    const words = (x) => x.split(/[-_+\s]+/).filter((w) => /[a-z]/i.test(w) && !/^(?=[a-z]*\d)(?=\d*[a-z])[a-z0-9]{9,}$/i.test(w));
    const best = u.pathname.split('/').map((x) => decode(x).replace(/\.(html?|php|aspx?)$/i, '')).filter((x) => !/^(dp|gp|product|products|p|item|ip|prd|buy|shop|search|www)$/i.test(x))
      .map((x) => ({ x, w: words(x) })).filter((o) => o.w.length >= 2).sort((a, b) => b.w.length - a.w.length)[0];
    if (!best) return '';
    const t = clip(best.w.join(' '), 80);
    return t.charAt(0).toUpperCase() + t.slice(1);
  }

  /* ---------- reading what you type ---------- */
  /* 'Printer toner, about £35, by Friday' → {title, estimate, qty, needBy, link, payer}. Understands a price (£35,
     about £35, 35 quid), a quantity (3x toner, toner x3), a date (by Friday, tomorrow, 12 Oct), a link, and 'on the
     company card' for the business's money. The price is for one ('3x gloves £12' is £12 each, £36 in all); say
     'in total' after it ('3x gloves £36 in total') and it's shared out between them. estimate is the price each.
     title is '' when there's nothing to go on. */
  function parseLine(raw) {
    let t = String(raw == null ? '' : raw).replace(/^[\s\-–—•*·>]+|^\d{1,2}[.)]\s+/, '').replace(/\s+/g, ' ').trim();
    const out = { title: '', estimate: null, qty: 1, needBy: '', link: '', payer: 'me' };
    t = t.replace(/\b(?:https?:\/\/|www\.)[^\s<>"']+/i, (m) => {
      out.link = cleanLink(m.replace(/[)\].,;:!?]+$/, ''));
      return ' ';
    });
    // The business's money: 'on the company card', 'Acme pays'.
    const names = ['company'].concat(wm() && wm().employer(store.state).short ? [wm().employer(store.state).short] : []).map(escRe).join('|');
    const who = new RegExp('\\b(?:(?:on|with|using|charge(?:d)? to|put (?:it )?on)\\s+(?:the\\s+)?(?:' + names + ')(?:\'s|’s)?\\s+(?:card|account|money|tab)|(?:' + names + ')\\s+(?:is\\s+)?(?:pays|paying|will\\s+pay|to\\s+pay))\\b', 'i');
    // Or on its own after a comma ('gloves, company card').
    const whoAlone = new RegExp('(?:^|,)\\s*(?:the\\s+)?(?:' + names + ')(?:\'s|’s)?\\s+(?:card|account)\\s*(?=,|$)', 'i');
    if (who.test(t) || whoAlone.test(t)) {
      out.payer = 'company';
      t = t.replace(who, ' ').replace(whoAlone, ' ');
    }
    // How many.
    let q = t.match(/^(\d{1,3})\s*(?:x(?=\s)|×)\s*/i) || t.match(/\b(\d{1,3})\s*(?:x(?=\s)|×)\s+/i) || t.match(/\s(?:x|×)\s?(\d{1,3})\b/i);
    if (q) {
      out.qty = Math.max(1, +q[1]);
      t = t.replace(q[0], ' ');
    }
    // The price: for one, unless it says 'in total' (shared out between how many).
    const am = /(?:\b(?:about|around|roughly|approx(?:imately)?\.?|circa|maybe|up to|under|max)\s*)?(?:£|€|\$)\s?(\d[\d,]*(?:\.\d{1,2})?)|(?:\b(?:about|around|roughly|approx(?:imately)?)\s+)?\b(\d[\d,]*(?:\.\d{1,2})?)\s?(?:quid|pounds?|gbp)\b/i.exec(t);
    if (am) {
      let value = parseFloat((am[1] || am[2]).replace(/,/g, ''));
      let rest = t.slice(am.index + am[0].length);
      const each = rest.match(/^\s*(?:each|apiece|a piece|per (?:item|one|box|pack|roll|bottle))\b/i);
      const all = rest.match(/^\s*(?:in total|in all|altogether|all together|for all|for both|for the lot|total)\b/i);
      if (each) rest = rest.slice(each[0].length);
      else if (all) {
        rest = rest.slice(all[0].length);
        value /= out.qty;
      }
      if (Number.isFinite(value) && value > 0 && value < MAX_EACH) out.estimate = round2(value);
      t = t.slice(0, am.index) + ' ' + rest;
    }
    // The date, by the same reader as to-dos.
    const when = GU.tabs.today && GU.tabs.today.parseQuickTask ? GU.tabs.today.parseQuickTask(t) : { title: t, due: '' };
    out.needBy = when.due || '';
    let title = when.title.replace(/\s+/g, ' ');
    const lead = title.replace(/^(?:please\s+)?(?:get|buy|grab|need|needs|want|wants)\s+(?:me\s+)?(?:to\s+(?:get|buy|order)\s+)?(?:(?:a|an|some|the)\s+)?(?=\S)/i, '');
    if (lead.length >= 2) title = lead;
    title = title.replace(/(?:[\s,;:–—-]+(?:and|or|for|at|by|on|about|around|roughly|approx|circa|maybe|up to|under|max|is|are|costs?|costing))+[\s,;:.–—-]*$/i, '')
      .replace(/^[\s,;:.–—-]+|[\s,;:.–—-]+$/g, '');
    title = clip(title.replace(/\s+,/g, ',').replace(/,(?:\s*,)+/g, ','), 120);
    if (!title && out.link) title = titleFromLink(out.link) || 'Item from ' + hostOf(out.link);
    out.title = title.charAt(0).toUpperCase() + title.slice(1);
    return out;
  }

  /* ---------- making and changing ---------- */
  /* A request record from form values (or anything with the same names), tidied. estimate is the price of one;
     a price or number that can't be used is left out (problem() says so first, where someone is typing it). */
  function build(f) {
    const price = readPrice(f.estimate);
    const q = readQty(f.qty);
    return {
      id: f.id || 'rq-' + uid(),
      title: String(f.title || '').replace(/\s+/g, ' ').trim().slice(0, 160),
      note: String(f.note || '').trim().slice(0, 2000),
      link: cleanLink(f.link),
      estimate: price.value == null ? null : price.value,
      priceEach: true,
      qty: q.value > 1 ? q.value : 1,
      askedDate: dateOf(f.askedDate) || today(),
      needBy: dateOf(f.needBy),
      payer: f.payer === 'company' ? 'company' : 'me',
      status: 'asked',
      orderedDate: '',
      boughtDate: '',
      paperId: '',
      created: today(),
    };
  }
  /* Adds things. Returns {rec, recs, undo}: undo takes them out again. Throws when there's no title. */
  function addAll(fs) {
    const bad = fs.map(problem).find(Boolean);
    if (bad) throw new Error(bad);
    const recs = fs.map(build);
    if (!recs.length || recs.some((r) => !r.title)) throw new Error('A title is needed');
    const ids = new Set(recs.map((r) => r.id));
    store.commit((s) => {
      s.requests = s.requests || [];
      s.requests.push(...recs);
    });
    return {
      rec: recs[0],
      recs,
      undo() {
        store.commit((s) => (s.requests = (s.requests || []).filter((x) => !ids.has(x.id))));
        return true;
      },
    };
  }
  const add = (f) => addAll([f]);

  const snap = (id) => {
    const r = find(id);
    return r ? JSON.parse(JSON.stringify(r)) : null;
  };
  /* Puts a request back as it was (or back at all, if it was deleted). */
  function restore(before) {
    store.commit((s) => {
      s.requests = s.requests || [];
      const i = s.requests.findIndex((x) => x.id === before.id);
      if (i >= 0) s.requests[i] = before;
      else s.requests.push(before);
    });
  }
  /* Changes one request and offers Undo. */
  function change(id, mutate, message) {
    const before = snap(id);
    if (!before) return false;
    store.commit((s) => {
      const r = (s.requests || []).find((x) => x.id === id);
      if (r) mutate(r);
    });
    toast(message, { action: 'Undo', onAction: () => restore(before) });
    return true;
  }
  const what = (r) => '“' + clip(r.title, 40) + '”';
  /* 'Printer toner' (about £35.00, needed Fri 9 Oct) for toasts. */
  const describe = (r) => what(r) + (lineTotal(r) || r.needBy ? ' (' + [lineTotal(r) ? (showsWorking(r) ? workingText(r) : 'about ' + money(lineTotal(r))) : '', r.needBy ? 'needed ' + fmtDate(r.needBy, { weekday: true }) : ''].filter(Boolean).join(', ') + ')' : '');

  function markOrdered(id) {
    const r = find(id);
    if (!r || stateOf(r) !== 'asked') return;
    change(id, (x) => {
      x.status = 'ordered';
      x.orderedDate = today();
    }, 'Marked ' + what(r) + ' as ordered');
  }
  function backToOrder(id) {
    const r = find(id);
    if (!r) return;
    change(id, (x) => {
      x.status = 'asked';
      x.orderedDate = '';
    }, 'Put ' + what(r) + ' back in To order');
  }
  function notNeeded(id) {
    const r = find(id);
    if (!r) return;
    change(id, (x) => {
      x.status = 'dropped';
    }, 'Marked ' + what(r) + ' as not needed');
  }
  function remove(id) {
    const r = find(id);
    if (r) store.remove('requests', id, clip(r.title, 60));
  }

  /* ---------- marking one bought ---------- */
  const WORDS_STOP = new Set(['the', 'and', 'for', 'with', 'from', 'this', 'that', 'some', 'pack', 'box', 'set']);
  const wordsOf = (t) => new Set(String(t || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(' ').filter((w) => w.length >= 4 && !WORDS_STOP.has(w)));
  /* Work receipts you've already filed, from the last two weeks, that look like this one: the same lane (yours to
     get back, or the business's own), not made by a monthly work bill, not linked to another request, and about the amount (or sharing a word
     when there's no estimate). Closest first, at most three. */
  function candidates(r) {
    const W = wm();
    if (!W) return [];
    const taken = new Set(list().map((x) => x.paperId).filter(Boolean));
    const t = today();
    const since = addDays(t, -14);
    const want = payerOf(r) === 'company' ? 'ktk' : 'back';
    const e = lineTotal(r);
    const mine = wordsOf(r.title);
    const out = [];
    for (const p of store.state.paperwork || []) {
      if (p.context !== 'work' || p.kind === 'warranty' || p.kind === 'invoice-out' || p.billId || taken.has(p.id)) continue;
      if (W.lane(p, 'paperwork') !== want) continue;
      const when = p.date || p.created || '';
      if (when < since || when > t) continue;
      const a = Math.abs(Number(p.amount) || 0);
      if (!a) continue;
      const same = Array.from(wordsOf((p.title || '') + ' ' + (p.party || ''))).some((w) => mine.has(w));
      let score = null;
      if (e) {
        if (Math.abs(a - e) <= Math.max(2, e * 0.2)) score = Math.abs(a - e);
        else if (same && Math.abs(a - e) <= e * 0.5) score = 10 + Math.abs(a - e);
      } else if (same) score = 5;
      if (score != null) out.push({ p, score, when });
    }
    return out.sort((a, b) => a.score - b.score || b.when.localeCompare(a.when)).slice(0, 3).map((x) => x.p);
  }
  /* 'Is this it?': resolves with the receipt picked, 'new' for 'No, add one', or null when it's closed. */
  function askIsThisIt(r, found) {
    return new Promise((resolve) => {
      let answer = null;
      const rows = found.map((p) => '<li><span><b>' + esc(p.title || p.party || 'Receipt') + '</b><em>' +
        esc([p.party && p.party !== p.title ? p.party : '', short(p.date || p.created), money(Math.abs(Number(p.amount) || 0))].filter(Boolean).join(' · ')) + '</em></span>' +
        '<button type="button" class="btn btn--sm btn--primary" data-yes="' + esc(p.id) + '">Yes, that’s it</button></li>').join('');
      const d = openDialog({
        title: 'Is this it?',
        body: '<p class="dlg__text">' + esc(found.length === 1 ? 'You filed this receipt in the last two weeks. Is it for ' + what(r) + '?' : 'You filed these receipts in the last two weeks. Is one of them for ' + what(r) + '?') + '</p>' +
          '<ul class="rq-found">' + rows + '</ul>',
        footer: '<span class="spacer"></span><button type="button" class="btn" data-new>No, add one</button>',
        onClose: () => resolve(answer),
      });
      d.body.addEventListener('click', (e) => {
        const y = e.target.closest('[data-yes]');
        if (!y) return;
        answer = found.find((p) => p.id === y.dataset.yes) || null;
        d.close();
      });
      d.el.querySelector('[data-new]').addEventListener('click', () => {
        answer = 'new';
        d.close();
      });
    });
  }
  function linkReceipt(id, p) {
    const r = find(id);
    if (!r) return;
    change(id, (x) => {
      x.status = 'bought';
      x.boughtDate = stateOf(x) === 'bought' && x.boughtDate ? x.boughtDate : today();
      x.paperId = p.id;
    }, 'Marked ' + what(r) + ' as bought, with that receipt');
  }
  /* Opens the receipt form for this request (yours to get back, or the business's own); on saving it, the request
     is bought and holds the receipt. */
  function receiptForm(id) {
    const r = find(id);
    const T = GU.tabs.receipts;
    if (!r) return null;
    if (!T || typeof T.create !== 'function') {
      toast('The receipt form isn’t available right now.');
      return null;
    }
    const values = { context: 'work', payer: payerOf(r), kind: 'receipt', title: r.title, date: today() };
    if (lineTotal(r)) values.amount = lineTotal(r);
    if (r.note) values.notes = clip(r.note, 300);
    return T.create({
      values,
      onSaved: (rec) => {
        if (rec && rec.id) {
          change(id, (x) => {
            x.status = 'bought';
            x.boughtDate = stateOf(x) === 'bought' && x.boughtDate ? x.boughtDate : today();
            x.paperId = rec.id;
          }, 'Marked ' + what(r) + ' as bought');
        }
      },
    });
  }
  async function markBought(id) {
    const r = find(id);
    // Open things, and bought ones whose receipt has gone (to add it again).
    if (!r || !(isOpen(r) || (stateOf(r) === 'bought' && !paperOf(r)))) return;
    const found = candidates(r);
    if (found.length) {
      const pick = await askIsThisIt(r, found);
      if (!pick) return;
      if (pick !== 'new') return linkReceipt(id, pick);
    }
    receiptForm(id);
  }
  function viewReceipt(id) {
    const r = find(id);
    const p = r && paperOf(r);
    if (!p) return toast('That receipt isn’t here any more.');
    if ((p.files || []).length) GU.ui.viewFiles(p.files, 0, p.title);
    else if (GU.tabs.receipts && GU.tabs.receipts.edit) GU.tabs.receipts.edit(p.id);
  }

  /* ---------- the forms ---------- */
  function fields(o) {
    o = o || {};
    const f = [
      { name: 'link', label: 'Link', optional: true, placeholder: 'Paste a link to it', help: 'I’ll fill in the name for you if you leave it blank.' },
      { name: 'title', label: 'What is it?', required: true, placeholder: 'e.g. Printer toner' },
      { name: 'estimate', label: 'About how much each?', type: 'money', half: true, optional: true, help: 'The price of one. Leave it empty if you don’t know yet.' },
      { name: 'qty', label: 'How many?', type: 'number', half: true, optional: true, help: '<span class="rq-formtotal" data-rq-formtotal></span>' },
      { name: 'needBy', label: 'Needed by', type: 'date', half: true, optional: true },
      { name: 'askedDate', label: 'Asked on', type: 'date', half: true, optional: true },
      { name: 'payer', label: 'Whose money?', type: 'segmented', default: 'me', options: [{ value: 'me', label: 'Mine, get it back' }, { value: 'company', label: co(true) + '’s money' }],
        help: 'Yours means it comes out of your own account, card or cash.' },
    ];
    if (o.where) {
      f.push({ name: 'where', label: 'Where is it?', type: 'segmented', default: 'asked', options: [{ value: 'asked', label: 'To order' }, { value: 'ordered', label: 'On its way' }, { value: 'dropped', label: 'Not needed' }] });
    }
    f.push({ name: 'note', label: 'Notes', type: 'textarea', rows: 2, optional: true });
    return f;
  }
  /* Under 'How many?': what the line comes to, as you type ('3 × £12.00 = £36.00'). */
  function wireTotal(d) {
    const el = d.form.querySelector('[data-rq-formtotal]');
    const e = d.form.elements.estimate;
    const q = d.form.elements.qty;
    if (!el || !e || !q) return;
    const show = () => {
      const p = readPrice(e.value);
      const n = readQty(q.value);
      if (p.error || n.error || !p.value) {
        el.textContent = '';
        return;
      }
      el.textContent = (n.value > 1 ? n.value + ' × ' + money(p.value) + ' = ' : 'That’s ') + money(round2(p.value * n.value));
    };
    d.form.addEventListener('input', show);
    show();
  }
  /* Says what's wrong with the price or number in a form, and keeps it open (the money box turns a minus into a plus, so the typed text is checked). */
  function formProblem(d, v) {
    const raw = d.form.elements.estimate ? d.form.elements.estimate.value : '';
    const msg = problem(Object.assign({}, v, { estimate: raw }));
    if (msg) toast(msg);
    return !!msg;
  }
  /* Pasting a link fills in the name when it's blank. */
  function wireLink(d) {
    const linkEl = d.form.querySelector('[name="link"]');
    const titleEl = d.form.querySelector('[name="title"]');
    if (!linkEl || !titleEl) return;
    const guess = () => {
      const l = cleanLink(linkEl.value);
      if (l) linkEl.value = l;
      if (titleEl.value.trim() || !l) return;
      const g = titleFromLink(l);
      if (g) titleEl.value = g;
    };
    linkEl.addEventListener('change', guess);
    linkEl.addEventListener('paste', () => setTimeout(guess, 0));
  }

  /* The form for something new. prefill: values to start with; opts.onSaved(rec): called after it's added. */
  function create(prefill, opts) {
    opts = opts || {};
    const d = formDialog({
      title: 'Something ' + co() + ' wants me to get',
      intro: esc('Note down what ' + co() + ' asked you to get. When you’ve bought it, add the receipt and it goes to Get paid back.'),
      fields: fields(),
      values: Object.assign({ payer: 'me', askedDate: today(), qty: 1 }, prefill || {}),
      submitLabel: 'Add it',
      onSubmit: (v) => {
        if (v.link && !cleanLink(v.link)) return badLink();
        if (formProblem(d, v)) return false;
        const res = add(v);
        toast('Added ' + describe(res.rec) + ' to Work › To buy', { action: 'Undo', onAction: res.undo });
        if (opts.onSaved) opts.onSaved(res.rec);
      },
    });
    wireLink(d);
    wireTotal(d);
    return d;
  }

  function edit(id) {
    const r = find(id);
    if (!r) return;
    const st = stateOf(r);
    const d = formDialog({
      title: 'Edit',
      fields: fields({ where: st !== 'bought' }),
      values: Object.assign({}, r, { where: st, estimate: unitOf(r) || null, qty: qtyOf(r) }),
      onSubmit: (v) => {
        if (v.link && !cleanLink(v.link)) return badLink();
        if (formProblem(d, v)) return false;
        const t = build(v);
        if (!t.title) return false;
        change(id, (x) => {
          for (const k of ['title', 'note', 'link', 'estimate', 'priceEach', 'qty', 'askedDate', 'needBy', 'payer']) x[k] = t[k];
          if (v.where && v.where !== st && ['asked', 'ordered', 'dropped'].includes(v.where)) {
            x.status = v.where;
            x.orderedDate = v.where === 'ordered' ? x.orderedDate || today() : '';
          }
        }, 'Saved ' + what(t));
      },
      onDelete: () => remove(id),
    });
    wireLink(d);
    wireTotal(d);
  }

  /* Several lines at once, one thing on each. */
  function addMany() {
    const lines = (text) => String(text || '').split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
    const d = formDialog({
      title: 'Add several things',
      intro: esc('One thing on each line. Say what it is, about how much and by when, like “Printer toner, about £35, by Friday”.'),
      fields: [
        { name: 'lines', label: 'The list', type: 'textarea', rows: 7, required: true, placeholder: 'Printer toner, about £35, by Friday\nBox of nitrile gloves, £12\nFire safety signs, about £28, by 20 Oct', help: '<span class="rq-count" data-rq-count>Nothing on the list yet.</span>' },
        { name: 'payer', label: 'Whose money?', type: 'segmented', default: 'me', options: [{ value: 'me', label: 'Mine, get it back' }, { value: 'company', label: co(true) + '’s money' }] },
      ],
      submitLabel: 'Add them',
      onSubmit: (v) => {
        const items = lines(v.lines).map(parseLine).filter((x) => x.title);
        if (!items.length) {
          toast('I couldn’t find anything to add. Put one thing on each line.');
          return false;
        }
        const res = addAll(items.map((x) => Object.assign({}, x, { payer: v.payer === 'company' ? 'company' : x.payer, askedDate: today() })));
        toast('Added ' + plural(res.recs.length, 'thing') + ' to Work › To buy', { action: 'Undo', onAction: res.undo });
      },
    });
    const box = d.form.querySelector('[name="lines"]');
    const count = d.form.querySelector('[data-rq-count]');
    box.addEventListener('input', () => {
      const n = lines(box.value).map(parseLine).filter((x) => x.title).length;
      count.textContent = n ? plural(n, 'thing') + ' on the list.' : 'Nothing on the list yet.';
    });
    return d;
  }

  /* ---------- download ---------- */
  const BOM = String.fromCharCode(0xfeff); // so spreadsheet apps read it as UTF-8 (the £ sign)
  function csvCell(v) {
    let t = String(v == null ? '' : v);
    if (/^[=+\-@\t\r]/.test(t)) t = "'" + t; // text a spreadsheet would run as a formula is kept as text
    return /[",\n\r]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t;
  }
  /* The rows of the open list (to order and on its way): how many, each, the line, and a total row last. */
  function csvRows(s) {
    const open = list(s).filter(isOpen).sort((a, b) => (stateOf(a) === stateOf(b) ? byNeed(a, b) : stateOf(a) === 'asked' ? -1 : 1));
    const f = forecast(s);
    const rows = [['Thing', 'How many', 'Each', 'Line total', 'Needed by', 'Asked on', 'Where it is', 'Whose money', 'Link', 'Notes']]
      .concat(open.map((r) => [r.title, qtyOf(r), unitOf(r) ? unitOf(r).toFixed(2) : '', lineTotal(r) ? lineTotal(r).toFixed(2) : '', r.needBy || '', r.askedDate || '',
        stateOf(r) === 'ordered' ? 'On its way' + (r.orderedDate ? ' (ordered ' + r.orderedDate + ')' : '') : 'To order',
        payerOf(r) === 'company' ? co(true) + '’s money' : 'Mine, get it back', cleanLink(r.link), r.note || '']))
      .concat([['Total (' + plural(open.length, 'thing') + (f.unpriced ? ', ' + f.unpriced + ' with no price yet' : '') + ')', '', '', f.total.toFixed(2), '', '', '', '', '', '']]);
    return { open, rows };
  }
  /* The open list as a spreadsheet. */
  async function download() {
    const { open, rows } = csvRows(store.state);
    if (!open.length) return toast('There’s nothing on the list to download yet.');
    const text = BOM + rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
    const ok = await GU.ui.saveFile(new Blob([text], { type: 'text/csv' }), 'things-to-get-' + today() + '.csv');
    if (ok) toast('Saved your list of ' + plural(open.length, 'thing') + '.');
  }

  /* ---------- what needs doing, and the Work timeline ---------- */
  /* Dates for the Work timeline: when each open thing is needed. */
  function dates(s, to) {
    const out = [];
    for (const r of list(s)) {
      if (!isOpen(r) || !dateOf(r.needBy) || r.needBy > to) continue;
      out.push({ date: r.needBy, title: (stateOf(r) === 'ordered' ? 'Due to arrive: ' : 'Get ') + r.title, meta: [lineTotal(r) ? 'About ' + money(lineTotal(r)) : '', 'To buy'].filter(Boolean).join(' · '), ref: { c: 'requests', id: r.id }, tab: TAB });
    }
    return out;
  }
  /* Work overview checks (same shape as GU.work.checks): what's still to order, and anything ordered that's late. */
  function checks(s) {
    const out = [];
    const L = list(s);
    const asked = L.filter((r) => stateOf(r) === 'asked').sort(byNeed);
    if (asked.length) {
      const days = (r) => (dateOf(r.needBy) ? daysUntil(r.needBy) : null);
      const late = asked.filter((r) => days(r) != null && days(r) < 0);
      const soon = asked.filter((r) => days(r) != null && days(r) >= 0 && days(r) <= SOON);
      const next = asked.find((r) => dateOf(r.needBy));
      const total = sum(asked, lineTotal);
      let detail;
      if (late.length) detail = late.length === 1 ? what(late[0]) + ' was needed ' + short(late[0].needBy) : late.length + ' are late, the first needed ' + short(late[0].needBy);
      else if (soon.length) detail = what(soon[0]) + ' is needed ' + (days(soon[0]) === 0 ? 'today' : relDays(soon[0].needBy)) + (soon.length > 1 ? ', and ' + (soon.length - 1) + ' more soon' : '');
      else detail = next ? 'Next needed ' + fmtDate(next.needBy, { weekday: true }) + (total ? ' · about ' + money(total) + ' in all' : '') : total ? 'About ' + money(total) + ' in all' : 'No dates yet';
      out.push({ level: late.length || soon.length ? 'warn' : 'info', area: 'requests', title: plural(asked.length, 'thing') + ' to order', detail, ref: null, go: TAB });
    }
    for (const r of L.filter((x) => stateOf(x) === 'ordered' && dateOf(x.needBy) && daysUntil(x.needBy) < 0).sort(byNeed).slice(0, 3)) {
      out.push({ level: 'warn', area: 'requests', title: what(r) + ' hasn’t arrived yet', detail: 'Was needed ' + short(r.needBy) + (r.orderedDate ? ' · ordered ' + short(r.orderedDate) : ''), ref: null, go: TAB });
    }
    return out;
  }
  /* The card on the Work overview, like the other areas'. */
  function cardHTML(s) {
    const L = list(s);
    const asked = L.filter((r) => stateOf(r) === 'asked').sort(byNeed);
    const ordered = L.filter((r) => stateOf(r) === 'ordered');
    const t = today();
    const hot = asked.some((r) => dateOf(r.needBy) && daysUntil(r.needBy, t) <= SOON);
    const next = asked.find((r) => dateOf(r.needBy));
    const total = forecast(s).total;
    // The figure (what everything still to get comes to) and one line: what's to order (and when the next is needed), or what's on its way.
    const line = asked.length
      ? plural(asked.length, 'thing') + ' to order' + (next ? ', next needed ' + short(next.needBy) : ordered.length ? ' · ' + ordered.length + ' on its way' : '')
      : ordered.length ? plural(ordered.length, 'thing') + ' on its way' : 'nothing to order right now';
    const o = { tab: TAB, ico: 'bag', label: 'To buy', big: money(total), unit: 'still to get', line, warn: hot, cls: hot ? 'is-warn' : '' };
    if (GU.work && GU.work.card) return GU.work.card(o);
    return '<button type="button" class="wk-card' + (hot ? ' is-warn' : '') + '" data-go="' + TAB + '"><span class="wk-card__head">' + icon('bag') + '<span>To buy</span>' + icon('chevron') + '</span>' +
      '<b class="' + o.cls + '">' + esc(o.big) + '</b><em>' + esc(o.unit) + '</em><span class="wk-card__line">' + esc(line) + '</span></button>';
  }

  /* ---------- ideas from the old Cost forecast ---------- */
  /* Ideas made on the old Cost forecast page (work ones, with no home mark) that are still open and haven't been moved here. */
  const isIdeaOpen = (i) => !!i && i.status !== 'done' && i.status !== 'dropped' && !i.movedToRequest;
  const isWorkIdea = (i) => !!i && (parts() && parts().ideaPart ? parts().ideaPart(i) === 'work' : i.context !== 'home');
  const oldIdeas = (s) => ((s || store.state).costIdeas || []).filter((i) => i && i.id && isIdeaOpen(i) && isWorkIdea(i))
    .sort((a, b) => (a.wantBy || '9999').localeCompare(b.wantBy || '9999') || (a.created || '').localeCompare(b.created || '') || String(a.id).localeCompare(String(b.id)));
  /* What goes in the note: 'Plus £10.00 a month.' and the idea's own notes. */
  const ideaNote = (i) => [Number(i.monthly) > 0 ? 'Plus ' + money(Math.abs(Number(i.monthly))) + ' a month.' : '', String(i.notes || '').trim()].filter(Boolean).join(' ');
  /* Adds ideas (by id) to To buy: the name is the title, the cost is the price, 'want by' is needed by, and it's yours to get
     back unless the idea said the business pays. Each idea is kept, marked as moved and no longer in the plan, so nothing is
     lost. Returns {recs, undo} (undo takes the new things out and puts the ideas back exactly as they were), or null when
     there was nothing to move. A home idea can be moved too ('It's for work' in Home › Plans). */
  function moveIdeas(ids) {
    const s = store.state;
    const seen = new Set();
    const ideas = (ids || []).map((id) => (s.costIdeas || []).find((i) => i && i.id === id)).filter((i) => i && isIdeaOpen(i) && !seen.has(i.id) && seen.add(i.id));
    if (!ideas.length) return null;
    const recs = ideas.map((i) => build({ title: i.name || 'An idea', estimate: i.cost, qty: 1, needBy: i.wantBy, payer: i.payer === 'company' ? 'company' : 'me', note: ideaNote(i) }));
    const before = ideas.map((i) => JSON.parse(JSON.stringify(i)));
    const made = new Set(recs.map((r) => r.id));
    store.commit((st) => {
      st.requests = st.requests || [];
      st.requests.push(...recs);
      ideas.forEach((i, k) => {
        const x = (st.costIdeas || []).find((y) => y.id === i.id);
        if (x) {
          x.movedToRequest = recs[k].id;
          x.status = 'dropped';
        }
      });
    });
    return {
      recs,
      undo() {
        store.commit((st) => {
          st.requests = (st.requests || []).filter((x) => !made.has(x.id));
          for (const b of before) {
            const k = (st.costIdeas || []).findIndex((y) => y.id === b.id);
            if (k >= 0) st.costIdeas[k] = b;
            else (st.costIdeas = st.costIdeas || []).push(b);
          }
        });
        return true;
      },
    };
  }
  function addIdeas(ids) {
    const res = moveIdeas(ids);
    if (!res) return null;
    toast(res.recs.length === 1 ? 'Added ' + what(res.recs[0]) + ' to To buy' : 'Added ' + plural(res.recs.length, 'idea') + ' to To buy', { action: 'Undo', onAction: res.undo });
    return res;
  }

  /* ---------- giving a thing a price ---------- */
  /* The price from the box on a row (the price of one): saves it, or says what's wrong. */
  function setPrice(id, raw) {
    const r = find(id);
    if (!r) return false;
    const p = readPrice(raw);
    if (p.error) {
      toast(p.error);
      return false;
    }
    if (p.value == null) {
      toast('Type the price, like 12.50.');
      return false;
    }
    change(id, (x) => {
      x.estimate = p.value;
      x.priceEach = true;
    }, 'Added a price to ' + what(r) + ': ' + workingText(Object.assign({}, r, { estimate: p.value, priceEach: true })));
    return true;
  }
  function openPrice(id) {
    ui.pricing = id;
    ui.draft = '';
    GU.render();
    setTimeout(() => {
      const el = document.getElementById('rq-price');
      if (el) el.focus();
    }, 0);
  }
  function closePrice() {
    ui.pricing = null;
    ui.draft = '';
    GU.render();
  }

  /* ---------- the page ---------- */
  function totals(s) {
    const L = list(s);
    const month = today().slice(0, 7);
    const asked = L.filter((r) => stateOf(r) === 'asked').sort(byNeed);
    const ordered = L.filter((r) => stateOf(r) === 'ordered').sort(byNeed);
    const boughtAll = L.filter((r) => stateOf(r) === 'bought');
    const bought = boughtAll.filter((r) => (r.boughtDate || r.created || '').slice(0, 7) === month).sort((a, b) => (b.boughtDate || '').localeCompare(a.boughtDate || '') || String(b.id).localeCompare(String(a.id)));
    const dropped = L.filter((r) => stateOf(r) === 'dropped').sort((a, b) => String(b.id).localeCompare(String(a.id))).slice(0, 20);
    return {
      all: L, asked, ordered, bought, dropped, older: boughtAll.length - bought.length,
      askedTotal: sum(asked, lineTotal), orderedTotal: sum(ordered, lineTotal), boughtTotal: sum(bought, spent),
      unpriced: asked.filter((r) => !lineTotal(r)).length, f: forecast(s),
    };
  }

  /* The pill for when it's needed: amber within three days, red once it's late. */
  function needPill(r) {
    if (!isOpen(r) || !dateOf(r.needBy)) return '';
    const n = daysUntil(r.needBy);
    if (n < 0) return pill('Late · needed ' + short(r.needBy), 'crit', 'alert');
    if (n === 0) return pill('Needed today', 'warn', 'clock');
    if (n === 1) return pill('Needed tomorrow', 'warn', 'clock');
    if (n <= SOON) return pill('Needed ' + fmtDate(r.needBy, { weekday: true }), 'warn', 'clock');
    return pill('By ' + fmtDate(r.needBy, { weekday: true }), 'muted', 'clock');
  }

  /* The price box on a row that has none: the price of one, then Save. */
  function priceForm(r) {
    const each = qtyOf(r) > 1;
    return '<form class="rq-price" data-price-form="' + esc(r.id) + '"><label class="rq-price__box"><span aria-hidden="true">' + esc(GU.util.currencySymbol()) + '</span>' +
      '<input id="rq-price" data-keep-focus type="text" inputmode="decimal" name="price" autocomplete="off" placeholder="' + (each ? 'each' : '0.00') + '" value="' + esc(ui.draft || '') + '" aria-label="' + esc('Price' + (each ? ' of one' : '') + ' for ' + r.title) + '"></label>' +
      '<button type="submit" class="btn btn--sm btn--primary">Save</button>' +
      '<button type="button" class="icon-btn" data-price-cancel aria-label="Cancel">' + icon('x') + '</button></form>';
  }

  /* What a row says it comes to: '2 × £12.00 =' over '£24.00', or just '£35.00', or 'No price yet'. */
  function endHTML(r, st, paper) {
    if (st === 'bought' && paper && Number(paper.amount)) return '<b>' + esc(money(spent(r))) + '</b><em>paid</em>';
    if (!lineTotal(r)) return '<em class="rq-noprice">No price yet</em>';
    if (showsWorking(r)) return '<em class="rq-sum">' + esc(qtyOf(r) + ' × ' + money(unitOf(r)) + ' =') + '</em><b>' + esc(money(lineTotal(r))) + '</b>';
    return '<b>' + esc(money(lineTotal(r))) + '</b>';
  }

  function rowHTML(r) {
    const st = stateOf(r);
    const paper = st === 'bought' ? paperOf(r) : null;
    const href = cleanLink(r.link);
    const chips = [needPill(r)];
    if (payerOf(r) === 'company') chips.push(pill(co(true) + ' pays', 'ktk'));
    if (st === 'ordered') chips.push(pill('Ordered' + (r.orderedDate ? ' ' + short(r.orderedDate) : ''), 'info', 'send'));
    if (st === 'bought') {
      chips.push(pill('Bought' + (r.boughtDate ? ' ' + short(r.boughtDate) : ''), 'good', 'check'));
      chips.push(paper ? pill('Receipt filed', 'muted', 'receipt') : pill('No receipt here', 'warn', 'alert'));
    }
    if (st === 'dropped') chips.push(pill('Not needed', 'muted'));
    const asked = r.askedDate ? 'Asked ' + (r.askedDate === today() ? 'today' : short(r.askedDate)) : '';
    const em = [qtyOf(r) > 1 && !showsWorking(r) ? qtyOf(r) + ' of them' : '', clip(r.note, 90).replace(/[.\s]+$/, ''), href ? hostOf(href) : '', st === 'asked' ? asked : ''].filter(Boolean).join(' · ');
    const acts = [];
    const pricing = isOpen(r) && !lineTotal(r) && ui.pricing === r.id;
    if (pricing) acts.push(priceForm(r));
    else {
      if (isOpen(r) && !lineTotal(r)) acts.push('<button type="button" class="btn btn--sm btn--ghost" data-price-open="' + esc(r.id) + '" aria-label="' + esc('Add a price for ' + r.title) + '">' + icon('plus') + 'Add price</button>');
      if (href) acts.push('<a class="btn btn--sm btn--ghost" href="' + esc(href) + '" target="_blank" rel="noopener noreferrer" aria-label="' + esc('Open the link for ' + r.title) + '" data-tip="' + esc(hostOf(href)) + '">' + icon('globe') + 'Link</a>');
      if (st === 'asked') acts.push('<button type="button" class="btn btn--sm btn--soft" data-ordered="' + esc(r.id) + '" aria-label="' + esc('Mark ' + r.title + ' as ordered') + '">' + icon('send') + 'Mark ordered</button>');
      if (st === 'ordered') acts.push('<button type="button" class="btn btn--sm btn--soft" data-bought="' + esc(r.id) + '" aria-label="' + esc('Mark ' + r.title + ' as bought') + '">' + icon('check') + 'Mark bought</button>');
      if (st === 'bought' && paper) acts.push('<button type="button" class="btn btn--sm btn--ghost" data-receipt="' + esc(r.id) + '" aria-label="' + esc('See the receipt for ' + r.title) + '">' + icon('receipt') + 'Receipt</button>');
      if (st === 'bought' && !paper) acts.push('<button type="button" class="btn btn--sm btn--soft" data-bought="' + esc(r.id) + '" aria-label="' + esc('Add the receipt for ' + r.title) + '">' + icon('receipt') + 'Add receipt</button>');
      if (st === 'dropped') acts.push('<button type="button" class="btn btn--sm btn--soft" data-putback="' + esc(r.id) + '">' + icon('undo') + 'Put back</button>');
      acts.push('<button type="button" class="icon-btn" data-more="' + esc(r.id) + '" aria-label="' + esc('More for ' + r.title) + '">' + icon('more') + '</button>');
    }
    return '<li class="wk-row wk-row--acts rq-row rq-row--' + st + (st === 'dropped' ? ' is-gone' : '') + '"><span class="wk-row__lead wk-row__ico">' + icon('bag') + '</span>' +
      '<button type="button" class="wk-row__main" data-edit="' + esc(r.id) + '"><b>' + esc(r.title) + '</b>' + (em ? '<em>' + esc(em) + '</em>' : '') +
      '<span class="wk-row__chips">' + chips.filter(Boolean).join('') + '</span></button>' +
      '<span class="wk-row__end">' + endHTML(r, st, paper) + '</span>' +
      '<span class="wk-row__act">' + acts.join('') + '</span></li>';
  }

  /* One lane: a panel (or a closed fold) with its rows. o: {id, title, icon, rows, total, empty, foot, fold, open} */
  function laneHTML(o) {
    const sub = o.rows.length ? plural(o.rows.length, 'thing') + (o.total ? ' · ' + money(o.total) : '') : 'nothing';
    const body = (o.rows.length ? '<ul class="wk-rows">' + o.rows.map(rowHTML).join('') + '</ul>' : '<p class="rq-lane__empty">' + esc(o.empty) + '</p>') +
      (o.foot ? '<p class="rq-lane__foot">' + esc(o.foot) + '</p>' : '');
    if (o.fold) {
      return '<details class="panel rq-lane rq-fold" data-fold="' + o.id + '"' + (o.open ? ' open' : '') + '><summary class="panel__head"><h2>' + icon(o.icon) + esc(o.title) + '</h2><span class="muted">' + esc(sub) + '</span>' +
        icon('chevron', 'rq-fold__chev') + '</summary>' + body + '</details>';
    }
    return '<section class="panel rq-lane" aria-label="' + esc(o.title) + '"><header class="panel__head"><h2>' + icon(o.icon) + esc(o.title) + '</h2><span class="muted">' + esc(sub) + '</span></header>' + body + '</section>';
  }

  /* 'What it will cost': the forecast for everything still to get. Things with no price aren't in the sum: they're counted apart. */
  function calcHTML(f) {
    const pays = parts() && parts().paysLabel ? parts().paysLabel(store.state) : 'Company pays';
    const unpriced = f.unpriced ? (f.unpriced === 1 ? '1 has' : f.unpriced + ' have') + ' no price yet' : '';
    let fig;
    if (!f.open) fig = '<b class="rq-calc__fig">' + esc(money(0)) + '</b><span class="rq-calc__for">nothing left to get</span>';
    else if (!f.count) fig = '<b class="rq-calc__fig rq-calc__fig--none">No prices yet</b><span class="rq-calc__for">' + esc(plural(f.open, 'thing') + ' to get') + '</span>';
    else fig = '<b class="rq-calc__fig">' + esc(money(f.total)) + '</b><span class="rq-calc__for">' + esc('for ' + plural(f.count, 'thing')) + '</span>';
    const line = (label, v) => '<div><dt>' + esc(label) + '</dt><dd>' + esc(money(v)) + '</dd></div>';
    return '<section class="panel rq-calc" aria-label="What it will cost"><header class="panel__head"><h2>' + icon('bag') + 'What it will cost</h2><span class="muted">everything still to get</span></header>' +
      '<div class="rq-calc__body"><div class="rq-calc__main">' + fig + (unpriced ? '<p class="rq-calc__warn">' + icon('alert') + esc(unpriced) + '</p>' : '') + '</div>' +
      (f.count ? '<dl class="rq-calc__lines">' + line('You pay, ' + co() + ' pays you back', f.me) + line(pays, f.company) + line('Needed within 7 days', f.soon) + '</dl>' : '') + '</div>' +
      (f.boughtCount ? '<p class="rq-calc__foot">Bought this month <b>' + esc(money(f.bought)) + '</b></p>' : '') + '</section>';
  }

  /* The old ideas, in one closed fold near the bottom: each can be added, or all together. */
  function ideasHTML(s) {
    const ideas = oldIdeas(s);
    if (!ideas.length) return '';
    const total = sum(ideas, (i) => Math.abs(Number(i.cost) || 0));
    const row = (i) => {
      const cost = Math.abs(Number(i.cost) || 0);
      const monthly = Math.abs(Number(i.monthly) || 0);
      const em = [i.wantBy && dateOf(i.wantBy) ? 'wanted by ' + short(i.wantBy) : '', monthly ? 'plus ' + money(monthly) + ' a month' : '', clip(i.notes, 70)].filter(Boolean).join(' · ');
      return '<li class="wk-row wk-row--acts rq-row rq-idea"><span class="wk-row__lead wk-row__ico">' + icon('trend') + '</span>' +
        '<div class="rq-idea__main"><b>' + esc(i.name || 'An idea') + '</b>' + (em ? '<em>' + esc(em) + '</em>' : '') + '</div>' +
        '<span class="wk-row__end">' + (cost ? '<b>' + esc(money(cost)) + '</b>' : '<em class="rq-noprice">No price yet</em>') + '</span>' +
        '<span class="wk-row__act"><button type="button" class="btn btn--sm btn--soft" data-idea-add="' + esc(i.id) + '" aria-label="' + esc('Add ' + (i.name || 'this idea') + ' to To buy') + '">' + icon('plus') + 'Add to To buy</button></span></li>';
    };
    return '<details class="panel rq-lane rq-fold rq-old" data-fold="ideas"' + (ui.ideasOpen ? ' open' : '') + '><summary class="panel__head"><h2>' + icon('trend') + 'Ideas from the old Cost forecast (' + ideas.length + ')</h2>' +
      '<span class="muted">' + esc(total ? money(total) : '') + '</span>' + icon('chevron', 'rq-fold__chev') + '</summary>' +
      '<p class="rq-old__intro">' + esc('You noted these on the Cost forecast page, which has gone. Add the ones you still need and they join the list above, with their price and date. Nothing is lost.') + '</p>' +
      '<ul class="wk-rows">' + ideas.map(row).join('') + '</ul>' +
      '<p class="rq-old__foot"><button type="button" class="btn btn--sm" data-ideas-all>' + icon('plus') + 'Add all (' + ideas.length + ')</button></p></details>';
  }

  function render(root) {
    const s = store.state;
    const T = totals(s);
    const c = co();
    const pr = ui.pricing ? find(ui.pricing) : null;
    if (!pr || !isOpen(pr) || lineTotal(pr)) ui.pricing = null; // only a thing still to get and with no price has the box open
    const hint = 'Like “3x gloves £12 each, by Friday”. I’ll add it up for you.';
    const quick = '<form class="rq-quick" data-quick><div class="task-add wk-add">' +
      '<input type="text" name="line" id="rq-line" data-keep-focus placeholder="Printer toner, about £35, by Friday" aria-label="Add something to get" autocomplete="off">' +
      '<button type="submit" class="btn btn--primary">' + icon('plus') + 'Add</button></div>' +
      '<p class="rq-hint" data-rq-hint>' + esc(hint) + '</p></form>';
    const body = T.all.length
      ? laneHTML({ id: 'asked', title: 'To order', icon: 'bag', rows: T.asked, total: T.askedTotal, empty: 'Nothing waiting to be ordered.' }) +
        laneHTML({ id: 'ordered', title: 'On its way', icon: 'send', rows: T.ordered, total: T.orderedTotal, empty: 'Nothing ordered and waiting to arrive.' }) +
        laneHTML({ id: 'bought', title: 'Bought this month', icon: 'check', rows: T.bought, total: T.boughtTotal, fold: true, open: ui.boughtOpen, empty: 'Nothing bought this month yet. Once you mark something bought, it moves here.',
          foot: T.older ? plural(T.older, 'earlier one') + ' not shown here. The receipts are where you filed them.' : '' }) +
        (T.dropped.length ? laneHTML({ id: 'dropped', title: 'Not needed', icon: 'x', rows: T.dropped, fold: true, open: ui.droppedOpen, empty: '' }) : '')
      : '<p class="wk-quiet">' + esc('Nothing to get right now.') + '</p>';
    // Notes for this page: a panel once there are some, until then a small '+ Note' button in the head.
    const W = GU.work;
    const notes = W && W.notesOf ? W.notesOf(s, 'requests').slice().sort((x, y) => (y.updated || y.created || '').localeCompare(x.updated || x.created || '')) : [];
    const notesPanel = notes.length && GU.tabs.work
      ? '<section class="panel"><header class="panel__head"><h2>' + icon('note') + 'Notes</h2><button type="button" class="btn btn--sm" data-new-note>' + icon('plus') + 'New note</button></header><ul class="wk-notes">' +
        notes.map((n) => '<li class="wk-note"><button type="button" class="wk-note__main" data-open="workNotes:' + esc(n.id) + '"><b>' + esc(n.title || 'Note') + '</b>' + (n.body ? '<span>' + esc(n.body.length > 220 ? n.body.slice(0, 220) + '…' : n.body) + '</span>' : '') +
          '<em>' + esc('updated ' + short(n.updated || n.created)) + '</em></button><button type="button" class="icon-btn" data-more="workNotes:' + esc(n.id) + '" aria-label="' + esc('More for ' + (n.title || 'Note')) + '">' + icon('more') + '</button></li>').join('') + '</ul></section>'
      : '';
    const noteBtn = !notes.length && GU.tabs.work ? '<button type="button" class="btn btn--ghost" data-new-note>' + icon('plus') + 'Note</button>' : '';
    root.innerHTML = GU.view.head({
      eyebrow: coName(),
      title: 'To buy',
      text: esc('Things ' + c + ' has asked you to get, added up as you go. Note them down, order them, then add the receipt and it goes to Get paid back by itself.'),
      actions: (T.asked.length + T.ordered.length ? '<button type="button" class="btn" data-download>' + icon('download') + 'Download list</button>' : '') +
        '<button type="button" class="btn" data-add-many>' + icon('list') + 'Add several</button>' + noteBtn +
        '<button type="button" class="btn btn--primary" data-add>' + icon('plus') + 'Something to get</button>',
    }) + '<div class="stack rq">' + (T.all.length ? calcHTML(T.f) : '') + quick + body + ideasHTML(s) + notesPanel + '</div>';

    root.querySelectorAll('details[data-fold]').forEach((det) => det.addEventListener('toggle', () => {
      if (det.dataset.fold === 'bought') ui.boughtOpen = det.open;
      else if (det.dataset.fold === 'ideas') ui.ideasOpen = det.open;
      else ui.droppedOpen = det.open;
    }));
    const form = root.querySelector('[data-quick]');
    form.addEventListener('submit', quickAdd);
    // As you type, a line under the box says how it will be added.
    const box = form.elements.line;
    const note = form.querySelector('[data-rq-hint]');
    box.addEventListener('input', () => {
      note.textContent = box.value.trim() ? previewLine(box.value) : hint;
    });
    root.addEventListener('submit', onSubmit);
    root.addEventListener('input', (e) => {
      if (e.target && e.target.id === 'rq-price') ui.draft = e.target.value;
    });
    root.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && e.target && e.target.id === 'rq-price') closePrice();
    });
    root.addEventListener('click', onClick);
  }

  /* 'Adds: Gloves · 3 × £12.00 = £36.00 · by Fri 9 Oct': what the line you're typing will become. */
  function previewLine(raw) {
    const p = parseLine(raw);
    if (!p.title) return 'Say what it is first.';
    const r = { qty: p.qty, estimate: p.estimate, priceEach: true };
    return 'Adds: ' + [p.title, p.estimate ? workingText(r) : 'no price yet', p.needBy ? 'needed ' + fmtDate(p.needBy, { weekday: true }) : '', p.payer === 'company' ? co(true) + ' pays' : ''].filter(Boolean).join(' · ');
  }

  function quickAdd(e) {
    e.preventDefault();
    const box = e.target.elements.line;
    const raw = box.value.trim();
    if (!raw) return;
    const p = parseLine(raw);
    if (!p.title) {
      toast('Say what it is, like “Printer toner, about £35, by Friday”.');
      return;
    }
    const res = add(p);
    toast('Added ' + describe(res.rec), { action: 'Undo', onAction: res.undo });
    setTimeout(() => {
      const el = document.getElementById('rq-line');
      if (el) el.focus();
    }, 0);
  }

  /* The price box on a row. */
  function onSubmit(e) {
    const f = e.target.closest ? e.target.closest('[data-price-form]') : null;
    if (!f) return;
    e.preventDefault();
    if (setPrice(f.dataset.priceForm, f.elements.price.value)) {
      ui.pricing = null;
      ui.draft = '';
    }
  }

  function moreMenu(anchor, id) {
    const r = find(id);
    if (!r) return;
    const st = stateOf(r);
    const items = [{ icon: 'edit', label: 'Edit', onClick: () => edit(id) }];
    const where = payerOf(r) === 'company' ? 'Adds the receipt for ' + co() : 'Adds the receipt to Get paid back';
    if (isOpen(r) && !lineTotal(r)) items.push({ icon: 'plus', label: 'Add price', onClick: () => openPrice(id) });
    if (st === 'asked') items.push({ icon: 'send', label: 'Mark ordered', hint: 'You’ve placed the order', onClick: () => markOrdered(id) });
    if (st === 'asked' || st === 'ordered') items.push({ icon: 'check', label: 'Mark bought', hint: where, onClick: () => markBought(id) });
    if (st === 'ordered') items.push({ icon: 'undo', label: 'Not ordered yet', hint: 'Back to To order', onClick: () => backToOrder(id) });
    if (st === 'bought' && paperOf(r)) items.push({ icon: 'receipt', label: 'See the receipt', onClick: () => viewReceipt(id) });
    if (st === 'bought' && !paperOf(r)) items.push({ icon: 'receipt', label: 'Add the receipt', hint: where, onClick: () => markBought(id) });
    if (st === 'asked' || st === 'ordered') items.push({ icon: 'x', label: 'Not needed', hint: 'Keeps it, out of the way', onClick: () => notNeeded(id) });
    if (st === 'dropped') items.push({ icon: 'undo', label: 'Put back in To order', onClick: () => backToOrder(id) });
    items.push({ icon: 'trash', label: 'Delete', hint: 'You can undo it', onClick: () => remove(id) });
    menu(anchor, items);
  }

  function onClick(e) {
    const b = (sel) => e.target.closest(sel);
    let el;
    // A note on this page (made, opened and moved just like the notes on the other Work pages).
    if (b('[data-new-note]')) return GU.work && GU.work.editNote ? GU.work.editNote(null, { area: 'requests' }) : undefined;
    if ((el = b('[data-more^="workNotes:"], [data-open^="workNotes:"]')) && GU.work && GU.work.rowClick) return GU.work.rowClick(e);
    if ((el = b('[data-more]'))) return moreMenu(el, el.dataset.more);
    if ((el = b('[data-edit]'))) return edit(el.dataset.edit);
    if ((el = b('[data-price-open]'))) return openPrice(el.dataset.priceOpen);
    if (b('[data-price-cancel]')) return closePrice();
    if ((el = b('[data-ordered]'))) return markOrdered(el.dataset.ordered);
    if ((el = b('[data-bought]'))) return markBought(el.dataset.bought);
    if ((el = b('[data-putback]'))) return backToOrder(el.dataset.putback);
    if ((el = b('[data-receipt]'))) return viewReceipt(el.dataset.receipt);
    if ((el = b('[data-idea-add]'))) return addIdeas([el.dataset.ideaAdd]);
    if (b('[data-ideas-all]')) return addIdeas(oldIdeas(store.state).map((i) => i.id));
    if (b('[data-add-many]')) return addMany();
    if (b('[data-add]')) return create();
    if (b('[data-download]')) return download();
  }

  GU.requests = { add, addAll, cleanLink, parseLine, titleFromLink, checks, dates, cardHTML, totals, candidates, create,
    forecast, lineTotal, unitOf, readPrice, readQty, csvRows, csvCell, oldIdeas, moveIdeas, addIdeas };
  GU.tabs[TAB] = { label: 'To buy', short: 'To buy', icon: 'bag', part: 'work', render, create, edit };
})();
