/* The Ground Up: the evidence pack (GU.evidence).
   One zip of the papers an application may ask for (a mortgage, tenancy or visa, say): your bank statements,
   payslips and employment papers, and a month-by-month summary of the wages that reached your account.
   You choose the period and what goes in, and a preview shows what's there and what's missing before anything
   is built. Only what you tick goes in, and the contents list uses titles and dates, never bank descriptions.
   It's a tidy copy of your own papers, not advice: what an application needs is for you to check. */
(function () {
  'use strict';
  const GU = window.GU;
  const { esc, today, addDays, addMonths, shiftMonth, daysInMonth, monthLabel, fmtDate, plural, sum, isISO } = GU.util;
  const store = GU.store;

  const BANK_TYPE = 'Bank, savings and pension';
  const PAYSLIPS = 'Employment and payslips';
  const FOLDERS = { statements: '1 Bank statements', payslips: '2 Payslips', wages: '3 Wages summary' };
  const pad = (n) => String(n).padStart(2, '0');
  const long = (iso) => fmtDate(iso);
  const span = (a, b) => (a === b ? long(a) : long(a) + ' to ' + long(b));

  /* ---------- small shared helpers (the Tax year page uses them too) ---------- */
  const BOM = String.fromCharCode(0xfeff); // so spreadsheet apps read the CSV as UTF-8 (the £ sign, accents)
  function csvCell(v) {
    let t = String(v == null ? '' : v);
    if (/^[=+\-@]/.test(t) && !/^-?\d+(\.\d+)?$/.test(t)) t = "'" + t;
    return /[",\n\r]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t;
  }
  const csvText = (rows) => BOM + rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
  const n2 = (x) => (Math.round((Number(x) || 0) * 100) / 100).toFixed(2);
  /* Takes out anything that looks like an account, card or sort-code number, or another long reference. */
  function clean(text) {
    return String(text == null ? '' : text)
      .replace(/\b\d{4}[ -]?\d{4}[ -]?\d{4}[ -]?\d{1,7}\b/g, '…')
      .replace(/\b\d{2}[ -]\d{2}[ -]\d{2}\b/g, '…')
      .replace(/\d{5,}/g, '…')
      .replace(/\s+/g, ' ')
      .trim();
  }
  const fileSafe = (t, max) => clean(t).replace(/…/g, ' ').replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim().slice(0, max || 60).trim();
  const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'image/heic': 'heic', 'image/svg+xml': 'svg', 'application/pdf': 'pdf', 'text/plain': 'txt', 'text/csv': 'csv' };
  function extOf(name, type) {
    const m = String(name || '').match(/\.([a-z0-9]{1,5})$/i);
    return (m ? m[1] : EXT[type] || 'bin').toLowerCase();
  }

  /* A printable page (it saves as a PDF): a title, a few facts, then blocks of headed tables.
     o: {title, lede, meta: [[label, value]], blocks: [{heading, intro, cols: [{label, num}], rows: [[text]], total: [text]}], note, foot}.
     Everything is escaped here, so pass plain text. On a phone the tables scroll sideways inside the page. */
  function printPage(o) {
    const meta = (o.meta || []).map(([k, v]) => '<dt>' + esc(k) + '</dt><dd>' + esc(v) + '</dd>').join('');
    const blocks = (o.blocks || []).map((b) => {
      const head = b.cols ? '<thead><tr>' + b.cols.map((c) => '<th' + (c.num ? ' class="num"' : '') + '>' + esc(c.label) + '</th>').join('') + '</tr></thead>' : '';
      const cell = (c, i) => '<td' + (b.cols && b.cols[i] ? ' data-label="' + esc(b.cols[i].label) + '"' + (b.cols[i].num ? ' class="num"' : '') : '') + '>' + esc(c) + '</td>';
      const body = (b.rows || []).map((r) => '<tr>' + r.map(cell).join('') + '</tr>').join('');
      const foot = b.total ? '<tfoot><tr>' + b.total.map(cell).join('') + '</tr></tfoot>' : '';
      return '<section>' + (b.heading ? '<h2>' + esc(b.heading) + '</h2>' : '') + (b.intro ? '<p class="intro">' + esc(b.intro) + '</p>' : '') +
        (b.cols ? '<div class="tw"><table>' + head + '<tbody>' + body + '</tbody>' + foot + '</table></div>' : '') + '</section>';
    }).join('');
    return '<!doctype html>\n<html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">' +
      '<title>' + esc(o.title) + '</title><style>' +
      ':root{--ink:#1d2622;--muted:#5f6b66;--line:#dce2df;--soft:#f1f5f3}' +
      '*{box-sizing:border-box}html{background:#eef1ef}body{margin:0;color:var(--ink);font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}' +
      '.sheet{max-width:900px;margin:24px auto;background:#fff;padding:40px 44px;border:1px solid var(--line);border-radius:10px}' +
      'header{display:flex;justify-content:space-between;align-items:flex-start;gap:24px;flex-wrap:wrap;border-bottom:2px solid var(--ink);padding-bottom:18px;margin-bottom:22px}' +
      'h1{font-size:22px;line-height:1.25;margin:0 0 6px;letter-spacing:-.01em;max-width:32ch}.lede{margin:0;color:var(--muted);max-width:60ch}' +
      'h2{font-size:15px;margin:26px 0 6px}.intro{margin:0 0 8px;color:var(--muted);font-size:13px}' +
      'dl{display:grid;grid-template-columns:auto auto;gap:3px 16px;margin:0;font-size:13px}dt{color:var(--muted)}dd{margin:0;font-weight:600;text-align:right}' +
      '.tw{overflow-x:auto}table{width:100%;border-collapse:collapse;font-size:13px}' +
      'th{text-align:left;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);border-bottom:1px solid var(--ink);padding:8px 10px 8px 0;white-space:nowrap}' +
      'td{border-bottom:1px solid var(--line);padding:8px 10px 8px 0;vertical-align:top;overflow-wrap:anywhere}' +
      '.num{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums;padding-right:0}th.num{padding-right:0}' +
      'tfoot td{border-bottom:0;border-top:2px solid var(--ink);font-weight:700;padding-top:10px}' +
      '.note{margin:24px 0 0;padding:12px 14px;background:var(--soft);border-radius:8px}' +
      '.end{display:flex;justify-content:space-between;align-items:center;gap:16px;flex-wrap:wrap;margin:28px 0 0}.foot{margin:0;color:var(--muted);font-size:11px}' +
      '.print{border:0;border-radius:999px;background:var(--ink);color:#fff;font:600 14px/1 inherit;padding:12px 18px;cursor:pointer}' +
      '@page{size:A4;margin:16mm}@media print{html{background:#fff}.sheet{margin:0;border:0;padding:0;max-width:none}.print{display:none}tr{break-inside:avoid}section{break-inside:auto}}' +
      // On a phone each row stacks: its first cell is the heading and the others say what they are.
      '@media screen and (max-width:640px){.sheet{margin:0;padding:24px 16px;border:0;border-radius:0}h1{font-size:19px}' +
      'thead{display:none}table,tbody,tfoot,tr,td{display:block;width:100%}tr{padding:9px 0;border-bottom:1px solid var(--line)}' +
      'td{border:0;padding:1px 0;text-align:left}td:first-child{font-weight:600}td:first-child:last-child{font-weight:400}td:empty{display:none}' +
      'td:not(:first-child)::before{content:attr(data-label) ": ";color:var(--muted);font-size:12px;font-weight:400}' +
      'tfoot tr{display:flex;justify-content:space-between;gap:12px;border-top:2px solid var(--ink);border-bottom:0;margin-top:-1px}tfoot td{width:auto;padding-top:10px}tfoot td::before{content:none!important}tfoot td:empty{display:none}}' +
      '</style></head><body><main class="sheet"><header><div><h1>' + esc(o.title) + '</h1>' + (o.lede ? '<p class="lede">' + esc(o.lede) + '</p>' : '') + '</div><dl>' + meta + '</dl></header>' +
      blocks + (o.note ? '<p class="note">' + esc(o.note) + '</p>' : '') +
      '<div class="end"><p class="foot">' + esc(o.foot || 'Made with The Ground Up.') + '</p><button class="print" type="button" onclick="window.print()">Print or save as PDF</button></div></main></body></html>';
  }

  /* ---------- dates ---------- */
  const monthStart = (key) => key + '-01';
  const monthEnd = (key) => key + '-' + pad(daysInMonth(+key.slice(0, 4), +key.slice(5)));
  function monthsIn(from, to) {
    const out = [];
    for (let k = from.slice(0, 7); k <= to.slice(0, 7) && out.length < 600; k = shiftMonth(k, 1)) out.push(k);
    return out;
  }
  const MON = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  const monIdx = (w) => MON.indexOf(String(w || '').slice(0, 3).toLowerCase()) + 1;
  function mkISO(y, m, d) {
    if (!(y > 1990 && m >= 1 && m <= 12 && d >= 1)) return '';
    return y + '-' + pad(m) + '-' + pad(Math.min(d, daysInMonth(y, m)));
  }
  const overlaps = (r, from, to) => !!r && r.from <= to && r.to >= from;

  /* The period for 'last 3 / 6 / 12 months': up to today, from the same day that many months ago. */
  function lastMonths(n, to) {
    to = to || today();
    return { from: addDays(addMonths(to, -n), 1), to };
  }

  /* ---------- what's in your records ---------- */
  const isStatement = (d) => !!d && d.context !== 'work' && (!!d.statementBatch || (d.type === BANK_TYPE && /statement/i.test(d.title || '')));
  const isPayslipDoc = (d) => !!d && d.type === PAYSLIPS;
  // Employment papers that aren't a month's payslip, so they don't stand in for one when looking for gaps.
  const NOT_PAYSLIP = /\bp60\b|\bp45\b|\bp11d\b|contract|offer|tax (summary|credit)|reference|letter|agreement/i;
  const filesOf = (d) => ((d && d.files) || []).filter((f) => f && f.id);
  const bankOf = (d) => {
    const m = String((d && d.title) || '').match(/^(.*?)\s+statement/i);
    return m && m[1].trim() ? m[1].trim() : 'Bank';
  };

  const RANGE = /(\d{1,2})\s+([A-Za-z]{3,9})(?:\s+(\d{4}))?\s+(?:to|-|–|—)\s+(\d{1,2})\s+([A-Za-z]{3,9})(?:\s+(\d{4}))?/;
  /* The dates a statement covers: from its title ('Santander statement 17 Jan to 16 Feb', which the importer
     writes from that file's own lines), else from the lines imported with it, else the one date it's filed under. */
  function stmtRange(s, d) {
    const m = String(d.title || '').match(RANGE);
    const ref = +String(d.issueDate || d.created || today()).slice(0, 4);
    if (m && monIdx(m[2]) && monIdx(m[5])) {
      const sm = monIdx(m[2]);
      const em = monIdx(m[5]);
      const ey = +m[6] || ref;
      const sy = +m[3] || (sm > em ? ey - 1 : ey);
      const from = mkISO(sy, sm, +m[1]);
      const to = mkISO(ey, em, +m[4]);
      if (from && to && from <= to) return { from, to };
    }
    if (d.statementBatch && (s.documents || []).filter((x) => x.statementBatch === d.statementBatch).length === 1) {
      const dates = (s.transactions || []).filter((t) => t.importBatch === d.statementBatch && t.date).map((t) => t.date).sort();
      if (dates.length) return { from: dates[0], to: dates[dates.length - 1] };
    }
    return isISO(d.issueDate) ? { from: d.issueDate, to: d.issueDate } : null;
  }
  /* The dates a payslip or employment paper is for: its date, or the month in its title ('Payslip June 2026'). */
  function docSpan(d) {
    if (isISO(d.issueDate)) return { from: d.issueDate, to: d.issueDate };
    const t = String(d.title || '');
    let m = t.match(/\b(\d{4})[-/](\d{1,2})\b/);
    if (m && +m[2] >= 1 && +m[2] <= 12) return { from: mkISO(+m[1], +m[2], 1), to: mkISO(+m[1], +m[2], 31) };
    m = t.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?[\s,\-]*(\d{4})\b/i);
    if (m) return { from: mkISO(+m[2], monIdx(m[1]), 1), to: mkISO(+m[2], monIdx(m[1]), 31) };
    return null;
  }
  /* The earliest line in the accounts of a bank, so months before it opened aren't called missing. */
  function openedOf(s, bank) {
    const b = String(bank).toLowerCase();
    const ids = (s.accounts || []).filter((a) => String(a.bank || '').toLowerCase() === b || String(a.name || '').toLowerCase().startsWith(b)).map((a) => a.id);
    if (!ids.length) return '';
    const dates = (s.transactions || []).filter((t) => ids.includes(t.account) && t.date).map((t) => t.date).sort();
    return dates[0] || '';
  }

  /* Wages that reached your account in the period, one list: from the Tax year page's own figures when it's
     there, so the pack and the page always agree. */
  function wageLines(s, from, to) {
    if (GU.taxyear && typeof GU.taxyear.wageLines === 'function') return GU.taxyear.wageLines(s, from, to);
    const F = GU.finance;
    const T = GU.tabs.transactions;
    const e = GU.workMoney ? GU.workMoney.employer(s) : { set: false };
    return (s.transactions || []).filter((t) => t.date >= from && t.date <= to && t.amount > 0 && F.counts(t) && (e.set ? T && T.isWages && T.isWages(s, t) : t.category === 'Salary'))
      .map((t) => ({ id: t.id, date: t.date, amount: t.amount })).sort((a, b) => a.date.localeCompare(b.date));
  }

  /* ---------- the preview: what's there, and what's missing ---------- */
  /* o: {from, to}. Everything is worked out from your records (no files are read). */
  function preview(s, o) {
    const from = o.from;
    const to = o.to;
    const t = today();
    const out = { from, to, statements: { docs: [], files: 0, noFile: [], unplaced: [], gaps: [], latest: [], any: false }, payslips: { docs: [], files: 0, noFile: [], undated: [], gaps: [] }, wages: { rows: [], total: 0, count: 0 } };

    // Bank statements: every one that covers any of the period.
    const stmts = (s.documents || []).filter(isStatement).map((d) => ({ d, files: filesOf(d), range: stmtRange(s, d), bank: bankOf(d) }));
    out.statements.any = stmts.length > 0;
    for (const x of stmts) {
      if (!x.range) out.statements.unplaced.push(x.d);
      else if (overlaps(x.range, from, to)) {
        if (x.files.length) out.statements.docs.push(x);
        else out.statements.noFile.push(x.d);
      }
    }
    out.statements.docs.sort((a, b) => a.range.from.localeCompare(b.range.from) || a.bank.localeCompare(b.bank));
    out.statements.files = sum(out.statements.docs, (x) => x.files.length);
    const banks = Array.from(new Set(stmts.filter((x) => x.range).map((x) => x.bank)));
    for (const bank of banks) {
      const mine = stmts.filter((x) => x.bank === bank && x.range);
      const opened = openedOf(s, bank);
      const missing = [];
      for (const key of monthsIn(from, to)) {
        if (monthEnd(key) >= t) continue; // a month that hasn't finished has no statement yet
        const a = key === from.slice(0, 7) && from > monthStart(key) ? from : monthStart(key);
        const b = key === to.slice(0, 7) && to < monthEnd(key) ? to : monthEnd(key);
        if (opened && opened > b) continue;
        if (!mine.some((x) => overlaps(x.range, a, b))) missing.push(key);
      }
      for (const key of missing) out.statements.gaps.push((banks.length > 1 ? 'no ' + bank : 'no') + ' statement for ' + monthLabel(key, true));
      const last = mine.map((x) => x.range.to).sort().pop();
      if (last && last < to && addDays(last, 7) < to && !missing.some((k) => k > last.slice(0, 7))) out.statements.latest.push((banks.length > 1 ? 'Your latest ' + bank + ' statement' : 'Your latest statement') + ' runs to ' + long(last) + ', so nothing after that is in the pack.');
    }

    // Payslips and employment papers dated in the period.
    const slips = (s.documents || []).filter(isPayslipDoc).map((d) => ({ d, files: filesOf(d), range: docSpan(d) }));
    for (const x of slips) {
      if (!x.range) out.payslips.undated.push(x.d);
      else if (overlaps(x.range, from, to)) {
        if (x.files.length) out.payslips.docs.push(x);
        else out.payslips.noFile.push(x.d);
      }
    }
    out.payslips.docs.sort((a, b) => a.range.from.localeCompare(b.range.from) || String(a.d.title).localeCompare(String(b.d.title)));
    out.payslips.files = sum(out.payslips.docs, (x) => x.files.length);

    // Wages, month by month (calendar months, cut to the period at each end).
    const wl = wageLines(s, from, to);
    for (const key of monthsIn(from, to)) {
      const a = key === from.slice(0, 7) && from > monthStart(key) ? from : monthStart(key);
      const b = key === to.slice(0, 7) && to < monthEnd(key) ? to : monthEnd(key);
      const lines = wl.filter((l) => l.date >= a && l.date <= b);
      out.wages.rows.push({ key, from: a, to: b, partial: a > monthStart(key) || b < monthEnd(key), count: lines.length, total: sum(lines, (l) => l.amount), dates: lines.map((l) => l.date) });
    }
    out.wages.total = sum(out.wages.rows, (r) => r.total);
    out.wages.count = sum(out.wages.rows, (r) => r.count);

    // A payslip should be there for every month you were paid in (the same month, or the first days of the next).
    const covered = (key) => slips.some((x) => x.range && !NOT_PAYSLIP.test(x.d.title || '') && (x.range.from.slice(0, 7) === key || (x.range.from.slice(0, 7) === shiftMonth(key, 1) && +x.range.from.slice(8) <= 10)));
    for (const r of out.wages.rows) if (r.count && !covered(r.key)) out.payslips.gaps.push('no payslip for ' + monthLabel(r.key, true));

    return out;
  }

  /* The preview as a short list, for the dialog. include: {statements, payslips, wages}. */
  function previewHTML(p, include) {
    const row = (on, label, text, gaps) => '<li class="ev-row' + (on ? '' : ' is-off') + '"><b>' + esc(label) + '</b><span>' + esc(on ? text : 'Not included') + '</span>' +
      (on && gaps && gaps.length ? '<ul class="ev-gaps">' + gaps.map((g) => '<li>' + GU.ui.icon('alert') + '<span>' + esc(g.charAt(0).toUpperCase() + g.slice(1)) + '</span></li>').join('') + '</ul>' : '') + '</li>';
    const st = p.statements;
    const stText = st.docs.length
      ? plural(st.files, 'file') + ' from ' + plural(st.docs.length, 'statement') + ', ' + long(st.docs[0].range.from) + ' to ' + long(st.docs[st.docs.length - 1].range.to)
      : st.any ? 'Nothing saved for these dates' : 'No statements saved yet';
    const stGaps = st.gaps.slice(0, 6).concat(st.gaps.length > 6 ? ['and ' + (st.gaps.length - 6) + ' more months'] : [], st.latest,
      st.noFile.length ? [plural(st.noFile.length, 'statement') + ' ' + (st.noFile.length === 1 ? 'has' : 'have') + ' no file attached'] : [],
      st.unplaced.length ? [plural(st.unplaced.length, 'statement') + ' ' + (st.unplaced.length === 1 ? 'has' : 'have') + ' no dates, so ' + (st.unplaced.length === 1 ? 'it’s' : 'they’re') + ' left out'] : [],
      !st.docs.length && !st.any ? ['Drop your statement PDFs on the Bank page and they’ll be kept here'] : []);
    const ps = p.payslips;
    const psText = ps.docs.length ? plural(ps.files, 'file') + ' from ' + plural(ps.docs.length, 'document') : 'Nothing dated in these months';
    const psGaps = ps.gaps.slice(0, 6).concat(ps.gaps.length > 6 ? ['and ' + (ps.gaps.length - 6) + ' more months'] : [],
      ps.noFile.length ? [plural(ps.noFile.length, 'paper') + ' ' + (ps.noFile.length === 1 ? 'has' : 'have') + ' no scan attached'] : [],
      ps.undated.length ? [plural(ps.undated.length, 'paper') + ' ' + (ps.undated.length === 1 ? 'has' : 'have') + ' no date, so ' + (ps.undated.length === 1 ? 'it’s' : 'they’re') + ' left out'] : []);
    const wg = p.wages;
    const wgText = wg.count ? plural(wg.count, 'payment') + ' in ' + plural(wg.rows.filter((r) => r.count).length, 'month') + ', ' + GU.util.money(wg.total) : 'No wages found in your bank records for these dates';
    return '<ul class="ev-sum">' + row(include.statements, 'Bank statements', stText, stGaps) + row(include.payslips, 'Payslips and employment papers', psText, psGaps) +
      row(include.wages, 'Wages summary', wgText, []) + '</ul>' +
      '<p class="ev-foot">' + esc('Covers ' + span(p.from, p.to) + '. Check what each application asks for: this is a tidy copy of your own papers, not advice on what you need.') + '</p>';
  }

  /* ---------- building the zip ---------- */
  /* The month-by-month wages page and spreadsheet: only pay dates and amounts, and who paid them. */
  function wagesFiles(s, p, name) {
    const e = GU.workMoney ? GU.workMoney.employer(s) : { set: false };
    const who = e.set ? e.name || e.short : '';
    const rows = p.wages.rows.map((r) => [monthLabel(r.key, true) + (r.partial ? ' (part month)' : ''), r.count ? r.dates.map((d) => fmtDate(d, { short: true })).join(', ') : 'No wages found', r.count ? GU.util.money(r.total) : '–']);
    const html = printPage({
      title: 'Wages summary',
      lede: (who ? 'Wages from ' + who : 'Wages') + ' that reached my account, as they show in my bank statements, ' + span(p.from, p.to) + '. These are the amounts paid in, so they can differ from the pay on a payslip.',
      meta: [['Period', span(p.from, p.to)], ['Made on', long(today())], ['Payments', String(p.wages.count)]],
      blocks: [{ cols: [{ label: 'Month' }, { label: 'Paid on' }, { label: 'Received', num: true }], rows, total: ['Total', plural(p.wages.count, 'payment'), GU.util.money(p.wages.total)] }],
      note: 'Check this against your payslips and bank statements.',
      foot: 'Made with The Ground Up on ' + long(today()) + '.',
    });
    const csv = csvText([['Month', 'Paid on', 'Payments', 'Received']].concat(
      p.wages.rows.map((r) => [monthLabel(r.key, true) + (r.partial ? ' (part month)' : ''), r.dates.join('; '), r.count, r.count ? n2(r.total) : '0.00']), [['Total', '', p.wages.count, n2(p.wages.total)]]));
    return [{ name: FOLDERS.wages + '/' + name + '.html', blob: new Blob([html], { type: 'text/html' }) }, { name: FOLDERS.wages + '/' + name + '.csv', blob: new Blob([csv], { type: 'text/csv' }) }];
  }
  const nameFor = (o) => 'Evidence pack ' + o.from + ' to ' + o.to + '.zip';

  /* Builds the pack. o: {from, to, include: {statements, payslips, wages}}.
     Returns {blob, name, rows, entries, missing, gaps, preview}, or null when there's nothing to put in. */
  async function build(o) {
    const s = store.state;
    const inc = Object.assign({ statements: true, payslips: true, wages: true }, o.include || {});
    const p = preview(s, o);
    const entries = [];
    const rows = [];
    const gaps = [];
    let missing = 0;
    const take = async (folder, docs, label) => {
      let n = 0;
      for (const x of docs) {
        const fl = x.files;
        for (let k = 0; k < fl.length; k++) {
          let r = null;
          try {
            r = await GU.files.get(fl[k].id);
          } catch (err) {
            r = null;
          }
          const dates = x.range ? span(x.range.from, x.range.to) : '';
          if (!r || !r.blob) {
            missing++;
            rows.push([folder, x.d.title, dates, '', 'Not on this device yet, so it’s left out']);
            continue;
          }
          n++;
          const nm = folder + '/' + pad(entries.filter((e) => e.name.startsWith(folder + '/')).length + 1) + ' ' + (fileSafe(x.d.title) || label) + (fl.length > 1 ? ' part ' + (k + 1) : '') + '.' + extOf(r.name || fl[k].name, r.type || fl[k].type);
          entries.push({ name: nm, blob: r.blob });
          rows.push([folder, x.d.title, dates, nm.slice(folder.length + 1), '']);
        }
      }
      return n;
    };
    if (inc.statements) {
      await take(FOLDERS.statements, p.statements.docs, 'Statement');
      gaps.push(...p.statements.gaps.map((g) => 'Bank statements: ' + g), ...p.statements.latest);
      if (!p.statements.docs.length) gaps.push('Bank statements: ' + (p.statements.any ? 'none saved for these dates' : 'none saved yet'));
      p.statements.noFile.forEach((d) => gaps.push('Bank statements: ' + d.title + ' has no file attached'));
    }
    if (inc.payslips) {
      await take(FOLDERS.payslips, p.payslips.docs, 'Payslip');
      p.payslips.gaps.forEach((g) => gaps.push('Payslips: ' + g));
      p.payslips.noFile.forEach((d) => gaps.push('Payslips: ' + d.title + ' has no scan attached'));
      if (!p.payslips.docs.length && !p.payslips.gaps.length) gaps.push('Payslips: none dated in these months');
    }
    if (inc.wages) {
      const base = 'Wages summary ' + p.from + ' to ' + p.to;
      const files = wagesFiles(store.state, p, base);
      entries.push(...files);
      rows.push([FOLDERS.wages, 'Wages summary, month by month', span(p.from, p.to), base + '.html and .csv', p.wages.count ? plural(p.wages.count, 'payment') + ', ' + GU.util.money(p.wages.total) : 'No wages found in your bank records']);
    }
    // A wages summary that only says 'no wages found' isn't a reason to build a pack on its own.
    if (!entries.some((e) => !(p.wages.count === 0 && e.name.startsWith(FOLDERS.wages + '/')))) return null;

    const meta = [['Period', span(p.from, p.to)], ['Made on', long(today())]];
    meta.push(['Files', String(entries.length)]);
    const html = printPage({
      title: 'Evidence pack: contents',
      lede: 'A list of everything in this pack. It covers ' + span(p.from, p.to) + '. Check what each application asks for: this is a tidy copy of my own papers, not advice on what is needed.',
      meta,
      blocks: [{ heading: 'What’s in this pack', cols: [{ label: 'Folder' }, { label: 'What it is' }, { label: 'Dates' }, { label: 'File' }, { label: 'Note' }], rows }]
        .concat(gaps.length ? [{ heading: 'Not in this pack', intro: 'These were missing from my records for these dates.', cols: [{ label: 'Note' }], rows: gaps.map((g) => [g]) }] : []),
      foot: 'Made with The Ground Up on ' + long(today()) + '.',
    });
    const csv = csvText([['Folder', 'What it is', 'Dates', 'File', 'Note']].concat(rows, gaps.length ? [['', '', '', '', '']].concat(gaps.map((g) => ['Not in this pack', g, '', '', ''])) : []));
    entries.unshift({ name: '00 Contents.html', blob: new Blob([html], { type: 'text/html' }) }, { name: '00 Contents.csv', blob: new Blob([csv], { type: 'text/csv' }) });
    const blob = await GU.ui.makeZip(entries);
    return { blob, name: nameFor(p), rows, entries: entries.map((e) => e.name), missing, gaps, preview: p };
  }

  /* ---------- the dialog ---------- */
  function open(opts) {
    opts = opts || {};
    const months = opts.months ? String(opts.months) : '6';
    const w = lastMonths(+months || 6);
    const periodOf = (v) => (v.range === 'custom' ? { from: isISO(v.from) ? v.from : w.from, to: isISO(v.to) ? v.to : w.to } : lastMonths(+v.range));
    const include = (v) => ({ statements: !!v.statements, payslips: !!v.payslips, wages: !!v.wages });
    const d = GU.ui.formDialog({
      title: 'Evidence pack',
      intro: 'Pick the dates and what to put in. You get one zip with a folder for each, and a contents list. Check what each application asks for: I can’t tell you what you need.',
      fields: [
        { name: 'range', label: 'Period', type: 'segmented', default: months, options: [{ value: '3', label: 'Last 3 months' }, { value: '6', label: 'Last 6 months' }, { value: '12', label: 'Last 12 months' }, { value: 'custom', label: 'Choose dates' }] },
        { name: 'from', label: 'From', type: 'date', half: true, showIf: (v) => v.range === 'custom' },
        { name: 'to', label: 'To', type: 'date', half: true, showIf: (v) => v.range === 'custom' },
        { name: 'includeHead', label: 'What to put in', type: 'html', html: '' },
        { name: 'statements', label: 'Include', type: 'checkbox', checkLabel: 'Bank statements' },
        { name: 'payslips', label: 'Include', type: 'checkbox', checkLabel: 'Payslips and employment papers' },
        { name: 'wages', label: 'Include', type: 'checkbox', checkLabel: 'A wages summary, month by month' },
        { name: 'preview', type: 'html', html: '<div class="ev-preview" aria-live="polite"></div>' },
      ],
      values: { range: months, from: w.from, to: w.to, statements: true, payslips: true, wages: true },
      submitLabel: 'Build the pack',
      onChange: (v, form) => {
        const box = form.querySelector('.ev-preview');
        if (!box) return;
        const win = periodOf(v);
        if (win.from > win.to) box.innerHTML = '<p class="ev-foot">The “from” date needs to be before the “to” date.</p>';
        else box.innerHTML = previewHTML(preview(store.state, { from: win.from, to: win.to }), include(v));
      },
      onSubmit: async (v) => {
        const win = periodOf(v);
        if (win.from > win.to) {
          GU.ui.toast('The “from” date needs to be before the “to” date.');
          return false;
        }
        const inc = include(v);
        if (!inc.statements && !inc.payslips && !inc.wages) {
          GU.ui.toast('Tick at least one thing to put in the pack.');
          return false;
        }
        const out = await build({ from: win.from, to: win.to, include: inc });
        if (!out) {
          GU.ui.toast('There’s nothing to put in the pack for those choices.');
          return false;
        }
        if (out.missing) GU.ui.toast(plural(out.missing, 'file') + (out.missing === 1 ? ' isn’t' : ' aren’t') + ' on this device yet, so ' + (out.missing === 1 ? 'it’s' : 'they’re') + ' left out.');
        const saved = await GU.ui.saveFile(out.blob, out.name);
        if (saved) GU.ui.toast('Saved ' + out.name + (out.gaps.length ? '. ' + plural(out.gaps.length, 'thing') + ' missing, listed in the contents' : ''));
        return saved ? undefined : false;
      },
    });
    return d;
  }

  GU.evidence = { open, build, preview, previewHTML, lastMonths, stmtRange, docSpan, isStatement, isPayslipDoc, printPage, csvText, csvCell, clean, fileSafe, n2, FOLDERS };
})();
