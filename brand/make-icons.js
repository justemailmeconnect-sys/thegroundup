#!/usr/bin/env node
/* brand/make-icons.js: draws the Ground Up mark once and writes every icon file from it.

   Run from the repository root (needs Node and Playwright with Chromium, only to turn the SVG into PNGs; nothing here ships):
     NODE_PATH=/path/to/node_modules node brand/make-icons.js

   It writes:  brand/icon.svg, icon-bold.svg, mark.svg, mark-mono.svg, brand/png/*.png,
               android-live/app/src/main/res/{drawable,mipmap-*}/ic_launcher*  and  android-live/store/icon-512.png,
               and the data block in js/branding.js (between the BRAND-DATA markers) and the icon links in index.html.
   The geometry is in one place (markPaths), so the web and Android icons cannot drift apart. See brand/README.md. */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const OUT_SVG = __dirname;
const RES = path.join(ROOT, 'android-live/app/src/main/res');

const r2 = (n) => +n.toFixed(2);
const num = (n) => String(r2(n));

/* ---------- the mark ----------
   A heavy geometric G. Its top half is an open ring (the way up); its bottom half is solid ground, cut into layers by
   horizontal slits. Drawn in units where the outer radius is 150, then scaled by k = ro / 150. */
const GEOM = {
  ring: 94, // inner radius of the ring (outer is 150): a stroke of 56
  terminal: 38, // degrees above the horizontal where the ring ends (the mouth of the G)
  bar: 28, // height of the crossbar above the horizon
  barIn: 6, // the crossbar starts this far right of the centre
  slits: [[42, 11], [78, 11], [114, 11]], // [distance below the horizon, thickness]
};
const OPTICAL_SMALL = Object.assign({}, GEOM, { slits: [[52, 24], [104, 24]] }); // the favicon: fewer, thicker slits so they survive 16px

function markPaths(cx, cy, ro, g) {
  g = g || GEOM;
  const k = ro / 150;
  const pt = (R, deg) => [cx + R * k * Math.cos((deg * Math.PI) / 180), cy + R * k * Math.sin((deg * Math.PI) / 180)];
  const P = (p) => num(p[0]) + ',' + num(p[1]);
  const hw = (y) => Math.sqrt(Math.max(0, 150 * 150 - y * y)) * k;
  const d = [];
  // the ring: from the mouth, anticlockwise over the top and down the left, ending a little below the horizon (hidden in the ground)
  const out0 = pt(150, -g.terminal), out1 = pt(150, 170), in1 = pt(g.ring, 170), in0 = pt(g.ring, -g.terminal);
  // every piece runs clockwise, so overlaps add up instead of cancelling under the non-zero fill rule
  d.push('M' + P(in0) + 'A' + num(g.ring * k) + ',' + num(g.ring * k) + ' 0 0 0 ' + P(in1) + 'L' + P(out1) + 'A' + num(ro) + ',' + num(ro) + ' 0 0 1 ' + P(out0) + 'Z');
  // the crossbar, trimmed to the outer circle
  const bx = hw(g.bar);
  d.push('M' + num(cx + g.barIn * k) + ',' + num(cy - g.bar * k) + 'H' + num(cx + bx) + 'A' + num(ro) + ',' + num(ro) + ' 0 0 1 ' + num(cx + ro) + ',' + num(cy) + 'V' + num(cy + 2 * k) + 'H' + num(cx + g.barIn * k) + 'Z');
  // the ground: circular segments between the slits
  const tops = [0].concat(g.slits.map((s) => s[0] + s[1]));
  const bots = g.slits.map((s) => s[0]).concat([150]);
  tops.forEach((a, i) => {
    const b = bots[i];
    const ya = cy + a * k, yb = cy + b * k;
    let s = 'M' + num(cx - hw(a)) + ',' + num(ya) + 'L' + num(cx + hw(a)) + ',' + num(ya);
    if (b >= 150) s += 'A' + num(ro) + ',' + num(ro) + ' 0 0 1 ' + num(cx) + ',' + num(cy + ro) + 'A' + num(ro) + ',' + num(ro) + ' 0 0 1 ' + num(cx - hw(a)) + ',' + num(ya) + 'Z';
    else s += 'A' + num(ro) + ',' + num(ro) + ' 0 0 1 ' + num(cx + hw(b)) + ',' + num(yb) + 'L' + num(cx - hw(b)) + ',' + num(yb) + 'A' + num(ro) + ',' + num(ro) + ' 0 0 1 ' + num(cx - hw(a)) + ',' + num(ya) + 'Z';
    d.push(s);
  });
  return d;
}

