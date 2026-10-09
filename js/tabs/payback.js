/* The Ground Up: Work › Get paid back. Things you paid for the business you work for with your own money,
   in three steps: not sent yet, waiting for them to pay you back, and paid back. One tap sends everything
   ticked (a zip of the receipts with a printable summary), and their repayment is spotted in your bank
   statement. 'From your bank' lists work spending not claimed yet and repayments with nothing matched.
   Every change goes through GU.workMoney, each with Undo. Names come from settings.employer. */
(function () {
  'use strict';
  const GU = window.GU;
  const { esc, today, addDays, toDays, daysUntil, fmtDate, money, plural, sum, round2, debounce } = GU.util;
  const { icon, pill, emptyState, toast, thumbHTML, viewFiles } = GU.ui;
  const store = GU.store;
  /* Where a page is in the menu, for hints and labels: 'Work › Orders & claims › Get paid back'. */
  const pageAt = (tab, fallback) => (GU.parts && GU.parts.pathOf && GU.tabs && GU.tabs[tab] ? GU.parts.pathOf(tab) : fallback);
  const P = 'paperwork';

  // Things you've unticked in Not sent yet (everything new starts ticked), whether Paid back is open,
  // which 'From your bank' lists show in full and which are open. Kept for this visit only.
  const ui = { off: new Set(), paidOpen: false, all: {}, fold: {} };

  /* ---------- small helpers ---------- */
  const W = () => GU.workMoney;
  const short = (iso) => fmtDate(iso, { short: true });
  const amountOf = (p) => Math.abs(Number(p && p.amount) || 0);
  const noAmount = (p) => p.amount == null || p.amount === '';
  const shop = (p) => p.party || p.title || 'Item';
  const what = (p) => (p.party && p.title && p.title !== p.party ? p.title : '');
  const name = (p) => p.title || p.party || 'this';
  const txOf = (s, id) => (id ? (s.transactions || []).find((t) => t.id === id) || null : null);
  const packKey = (p) => p.packId || (p.claimedDate ? 'sent-' + p.claimedDate : 'sent');
  const days = (n) => n + (n === 1 ? ' day' : ' days');
  function ago(iso) {
    if (!iso) return '';
    const n = -daysUntil(iso);
    return n <= 0 ? 'today' : n === 1 ? 'yesterday' : n + ' days ago';
  }
  /* An account's nickname, never its number. */
  function acct(s, id) {
    const a = (s.accounts || []).find((x) => x.id === id);
    return W().clean((a && (a.name || a.bank)) || '') || 'your account';
  }
  /* A bank line's description, with card numbers, sort codes and long references taken out. */
  function bankText(t) {
    const d = W().clean(t.description || '');
    return d.length > 48 ? d.slice(0, 46).trim() + '…' : d || 'Bank payment';
  }
  const escRe = (t) => String(t).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  /* What a payment from the employer says, without their own name or bank wording: often the thing it's for. */
  function refOf(s, t) {
    const e = W().employer(s);
    let r = W().clean(t.description || '');
    const names = [e.name, e.fullName, e.short].concat(e.match).filter(Boolean).sort((a, b) => b.length - a.length);
    for (const n of names) r = r.replace(new RegExp('(^|[^a-z0-9])' + escRe(n) + '(?=$|[^a-z0-9])', 'ig'), '$1 ');
    r = r.replace(/\b\d{1,2}[ /.-]\d{1,2}[ /.-]\d{2,4}\b/g, ' ')
      .replace(/\b(ltd|limited|plc|llp|fpi|fpo|bgc|bacs|faster payments?|bank giro credit|credit|receipt|ref(erence)?|from|(gbp|usd|eur)( on)?)\b[:.]?/ig, ' ')
      .replace(/…/g, ' ').replace(/[\s,.;:/-]+/g, ' ').replace(/^[^a-z0-9£$€]+|[^a-z0-9)£$€]+$/ig, '').trim();
    return r.length > 40 ? r.slice(0, 38).trim() + '…' : r;
  }
  function usedCredits(s) {
    const set = new Set();
    for (const p of s.paperwork || []) {
      if (p.repaidTx) set.add(p.repaidTx);
      for (const r of p.repayments || []) if (r.tx) set.add(r.tx);
    }
    return set;
  }
  const isTransfer = (t) => (GU.finance.isTransfer ? GU.finance.isTransfer(t) : t.category === 'Transfers');

  /* Not sent yet, minus anything you've unticked. Invoices you haven't paid yet aren't owed to you yet. */
  function ticked(d) {
    return d.toSend.filter((x) => !ui.off.has(x.p.id));
  }
  const sendLabel = (e, rows) => 'Send to ' + e.label + (rows.length ? ' (' + rows.length + ' · ' + money(sum(rows, (x) => x.left)) + ')' : '');

  /* ---------- one row ---------- */
  /* The proof for a claim: the receipt, and your bank payment (or a button to find it). */
  function proofHTML(s, p, offer, lane) {
    const out = [];
    if (!(p.files || []).length && lane !== 'paid') out.push('<button type="button" class="pb-link" data-add-file="' + esc(p.id) + '">' + icon('camera') + 'No receipt yet: add one</button>');
    const tx = txOf(s, p.purchaseTx);
    if (tx) out.push(pill('Paid from ' + acct(s, tx.account) + ' ' + short(tx.date), lane === 'paid' ? 'muted' : 'good', lane === 'paid' ? 'bank' : 'check'));
    else if (p.purchaseTx) out.push(pill('Bank payment linked', 'good', 'check'));
    else if (lane !== 'paid' && !offer) out.push('<button type="button" class="btn btn--sm btn--ghost" data-find="' + esc(p.id) + '">' + icon('search') + 'Find the payment</button>');
    if (p.originalAmount) out.push(pill('Receipt says ' + W().clean(p.originalAmount), 'muted'));
    if (p.billId) out.push(pill('From your bill', 'muted', 'repeat'));
    if (GU.returns && lane !== 'paid') out.push(GU.returns.pill(p));
    if (lane === 'paid') {
      const back = txOf(s, p.repaidTx);
      out.unshift(pill('Paid back ' + short(p.repaidDate) + (back ? ' to ' + acct(s, back.account) : ''), 'good', 'check'));
    }
    return out.join('');
  }

  /* A bank payment I think is this claim's, but I'm not sure: one tap to say yes. */
  function offerHTML(s, p, o) {
    if (!o) return '';
    const btn = (attr, label, cls) => '<button type="button" class="btn btn--sm ' + cls + '" ' + attr + '="' + esc(p.id + ':' + (o.near || o.tx).id) + '">' + esc(label) + '</button>';
    if (o.near && (o.amountDiffers || !o.tx)) {
      const t = o.near;
      const cur = W().purchaseFor(s, p).currency || '';
      const said = cur ? amountOf(p).toFixed(2) + ' ' + cur : money(amountOf(p));
      return '<p class="tally-row__match pb-row__offer">' + icon('bank') + '<span>Receipt says <b>' + esc(said) + '</b>, your bank took <b>' + esc(money(-t.amount)) + '</b> (' + esc(acct(s, t.account) + ', ' + short(t.date)) + ').</span>' +
        btn('data-use-bank', 'Use ' + money(-t.amount), 'btn--primary') + btn('data-not-purchase', 'Not this one', 'btn--ghost') +
        '<button type="button" class="btn btn--sm btn--ghost" data-find="' + esc(p.id) + '">Pick another</button></p>';
    }
    const t = o.tx;
    return '<p class="tally-row__match pb-row__offer">' + icon('bank') + '<span>Is this the payment? <b>' + esc(money(-t.amount)) + '</b> from ' + esc(acct(s, t.account)) + ' on ' + esc(short(t.date)) + ', ‘' + esc(bankText(t)) + '’.</span>' +
      '<button type="button" class="btn btn--sm btn--primary" data-link="' + esc(p.id + ':' + t.id) + '">Yes, that’s it</button>' + btn('data-not-purchase', 'No', 'btn--ghost') +
      ((o.options || []).length > 1 ? '<button type="button" class="btn btn--sm btn--ghost" data-find="' + esc(p.id) + '">Pick another</button>' : '') + '</p>';
  }

  /* o: {lane: 'send'|'sent'|'paid', on (ticked), running, offer} */
  function rowHTML(s, x, o) {
    const p = x.p;
    const files = (p.files || []).length;
    const lead = o.lane === 'send'
      ? '<label class="pb-row__tick"><input type="checkbox" class="tick" data-tick="' + esc(p.id) + '"' + (o.on ? ' checked' : '') + ' aria-label="' + esc('Send ' + name(p)) + '"></label>'
      : '';
    let amt;
    if (noAmount(p) && o.lane !== 'paid') amt = '<b class="muted">No amount</b><button type="button" class="pb-link" data-edit="' + esc(p.id) + '">Add it</button>';
    else if (o.lane === 'send') amt = '<b>' + esc(money(x.left)) + '</b><em>' + esc(o.on ? money(o.running) + ' so far' : 'not ticked') + '</em>';
    else if (o.lane === 'sent') {
      const back = round2(x.amount - x.left);
      amt = '<b>' + esc(money(x.left)) + '</b>' + (back > 0 ? '<em>' + esc(money(back) + ' of ' + money(x.amount) + ' back') + '</em>' : '');
    } else amt = '<b>' + esc(money(x.amount)) + '</b>';
    const sub = [p.date ? short(p.date) : 'No date', what(p), o.lane === 'send' && p.date ? ago(p.date) : ''].filter(Boolean).join(' · ');
    return '<li class="pb-row pb-row--' + o.lane + (o.on === false ? ' is-off' : '') + '">' + lead +
      '<button type="button" class="pb-row__thumb doc-row__thumb" data-files="' + esc(p.id) + '" aria-label="' + esc((files ? 'View the receipt for ' : 'Add a receipt to ') + name(p)) + '">' + thumbHTML(p.files) + '</button>' +
      '<button type="button" class="pb-row__main" data-edit="' + esc(p.id) + '"><b>' + esc(shop(p)) + '</b><em>' + esc(sub) + '</em></button>' +
      '<span class="pb-row__amt">' + amt + '</span>' +
      '<button type="button" class="icon-btn pb-row__more" data-more="' + esc(p.id) + '" aria-label="' + esc('More for ' + name(p)) + '">' + icon('more') + '</button>' +
      '<div class="pb-row__proof">' + proofHTML(s, p, o.offer, o.lane) + '</div>' +
      (o.lane !== 'paid' ? offerHTML(s, p, o.offer) : '') + '</li>';
  }

  /* ---------- 1. Not sent yet ---------- */
  function sendLaneHTML(s, e, d, offers) {
    const on = ticked(d);
    let run = 0;
    const rows = d.toSend.map((x) => {
      const isOn = !ui.off.has(x.p.id);
      if (isOn) run = round2(run + x.left);
      return rowHTML(s, x, { lane: 'send', on: isOn, running: run, offer: offers.get(x.p.id) });
    });
    const unpaid = d.unpaid.map((x) => {
      const p = x.p;
      return '<li class="pb-row pb-row--first"><span class="pb-row__thumb">' + thumbHTML(p.files) + '</span>' +
        '<button type="button" class="pb-row__main" data-edit="' + esc(p.id) + '"><b>' + esc(shop(p)) + '</b><em>' + esc([p.dueDate ? 'Due ' + short(p.dueDate) : p.date ? short(p.date) : '', what(p)].filter(Boolean).join(' · ')) + '</em></button>' +
        '<span class="pb-row__amt"><b>' + esc(noAmount(p) ? 'No amount' : money(amountOf(p))) + '</b></span>' +
        '<button type="button" class="icon-btn pb-row__more" data-more="' + esc(p.id) + '" aria-label="' + esc('More for ' + name(p)) + '">' + icon('more') + '</button>' +
        '<div class="pb-row__proof"><button type="button" class="btn btn--sm btn--soft" data-pay-first="' + esc(p.id) + '">' + icon('check') + 'I’ve paid it</button></div></li>';
    });
    const all = d.toSend.length;
    const head = '<header class="panel__head"><h2><span class="pb-n" aria-hidden="true">1</span>Not sent yet</h2>' +
      '<span class="muted">' + esc(all ? 'oldest first · tick what to send' : 'nothing to send') + '</span>' +
      (all > 1 ? '<button type="button" class="btn btn--sm btn--ghost" data-tick-all>' + (on.length === all ? 'Untick all' : 'Tick all') + '</button>' : '') + '</header>';
    if (!all && !unpaid.length) {
      return '<section class="panel pb-lane" id="pb-send">' + head + emptyState({ icon: 'coin', art: 'payback', title: 'Nothing to send', text: esc('When you pay for something for ' + e.label + ' with your own money, add the receipt here, or pick the payment from your bank.') }) + '</section>';
    }
    return '<section class="panel pb-lane" id="pb-send">' + head +
      (all ? '<ol class="pb-rows">' + rows.join('') + '</ol>' : '') +
      (unpaid.length ? '<h3 class="wk-group__title">Pay these first</h3><p class="pb-lane__note">' + esc('Invoices you’re paying yourself. Once they’re paid, they’re ready to send to ' + e.label + '.') + '</p><ol class="pb-rows">' + unpaid.join('') + '</ol>' : '') +
      (all ? '<footer class="tally__foot pb-lane__foot"><span>' + esc(on.length === all ? (all === 1 ? 'Ready to send' : 'All ' + all + ' ticked') : on.length + ' of ' + all + ' ticked') + '</span><b>' + esc(money(sum(on, (x) => x.left))) + '</b>' +
        '<button type="button" class="btn btn--sm btn--soft" data-send' + (on.length ? '' : ' disabled') + '>' + icon('send') + esc('Send to ' + e.label) + '</button></footer>' : '') +
      '</section>';
  }

  /* ---------- 2. Waiting ---------- */
  /* A repayment that looks like it's for these claims, waiting for a Yes or No. */
  function promptHTML(s, e, r) {
    const t = r.tx;
    const ref = refOf(s, t);
    const cl = r.claims;
    const ids = cl.map((p) => p.id).join(',');
    const sent = cl.map((p) => p.claimedDate).filter(Boolean).sort()[0];
    const label = cl.length === 1 ? name(cl[0]) : 'the ' + cl.length + ' things you sent' + (sent ? ' on ' + short(sent) : '');
    return '<p class="tally-row__match pb-prompt">' + icon('bank') + '<span><b>' + esc(money(t.amount)) + '</b> came in from ' + esc(e.label) + ' on ' + esc(short(t.date)) + (ref ? ', ‘' + esc(ref) + '’' : '') + '. Is that ' + esc(label) + '?</span>' +
      '<button type="button" class="btn btn--sm btn--primary" data-repaid="' + esc(t.id) + '" data-ids="' + esc(ids) + '">Yes, paid back</button>' +
      '<button type="button" class="btn btn--sm btn--ghost" data-not-repaid="' + esc(t.id) + '" data-ids="' + esc(ids) + '">No</button>' +
      ((r.options || []).length > 1 ? '<button type="button" class="btn btn--sm btn--ghost" data-which="' + esc(t.id) + '">Something else</button>' : '') + '</p>';
  }

  function sentLaneHTML(s, e, d, pr, offers) {
    const byPack = new Map();
    const loose = [];
    for (const r of pr.repayments) {
      const keys = new Set(r.claims.map((p) => (W().stage(p) === 'sent' ? packKey(p) : '')));
      if (r.claims.length && keys.size === 1 && !keys.has('')) {
        const k = keys.values().next().value;
        if (!byPack.has(k)) byPack.set(k, []);
        byPack.get(k).push(r);
      } else loose.push(r);
    }
    const packs = d.packs.slice().reverse(); // newest first
    const body = packs.map((pk) => {
      const tone = pk.chase ? ' is-chase' : pk.late ? ' is-late' : '';
      const note = pk.chase ? '<p class="pb-pack__note is-crit">' + icon('alert') + '<span>' + esc(e.Label + ' hasn’t paid back ' + money(pk.left) + ' you sent on ' + short(pk.date) + '. Time for a reminder.') + '</span></p>'
        : pk.late ? '<p class="pb-pack__note is-warn">' + icon('clock') + '<span>' + esc('Taking longer than usual. ' + e.Label + ' usually pays back in about ' + days(e.repayDays) + '.') + '</span></p>' : '';
      const meta = [pk.packId, plural(pk.items.length, 'item'), pk.date ? ago(pk.date) : ''].filter(Boolean).join(' · ');
      return '<div class="pb-pack' + tone + '"><div class="pb-pack__head">' +
        '<span class="pb-pack__title"><b>' + esc(pk.date ? 'Sent ' + short(pk.date) : 'Sent') + '</b><em>' + esc(meta) + '</em></span>' +
        '<b class="pb-pack__amt">' + esc(money(pk.left)) + '</b>' +
        '<span class="pb-pack__btns"><button type="button" class="btn btn--sm' + (pk.chase ? ' btn--primary' : '') + '" data-remind="' + esc(pk.key) + '">' + icon('send') + esc('Remind ' + e.label) + '</button>' +
        '<button type="button" class="btn btn--sm btn--soft" data-paidback="' + esc(pk.key) + '">' + icon('check') + 'Paid back…</button></span></div>' +
        note + (byPack.get(pk.key) || []).map((r) => promptHTML(s, e, r)).join('') +
        '<ol class="pb-rows">' + pk.items.map((x) => rowHTML(s, x, { lane: 'sent', offer: offers.get(x.p.id) })).join('') + '</ol></div>';
    }).join('');
    const total = d.sentTotal;
    return '<section class="panel pb-lane" id="pb-sent"><header class="panel__head"><h2><span class="pb-n" aria-hidden="true">2</span>' + esc('Waiting for ' + e.label) + '</h2>' +
      '<span class="muted">' + esc(packs.length ? money(total) + ' · ' + plural(packs.length, 'pack') : 'nothing waiting') + '</span></header>' +
      (loose.length ? '<div class="pb-prompts">' + loose.map((r) => promptHTML(s, e, r)).join('') + '</div>' : '') +
      (body || '<p class="pb-lane__empty">' + esc('Things you send to ' + e.label + ' wait here until the money comes back.') + '</p>') +
      '</section>';
  }

  /* ---------- 3. Paid back ---------- */
  function paidLaneHTML(s, e) {
    const rows = W().claims(s, 'paid-back').sort((a, b) => (b.p.repaidDate || '').localeCompare(a.p.repaidDate || '') || (b.p.date || '').localeCompare(a.p.date || ''));
    const total = sum(rows, (x) => x.amount);
    const lim = ui.all.paid ? rows.length : 40;
    return '<details class="panel pb-lane pb-paid" id="pb-paid"' + (ui.paidOpen ? ' open' : '') + '><summary class="panel__head"><h2><span class="pb-n" aria-hidden="true">3</span>Paid back</h2>' +
      '<span class="muted">' + esc(rows.length ? plural(rows.length, 'item') + ' · ' + money(total) : 'nothing yet') + '</span>' + icon('chevron', 'pb-paid__chev') + '</summary>' +
      (rows.length ? '<ol class="pb-rows">' + rows.slice(0, lim).map((x) => rowHTML(s, x, { lane: 'paid' })).join('') + '</ol>' +
        (rows.length > lim ? '<p class="pb-lane__more"><button type="button" class="link link--btn" data-bank-more="paid">Show all ' + rows.length + '</button></p>' : '')
        : '<p class="pb-lane__empty">' + esc('Once ' + e.label + ' pays you back, things move here with the payment that paid for them.') + '</p>') + '</details>';
  }

  /* ---------- From your bank ---------- */
  /* One list, folded under its own heading with its count. Closed until you open it, except the work spending you
     haven't claimed yet (the one to act on), which starts open. It shows five rows and 'Show all n'. */
  function group(key, title, sub, rows, tools, openByDefault) {
    const n = rows.length;
    const lim = 5;
    const all = !!ui.all[key];
    const open = ui.fold[key] != null ? ui.fold[key] : !!openByDefault;
    return '<details class="pb-bank__group pb-fold" data-fold="' + key + '"' + (open ? ' open' : '') + '><summary><span class="pb-fold__title">' + esc(title) + '</span><span class="chip__n">' + n + '</span>' + icon('chevron', 'pb-fold__chev') + '</summary>' +
      '<div class="pb-fold__body">' + (sub ? '<p class="pb-bank__sub">' + esc(sub) + '</p>' : '') +
      '<ul class="pb-txs">' + (all ? rows : rows.slice(0, lim)).join('') + '</ul>' +
      (n > lim || tools ? '<p class="pb-bank__tools">' + (n > lim ? '<button type="button" class="link link--btn" data-bank-more="' + key + '">' + (all ? 'Show fewer' : 'Show all ' + n) + '</button>' : '') + (tools || '') + '</p>' : '') + '</div></details>';
  }
  function spendRow(s, t, hint) {
    return '<li class="pb-tx"><button type="button" class="pb-tx__main" data-tx="' + esc(t.id) + '"><b>' + esc(bankText(t)) + '</b><em>' + esc([short(t.date), acct(s, t.account), hint].filter(Boolean).join(' · ')) + '</em></button>' +
      '<b class="pb-tx__amt">' + esc(money(-t.amount)) + '</b>' +
      '<span class="pb-tx__act"><button type="button" class="btn btn--sm btn--soft" data-claim-tx="' + esc(t.id) + '">' + icon('plus') + 'Add to Get paid back</button>' +
      '<button type="button" class="btn btn--sm btn--ghost" data-not-work="' + esc(t.id) + '">Not work</button></span></li>';
  }
  function creditRow(s, e, t) {
    const ref = refOf(s, t);
    return '<li class="pb-tx"><button type="button" class="pb-tx__main" data-tx="' + esc(t.id) + '"><b>' + esc(ref || 'From ' + e.label) + '</b><em>' + esc(short(t.date) + ' · ' + acct(s, t.account)) + '</em></button>' +
      '<b class="pb-tx__amt is-in">' + esc(money(t.amount)) + '</b>' +
      '<span class="pb-tx__act"><button type="button" class="btn btn--sm btn--soft" data-which="' + esc(t.id) + '">Pick what it was for</button>' +
      '<button type="button" class="btn btn--sm btn--ghost" data-credit-ok="' + esc(t.id) + '">That’s fine</button>' +
      '<button type="button" class="pb-link pb-link--quiet" data-wages="' + esc(t.id) + '">It’s my wages</button></span></li>';
  }
  /* (The bills you pay and claim aren't listed here: each payment already says 'From your bill' on its row.) */
  function bankHTML(s, e, pr) {
    const groups = [];
    const work = pr.unclaimedSpend.filter((x) => x.why === 'work');
    const shops = pr.unclaimedSpend.filter((x) => x.why === 'shop');
    if (work.length) groups.push(group('work', 'Work spending not claimed yet', 'Marked as work in your bank, but not added here.', work.map((x) => spendRow(s, x.tx, '')), '', true));
    if (shops.length) groups.push(group('shop', 'From shops you’ve claimed before', 'In the last 60 days. Were any for ' + e.label + '?', shops.map((x) => spendRow(s, x.tx, x.shop ? 'like ' + x.shop : ''))));
    if (pr.noClaimCredits.length) {
      groups.push(group('credits', 'Money from ' + e.label + ' I couldn’t match', 'Kept out of your income. Say what each was for, or leave it.', pr.noClaimCredits.slice().sort((a, b) => (b.tx.date || '').localeCompare(a.tx.date || '')).map((x) => creditRow(s, e, x.tx)),
        pr.noClaimCredits.length > 1 ? '<button type="button" class="link link--btn" data-credits-ok>They’re all fine</button>' : ''));
    }
    return '<section class="panel pb-bank"><header class="panel__head"><h2>' + icon('bank') + 'From your bank</h2></header>' + (GU.gaps ? GU.gaps.claimsNoteHTML(s) : '') +
      (groups.join('') || '<div class="panel__body"><p class="muted">' + esc('Nothing to check. After you import a statement, I’ll list work spending you haven’t claimed and any money from ' + e.label + ' I can’t match.') + '</p></div>') + '</section>';
  }

  /* ---------- the page ---------- */
  function render(root) {
    const s = store.state;
    const wm = W();
    const e = wm.employer(s);
    const d = wm.dueBack(s);
    const pr = wm.prompts(s);
    // Forget ticks for things that have left Not sent yet.
    const live = new Set(d.toSend.map((x) => x.p.id));
    for (const id of Array.from(ui.off)) if (!live.has(id)) ui.off.delete(id);
    const on = ticked(d);
    const offers = new Map(pr.purchases.map((o) => [o.p.id, o]));
    const paid = wm.claims(s, 'paid-back');
    const ty = wm.taxYearStart(today());
    const oldPack = d.packs[0];
    const nudge = d.nudge ? ' is-warn' : '';

    const tally = '<section class="panel tally pb-tally">' +
      '<div class="tally__sum">' +
      '<div><span>' + esc(e.Label + ' owes you') + '</span><b class="' + (d.total > 0 ? 'is-in' : '') + '">' + esc(money(d.total)) + '</b><em>' + esc(d.count ? plural(d.count, 'item') : 'nothing owed') + '</em></div>' +
      '<div><span>Not sent yet</span><b>' + esc(money(d.toSendTotal)) + '</b><em class="' + nudge.trim() + '">' + esc(d.oldest ? 'oldest ' + short(d.oldest.date) + ', ' + (d.oldest.days ? days(d.oldest.days) + ' ago' : 'today') : d.toSend.length ? plural(d.toSend.length, 'item') : 'all sent') + '</em></div>' +
      '<div><span>' + esc('Waiting for ' + e.label) + '</span><b>' + esc(money(d.sentTotal)) + '</b><em class="' + (d.chase.length ? 'is-crit' : '') + '">' + esc(oldPack ? 'oldest sent ' + short(oldPack.date) + ', ' + (oldPack.days ? days(oldPack.days) + ' ago' : 'today') : 'nothing sent') + '</em></div>' +
      '<div><span>' + esc('Paid back since ' + short(ty)) + '</span><b>' + esc(money(wm.paidBackSince(s))) + '</b><em>this tax year</em></div>' +
      '</div>' +
      '<ol class="pb-steps" aria-label="The three steps">' +
      step(1, 'send', 'Not sent yet', d.toSend.length ? d.toSend.length + ' · ' + money(d.toSendTotal) : 'none', d.toSend.length > 0, d.nudge) +
      step(2, 'sent', 'Waiting for ' + e.label, d.sent.length ? d.sent.length + ' · ' + money(d.sentTotal) : 'none', d.sent.length > 0, d.chase.length > 0) +
      step(3, 'paid', 'Paid back', paid.length ? String(paid.length) : 'none', false, false) +
      '</ol>' +
      '<p class="pb-tally__foot">' + icon('clock') + '<span>' + esc(e.Label + ' usually pays back in about ' + days(e.repayDays) + '.') + '</span>' +
      '<button type="button" class="link link--btn" data-settings>Change</button></p></section>';

    const who = e.set ? '' : '<p class="note-line">' + icon('info') + '<span>Tell me who you work for and I’ll spot their payments to you in your bank statements.</span><button type="button" class="btn btn--sm" data-settings>Set it up in Settings</button></p>';
    const mine = pill('Your money · get it back', 'mine', 'coin');

    root.innerHTML = GU.view.head({
      eyebrow: e.set ? e.fullName || e.short : '',
      title: 'Get paid back',
      text: esc('Things you paid for ' + e.label + ' with your own money. Send them to ' + e.label + ' in one go and I’ll spot the money when it comes back.') + ' ' + mine,
      actions: '<button type="button" class="btn' + (d.toSend.length ? '' : ' btn--primary') + '" data-add-receipt>' + icon('camera') + 'Add a receipt</button>' +
        '<button type="button" class="btn" data-from-bank>' + icon('bank') + 'From my bank</button>' +
        (d.toSend.length ? '<button type="button" class="btn btn--primary" data-send' + (on.length ? '' : ' disabled') + '>' + icon('send') + '<span data-send-label>' + esc(sendLabel(e, on)) + '</span></button>' : ''),
    }) + who + tally +
      GU.ui.dropbar('Drop receipts for things you paid for', 'Photos and PDFs. I’ll read each one and add it here as your money to get back.') +
      '<div class="cols cols--main-side pb">' +
      '<div class="stack">' + sendLaneHTML(s, e, d, offers) + sentLaneHTML(s, e, d, pr, offers) + paidLaneHTML(s, e) + '</div>' +
      '<aside class="stack">' + bankHTML(s, e, pr) + '</aside></div>' +
      '<p class="tip pb-how">' + icon('info') + '<span><b>How it works.</b> ' + esc('1. Add what you paid for: snap the receipt, or pick the payment from your bank. 2. Send to ' + e.label + ': one zip with every receipt and a summary they can print. 3. When ' + e.label + ' pays you back, import your statement and I’ll tick it off. Nothing here counts as your own spending or income.') + '</span></p>';

    GU.ui.wireDropbar(root, (files) => GU.inbox.add({ files, scope: { kind: 'work', area: 'back', payer: 'me', name: pageAt('work-back', 'Work › Get paid back') } }));
    const det = root.querySelector('#pb-paid');
    if (det) det.addEventListener('toggle', () => (ui.paidOpen = det.open));
    // The page is drawn again after every change, so which 'From your bank' lists are open is kept here.
    root.querySelectorAll('.pb-fold').forEach((d) => d.addEventListener('toggle', () => (ui.fold[d.dataset.fold] = d.open)));
    root.addEventListener('change', onChange);
    root.addEventListener('click', onClick);
  }
  function step(n, lane, label, count, now, alert) {
    return '<li class="' + (now ? 'is-now' : '') + (alert ? ' is-alert' : '') + '"><button type="button" class="pb-steps__btn" data-jump="' + lane + '">' +
      '<span class="pb-n" aria-hidden="true">' + n + '</span><span class="pb-steps__text"><b>' + esc(label) + '</b><em>' + esc(count) + '</em></span></button></li>';
  }

  /* Ticking only changes Not sent yet and the Send button, so just those are redrawn. */
  function redrawSendLane(root) {
    const s = store.state;
    const wm = W();
    const e = wm.employer(s);
    const d = wm.dueBack(s);
    const offers = new Map(wm.prompts(s).purchases.map((o) => [o.p.id, o]));
    const lane = root.querySelector('#pb-send');
    if (lane) {
      const box = document.createElement('div');
      box.innerHTML = sendLaneHTML(s, e, d, offers);
      const fresh = box.firstChild;
      lane.replaceWith(fresh);
      GU.ui.hydrate(fresh);
    }
    const on = ticked(d);
    const label = root.querySelector('[data-send-label]');
    if (label) {
      label.textContent = sendLabel(e, on);
      label.parentElement.disabled = !on.length;
    }
  }
  function onChange(ev) {
    const t = ev.target.closest('[data-tick]');
    if (!t) return;
    if (t.checked) ui.off.delete(t.dataset.tick);
    else ui.off.add(t.dataset.tick);
    const root = ev.currentTarget;
    redrawSendLane(root);
    const again = root.querySelector('[data-tick="' + CSS.escape(t.dataset.tick) + '"]');
    if (again) again.focus();
  }

  function idsOfPack(key) {
    const p = W().packs(store.state).find((x) => x.key === key);
    return p ? p.items.map((x) => x.p.id) : [];
  }
  function onClick(ev) {
    const wm = W();
    const b = (sel) => ev.target.closest(sel);
    const root = ev.currentTarget;
    let el;
    if ((el = b('[data-jump]'))) {
      const to = root.querySelector('#pb-' + el.dataset.jump);
      if (to) {
        if (to.tagName === 'DETAILS') {
          to.open = true;
          ui.paidOpen = true;
        }
        to.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
      return;
    }
    if (b('[data-tick-all]')) {
      const d = wm.dueBack(store.state);
      if (ticked(d).length === d.toSend.length) d.toSend.forEach((x) => ui.off.add(x.p.id));
      else ui.off.clear();
      return redrawSendLane(root);
    }
    if (b('[data-send]')) return sendDialog();
    if (b('[data-add-receipt]')) return addReceipt();
    if (b('[data-from-bank]')) return addFromBank();
    if (b('[data-settings]')) return GU.view.go('settings');
    if ((el = b('[data-add-file]'))) return addFile(el.dataset.addFile);
    if ((el = b('[data-files]'))) {
      const p = store.find(P, el.dataset.files);
      if (p && (p.files || []).length) return viewFiles(p.files, 0, name(p));
      return addFile(el.dataset.files);
    }
    if ((el = b('[data-find]'))) return findPaymentDialog(el.dataset.find);
    if ((el = b('[data-use-bank]'))) {
      const [id, tx] = el.dataset.useBank.split(':');
      return wm.linkPurchase(id, tx, { useBankAmount: true });
    }
    if ((el = b('[data-link]'))) {
      const [id, tx] = el.dataset.link.split(':');
      return wm.linkPurchase(id, tx);
    }
    if ((el = b('[data-not-purchase]'))) {
      const [id, tx] = el.dataset.notPurchase.split(':');
      return wm.notPurchase(id, tx);
    }
    if ((el = b('[data-more]'))) return moreMenu(el, el.dataset.more);
    if ((el = b('[data-remind]'))) return sendDialog(idsOfPack(el.dataset.remind));
    if ((el = b('[data-paidback]'))) return paidBackDialog(idsOfPack(el.dataset.paidback));
    if ((el = b('[data-repaid]'))) return wm.markPaidBack(el.dataset.ids.split(','), { txId: el.dataset.repaid });
    if ((el = b('[data-not-repaid]'))) return wm.notRepayment(el.dataset.ids.split(','), el.dataset.notRepaid);
    if ((el = b('[data-which]'))) return repaymentDialog(el.dataset.which);
    if ((el = b('[data-claim-tx]'))) return wm.claimFromTx([el.dataset.claimTx]);
    if ((el = b('[data-not-work]'))) return wm.notWork([el.dataset.notWork]);
    if ((el = b('[data-credit-ok]'))) return wm.creditOk([el.dataset.creditOk]);
    if (b('[data-credits-ok]')) return wm.creditOk(wm.prompts(store.state).noClaimCredits.map((x) => x.tx.id));
    if ((el = b('[data-wages]'))) return wm.markWages(el.dataset.wages);
    if ((el = b('[data-bank-more]'))) {
      ui.all[el.dataset.bankMore] = !ui.all[el.dataset.bankMore];
      return GU.render();
    }
    if ((el = b('[data-pay-first]'))) return GU.tabs.receipts.markPaid(el.dataset.payFirst);
    if ((el = b('[data-tx]'))) return GU.tabs.transactions.edit(el.dataset.tx);
    if ((el = b('[data-edit]'))) return GU.view.open({ c: P, id: el.dataset.edit });
  }

  /* ---------- adding ---------- */
  /* The receipt form, set to Work and your money. Saved with an older form that doesn't ask whose money
     it was, it's still filed here. */
  function addReceipt() {
    const r = GU.tabs.receipts;
    if (!r || !r.create) return;
    r.create({
      values: { kind: 'receipt', context: 'work', payer: 'me', claimStatus: 'to-send', date: today() },
      onSaved: (rec) => {
        const cur = rec && store.find(P, rec.id);
        if (!cur) return;
        if (cur.context === 'work' && !cur.payer) W().setPayer(P, cur.id, 'me');
        else if (cur.context === 'work' && cur.payer === 'me' && !cur.purchaseTx) W().reconcile({ quiet: true, history: true });
      },
    });
  }
  /* Adds photos or PDFs to a claim. */
  async function addFile(id) {
    const picked = await GU.ui.pickFiles();
    if (!picked.length) return false;
    const metas = [];
    for (const f of picked) metas.push(await GU.files.add(f));
    store.commit((st) => {
      const p = (st.paperwork || []).find((x) => x.id === id);
      if (p) p.files = (p.files || []).concat(metas);
    });
    toast(picked.length === 1 ? 'Receipt added' : plural(picked.length, 'file') + ' added');
    return true;
  }

  /* The one ⋯ menu (js/organise.js): Open, Rename, Move to… (Home, or who paid), Duplicate, Download, then what's
     special to a claim here, then Delete. */
  function moreMenu(anchor, id) {
    const wm = W();
    const p = store.find(P, id);
    if (!p) return;
    const st = wm.stage(p);
    const unpaid = p.kind === 'invoice-in' && p.status !== 'paid';
    const items = [];
    items.push({ icon: 'camera', label: (p.files || []).length ? 'Add another file' : 'Add the receipt', hint: 'A photo or PDF', onClick: () => addFile(id) });
    if (p.purchaseTx) items.push({ icon: 'x', label: 'Not this bank payment', hint: 'Unlink it', onClick: () => wm.unlinkPurchase(id) });
    else if (st !== 'paid-back') items.push({ icon: 'search', label: 'Find the payment', hint: 'In your bank statements', onClick: () => findPaymentDialog(id) });
    if (st === 'to-send' && !unpaid) {
      items.push({ icon: 'send', label: 'I’ve already sent this', hint: 'Marks it as sent today', onClick: () => wm.markSent([id]) });
      items.push({ icon: 'check', label: 'Already paid back…', onClick: () => paidBackDialog([id]) });
    }
    if (st === 'sent') {
      items.push({ icon: 'check', label: 'Paid back…', onClick: () => paidBackDialog([id]) });
      items.push({ icon: 'left', label: 'Take out of this pack', hint: 'Back to Not sent yet', onClick: () => wm.unsend([id]) });
    }
    if (st === 'paid-back' || (p.repayments || []).length) items.push({ icon: 'repeat', label: 'Not paid back yet', hint: 'Back to waiting', onClick: () => wm.unrepay([id]) });
    GU.organise.itemMenu(anchor, P, id, items);
  }

  /* ---------- sending ---------- */
  /* Sends things to the employer: the ticked ones not sent yet (or ids), or a reminder for a pack already
     sent. Download, Share or Copy message, and 'Mark these as sent today' (ticked by default). */
  function sendDialog(ids) {
    const wm = W();
    const s = store.state;
    const e = wm.employer(s);
    let rows;
    if (ids && ids.length) {
      const want = new Set(ids);
      rows = wm.claims(s, 'open').filter((x) => want.has(x.p.id) && !x.unpaid);
    } else rows = ticked(wm.dueBack(s));
    const remind = rows.length > 0 && rows.every((x) => x.stage === 'sent');
    if (!remind) rows = rows.filter((x) => x.stage === 'to-send');
    if (!rows.length) {
      toast('Nothing to send yet. Add what you paid for first.');
      return null;
    }
    const idsNow = rows.map((x) => x.p.id);
    const total = remind ? sum(rows, (x) => x.left) : sum(rows, (x) => x.amount);
    const dates = rows.map((x) => x.p.date).filter(Boolean).sort();
    const range = dates.length ? (dates[0] === dates[dates.length - 1] ? short(dates[0]) : short(dates[0]) + ' to ' + short(dates[dates.length - 1])) : '';
    const sentOn = remind ? rows.map((x) => x.p.claimedDate).filter(Boolean).sort()[0] : '';
    const packId = remind ? rows[0].p.packId || '' : '';
    const canShare = typeof navigator !== 'undefined' && !!navigator.share;
    const c = e.label;
    const intro = remind
      ? '<b>' + esc(plural(rows.length, 'thing') + ' · ' + money(total) + ' still to come') + '</b>' + esc((sentOn ? ', sent ' + short(sentOn) : '') + (packId ? ' (' + packId + ')' : '') + '. I’ll make the same pack again with a reminder.')
      : '<b>' + esc(plural(rows.length, 'thing') + ' · ' + money(total)) + '</b>' + esc((range ? ', ' + range : '') + '. I’ll put every receipt in one zip with a summary ' + c + ' can print or save as a PDF.');
    const d = GU.ui.openDialog({
      title: remind ? 'Remind ' + c : 'Send to ' + c,
      wide: true,
      className: 'dlg--send',
      body: '<div data-step="pick"><p class="dlg__intro">' + intro + '</p><ol class="pb-send" data-list></ol><div data-warn></div>' +
        '<div class="field"><label class="field__label" for="pb-msg">Message</label><textarea id="pb-msg" rows="4"></textarea>' +
        '<p class="field__help">Change it if you like. ‘Copy message’ adds the list of items under it.</p></div>' +
        (remind ? '' : '<label class="check pb-send__mark"><input type="checkbox" id="pb-mark" checked><span>Mark these as sent today</span></label>') + '</div>',
      footer: '<button type="button" class="btn" data-copy>' + icon('note') + 'Copy message</button>' +
        (canShare ? '<button type="button" class="btn" data-share>' + icon('send') + 'Share</button>' : '') +
        '<span class="spacer"></span><button type="submit" class="btn btn--primary" data-download>' + icon('download') + 'Download claim pack</button>',
    });
    const msg = d.body.querySelector('#pb-msg');
    msg.value = wm.message(idsNow, 'back');
    const list = d.body.querySelector('[data-list]');
    const warn = d.body.querySelector('[data-warn]');
    const draw = () => {
      const st = store.state;
      const recs = idsNow.map((id) => (st.paperwork || []).find((p) => p.id === id)).filter(Boolean);
      list.innerHTML = recs.map((p) => {
        const tx = txOf(st, p.purchaseTx);
        const has = (p.files || []).length;
        const proof = has ? pill(has > 1 ? has + ' files' : 'Receipt', 'good', 'check')
          : (tx ? pill('Bank payment ' + short(tx.date), 'muted', 'bank') : pill('No receipt', 'warn', 'alert')) + '<button type="button" class="pb-link" data-add-file="' + esc(p.id) + '">' + icon('camera') + 'Add</button>';
        return '<li><span class="pb-send__date">' + esc(p.date ? short(p.date) : '–') + '</span><span class="pb-send__main"><b>' + esc(shop(p)) + '</b>' + (what(p) ? '<em>' + esc(what(p)) + '</em>' : '') + '</span>' +
          '<span class="pb-send__proof">' + proof + '</span><b class="pb-send__amt">' + esc(noAmount(p) ? 'No amount' : money(remind ? wm.left(p) : amountOf(p))) + '</b></li>';
      }).join('');
      const missing = recs.filter((p) => !(p.files || []).length).length;
      const noAmt = recs.filter(noAmount).length;
      warn.innerHTML = (missing ? '<p class="note-line">' + icon('alert') + '<span>' + esc((missing === 1 ? '1 has' : missing + ' have') + ' no receipt. Send anyway (a bank payment counts as proof) or add one.') + '</span></p>' : '') +
        (noAmt ? '<p class="note-line">' + icon('alert') + '<span>' + esc((noAmt === 1 ? '1 has' : noAmt + ' have') + ' no amount, so the total is short. Add it from the item’s Edit.') + '</span></p>' : '');
      GU.ui.hydrate(list);
    };
    draw();
    d.body.addEventListener('click', async (ev) => {
      const add = ev.target.closest('[data-add-file]');
      if (!add) return;
      ev.preventDefault();
      if (await addFile(add.dataset.addFile)) draw();
    });
    let busy = false;
    const buttons = () => Array.from(d.el.querySelectorAll('.dlg__foot .btn'));
    const mark = () => !remind && !!(d.body.querySelector('#pb-mark') || {}).checked;
    async function run(kind) {
      if (busy) return;
      busy = true;
      buttons().forEach((x) => (x.disabled = true));
      const text = msg.value.trim();
      try {
        if (kind === 'copy') {
          if (await wm.copyMessage(idsNow, 'back', { text, markSent: mark() })) d.close();
          return;
        }
        const r = await wm.pack(idsNow, 'back', { share: kind === 'share', markSent: mark(), text });
        if (!r || r.cancelled) return;
        if (r.shared) return d.close();
        if (r.saved) done(r, text);
      } catch (err) {
        console.error(err);
        toast('I couldn’t make the claim pack. Try again.');
      } finally {
        busy = false;
        buttons().forEach((x) => (x.disabled = false));
      }
    }
    // Saved: say where it is, and offer the message to send with it.
    function done(r, text) {
      d.body.innerHTML = '<div class="pb-done">' + icon('check', 'pb-done__ico') + '<h3>Claim pack saved</h3>' +
        '<p>' + esc('‘' + r.name + '’ is in your downloads. Send it to ' + c + ' by email or a message, with the note below.') + '</p>' +
        '<pre class="pb-done__msg">' + esc(text) + '</pre>' +
        (mark() || remind ? '' : '<p class="muted">' + esc('Once you’ve sent it, use ‘I’ve already sent this’ on each item, or download it again with ‘Mark these as sent today’ ticked.') + '</p>') + '</div>';
      d.el.querySelector('.dlg__foot').innerHTML = '<button type="button" class="btn" data-copy2>' + icon('note') + 'Copy message</button><span class="spacer"></span><button type="button" class="btn btn--primary" data-close>Done</button>';
      d.el.querySelector('[data-close]').addEventListener('click', d.close);
      d.el.querySelector('[data-copy2]').addEventListener('click', () => wm.copyMessage(idsNow, 'back', { text }));
    }
    d.form.addEventListener('submit', (ev) => {
      ev.preventDefault();
      run('download');
    });
    d.el.querySelector('[data-copy]').addEventListener('click', () => run('copy'));
    const sh = d.el.querySelector('[data-share]');
    if (sh) sh.addEventListener('click', () => run('share'));
    return d;
  }

  /* ---------- picking bank lines ---------- */
  function txLine(s, t, extra) {
    return '<span class="pb-pick__main"><b>' + esc(bankText(t)) + '</b><em>' + esc([fmtDate(t.date, { short: true }), acct(s, t.account), extra].filter(Boolean).join(' · ')) + '</em></span>' +
      '<b class="pb-pick__amt' + (t.amount > 0 ? ' is-in' : '') + '">' + esc(money(Math.abs(t.amount))) + '</b>';
  }
  /* A bank line matches a search by its words or its amount. */
  function matchesQ(t, q) {
    if (!q) return true;
    const amt = Math.abs(t.amount).toFixed(2);
    return String(t.description || '').toLowerCase().includes(q) || amt.includes(q.replace(/[£,]/g, ''));
  }

  /* Bank payments you made for work: tick them and each becomes a claim, with the payment as proof. */
  function addFromBank() {
    const wm = W();
    const s = store.state;
    const e = wm.employer(s);
    const used = new Set((s.paperwork || []).map((p) => p.purchaseTx).filter(Boolean));
    const notWork = new Set((s.meta && Array.isArray(s.meta.notWorkTx) && s.meta.notWorkTx) || []);
    const since = addDays(today(), -90);
    const hint = new Map(wm.prompts(s).unclaimedSpend.map((x) => [x.tx.id, x.why === 'work' ? 'marked as work' : x.shop ? 'like your ' + x.shop + ' claims' : 'a shop you’ve claimed from']));
    const pool = (s.transactions || []).filter((t) => t.amount < 0 && (t.date || '') >= since && !used.has(t.id) && !notWork.has(t.id) && !isTransfer(t) && t.category !== wm.WORK_IN)
      .sort((a, b) => (hint.has(b.id) - hint.has(a.id)) || (b.date || '').localeCompare(a.date || ''));
    if (!pool.length) {
      toast('There are no payments from the last 90 days to choose from. Import a statement first.');
      return null;
    }
    const chosen = new Set();
    const d = GU.ui.openDialog({
      title: 'Add from your bank',
      wide: true,
      body: '<p class="dlg__intro">' + esc('Tick what you paid for ' + e.label + '. Each becomes something to send, with the bank payment as proof. You can add receipts later.') + '</p>' +
        '<label class="search wk-pick__search">' + icon('search') + '<input type="search" data-q placeholder="Search by shop or amount" aria-label="Search your payments"></label>' +
        '<ul class="wk-pick pb-pick" data-list></ul>',
      footer: '<span class="pb-pick__sum muted" data-sum></span><span class="spacer"></span><button type="button" class="btn" data-close>Cancel</button><button type="submit" class="btn btn--primary" data-go disabled>Add to Get paid back</button>',
    });
    const list = d.body.querySelector('[data-list]');
    const go = d.el.querySelector('[data-go]');
    const sumEl = d.el.querySelector('[data-sum]');
    const draw = (q) => {
      q = (q || '').trim().toLowerCase();
      const rows = pool.filter((t) => matchesQ(t, q)).slice(0, 200);
      list.innerHTML = rows.map((t) => '<li><label class="check pb-pick__row"><input type="checkbox" value="' + esc(t.id) + '"' + (chosen.has(t.id) ? ' checked' : '') + '>' +
        txLine(s, t, hint.get(t.id) || '') + '</label></li>').join('') || '<li class="muted">Nothing matches.</li>';
    };
    const update = () => {
      const picked = pool.filter((t) => chosen.has(t.id));
      sumEl.textContent = picked.length ? plural(picked.length, 'payment') + ' · ' + money(sum(picked, (t) => -t.amount)) : '';
      go.disabled = !picked.length;
    };
    draw('');
    list.addEventListener('change', (ev) => {
      if (ev.target.checked) chosen.add(ev.target.value);
      else chosen.delete(ev.target.value);
      update();
    });
    d.body.querySelector('[data-q]').addEventListener('input', debounce((ev) => draw(ev.target.value), 120));
    d.form.addEventListener('submit', (ev) => {
      ev.preventDefault();
      if (!chosen.size) return;
      wm.claimFromTx(Array.from(chosen));
      d.close();
    });
    return d;
  }

  /* Which bank payment paid for a claim: likely ones first, or search them all. */
  function findPaymentDialog(id) {
    const wm = W();
    const s = store.state;
    const p = store.find(P, id);
    if (!p) return null;
    const amt = amountOf(p);
    const r = wm.purchaseFor(s, p);
    const exact = new Set(r.options.map((t) => t.id));
    const used = new Set((s.paperwork || []).filter((x) => x.purchaseTx && x.id !== id).map((x) => x.purchaseTx));
    const no = new Set(p.notPurchases || []);
    const at = p.date || p.paidDate || today();
    const base = (s.transactions || []).filter((t) => t.amount < 0 && !used.has(t.id) && !isTransfer(t) && t.category !== wm.WORK_IN)
      .sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    const gap = (t) => Math.abs(toDays(t.date) - toDays(at));
    const off = (t) => (amt > 0 ? Math.abs(-t.amount - amt) / amt : 0);
    const nearby = base.filter((t) => t.date >= addDays(at, -14) && t.date <= addDays(at, 45))
      .map((t) => ({ t, rank: exact.has(t.id) ? 0 : r.near && r.near.id === t.id ? 1 : no.has(t.id) ? 4 : off(t) <= 0.5 ? 2 : 3 }))
      .sort((a, b) => a.rank - b.rank || off(a.t) - off(b.t) || gap(a.t) - gap(b.t)).map((x) => x.t).slice(0, 60);
    const cur = p.purchaseTx || (r.sure && r.tx ? r.tx.id : '');
    const d = GU.ui.openDialog({
      title: 'Which bank payment was it?',
      wide: true,
      body: '<p class="dlg__intro">' + esc(shop(p) + (noAmount(p) ? '' : ', ' + (r.currency ? amt.toFixed(2) + ' ' + r.currency : money(amt))) + (p.date ? ', ' + fmtDate(p.date) : '') + '. Pick the payment from your bank and it’s kept out of your own spending.') + '</p>' +
        '<label class="search wk-pick__search">' + icon('search') + '<input type="search" data-q placeholder="Search all your payments by shop or amount" aria-label="Search your payments"></label>' +
        '<ul class="wk-pick pb-pick" data-list></ul>' +
        '<label class="check pb-pick__use" data-use-wrap hidden><input type="checkbox" data-use checked><span data-use-text></span></label>',
      footer: '<span class="spacer"></span><button type="button" class="btn" data-close>Cancel</button><button type="submit" class="btn btn--primary" data-go' + (cur ? '' : ' disabled') + '>Link it</button>',
    });
    const list = d.body.querySelector('[data-list]');
    const go = d.el.querySelector('[data-go]');
    const useWrap = d.body.querySelector('[data-use-wrap]');
    let chosen = cur;
    const tag = (t) => (exact.has(t.id) ? 'same amount' : r.near && r.near.id === t.id ? 'names the shop' : no.has(t.id) ? 'you said no before' : '');
    const draw = (q) => {
      q = (q || '').trim().toLowerCase();
      const rows = q ? base.filter((t) => matchesQ(t, q)).slice(0, 100) : nearby;
      list.innerHTML = rows.map((t) => '<li><label class="check pb-pick__row"><input type="radio" name="pb-tx" value="' + esc(t.id) + '"' + (chosen === t.id ? ' checked' : '') + '>' + txLine(s, t, tag(t)) + '</label></li>').join('') ||
        '<li class="muted">' + (q ? 'Nothing matches.' : 'No payments near that date. Try searching.') + '</li>';
    };
    const update = () => {
      const t = base.find((x) => x.id === chosen);
      const differs = !!t && Math.abs(-t.amount - amt) >= 0.005;
      useWrap.hidden = !differs;
      if (differs) {
        d.body.querySelector('[data-use-text]').textContent = noAmount(p) || !amt
          ? 'Use ' + money(-t.amount) + ' as the amount'
          : 'Use ' + money(-t.amount) + ', what your bank took. The receipt’s ' + (r.currency ? amt.toFixed(2) + ' ' + r.currency : money(amt)) + ' is kept as a note.';
      }
      go.disabled = !t;
    };
    draw('');
    update();
    list.addEventListener('change', (ev) => {
      chosen = ev.target.value;
      update();
    });
    d.body.querySelector('[data-q]').addEventListener('input', debounce((ev) => draw(ev.target.value), 120));
    d.form.addEventListener('submit', (ev) => {
      ev.preventDefault();
      const t = base.find((x) => x.id === chosen);
      if (!t) return;
      if (t.id !== p.purchaseTx || !useWrap.hidden) wm.linkPurchase(id, t.id, { useBankAmount: !useWrap.hidden && d.body.querySelector('[data-use]').checked });
      d.close();
    });
    return d;
  }

  /* ---------- paid back ---------- */
  /* What a payment from the employer paid you back for: tick the claims (the likely ones are ticked). */
  function repaymentDialog(txId) {
    const wm = W();
    const s = store.state;
    const e = wm.employer(s);
    const tx = txOf(s, txId);
    if (!tx) return null;
    const amt = round2(Math.abs(tx.amount));
    const sug = wm.repaymentFor(s, tx);
    const pre = new Set(sug.claims.map((p) => p.id));
    const rows = wm.claims(s, 'open').filter((x) => !x.unpaid && (!x.p.date || x.p.date <= tx.date))
      .sort((a, b) => (pre.has(b.p.id) - pre.has(a.p.id)) || ((b.stage === 'sent') - (a.stage === 'sent')) || (b.p.date || '').localeCompare(a.p.date || ''));
    const chosen = new Set(pre);
    const ref = refOf(s, tx);
    const d = GU.ui.openDialog({
      title: 'What was this payment for?',
      wide: true,
      body: '<p class="dlg__intro"><b>' + esc(money(amt)) + '</b> ' + esc('came in from ' + e.label + ' on ' + fmtDate(tx.date) + (ref ? ', ‘' + ref + '’' : '') + '. ' + (rows.length ? 'Tick what it paid you back for.' : '')) + '</p>' +
        (rows.length ? '<ul class="wk-pick pb-pick" data-list></ul><p class="field__help pb-pick__note" data-note></p>' +
          '<label class="check" data-close-wrap hidden><input type="checkbox" data-close-any><span data-close-text></span></label>'
          : '<p class="muted">' + esc('Nothing is waiting to be paid back from before this date. If it’s for something you haven’t added yet, add it first, or say it’s fine.') + '</p>'),
      footer: '<button type="button" class="btn btn--ghost" data-wages>It’s my wages</button><button type="button" class="btn btn--ghost" data-fine>That’s fine, leave it</button>' +
        '<span class="spacer"></span><button type="button" class="btn" data-close>Cancel</button>' + (rows.length ? '<button type="submit" class="btn btn--primary" data-go>Mark paid back</button>' : ''),
    });
    const list = d.body.querySelector('[data-list]');
    if (list) {
      list.innerHTML = rows.map((x) => '<li><label class="check pb-pick__row"><input type="checkbox" value="' + esc(x.p.id) + '"' + (chosen.has(x.p.id) ? ' checked' : '') + '>' +
        '<span class="pb-pick__main"><b>' + esc(name(x.p)) + '</b><em>' + esc([x.p.date ? short(x.p.date) : '', x.stage === 'sent' ? 'sent ' + short(x.p.claimedDate) : 'not sent yet', pre.has(x.p.id) ? 'looks like it' : ''].filter(Boolean).join(' · ')) + '</em></span>' +
        '<b class="pb-pick__amt">' + esc(money(x.left)) + '</b></label></li>').join('');
    }
    const note = d.body.querySelector('[data-note]');
    const closeWrap = d.body.querySelector('[data-close-wrap]');
    const go = d.el.querySelector('[data-go]');
    const update = () => {
      if (!note) return;
      const picked = rows.filter((x) => chosen.has(x.p.id));
      const tot = round2(sum(picked, (x) => x.left));
      const diff = round2(tot - amt);
      if (!picked.length) note.textContent = 'Tick at least one.';
      else if (Math.abs(diff) < 0.005) note.textContent = 'That’s exactly ' + money(amt) + '.';
      else if (diff < 0) note.textContent = 'Ticked ' + money(tot) + '. The other ' + money(-diff) + ' isn’t matched to anything.';
      else note.textContent = 'Ticked ' + money(tot) + ', ' + money(diff) + ' more than the payment. The oldest are ticked off first and ' + money(diff) + ' stays waiting.';
      closeWrap.hidden = !(diff > 0.005 && diff < 1);
      if (!closeWrap.hidden) d.body.querySelector('[data-close-text]').textContent = 'It’s ' + money(diff) + ' short. Close them anyway.';
      if (go) go.disabled = !picked.length;
    };
    update();
    if (list) list.addEventListener('change', (ev) => {
      if (ev.target.checked) chosen.add(ev.target.value);
      else chosen.delete(ev.target.value);
      update();
    });
    d.el.querySelector('[data-wages]').addEventListener('click', () => {
      wm.markWages(txId);
      d.close();
    });
    d.el.querySelector('[data-fine]').addEventListener('click', () => {
      wm.creditOk([txId]);
      d.close();
    });
    d.form.addEventListener('submit', (ev) => {
      ev.preventDefault();
      if (!chosen.size) return;
      const close = !closeWrap.hidden && d.body.querySelector('[data-close-any]').checked;
      wm.markPaidBack(Array.from(chosen), { txId, close });
      d.close();
    });
    return d;
  }

  /* Marks claims as paid back: pick the employer's payment from your bank, or just give a date and amount.
     Less than what's owed leaves the rest waiting; under £1 short can be closed anyway. */
  function paidBackDialog(ids) {
    const wm = W();
    const s = store.state;
    const e = wm.employer(s);
    const want = new Set(ids || []);
    const recs = wm.claims(s, 'open').filter((x) => want.has(x.p.id));
    if (!recs.length) return null;
    const due = round2(sum(recs, (x) => x.left));
    const from = recs.map((x) => x.p.date).filter(Boolean).sort()[0] || '';
    const used = usedCredits(s);
    const isExact = (t) => Math.abs(t.amount - due) < 0.005;
    const credits = (s.transactions || []).filter((t) => t.amount > 0 && !used.has(t.id) && (t.date || '') >= from &&
      (t.category === wm.WORK_IN || (wm.isEmployerText(s, t.description) && t.category !== 'Salary')))
      .sort((a, b) => (isExact(b) - isExact(a)) || (b.date || '').localeCompare(a.date || '')).slice(0, 40);
    const first = credits.find(isExact);
    const fmt = (n) => Math.abs(n).toFixed(2);
    const d = GU.ui.openDialog({
      title: 'Paid back',
      body: '<p class="dlg__intro">' + esc((recs.length === 1 ? name(recs[0].p) : plural(recs.length, 'thing')) + ', ' + money(due) + (recs.length > 1 ? ' in total' : '') + '. Which payment from ' + e.label + ' was it?') + '</p>' +
        '<ul class="wk-pick pb-pick" data-list>' +
        credits.map((t) => '<li><label class="check pb-pick__row"><input type="radio" name="pb-credit" value="' + esc(t.id) + '"' + (first && first.id === t.id ? ' checked' : '') + '>' + txLine(s, t, refOf(s, t) || (isExact(t) ? 'same amount' : '')) + '</label></li>').join('') +
        '<li><label class="check pb-pick__row"><input type="radio" name="pb-credit" value=""' + (first ? '' : ' checked') + '><span class="pb-pick__main"><b>No bank line, just a date</b><em>Cash, or a statement you haven’t imported</em></span></label></li></ul>' +
        '<div class="form-grid pb-pick__manual" data-manual' + (first ? ' hidden' : '') + '>' +
        '<div class="field field--half"><label class="field__label" for="pb-date">Date paid back</label><input type="date" id="pb-date" value="' + esc(today()) + '"></div>' +
        '<div class="field field--half"><label class="field__label" for="pb-amt">Amount</label><div class="money-input"><span>' + esc(GU.util.currencySymbol()) + '</span><input id="pb-amt" type="text" inputmode="decimal" autocomplete="off" value="' + esc(fmt(due)) + '"></div></div></div>' +
        '<p class="field__help pb-pick__note" data-note></p>' +
        '<label class="check" data-close-wrap hidden><input type="checkbox" data-close-any><span data-close-text></span></label>',
      footer: '<span class="spacer"></span><button type="button" class="btn" data-close>Cancel</button><button type="submit" class="btn btn--primary">Mark paid back</button>',
    });
    const manual = d.body.querySelector('[data-manual]');
    const note = d.body.querySelector('[data-note]');
    const closeWrap = d.body.querySelector('[data-close-wrap]');
    const picked = () => (d.body.querySelector('input[name="pb-credit"]:checked') || {}).value || '';
    const amountNow = () => {
      const id = picked();
      if (id) return Math.abs((credits.find((t) => t.id === id) || {}).amount || 0);
      const v = GU.util.parseAmount(d.body.querySelector('#pb-amt').value);
      return Number.isFinite(v) ? Math.abs(v) : 0;
    };
    const update = () => {
      manual.hidden = !!picked();
      const got = round2(amountNow());
      const short0 = round2(due - got);
      note.textContent = short0 > 0.005 && got > 0 ? 'That’s ' + money(short0) + ' less. The oldest are ticked off first and ' + money(short0) + ' stays waiting.' : '';
      closeWrap.hidden = !(short0 > 0.005 && short0 < 1);
      if (!closeWrap.hidden) d.body.querySelector('[data-close-text]').textContent = 'It’s ' + money(short0) + ' short. Close it anyway.';
    };
    update();
    d.body.addEventListener('change', update);
    d.body.addEventListener('input', update);
    d.form.addEventListener('submit', (ev) => {
      ev.preventDefault();
      const id = picked();
      const close = !closeWrap.hidden && d.body.querySelector('[data-close-any]').checked;
      const list = recs.map((x) => x.p.id);
      if (id) wm.markPaidBack(list, { txId: id, close });
      else {
        const amount = amountNow();
        if (!(amount > 0)) {
          toast('Put in how much you got back.');
          return;
        }
        wm.markPaidBack(list, { date: d.body.querySelector('#pb-date').value || today(), amount, close });
      }
      d.close();
    });
    return d;
  }

  GU.payback = { sendDialog, addFromBank, repaymentDialog, findPaymentDialog, paidBackDialog };
  GU.tabs['work-back'] = { label: 'Get paid back', short: 'Get paid back', icon: 'coin', part: 'work', render };
})();
