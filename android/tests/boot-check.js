/* Boots the bundled web files (android/app/src/main/assets/www) in desktop Chromium the way the app's WebView does:
   - served at https://appassets.androidplatform.net/assets/www/... (the same secure origin),
   - with NO window.claude,
   - with a stubbed window.GUAndroid that records every call (the real bridge is Java; see README "What is tested").
   Checks the pages, the shim (downloads, share, back, bar colours), fonts and the hosts the app talks to.

   Run:  NODE_PATH=/opt/node-tools/node_modules node android/tests/boot-check.js [assetsDir] [screenshotDir]
   Needs Playwright with Chromium installed. Exit code 1 if anything fails. */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const ASSETS = path.resolve(process.argv[2] || path.join(ROOT, 'app/src/main/assets/www'));
const SHOTS = path.resolve(process.argv[3] || path.join(ROOT, '.cache/shots'));
const ORIGIN = 'https://appassets.androidplatform.net';
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail });
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail !== undefined && (!ok || process.env.VERBOSE) ? '  -> ' + (typeof detail === 'string' ? detail : JSON.stringify(detail)) : ''));
}

/* The stub for window.GUAndroid: everything it is asked to do is recorded in window.__calls. */
const STUB = `
(function () {
  var calls = (window.__calls = []);
  var open = {}, n = 0;
  window.GUAndroid = {
    saveFile: function (name, mime, b64) { calls.push({ fn: 'saveFile', name: name, mime: mime, b64: b64 }); return 'ok:' + name; },
    openFile: function (name, mime, b64) { calls.push({ fn: 'openFile', name: name, mime: mime, b64: b64 }); return 'ok'; },
    shareFile: function (name, mime, b64) { calls.push({ fn: 'shareFile', name: name, mime: mime, b64: b64 }); return 'ok'; },
    shareText: function (text) { calls.push({ fn: 'shareText', text: text }); return 'ok'; },
    beginFile: function (name, mime) { var t = 't' + (++n); open[t] = { name: name, mime: mime, parts: [] }; calls.push({ fn: 'beginFile', name: name, mime: mime, token: t }); return t; },
    appendFile: function (t, b64) { open[t].parts.push(b64); calls.push({ fn: 'appendFile', token: t, len: b64.length }); return true; },
    endFile: function (t, action, opts) { calls.push({ fn: 'endFile', token: t, action: action, opts: opts, name: open[t].name, mime: open[t].mime, b64: open[t].parts.join('') }); return action === 'keep' ? 'ok:' + t : 'ok:' + open[t].name; },
    shareKept: function (csv, opts) { calls.push({ fn: 'shareKept', csv: csv, opts: opts }); return 'ok'; },
    abortFile: function (t) { calls.push({ fn: 'abortFile', token: t }); },
    setBars: function (s, nv) { calls.push({ fn: 'setBars', status: s, nav: nv }); },
    toast: function (m) { calls.push({ fn: 'toast', message: m }); },
    shareTracked: function () { return window.__tracked === true; }
  };
})();`;