/* ---------- the two tints ---------- */
const TINTS = {
  glass: { name: 'Soft Glass', stops: [[0, '#a07cf5'], [0.5, '#6f6be8'], [1, '#1fa9c4']], bar: '#6a2f9e' },
  bold: { name: 'Bold Colour', stops: [[0, '#4a1080'], [0.5, '#8a1fa6'], [1, '#d92a8f']], bar: '#a8197f' },
};
const stopsSVG = (t) => t.stops.map((s) => '<stop offset="' + s[0] + '" stop-color="' + s[1] + '"/>').join('');

/* A tile: shape = 'square' (full bleed, for masks), 'squircle' (rounded, for favicons and the web), 'circle'. */
function tileSVG(tint, o) {
  o = o || {};
  const size = o.size || 512, shape = o.shape || 'square', ro = o.ro || 164, g = o.geom || GEOM, id = o.id || 'gu';
  const rx = shape === 'circle' ? 256 : shape === 'squircle' ? 112 : 0;
  const q = o.q || '"';
  const attrs = (s) => s.replace(/"/g, q);
  const body =
    '<defs><linearGradient id="' + id + 'g" x1="0" y1="0" x2="1" y2="1">' + stopsSVG(tint) + '</linearGradient>' +
    (o.sheen === false ? '' : '<radialGradient id="' + id + 's" cx=".2" cy=".1" r=".8"><stop offset="0" stop-color="#fff" stop-opacity=".3"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>') + '</defs>' +
    '<rect width="512" height="512"' + (rx ? ' rx="' + rx + '"' : '') + ' fill="url(#' + id + 'g)"/>' +
    (o.sheen === false ? '' : '<rect width="512" height="512"' + (rx ? ' rx="' + rx + '"' : '') + ' fill="url(#' + id + 's)"/>') +
    '<path fill="#fff" d="' + markPaths(256, 256, ro, g).join('') + '"/>';
  return attrs('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"' + (size ? ' width="' + size + '" height="' + size + '"' : '') + (o.title ? ' role="img" aria-label="' + o.title + '"' : '') + '>' + body + '</svg>');
}
const markSVG = (fill, ro) => '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512"><path fill="' + fill + '" d="' + markPaths(256, 256, ro || 164).join('') + '"/></svg>';
const dataURI = (svg) => 'data:image/svg+xml,' + svg.replace(/%/g, '%25').replace(/#/g, '%23').replace(/</g, '%3C').replace(/>/g, '%3E').replace(/\s+/g, ' ');

/* ---------- Android: vectors ---------- */
const AND_RO = 164 / 512 * 72; // the same proportion as the master, in a 108dp layer whose visible part is 72dp
const AAPT = 'xmlns:aapt="http://schemas.android.com/aapt"';
function androidForeground(color, comment) {
  const paths = markPaths(54, 54, AND_RO).map((d) => '    <path android:fillColor="' + color + '" android:pathData="' + d + '" />').join('\n');
  return '<?xml version="1.0" encoding="utf-8"?>\n<!-- ' + comment + ' -->\n<vector xmlns:android="http://schemas.android.com/apk/res/android"\n    android:width="108dp"\n    android:height="108dp"\n    android:viewportWidth="108"\n    android:viewportHeight="108">\n' + paths + '\n</vector>\n';
}
function androidBackground(tint) {
  const c = tint.stops;
  return '<?xml version="1.0" encoding="utf-8"?>\n<!-- Soft Glass tint: a lilac to aqua gradient with a soft light in the top left corner. Full bleed; the launcher\'s mask decides the shape. -->\n<vector xmlns:android="http://schemas.android.com/apk/res/android"\n    ' + AAPT + '\n    android:width="108dp"\n    android:height="108dp"\n    android:viewportWidth="108"\n    android:viewportHeight="108">\n' +
    '    <path android:pathData="M0,0H108V108H0Z">\n        <aapt:attr name="android:fillColor">\n            <gradient android:type="linear" android:startX="18" android:startY="18" android:endX="90" android:endY="90">\n' +
    c.map((s) => '                <item android:offset="' + s[0] + '" android:color="' + s[1] + '" />').join('\n') + '\n            </gradient>\n        </aapt:attr>\n    </path>\n' +
    '    <path android:pathData="M0,0H108V108H0Z">\n        <aapt:attr name="android:fillColor">\n            <gradient android:type="radial" android:centerX="30" android:centerY="22" android:gradientRadius="70">\n                <item android:offset="0" android:color="#4DFFFFFF" />\n                <item android:offset="1" android:color="#00FFFFFF" />\n            </gradient>\n        </aapt:attr>\n    </path>\n</vector>\n';
}
const ADAPTIVE = '<?xml version="1.0" encoding="utf-8"?>\n<!-- Adaptive icon: gradient background, white mark inside the safe zone, and a single-colour layer for Android 13 themed icons. -->\n<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">\n    <background android:drawable="@drawable/ic_launcher_background" />\n    <foreground android:drawable="@drawable/ic_launcher_foreground" />\n    <monochrome android:drawable="@drawable/ic_launcher_monochrome" />\n</adaptive-icon>\n';

/* ---------- write ---------- */
const write = (file, data) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, data); };

