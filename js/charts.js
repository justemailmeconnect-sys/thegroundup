/* The Ground Up: small HTML charts. Columns for months, bars for categories, a line for balances. */
(function () {
  'use strict';
  const GU = window.GU;
  const { esc, money } = GU.util;

  function niceScale(max, ticks) {
    ticks = ticks || 4;
    if (!(max > 0)) return { top: 100, step: 25 };
    const raw = max / ticks;
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const n = raw / mag;
    const step = (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * mag;
    return { top: step * Math.ceil(max / step), step };
  }

  /* data: [{label, values: [..], tip}], series: [{name, color: '--css-var'}] */
  function columns(o) {
    const data = o.data;
    const series = o.series;
    const max = Math.max(0, ...data.flatMap((d) => d.values));
    const { top, step } = niceScale(max);
    const ticks = [];
    for (let v = 0; v <= top + step / 2; v += step) ticks.push(v);
    const pct = (v) => (top ? (v / top) * 100 : 0);
    const legend = series.length > 1
      ? '<div class="legend">' + series.map((s) => '<span><i style="background:var(' + s.color + ')"></i>' + esc(s.name) + '</span>').join('') + '</div>'
      : '';
    const last = data[data.length - 1];
    return '<figure class="colchart" style="--h:' + (o.height || 170) + 'px">' + legend +
      '<div class="colchart__body">' +
      '<div class="colchart__y" aria-hidden="true">' + ticks.map((v) => '<span style="bottom:' + pct(v) + '%">' + esc(money(v, { compact: true })) + '</span>').join('') + '</div>' +
      '<div class="colchart__plot">' +
      ticks.map((v) => '<i class="colchart__grid" style="bottom:' + pct(v) + '%"></i>').join('') +
      data.map((d) => '<div class="colchart__group' + (d === last ? ' is-current' : '') + '" tabindex="0" data-tip="' + esc(d.tip) + '" aria-label="' + esc(d.tip) + '">' +
        d.values.map((v, i) => '<span class="colchart__bar" style="height:' + pct(v) + '%;background:var(' + series[i].color + ')"></span>').join('') + '</div>').join('') +
      '</div><span></span>' +
      '<div class="colchart__x" aria-hidden="true">' + data.map((d) => '<span' + (d === last ? ' class="is-current"' : '') + '>' + esc(d.label) + '</span>').join('') + '</div>' +
      '</div>' + (o.table ? tableView(o.table) : '') + '</figure>';
  }

  /* A plain table twin for every chart, tucked behind a toggle. */
  function tableView(t) {
    return '<details class="chart-table"><summary>Show as a table</summary><div class="table-wrap"><table class="tbl tbl--compact"><thead><tr>' +
      t.head.map((h, i) => '<th' + (i ? ' class="num"' : '') + '>' + esc(h) + '</th>').join('') + '</tr></thead><tbody>' +
      t.rows.map((r) => '<tr>' + r.map((c, i) => '<td' + (i ? ' class="num"' : '') + '>' + esc(c) + '</td>').join('') + '</tr>').join('') +
      '</tbody></table></div></details>';
  }

  /* items: [{label, value, budget?, note?}] */
  function barList(items, o) {
    o = o || {};
    if (!items.length) return '';
    const max = Math.max(...items.map((i) => Math.max(i.value, i.budget || 0)), 1);
    return '<div class="barlist">' + items.map((it) => {
      const over = it.budget && it.value > it.budget;
      return '<div class="barlist__row"' + (it.key ? ' data-key="' + esc(it.key) + '" tabindex="0" role="button"' : '') + '>' +
        '<span class="barlist__label">' + esc(it.label) + '</span>' +
        '<span class="barlist__track"><i style="width:' + (it.value / max) * 100 + '%;background:var(' + (o.color || '--series-out') + ')"></i>' +
        (it.budget ? '<b class="barlist__budget" style="left:' + (it.budget / max) * 100 + '%" data-tip="Budget ' + esc(money(it.budget)) + '"></b>' : '') + '</span>' +
        '<span class="barlist__val">' + esc(money(it.value)) +
        (it.budget ? '<small class="' + (over ? 'is-over' : '') + '">' + (over ? esc(money(it.value - it.budget)) + ' over' : 'of ' + esc(money(it.budget, { whole: true }))) + '</small>' : '') +
        (it.note ? '<small>' + esc(it.note) + '</small>' : '') + '</span></div>';
    }).join('') + '</div>';
  }

  /* Ticks covering lo..hi (which may be below zero). */
  function niceRange(lo, hi, ticks) {
    lo = Math.min(0, lo);
    hi = Math.max(0, hi);
    if (hi - lo < 1) hi = lo + 1;
    const { step } = niceScale(hi - lo, ticks || 4);
    return { lo: Math.floor(lo / step) * step, hi: Math.ceil(hi / step) * step, step };
  }

  /* One line over time. points: [{date, value, tip}], o: {height, color, limit (a floor to mark, e.g. -overdraft), labels: [{i, text}], table} */
  function line(points, o) {
    o = o || {};
    if (points.length < 2) return '';
    const vals = points.map((p) => p.value);
    let lo = Math.min(...vals);
    const hi = Math.max(...vals);
    const showLimit = o.limit != null && o.limit < 0 && lo < o.limit * 0.5;
    if (showLimit) lo = Math.min(lo, o.limit);
    const r = niceRange(lo, hi);
    const ticks = [];
    for (let v = r.lo; v <= r.hi + r.step / 2; v += r.step) ticks.push(Math.round(v * 100) / 100);
    const y = (v) => 100 - ((v - r.lo) / (r.hi - r.lo)) * 100;
    const x = (i) => (i / (points.length - 1)) * 1000;
    const d = points.map((p, i) => (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(p.value).toFixed(2)).join(' ');
    const zero = y(0);
    const area = d + ' L1000 ' + zero.toFixed(2) + ' L0 ' + zero.toFixed(2) + ' Z';
    const color = 'var(' + (o.color || '--series-in') + ')';
    return '<figure class="linechart" style="--h:' + (o.height || 180) + 'px">' +
      '<div class="colchart__body">' +
      '<div class="colchart__y" aria-hidden="true">' + ticks.map((v) => '<span style="bottom:' + (100 - y(v)) + '%">' + esc(money(v, { compact: true })) + '</span>').join('') + '</div>' +
      '<div class="linechart__plot">' +
      ticks.map((v) => '<i class="colchart__grid' + (v === 0 ? ' is-zero' : '') + '" style="bottom:' + (100 - y(v)) + '%"></i>').join('') +
      (showLimit ? '<i class="linechart__limit" style="bottom:' + (100 - y(o.limit)) + '%"><span>Overdraft limit</span></i>' : '') +
      '<svg viewBox="0 0 1000 100" preserveAspectRatio="none" aria-hidden="true"><path d="' + area + '" fill="' + color + '" fill-opacity=".08"/>' +
      '<path d="' + d + '" fill="none" stroke="' + color + '" stroke-width="2" vector-effect="non-scaling-stroke" stroke-linejoin="round"/></svg>' +
      '<div class="linechart__hits">' + points.map((p, i) => '<span data-tip="' + esc(p.tip || '') + '"' + (i === points.length - 1 ? ' class="is-last"' : '') + ' style="--y:' + y(p.value) + '%"></span>').join('') + '</div>' +
      '</div><span></span>' +
      '<div class="linechart__x" aria-hidden="true">' + (o.labels || []).map((l) => '<span' + (l.i / (points.length - 1) > 0.92 ? ' class="is-end"' : '') + ' style="left:' + (l.i / (points.length - 1)) * 100 + '%">' + esc(l.text) + '</span>').join('') + '</div>' +
      '</div>' + (o.table ? tableView(o.table) : '') + '</figure>';
  }

  GU.charts = { columns, barList, line, niceScale };
})();
