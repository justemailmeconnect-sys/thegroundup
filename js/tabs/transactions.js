/* The Ground Up: Bank transactions. One ledger for every account, CSV statement import,
   automatic categories and rules that learn from your corrections. */
(function () {
  'use strict';
  const GU = window.GU;
  const { esc, uid, today, money, fmtDate, monthKey, monthLabel, plural, parseCSV, parseLooseDate, guessDateOrder, parseAmount, debounce } = GU.util;
  const { icon, pill, emptyState, selectOptions, formDialog, openDialog, toast } = GU.ui;
  const F = GU.finance;
  const store = GU.store;

  const ui = { q: '', month: '', account: '', category: '', type: '', limit: 100 };

  function accountName(id) {
    const a = store.state.accounts.find((x) => x.id === id);
    return a ? a.name : '';
  }
  function accountOptions() {
    return store.state.accounts.map((a) => ({ value: a.id, label: a.name })).concat([{ value: '__new', label: '+ Add another account…' }]);
  }
  function ensureAccount(v) {
    if (v.account !== '__new') return v.account;
    const name = (v.newAccount || '').trim() || 'New account';
    const id = 'acc-' + uid();
    store.state.accounts.push({ id, name });
    return id;
  }

  function filtered() {
    const s = store.state;
    const q = ui.q.toLowerCase();
    return s.transactions.filter((t) => {
      if (ui.month && t.date.slice(0, 7) !== ui.month) return false;
      if (ui.account && t.account !== ui.account) return false;
      if (ui.category === '__none' && t.category) return false;
      if (ui.category && ui.category !== '__none' && t.category !== ui.category) return false;
      if (ui.type === 'in' && t.amount <= 0) return false;
      if (ui.type === 'out' && t.amount >= 0) return false;
      if (q && !(t.description + ' ' + (t.notes || '') + ' ' + (t.category || '')).toLowerCase().includes(q)) return false;
      return true;
    }).sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  }

  function rowsHTML(list) {
    if (!list.length) {
      return '<tr><td colspan="5">' + emptyState({ icon: 'search', title: store.state.transactions.length ? 'No transactions match' : 'No transactions yet',
        text: store.state.transactions.length ? 'Try clearing the search or filters.' : 'Import a CSV statement from your bank, or add a payment by hand.' }) + '</td></tr>';
    }
    return list.slice(0, ui.limit).map((t) =>
      '<tr class="clickable" data-id="' + esc(t.id) + '" tabindex="0">' +
      '<td class="nowrap muted">' + esc(fmtDate(t.date, { short: true })) + '</td>' +
      '<td class="wrap"><b class="cell-title">' + esc(t.description) + '</b>' + (t.notes ? '<small class="cell-sub">' + esc(t.notes) + '</small>' : '') + '</td>' +
      '<td>' + (t.category ? pill(t.category, F.isTransfer(t) ? 'muted' : '') : pill('Needs a category', 'warn', 'alert')) + '</td>' +
      '<td class="hide-sm muted">' + esc(accountName(t.account)) + '</td>' +
      '<td class="num ' + (t.amount > 0 ? 'is-in' : '') + '">' + esc(money(t.amount, { sign: true })) + '</td></tr>').join('');
  }

  function render(root) {
    const s = store.state;
    const intent = GU.view.intent('transactions');
    if (intent && intent.filter === 'uncategorised') {
      Object.assign(ui, { q: '', month: '', account: '', type: '', category: '__none' });
    }
    const months = Array.from(new Set(s.transactions.map((t) => t.date.slice(0, 7)))).sort().reverse();
    const cats = Array.from(new Set(s.transactions.map((t) => t.category).filter(Boolean))).sort();

    root.innerHTML = GU.view.head({
      eyebrow: 'Money',
      title: 'Bank transactions',
      text: 'Every payment in and out of your accounts. Import a statement from your bank as a CSV file and I’ll sort each line into a category.',
      actions: '<button type="button" class="btn" data-import>' + icon('upload') + 'Import statement</button>' +
        '<button type="button" class="btn btn--primary" data-add>' + icon('plus') + 'Add transaction</button>',
    }) +
      '<div class="toolbar">' +
      '<label class="search">' + icon('search') + '<input type="search" id="tx-search" placeholder="Search descriptions" value="' + esc(ui.q) + '" aria-label="Search transactions"></label>' +
      '<select id="tx-month" aria-label="Month">' + selectOptions(months.map((m) => ({ value: m, label: monthLabel(m, true) })), ui.month, 'All months') + '</select>' +
      '<select id="tx-account" aria-label="Account">' + selectOptions(s.accounts.map((a) => ({ value: a.id, label: a.name })), ui.account, 'All accounts') + '</select>' +
      '<select id="tx-category" aria-label="Category">' + selectOptions([{ value: '__none', label: 'Needs a category' }].concat(cats), ui.category, 'All categories') + '</select>' +
      '<select id="tx-type" aria-label="Money in or out">' + selectOptions([{ value: 'in', label: 'Money in' }, { value: 'out', label: 'Money out' }], ui.type, 'In and out') + '</select>' +
      '</div>' +
      '<p class="summary-line" id="tx-summary"></p>' +
      '<div class="panel"><div class="table-wrap"><table class="tbl"><thead><tr><th>Date</th><th>Description</th><th>Category</th><th class="hide-sm">Account</th><th class="num">Amount</th></tr></thead>' +
      '<tbody id="tx-rows"></tbody></table></div></div>' +
      '<div class="more-row" id="tx-more"></div>';

    const draw = () => {
      const list = filtered();
      root.querySelector('#tx-rows').innerHTML = rowsHTML(list);
      root.querySelector('#tx-summary').innerHTML = list.length
        ? esc(plural(list.length, 'transaction')) + ' · In <b>' + esc(money(F.moneyIn(list))) + '</b> · Out <b>' + esc(money(F.moneyOut(list))) + '</b>' +
          ' · Net <b>' + esc(money(F.moneyIn(list) - F.moneyOut(list), { sign: true })) + '</b> <span class="muted">(transfers between your own accounts are left out)</span>'
        : '';
      root.querySelector('#tx-more').innerHTML = list.length > ui.limit
        ? '<button type="button" class="btn" data-more>Show ' + Math.min(100, list.length - ui.limit) + ' more of ' + (list.length - ui.limit) + '</button>' : '';
    };
    draw();

    root.querySelector('#tx-search').addEventListener('input', debounce((e) => {
      ui.q = e.target.value;
      ui.limit = 100;
      draw();
    }, 150));
    [['#tx-month', 'month'], ['#tx-account', 'account'], ['#tx-category', 'category'], ['#tx-type', 'type']].forEach(([sel, key]) => {
      root.querySelector(sel).addEventListener('change', (e) => {
        ui[key] = e.target.value;
        ui.limit = 100;
        draw();
      });
    });
    root.addEventListener('click', (e) => {
      if (e.target.closest('[data-add]')) return create();
      if (e.target.closest('[data-import]')) return importCSV();
      if (e.target.closest('[data-more]')) {
        ui.limit += 100;
        return draw();
      }
      const row = e.target.closest('tr[data-id]');
      if (row) edit(row.dataset.id);
    });
    root.addEventListener('keydown', (e) => {
      const row = e.target.closest && e.target.closest('tr[data-id]');
      if (row && e.key === 'Enter') edit(row.dataset.id);
    });
  }

  function suggestMatch(desc) {
    return String(desc || '').replace(/[*#\d]+/g, ' ').trim().split(/\s+/).slice(0, 2).join(' ');
  }

  function fields(isNew, dir) {
    return [
      { name: 'direction', label: 'Type', type: 'segmented', options: [{ value: 'out', label: 'Money out', icon: 'out' }, { value: 'in', label: 'Money in', icon: 'in' }], default: dir || 'out' },
      { name: 'description', label: 'Description', required: true, placeholder: 'e.g. Tesco Express' },
      { name: 'amount', label: 'Amount', type: 'money', required: true, half: true },
      { name: 'date', label: 'Date', type: 'date', required: true, half: true },
      { name: 'category', label: 'Category', type: 'select', options: F.categoryOptions(), placeholder: 'Choose later', half: true },
      { name: 'account', label: 'Account', type: 'select', options: accountOptions(), half: true },
      { name: 'newAccount', label: 'New account name', placeholder: 'e.g. Monzo, Barclays savings', showIf: (v) => v.account === '__new' },
      { name: 'notes', label: 'Notes', type: 'textarea', rows: 2, optional: true },
      { name: 'remember', label: 'Remember', type: 'checkbox', checkLabel: 'Always use this category for similar payments', showIf: (v) => !!v.category },
      { name: 'match', label: 'When the description contains', showIf: (v) => v.remember && !!v.category, help: 'Applies to future imports and to existing transactions that have no category yet.' },
    ];
  }

  function save(v, existing, extra) {
    store.commit((s) => {
      const account = ensureAccount(v);
      const rec = Object.assign(existing ? Object.assign({}, existing) : { id: 't-' + uid(), source: 'manual', created: today() }, extra || {}, {
        date: v.date, description: v.description, amount: (v.direction === 'in' ? 1 : -1) * Math.abs(v.amount || 0),
        category: v.category, account, notes: v.notes,
      });
      const i = s.transactions.findIndex((t) => t.id === rec.id);
      if (i >= 0) s.transactions[i] = rec;
      else s.transactions.push(rec);
      if (v.remember && v.category && v.match) {
        s.rules = s.rules.filter((r) => r.match.toLowerCase() !== v.match.toLowerCase());
        s.rules.push({ id: 'r-' + uid(), match: v.match, category: v.category });
        let n = 0;
        for (const t of s.transactions) {
          if (!t.category && (' ' + t.description + ' ').toLowerCase().includes(v.match.toLowerCase())) {
            t.category = v.category;
            n++;
          }
        }
        if (n) setTimeout(() => toast('Also categorised ' + plural(n, 'other transaction')), 0);
      }
    });
  }

  function create(prefill, opts) {
    prefill = prefill || {};
    opts = opts || {};
    const dir = prefill.direction || (prefill.amount > 0 ? 'in' : 'out');
    formDialog({
      title: dir === 'in' ? 'Add money in' : 'Add a transaction',
      fields: fields(true, dir),
      values: Object.assign({ date: today(), account: store.state.accounts[0] && store.state.accounts[0].id, direction: dir }, prefill, { amount: prefill.amount != null ? Math.abs(prefill.amount) : null }),
      submitLabel: 'Add',
      onSubmit: (v) => {
        save(v, null, opts.extra);
        toast('Transaction added');
        if (opts.onSaved) opts.onSaved();
      },
    });
  }

  function edit(id) {
    const t = store.find('transactions', id);
    if (!t) return;
    formDialog({
      title: 'Edit transaction',
      fields: fields(false),
      values: Object.assign({}, t, { direction: t.amount > 0 ? 'in' : 'out', amount: Math.abs(t.amount), match: suggestMatch(t.description) }),
      onSubmit: (v) => save(v, t),
      onDelete: () => {
        const rec = store.remove('transactions', id);
        toast('Transaction deleted', { action: 'Undo', onAction: () => store.upsert('transactions', rec) });
      },
    });
  }

  /* ---------- CSV statement import ---------- */
  function guessColumns(header, rows) {
    const h = header.map((x) => x.toLowerCase());
    const find = (...words) => h.findIndex((c) => words.some((w) => c.includes(w)));
    let date = find('transaction date', 'date', 'completed', 'posted');
    let desc = find('description', 'narrative', 'details', 'counter party', 'merchant', 'name', 'payee', 'memo', 'reference');
    let amount = find('amount', 'value');
    let paidIn = find('paid in', 'credit', 'money in', 'in (');
    let paidOut = find('paid out', 'debit', 'money out', 'out (');
    if (amount >= 0 && (h[amount].includes('balance'))) amount = -1;
    const mode = paidIn >= 0 && paidOut >= 0 && (amount < 0 || paidIn !== amount) ? 'split' : 'single';
    if (date < 0 || desc < 0 || (mode === 'single' && amount < 0)) {
      // No useful headers (some banks, e.g. HSBC): look at the data itself.
      const sample = rows.slice(0, 10);
      const cols = header.length;
      const score = (fn) => Array.from({ length: cols }, (_, i) => sample.filter((r) => fn(r[i] || '')).length);
      const dateScore = score((v) => !!parseLooseDate(v, 'dmy'));
      const numScore = score((v) => /\d/.test(v) && !isNaN(parseAmount(v)) && !parseLooseDate(v, 'dmy'));
      const textScore = score((v) => /[a-z]{3}/i.test(v) && !parseLooseDate(v, 'dmy'));
      const best = (arr, skip) => arr.reduce((b, v, i) => (skip.includes(i) || v <= (arr[b] || -1) ? b : i), -1);
      if (date < 0) date = best(dateScore, []);
      if (desc < 0) desc = best(textScore, [date]);
      if (amount < 0 && mode === 'single') amount = best(numScore, [date, desc]);
    }
    return { date, desc, amount, paidIn, paidOut, mode };
  }

  function importCSV(presetFile) {
    const s = store.state;
    let parsed = null;
    let map = null;
    let file = null;
    const d = openDialog({
      title: 'Import a bank statement',
      wide: true,
      body: '<div data-step></div>',
      footer: '<span class="spacer"></span><button type="button" class="btn" data-close>Cancel</button><button type="submit" class="btn btn--primary" data-go disabled>Import</button>',
    });
    const step = d.body.querySelector('[data-step]');
    const go = d.el.querySelector('[data-go]');

    function pickStep() {
      step.innerHTML = '<p class="dlg__intro">Download a statement from your online banking as a <b>CSV</b> file (sometimes called “spreadsheet” or “Excel/CSV”), then choose it here. Most UK banks work: Monzo, Starling, Barclays, HSBC, Lloyds, Nationwide, Santander, NatWest, Revolut and more.</p>' +
        '<label class="drop drop--big" tabindex="0"><input type="file" accept=".csv,text/csv,.txt" hidden>' + icon('upload', 'drop__icon') +
        '<span><b>Choose a CSV statement</b><small>or drop it here</small></span></label>' +
        '<p class="field__help">' + icon('lock') + ' The file is read in this browser only. Nothing is uploaded anywhere.</p>';
      const drop = step.querySelector('.drop');
      const input = step.querySelector('input');
      input.addEventListener('change', () => input.files[0] && load(input.files[0]));
      drop.addEventListener('keydown', (e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), input.click()));
      drop.addEventListener('dragover', (e) => (e.preventDefault(), drop.classList.add('is-over')));
      drop.addEventListener('dragleave', () => drop.classList.remove('is-over'));
      drop.addEventListener('drop', (e) => {
        e.preventDefault();
        if (e.dataTransfer.files[0]) load(e.dataTransfer.files[0]);
      });
    }

    async function load(f) {
      file = f;
      const text = await f.text();
      const rows = parseCSV(text);
      if (rows.length < 2) {
        toast("That file doesn't look like a statement. Check it's a CSV file.");
        return;
      }
      let headerIdx = rows.findIndex((r) => r.some((c) => /date/i.test(c)) && r.length >= 3);
      if (headerIdx < 0 || headerIdx > 15) headerIdx = -1;
      const header = headerIdx >= 0 ? rows[headerIdx] : rows[0].map((_, i) => 'Column ' + (i + 1));
      const data = rows.slice(headerIdx + 1).filter((r) => r.length >= Math.min(3, header.length));
      parsed = { header, data };
      map = guessColumns(header, data);
      map.order = map.date >= 0 ? guessDateOrder(data.map((r) => r[map.date])) : 'dmy';
      map.account = s.accounts[0] ? s.accounts[0].id : '__new';
      map.flip = false;
      mapStep();
    }

    function build() {
      const out = [];
      for (const r of parsed.data) {
        const date = parseLooseDate(r[map.date], map.order);
        const description = (r[map.desc] || '').replace(/\s+/g, ' ').trim();
        let amount;
        if (map.mode === 'split') {
          const pin = parseAmount(r[map.paidIn]);
          const pout = parseAmount(r[map.paidOut]);
          amount = (isNaN(pin) ? 0 : Math.abs(pin)) - (isNaN(pout) ? 0 : Math.abs(pout));
        } else amount = parseAmount(r[map.amount]);
        if (!date || !description || isNaN(amount) || amount === 0) continue;
        if (map.flip) amount = -amount;
        out.push({ date, description, amount });
      }
      return out;
    }

    function mapStep() {
      const colOpts = parsed.header.map((h, i) => ({ value: String(i), label: h || 'Column ' + (i + 1) }));
      const rows = build();
      const existing = new Set(s.transactions.map((t) => t.date + '|' + t.amount.toFixed(2) + '|' + t.description.toLowerCase()));
      const fresh = rows.filter((r) => !existing.has(r.date + '|' + r.amount.toFixed(2) + '|' + r.description.toLowerCase()));
      const dupes = rows.length - fresh.length;
      step.innerHTML =
        '<p class="dlg__intro"><b>' + esc(file.name) + '</b>: check the columns below look right. I guessed them from the file.</p>' +
        '<div class="form-grid">' +
        '<div class="field field--half"><label class="field__label" for="m-date">Date column</label><select id="m-date" data-m="date">' + selectOptions(colOpts, String(map.date)) + '</select></div>' +
        '<div class="field field--half"><label class="field__label" for="m-desc">Description column</label><select id="m-desc" data-m="desc">' + selectOptions(colOpts, String(map.desc)) + '</select></div>' +
        '<div class="field"><span class="field__label">Amounts</span><div class="seg"><label><input type="radio" name="m-mode" value="single"' + (map.mode === 'single' ? ' checked' : '') + '><span>One amount column</span></label>' +
        '<label><input type="radio" name="m-mode" value="split"' + (map.mode === 'split' ? ' checked' : '') + '><span>Separate “paid in” and “paid out” columns</span></label></div></div>' +
        (map.mode === 'single'
          ? '<div class="field field--half"><label class="field__label" for="m-amount">Amount column</label><select id="m-amount" data-m="amount">' + selectOptions(colOpts, String(map.amount)) + '</select></div>' +
            '<div class="field field--half"><span class="field__label">Signs</span><label class="check"><input type="checkbox" id="m-flip"' + (map.flip ? ' checked' : '') + '><span>Spending shows as positive (common on credit cards)</span></label></div>'
          : '<div class="field field--half"><label class="field__label" for="m-in">Paid in column</label><select id="m-in" data-m="paidIn">' + selectOptions(colOpts, String(map.paidIn)) + '</select></div>' +
            '<div class="field field--half"><label class="field__label" for="m-out">Paid out column</label><select id="m-out" data-m="paidOut">' + selectOptions(colOpts, String(map.paidOut)) + '</select></div>') +
        '<div class="field field--half"><label class="field__label" for="m-order">Date format</label><select id="m-order">' + selectOptions([{ value: 'dmy', label: 'Day first (31/12/2026)' }, { value: 'mdy', label: 'Month first (12/31/2026)' }], map.order) + '</select></div>' +
        '<div class="field field--half"><label class="field__label" for="m-account">Which account is this?</label><select id="m-account">' + selectOptions(accountOptions(), map.account) + '</select></div>' +
        (map.account === '__new' ? '<div class="field"><label class="field__label" for="m-newacc">New account name</label><input id="m-newacc" type="text" placeholder="e.g. Monzo current account" value="' + esc(map.newAccount || '') + '"></div>' : '') +
        '</div>' +
        '<h3 class="subhead">Preview</h3>' +
        (rows.length
          ? '<div class="table-wrap"><table class="tbl tbl--compact"><thead><tr><th>Date</th><th>Description</th><th>Category</th><th class="num">Amount</th></tr></thead><tbody>' +
            fresh.slice(0, 8).map((r) => {
              const c = F.categorise(r.description, r.amount, s.rules);
              return '<tr><td class="nowrap">' + esc(fmtDate(r.date, { short: true })) + '</td><td class="wrap">' + esc(r.description) + '</td><td>' + (c ? pill(c) : pill('Needs a category', 'warn')) + '</td><td class="num ' + (r.amount > 0 ? 'is-in' : '') + '">' + esc(money(r.amount, { sign: true })) + '</td></tr>';
            }).join('') + '</tbody></table></div>' +
            '<p class="field__help">' + esc(plural(fresh.length, 'new transaction')) + ' ready' + (dupes ? ', ' + plural(dupes, 'duplicate') + ' already imported will be skipped' : '') + '.</p>'
          : '<p class="banner banner--crit">' + icon('alert') + 'I couldn’t read any transactions with these columns. Try different columns or date format.</p>');
      go.disabled = !fresh.length;
      go.textContent = fresh.length ? 'Import ' + plural(fresh.length, 'transaction') : 'Import';
      step.querySelectorAll('[data-m]').forEach((el) => el.addEventListener('change', () => {
        map[el.dataset.m] = +el.value;
        mapStep();
      }));
      step.querySelectorAll('input[name="m-mode"]').forEach((el) => el.addEventListener('change', () => {
        map.mode = el.value;
        if (map.mode === 'split' && (map.paidIn < 0 || map.paidOut < 0)) {
          map.paidIn = map.paidIn >= 0 ? map.paidIn : 0;
          map.paidOut = map.paidOut >= 0 ? map.paidOut : 0;
        }
        mapStep();
      }));
      const flip = step.querySelector('#m-flip');
      if (flip) flip.addEventListener('change', () => ((map.flip = flip.checked), mapStep()));
      step.querySelector('#m-order').addEventListener('change', (e) => ((map.order = e.target.value), mapStep()));
      step.querySelector('#m-account').addEventListener('change', (e) => ((map.account = e.target.value), mapStep()));
      const na = step.querySelector('#m-newacc');
      if (na) na.addEventListener('input', () => (map.newAccount = na.value));
      map.fresh = fresh;
    }

    d.form.addEventListener('submit', (e) => {
      e.preventDefault();
      if (!map || !map.fresh || !map.fresh.length) return;
      const batch = 'imp-' + uid();
      let accountId = map.account;
      store.commit((st) => {
        if (accountId === '__new') {
          accountId = 'acc-' + uid();
          st.accounts.push({ id: accountId, name: (map.newAccount || '').trim() || file.name.replace(/\.\w+$/, '') });
        }
        for (const r of map.fresh) {
          st.transactions.push({ id: 't-' + uid(), date: r.date, description: r.description, amount: r.amount, category: F.categorise(r.description, r.amount, st.rules),
            account: accountId, notes: '', source: 'import', importBatch: batch, created: today() });
        }
      });
      const n = map.fresh.length;
      d.close();
      toast('Imported ' + plural(n, 'transaction'), {
        action: 'Undo',
        onAction: () => store.commit((st) => (st.transactions = st.transactions.filter((t) => t.importBatch !== batch))),
      });
      if (location.hash !== '#transactions') GU.view.go('transactions');
    });

    if (presetFile) load(presetFile);
    else pickStep();
  }

  GU.tabs.transactions = { label: 'Bank transactions', short: 'Bank', icon: 'bank', render, create, edit, importCSV };
})();
