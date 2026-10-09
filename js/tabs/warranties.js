/* The Ground Up: Warranties (Paperwork). What's under warranty and when each one runs out.
   There is no data of its own: a warranty is a paperwork record (kind 'warranty', or any record of your own with a
   warranty end date), so the receipts you already have show here, and nothing needs moving. The fields it keeps:
     title (the item), party (the shop or brand), date (bought on), amount (the price), reference (serial or order
     number), warrantyUntil (the last day of cover), warrantyMonths (how long it lasts, when that is how it was set)
     and warrantyLifetime (true for a lifetime warranty), plus notes and files as everywhere else.
   Dates are what you entered or what was read from the document: nothing is guessed, and a warranty with no end date
   says "Add the end date". Reminders come from GU.agenda.extra (Today, and the count on this page's tab). */
(function () {
  'use strict';
  const GU = window.GU;
  const { esc, uid, today, money, fmtDate, daysUntil, toDays, addMonths, plural, debounce, isISO } = GU.util;
  const { icon, pill, emptyState, chips, formDialog, toast, thumbHTML, viewFiles } = GU.ui;
  const store = GU.store;

  const DEFAULT_WARN = 60; // days before the end that it's flagged (settings.warrantyWarnDays)
  const CRIT_DAYS = 14; // inside this it's red, and Today says so
  const RECENT_DAYS = 14; // an ended warranty is mentioned on Today for this long
  const SHOWN_FILES = 4; // file chips on a card before "+ n more"
  const WARN_CHOICES = [14, 30, 60, 90, 120, 180];
  const LENGTHS = [
    { value: '12', label: '1 year' }, { value: '24', label: '2 years' }, { value: '36', label: '3 years' },
    { value: '60', label: '5 years' }, { value: '120', label: '10 years' },
    { value: 'lifetime', label: 'Lifetime' }, { value: 'custom', label: 'Another length…' },
  ];
  const FILTERS = ['all', 'covered', 'soon', 'ended', 'nodate'];
  /* What the page remembers while you use it (not saved). */
  const ui = { filter: 'all', q: '' };

  const isWork = (p) => !!p && p.context === 'work';
  /* A warranty of your own: filed as one, or any record of yours with an end date (a receipt that says how long it's covered). */
  const isWarranty = (p) => !!p && !isWork(p) && (p.kind === 'warranty' || !!p.warrantyUntil || !!p.warrantyLifetime);
  const warnDays = (s) => {
    const n = Number(((s || store.state).settings || {}).warrantyWarnDays);
    return n > 0 ? Math.round(n) : DEFAULT_WARN;
  };
  const clip = (t, n) => (String(t).length > (n || 40) ? String(t).slice(0, (n || 40) - 1).trim() + '…' : String(t));
  const quote = (t) => '‘' + clip(t) + '’';
  const hasMoney = (v) => v != null && v !== '' && Number.isFinite(Number(v));

  /* ---------- how far along each warranty is ---------- */
  /* key: covered, soon (ends within the warning time), ended, lifetime, or nodate. days: to the end (negative once ended). progress: 0 to 1 of the
     cover gone, only when both the purchase date and the end are known. */
  function infoOf(p, t, warn) {
    const until = isISO(p.warrantyUntil) ? p.warrantyUntil : '';
    let key;
    let days = null;
    if (p.warrantyLifetime) key = 'lifetime';
    else if (!until) key = 'nodate';
    else {
      days = daysUntil(until, t);
      key = days < 0 ? 'ended' : days <= warn ? 'soon' : 'covered';
    }
    let progress = null;
    if (until && !p.warrantyLifetime && isISO(p.date) && toDays(until) > toDays(p.date)) {
      progress = Math.max(0, Math.min(1, (toDays(t) - toDays(p.date)) / (toDays(until) - toDays(p.date))));
    }
    return { p, key, days, until: p.warrantyLifetime ? '' : until, progress, covered: key === 'covered' || key === 'soon' || key === 'lifetime' };
  }
  const infos = (s) => {
    const t = today();
    const warn = warnDays(s);
    return (s.paperwork || []).filter(isWarranty).map((p) => infoOf(p, t, warn));
  };
  /* What ends soonest first; then a lifetime one, then ones with no end date yet; the ones that ended last, most recent first. */
  const ORDER = { covered: 0, soon: 0, lifetime: 1, nodate: 2, ended: 3 };
  function sortInfos(list) {
    return list.sort((a, b) => ORDER[a.key] - ORDER[b.key]
      || (a.key === 'ended' ? b.until.localeCompare(a.until) : a.until.localeCompare(b.until))
      || String(a.p.title || '').localeCompare(String(b.p.title || '')));
  }

  /* ---------- words ---------- */
  /* '12 days', '3 weeks', '4 months', '2 years' for a number of days from 2 up. */
  function span(n) {
    n = Math.abs(n);
    if (n < 14) return plural(n, 'day');
    if (n < 56) return plural(Math.round(n / 7), 'week');
    const m = Math.round(n / 30.44);
    if (m < 24) return plural(m, 'month');
    return plural(Math.round(n / 365.25), 'year');
  }
  /* 'ends today', 'ends in 3 weeks', 'ended 12 days ago'. */
  function endsPhrase(days) {
    if (days === 0) return 'ends today';
    if (days === 1) return 'ends tomorrow';
    if (days === -1) return 'ended yesterday';
    return days > 0 ? 'ends in ' + span(days) : 'ended ' + span(days) + ' ago';
  }
  const cap = (t) => t.charAt(0).toUpperCase() + t.slice(1);
  /* '2 years', '18 months', 'Lifetime', or '' when how long it lasts isn't known. */
  function lengthLabel(p) {
    if (p.warrantyLifetime) return 'Lifetime';
    const m = Number(p.warrantyMonths);
    if (!(m > 0)) return '';
    return m % 12 === 0 ? plural(m / 12, 'year') : plural(m, 'month');
  }
  /* '2-year warranty', '18-month warranty', 'lifetime warranty', for a card. */
  function lengthPhrase(p) {
    if (p.warrantyLifetime) return 'Lifetime warranty';
    const m = Number(p.warrantyMonths);
    if (!(m > 0)) return '';
    return (m % 12 === 0 ? m / 12 + '-year' : m + '-month') + ' warranty';
  }
  const STATUS_WORDS = { covered: 'Covered', soon: 'Ending soon', ended: 'Ended', lifetime: 'Lifetime', nodate: 'No end date' };
  function statusPill(i) {
    switch (i.key) {
      case 'covered': return pill('Covered', 'good', 'shield');
      case 'soon': return pill('Ending soon', i.days <= CRIT_DAYS ? 'crit' : 'warn', 'clock');
      case 'ended': return pill('Ended', 'muted');
      case 'lifetime': return pill('Lifetime', 'good', 'shield');
      default: return pill('Add the end date', 'info', 'edit');
    }
  }
  const countdown = (i) => (i.key === 'lifetime' ? 'Covered for life' : i.key === 'nodate' ? '' : cap(endsPhrase(i.days)));

  /* ---------- the list ---------- */
  function matches(i) {
    if (ui.filter === 'covered' && !i.covered) return false;
    if (ui.filter !== 'all' && ui.filter !== 'covered' && ui.filter !== i.key) return false;
    const q = ui.q.trim().toLowerCase();
    if (!q) return true;
    const p = i.p;
    const hay = [p.title, p.party, p.reference, p.notes, (p.files || []).map((f) => f && f.name).join(' ')].join(' ').toLowerCase();
    return q.split(/\s+/).every((w) => hay.includes(w));
  }
  const visible = (s) => sortInfos(infos(s).filter(matches));

  GU.organise.lists.warranties = () => ({
    name: 'Warranties',
    head: ['Item', 'Bought from', 'Bought on', 'Length', 'Ends', 'Status', 'Price', 'Serial or order number', 'Notes', 'Files'],
    rows: visible(store.state).map((i) => [i.p.title || '', i.p.party || '', i.p.date || '', lengthLabel(i.p), i.until, STATUS_WORDS[i.key],
      hasMoney(i.p.amount) ? Number(i.p.amount) : '', i.p.reference || '', i.p.notes || '', (i.p.files || []).length]),
  });

  const bar = (i) => {
    if (i.progress == null) return '';
    const pc = Math.round(i.progress * 100);
    return '<div class="wr-bar" title="' + pc + '% of the warranty has gone"><span class="wr-bar__track" role="img" aria-label="' + pc + '% of the warranty has gone"><i style="width:' + pc + '%"></i></span>' +
      '<span class="wr-bar__txt">' + pc + '% used</span></div>';
  };
  function filesRow(p) {
    const files = (p.files || []).filter((f) => f && f.id);
    const id = esc(p.id);
    return '<div class="wr-files">' + files.slice(0, SHOWN_FILES).map((f, k) =>
      '<button type="button" class="wr-file" data-wr-file="' + id + ':' + k + '" title="Open ' + esc(f.name) + '">' +
      (GU.ui.isImage(f.type) ? '<img alt="" data-file="' + esc(f.id) + '">' : icon('file')) + '<span>' + esc(f.name) + '</span></button>').join('') +
      (files.length > SHOWN_FILES ? '<button type="button" class="wr-file wr-file--more" data-wr-view="' + id + '">+ ' + (files.length - SHOWN_FILES) + ' more</button>' : '') +
      '<button type="button" class="wr-add" data-wr-addfile="' + id + '">' + icon('plus') + (files.length ? 'Add a file' : 'Add the receipt or card') + '</button></div>';
  }
  function rowHTML(i) {
    const p = i.p;
    const id = esc(p.id);
    const meta = [p.party, isISO(p.date) ? 'Bought ' + fmtDate(p.date, { short: true }) : '', lengthPhrase(p), p.reference ? 'Ref ' + p.reference : ''].filter(Boolean).join(' · ');
    const left = countdown(i);
    const on = i.until ? ' · ' + fmtDate(i.until) : '';
    return '<li class="doc-row wr-row wr-row--' + i.key + (i.key === 'soon' && i.days <= CRIT_DAYS ? ' is-crit' : '') + '" data-wr-row="' + id + '">' +
      '<button type="button" class="doc-row__thumb" data-wr-view="' + id + '" aria-label="' + (p.files && p.files.length ? 'View files for ' : 'Add a file to ') + esc(p.title || 'this warranty') + '">' + thumbHTML(p.files) + '</button>' +
      '<button type="button" class="doc-row__main" data-wr-edit="' + id + '">' +
      '<b>' + esc(p.title || 'Untitled') + '</b>' +
      (meta ? '<em>' + esc(meta) + '</em>' : '') +
      '<span class="doc-row__chips">' + statusPill(i) + (p.kind !== 'warranty' ? pill(p.kind === 'invoice-in' || p.kind === 'invoice-out' ? 'Invoice' : 'Receipt', 'kind-' + (p.kind || 'receipt')) : '') +
      (left ? '<span class="wr-count">' + esc(left + on) + '</span>' : '') + '</span></button>' +
      '<span class="doc-row__end">' + (hasMoney(p.amount) ? '<b>' + esc(money(p.amount)) + '</b>' : '') +
      '<span class="doc-row__btns">' + GU.ui.dlButton(p.files, p.title) + GU.organise.moreBtn('paperwork', p.id, p.title, 'warranty') + '</span></span>' +
      '<div class="wr-extra">' + bar(i) + filesRow(p) + '</div></li>';
  }

  /* ---------- the page ---------- */
  function render(root) {
    const s = store.state;
    const warn = warnDays(s);
    const intent = GU.view.intent && GU.view.intent('warranties');
    if (intent && FILTERS.includes(intent.filter)) {
      ui.filter = intent.filter;
      ui.q = '';
    }
    const all = infos(s);
    const by = (key) => all.filter((i) => i.key === key);
    const covered = all.filter((i) => i.covered);
    const soon = sortInfos(by('soon'));
    const ended = sortInfos(by('ended'));
    const nodate = by('nodate');
    if (!FILTERS.includes(ui.filter) || (ui.filter === 'nodate' && !nodate.length)) ui.filter = 'all';
    const counts = { all: all.length, covered: covered.length, soon: soon.length, ended: ended.length, nodate: nodate.length };
    const filterOpts = [{ value: 'all', label: 'All' }, { value: 'covered', label: 'Covered' }, { value: 'soon', label: 'Ending soon' }, { value: 'ended', label: 'Ended' }]
      .concat(nodate.length ? [{ value: 'nodate', label: 'No end date' }] : []).map((o) => Object.assign(o, { count: counts[o.value] }));
    const calendar = GU.calendar && typeof GU.calendar.openDialog === 'function';
    const nextEnd = sortInfos(covered.filter((i) => i.until))[0];

    const summary = !all.length ? '' :
      '<div class="ledger wr-ledger">' +
      '<div><span>Covered now</span><b>' + covered.length + '</b><em>' + esc(nextEnd ? 'next ends ' + fmtDate(nextEnd.until, { short: true }) : covered.length ? 'no end dates to go on' : 'nothing covered') + '</em></div>' +
      '<div><span>Ending within ' + warn + ' days</span><b class="' + (soon.some((i) => i.days <= CRIT_DAYS) ? 'is-crit' : '') + '">' + soon.length + '</b><em>' + esc(soon.length ? 'soonest: ' + (soon[0].p.title || 'untitled') : 'nothing ending soon') + '</em></div>' +
      '<div><span>Ended</span><b>' + ended.length + '</b><em>' + esc(ended.length ? 'latest ended ' + fmtDate(ended[0].until, { short: true }) : 'nothing has run out') + '</em></div>' +
      '</div>';

    root.innerHTML = GU.view.head({
      eyebrow: 'Paperwork',
      title: 'Warranties',
      text: 'What’s under warranty, and when each one runs out. Add a receipt, a warranty card or a photo and I’ll read what I can.',
      actions: (calendar && all.length ? '<button type="button" class="btn" data-wr-cal>' + icon('bills') + 'Add end dates to my calendar</button>' : '') +
        GU.organise.listButton('warranties') + '<button type="button" class="btn btn--primary" data-wr-add>' + icon('plus') + 'Add a warranty</button>',
    }) +
      '<div class="dropbar wr-drop" data-dropbar tabindex="0" role="button" aria-label="Add a warranty from a photo or PDF">' + icon('upload', 'drop__icon') +
      '<span class="dropbar__text"><b>Drop a receipt, warranty card or photo here</b><small>Photos or PDFs. Everything you drop makes one warranty, and nothing is saved until you press Save.</small></span>' +
      '<span class="dropbar__btns"><button type="button" class="btn btn--sm" data-db-files>' + icon('file') + 'Choose files</button></span>' +
      '<input type="file" multiple hidden data-db-input accept="' + GU.ui.ACCEPT + '"></div>' +
      summary +
      (nodate.length && ui.filter !== 'nodate' ? '<p class="note-line">' + icon('alert') + '<span>' + esc(plural(nodate.length, 'warranty', 'warranties') + (nodate.length === 1 ? ' has' : ' have') + ' no end date yet, so I can’t remind you when ' + (nodate.length === 1 ? 'it runs' : 'they run') + ' out.') + '</span>' +
        '<button type="button" class="btn btn--sm" data-chip="filter" data-value="nodate">Show ' + (nodate.length === 1 ? 'it' : 'them') + '</button></p>' : '') +
      (all.length ? '<div class="toolbar wr-toolbar">' + chips('filter', filterOpts, ui.filter) + '<span class="toolbar__gap"></span>' +
        '<label class="search">' + icon('search') + '<input type="search" id="wr-search" placeholder="Search" value="' + esc(ui.q) + '" aria-label="Search your warranties"></label></div>' : '') +
      '<section class="panel wr-panel"><div id="wr-list"></div></section>' +
      (all.length ? '<p class="wr-foot muted">' + icon('info') + '<span>Dates are as you entered them, or as I read them from the document, so check the paperwork for the exact terms. I flag a warranty on Today ' +
        '<select class="wr-warn" data-wr-warn aria-label="How long before a warranty ends I flag it">' + WARN_CHOICES.concat(WARN_CHOICES.includes(warn) ? [] : [warn]).sort((a, b) => a - b).map((n) => '<option value="' + n + '"' + (n === warn ? ' selected' : '') + '>' + n + ' days</option>').join('') + '</select> before it ends.</span></p>' : '');

    const draw = () => {
      const list = visible(store.state);
      root.querySelector('#wr-list').innerHTML = list.length ? '<ul class="doc-rows">' + list.map(rowHTML).join('') + '</ul>'
        : emptyState(all.length
          ? { icon: 'search', title: 'Nothing matches', text: 'Try another filter or search.' }
          : { icon: 'shield', title: 'No warranties yet', text: 'Drop a receipt, a warranty card or a photo of the item above, or add one by hand. I’ll keep track of when each one runs out.',
            action: '<button type="button" class="btn btn--primary" data-wr-add>' + icon('plus') + 'Add a warranty</button>' });
      GU.ui.hydrate(root);
    };
    draw();

    const search = root.querySelector('#wr-search');
    if (search) {
      search.addEventListener('input', debounce((e) => {
        ui.q = e.target.value;
        draw();
      }, 150));
    }
    GU.ui.wireDropbar(root, (files) => create({ files }));
    const warnSel = root.querySelector('[data-wr-warn]');
    if (warnSel) {
      warnSel.addEventListener('change', () => {
        const n = +warnSel.value;
        store.commit((st) => {
          st.settings.warrantyWarnDays = n;
        }, { label: 'Changed when warranties are flagged to ' + n + ' days before' });
        toast('I’ll flag a warranty ' + n + ' days before it ends.');
      });
    }
    root.addEventListener('click', (e) => {
      const c = e.target.closest('[data-chip]');
      if (c) {
        ui[c.dataset.chip] = c.dataset.value;
        return GU.render();
      }
      if (e.target.closest('[data-wr-add]')) return create();
      if (e.target.closest('[data-wr-cal]')) {
        if (GU.calendar && typeof GU.calendar.openDialog === 'function') GU.calendar.openDialog({ kinds: ['warranty'], part: 'home' });
        return;
      }
      const addf = e.target.closest('[data-wr-addfile]');
      if (addf) return addFiles(addf.dataset.wrAddfile);
      const one = e.target.closest('[data-wr-file]');
      if (one) {
        const [id, k] = one.dataset.wrFile.split(':');
        const p = store.find('paperwork', id);
        if (p && p.files && p.files[+k]) viewFiles(p.files.filter((f) => f && f.id), Math.min(+k, p.files.length - 1), p.title);
        return;
      }
      const v = e.target.closest('[data-wr-view]');
      if (v) {
        const p = store.find('paperwork', v.dataset.wrView);
        if (p && p.files && p.files.length) viewFiles(p.files, 0, p.title);
        else if (p) edit(p.id);
        return;
      }
      const ed = e.target.closest('[data-wr-edit]');
      if (ed) edit(ed.dataset.wrEdit);
    });
  }

  /* ---------- the form ---------- */
  /* How long it lasts, in months, from the form's length choice (null when it isn't a length). v: {len, lenN, lenUnit}. */
  function monthsOf(v) {
    if (!v || !v.len || v.len === 'lifetime') return null;
    if (v.len === 'custom') {
      const n = Number(v.lenN);
      if (!(n > 0)) return null;
      const m = v.lenUnit === 'months' ? n : n * 12;
      return m >= 1 && m <= 1200 ? Math.round(m) : null;
    }
    const m = Number(v.len);
    return m > 0 ? m : null;
  }
  /* The length choice that shows a record's length. */
  function lenFields(p) {
    if (p.warrantyLifetime) return { len: 'lifetime' };
    const m = Number(p.warrantyMonths);
    if (!(m > 0)) return { len: '' };
    if (LENGTHS.some((o) => o.value === String(m))) return { len: String(m) };
    return m % 12 === 0 ? { len: 'custom', lenN: m / 12, lenUnit: 'years' } : { len: 'custom', lenN: m, lenUnit: 'months' };
  }
  const valuesOf = (p) => Object.assign({ title: p.title || '', party: p.party || '', date: p.date || '', amount: hasMoney(p.amount) ? p.amount : null, reference: p.reference || '', notes: p.notes || '',
    warrantyUntil: isISO(p.warrantyUntil) ? p.warrantyUntil : '', files: p.files || [], lenUnit: 'years' }, lenFields(p));

  function fields() {
    const custom = (v) => v.len === 'custom';
    return [
      { name: 'files', label: 'Photos or PDFs', type: 'files', dropLabel: 'Add the receipt, the warranty card or a photo of the item' },
      { name: 'title', label: 'What is it?', required: true, placeholder: 'e.g. Dishwasher, Dyson vacuum, Laptop' },
      { name: 'party', label: 'Bought from, or the brand', placeholder: 'e.g. Currys, Bosch', optional: true, half: true },
      { name: 'date', label: 'Bought on', type: 'date', optional: true, half: true },
      { name: 'len', label: 'How long does the warranty last?', type: 'select', options: LENGTHS, placeholder: 'Not sure yet', half: true },
      { name: 'lenN', label: 'How many?', type: 'number', placeholder: 'e.g. 18', half: true, showIf: custom },
      { name: 'lenUnit', label: 'Months or years?', type: 'segmented', half: true, default: 'years', options: [{ value: 'months', label: 'Months' }, { value: 'years', label: 'Years' }], showIf: custom },
      { name: 'warrantyUntil', label: 'Ends on', type: 'date', half: true, optional: true, showIf: (v) => v.len !== 'lifetime',
        help: 'Add the day you bought it and how long it lasts, and I’ll work this out. Change it if the paperwork says a different date.' },
      { name: 'lifeNote', type: 'html', showIf: (v) => v.len === 'lifetime', html: '<p class="field__help">A lifetime warranty has no end date, so there’s nothing to remind you about.</p>' },
      { name: 'amount', label: 'Price', type: 'money', half: true, optional: true },
      { name: 'reference', label: 'Serial or order number', half: true, optional: true },
      { name: 'notes', label: 'Notes', type: 'textarea', rows: 2, optional: true, placeholder: 'e.g. Registered online. Keep the box.' },
    ];
  }

  /* Keeps the end date in step with the day it was bought and how long it lasts, until you type a date yourself. */
  function wireForm(d, existing) {
    const form = d.form;
    const end = form.elements.warrantyUntil;
    const help = form.querySelector('[data-field="warrantyUntil"] .field__help');
    const WORKED = 'Worked out from the day you bought it and how long it lasts. Change it if the paperwork says a different date.';
    const ASK = 'Add the day you bought it and how long it lasts, and I’ll work this out. Or type the date from the paperwork.';
    const current = () => monthsOf({ len: form.elements.len.value, lenN: form.elements.lenN.value, lenUnit: form.elements.lenUnit.value });
    const worked = () => {
      const m = current();
      const date = form.elements.date.value;
      return m && isISO(date) ? addMonths(date, m) : '';
    };
    const say = () => {
      if (help) help.textContent = worked() && end.value === worked() ? WORKED : worked() ? 'This is not the date I worked out (' + fmtDate(worked()) + ') because you set it. That is fine if the paperwork says so.' : ASK;
    };
    if (existing && end.value && end.value !== worked()) form.dataset.endTouched = '1';
    const recompute = () => {
      delete form.dataset.endTouched;
      const w = worked();
      if (w) {
        end.value = w;
        form.dataset.autoEnd = w;
      } else if (form.dataset.autoEnd && end.value === form.dataset.autoEnd) {
        // The end was only worked out from a length and a day that are no longer both there, so it goes too (a date you typed or read stays).
        end.value = '';
        delete form.dataset.autoEnd;
      }
      say();
    };
    end.addEventListener('input', () => {
      form.dataset.endTouched = '1';
      say();
    });
    const redo = (e) => {
      if (e.target && ['date', 'len', 'lenN', 'lenUnit'].includes(e.target.name)) recompute();
    };
    form.addEventListener('input', redo);
    form.addEventListener('change', redo);
    say();
    return { recompute, say, worked };
  }

  /* Sets a field from a reading, unless you've already typed in it. */
  function setField(form, name, value) {
    if (value == null || value === '') return false;
    const el = form.elements[name];
    if (!el) return false;
    if (el.length && el[0] && el[0].type === 'radio') {
      Array.from(el).forEach((x) => (x.checked = x.value === String(value)));
      return true;
    }
    if (el.dataset && el.dataset.touched) return false;
    if (el.value) return false;
    el.value = name === 'amount' ? Number(value).toFixed(2) : value;
    return true;
  }
  /* A title from a file name: 'dishwasher-warranty.pdf' is 'Dishwasher'; 'IMG_2044.jpg' and 'warranty card.pdf' say nothing about the item. */
  function titleFromFile(files) {
    const name = String((files && files[0] && files[0].name) || '').replace(/\.[a-z0-9]{1,5}$/i, '').replace(/[_\-.]+/g, ' ')
      .replace(/\b(img|image|photo|picture|scan|scanned|screenshot|screen shot|dsc|pxl|download|document|doc|file|whatsapp|copy|untitled|receipt|warranty|guarantee|card|invoice|note|certificate|order|confirmation|proof|purchase|registration|manual|serial)\b/gi, ' ')
      .replace(/\s+/g, ' ').trim();
    if (!/[a-z]{3}/i.test(name)) return '';
    return name.charAt(0).toUpperCase() + name.slice(1);
  }
  /* Puts what was read into the open form. Returns the names of what it filled in, for the note. */
  function applyRead(form, r, files) {
    const found = [];
    const offline = r.via === 'offline';
    // The offline reader can't tell the item from the shop's name on a receipt, so its title is the file's name, if that says anything.
    if (setField(form, 'title', offline ? titleFromFile(files) : r.title)) found.push('the item');
    if (setField(form, 'party', r.party)) found.push('where it was bought');
    if (setField(form, 'date', r.date)) found.push('the day you bought it');
    let len = null;
    if (r.warranty_lifetime) len = { len: 'lifetime' };
    else if (r.warranty_months) len = lenFields({ warrantyMonths: r.warranty_months });
    if (len && !form.elements.len.value && !(form.elements.len.dataset && form.elements.len.dataset.touched)) {
      form.elements.len.value = len.len;
      if (len.len === 'custom') {
        form.elements.lenN.value = len.lenN;
        Array.from(form.elements.lenUnit).forEach((x) => (x.checked = x.value === len.lenUnit));
      }
      found.push('how long it lasts');
    }
    form.dispatchEvent(new Event('change', { bubbles: true })); // shows or hides the fields that go with the length
    const w = form.elements.warrantyUntil;
    if (r.expiry_date && w && !w.value && !(w.dataset && w.dataset.touched)) {
      w.value = r.expiry_date;
      found.push('when it ends');
    }
    if (setField(form, 'amount', r.amount)) found.push('the price');
    if (setField(form, 'reference', r.reference)) found.push('the serial or order number');
    if (!offline && setField(form, 'notes', r.notes)) found.push('notes');
    // Keep the end date in step with what was read: a worked-out date shows as worked out, a read one as set.
    const m = form.__wr;
    if (m) {
      if (w && w.value && w.value !== m.worked()) form.dataset.endTouched = '1';
      else if (!form.dataset.endTouched && m.worked()) w.value = m.worked();
      m.say();
    }
    return found;
  }
  const list = (a) => (a.length > 1 ? a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1] : a[0] || '');

  /* A record you already have that these files probably belong to: the same serial or order number. */
  function findSame(r) {
    const ref = String((r && r.reference) || '').trim().toLowerCase();
    if (ref.length < 4) return null;
    return (store.state.paperwork || []).find((p) => isWarranty(p) && String(p.reference || '').trim().toLowerCase() === ref) || null;
  }

  /* Reads the files into the open form: with Claude when it's there, otherwise on this device. Nothing is saved. */
  async function readInto(d, files) {
    const note = document.createElement('p');
    note.className = 'assist-note';
    note.setAttribute('role', 'status');
    note.innerHTML = icon('clock') + '<span>Reading your file…</span>';
    note.classList.add('shimmer'); // a soft moving highlight while it reads (css/art.css); taken off again below
    d.body.insertBefore(note, d.body.firstChild);
    try {
      const r = await GU.brain.analyseWarranty({ files });
      if (!document.body.contains(d.form)) return;
      const found = applyRead(d.form, r, files);
      const same = findSame(r);
      note.innerHTML = icon(found.length ? 'check' : 'info') + '<span>' +
        (found.length ? 'I filled in ' + esc(list(found)) + '. Check it, then press Save.' : 'I couldn’t read much from this. Fill in the details below.') +
        (r.via === 'offline' ? ' <small>(Offline reader. Add Claude in Settings for better results.)</small>' : '') +
        (r.warning ? ' <small>' + esc(r.warning) + '</small>' : '') +
        (same ? '<br>This looks like ' + esc(quote(same.title)) + ', which you already have. <button type="button" class="btn btn--sm" data-wr-attach="' + esc(same.id) + '">Add the file to it instead</button>' : '') + '</span>';
      const attach = note.querySelector('[data-wr-attach]');
      if (attach) {
        attach.addEventListener('click', async () => {
          attach.disabled = true;
          await addFiles(same.id, files);
          d.close();
        });
      }
    } catch (e) {
      note.innerHTML = icon('info') + '<span>I couldn’t read this file automatically. Fill in the details below.</span>';
    } finally {
      note.classList.remove('shimmer');
    }
  }

  /* Builds the record from the form's values. */
  function buildRecord(v, existing) {
    const lifetime = v.len === 'lifetime';
    const months = monthsOf(v);
    const rec = Object.assign(existing ? Object.assign({}, existing) : { id: 'p-' + uid(), created: today(), kind: 'warranty', context: 'home', status: '', dueDate: '' }, {
      title: v.title, party: v.party, date: v.date, amount: v.amount, reference: v.reference, notes: v.notes, files: v.files || [],
      warrantyUntil: lifetime ? '' : v.warrantyUntil || '',
    });
    if (lifetime) rec.warrantyLifetime = true;
    else delete rec.warrantyLifetime;
    if (months && !lifetime) rec.warrantyMonths = months;
    else delete rec.warrantyMonths;
    return rec;
  }
  function save(v, existing) {
    const rec = buildRecord(v, existing);
    const label = (existing ? 'Edited the warranty ' : 'Added the warranty ') + quote(rec.title);
    GU.organise.act(label, () => store.commit((st) => {
      const i = st.paperwork.findIndex((x) => x.id === rec.id);
      if (i >= 0) st.paperwork[i] = rec;
      else st.paperwork.push(rec);
    }, { label }), existing ? 'Saved ' + quote(rec.title) : 'Added ' + quote(rec.title) + ' to your warranties');
    // What you've just saved should be on show, not hidden by a filter or a search.
    if (!existing) {
      ui.filter = 'all';
      ui.q = '';
    }
    return rec;
  }

  /* Opens the form for a new warranty. opts.files: files you've dropped or chosen (they're read into the form);
     opts.read: a reading from the Sorting hub to fill it with; opts.values: details to start with; opts.onSaved(rec). */
  function create(opts) {
    opts = opts || {};
    const files = opts.files || null;
    const values = Object.assign({ title: '', party: '', date: '', amount: null, reference: '', notes: '', warrantyUntil: '', len: '', lenUnit: 'years', files: [] }, opts.values || {});
    const d = formDialog({
      title: 'Add a warranty',
      fields: fields(),
      values,
      initialFiles: files,
      submitLabel: 'Save',
      noAutofocus: !!(files && files.length) || !!opts.read,
      onSubmit: (v) => {
        const rec = save(v, null);
        if (opts.onSaved) opts.onSaved(rec);
      },
    });
    d.form.__wr = wireForm(d, false);
    if (opts.read) {
      const found = applyRead(d.form, opts.read, files || []);
      const note = document.createElement('p');
      note.className = 'assist-note';
      note.innerHTML = icon(found.length ? 'check' : 'info') + '<span>' + (found.length ? 'This is what was read from your file. Check it, then press Save.' : 'Fill in the details below.') + '</span>';
      d.body.insertBefore(note, d.body.firstChild);
    } else if (files && files.length) readInto(d, files);
    return d;
  }

  function edit(id) {
    const p = store.find('paperwork', id);
    if (!p) return;
    const values = valuesOf(p);
    const d = formDialog({
      title: 'Edit warranty',
      fields: fields(),
      values,
      submitLabel: 'Save',
      onSubmit: (v) => {
        save(v, p);
      },
      onDelete: () => {
        store.remove('paperwork', id, p.title);
      },
      deleteMessage: 'This deletes the warranty and its attached files. You can undo it, and it stays in Settings → Recently deleted for 30 days.',
    });
    d.form.__wr = wireForm(d, true);
    return d;
  }

  /* Adds more files (a receipt, the warranty card, a photo of the item) to a warranty you already have. */
  async function addFiles(id, given) {
    const p = store.find('paperwork', id);
    if (!p) return;
    const files = given && given.length ? given : await GU.ui.pickFiles();
    if (!files.length) return;
    const metas = [];
    for (const f of files) metas.push(await GU.files.add(f));
    const label = 'Added ' + plural(metas.length, 'file') + ' to ' + quote(p.title);
    GU.organise.act(label, () => store.commit((st) => {
      const x = st.paperwork.find((y) => y.id === id);
      if (x) x.files = (x.files || []).concat(metas);
    }, { label }), label);
  }

  /* ---------- the ⋯ menu: Edit and Add another file, with the usual Open, Rename, Move to…, Duplicate, Download and Delete ---------- */
  const baseExtras = GU.organise.extras.paperwork;
  GU.organise.extras.paperwork = (r, ctx) => {
    const base = baseExtras ? baseExtras(r, ctx) : [];
    if (ctx !== 'warranty') return base;
    // Open already is this form for a warranty. A receipt that happens to have a warranty end date opens the receipt form from Open, so it gets its own way in here.
    return [
      r.kind === 'warranty' ? null : { icon: 'edit', label: 'Edit the warranty', hint: 'Dates, length and files', onClick: () => edit(r.id) },
      { icon: 'clip', label: 'Add another file', hint: 'A receipt, card or photo', onClick: () => addFiles(r.id) },
    ].filter(Boolean).concat(base);
  };
  /* Open on a warranty (from Today, Search, the Sorting hub) opens this form rather than the receipts one. */
  const receiptEdit = GU.tabs.receipts && GU.tabs.receipts.edit;
  if (receiptEdit) {
    GU.tabs.receipts.edit = function (id) {
      const p = store.find('paperwork', id);
      if (p && p.kind === 'warranty' && !isWork(p)) return edit(id);
      return receiptEdit.apply(this, arguments);
    };
  }

  /* ---------- reminders: Today's Needs attention, and the count on this page's tab ---------- */
  /* Ending within the warning time is a warning (red inside 14 days); one that ended in the last 14 days is just
     for information. No end date, or a lifetime warranty, says nothing. */
  GU.agenda.extra.push(function (state) {
    const t = today();
    const warn = warnDays(state);
    const out = [];
    for (const p of state.paperwork || []) {
      if (!isWarranty(p) || p.warrantyLifetime || !isISO(p.warrantyUntil)) continue;
      const n = daysUntil(p.warrantyUntil, t);
      const name = String(p.title || 'Warranty').replace(/\s+(warranty|guarantee)$/i, '');
      if (n >= 0 && n <= warn) {
        out.push({ level: n <= CRIT_DAYS ? 'crit' : 'warn', tab: 'warranties', go: 'soon', title: name + ' warranty ' + endsPhrase(n), detail: fmtDate(p.warrantyUntil) + ' · claim any repair before then' });
      } else if (n < 0 && n >= -RECENT_DAYS) {
        out.push({ level: 'info', tab: 'warranties', go: 'ended', title: name + ' warranty ' + endsPhrase(n), detail: fmtDate(p.warrantyUntil) + ' · it’s no longer covered' });
      }
    }
    return out;
  });

  GU.tabs.warranties = { label: 'Warranties', short: 'Warranties', icon: 'shield', part: 'home', render, create, edit, addFiles, infos, isWarranty, warnDays, endsPhrase };
})();
