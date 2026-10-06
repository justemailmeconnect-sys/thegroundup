/* The Ground Up: Today. The daily briefing: one timeline of everything due, a quick capture bar,
   and a side column with this month's money, things needing attention and things you're waiting on. */
(function () {
  'use strict';
  const GU = window.GU;
  const { esc, today, addDays, daysUntil, fmtDate, fmtLongDate, greeting, money, plural, monthKey, monthLabel, weekday } = GU.util;
  const { icon, emptyState } = GU.ui;
  const F = GU.finance;
  const store = GU.store;

  let horizon = 14;

  const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  /* "Call the council tomorrow" -> {title: 'Call the council', due: <tomorrow>} */
  function parseQuickTask(text) {
    let title = text.trim();
    let due = '';
    const t = today();
    const take = (re, date) => {
      if (due || !re.test(title)) return;
      due = date;
      title = title.replace(re, ' ').replace(/\s{2,}/g, ' ').trim();
    };
    take(/\b(?:by |on )?(today|tonight)\b/i, t);
    take(/\b(?:by |on )?tomorrow\b/i, addDays(t, 1));
    take(/\bnext week\b/i, addDays(t, 7));
    const explicit = title.match(/\b(?:on |by |for )?((\d{1,2})(?:st|nd|rd|th)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?(?:\s+(\d{4}))?|(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?)\b/i);
    if (explicit && !due) {
      const year = explicit[4] || explicit[7] || t.slice(0, 4);
      const iso = explicit[3] ? GU.util.parseLooseDate(explicit[2] + ' ' + explicit[3] + ' ' + year, 'dmy') : GU.util.parseLooseDate(explicit[5] + '/' + explicit[6] + '/' + year, 'dmy');
      if (iso) {
        const bump = !explicit[4] && !explicit[7] && iso < t ? GU.util.addMonths(iso, 12) : iso;
        take(new RegExp(explicit[0].replace(/[.*+?^${}()|[\]\\/]/g, '\\$&'), 'i'), bump);
      }
    }
    const inDays = title.match(/\bin (\d{1,3}) days?\b/i);
    if (inDays) take(/\bin \d{1,3} days?\b/i, addDays(t, +inDays[1]));
    for (let i = 0; i < 7 && !due; i++) {
      const re = new RegExp('\\b(?:by |on |this |next )?' + WEEKDAYS[i] + '\\b', 'i');
      const delta = ((i - weekday(t) + 7) % 7) || 7;
      take(re, addDays(t, delta));
    }
    title = title.replace(/[\s,.-]+$/, '');
    return { title: title.charAt(0).toUpperCase() + title.slice(1), due };
  }

  function groupLabel(date) {
    const n = daysUntil(date);
    if (n === 0) return 'Today';
    if (n === 1) return 'Tomorrow';
    const [y, m, d] = date.split('-').map(Number);
    const wd = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][weekday(date)];
    return wd + ' ' + d + (date.slice(0, 7) !== today().slice(0, 7) ? ' ' + GU.util.MONTHS[m - 1] : '') + (y !== new Date().getFullYear() ? ' ' + y : '');
  }

  function itemHTML(it) {
    const k = GU.agenda.KINDS[it.kind];
    const ref = it.ref.c + ':' + it.ref.id;
    let action = '';
    if (it.action === 'done') action = '<button type="button" class="btn btn--sm btn--soft" data-act="done" data-ref="' + esc(ref) + '">' + icon('check') + 'Done</button>';
    if (it.action === 'paid') action = '<button type="button" class="btn btn--sm btn--soft" data-act="paid" data-ref="' + esc(ref) + '">' + icon('check') + (it.kind === 'owed' ? 'Got paid' : 'Paid') + '</button>';
    const amount = it.amount != null ? '<span class="tl-item__amt' + (it.amount > 0 ? ' is-in' : '') + '">' + esc(money(it.amount, { sign: true })) + '</span>' : '';
    const late = it.overdue ? '<span class="tl-item__late">' + (it.kind === 'task' ? 'Was due ' : 'Due ') + esc(fmtDate(it.date, { short: true })) + '</span>' : '';
    return '<li class="tl-item' + (it.overdue ? ' is-overdue' : '') + (it.priority === 'high' ? ' is-high' : '') + '">' +
      '<span class="kind kind--' + it.kind + '">' + esc(k.label) + '</span>' +
      '<button type="button" class="tl-item__main" data-open="' + esc(ref) + '"><b>' + esc(it.title) + '</b>' +
      '<em>' + late + esc(it.meta || '') + '</em></button>' +
      '<span class="tl-item__end">' + amount + action + '</span></li>';
  }

  function timelineHTML(items) {
    const t = today();
    const overdue = items.filter((i) => i.overdue && i.kind !== 'income');
    const upcoming = items.filter((i) => !i.overdue);
    if (!overdue.length && !upcoming.length) {
      return emptyState({ icon: 'check', title: 'Nothing due in the next ' + horizon + ' days', text: 'Add a task above, or set up your bills so they show up here.' });
    }
    const groups = [];
    if (overdue.length) groups.push({ label: 'Overdue', key: 'overdue', items: overdue });
    const byDate = new Map();
    for (const it of upcoming) {
      if (!byDate.has(it.date)) byDate.set(it.date, []);
      byDate.get(it.date).push(it);
    }
    if (!byDate.has(t)) byDate.set(t, []);
    Array.from(byDate.keys()).sort().forEach((d) => groups.push({ label: groupLabel(d), key: d, items: byDate.get(d) }));
    return '<ol class="timeline">' + groups.map((g) =>
      '<li class="tl-day' + (g.key === 'overdue' ? ' tl-day--overdue' : '') + (g.key === t ? ' tl-day--today' : '') + '">' +
      '<h3 class="tl-day__label">' + esc(g.label) + '</h3>' +
      (g.items.length ? '<ul class="tl-day__items">' + g.items.map(itemHTML).join('') + '</ul>'
        : '<p class="tl-day__clear">' + icon('check') + 'Nothing else due today</p>') + '</li>').join('') + '</ol>';
  }

  function footText(s, inn, out) {
    if (!inn) {
      const next = s.incomeSources.filter((x) => x.nextDate).sort((a, b) => a.nextDate.localeCompare(b.nextDate))[0];
      return 'Nothing has come in yet this month' + (next ? '; ' + esc(next.name.toLowerCase()) + ' is expected <b>' + esc(fmtDate(next.nextDate, { short: true })) + '</b>.' : '.');
    }
    return (inn >= out ? 'Left over so far: ' : 'Spent more than came in by ') + '<b>' + esc(money(Math.abs(inn - out))) + '</b>.';
  }

  function monthCard(s) {
    const key = monthKey(today());
    const rows = F.inMonth(s.transactions, key);
    const inn = F.moneyIn(rows);
    const out = F.moneyOut(rows);
    const max = Math.max(inn, out, 1);
    const end = addDays(GU.util.addMonths(key + '-01', 1), -1);
    let billsLeft = 0;
    for (const b of s.bills) {
      if (b.active === false || !b.nextDue) continue;
      billsLeft += F.occurrences(b.nextDue < today() ? today() : b.nextDue, b.frequency, b.anchorDay, today(), end).length * b.amount;
    }
    return '<section class="side-card"><h2>' + esc(monthLabel(key, true).split(' ')[0]) + ' so far</h2>' +
      '<div class="mini-bars">' +
      '<div><span>Money in</span><i style="width:' + (inn / max) * 100 + '%;background:var(--series-in)' + (inn ? '' : ';min-width:0') + '"></i><b>' + esc(money(inn, { whole: true })) + '</b></div>' +
      '<div><span>Money out</span><i style="width:' + (out / max) * 100 + '%;background:var(--series-out)"></i><b>' + esc(money(out, { whole: true })) + '</b></div>' +
      '</div><p class="side-card__foot">' + footText(s, inn, out) +
      (billsLeft ? ' ' + esc(money(billsLeft, { whole: true })) + ' of bills still to go out this month.' : '') + '</p>' +
      '<a class="link" href="#outgoings">See spending ' + icon('chevron') + '</a></section>';
  }

  function listCard(title, items, emptyText) {
    if (!items.length) return emptyText ? '<section class="side-card"><h2>' + esc(title) + '</h2><p class="muted">' + esc(emptyText) + '</p></section>' : '';
    return '<section class="side-card"><h2>' + esc(title) + '</h2><ul class="side-list">' + items.slice(0, 6).map((a, i) =>
      '<li><button type="button" data-side="' + esc(title) + ':' + i + '">' +
      (a.level ? '<span class="dot dot--' + a.level + '">' + icon(a.level === 'info' ? 'info' : 'alert') + '</span>' : '<span class="dot">' + icon('clock') + '</span>') +
      '<span><b>' + esc(a.title) + '</b><em>' + esc(a.detail || '') + '</em></span></button></li>').join('') + '</ul></section>';
  }

  function recentUploads(s) {
    const withFiles = s.paperwork.filter((p) => p.files && p.files.length).sort((a, b) => (b.created || b.date || '').localeCompare(a.created || a.date || '')).slice(0, 6);
    if (!withFiles.length) return '';
    return '<section class="side-card"><h2>Recent uploads</h2><div class="thumb-row">' + withFiles.map((p) =>
      '<button type="button" class="thumb-btn" data-view="' + esc(p.id) + '" data-tip="' + esc(p.title + (p.amount ? ' · ' + money(p.amount) : '')) + '" aria-label="View ' + esc(p.title) + '">' + GU.ui.thumbHTML(p.files) + '</button>').join('') +
      '</div><a class="link" href="#receipts">All receipts and invoices ' + icon('chevron') + '</a></section>';
  }

  function render(root) {
    const s = store.state;
    const t = today();
    const items = GU.agenda.timeline(s, horizon);
    const overdue = items.filter((i) => i.overdue && i.kind !== 'income').length;
    const dueToday = items.filter((i) => i.date === t && i.kind !== 'income').length;
    const week = items.filter((i) => !i.overdue && i.date > t && i.date <= addDays(t, 7)).length;
    const parts = [];
    if (overdue) parts.push(plural(overdue, 'thing') + (overdue === 1 ? ' is' : ' are') + ' overdue');
    if (dueToday) parts.push(dueToday + ' due today');
    if (week) parts.push(week + ' more this week');
    const summary = parts.length ? parts.join(', ').replace(/, ([^,]*)$/, ' and $1') + '.' : 'Nothing is overdue. Nice work.';
    const attention = GU.agenda.attention(s);
    const waiting = GU.agenda.waiting(s);

    root.innerHTML =
      '<div class="brief">' +
      '<div class="brief__feed">' +
      '<p class="eyebrow">' + esc(fmtLongDate(t)) + '</p>' +
      '<h1 class="brief__title">' + esc(greeting() + (s.settings.name ? ', ' + s.settings.name : '')) + '. Here’s what’s coming up.</h1>' +
      '<p class="brief__summary">' + esc(summary) + '</p>' +
      '<form class="capture" data-capture>' +
      '<label class="capture__field">' + icon('plus') + '<input type="text" name="task" id="quick-task" autocomplete="off" placeholder="Tell me anything, e.g. Renew car tax on Friday" aria-label="Tell your assistant anything"></label>' +
      '<div class="capture__btns"><button type="submit" class="btn btn--soft">Add</button>' +
      '<button type="button" class="btn btn--primary" data-upload>' + icon('camera') + 'Upload</button></div>' +
      '</form>' +
      '<p class="capture__hint">' + icon('clip') + 'Snap or drop anything here: receipts, invoices, letters, warranties. I’ll read it and file it in the right place.</p>' +
      timelineHTML(items) +
      '<button type="button" class="btn btn--ghost brief__more" data-horizon>' + (horizon === 14 ? 'Show the next 30 days' : 'Show the next 14 days only') + '</button>' +
      '</div>' +
      '<aside class="brief__aside">' +
      monthCard(s) +
      listCard('Needs attention', attention, 'Nothing needs your attention right now.') +
      listCard('Waiting on', waiting) +
      recentUploads(s) +
      '</aside></div>' +
      '<div class="dropcover" hidden><div>' + icon('upload') + '<b>Drop to let me sort it</b></div></div>';

    const form = root.querySelector('[data-capture]');
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const raw = form.elements.task.value;
      if (!raw.trim()) {
        GU.tabs.todos.create();
        return;
      }
      form.elements.task.value = '';
      GU.inbox.add({ note: raw });
      setTimeout(() => {
        const inp = document.getElementById('quick-task');
        if (inp) inp.focus();
      }, 0);
    });
    root.querySelector('[data-upload]').addEventListener('click', async () => {
      const files = await GU.ui.pickFiles();
      if (files.length) GU.inbox.add({ files });
    });
    root.querySelector('[data-horizon]').addEventListener('click', () => {
      horizon = horizon === 14 ? 30 : 14;
      GU.render();
    });

    root.addEventListener('click', (e) => {
      const open = e.target.closest('[data-open]');
      if (open) {
        const [c, id] = open.dataset.open.split(':');
        GU.view.open({ c, id });
        return;
      }
      const act = e.target.closest('[data-act]');
      if (act) {
        const [c, id] = act.dataset.ref.split(':');
        if (act.dataset.act === 'done') GU.tabs.todos.complete(id);
        else if (c === 'bills') GU.tabs.bills.markPaid(id);
        else if (c === 'paperwork') GU.tabs.receipts.markPaid(id);
        return;
      }
      const side = e.target.closest('[data-side]');
      if (side) {
        const [title, i] = side.dataset.side.split(':');
        const a = (title === 'Waiting on' ? waiting : attention)[+i];
        if (a.ref) GU.view.open(a.ref);
        else GU.view.go(a.tab, a.go ? { filter: a.go } : null);
        return;
      }
      const view = e.target.closest('[data-view]');
      if (view) {
        const p = store.find('paperwork', view.dataset.view);
        if (p) GU.ui.viewFiles(p.files, 0, p.title);
      }
    });

    const cover = root.querySelector('.dropcover');
    let depth = 0;
    root.addEventListener('dragenter', (e) => {
      if (!e.dataTransfer || !Array.from(e.dataTransfer.types || []).includes('Files')) return;
      depth++;
      cover.hidden = false;
    });
    root.addEventListener('dragleave', () => {
      depth = Math.max(0, depth - 1);
      if (!depth) cover.hidden = true;
    });
    root.addEventListener('dragover', (e) => e.preventDefault());
    root.addEventListener('drop', (e) => {
      e.preventDefault();
      depth = 0;
      cover.hidden = true;
      const files = Array.from((e.dataTransfer && e.dataTransfer.files) || []);
      if (files.length) GU.inbox.add({ files });
    });
  }

  GU.tabs.today = { label: 'Today', short: 'Today', icon: 'today', render, parseQuickTask };
})();
