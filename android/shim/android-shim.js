/* The Ground Up: Android app shim.
   android/build.sh puts this in as the FIRST script of the bundled index.html (the website's own files are
   not changed). It does nothing at all in a normal browser: it only acts when the app's WebView has given the
   page the native bridge, window.GUAndroid.

   What it adds inside the app:
   - Downloads. The website saves files (zip claim packs, CSV, backup JSON...) by clicking an <a download href="blob:...">,
     which a WebView ignores. Those clicks now go to GUAndroid.saveFile (Downloads folder) instead.
   - "Open" links that point at a blob: (the file viewer's Open button) go to GUAndroid.openFile.
   - Sharing. navigator.share / navigator.canShare use the Android share sheet (text, links and files).
   - The Back button: closes an open dialog, menu or chat panel (like Escape) before it leaves the page.
   - The phone's status and navigation bar colours follow the page (light, dark, Home or Work).
   - A one-time-per-launch notice that this is the offline copy (own data, no sync) with a button to the online dashboard.
   There is no window.claude here and nothing fakes it. */
(function () {
  'use strict';
  var A = window.GUAndroid;
  if (!A) return;                       // a normal browser: leave everything exactly as it is

  var SMALL = 3 * 1024 * 1024;          // up to this many bytes go in one call; bigger files are sent in pieces
  var PIECE = 3 * 1024 * 1024;          // a multiple of 3, so each piece is its own valid base64 block

  var EXT = {
    'application/pdf': 'pdf', 'application/zip': 'zip', 'application/json': 'json', 'text/csv': 'csv',
    'text/plain': 'txt', 'text/html': 'html', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp',
    'image/gif': 'gif', 'image/svg+xml': 'svg', 'application/vnd.ms-excel': 'xls',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx'
  };

  function has(fn) { return typeof A[fn] === 'function'; }
  function toast(msg) { try { if (has('toast')) A.toast(String(msg)); } catch (e) { /* no toast */ } }
  function failedResult(r) { return typeof r === 'string' && r.slice(0, 5) === 'error'; }

  /* ---------- reading a Blob into base64 ---------- */
  function readBase64(blob) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () {
        var s = String(reader.result);
        resolve(s.slice(s.indexOf(',') + 1));
      };
      reader.onerror = function () { reject(reader.error || new Error('Could not read the file')); };
      reader.readAsDataURL(blob);
    });
  }

  function nameFor(name, blob) {
    var n = String(name || '').trim();
    if (n) return n;
    var ext = EXT[String((blob && blob.type) || '').split(';')[0]] || 'bin';
    return 'download.' + ext;
  }

  /* Sends one Blob to Java. action: 'save' | 'open' | 'share' | 'keep'. opts: {title, text} for share.
     Resolves with Java's answer string. */
  async function sendBlob(blob, name, action, opts) {
    var mime = String(blob.type || 'application/octet-stream').split(';')[0] || 'application/octet-stream';
    var direct = { save: 'saveFile', open: 'openFile', share: 'shareFile' };
    var wantsText = action === 'share' && opts && (opts.text || opts.title);
    var chunked = has('beginFile') && has('appendFile') && has('endFile') &&
      (blob.size > SMALL || action === 'keep' || wantsText);
    if (!chunked) {
      if (!has(direct[action])) throw new Error('This app cannot do that');
      return A[direct[action]](name, mime, await readBase64(blob));
    }
    var token = A.beginFile(name, mime);
    if (!token) throw new Error('Could not start the file');
    try {
      for (var at = 0; at < blob.size; at += PIECE) {
        var ok = A.appendFile(token, await readBase64(blob.slice(at, Math.min(at + PIECE, blob.size))));
        if (ok === false) throw new Error('Could not write the file');
      }
    } catch (e) {
      try { A.abortFile(token); } catch (e2) { /* already gone */ }
      throw e;
    }
    return A.endFile(token, action, JSON.stringify(opts || {}));
  }

  /* ---------- downloads and blob links ---------- */
  var KIND = /^(blob|data):/i;

  async function fetchBlob(url) {
    var res = await fetch(url);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.blob();
  }

  function saveFromUrl(url, name) {
    fetchBlob(url).then(function (blob) {
      return sendBlob(blob, nameFor(name, blob), 'save');
    }).then(function (r) {
      if (failedResult(r)) console.warn('GUAndroid.saveFile: ' + r);
    }).catch(function (e) {
      console.warn('Saving the file failed', e);
      toast('Couldn’t save that file');
    });
  }

  function openFromUrl(url, name) {
    fetchBlob(url).then(function (blob) {
      return sendBlob(blob, nameFor(name, blob), 'open');
    }).catch(function (e) {
      console.warn('Opening the file failed', e);
      toast('Couldn’t open that file');
    });
  }

  /* true when the anchor was a file save/open that is now handled here (so the click must not go on). */
  function handleAnchor(a) {
    var href = a && a.href;
    if (!href || !KIND.test(href)) return false;
    if (a.hasAttribute('download')) {
      saveFromUrl(href, a.getAttribute('download'));
      return true;
    }
    if (/^blob:/i.test(href)) {
      openFromUrl(href, a.getAttribute('title') || a.textContent.trim().slice(0, 60) || '');
      return true;
    }
    return false;
  }

  var nativeClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () {
    try {
      if (handleAnchor(this)) return;
    } catch (e) { /* fall through to a normal click */ }
    return nativeClick.apply(this, arguments);
  };
  // Real taps on such links (the programmatic ones above never reach this).
  document.addEventListener('click', function (e) {
    if (e.defaultPrevented) return;
    var a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
    try {
      if (a && handleAnchor(a)) e.preventDefault();
    } catch (err) { /* leave the click alone */ }
  }, true);

  /* ---------- sharing ---------- */
  var shareWaiter = null;
  function abortError() {
    try { return new DOMException('Share canceled', 'AbortError'); } catch (e) {
      var err = new Error('Share canceled');
      err.name = 'AbortError';
      return err;
    }
  }
  // Called by the app when the share sheet was used (true) or dismissed (false).
  window.__guShareDone = function (chosen) {
    var w = shareWaiter;
    shareWaiter = null;
    if (!w) return;
    if (chosen) w.resolve(); else w.reject(abortError());
  };

  function shareText(data) {
    var parts = [];
    if (data.text) parts.push(String(data.text));
    if (data.url) parts.push(String(data.url));
    if (!parts.length && data.title) parts.push(String(data.title));
    return parts.join('\n');
  }

  function isFileList(files) {
    if (!files || !files.length) return false;
    for (var i = 0; i < files.length; i++) if (!(files[i] instanceof Blob)) return false;
    return true;
  }

  navigator.canShare = function (data) {
    if (!data) return false;
    if (data.files && data.files.length) {
      return isFileList(data.files) && (has('shareFile') || has('beginFile'));
    }
    return !!(data.text || data.url || data.title) && has('shareText');
  };

  navigator.share = function (data) {
    data = data || {};
    if (!navigator.canShare(data)) return Promise.reject(new TypeError('There is nothing to share'));
    var tracked = has('shareTracked') && A.shareTracked() === true;
    return new Promise(function (resolve, reject) {
      if (shareWaiter) shareWaiter.reject(abortError());
      shareWaiter = tracked ? { resolve: resolve, reject: reject } : null;
      var fail = function (e) {
        shareWaiter = null;
        reject(e instanceof Error ? e : new Error(String(e)));
      };
      var done = function (r) {
        if (failedResult(r)) return fail(new Error(r));
        if (!tracked) resolve();       // an older app build cannot tell when the sheet closes
      };
      try {
        if (data.files && data.files.length) {
          var files = Array.prototype.slice.call(data.files);
          var opts = { title: data.title ? String(data.title) : '', text: shareText(data) };
          if (files.length === 1 || !has('beginFile')) {
            sendBlob(files[0], nameFor(files[0].name, files[0]), 'share', opts).then(done, fail);
          } else {
            var tokens = [];
            files.reduce(function (p, f) {
              return p.then(function () { return sendBlob(f, nameFor(f.name, f), 'keep'); })
                .then(function (r) {
                  if (failedResult(r)) throw new Error(r);
                  tokens.push(String(r).replace(/^ok:/, ''));
                });
            }, Promise.resolve()).then(function () {
              done(A.shareKept(tokens.join(','), JSON.stringify(opts)));
            }).catch(fail);
          }
        } else {
          done(A.shareText(shareText(data)));
        }
      } catch (e) {
        fail(e);
      }
    });
  };

  /* ---------- the Back button ---------- */
  // Returns 1 when it closed something, 2 when the app is locked (Back just leaves the app), 0 otherwise.
  window.__guBack = function () {
    var dialogs = document.querySelectorAll('dialog[open]');
    if (dialogs.length) {
      var d = dialogs[dialogs.length - 1];
      if (d.classList.contains('lockscreen')) return 2;
      var ev = new Event('cancel', { cancelable: true });   // what Escape does to a <dialog>
      d.dispatchEvent(ev);
      if (!ev.defaultPrevented && d.open) d.close();
      return 1;
    }
    if (document.querySelector('.popover')) {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true, cancelable: true }));
      return 1;
    }
    if (document.documentElement.classList.contains('chat-open')) {
      var close = document.querySelector('[data-chat-close]');
      if (close) { close.click(); return 1; }
    }
    return 0;
  };

  /* ---------- status bar and navigation bar colours ---------- */
  var canvas = null;
  function rgbaOf(css) {
    var m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.%]+))?\s*\)$/i.exec(css || '');
    if (m) {
      var a = m[4] === undefined ? 1 : (m[4].slice(-1) === '%' ? parseFloat(m[4]) / 100 : parseFloat(m[4]));
      return [Math.round(m[1]), Math.round(m[2]), Math.round(m[3]), a];
    }
    try {                                        // any other colour syntax: let a canvas turn it into rgba
      canvas = canvas || document.createElement('canvas');
      canvas.width = canvas.height = 1;
      var ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = css;
      ctx.fillRect(0, 0, 1, 1);
      var p = ctx.getImageData(0, 0, 1, 1).data;
      return [p[0], p[1], p[2], p[3] / 255];
    } catch (e) {
      return [0, 0, 0, 0];
    }
  }
  function hex(c) {
    return '#' + [c[0], c[1], c[2]].map(function (v) { return ('0' + Math.max(0, Math.min(255, v)).toString(16)).slice(-2); }).join('');
  }
  function pageColour() {
    var els = [document.body, document.documentElement];
    for (var i = 0; i < els.length; i++) {
      if (!els[i]) continue;
      var c = rgbaOf(getComputedStyle(els[i]).backgroundColor);
      if (c[3] > 0.5) return c;
    }
    return [255, 255, 255, 1];
  }
  var lastBars = '';
  function reportBars() {
    try {
      if (!has('setBars')) return;
      var page = pageColour();
      var nav = page;
      var rail = document.querySelector('.rail');
      if (rail) {                                // on a phone the icon rail is the bar along the bottom
        var r = rail.getBoundingClientRect();
        if (r.width >= window.innerWidth - 2 && r.bottom >= window.innerHeight - 2 && r.height > 0) {
          var c = rgbaOf(getComputedStyle(rail).backgroundColor);
          if (c[3] > 0.5) nav = c;
        }
      }
      var key = hex(page) + hex(nav);
      if (key === lastBars) return;
      lastBars = key;
      A.setBars(hex(page), hex(nav));
    } catch (e) { /* the default bar colours stay */ }
  }
  window.__guBars = function () { lastBars = ''; reportBars(); };

  var barTimer = 0;
  function scheduleBars() {
    clearTimeout(barTimer);
    barTimer = setTimeout(reportBars, 120);
  }
  window.addEventListener('hashchange', scheduleBars);
  window.addEventListener('resize', scheduleBars);
  window.addEventListener('load', function () { scheduleBars(); setTimeout(reportBars, 800); });
  document.addEventListener('visibilitychange', function () { if (!document.hidden) scheduleBars(); });
  try {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', scheduleBars);
  } catch (e) { /* older WebView */ }
  /* The offline copy keeps its own data. Say so once each time the app starts, with a way to the online dashboard
     (which syncs across every device signed in to claude.ai). "Don't remind me" turns it off for good. */
  var LIVE_URL = 'https://claude.ai/artifact/8KyV1JdsawnfRtW4kmZRD8';
  function offlineNotice() {
    try {
      if (localStorage.getItem('groundup.offlineNoticeOff') === '1') return;
      if (sessionStorage.getItem('groundup.offlineNoticeShown') === '1') return;
      sessionStorage.setItem('groundup.offlineNoticeShown', '1');
    } catch (e) { return; }
    var box = document.createElement('div');
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-label', 'About this app');
    box.style.cssText = 'position:fixed;left:12px;right:12px;bottom:84px;z-index:2147483000;max-width:460px;margin:0 auto;padding:14px 16px;border-radius:14px;background:#1a1c21;color:#fff;font:14px/1.4 system-ui,-apple-system,sans-serif;box-shadow:0 8px 30px rgba(0,0,0,.35)';
    var btn = 'font:inherit;font-weight:600;border:0;border-radius:10px;padding:9px 12px;cursor:pointer;';
    box.innerHTML = '<b style="display:block;margin-bottom:4px;font-size:15px">This is the offline copy</b>' +
      'It keeps its own data on this phone and doesn’t sync with the online dashboard. To see the same things on every device, use the online version.' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px">' +
      '<button type="button" data-gu-live style="' + btn + 'background:#fff;color:#1a1c21">Open the online version</button>' +
      '<button type="button" data-gu-keep style="' + btn + 'background:#34373f;color:#fff">Keep using this copy</button>' +
      '<button type="button" data-gu-never style="' + btn + 'background:transparent;color:#c9cbd1;text-decoration:underline">Don’t remind me</button></div>';
    box.addEventListener('click', function (e) {
      var t = e.target;
      if (!t || !t.getAttribute) return;
      if (t.hasAttribute('data-gu-live')) { try { window.location.assign(LIVE_URL); } catch (x) { /* stay here */ } }
      else if (t.hasAttribute('data-gu-never')) { try { localStorage.setItem('groundup.offlineNoticeOff', '1'); } catch (x) { /* ignore */ } }
      else if (!t.hasAttribute('data-gu-keep')) return;
      box.remove();
    });
    document.body.appendChild(box);
  }
  window.__guOfflineNotice = offlineNotice;
  window.addEventListener('load', function () { setTimeout(offlineNotice, 1800); });
  document.addEventListener('DOMContentLoaded', function () {
    try {
      new MutationObserver(scheduleBars).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'data-part', 'class'] });
    } catch (e) { /* no observer */ }
    scheduleBars();
  });
})();
