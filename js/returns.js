/* The Ground Up: return-by dates (GU.returns).
   A receipt or warranty can have a last day to take the thing back (returnBy). Its row then says 'Return by 6 Nov'
   (amber within a week, red once it's gone), the timeline says 'Last day to return …' with Keep it and Returned,
   and Returned can take it out of Get paid back too. settings.returnDays (30 unless you change it) is the usual
   window offered when you file a new receipt. returned: true marks it as sent back. */
(function () {
  'use strict';
  const GU = window.GU;
  const { esc, today, addDays, daysUntil, fmtDate, relDays, money, isISO } = GU.util;
  const { icon, pill, toast, confirmBox } = GU.ui;
  const F = GU.finance;
  const store = GU.store;

  const DEFAULT_DAYS = 30;
  const SHOW_PAST = 30; // a missed date stays red on its row for this long, then it's just history
  const NAG_PAST = 7; // and stays on the timeline this long, for you to say what happened
  const NAG_AHEAD = 14; // Work's list starts mentioning it this far ahead

  /* The usual number of days to return something in: settings.returnDays, 30 if you haven't said, 0 for 'don't offer'. */
  function windowDays(state) {
    const v = ((state || store.state).settings || {}).returnDays;
    if (v === 0 || v === '0') return 0;
    const n = Math.round(Number(v));
    return n > 0 ? n : DEFAULT_DAYS;
  }
  /* Receipts and warranties are the things you can send back, and so is an order you've paid for (an invoice marked paid). */
  const asked = (v) => !!v && (v.kind === 'receipt' || v.kind === 'warranty' || (v.kind === 'invoice-in' && v.status === 'paid'));
  const laneOf = (p) => (GU.workMoney ? GU.workMoney.lane(p, 'paperwork') : p.context === 'work' ? 'unsorted' : 'home');

  /* Where a record's return stands: null (no date, or it's long gone), {returned}, or {n days left, date, tone}. */
  function status(p, now) {
    if (!p) return null;
    if (p.returned) return { returned: true };
    if (!isISO(p.returnBy)) return null;
    const n = daysUntil(p.returnBy, now);
    if (n < -SHOW_PAST) return null;
    return { n, date: p.returnBy, tone: n < 0 ? 'crit' : n <= 7 ? 'warn' : 'muted' };
  }
  /* The pill for a row: 'Return by 6 Nov' (amber within 7 days, red if past), or 'Returned'. '' when there's nothing to say. */
  function pillFor(p) {
    const st = status(p);
    if (!st) return '';
    if (st.returned) return pill('Returned', 'muted', 'undo');
    return pill('Return by ' + fmtDate(st.date, { short: true }), st.tone, st.n < 0 ? 'alert' : 'clock');
  }

  /* ---------- the receipts form ---------- */
  /* Whether a new receipt opens with 'Set return reminder' already on: only for a shop purchase that's yours to
     return, never for work you've already sent to your employer. */
  function defaultOn(values) {
    if (!values || windowDays() === 0 || values.kind !== 'receipt' || values.returnBy) return false;
    if (values.context === 'work' && values.payer === 'me' && values.claimStatus && values.claimStatus !== 'to-send') return false;
    return values.category === 'Shopping';
  }
  /* The fields: 'Return by', the one-tap reminder for a new receipt, and 'I've returned it' for one with a date. */
  function fields(values) {
    values = values || {};
    const isNew = !values.id;
    const days = windowDays();
    return [
      { name: 'returnBy', label: 'Return by', type: 'date', half: true, optional: true, showIf: asked, help: 'The last day you can take it back.' },
      { name: 'returnOn', type: 'checkbox', checkLabel: 'Set return reminder (' + days + ' days)', showIf: (v) => isNew && days > 0 && asked(v) },
      { name: 'returned', type: 'checkbox', checkLabel: 'I’ve returned it', showIf: (v) => !isNew && asked(v) && !!(v.returnBy || v.returned) },
    ];
  }
  /* Keeps the 'Return by' date in step with the reminder toggle: on fills it (from the date on the receipt), off
     clears it again, as long as you haven't typed a date of your own. Called each time the form changes. */
  function syncForm(v, form) {
    const on = form.elements.returnOn;
    const to = form.elements.returnBy;
    if (!on || !to || on.disabled || to.disabled) return;
    const first = on.dataset.was === undefined;
    const now = on.checked ? '1' : '0';
    const auto = to.dataset.auto !== undefined && to.value === to.dataset.auto;
    const base = isISO(v.date) ? v.date : today();
    const want = addDays(base, windowDays());
    if (first || on.dataset.was !== now) {
      on.dataset.was = now;
      if (on.checked && !to.value && want >= today()) to.value = to.dataset.auto = want;
      else if (!on.checked && auto) {
        to.value = '';
        delete to.dataset.auto;
      }
    } else if (on.checked && auto && to.value !== want && want >= today()) to.value = to.dataset.auto = want;
  }
  /* On saving the form: the reminder toggle fills the date if it's still empty, and empty fields don't stay on the record. */
  function tidy(rec, v) {
    if (v && v.returnOn && asked(rec) && !rec.returnBy) rec.returnBy = addDays(isISO(rec.date) ? rec.date : today(), windowDays());
    delete rec.returnOn;
    if (!rec.returnBy) delete rec.returnBy;
    if (rec.returned) rec.returnedDate = rec.returnedDate || today();
    else {
      delete rec.returned;
      delete rec.returnedDate;
    }
  }

  /* ---------- the buttons: Keep it, Returned ---------- */
  const name = (p) => p.title || p.party || 'it';
  function actionsHTML(id) {
    return '<button type="button" class="btn btn--sm btn--ghost" data-ret="keep:' + esc(id) + '">Keep it</button>' +
      '<button type="button" class="btn btn--sm btn--soft" data-ret="returned:' + esc(id) + '">' + icon('undo') + 'Returned</button>';
  }
  /* Keeping it: no more reminders. */
  function keep(id) {
    const p = store.find('paperwork', id);
    if (!p || !p.returnBy) return;
    const was = p.returnBy;
    store.commit((s) => {
      const x = s.paperwork.find((y) => y.id === id);
      if (x) delete x.returnBy;
    });
    toast('OK, you’re keeping ' + name(p) + '. I won’t remind you about returning it', {
      action: 'Undo',
      onAction: () => store.commit((s) => {
        const x = s.paperwork.find((y) => y.id === id);
        if (x) x.returnBy = was;
      }),
    });
  }
  /* Sent back. If it was in Get paid back and not sent to your employer yet, offers to take it out of there. */
  async function markReturned(id) {
    const p = store.find('paperwork', id);
    if (!p || p.returned) return;
    const W = GU.workMoney;
    const claim = !!(W && W.isClaim(p));
    const stage = claim ? W.stage(p) : '';
    const c = GU.parts && GU.parts.co ? GU.parts.co(store.state) : 'the company';
    let text = 'Marked ' + name(p) + ' as returned';
    if (stage === 'sent') text += '. You’d already sent it to ' + c + ', so let them know';
    else if (stage === 'paid-back') text += '. ' + c + ' had already paid you back for it';
    store.commit((s) => {
      const x = s.paperwork.find((y) => y.id === id);
      if (x) Object.assign(x, { returned: true, returnedDate: today() });
    });
    toast(text, {
      action: 'Undo',
      timeout: 10000,
      onAction: () => store.commit((s) => {
        const x = s.paperwork.find((y) => y.id === id);
        if (x) {
          delete x.returned;
          delete x.returnedDate;
        }
      }),
    });
    if (claim && stage === 'to-send') {
      const amount = Math.abs(Number(p.amount) || 0);
      const ok = await confirmBox({
        title: 'Take it out of Get paid back?',
        message: esc('You’ve sent ' + name(p) + ' back, so there’s nothing to claim' + (amount ? ' (' + money(amount) + ')' : '') + '. I can take it out of Get paid back so you don’t ask ' + c + ' for it. It stays in Settings → Recently deleted for 30 days.'),
        confirmLabel: 'Take it out',
      });
      if (ok) takeOut(id);
    }
  }
  /* Moves a claim to Recently deleted and puts its bank payment back to what it was (so it isn't suggested as work again). */
  function takeOut(id) {
    let was = null;
    let entry = null;
    store.commit((st) => {
      const p = (st.paperwork || []).find((x) => x.id === id);
      if (!p) return;
      const t = p.purchaseTx ? st.transactions.find((x) => x.id === p.purchaseTx) : null;
      st.meta = st.meta || {};
      was = { p, tx: t ? t.id : null, cat: t ? t.category : null, had: Object.prototype.hasOwnProperty.call(st.meta, 'notWorkTx'), notWork: st.meta.notWorkTx };
      st.paperwork = st.paperwork.filter((x) => x !== p);
      const rec = Object.assign({}, p);
      delete rec.purchaseTx;
      delete rec.purchaseWas;
      entry = GU.trash ? GU.trash.put(st, 'paperwork', rec, rec.title || rec.party) : null;
      if (t) {
        if (t.category === F.WORK_OUT) t.category = p.purchaseWas || '';
        st.meta.notWorkTx = Array.from(new Set((Array.isArray(st.meta.notWorkTx) ? st.meta.notWorkTx : []).concat(t.id)));
      }
    });
    if (!was) return;
    toast('Took ' + name(was.p) + ' out of Get paid back', {
      action: 'Undo',
      onAction: () => store.commit((st) => {
        if (!st.paperwork.some((x) => x.id === id)) st.paperwork.push(was.p);
        const t = was.tx ? st.transactions.find((x) => x.id === was.tx) : null;
        if (t && was.cat != null) t.category = was.cat;
        if (entry) st.trash = (st.trash || []).filter((e) => e.id !== entry.id);
        if (was.had) st.meta.notWorkTx = was.notWork;
        else delete st.meta.notWorkTx;
      }),
    });
  }
  document.addEventListener('click', (e) => {
    const b = e.target.closest && e.target.closest('[data-ret]');
    if (!b) return;
    e.preventDefault();
    const [what, id] = b.getAttribute('data-ret').split(':');
    if (what === 'keep') keep(id);
    else if (what === 'returned') markReturned(id);
  });

  /* ---------- Work's list of things to do ---------- */
  /* Last days to return something for work, in the shape of Work › Overview's checks. Things you pay for yourself are
     in Get paid back, the business's own in its page. */
  function checks(state) {
    const out = [];
    for (const p of state.paperwork || []) {
      const st = status(p);
      if (!st || st.returned || st.n > NAG_AHEAD || st.n < -NAG_PAST) continue;
      const lane = laneOf(p);
      if (lane === 'home') continue;
      const when = fmtDate(st.date, { short: true });
      out.push({
        level: st.n >= 0 && st.n <= 7 ? 'warn' : 'info', area: lane === 'back' ? 'back' : 'invoices',
        title: 'Last day to return ' + name(p) + (p.amount != null && p.amount !== '' ? ' (' + money(Math.abs(p.amount)) + ')' : ''),
        detail: st.n < 0 ? 'Was ' + when + '. Did you send it back?' : 'Return by ' + when + ', ' + relDays(st.date),
        ref: { c: 'paperwork', id: p.id },
        acts: [{ label: 'Keep it', attr: 'data-ret="keep:' + esc(p.id) + '"', icon: 'check' }, { label: 'Returned', attr: 'data-ret="returned:' + esc(p.id) + '"', icon: 'undo' }],
      });
    }
    return out;
  }

  GU.returns = { windowDays, status, pill: pillFor, defaultOn, fields, syncForm, tidy, actionsHTML, keep, markReturned, takeOut, checks, NAG_PAST };
})();
