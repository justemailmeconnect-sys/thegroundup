/* The Ground Up: shared helpers (dates, money, text, CSV parsing). */
(function () {
  'use strict';
  const GU = (window.GU = window.GU || {});
  GU.tabs = GU.tabs || {};

  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const DAYS_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const pad = (n) => String(n).padStart(2, '0');

  /* ---------- text ---------- */
  const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ESC[c]);
  }
  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }
  function plural(n, one, many) {
    return n + ' ' + (n === 1 ? one : many || one + 's');
  }
  function fmtBytes(n) {
    if (!n) return '0 KB';
    if (n < 1024 * 1024) return Math.max(1, Math.round(n / 1024)) + ' KB';
    return (n / 1024 / 1024).toFixed(1) + ' MB';
  }
  function mask(ref) {
    const s = String(ref || '');
    if (s.length <= 4) return s;
    return '•••• ' + s.slice(-4);
  }

  /* ---------- dates (always 'YYYY-MM-DD' strings, no time zones) ---------- */
  function today() {
    const d = new Date();
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }
  function isISO(s) {
    return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
  }
  function toDays(iso) {
    const [y, m, d] = iso.split('-').map(Number);
    return Math.round(Date.UTC(y, m - 1, d) / 86400000);
  }
  function fromDays(n) {
    const dt = new Date(n * 86400000);
    return dt.getUTCFullYear() + '-' + pad(dt.getUTCMonth() + 1) + '-' + pad(dt.getUTCDate());
  }
  function addDays(iso, n) {
    return fromDays(toDays(iso) + n);
  }
  function daysUntil(iso, from) {
    return toDays(iso) - toDays(from || today());
  }
  function daysInMonth(y, m) {
    return new Date(Date.UTC(y, m, 0)).getUTCDate();
  }
  /* Adds months, keeping the anchor day where the month allows (31 Jan -> 28 Feb -> 31 Mar). */
  function addMonths(iso, n, anchorDay) {
    let [y, m, d] = iso.split('-').map(Number);
    const day = anchorDay || d;
    let mm = m - 1 + n;
    y += Math.floor(mm / 12);
    mm = ((mm % 12) + 12) % 12;
    return y + '-' + pad(mm + 1) + '-' + pad(Math.min(day, daysInMonth(y, mm + 1)));
  }
  function weekday(iso) {
    return new Date(toDays(iso) * 86400000).getUTCDay();
  }
  const monthKey = (iso) => iso.slice(0, 7);
  const shiftMonth = (key, n) => addMonths(key + '-01', n).slice(0, 7);
  function monthLabel(key, long) {
    const [y, m] = key.split('-').map(Number);
    return long ? MONTHS_LONG[m - 1] + ' ' + y : MONTHS[m - 1];
  }
  function fmtDate(iso, opts) {
    if (!isISO(iso)) return '';
    opts = opts || {};
    const [y, m, d] = iso.split('-').map(Number);
    if (opts.weekday) return DAYS[weekday(iso)] + ' ' + d + ' ' + MONTHS[m - 1] + (y !== new Date().getFullYear() ? ' ' + y : '');
    if (opts.short) return d + ' ' + MONTHS[m - 1] + (y !== new Date().getFullYear() ? ' ' + y : '');
    return d + ' ' + MONTHS[m - 1] + ' ' + y;
  }
  function fmtLongDate(iso) {
    const [y, m, d] = iso.split('-').map(Number);
    return DAYS_LONG[weekday(iso)] + ' ' + d + ' ' + MONTHS_LONG[m - 1] + ' ' + y;
  }
  function relDays(iso) {
    if (!isISO(iso)) return '';
    const n = daysUntil(iso);
    const a = Math.abs(n);
    if (n === 0) return 'today';
    if (n === 1) return 'tomorrow';
    if (n === -1) return 'yesterday';
    let span;
    if (a < 60) span = a + ' days';
    else if (a < 730) span = Math.round(a / 30.44) + ' months';
    else span = Math.round(a / 365.25) + ' years';
    return n > 0 ? 'in ' + span : span + ' ago';
  }
  function greeting() {
    const h = new Date().getHours();
    if (h < 12) return 'Good morning';
    if (h < 18) return 'Good afternoon';
    return 'Good evening';
  }

  /* ---------- money ---------- */
  let currency = 'GBP';
  const fmtCache = {};
  function formatter(kind) {
    const key = currency + kind;
    if (!fmtCache[key]) {
      const base = { style: 'currency', currency };
      let o;
      if (kind === 'compact') o = Object.assign(base, { notation: 'compact', maximumFractionDigits: 1 });
      else if (kind === 'whole') o = Object.assign(base, { minimumFractionDigits: 0, maximumFractionDigits: 0 });
      else o = Object.assign(base, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      try {
        fmtCache[key] = new Intl.NumberFormat('en-GB', o);
      } catch (e) {
        fmtCache[key] = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' });
      }
    }
    return fmtCache[key];
  }
  function setCurrency(c) {
    currency = c || 'GBP';
  }
  function currencySymbol() {
    const part = formatter('').formatToParts(0).find((p) => p.type === 'currency');
    return part ? part.value : currency;
  }
  /* money(-12.5) -> "−£12.50"; money(12.5, {sign:true}) -> "+£12.50" */
  function money(n, opts) {
    opts = opts || {};
    const v = Number(n) || 0;
    const s = formatter(opts.compact ? 'compact' : opts.whole ? 'whole' : '').format(Math.abs(v));
    if (v < 0 && !opts.abs) return '−' + s;
    if (opts.sign && v > 0) return '+' + s;
    return s;
  }
  /* Accepts "£1,234.50", "-12.00", "(12.00)", "12.00 DR", "1.234,50" */
  function parseAmount(raw) {
    if (raw == null) return NaN;
    let t = String(raw).trim();
    if (!t) return NaN;
    let neg = false;
    if (/^\(.*\)$/.test(t)) {
      neg = true;
      t = t.slice(1, -1);
    }
    if (/\s*DR$/i.test(t)) {
      neg = !neg;
      t = t.replace(/\s*DR$/i, '');
    } else t = t.replace(/\s*CR$/i, '');
    if (/[-−]/.test(t)) neg = !neg;
    t = t.replace(/[^0-9.,]/g, '');
    if (!t) return NaN;
    if (/,\d{1,2}$/.test(t) && !/\.\d{1,2}$/.test(t)) t = t.replace(/\./g, '').replace(',', '.');
    else t = t.replace(/,/g, '');
    const v = parseFloat(t);
    if (isNaN(v)) return NaN;
    return Math.round((neg ? -v : v) * 100) / 100;
  }
  const round2 = (n) => Math.round(n * 100) / 100;
  const sum = (arr, fn) => round2(arr.reduce((a, x) => a + (fn ? fn(x) : x), 0));

  /* ---------- CSV ---------- */
  function detectDelimiter(text) {
    const sample = text.split(/\r?\n/).slice(0, 8).join('\n');
    let best = ',';
    let bestCount = 0;
    for (const d of [',', ';', '\t', '|']) {
      const c = sample.split(d).length - 1;
      if (c > bestCount) {
        best = d;
        bestCount = c;
      }
    }
    return best;
  }
  function parseCSV(text) {
    text = String(text || '').replace(/^﻿/, '');
    const delim = detectDelimiter(text);
    const rows = [];
    let row = [];
    let field = '';
    let quoted = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (quoted) {
        if (c === '"') {
          if (text[i + 1] === '"') {
            field += '"';
            i++;
          } else quoted = false;
        } else field += c;
      } else if (c === '"') quoted = true;
      else if (c === delim) {
        row.push(field);
        field = '';
      } else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(field);
        rows.push(row);
        row = [];
        field = '';
      } else field += c;
    }
    if (field !== '' || row.length) {
      row.push(field);
      rows.push(row);
    }
    return rows.map((r) => r.map((s) => s.trim())).filter((r) => r.some((c) => c !== ''));
  }

  /* Parses bank-statement dates. order: 'dmy' (UK default) or 'mdy' for ambiguous 01/02/2026. */
  function parseLooseDate(raw, order) {
    const s = String(raw || '').trim();
    if (!s) return null;
    const mk = (y, m, d) => {
      y = +y;
      m = +m;
      d = +d;
      if (y < 100) y += 2000;
      if (m < 1 || m > 12 || d < 1 || d > daysInMonth(y, m)) return null;
      return y + '-' + pad(m) + '-' + pad(d);
    };
    let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
    if (m) return mk(m[1], m[2], m[3]);
    m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})\b/);
    if (m) return order === 'mdy' ? mk(m[3], m[1], m[2]) : mk(m[3], m[2], m[1]);
    const monthIdx = (name) => MONTHS.findIndex((x) => x.toLowerCase() === name.slice(0, 3).toLowerCase()) + 1;
    m = s.match(/^(\d{1,2})(?:st|nd|rd|th)?[\s-]+([A-Za-z]{3,9})[\s,-]+(\d{2,4})/);
    if (m && monthIdx(m[2])) return mk(m[3], monthIdx(m[2]), m[1]);
    m = s.match(/^(?:[A-Za-z]{3,9},?\s+)?([A-Za-z]{3,9})\s+(\d{1,2}),?\s+(\d{4})/);
    if (m && monthIdx(m[1])) return mk(m[3], monthIdx(m[1]), m[2]);
    return null;
  }
  /* Looks at a column of dates and decides whether it is day-first or month-first. */
  function guessDateOrder(values) {
    let dmy = 0;
    let mdy = 0;
    for (const v of values) {
      const m = String(v || '').trim().match(/^(\d{1,2})[-/.](\d{1,2})[-/.]/);
      if (!m) continue;
      if (+m[1] > 12) dmy++;
      if (+m[2] > 12) mdy++;
    }
    return mdy > dmy ? 'mdy' : 'dmy';
  }

  function debounce(fn, ms) {
    let t;
    return function () {
      clearTimeout(t);
      const args = arguments;
      t = setTimeout(() => fn.apply(this, args), ms);
    };
  }

  GU.util = {
    esc, uid, plural, fmtBytes, mask,
    today, isISO, toDays, fromDays, addDays, addMonths, daysUntil, daysInMonth, weekday,
    monthKey, shiftMonth, monthLabel, fmtDate, fmtLongDate, relDays, greeting,
    setCurrency, currencySymbol, money, parseAmount, round2, sum,
    parseCSV, parseLooseDate, guessDateOrder, debounce,
    MONTHS, MONTHS_LONG,
  };
})();