function serve(context, requests) {
  return context.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    requests.push(url.href);
    if (url.origin !== ORIGIN) return route.abort('blockedbyclient');     // nothing outside the app is reachable in this test
    let rel = decodeURIComponent(url.pathname);
    if (!rel.startsWith('/assets/www/')) return route.fulfill({ status: 404, body: '' });
    rel = rel.slice('/assets/www/'.length) || 'index.html';
    const file = path.join(ASSETS, rel);
    if (!file.startsWith(ASSETS) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return route.fulfill({ status: 404, body: '' });
    return route.fulfill({ status: 200, body: fs.readFileSync(file), headers: { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' } });
  });
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

async function newPage(browser, { stub = true, scheme = 'light', width = 390, height = 844 } = {}) {
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2, isMobile: width < 700, hasTouch: width < 700, colorScheme: scheme, locale: 'en-GB', acceptDownloads: true });
  const requests = [];
  await serve(context, requests);
  if (stub) await context.addInitScript(STUB);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console.error: ' + m.text()); });
  return { context, page, errors, requests };
}

async function boot(page) {
  await page.goto(ORIGIN + '/assets/www/index.html', { waitUntil: 'load' });
  await page.waitForFunction(() => window.GU && window.GU.view && document.querySelector('#app main, #app .app'), null, { timeout: 15000 });
  await page.evaluate(() => document.fonts.ready);
  await wait(500);
}

const calls = (page) => page.evaluate(() => window.__calls.map((c) => Object.assign({}, c)));
const callsOf = async (page, fn) => (await calls(page)).filter((c) => c.fn === fn);
async function waitForCall(page, fn, timeout = 8000, min = 1) {
  const t0 = Date.now();
  for (;;) {
    const c = await callsOf(page, fn);
    if (c.length >= min) return c;
    if (Date.now() - t0 > timeout) return c;
    await wait(50);
  }
}

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  if (!fs.existsSync(path.join(ASSETS, 'index.html'))) throw new Error('No bundled index.html in ' + ASSETS + ' (run android/build.sh first)');
  const browser = await chromium.launch();
  const allHosts = new Set();

  /* ================= 1. boot, every page, no window.claude ================= */
  {
    const { context, page, errors, requests } = await newPage(browser);
    await boot(page);
    const first = await page.evaluate(() => ({ firstScript: document.scripts[0] && document.scripts[0].getAttribute('src'), claude: typeof window.claude, secure: window.isSecureContext, origin: location.origin, subtle: !!(crypto && crypto.subtle), idb: !!window.indexedDB, ls: (() => { try { localStorage.setItem('x', '1'); localStorage.removeItem('x'); return true; } catch (e) { return false; } })() }));
    check('first script tag is the shim', first.firstScript === 'android-shim.js', first.firstScript);
    check('no window.claude', first.claude === 'undefined', first.claude);
    check('secure origin with crypto.subtle, IndexedDB, localStorage', first.secure && first.subtle && first.idb && first.ls && first.origin === ORIGIN, first);
    check('boots with zero page errors', errors.length === 0, errors);

    const ids = await page.evaluate(() => Object.keys(GU.tabs));
    check('GU.tabs lists pages', ids.length > 15, ids.length + ' pages');
    const bad = [];
    for (const id of ids) {
      const before = errors.length;
      await page.evaluate((t) => GU.view.go(t), id);
      await wait(280);
      const info = await page.evaluate(() => { const m = document.querySelector('#app main') || document.querySelector('#app'); return { text: (m && m.innerText || '').trim().length, h1: (document.querySelector('#app h1') || {}).textContent || '' }; });
      if (errors.length > before || info.text < 15) bad.push({ id, info, errors: errors.slice(before) });
    }
    check('every page (' + ids.join(', ') + ') renders with no errors', bad.length === 0, bad);

    // ----- Settings: local-only sync
    await page.evaluate(() => GU.view.go('settings'));
    await wait(400);
    const st = await page.evaluate(() => ({ text: document.querySelector('#app').innerText, pill: (document.querySelector('[data-sync] .pill') || {}).textContent }));
    check('Settings shows sync Off and "saved in this browser only"', /saved in this browser only/i.test(st.text) && /^\s*Off\s*$/.test(st.pill || '') && /Sync works when you open this dashboard from claude\.ai/.test(st.text), { pill: st.pill });

    // ----- fonts are local
    await page.evaluate(() => GU.view.go('today'));
    await wait(300);
    const fonts = await page.evaluate(async () => {
      await document.fonts.ready;
      const loaded = [...document.fonts].filter((f) => f.status === 'loaded').map((f) => f.family.replace(/"/g, '') + ' ' + f.weight);
      return { loaded, plex: document.fonts.check('16px "IBM Plex Sans"'), fraunces: document.fonts.check('italic 500 20px Fraunces'), total: document.fonts.size };
    });
    check('fonts load from the bundle (document.fonts)', fonts.plex && fonts.loaded.length >= 3, fonts);
    const fontReqs = requests.filter((u) => /\.woff2/.test(u));
    check('font files are requested from the app origin only', fontReqs.length > 0 && fontReqs.every((u) => u.startsWith(ORIGIN + '/assets/www/fonts/')), fontReqs.length + ' woff2 requests');

    // ----- screenshots (phone size)
    await page.evaluate(() => GU.view.go('today'));
    await wait(600);
    await page.screenshot({ path: path.join(SHOTS, 'home-390x844.png') });
    await page.evaluate(() => GU.view.go('settings'));
    await wait(600);
    await page.screenshot({ path: path.join(SHOTS, 'settings-390x844.png') });
    await page.evaluate(() => GU.view.go('settings'));
    await page.evaluate(() => window.scrollTo(0, 0));

    requests.forEach((u) => { try { allHosts.add(new URL(u).host); } catch (e) { /* data: etc. */ } });

    /* ================= 2. downloads reach GUAndroid.saveFile ================= */
    await page.evaluate(() => { window.__calls.length = 0; });
    await page.evaluate(() => GU.ui.saveFile(new Blob(['x'], { type: 'text/csv' }), 'test.csv'));
    let c = await waitForCall(page, 'saveFile');
    check('GU.ui.saveFile(blob, "test.csv") -> GUAndroid.saveFile with the right base64', c.length === 1 && c[0].name === 'test.csv' && c[0].mime === 'text/csv' && Buffer.from(c[0].b64, 'base64').toString() === 'x', c.map((x) => ({ name: x.name, mime: x.mime, b64: x.b64 })));
    const nav = await page.evaluate(() => location.href);
    check('the download click did not navigate away', nav.startsWith(ORIGIN + '/assets/www/index.html'), nav);

    await page.evaluate(() => { window.__calls.length = 0; });
    await page.evaluate(async () => GU.ui.saveFile(await GU.ui.makeZip([{ name: 'a.txt', blob: new Blob(['hello zip']) }, { name: 'b.csv', blob: new Blob(['1,2\n3,4']) }]), 'claim-pack.zip'));
    c = await waitForCall(page, 'saveFile');
    const zipBuf = c[0] ? Buffer.from(c[0].b64, 'base64') : Buffer.alloc(0);
    check('a zip made in the app (claim pack style) is saved intact', c.length === 1 && c[0].name === 'claim-pack.zip' && zipBuf.slice(0, 4).toString('hex') === '504b0304' && zipBuf.includes('a.txt') && zipBuf.includes('hello zip') && zipBuf.includes('b.csv'), { name: c[0] && c[0].name, size: zipBuf.length });

    // The Settings > Backup export button, as a person would use it
    await page.evaluate(() => { window.__calls.length = 0; GU.view.go('settings'); });
    await wait(400);
    await page.click('[data-export]');
    c = await waitForCall(page, 'saveFile', 15000);
    let backup = null;
    try { backup = JSON.parse(Buffer.from(c[0].b64, 'base64').toString('utf8')); } catch (e) { /* reported below */ }
    check('Settings > Export backup -> saveFile with a valid backup JSON', c.length === 1 && /^the-ground-up-backup-\d{4}-\d{2}-\d{2}\.json$/.test(c[0].name) && c[0].mime === 'application/json' && backup && typeof backup === 'object', { name: c[0] && c[0].name, keys: backup && Object.keys(backup).slice(0, 8) });

    // ...and restoring that backup through the file input (in the app the system picker feeds this input)
    if (c[0]) {
      const buf = Buffer.from(c[0].b64, 'base64');
      await page.setInputFiles('[data-import]', { name: c[0].name, mimeType: 'application/json', buffer: buf });
      await page.waitForSelector('dialog[open]', { timeout: 5000 });
      await page.click('dialog[open] button[type=submit]');
      const restored = await page.waitForFunction(() => /Backup restored/i.test(document.body.innerText), null, { timeout: 8000 }).then(() => true, () => false);
      check('Restore from backup works through the file input', restored, errors.slice(-3));
    }

    // ----- a big file goes through the piecewise path, byte for byte
    await page.evaluate(() => { window.__calls.length = 0; });
    const bigInfo = await page.evaluate(async () => {
      const buf = new Uint8Array(7 * 1024 * 1024 + 5);
      for (let i = 0; i < buf.length; i++) buf[i] = (i * 31 + (i >> 8)) & 255;
      const digest = await crypto.subtle.digest('SHA-256', buf);
      window.__bigSha = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
      GU.ui.saveFile(new Blob([buf], { type: 'application/zip' }), 'big pack.zip');
      return { size: buf.length, sha: window.__bigSha };
    });
    c = await waitForCall(page, 'endFile', 30000);
    const pieces = await callsOf(page, 'appendFile');
    const big = c[0] ? Buffer.from(c[0].b64, 'base64') : Buffer.alloc(0);
    check('7 MB file is sent in pieces and arrives byte-identical', c.length === 1 && c[0].action === 'save' && c[0].name === 'big pack.zip' && pieces.length === 3 && big.length === bigInfo.size && sha(big) === bigInfo.sha, { pieces: pieces.length, size: big.length, want: bigInfo.size, saveFileCalls: (await callsOf(page, 'saveFile')).length });

    /* ================= 3. open (blob links), share ================= */
    await page.evaluate(() => { window.__calls.length = 0; });
    await page.evaluate(() => {
      const url = URL.createObjectURL(new Blob(['%PDF-1.4 fake'], { type: 'application/pdf' }));
      const a = document.createElement('a');
      a.id = 'blob-open';
      a.href = url; a.target = '_blank'; a.title = 'receipt.pdf'; a.textContent = 'Open'; a.style.cssText = 'position:fixed;top:120px;left:20px;z-index:2147483000;background:#fff;padding:8px';
      document.body.appendChild(a);
    });
    await page.click('#blob-open');
    c = await waitForCall(page, 'openFile');
    check('tapping an "Open" blob link -> GUAndroid.openFile (no navigation)', c.length === 1 && c[0].mime === 'application/pdf' && Buffer.from(c[0].b64, 'base64').toString() === '%PDF-1.4 fake' && (await page.evaluate(() => location.href)).startsWith(ORIGIN), c.map((x) => ({ name: x.name, mime: x.mime })));

    await page.evaluate(() => { window.__calls.length = 0; window.__tracked = false; });
    const cs = await page.evaluate(() => ({
      text: navigator.canShare({ text: 'hi' }), file: navigator.canShare({ files: [new File(['x'], 'a.zip', { type: 'application/zip' })] }),
      empty: navigator.canShare({}), none: navigator.canShare(), has: typeof navigator.share,
    }));
    check('navigator.canShare / navigator.share exist and answer sensibly', cs.text === true && cs.file === true && cs.empty === false && cs.none === false && cs.has === 'function', cs);
    await page.evaluate(() => navigator.share({ title: 'T', text: 'See this', url: 'https://example.com/x' }));
    c = await callsOf(page, 'shareText');
    check('navigator.share({text,url}) -> GUAndroid.shareText', c.length === 1 && c[0].text === 'See this\nhttps://example.com/x', c);
    await page.evaluate(() => { window.__calls.length = 0; });
    await page.evaluate(() => navigator.share({ files: [new File(['zipbytes'], 'pack.zip', { type: 'application/zip' })] }));
    c = await callsOf(page, 'shareFile');
    check('navigator.share({files}) -> GUAndroid.shareFile', c.length === 1 && c[0].name === 'pack.zip' && c[0].mime === 'application/zip' && Buffer.from(c[0].b64, 'base64').toString() === 'zipbytes', c.map((x) => ({ name: x.name, mime: x.mime })));
    await page.evaluate(() => { window.__calls.length = 0; });
    await page.evaluate(() => navigator.share({ title: 'Pack', text: 'Here is the pack', files: [new File(['zz'], 'pack.zip', { type: 'application/zip' })] }));
    c = await callsOf(page, 'endFile');
    check('share with a file and a message keeps the message', c.length === 1 && c[0].action === 'share' && JSON.parse(c[0].opts).text === 'Here is the pack' && Buffer.from(c[0].b64, 'base64').toString() === 'zz', c.map((x) => x.opts));
    await page.evaluate(() => { window.__calls.length = 0; });
    await page.evaluate(() => navigator.share({ text: 'two files', files: [new File(['1'], 'a.csv', { type: 'text/csv' }), new File(['2'], 'b.csv', { type: 'text/csv' })] }));
    c = await callsOf(page, 'shareKept');
    check('share with two files -> two kept transfers then shareKept', c.length === 1 && c[0].csv.split(',').length === 2, c);

    // tracked share: the promise settles when the app reports the sheet was used or dismissed
    const tracked = await page.evaluate(async () => {
      window.__tracked = true;
      const out = {};
      const p1 = navigator.share({ text: 'one' });
      let settled = false; p1.then(() => { settled = true; }, () => { settled = true; });
      await new Promise((r) => setTimeout(r, 100));
      out.pendingBefore = !settled;
      window.__guShareDone(true);
      out.resolved = await p1.then(() => 'resolved', (e) => 'rejected ' + e.name);
      const p2 = navigator.share({ text: 'two' });
      window.__guShareDone(false);
      out.cancelled = await p2.then(() => 'resolved', (e) => e.name);
      window.__tracked = false;
      return out;
    });
    check('share promise follows the share sheet (resolves when used, AbortError when dismissed)', tracked.pendingBefore && tracked.resolved === 'resolved' && tracked.cancelled === 'AbortError', tracked);

    /* ================= 4. Back button helper ================= */
    const back = await page.evaluate(async () => {
      const out = {};
      out.none = window.__guBack();
      const p = GU.ui.confirmBox({ title: 'Test', message: 'Close me with Back' });
      await new Promise((r) => setTimeout(r, 100));
      out.dialogOpen = !!document.querySelector('dialog[open]');
      out.dialogBack = window.__guBack();
      await new Promise((r) => setTimeout(r, 100));
      out.dialogClosed = !document.querySelector('dialog[open]');
      out.confirmAnswer = await p;
      const btn = document.createElement('button'); btn.textContent = 'anchor'; document.body.appendChild(btn);
      let clicked = false;
      GU.ui.menu(btn, [{ label: 'One', icon: 'x', onClick: () => { clicked = true; } }]);
      await new Promise((r) => setTimeout(r, 100));
      out.menuOpen = !!document.querySelector('.popover');
      out.menuBack = window.__guBack();
      await new Promise((r) => setTimeout(r, 50));
      out.menuClosed = !document.querySelector('.popover');
      btn.remove();
      const lock = document.createElement('dialog'); lock.className = 'lockscreen';
      lock.addEventListener('cancel', (e) => e.preventDefault());
      document.body.appendChild(lock); lock.showModal();
      out.lockBack = window.__guBack();
      out.lockStillOpen = lock.open;
      lock.remove();
      return out;
    });
    check('Back closes an open dialog first (returns 1, dialog gone, app not left)', back.none === 0 && back.dialogOpen && back.dialogBack === 1 && back.dialogClosed && back.confirmAnswer === false, back);
    check('Back closes an open menu; a lock screen is left alone (returns 2)', back.menuOpen && back.menuBack === 1 && back.menuClosed && back.lockBack === 2 && back.lockStillOpen, back);
    const chat = await page.evaluate(async () => {
      const t = document.querySelector('[data-chat-toggle]');
      if (!t) return { skipped: 'no chat toggle on this page' };
      t.click();
      await new Promise((r) => setTimeout(r, 200));
      const open = document.documentElement.classList.contains('chat-open');
      const r = window.__guBack();
      await new Promise((r2) => setTimeout(r2, 100));
      return { open, back: r, closed: !document.documentElement.classList.contains('chat-open') };
    });
    check('Back closes the Claude chat panel when it is open', chat.skipped || (chat.open && chat.back === 1 && chat.closed), chat);
    const hist = await page.evaluate(async () => { const n = history.length; GU.view.go('bills'); await new Promise((r) => setTimeout(r, 150)); GU.view.go('debts'); await new Promise((r) => setTimeout(r, 150)); const grew = history.length - n; history.back(); await new Promise((r) => setTimeout(r, 300)); return { grew, hash: location.hash }; });
    check('#hash page changes are history entries that Back can walk (grew by 2, back -> #bills)', hist.grew === 2 && hist.hash === '#bills', hist);

    check('page errors stayed at zero through all of the above', errors.length === 0, errors);
    await context.close();
  }

  /* ================= 5. bar colours (light and dark) ================= */
  for (const scheme of ['light', 'dark']) {
    const { context, page, errors } = await newPage(browser, { scheme });
    await boot(page);
    await wait(1500);
    const bars = await callsOf(page, 'setBars');
    const last = bars[bars.length - 1] || {};
    const want = scheme === 'light' ? { status: '#f5f2ec', nav: '#1a1c21' } : { status: '#141311', nav: '#0c0c0e' };
    check('status/navigation bar colours reported to the app (' + scheme + ')', last.status === want.status && last.nav === want.nav, { reported: bars.length, last });
    if (scheme === 'dark') {
      await page.evaluate(() => GU.view.go('today'));
      await wait(500);
      await page.screenshot({ path: path.join(SHOTS, 'home-dark-390x844.png') });
    }
    check('no page errors (' + scheme + ')', errors.length === 0, errors);
    await context.close();
  }

  /* ================= 6. a normal browser is untouched by the shim ================= */
  {
    const { context, page, errors } = await newPage(browser, { stub: false, width: 1100, height: 800 });
    await boot(page);
    const plain = await page.evaluate(() => ({
      guAndroid: typeof window.GUAndroid, share: typeof navigator.share, canShare: typeof navigator.canShare,
      clickNative: /\[native code\]/.test(Function.prototype.toString.call(HTMLAnchorElement.prototype.click)),
      back: typeof window.__guBack, bars: typeof window.__guBars,
    }));
    check('without GUAndroid the shim changes nothing (no share, native click, no helpers)', plain.guAndroid === 'undefined' && plain.share === 'undefined' && plain.clickNative && plain.back === 'undefined' && plain.bars === 'undefined', plain);
    const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 8000 }), page.evaluate(() => GU.ui.saveFile(new Blob(['x'], { type: 'text/csv' }), 'test.csv'))]);
    check('without GUAndroid a download is a normal browser download', dl.suggestedFilename() === 'test.csv', dl.suggestedFilename());
    check('no page errors in a normal browser', errors.length === 0, errors);
    await context.close();
  }

  /* ================= 7. hosts ================= */
  const odd = [...allHosts].filter((h) => h !== 'appassets.androidplatform.net');
  check('boot and page visits only request the app origin (no CDN, no fonts.googleapis.com / gstatic)', odd.length === 0, [...allHosts]);

  await browser.close();
  const failed = results.filter((r) => !r.ok);
  console.log('\n' + (results.length - failed.length) + ' passed, ' + failed.length + ' failed. Screenshots: ' + SHOTS);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error('test run crashed:', e); process.exit(2); });
