/* The Ground Up: Settings. About you, the business you work for (Work), how the assistant reads things,
   reminders, accounts, category rules, backup and restore. */
(function () {
  'use strict';
  const GU = window.GU;
  const { esc, uid, fmtBytes, plural, today, addDays, fmtDate } = GU.util;
  const { icon, selectOptions, toast, confirmBox, formDialog } = GU.ui;
  const F = GU.finance;
  const store = GU.store;

  const CURRENCIES = [
    ['GBP', 'British pound (£)'], ['EUR', 'Euro (€)'], ['USD', 'US dollar ($)'], ['CAD', 'Canadian dollar'], ['AUD', 'Australian dollar'], ['NZD', 'New Zealand dollar'],
    ['INR', 'Indian rupee (₹)'], ['PKR', 'Pakistani rupee'], ['NGN', 'Nigerian naira (₦)'], ['ZAR', 'South African rand'], ['AED', 'UAE dirham'], ['PHP', 'Philippine peso'],
    ['CHF', 'Swiss franc'], ['PLN', 'Polish złoty'], ['JPY', 'Japanese yen'],
  ].map(([value, label]) => ({ value, label }));

  function syncHTML() {
    const sy = GU.sync.status();
    const on = GU.sync.active();
    const rf = Object.values(store.state.remoteFiles || {});
    const up = rf.filter((f) => f.asset).length;
    const local = rf.filter((f) => f.skip).length;
    const when = sy.savedAt ? new Date(sy.savedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '';
    const tone = sy.mode === 'error' ? 'crit' : on ? 'good' : 'muted';
    return '<header class="panel__head"><h2>' + icon('repeat') + 'Sync across your devices</h2>' + GU.ui.pill(on ? (sy.mode === 'saving' ? 'Saving…' : 'On') : sy.mode === 'connecting' ? 'Connecting…' : sy.mode === 'error' ? 'Problem' : 'Off', tone) + '</header>' +
      '<div class="panel__body stack"><p>' + esc(sy.message) + (on && when && sy.mode === 'on' ? ' Last saved at ' + esc(when) + '.' : '') + '</p>' +
      (on ? '<p class="muted">Open this same dashboard link on your phone, tablet or another computer while signed in to claude.ai, and everything is there. Changes show up on your other devices within a few seconds. Your records are kept in your own private space: even if you share the link, nobody else can read them.</p>' +
        '<p class="muted">' + esc(plural(up, 'file') + ' synced' + (sy.files.waiting ? ', ' + sy.files.waiting + ' uploading' : '') + (local ? '. ' + plural(local, 'file') + ' (Word, Excel or iPhone HEIC photos) can only be opened on the device that added them' : '') + '.') + ' Anyone you give edit access to this dashboard could open synced files, so keep the link to yourself.</p>'
        : '<p class="muted">Sync works when you open this dashboard from claude.ai while signed in. Anywhere else, move your data with Export backup and Restore below.</p>') +
      '</div>';
  }
  GU.sync.onStatus(() => {
    const el = document.querySelector('[data-sync]');
    if (el) el.innerHTML = syncHTML();
  });

  /* The same account imported twice under two names: fold one into the other. */
  function mergeAccount(fromId) {
    const s = store.state;
    const from = s.accounts.find((a) => a.id === fromId);
    const others = s.accounts.filter((a) => a.id !== fromId);
    const preview = (intoId) => {
      const copy = { transactions: s.transactions.map((t) => Object.assign({}, t)), accounts: s.accounts.map((a) => Object.assign({}, a)) };
      return GU.money.mergeAccounts(copy, fromId, intoId);
    };
    formDialog({
      title: 'Merge ' + from.name + ' into another account',
      intro: 'Use this when the same bank account was imported under two names. Its transactions move across, any that are already there (the same amount within 2 days) are dropped so nothing is counted twice, and “' + esc(from.name) + '” is removed.',
      fields: [
        { name: 'into', label: 'Merge into', type: 'select', options: others.map((a) => ({ value: a.id, label: a.name })) },
        { name: 'preview', type: 'html', html: '<p class="field__help" data-preview></p>' },
      ],
      values: { into: (others.find((a) => a.bank && from.bank && a.bank === from.bank) || others[0]).id },
      submitLabel: 'Merge',
      onChange: (v, form) => {
        const r = preview(v.into);
        form.querySelector('[data-preview]').textContent = plural(r.moved, 'transaction') + ' will move across and ' + plural(r.duplicates, 'duplicate') + ' will be dropped.';
      },
      onSubmit: (v) => {
        const before = { transactions: store.state.transactions, accounts: store.state.accounts, bills: store.state.bills };
        let r;
        store.commit((st) => {
          st.transactions = st.transactions.map((t) => Object.assign({}, t));
          st.accounts = st.accounts.map((a) => Object.assign({}, a));
          st.bills = st.bills.map((b) => Object.assign({}, b));
          r = GU.money.mergeAccounts(st, fromId, v.into);
          GU.recurring.reassignBills(st);
        });
        toast('Merged. ' + plural(r.moved, 'transaction') + ' moved and ' + plural(r.duplicates, 'duplicate') + ' removed.', { timeout: 12000, action: 'Undo', onAction: () => store.commit((st) => Object.assign(st, before)) });
      },
    });
  }

  /* ---------- Work: the business you work for (settings.employer) ---------- */
  const LEGAL = /[\s,]+(limited|ltd\.?|plc|llp)$/i;
  const employer = (s) => (GU.workMoney ? GU.workMoney.employer(s) : { set: false, short: '', label: 'the company', Label: 'The company', fullName: '', match: [], repayDays: 14, nudgeDays: 3, chaseDays: 21 });
  const rawEmployer = (s) => (s.settings.employer && typeof s.settings.employer === 'object' && !Array.isArray(s.settings.employer) ? s.settings.employer : null);
  /* A whole number of days from a form box, or null when it's empty or not a number. */
  function days(el, max) {
    const raw = el ? String(el.value).trim() : '';
    if (raw === '' || !Number.isFinite(Number(raw))) return null;
    return Math.min(max, Math.max(0, Math.round(Number(raw))));
  }
  function workHTML(s) {
    const raw = rawEmployer(s) || {};
    const e = employer(s);
    const c = e.label;
    const C = e.Label;
    // A box for a number of days. Empty uses the usual number, shown faintly.
    const num = (id, name, label, k, help) => '<div class="emp-days__cell"><label class="field__label" for="' + id + '">' + esc(label) + '</label>' +
      '<input id="' + id + '" name="' + name + '" type="number" inputmode="numeric" min="0" max="365" step="1" value="' + esc(raw[k] != null && raw[k] !== '' ? raw[k] : '') + '" placeholder="' + esc(e[k]) + '">' +
      '<p class="field__help">' + esc(help) + '</p></div>';
    const sources = (s.incomeSources || []).map((i) => ({ value: i.id, label: (i.name || 'Income') + (i.from && i.from !== i.name ? ' (' + i.from + ')' : '') }));
    const accounts = (s.accounts || []).map((a) => ({ value: a.id, label: a.name }));
    const info = GU.refile && GU.refile.info ? GU.refile.info(s) : null;
    // While the Home/Work tidy-up panel is showing, that's where the re-sort's Undo is; this is for when it isn't.
    const tidyShown = !!(GU.refile && GU.refile.tidyHTML && GU.refile.tidyHTML(s));
    const canUndo = !tidyShown && !!(GU.refile && GU.refile.canUndo && GU.refile.canUndo(s));
    // The one-off re-sort: undo it for 30 days; or, if it found nothing to go on, run it now you've said who you work for.
    let resort = '';
    if (canUndo) {
      resort = '<div class="field"><p class="tip">' + icon('repeat') + '<span>On ' + esc(fmtDate(info.at)) + ' I split your site into Home and Work and sorted your ' + esc(c) + ' money. ' +
        'You can put everything back as it was until ' + esc(fmtDate(addDays(info.at, 30))) + '.</span></p>' +
        '<div class="field--row"><button type="button" class="btn" data-undo-refile>' + icon('repeat') + 'Undo the Home/Work re-sort</button></div></div>';
    } else if (e.set && GU.refile && GU.refile.run && (!info || info.skipped) && !(s.meta.refileV1 && s.meta.refileV1.demo)) {
      resort = '<div class="field field--row"><button type="button" class="btn" data-run-refile>' + icon('spark') + 'Sort my records for ' + esc(c) + '</button>' +
        '<span class="muted">Moves things you bought for ' + esc(c) + ' into Work and splits their payments into wages and money paid back. You can undo it for 30 days.</span></div>';
    }
    return '<section class="panel" id="work-settings"><header class="panel__head"><h2>' + icon('briefcase') + esc(e.set ? 'Work · ' + (e.fullName || e.short) : 'Work') + '</h2>' +
      '</header>' +
      '<form class="panel__body form-grid" data-form="employer">' +
      '<div class="field"><p class="tip">' + icon('info') + '<span>' + (e.set
        ? 'Work is for ' + esc(e.name) + ' and nothing else. Your own life and money stay in Home.'
        : 'Tell me who you work for, like a job or a family business. Work then uses their name, and I can tell your wages apart from money they pay you back.') + '</span></p></div>' +
      '<div class="field field--half"><label class="field__label" for="emp-name">Business name</label><input id="emp-name" name="empName" type="text" value="' + esc(raw.name || '') + '" placeholder="e.g. Acme Care Ltd" autocomplete="off"></div>' +
      '<div class="field field--half"><label class="field__label" for="emp-short">Short name</label><input id="emp-short" name="empShort" type="text" value="' + esc(raw.short || '') + '" placeholder="e.g. Acme" autocomplete="off">' +
      '<p class="field__help">Used on buttons and labels, like “' + esc((e.set ? e.short : 'Acme') + ' pays') + '”.</p></div>' +
      '<div class="field field--half"><label class="field__label" for="emp-about">What it is to you <span class="opt">optional</span></label><input id="emp-about" name="empAbout" type="text" value="' + esc(raw.about || '') + '" placeholder="e.g. Family business, My job" autocomplete="off">' +
      '<p class="field__help">Shown on the Work door.</p></div>' +
      '<div class="field field--half"><label class="field__label" for="emp-contact">Who you send things to <span class="opt">optional</span></label><input id="emp-contact" name="empContact" type="text" value="' + esc(raw.contact || '') + '" placeholder="e.g. Sam" autocomplete="off">' +
      '<p class="field__help">Messages you send start “Hi ' + esc(raw.contact || 'Sam') + ',”.</p></div>' +
      '<div class="field"><label class="field__label" for="emp-match">How they show on your bank statement</label><input id="emp-match" name="empMatch" type="text" value="' + esc((Array.isArray(raw.match) ? raw.match : []).join(', ')) + '" placeholder="' + esc(e.set ? e.match.join(', ') : 'e.g. acme care') + '" autocomplete="off">' +
      '<p class="field__help">Words from their payments to you, separated by commas.</p></div>' +
      '<div class="field field--half"><label class="field__label" for="emp-wage">Your wages come in as</label><select id="emp-wage" name="empWage">' + selectOptions([{ value: '', label: 'Work it out from the name' }].concat(sources), raw.wageSource || '') + '</select>' +
      '<p class="field__help">From Money › Income.</p></div>' +
      '<div class="field field--half"><label class="field__label" for="emp-into">They pay you back into</label><select id="emp-into" name="empInto">' + selectOptions([{ value: '', label: 'Any of my accounts' }].concat(accounts), raw.payInto || '') + '</select>' +
      '<p class="field__help">Money ahead shows money coming back in this account.</p></div>' +
      '<div class="field emp-days">' +
      num('emp-repay', 'empRepay', 'Days ' + c + ' usually takes to pay you back', 'repayDays', 'Money ahead expects things you’ve sent back this long after.') +
      num('emp-nudge', 'empNudge', 'Remind me to send after (days)', 'nudgeDays', 'Get paid back lights up once anything has waited this long.') +
      num('emp-chase', 'empChase', 'Remind me to chase after (days)', 'chaseDays', 'If something you sent isn’t paid back by then, I’ll remind you.') +
      '</div>' +
      '<div class="field"><p class="tip">' + icon('coin') + '<span><b>Wages or money paid back?</b> Your wages from ' + esc(c) + ' are your own money, so they count as income in Home. ' +
      'When ' + esc(c) + ' pays you back for something you bought for them, that’s ‘Work reimbursements’: it’s kept out of your income, spending and budgets, and ticks things off in Get paid back. ' +
      'I tell the two apart by the words on the payment (wage, salary or payroll) or an amount close to your usual pay. ' + esc(C) + '’s own money never shows in Home.</span></p></div>' +
      resort +
      '<div class="field field--row"><button type="submit" class="btn btn--primary">Save</button>' +
      (e.set ? '<span class="muted">Clear both names and save to stop using ' + esc(c) + '’s name.</span>' : '') + '</div></form></section>';
  }
  /* Reads the Work form into settings.employer. Both names empty: no employer. */
  function saveEmployer(set, f) {
    const name = f.elements.empName.value.trim();
    const shortName = f.elements.empShort.value.trim();
    const prev = set.employer && typeof set.employer === 'object' && !Array.isArray(set.employer) ? set.employer : null;
    if (!name && !shortName) {
      set.employer = null;
      return;
    }
    const next = Object.assign({}, prev || {}, {
      name: name || shortName,
      short: shortName || name.replace(LEGAL, '').trim() || name,
      about: f.elements.empAbout.value.trim(),
      contact: f.elements.empContact.value.trim(),
      wageSource: f.elements.empWage.value,
      payInto: f.elements.empInto.value,
    });
    const match = f.elements.empMatch.value.split(',').map((m) => m.trim().toLowerCase()).filter(Boolean);
    if (match.length) next.match = match;
    else delete next.match; // the short name is used
    if (!next.about) delete next.about;
    if (!next.contact) delete next.contact;
    for (const [k, el] of [['repayDays', f.elements.empRepay], ['nudgeDays', f.elements.empNudge], ['chaseDays', f.elements.empChase]]) {
      const n = days(el, 365);
      if (n == null) delete next[k];
      else next[k] = n;
    }
    // Claims for monthly work bills start from the day you set this up, so older payments aren't added twice.
    if (!next.since) next.since = today();
    // An example employer you've renamed is yours now, so clearing the examples keeps it.
    if (prev && prev.demo && (prev.name !== next.name || prev.short !== next.short)) delete next.demo;
    set.employer = next;
  }

  function ago(iso) {
    const mins = Math.round((Date.now() - Date.parse(iso)) / 60000);
    if (mins < 2) return 'just now';
    if (mins < 60) return mins + ' minutes ago';
    if (mins < 60 * 24) return plural(Math.round(mins / 60), 'hour') + ' ago';
    return plural(Math.round(mins / 1440), 'day') + ' ago';
  }
  function trashHTML(s) {
    const list = s.trash || [];
    return '<section class="panel" id="deleted"><header class="panel__head"><h2>' + icon('trash') + 'Recently deleted</h2><span class="muted">kept for 30 days</span></header>' +
      (list.length ? '<ul class="rows rows--tight">' + list.slice(0, 50).map((e) => '<li class="row-item"><span class="row-item__text"><b>' + esc(e.label) + '</b><em>' +
        esc((GU.trash.KIND[e.c] || 'Item') + ' · deleted ' + ago(e.at)) + '</em></span><span class="row-item__act"><button type="button" class="btn btn--sm btn--soft" data-restore="' + esc(e.id) + '">' + icon('repeat') + 'Restore</button></span></li>').join('') + '</ul>'
        : '<div class="panel__body"><p class="muted">Anything you delete shows up here for 30 days, so you can put it back.</p></div>') + '</section>';
  }

  /* Your own categories (made in the Sorting hub or here): each can go once nothing is in it. */
  function categoriesHTML(s) {
    const used = (name) => ['transactions', 'paperwork', 'bills'].reduce((n, c) => n + (s[c] || []).filter((x) => String(x.category || '').toLowerCase() === name.toLowerCase()).length, 0);
    const list = ['out', 'in'].flatMap((k) => F.custom(s, k).map((name) => ({ k, name, n: used(name) })));
    return '<section class="panel" id="categories"><header class="panel__head"><h2>' + icon('tag') + 'Money categories</h2><button type="button" class="btn btn--sm btn--ghost" data-new-category>' + icon('plus') + 'New money category</button></header>' +
      (list.length ? '<ul class="rows rows--tight">' + list.map((x) => '<li class="row-item"><span class="row-item__icon">' + icon('tag') + '</span><span class="row-item__text"><b>' + esc(x.name) + '</b><em>' +
        esc((x.k === 'in' ? 'Money in' : 'Spending') + ' · ' + (x.n ? plural(x.n, 'thing') + ' in it' : 'nothing in it yet')) + '</em></span><span class="row-item__act">' +
        (x.n ? '' : '<button type="button" class="btn btn--sm btn--ghost" data-delete-category="' + esc(x.k + '|' + x.name) + '">Remove</button>') + '</span></li>').join('') + '</ul>'
        : '<div class="panel__body"><p class="muted">Make money categories of your own, like Gym or Pets, here or in the Sorting hub (“create a Gym category for PureGym payments”). They work with budgets too.</p></div>') + '</section>';
  }

  /* The pages you made yourself (Wedding, Visa, Klarna…): each one can be shown in the menu or hidden from it. Hidden ones
     (Klarna and PayPal are, to start with) are all still here, still searchable, and linked from Bills & debts. */
  function categoryPagesHTML(s) {
    const S = GU.sections;
    const list = s.sections || [];
    const row = (x) => {
      const hidden = S.isHidden(x);
      const lender = S.isLenderRecord(x);
      const n = s.sectionItems.filter((i) => i.sectionId === x.id).length;
      return '<li class="row-item row-item--cat"><span class="row-item__icon">' + icon(x.icon || 'star') + '</span><span class="row-item__text"><b>' + esc(x.name) + '</b><em>' +
        esc([x.part === 'work' ? 'Work' : 'Home', plural(n, 'item'), lender ? 'records from a lender' : '', x.byAssistant ? 'started by your assistant' : ''].filter(Boolean).join(' · ')) + '</em></span>' +
        '<span class="row-item__act"><span class="seg seg--sm" role="radiogroup" aria-label="' + esc(x.name) + ' in the menu">' +
        '<label><input type="radio" name="cat-menu-' + esc(x.id) + '" value="shown" data-cat-menu="' + esc(x.id) + '"' + (hidden ? '' : ' checked') + '><span>In the menu</span></label>' +
        '<label><input type="radio" name="cat-menu-' + esc(x.id) + '" value="hidden" data-cat-menu="' + esc(x.id) + '"' + (hidden ? ' checked' : '') + '><span>Hidden</span></label></span>' +
        '<button type="button" class="btn btn--sm btn--ghost" data-move-section="' + esc(x.id) + '">Rename or move</button><a class="btn btn--sm btn--ghost" href="#s-' + esc(x.id) + '">Open</a></span></li>';
    };
    return '<section class="panel" id="category-pages"><header class="panel__head"><h2>' + icon('star') + 'Your categories</h2><button type="button" class="btn btn--sm btn--ghost" data-new-section>' + icon('plus') + 'New category</button></header>' +
      (list.length ? '<ul class="rows rows--tight">' + list.map(row).join('') + '</ul>' +
        '<p class="panel__foot muted">Your own pages, like Wedding or Visa. Hiding one only takes it out of the menu: everything in it stays, and Search still finds it.</p>'
        : '<div class="panel__body"><p class="muted">No categories yet. I’ll suggest one when something you send me doesn’t fit the menu.</p></div>') + '</section>';
  }

  function render(root) {
    const s = store.state;
    const st = s.settings;
    root.innerHTML = GU.view.head({ eyebrow: 'You', title: 'Settings', text: 'How your assistant works for you.' + (GU.sync.active() ? ' Your data syncs across your devices.' : ' Everything here is saved in this browser only.') }) +
      '<div class="settings">' +
      '<section class="panel" data-sync>' + syncHTML() + '</section>' +
      trashHTML(s) +

      '<section class="panel"><header class="panel__head"><h2>About you</h2></header><form class="panel__body form-grid" data-form="about">' +
      '<div class="field field--half"><label class="field__label" for="set-name">Your first name</label><input id="set-name" name="name" type="text" value="' + esc(st.name) + '" placeholder="Used in your greeting"></div>' +
      '<div class="field field--half"><label class="field__label" for="set-biz">Your own business name <span class="opt">only if you invoice people yourself' + (employer(s).set ? ', not ' + esc(employer(s).short) : '') + '</span></label><input id="set-biz" name="business" type="text" value="' + esc(st.business || '') + '" placeholder="Helps me spot invoices you send"></div>' +
      '<div class="field field--half"><label class="field__label" for="set-cur">Currency</label><select id="set-cur" name="currency">' + selectOptions(CURRENCIES, st.currency) + '</select></div>' +
      '<div class="field field--half"><span class="field__label">Appearance</span><div class="seg">' + ['system', 'light', 'dark'].map((t) => '<label><input type="radio" name="theme" value="' + t + '"' + (st.theme === t ? ' checked' : '') + '><span>' + (t === 'system' ? 'Match device' : t[0].toUpperCase() + t.slice(1)) + '</span></label>').join('') + '</div></div>' +
      '<div class="field"><button type="submit" class="btn btn--primary">Save</button></div></form></section>' +

      workHTML(s) +

      (GU.refile && GU.refile.tidyHTML ? GU.refile.tidyHTML(s) : '') +

      '<section class="panel" id="assistant"><header class="panel__head"><h2>How your assistant reads things</h2><span data-mode class="muted"></span></header><form class="panel__body form-grid" data-form="brain">' +
      '<div class="field"><p class="tip">' + icon('info') + '<span>When you open this app inside the Claude app, I use Claude through your Claude account automatically. Anywhere else, you can add an Anthropic API key below. Without either, I read files offline on this device using text in PDFs, photo text recognition and keyword rules. That works for clear receipts and letters but is less accurate.</span></p></div>' +
      '<div class="field field--half"><label class="field__label" for="set-key">Anthropic API key <span class="opt">optional</span></label><input id="set-key" name="apiKey" type="password" autocomplete="off" value="' + esc(st.apiKey || '') + '" placeholder="sk-ant-…"><p class="field__help">Stored only in this browser and sent only to Anthropic when I read an item. Get one at console.anthropic.com. Each item costs about a penny or two.</p></div>' +
      '<div class="field field--half"><label class="field__label" for="set-model">Claude model</label><input id="set-model" name="model" type="text" value="' + esc(st.model || '') + '" placeholder="claude-opus-5-5"><p class="field__help">Leave empty to use the recommended model.</p></div>' +
      '<div class="field"><label class="check"><input type="checkbox" name="autoFile"' + (st.autoFile !== false ? ' checked' : '') + '><span>File things automatically when I’m sure where they go (you can always undo)</span></label></div>' +
      '<div class="field"><label class="check"><input type="checkbox" name="ocr"' + (st.ocr !== false ? ' checked' : '') + '><span>Read text in photos on this device when Claude isn’t connected (downloads a 10 MB reader the first time)</span></label></div>' +
      '<div class="field field--row"><button type="submit" class="btn btn--primary">Save</button><button type="button" class="btn" data-test>' + icon('check') + 'Test Claude connection</button><span class="muted" data-test-out></span></div></form></section>' +

      '<section class="panel"><header class="panel__head"><h2>Reminders</h2></header><form class="panel__body form-grid" data-form="reminders">' +
      '<div class="field field--half"><label class="field__label" for="set-doc">Warn me before documents expire</label><select id="set-doc" name="docWarnDays">' + selectOptions([30, 60, 90, 120, 180].map((n) => ({ value: n, label: n + ' days before' })), st.docWarnDays) + '</select></div>' +
      (GU.returns ? '<div class="field field--half"><label class="field__label" for="set-ret">Usual time to return something</label><select id="set-ret" name="returnDays">' +
        selectOptions([{ value: 0, label: 'Don’t offer a return reminder' }].concat([14, 28, 30, 60, 90].map((n) => ({ value: n, label: n + ' days' }))), GU.returns.windowDays(s)) + '</select><p class="field__help">Offered as a reminder when you file a new receipt. You can set any date by hand.</p></div>' : '') +
      '<div class="field"><button type="submit" class="btn btn--primary">Save</button></div></form></section>' +

      '<section class="panel"><header class="panel__head"><h2>Bank accounts</h2><button type="button" class="btn btn--sm btn--ghost" data-add-account>' + icon('plus') + 'Add</button></header><ul class="rows rows--tight">' +
      s.accounts.map((a) => {
        const n = s.transactions.filter((t) => t.account === a.id).length;
        return '<li class="row-item"><span class="row-item__icon">' + icon('bank') + '</span><span class="row-item__text"><b>' + esc(a.name) + '</b><em>' + esc(plural(n, 'transaction')) + '</em></span><span class="row-item__act">' +
          '<button type="button" class="btn btn--sm btn--ghost" data-rename-account="' + esc(a.id) + '">Rename</button>' +
          (s.accounts.length > 1 && n ? '<button type="button" class="btn btn--sm btn--ghost" data-merge-account="' + esc(a.id) + '">Merge into…</button>' : '') +
          (s.accounts.length > 1 ? '<button type="button" class="btn btn--sm btn--ghost" data-delete-account="' + esc(a.id) + '">Delete</button>' : '') + '</span></li>';
      }).join('') + '</ul></section>' +

      '<section class="panel"><header class="panel__head"><h2>Category rules</h2><span class="muted">' + s.rules.length + '</span></header>' +
      (s.rules.length ? '<ul class="rows rows--tight">' + s.rules.map((r) => '<li class="row-item"><span class="row-item__text"><b>“' + esc(r.match) + '”</b><em>always goes to ' + esc(r.category) + '</em></span><span class="row-item__act"><button type="button" class="btn btn--sm btn--ghost" data-delete-rule="' + esc(r.id) + '">Remove</button></span></li>').join('') + '</ul>'
        : '<div class="panel__body"><p class="muted">When you change a transaction’s category you can tick “always use this category”. Those rules appear here.</p></div>') + '</section>' +

      categoriesHTML(s) +

      categoryPagesHTML(s) +

      '<section class="panel"><header class="panel__head"><h2>' + icon('info') + 'Help</h2></header><ul class="rows rows--tight"><li class="row-item"><span class="row-item__icon">' + icon('info') + '</span>' +
      '<span class="row-item__text"><b>Where things go</b><em>Which page each kind of thing belongs on, in Home and in Work</em></span>' +
      '<span class="row-item__act"><button type="button" class="btn btn--sm btn--ghost" data-where-help>Open the guide</button></span></li></ul></section>' +

      (GU.lock ? GU.lock.panel() : '') +

      '<section class="panel"><header class="panel__head"><h2>Backup and restore</h2><span class="muted" data-usage></span></header><div class="panel__body stack">' +
      '<p class="tip">' + icon('lock') + '<span>Your data lives only in this browser on this device. Nothing is sent to a server. Export a backup regularly (it includes your uploaded files) and keep it somewhere safe, so you can restore it on another device or if this browser is cleared.</span></p>' +
      '<div class="field--row"><button type="button" class="btn btn--primary" data-export>' + icon('download') + 'Export backup</button>' +
      '<label class="btn">' + icon('upload') + 'Restore from backup<input type="file" accept=".json,application/json" hidden data-import></label></div></div></section>' +

      '<section class="panel"><header class="panel__head"><h2>Example data</h2></header><div class="panel__body field--row">' +
      '<button type="button" class="btn" data-load-demo>Load example data</button><button type="button" class="btn" data-clear-demo>Clear example data</button>' +
      '<button type="button" class="btn btn--danger" data-erase>' + icon('trash') + 'Erase everything</button></div></section>' +
      '</div>';

    if (GU.lock) GU.lock.wirePanel(root);
    GU.brain.mode().then((m) => {
      const el = root.querySelector('[data-mode]');
      if (el) el.textContent = 'Now using: ' + GU.brain.modeLabel(m);
    });
    if (navigator.storage && navigator.storage.estimate) {
      navigator.storage.estimate().then((est) => {
        const el = root.querySelector('[data-usage]');
        if (el && est.usage != null) el.textContent = fmtBytes(est.usage) + ' used';
      }).catch(() => {});
    }

    root.addEventListener('submit', (e) => {
      e.preventDefault();
      const f = e.target;
      const kind = f.dataset.form;
      store.commit((s2) => {
        const set = s2.settings;
        if (kind === 'about') {
          set.name = f.elements.name.value.trim();
          set.business = f.elements.business.value.trim();
          set.currency = f.elements.currency.value;
          set.theme = (f.querySelector('input[name=theme]:checked') || {}).value || 'system';
        } else if (kind === 'brain') {
          set.apiKey = f.elements.apiKey.value.trim();
          set.model = f.elements.model.value.trim();
          set.autoFile = f.elements.autoFile.checked;
          set.ocr = f.elements.ocr.checked;
        } else if (kind === 'reminders') {
          set.docWarnDays = +f.elements.docWarnDays.value;
          if (f.elements.returnDays) set.returnDays = +f.elements.returnDays.value;
        } else if (kind === 'employer') {
          saveEmployer(set, f);
        }
      });
      if (kind === 'employer') {
        const e = employer(store.state);
        return toast(e.set ? 'Saved. Work is for ' + e.name + '.' : 'Saved. Work now uses plain labels.');
      }
      toast('Saved');
    });

    root.addEventListener('click', async (e) => {
      const b = (sel) => e.target.closest(sel);
      if (b('[data-test]')) {
        const out = root.querySelector('[data-test-out]');
        const key = root.querySelector('#set-key').value.trim();
        if (key !== (store.state.settings.apiKey || '')) store.commit((s2) => (s2.settings.apiKey = key));
        out.textContent = 'Asking Claude…';
        try {
          const r = await GU.brain.analyse({ files: [], note: 'Receipt: Tesco Express, total £4.20, paid today by card' });
          out.textContent = r.via === 'offline' ? (r.warning || 'Claude isn’t connected. Add an API key, or open the app inside Claude.') : 'Connected. Claude read the test as: ' + r.summary;
        } catch (err) {
          out.textContent = 'That didn’t work: ' + (err && err.message ? err.message : 'unknown error');
        }
        return;
      }
      if (b('[data-add-account]')) {
        return formDialog({ title: 'Add a bank account', fields: [{ name: 'name', label: 'Account name', required: true, placeholder: 'e.g. Monzo, Barclays savings, Amex' }], submitLabel: 'Add',
          onSubmit: (v) => store.commit((s2) => s2.accounts.push({ id: 'acc-' + uid(), name: v.name })) });
      }
      const ra = b('[data-rename-account]');
      if (ra) {
        const a = store.state.accounts.find((x) => x.id === ra.dataset.renameAccount);
        return formDialog({ title: 'Rename account', fields: [{ name: 'name', label: 'Account name', required: true }], values: { name: a.name },
          onSubmit: (v) => store.commit((s2) => (s2.accounts.find((x) => x.id === a.id).name = v.name)) });
      }
      const rs = b('[data-restore]');
      if (rs) return GU.trash.restore(rs.dataset.restore);
      const ma = b('[data-merge-account]');
      if (ma) return mergeAccount(ma.dataset.mergeAccount);
      const da = b('[data-delete-account]');
      if (da) {
        const id = da.dataset.deleteAccount;
        const n = store.state.transactions.filter((t) => t.account === id).length;
        const ok = await confirmBox({ title: 'Delete this account?', message: n ? 'Its ' + plural(n, 'transaction') + ' will be deleted too. If it’s the same bank account as another one in your list, use Merge into… instead, so nothing is lost or counted twice.' : 'It has no transactions.', confirmLabel: n ? 'Delete it and its transactions' : 'Delete', danger: true });
        if (!ok) return;
        let entry = null;
        store.commit((s2) => {
          const acct = s2.accounts.find((x) => x.id === id);
          const txs = s2.transactions.filter((t) => t.account === id);
          s2.accounts = s2.accounts.filter((x) => x.id !== id);
          s2.transactions = s2.transactions.filter((t) => t.account !== id);
          entry = GU.trash.put(s2, 'accounts', acct, acct.name + (txs.length ? ' and its ' + plural(txs.length, 'transaction') : ''), { transactions: txs });
        });
        return GU.trash.offerUndo(entry);
      }
      if (b('[data-new-category]')) {
        return formDialog({ title: 'New category', fields: [{ name: 'name', label: 'Category name', required: true, placeholder: 'e.g. Gym, Pets, Gifts' },
          { name: 'kind', label: 'It’s for', type: 'segmented', options: [{ value: 'out', label: 'Money out' }, { value: 'in', label: 'Money in' }] }], submitLabel: 'Add',
          onSubmit: (v) => {
            try {
              const res = GU.sorter.createCategory(v.name, v.kind);
              toast(res.made ? 'Added ' + res.place.name : res.label);
            } catch (err) {
              toast(err.message);
              return false;
            }
          } });
      }
      const dc = b('[data-delete-category]');
      if (dc) {
        const [k, name] = dc.dataset.deleteCategory.split('|');
        store.commit((s2) => {
          const cats = s2.settings.categories || {};
          if (Array.isArray(cats[k])) cats[k] = cats[k].filter((x) => String(x).toLowerCase() !== name.toLowerCase());
        });
        return toast('Removed ' + name, { action: 'Undo', onAction: () => store.commit((s2) => {
          const cats = (s2.settings.categories = Object.assign({ out: [], in: [] }, s2.settings.categories || {}));
          cats[k] = (cats[k] || []).concat([name]);
        }) });
      }
      const dr = b('[data-delete-rule]');
      if (dr) return store.commit((s2) => (s2.rules = s2.rules.filter((r) => r.id !== dr.dataset.deleteRule)));
      if (b('[data-new-section]')) return GU.sections.newSection();
      const mv = b('[data-move-section]');
      if (mv && GU.sections.rename) return GU.sections.rename(mv.dataset.moveSection);
      if (b('[data-undo-refile]')) {
        if (!GU.refile || !GU.refile.canUndo()) return;
        const ok = await confirmBox({ title: 'Undo the Home/Work re-sort?', message: 'Everything it changed goes back as it was, including your answers to its questions. It won’t run again by itself.', confirmLabel: 'Undo the re-sort', danger: true });
        if (ok) GU.refile.undo();
        return;
      }
      if (b('[data-run-refile]')) {
        if (!GU.refile || !GU.refile.run) return;
        const r = GU.refile.run({ force: true });
        if (r && r.waiting) return toast('Clear the example data first, so I only sort your own records.');
        if (!r || r.skipped || !r.changed) return toast('Nothing needed sorting.');
        return;
      }
      if (b('[data-export]')) {
        toast('Preparing your backup…');
        const json = await GU.backup.build();
        return GU.ui.saveFile(new Blob([json], { type: 'application/json' }), 'the-ground-up-backup-' + GU.util.today() + '.json');
      }
      if (b('[data-load-demo]')) {
        await GU.sample.load();
        return toast('Example data added');
      }
      if (b('[data-clear-demo]')) return GU.sample.clear();
      if (b('[data-erase]')) {
        const ok = await confirmBox({ title: 'Erase everything?', message: 'This deletes everything saved in this browser: your transactions, bills, documents, receipts, tasks, uploaded files and any older records the site still keeps for you. Export a backup first if you might want them back.', confirmLabel: 'Erase everything', danger: true });
        if (!ok) return;
        await GU.files.clear();
        store.replaceAll(store.blank());
        if (GU.assistant) GU.assistant.clear();
        toast('Everything erased');
        GU.view.go('today');
      }
    });
    root.addEventListener('change', (e) => {
      const sw = e.target.closest('[data-cat-menu]');
      if (!sw || !GU.sections || !GU.sections.setHidden) return;
      const id = sw.dataset.catMenu;
      const sec = (store.state.sections || []).find((x) => x.id === id);
      if (!sec) return;
      const was = GU.sections.isHidden(sec);
      const hide = sw.value === 'hidden';
      GU.sections.setHidden(id, hide);
      toast(hide ? sec.name + ' is hidden from the menu' : sec.name + ' is in the menu', { action: 'Undo', onAction: () => GU.sections.setHidden(id, was) });
    });
    root.addEventListener('change', async (e) => {
      const imp = e.target.closest('[data-import]');
      if (!imp || !imp.files[0]) return;
      const ok = await confirmBox({ title: 'Restore this backup?', message: 'This replaces everything currently in the app with the contents of <b>' + esc(imp.files[0].name) + '</b>.', confirmLabel: 'Restore', danger: true });
      if (!ok) return;
      try {
        await GU.backup.restore(await imp.files[0].text());
        if (GU.assistant) GU.assistant.clear();
        toast('Backup restored');
      } catch (err) {
        toast(err.message || 'That file could not be restored.');
      }
    });
  }

  GU.tabs.settings = { label: 'Settings', short: 'Settings', icon: 'settings', part: 'shared', render };
})();