async function main() {
  const { chromium } = require('playwright');
  const browser = await chromium.launch();
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  async function png(svg, size) {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent('<!doctype html><body style="margin:0;background:transparent">' + svg.replace(/width="\d+" height="\d+"/, 'width="' + size + '" height="' + size + '"').replace('<svg ', '<svg style="display:block" '));
    return page.screenshot({ type: 'png', omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
  }

  // SVG masters
  const titleOf = (t) => 'The Ground Up, ' + t.name;
  write(path.join(OUT_SVG, 'icon.svg'), tileSVG(TINTS.glass, { shape: 'square', title: titleOf(TINTS.glass), id: 'gu' }) + '\n');
  write(path.join(OUT_SVG, 'icon-bold.svg'), tileSVG(TINTS.bold, { shape: 'square', title: titleOf(TINTS.bold), id: 'gub' }) + '\n');
  write(path.join(OUT_SVG, 'mark.svg'), markSVG('#ffffff') + '\n');
  write(path.join(OUT_SVG, 'mark-mono.svg'), markSVG('#000000') + '\n');

  // PNGs
  const P = (n) => path.join(OUT_SVG, 'png', n);
  const sq = (t) => tileSVG(t, { shape: 'square' });
  write(P('icon-512.png'), await png(sq(TINTS.glass), 512));
  write(P('icon-512-bold.png'), await png(sq(TINTS.bold), 512));
  write(P('apple-touch-180.png'), await png(sq(TINTS.glass), 180));
  write(P('apple-touch-180-bold.png'), await png(sq(TINTS.bold), 180));
  const fav = (t) => tileSVG(t, { shape: 'squircle', ro: 186, geom: OPTICAL_SMALL, sheen: false });
  for (const s of [16, 32, 48]) { write(P('favicon-' + s + '.png'), await png(fav(TINTS.glass), s)); write(P('favicon-' + s + '-bold.png'), await png(fav(TINTS.bold), s)); }
  write(path.join(ROOT, 'android-live/store/icon-512.png'), await png(sq(TINTS.glass), 512));

  // Android resources
  write(path.join(RES, 'drawable/ic_launcher_background.xml'), androidBackground(TINTS.glass));
  write(path.join(RES, 'drawable/ic_launcher_foreground.xml'), androidForeground('#FFFFFFFF', 'The mark in white: a G whose top is an open ring and whose base is solid ground cut into layers. Kept inside the 66dp safe zone of the 108dp layer.'));
  write(path.join(RES, 'drawable/ic_launcher_monochrome.xml'), androidForeground('#FF000000', 'The same mark as one shape for Android 13 themed icons (the system colours it; the gaps stay clear).'));
  write(path.join(RES, 'mipmap-anydpi-v26/ic_launcher.xml'), ADAPTIVE);
  write(path.join(RES, 'mipmap-anydpi-v26/ic_launcher_round.xml'), ADAPTIVE);
  const dens = { mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 };
  for (const [d, s] of Object.entries(dens)) {
    write(path.join(RES, 'mipmap-' + d + '/ic_launcher.png'), await png(tileSVG(TINTS.glass, { shape: 'squircle' }), s));
    write(path.join(RES, 'mipmap-' + d + '/ic_launcher_round.png'), await png(tileSVG(TINTS.glass, { shape: 'circle' }), s));
  }

  // the two home-screen PNGs are squeezed to a 256-colour palette (with dithering): the same look at about a third of the size, which matters
  // because they are inlined into index.html and js/branding.js. Skipped quietly if Python's Pillow is not installed.
  for (const n of ['apple-touch-180.png', 'apple-touch-180-bold.png']) {
    try {
      require('child_process').execFileSync('python3', ['-I', '-c', 'import sys\nfrom PIL import Image\nf=sys.argv[1]\nim=Image.open(f).convert("RGB")\nim.quantize(colors=256, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.FLOYDSTEINBERG).save(f, optimize=True)', P(n)]);
    } catch (e) { /* keep the full-colour file */ }
  }

  // the data block for js/branding.js and the links for index.html
  const b64 = (buf) => 'data:image/png;base64,' + buf.toString('base64');
  const data = {
    svg: { glass: dataURI(fav(TINTS.glass).replace(/"/g, "'")), bold: dataURI(fav(TINTS.bold).replace(/"/g, "'")) },
    touch: { bold: b64(fs.readFileSync(P('apple-touch-180-bold.png'))) }, // Soft Glass: index.html holds it, branding.js reads it from there
  };
  const bp = path.join(ROOT, 'js/branding.js');
  if (fs.existsSync(bp)) {
    let js = fs.readFileSync(bp, 'utf8');
    const block = '/*BRAND-DATA*/\n  const ICONS = ' + JSON.stringify(data, null, 2).replace(/\n/g, '\n  ') + ';\n  /*END-BRAND-DATA*/';
    if (/\/\*BRAND-DATA\*\//.test(js)) { js = js.replace(/\/\*BRAND-DATA\*\/[\s\S]*?\/\*END-BRAND-DATA\*\//, () => block); fs.writeFileSync(bp, js); }
  }
  // the mark as a mask for the in-app brand tile (css/banner.css), cropped to the mark and with the favicon's two thick slits
  const maskSVG = '<svg xmlns=\'http://www.w3.org/2000/svg\' viewBox=\'92 92 328 328\'><path d=\'' + markPaths(256, 256, 164, OPTICAL_SMALL).join('') + '\'/></svg>';
  const cp = path.join(ROOT, 'css/banner.css');
  if (fs.existsSync(cp)) {
    let css = fs.readFileSync(cp, 'utf8');
    const blk = '/*BRAND-MASK*/\n:root { --gu-mark: url("' + dataURI(maskSVG) + '"); }\n/*END-BRAND-MASK*/';
    if (/\/\*BRAND-MASK\*\//.test(css)) fs.writeFileSync(cp, css.replace(/\/\*BRAND-MASK\*\/[\s\S]*?\/\*END-BRAND-MASK\*\//, () => blk));
  }
  const hp = path.join(ROOT, 'index.html');
  let html = fs.readFileSync(hp, 'utf8');
  const links = '<link rel="icon" id="gu-icon" type="image/svg+xml" href="' + data.svg.glass.replace(/"/g, '&quot;') + '">\n  <link rel="apple-touch-icon" id="gu-touch" sizes="180x180" href="' + b64(fs.readFileSync(P('apple-touch-180.png'))) + '">';
  html = html.replace(/<link rel="icon"[^>]*>(\s*<link rel="apple-touch-icon"[^>]*>)?/, () => links);
  fs.writeFileSync(hp, html);
  await browser.close();
  console.log('icons written');
}
if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });
module.exports = { markPaths, tileSVG, TINTS };
