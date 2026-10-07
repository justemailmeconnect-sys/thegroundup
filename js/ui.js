/* The Ground Up: interface building blocks. Icons, dialogs, forms, attachments, toasts, tooltips. */
(function () {
  'use strict';
  const GU = window.GU;
  const { esc, fmtBytes, parseAmount, currencySymbol } = GU.util;

  /* ---------- icons (24px stroke icons) ---------- */
  const P = {
    today: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/><path d="M10 21v-6h4v6"/>',
    bank: '<path d="M3 21h18"/><path d="M5 21v-9M9.5 21v-9M14.5 21v-9M19 21v-9"/><path d="M2.5 9.5 12 3.5l9.5 6z"/>',
    bills: '<rect x="3" y="4.5" width="18" height="16.5" rx="2"/><path d="M3 9.5h18M8 2.5v4M16 2.5v4"/><path d="M8 14h3M8 17h6"/>',
    in: '<path d="M12 3v11"/><path d="m7 9.5 5 5 5-5"/><path d="M4 15v3.5A2.5 2.5 0 0 0 6.5 21h11a2.5 2.5 0 0 0 2.5-2.5V15"/>',
    out: '<path d="M12 15V4"/><path d="m7 8.5 5-5 5 5"/><path d="M4 15v3.5A2.5 2.5 0 0 0 6.5 21h11a2.5 2.5 0 0 0 2.5-2.5V15"/>',
    receipt: '<path d="M5 3h14v18l-2.3-1.4L14.3 21 12 19.6 9.7 21l-2.4-1.4L5 21z"/><path d="M9 8h6M9 11.5h6M9 15h3.5"/>',
    folder: '<path d="M3 6.5A1.5 1.5 0 0 1 4.5 5H9l2 2.5h8.5A1.5 1.5 0 0 1 21 9v9.5a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5z"/>',
    globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3c2.5 2.7 3.8 5.7 3.8 9s-1.3 6.3-3.8 9c-2.5-2.7-3.8-5.7-3.8-9S9.5 5.7 12 3z"/>',
    todo: '<rect x="3" y="3" width="18" height="18" rx="4"/><path d="m8 12.2 2.8 2.8L16 9.5"/>',
    settings: '<path d="M4 7h9M17 7h3M4 12h3M11 12h9M4 17h11M19 17h1"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="17" r="2"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    upload: '<path d="M12 16V4"/><path d="m7 9 5-5 5 5"/><path d="M5 20h14"/>',
    download: '<path d="M12 4v12"/><path d="m7 11 5 5 5-5"/><path d="M5 20h14"/>',
    search: '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/>',
    x: '<path d="M6 6l12 12M18 6 6 18"/>',
    check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
    alert: '<path d="M12 3.5 2.5 20h19z"/><path d="M12 10v4.5M12 17.2v.1"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7.5V12l3 2"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5.5M12 7.8v.1"/>',
    file: '<path d="M14 3H6.5A1.5 1.5 0 0 0 5 4.5v15A1.5 1.5 0 0 0 6.5 21h11a1.5 1.5 0 0 0 1.5-1.5V8z"/><path d="M14 3v5h5"/>',
    image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m21 16.5-5-5L7 20"/>',
    clip: '<path d="M20 11.5 12.2 19.3a5 5 0 0 1-7.1-7.1l8.3-8.3a3.3 3.3 0 0 1 4.7 4.7l-8.3 8.3a1.7 1.7 0 0 1-2.4-2.4l7.6-7.6"/>',
    trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
    edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>',
    eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    chevron: '<path d="m9 6 6 6-6 6"/>',
    left: '<path d="m15 6-6 6 6 6"/>',
    flag: '<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>',
    camera: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
    repeat: '<path d="m17 2 3 3-3 3"/><path d="M4 11V9a4 4 0 0 1 4-4h12"/><path d="m7 22-3-3 3-3"/><path d="M20 13v2a4 4 0 0 1-4 4H4"/>',
    lock: '<rect x="4.5" y="10.5" width="15" height="10.5" rx="2"/><path d="M8 10.5V7a4 4 0 0 1 8 0v3.5"/>',
    briefcase: '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8.5 7V5a1.5 1.5 0 0 1 1.5-1.5h4A1.5 1.5 0 0 1 15.5 5v2M3 13h18"/>',
    home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/>',
    shield: '<path d="M12 3 4.5 6v6c0 4.5 3.2 7.8 7.5 9 4.3-1.2 7.5-4.5 7.5-9V6z"/><path d="m9 12 2 2 4-4"/>',
    list: '<path d="M9 6h11M9 12h11M9 18h11"/><path d="M4.5 6h.1M4.5 12h.1M4.5 18h.1"/>',
    note: '<path d="M5 4h14v16H5z"/><path d="M9 9h6M9 13h6M9 17h3"/>',
    coin: '<circle cx="12" cy="12" r="9"/><path d="M14.5 8.5A3 3 0 0 0 9.5 10c0 2.5 5 1.5 5 4.2a3 3 0 0 1-5 1.3M12 6.5v11"/>',
    more: '<circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/>',
    sort: '<path d="M7 4v16M3.5 16.5 7 20l3.5-3.5M17 20V4M13.5 7.5 17 4l3.5 3.5"/>',
    inbox: '<path d="M3 13.5 5.5 5h13l2.5 8.5V19a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 19z"/><path d="M3 13.5h5l1.5 2.5h5l1.5-2.5h5"/>',
    car: '<path d="M5 16.5V12l1.8-4.6A2 2 0 0 1 8.7 6h6.6a2 2 0 0 1 1.9 1.4L19 12v4.5"/><path d="M3.5 16.5h17v2h-17zM5 12h14"/><circle cx="8" cy="14.3" r=".6"/><circle cx="16" cy="14.3" r=".6"/>',
    paw: '<circle cx="7" cy="10" r="1.8"/><circle cx="10.5" cy="6.5" r="1.8"/><circle cx="14.5" cy="6.5" r="1.8"/><circle cx="18" cy="10" r="1.8"/><path d="M8.5 17.5c0-2.5 1.6-5 3.5-5s3.5 2.5 3.5 5c0 1.6-1.4 2.5-3.5 2.5s-3.5-.9-3.5-2.5z"/>',
    heart: '<path d="M12 20s-7.5-4.6-7.5-10A4.3 4.3 0 0 1 12 7.4 4.3 4.3 0 0 1 19.5 10c0 5.4-7.5 10-7.5 10z"/>',
    plane: '<path d="M10.5 13.5 3 11l1.5-1.5 7.5 1L16.5 6a1.8 1.8 0 0 1 2.5 2.5l-4.5 4.5 1 7.5L14 22l-2.5-7.5-3 3V20L7 21.5 5.5 18.5 2.5 17 4 15.5h2.5z"/>',
    book: '<path d="M4 5.5A1.5 1.5 0 0 1 5.5 4H11v16H5.5A1.5 1.5 0 0 1 4 18.5z"/><path d="M20 5.5A1.5 1.5 0 0 0 18.5 4H13v16h5.5a1.5 1.5 0 0 0 1.5-1.5z"/>',
    card: '<rect x="2.5" y="5" width="19" height="14" rx="2"/><path d="M2.5 9.5h19M6 15h4"/>',
    trend: '<path d="M3 17l6-6 4 4 8-8"/><path d="M15 7h6v6"/>',
    star: '<path d="m12 3.5 2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z"/>',
    spark: '<path d="M11 3.5c.7 4.3 2.3 5.9 6.5 6.5-4.2.6-5.8 2.2-6.5 6.5-.7-4.3-2.3-5.9-6.5-6.5 4.2-.6 5.8-2.2 6.5-6.5z"/><path d="M18.5 14.5c.3 1.9 1 2.6 2.5 2.9-1.5.3-2.2 1-2.5 2.9-.3-1.9-1-2.6-2.5-2.9 1.5-.3 2.2-1 2.5-2.9z"/>',
    send: '<path d="M4.5 11.5 19.5 4l-4.8 15.5-3.4-6.4z"/><path d="m11.3 13.1 8.2-9.1"/>',
    stop: '<rect x="7" y="7" width="10" height="10" rx="2"/>',
    funnel: '<path d="M3.5 4.5h17l-6.5 8v6l-4 2v-8z"/>',
    tag: '<path d="M3.5 12.6V4.5a1 1 0 0 1 1-1h8.1l8 8a1.5 1.5 0 0 1 0 2.1l-6.4 6.4a1.5 1.5 0 0 1-2.1 0z"/><circle cx="8" cy="8" r="1.4"/>',
    undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
    bag: '<path d="M5 8h14l-1 12.5H6z"/><path d="M9 8V6.5a3 3 0 0 1 6 0V8"/>',
  };
  const ICONS = Object.keys(P);
  function icon(name, cls) {
    return '<svg class="ico' + (cls ? ' ' + cls : '') + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (P[name] || P.info) + '</svg>';
  }

  /* ---------- small pieces ---------- */
  function pill(text, tone, ico) {
    return '<span class="pill' + (tone ? ' pill--' + tone : '') + '">' + (ico ? icon(ico) : '') + esc(text) + '</span>';
  }
  function emptyState(o) {
    return '<div class="empty">' + icon(o.icon || 'info', 'empty__icon') + '<h3>' + esc(o.title) + '</h3>' +
      (o.text ? '<p>' + o.text + '</p>' : '') + (o.action || '') + '</div>';
  }
  function chips(name, options, current) {
    return '<div class="chips" role="group">' + options.map((o) =>
      '<button type="button" class="chip" data-chip="' + esc(name) + '" data-value="' + esc(o.value) + '" aria-pressed="' + (o.value === current) + '">' +
      esc(o.label) + (o.count != null ? ' <span class="chip__n">' + o.count + '</span>' : '') + '</button>').join('') + '</div>';
  }
  function selectOptions(options, current, placeholder) {
    const opt = (o) => {
      const v = typeof o === 'string' ? o : o.value;
      const l = typeof o === 'string' ? o : o.label;
      return '<option value="' + esc(v) + '"' + (String(v) === String(current == null ? '' : current) ? ' selected' : '') + '>' + esc(l) + '</option>';
    };
    let html = placeholder != null ? '<option value="">' + esc(placeholder) + '</option>' : '';
    for (const o of options) {
      if (o && o.group) html += '<optgroup label="' + esc(o.group) + '">' + o.options.map(opt).join('') + '</optgroup>';
      else html += opt(o);
    }
    return html;
  }

  /* ---------- toasts ---------- */
  /* While quietly() runs, toasts are held back: the Sorting hub lists its own changes, each with Undo. */
  let hush = 0;
  function quietly(fn) {
    hush++;
    try {
      return fn();
    } finally {
      hush--;
    }
  }
  function toast(msg, opts) {
    opts = opts || {};
    if (hush) return () => {};
    let wrap = document.querySelector('.toasts');
    if (!wrap) {
      wrap = document.createElement('div');
      wrap.className = 'toasts';
      document.body.appendChild(wrap);
    }
    const el = document.createElement('div');
    el.className = 'toast';
    el.setAttribute('role', 'status');
    el.innerHTML = '<span>' + esc(msg) + '</span>' + (opts.action ? '<button type="button">' + esc(opts.action) + '</button>' : '');
    wrap.appendChild(el);
    const remove = () => el.remove();
    if (opts.action) el.querySelector('button').addEventListener('click', () => { remove(); opts.onAction && opts.onAction(); });
    setTimeout(remove, opts.timeout || (opts.action ? 8000 : 3500));
    return remove;
  }

  /* ---------- tooltips: any element with data-tip ---------- */
  let tipEl = null;
  function showTip(target) {
    if (!tipEl) {
      tipEl = document.createElement('div');
      tipEl.className = 'tooltip';
      tipEl.setAttribute('role', 'tooltip');
      document.body.appendChild(tipEl);
    }
    tipEl.textContent = target.getAttribute('data-tip');
    tipEl.hidden = false;
    const r = target.getBoundingClientRect();
    const t = tipEl.getBoundingClientRect();
    let left = r.left + r.width / 2 - t.width / 2;
    left = Math.max(8, Math.min(window.innerWidth - t.width - 8, left));
    let top = r.top - t.height - 8;
    if (top < 8) top = r.bottom + 8;
    tipEl.style.left = left + 'px';
    tipEl.style.top = top + 'px';
  }
  function hideTip() {
    if (tipEl) tipEl.hidden = true;
  }
  document.addEventListener('pointerover', (e) => {
    const t = e.target.closest && e.target.closest('[data-tip]');
    if (t) showTip(t);
    else hideTip();
  });
  document.addEventListener('focusin', (e) => {
    const t = e.target.closest && e.target.closest('[data-tip]');
    if (t) showTip(t);
    else hideTip();
  });
  document.addEventListener('scroll', hideTip, true);

  /* ---------- popover menu ---------- */
  let openMenu = null;
  function closeMenu() {
    if (openMenu) {
      openMenu.remove();
      openMenu = null;
    }
  }
  function menu(anchor, items) {
    closeMenu();
    const el = document.createElement('div');
    el.className = 'popover';
    el.setAttribute('role', 'menu');
    el.innerHTML = items.map((it, i) =>
      '<button type="button" role="menuitem" data-i="' + i + '">' + (it.icon ? icon(it.icon) : '') +
      '<span><b>' + esc(it.label) + '</b>' + (it.hint ? '<small>' + esc(it.hint) + '</small>' : '') + '</span></button>').join('');
    document.body.appendChild(el);
    const r = anchor.getBoundingClientRect();
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    let left = Math.min(window.innerWidth - w - 8, Math.max(8, r.left));
    let top = r.bottom + 6;
    if (top + h > window.innerHeight - 8) top = Math.max(8, r.top - h - 6);
    el.style.left = left + 'px';
    el.style.top = top + 'px';
    el.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-i]');
      if (!b) return;
      closeMenu();
      items[+b.dataset.i].onClick();
    });
    openMenu = el;
    setTimeout(() => {
      const first = el.querySelector('button');
      if (first) first.focus();
    }, 0);
  }
  document.addEventListener('pointerdown', (e) => {
    if (openMenu && !openMenu.contains(e.target)) closeMenu();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeMenu();
  });

  /* ---------- dialogs ---------- */
  function openDialog(o) {
    const dlg = document.createElement('dialog');
    dlg.className = 'dlg' + (o.wide ? ' dlg--wide' : '') + (o.className ? ' ' + o.className : '');
    dlg.innerHTML =
      '<form class="dlg__inner">' +
      '<header class="dlg__head"><h2>' + esc(o.title) + '</h2>' +
      '<button type="button" class="icon-btn" data-close aria-label="Close">' + icon('x') + '</button></header>' +
      '<div class="dlg__body">' + (o.body || '') + '</div>' +
      (o.footer ? '<footer class="dlg__foot">' + o.footer + '</footer>' : '') +
      '</form>';
    document.body.appendChild(dlg);
    const close = () => {
      if (dlg.open) dlg.close();
      else dlg.dispatchEvent(new Event('close'));
    };
    let downOnBackdrop = false;
    dlg.addEventListener('mousedown', (e) => (downOnBackdrop = e.target === dlg));
    dlg.addEventListener('click', (e) => {
      if (e.target === dlg && downOnBackdrop) close();
    });
    dlg.addEventListener('close', () => {
      dlg.remove();
      if (o.onClose) o.onClose();
    });
    dlg.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', close));
    try {
      dlg.showModal();
    } catch (e) {
      dlg.setAttribute('open', '');
    }
    const heading = dlg.querySelector('.dlg__head h2');
    heading.tabIndex = -1;
    heading.focus();
    return { el: dlg, form: dlg.querySelector('form'), body: dlg.querySelector('.dlg__body'), close };
  }

  function confirmBox(o) {
    return new Promise((resolve) => {
      let answered = false;
      const d = openDialog({
        title: o.title,
        body: '<p class="dlg__text">' + o.message + '</p>',
        footer: '<span class="spacer"></span><button type="button" class="btn" data-close>Cancel</button>' +
          '<button type="submit" class="btn ' + (o.danger ? 'btn--danger' : 'btn--primary') + '">' + esc(o.confirmLabel || 'Confirm') + '</button>',
        onClose: () => {
          if (!answered) resolve(false);
        },
      });
      d.form.addEventListener('submit', (e) => {
        e.preventDefault();
        answered = true;
        resolve(true);
        d.close();
      });
      setTimeout(() => d.form.querySelector('[type=submit]').focus(), 0);
    });
  }

  /* ---------- forms ---------- */
  function fieldHTML(f, value) {
    const id = 'f-' + f.name;
    const req = f.required ? ' required' : '';
    const ph = f.placeholder ? ' placeholder="' + esc(f.placeholder) + '"' : '';
    let control = '';
    switch (f.type) {
      case 'textarea':
        control = '<textarea id="' + id + '" name="' + f.name + '" rows="' + (f.rows || 3) + '"' + ph + req + '>' + esc(value || '') + '</textarea>';
        break;
      case 'select':
        control = '<select id="' + id + '" name="' + f.name + '"' + req + '>' + selectOptions(f.options, value != null ? value : f.default, f.placeholder) + '</select>';
        break;
      case 'money':
        control = '<div class="money-input"><span>' + esc(currencySymbol()) + '</span><input id="' + id + '" name="' + f.name + '" type="text" inputmode="decimal" autocomplete="off" value="' +
          (value != null && value !== '' ? esc(Math.abs(value).toFixed(2)) : '') + '"' + (f.placeholder ? ph : ' placeholder="0.00"') + req + '></div>';
        break;
      case 'checkbox':
        control = '<label class="check"><input id="' + id + '" name="' + f.name + '" type="checkbox"' + (value ? ' checked' : '') + '><span>' + esc(f.checkLabel || f.label) + '</span></label>';
        break;
      case 'segmented': {
        const cur = value != null && value !== '' ? value : f.default != null ? f.default : f.options[0].value;
        control = '<div class="seg" role="radiogroup" aria-label="' + esc(f.label) + '">' + f.options.map((o, i) =>
          '<label><input type="radio" name="' + f.name + '" value="' + esc(o.value) + '" id="' + id + '-' + i + '"' + (String(o.value) === String(cur) ? ' checked' : '') + '><span>' +
          (o.icon ? icon(o.icon) : '') + esc(o.label) + '</span></label>').join('') + '</div>';
        break;
      }
      case 'files':
        control = '<div class="files" data-files="' + f.name + '"></div>';
        break;
      case 'html':
        control = f.html;
        break;
      default: {
        const list = f.list ? ' list="' + id + '-list"' : '';
        control = '<input id="' + id + '" name="' + f.name + '" type="' + (f.type || 'text') + '"' + list + ' value="' + esc(value == null ? '' : value) + '"' + ph + req +
          (f.type === 'number' ? ' step="any"' : '') + ' autocomplete="off">' +
          (f.list ? '<datalist id="' + id + '-list">' + f.list.map((x) => '<option value="' + esc(x) + '">').join('') + '</datalist>' : '');
      }
    }
    const label = f.type === 'checkbox' || f.type === 'html' && !f.label ? '' :
      '<label class="field__label" for="' + id + (f.type === 'segmented' ? '-0' : '') + '">' + esc(f.label) + (f.optional ? ' <span class="opt">optional</span>' : '') + '</label>';
    return '<div class="field' + (f.half ? ' field--half' : '') + '" data-field="' + f.name + '">' + label + control +
      (f.help ? '<p class="field__help">' + f.help + '</p>' : '') + '</div>';
  }

  function readValues(form, fields) {
    const v = {};
    for (const f of fields) {
      const wrap = form.querySelector('[data-field="' + f.name + '"]');
      const hidden = wrap && wrap.hidden;
      if (f.type === 'files' || f.type === 'html') continue;
      if (f.type === 'checkbox') {
        v[f.name] = !hidden && form.elements[f.name].checked;
      } else if (f.type === 'segmented') {
        const c = form.querySelector('input[name="' + f.name + '"]:checked');
        v[f.name] = c ? c.value : '';
      } else if (f.type === 'money') {
        const raw = form.elements[f.name].value;
        v[f.name] = hidden || !raw.trim() ? null : Math.abs(parseAmount(raw));
      } else if (f.type === 'number') {
        const raw = form.elements[f.name].value;
        v[f.name] = hidden || raw === '' ? null : Number(raw);
      } else {
        v[f.name] = hidden ? '' : form.elements[f.name].value.trim();
      }
    }
    return v;
  }

  /* Opens a form in a dialog. onSubmit(values) may return false to keep the dialog open. */
  function formDialog(o) {
    const fields = o.fields;
    const values = o.values || {};
    const body = (o.intro ? '<p class="dlg__intro">' + o.intro + '</p>' : '') +
      '<div class="form-grid">' + fields.map((f) => fieldHTML(f, values[f.name])).join('') + '</div>';
    const footer = (o.onDelete ? '<button type="button" class="btn btn--quiet-danger" data-delete>' + icon('trash') + esc(o.deleteLabel || 'Delete') + '</button>' : '') +
      '<span class="spacer"></span><button type="button" class="btn" data-close>Cancel</button>' +
      '<button type="submit" class="btn btn--primary">' + esc(o.submitLabel || 'Save') + '</button>';
    const d = openDialog({ title: o.title, body, footer, wide: o.wide });
    const form = d.form;

    const widgets = {};
    let firstFiles = true;
    for (const f of fields) {
      if (f.type !== 'files') continue;
      widgets[f.name] = attachments(form.querySelector('[data-files="' + f.name + '"]'), values[f.name] || [], firstFiles ? o.initialFiles : null, f);
      firstFiles = false;
    }

    const refresh = () => {
      const v = readValues(form, fields);
      for (const f of fields) {
        if (!f.showIf) continue;
        const wrap = form.querySelector('[data-field="' + f.name + '"]');
        const show = !!f.showIf(v);
        if (wrap.hidden === !show) continue;
        wrap.hidden = !show;
        wrap.querySelectorAll('input,select,textarea').forEach((el) => (el.disabled = !show));
      }
      if (o.onChange) o.onChange(v, form);
    };
    form.addEventListener('input', (e) => {
      if (e.target.setCustomValidity) e.target.setCustomValidity('');
    });
    form.addEventListener('change', refresh);
    refresh();

    let busy = false;
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (busy) return;
      for (const f of fields) {
        if (f.type !== 'money') continue;
        const el = form.elements[f.name];
        if (el && !el.disabled && el.value.trim() && isNaN(parseAmount(el.value))) {
          el.setCustomValidity('Enter an amount, for example 12.50');
          el.reportValidity();
          return;
        }
      }
      busy = true;
      try {
        const v = readValues(form, fields);
        for (const name in widgets) v[name] = await widgets[name].commit();
        const res = await o.onSubmit(v);
        if (res === false) return;
        for (const name in widgets) widgets[name].cleanup();
        d.close();
      } finally {
        busy = false;
      }
    });
    const del = form.querySelector('[data-delete]');
    if (del) {
      del.addEventListener('click', async () => {
        const ok = await confirmBox({ title: o.deleteTitle || 'Delete this?', message: o.deleteMessage || 'You can undo it, and it stays in Settings → Recently deleted for 30 days.', confirmLabel: o.deleteLabel || 'Delete', danger: true });
        if (!ok) return;
        o.onDelete();
        d.close();
      });
    }
    setTimeout(() => {
      const first = form.querySelector('.dlg__body input:not([type=radio]):not([type=checkbox]):not([type=file]):not([disabled]), .dlg__body textarea, .dlg__body select');
      if (first && !o.noAutofocus) first.focus();
      else {
        const h = form.querySelector('.dlg__head h2');
        h.tabIndex = -1;
        h.focus();
      }
    }, 30);
    return d;
  }

  /* ---------- attachments (photos, PDFs) ---------- */
  const ACCEPT = 'image/*,application/pdf,.pdf,.heic,.doc,.docx,.xls,.xlsx,.txt,.csv,.eml';
  function isImage(type) {
    return /^image\//.test(type || '') && !/heic|heif|tiff/.test(type);
  }
  function attachments(root, existing, initial, f) {
    const kept = existing.slice();
    const removed = [];
    const pending = [];
    function add(list) {
      for (const file of list) pending.push({ file, url: isImage(file.type) ? URL.createObjectURL(file) : null, meta: null });
      render();
    }
    function thumb(name, type, src, fileId, key) {
      const media = isImage(type)
        ? '<img alt="" ' + (src ? 'src="' + esc(src) + '"' : 'data-file="' + esc(fileId) + '"') + '>'
        : '<span class="att__icon">' + icon('file') + '<em>' + esc((name.split('.').pop() || 'file').slice(0, 4).toUpperCase()) + '</em></span>';
      return '<div class="att">' + media + '<span class="att__name">' + esc(name) + '</span>' +
        (fileId ? '<button type="button" class="att__dl" data-dl="' + esc(fileId) + '" aria-label="Download ' + esc(name) + '" data-tip="Download">' + icon('download') + '</button>' : '') +
        '<button type="button" class="att__remove" data-remove="' + key + '" aria-label="Remove ' + esc(name) + '">' + icon('x') + '</button></div>';
    }
    function render() {
      root.innerHTML =
        '<label class="drop" tabindex="0"><input type="file" multiple accept="' + ACCEPT + '" hidden>' +
        icon('upload', 'drop__icon') + '<span><b>' + esc(f && f.dropLabel ? f.dropLabel : 'Add photos or PDFs') + '</b>' +
        '<small>Drop files here, or tap to choose a file or take a photo</small></span></label>' +
        (kept.length + pending.length ? '<div class="atts">' +
          kept.map((m, i) => thumb(m.name, m.type, null, m.id, 'k' + i)).join('') +
          pending.map((p, i) => thumb(p.file.name, p.file.type, p.url, null, 'p' + i)).join('') + '</div>' : '');
      hydrate(root);
      const input = root.querySelector('input[type=file]');
      input.addEventListener('change', () => add(Array.from(input.files)));
      const drop = root.querySelector('.drop');
      drop.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          input.click();
        }
      });
      drop.addEventListener('dragover', (e) => {
        e.preventDefault();
        drop.classList.add('is-over');
      });
      drop.addEventListener('dragleave', () => drop.classList.remove('is-over'));
      drop.addEventListener('drop', (e) => {
        e.preventDefault();
        drop.classList.remove('is-over');
        filesFromDrop(e.dataTransfer).then(add);
      });
      root.querySelectorAll('[data-remove]').forEach((b) => b.addEventListener('click', () => {
        const key = b.dataset.remove;
        const i = +key.slice(1);
        if (key[0] === 'k') removed.push(kept.splice(i, 1)[0].id);
        else {
          const p = pending.splice(i, 1)[0];
          if (p.url) URL.revokeObjectURL(p.url);
        }
        render();
      }));
    }
    if (initial && initial.length) add(initial);
    else render();
    return {
      async commit() {
        for (const p of pending) if (!p.meta) p.meta = await GU.files.add(p.file);
        return kept.concat(pending.map((p) => p.meta));
      },
      cleanup() {
        removed.forEach((id) => GU.files.remove(id));
        pending.forEach((p) => p.url && URL.revokeObjectURL(p.url));
      },
    };
  }

  /* Fills <img data-file="id"> tags with the stored file. */
  function hydrate(root) {
    root.querySelectorAll('img[data-file]').forEach((img) => {
      const id = img.getAttribute('data-file');
      img.removeAttribute('data-file');
      GU.files.url(id).then((u) => {
        if (u) img.src = u;
        else img.replaceWith(Object.assign(document.createElement('span'), { className: 'att__icon', innerHTML: icon('image') }));
      });
    });
  }

  function thumbHTML(files, cls) {
    const f = (files || [])[0];
    if (!f) return '<span class="thumb thumb--empty ' + (cls || '') + '">' + icon('receipt') + '</span>';
    const more = files.length > 1 ? '<span class="thumb__more">+' + (files.length - 1) + '</span>' : '';
    if (isImage(f.type)) return '<span class="thumb ' + (cls || '') + '"><img alt="" data-file="' + esc(f.id) + '">' + more + '</span>';
    return '<span class="thumb thumb--file ' + (cls || '') + '">' + icon('file') + '<em>' + esc((f.name.split('.').pop() || '').slice(0, 4).toUpperCase()) + '</em>' + more + '</span>';
  }

  /* Opens a viewer for a record's files with previous/next and download. */
  function viewFiles(list, start, title) {
    if (!list || !list.length) return;
    let i = start || 0;
    const d = openDialog({ title: title || 'Attachment', wide: true, className: 'dlg--viewer', body: '<div class="viewer"></div>', footer: '<div class="viewer__nav"></div>' });
    async function show() {
      const f = list[i];
      const url = await GU.files.url(f.id);
      const box = d.body.querySelector('.viewer');
      if (!url) box.innerHTML = emptyState({ icon: 'file', title: 'File not found', text: 'This file may have been removed from this browser.' });
      else if (isImage(f.type)) box.innerHTML = '<img src="' + esc(url) + '" alt="' + esc(f.name) + '">';
      else if (/pdf/.test(f.type)) box.innerHTML = '<iframe src="' + esc(url) + '" title="' + esc(f.name) + '"></iframe>';
      else box.innerHTML = emptyState({ icon: 'file', title: f.name, text: "This type of file can't be previewed here. Download it to open it." });
      d.el.querySelector('.viewer__nav').innerHTML =
        '<span class="viewer__name">' + esc(f.name) + ' · ' + fmtBytes(f.size) + (list.length > 1 ? ' · ' + (i + 1) + ' of ' + list.length : '') + '</span>' +
        '<span class="spacer"></span>' +
        (list.length > 1 ? '<button type="button" class="btn btn--sm" data-prev>' + icon('left') + 'Previous</button><button type="button" class="btn btn--sm" data-next>Next' + icon('chevron') + '</button>' : '') +
        (url ? '<a class="btn btn--sm" href="' + esc(url) + '" target="_blank" rel="noopener">' + icon('eye') + 'Open</a>' : '') +
        (list.length > 1 ? '<button type="button" class="btn btn--sm" data-dl="' + esc(list.map((x) => x.id).join(',')) + '" data-dl-name="' + esc(title || 'Files') + '">' + icon('download') + 'Download all ' + list.length + '</button>' : '') +
        (url ? '<button type="button" class="btn btn--sm btn--primary" data-dl="' + esc(f.id) + '">' + icon('download') + 'Download</button>' : '');
      const prev = d.el.querySelector('[data-prev]');
      const next = d.el.querySelector('[data-next]');
      if (prev) prev.onclick = () => { i = (i - 1 + list.length) % list.length; show(); };
      if (next) next.onclick = () => { i = (i + 1) % list.length; show(); };
    }
    show();
  }

  /* ---------- folders ---------- */
  const JUNK = /(^|\/)(\.[^/]*|thumbs\.db|desktop\.ini|__macosx|icon\r?)(\/|$)/i;
  /* The file's path inside a dropped or chosen folder, e.g. "Car/MOT 2025.pdf". */
  function pathOf(f) {
    return (f && (f._path || f.webkitRelativePath)) || (f && f.name) || '';
  }
  function usable(f) {
    if (JUNK.test(pathOf(f))) return false;
    if (/^(video|audio)\//.test(f.type || '')) return false;
    if (/\.(exe|dmg|app|msi|pkg|zip|rar|7z|iso|lnk|tmp|ds_store)$/i.test(f.name)) return false;
    return f.size > 0;
  }
  /* Every file in a drop, including the contents of dropped folders and their subfolders.
     Call it straight from the drop handler: the browser only lets folders be read during the event. */
  function filesFromDrop(dt) {
    const items = Array.from((dt && dt.items) || []);
    const entries = items.map((i) => (i.kind === 'file' && i.webkitGetAsEntry ? i.webkitGetAsEntry() : null)).filter(Boolean);
    const plain = Array.from((dt && dt.files) || []);
    if (!entries.some((e) => e.isDirectory)) return Promise.resolve(plain.filter(usable));
    const out = [];
    const readAll = (reader) => new Promise((resolve, reject) => {
      const all = [];
      const next = () => reader.readEntries((batch) => {
        if (!batch.length) return resolve(all);
        all.push(...batch);
        next();
      }, reject);
      next();
    });
    async function walk(entry, path) {
      if (entry.isFile) {
        const f = await new Promise((resolve, reject) => entry.file(resolve, reject));
        try {
          Object.defineProperty(f, '_path', { value: path + f.name });
        } catch (e) {
          /* keep the plain name */
        }
        out.push(f);
      } else if (entry.isDirectory) {
        for (const child of await readAll(entry.createReader())) await walk(child, path + entry.name + '/');
      }
    }
    return (async () => {
      for (const e of entries) {
        try {
          await walk(e, '');
        } catch (err) {
          console.warn('Could not read', e.name, err);
        }
      }
      return out.filter(usable);
    })();
  }
  /* Opens the folder picker. Resolves with every file in the folder and its subfolders. */
  function pickFolder() {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.multiple = true;
      input.webkitdirectory = true;
      input.setAttribute('webkitdirectory', '');
      input.style.display = 'none';
      document.body.appendChild(input);
      input.addEventListener('change', () => {
        resolve(Array.from(input.files || []).filter(usable));
        input.remove();
      });
      input.click();
    });
  }
  /* "Car", or "Car and 2 other folders", for messages. */
  function folderSummary(files) {
    const tops = Array.from(new Set(files.map((f) => pathOf(f).split('/')).filter((p) => p.length > 1).map((p) => p[0])));
    if (!tops.length) return '';
    return '“' + tops[0] + '”' + (tops.length > 1 ? ' and ' + (tops.length - 1) + ' other folder' + (tops.length > 2 ? 's' : '') : '');
  }

  /* A drop area with "Choose files" and "Choose a folder", used by every section. */
  function dropbar(title, subtitle) {
    return '<div class="dropbar" data-dropbar tabindex="0" role="button" aria-label="' + esc(title) + '">' + icon('upload', 'drop__icon') +
      '<span class="dropbar__text"><b>' + esc(title) + '</b><small>' + esc(subtitle || 'Drop files or whole folders here. Subfolders are kept as groups.') + '</small></span>' +
      '<span class="dropbar__btns"><button type="button" class="btn btn--sm" data-db-files>' + icon('file') + 'Choose files</button>' +
      '<button type="button" class="btn btn--sm" data-db-folder>' + icon('folder') + 'Choose a folder</button></span>' +
      '<input type="file" multiple hidden data-db-input accept="' + ACCEPT + '"></div>';
  }
  function wireDropbar(root, onFiles) {
    const bar = root.querySelector('[data-dropbar]');
    if (!bar) return;
    const input = bar.querySelector('[data-db-input]');
    const send = (files) => (files.length ? onFiles(files) : toast('There were no files I can read in that.'));
    bar.addEventListener('click', async (e) => {
      if (e.target.closest('[data-db-folder]')) {
        e.stopPropagation();
        return send(await pickFolder());
      }
      if (e.target === input) return;
      input.click();
    });
    bar.addEventListener('keydown', (e) => (e.key === 'Enter' || e.key === ' ') && e.target === bar && (e.preventDefault(), input.click()));
    input.addEventListener('change', () => {
      send(Array.from(input.files).filter(usable));
      input.value = '';
    });
    bar.addEventListener('dragover', (e) => (e.preventDefault(), bar.classList.add('is-over')));
    bar.addEventListener('dragleave', () => bar.classList.remove('is-over'));
    bar.addEventListener('drop', (e) => {
      e.preventDefault();
      bar.classList.remove('is-over');
      filesFromDrop(e.dataTransfer).then(send);
    });
  }

  function pickFiles(accept) {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.multiple = true;
      input.accept = accept || ACCEPT;
      input.style.display = 'none';
      document.body.appendChild(input);
      input.addEventListener('change', () => {
        resolve(Array.from(input.files || []));
        input.remove();
      });
      input.click();
    });
  }

  function download(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  /* ---------- downloading your files ---------- */
  // Inside claude.ai, files are saved through the page's downloads permission (you confirm each save),
  // which accepts these types; anything else, and several files at once, comes as one .zip.
  const SAVEABLE = /\.(gif|png|jpe?g|webp|mp4|webm|txt|json|md|docx|pptx|epub|csv|ttf|html|svg|pdf|xlsx|zip)$/i;
  const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'application/pdf': 'pdf', 'text/plain': 'txt', 'text/csv': 'csv', 'image/heic': 'heic' };
  function withExt(name, type) {
    const n = String(name || 'file').replace(/[\\/:*?"<>|]+/g, '-').trim() || 'file';
    return /\.[a-z0-9]{1,5}$/i.test(n) ? n : n + '.' + (EXT[type] || 'bin');
  }
  let dlPromise = null;
  async function saveFile(blob, filename) {
    let dl = null;
    if (window.claude && typeof window.claude.use === 'function') {
      if (!dlPromise) dlPromise = window.claude.use('downloads').catch(() => null);
      dl = await dlPromise;
    }
    if (!dl) {
      download(blob, filename);
      return true;
    }
    try {
      await dl.save({ filename, data: blob });
      return true;
    } catch (e) {
      const code = e && e.code;
      if (code === 'declined') return false;
      if (code === 'rejected_extension' && !/\.zip$/i.test(filename)) return saveFile(await makeZip([{ name: filename, blob }]), baseName(filename) + '.zip');
      toast(code === 'rate_limited' ? 'Another download is waiting for you to confirm it. Try again in a moment.'
        : code === 'too_large' ? 'That’s too big to download here.'
        : code === 'rejected_extension' || code === 'extension_not_enabled' ? 'This type of file can’t be downloaded here.'
        : 'Downloads aren’t available here right now.');
      return false;
    }
  }
  const baseName = (name) => String(name || '').replace(/\.[a-z0-9]{1,5}$/i, '').replace(/[\\/:*?"<>|]+/g, '-').trim() || 'files';

  const CRC = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();
  function crc32(bytes) {
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) c = CRC[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }
  /* A plain .zip (files stored as they are) of [{name, blob}]. */
  async function makeZip(entries) {
    const enc = new TextEncoder();
    const now = new Date();
    const time = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
    const date = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
    const parts = [];
    const central = [];
    const used = new Set();
    let offset = 0;
    for (const e of entries) {
      let name = e.name;
      for (let i = 2; used.has(name.toLowerCase()); i++) name = e.name.replace(/(\.[^.]*)?$/, ' (' + i + ')$1');
      used.add(name.toLowerCase());
      const data = new Uint8Array(await e.blob.arrayBuffer());
      const nm = enc.encode(name);
      const crc = crc32(data);
      const local = new DataView(new ArrayBuffer(30));
      local.setUint32(0, 0x04034b50, true);
      local.setUint16(4, 20, true);
      local.setUint16(6, 0x0800, true);
      local.setUint16(10, time, true);
      local.setUint16(12, date, true);
      local.setUint32(14, crc, true);
      local.setUint32(18, data.length, true);
      local.setUint32(22, data.length, true);
      local.setUint16(26, nm.length, true);
      parts.push(local, nm, data);
      const cen = new DataView(new ArrayBuffer(46));
      cen.setUint32(0, 0x02014b50, true);
      cen.setUint16(4, 20, true);
      cen.setUint16(6, 20, true);
      cen.setUint16(8, 0x0800, true);
      cen.setUint16(12, time, true);
      cen.setUint16(14, date, true);
      cen.setUint32(16, crc, true);
      cen.setUint32(20, data.length, true);
      cen.setUint32(24, data.length, true);
      cen.setUint16(28, nm.length, true);
      cen.setUint32(42, offset, true);
      central.push(cen, nm);
      offset += 30 + nm.length + data.length;
    }
    const size = central.reduce((a, p) => a + p.byteLength, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(8, entries.length, true);
    end.setUint16(10, entries.length, true);
    end.setUint32(12, size, true);
    end.setUint32(16, offset, true);
    return new Blob(parts.concat(central, [end]), { type: 'application/zip' });
  }

  /* Downloads stored files by id: one file as itself, several as one .zip named after `label`. */
  async function downloadFiles(ids, label) {
    const recs = [];
    for (const id of ids) {
      const r = await GU.files.get(id);
      if (r && r.blob) recs.push({ name: withExt(r.name, r.type), blob: r.blob });
    }
    if (!recs.length) {
      toast('That file isn’t available on this device yet. Open it once on the device you added it from so it can sync.');
      return false;
    }
    if (recs.length < ids.length) toast((ids.length - recs.length) + ' of these files isn’t on this device, so it’s left out.');
    if (recs.length === 1) {
      const one = recs[0];
      return SAVEABLE.test(one.name) ? saveFile(one.blob, one.name) : saveFile(await makeZip(recs), baseName(one.name) + '.zip');
    }
    return saveFile(await makeZip(recs), baseName((label || 'files') + '.x') + '.zip');
  }
  /* A download button for a record's files: put it anywhere; it works through the click handler below. */
  function dlButton(files, label, cls) {
    const list = (files || []).filter((f) => f && f.id);
    if (!list.length) return '';
    const what = list.length > 1 ? 'all ' + list.length + ' files' : list[0].name;
    return '<button type="button" class="icon-btn dl-btn' + (cls ? ' ' + cls : '') + '" data-dl="' + esc(list.map((f) => f.id).join(',')) + '" data-dl-name="' + esc(label || '') + '" aria-label="Download ' + esc(what) + '" data-tip="Download ' + esc(what) + '">' +
      icon('download') + (list.length > 1 ? '<em>' + list.length + '</em>' : '') + '</button>';
  }
  document.addEventListener('click', (e) => {
    const b = e.target.closest && e.target.closest('[data-dl]');
    if (!b) return;
    e.preventDefault();
    e.stopPropagation();
    if (b.disabled) return;
    b.disabled = true;
    downloadFiles(b.dataset.dl.split(',').filter(Boolean), b.dataset.dlName).finally(() => (b.disabled = false));
  }, true);

  GU.ui = {
    saveFile, makeZip, downloadFiles, dlButton,
    icon, ICONS, pill, emptyState, chips, selectOptions, toast, quietly, menu, closeMenu,
    openDialog, confirmBox, formDialog, attachments, hydrate, thumbHTML, viewFiles, pickFiles, pickFolder, filesFromDrop, pathOf, folderSummary, dropbar, wireDropbar, download, isImage, ACCEPT,
  };
})();
