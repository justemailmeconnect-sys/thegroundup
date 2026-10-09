/* branding.js: the app icon (the browser tab icon and the home-screen icon), which follows the active look.

   The mark is the same in both looks (a G rising out of layered ground, see brand/README.md); only the tile behind it changes:
     Soft Glass    lilac to aqua
     Bold Colour   plum to magenta
   index.html carries the Soft Glass icons (so the first paint and a page with no script are right). This file swaps the two <link>s,
   #gu-icon (rel="icon", an SVG) and #gu-touch (rel="apple-touch-icon", a PNG), whenever the look changes, and once on load.

     GU.look.onChange(fn)    called as a switch starts, with the new look's id (looks.js)
     GU.look.onPalette(fn)   called when the accent colour choice changes, if the palette module provides it
   Both are optional and guarded. The page's own <html data-look> / data-palette attributes are watched as well, so the icon is right
   even if a change comes some other way (a synced setting, a restored backup). Nothing here touches data or behaviour.

   The accent colour choice (Settings > Look > Colours) recolours the tile too: the mark and its shape never change, only the three
   gradient colours behind it (TILES below, worked out from each palette's own Home and Work colours, and the same in light and dark mode).
   The original colours keep the original icons exactly. A palette's tab icon is the SVG with its three stops swapped; its home-screen
   icon is that SVG drawn to a 180px canvas (until that is ready, the look's own PNG stands in).

   The data block below is written by brand/make-icons.js (do not edit it by hand): two SVG favicons (small, with two thick slits so the
   layers survive 16px) and the Bold Colour 180px PNG for the home screen (the Soft Glass one lives in index.html). */
(function () {
  'use strict';
  const GU = (window.GU = window.GU || {});
  const root = document.documentElement;

  /*BRAND-DATA*/
  const ICONS = {
    "svg": {
      "glass": "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 512 512' width='512' height='512'%3E%3Cdefs%3E%3ClinearGradient id='gug' x1='0' y1='0' x2='1' y2='1'%3E%3Cstop offset='0' stop-color='%23a07cf5'/%3E%3Cstop offset='0.5' stop-color='%236f6be8'/%3E%3Cstop offset='1' stop-color='%231fa9c4'/%3E%3C/linearGradient%3E%3C/defs%3E%3Crect width='512' height='512' rx='112' fill='url(%23gug)'/%3E%3Cpath fill='%23fff' d='M347.85,184.24A116.56,116.56 0 0 0 141.21,276.24L72.83,288.3A186,186 0 0 1 402.57,141.49ZM263.44,221.28H438.73A186,186 0 0 1 442,256V258.48H263.44ZM70,256L442,256A186,186 0 0 1 430.47,320.48L81.53,320.48A186,186 0 0 1 70,256ZM95.64,350.24L416.36,350.24A186,186 0 0 1 390.03,384.96L121.97,384.96A186,186 0 0 1 95.64,350.24ZM159.03,414.72L352.97,414.72A186,186 0 0 1 256,442A186,186 0 0 1 159.03,414.72Z'/%3E%3C/svg%3E",
      "bold": "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 512 512' width='512' height='512'%3E%3Cdefs%3E%3ClinearGradient id='gug' x1='0' y1='0' x2='1' y2='1'%3E%3Cstop offset='0' stop-color='%234a1080'/%3E%3Cstop offset='0.5' stop-color='%238a1fa6'/%3E%3Cstop offset='1' stop-color='%23d92a8f'/%3E%3C/linearGradient%3E%3C/defs%3E%3Crect width='512' height='512' rx='112' fill='url(%23gug)'/%3E%3Cpath fill='%23fff' d='M347.85,184.24A116.56,116.56 0 0 0 141.21,276.24L72.83,288.3A186,186 0 0 1 402.57,141.49ZM263.44,221.28H438.73A186,186 0 0 1 442,256V258.48H263.44ZM70,256L442,256A186,186 0 0 1 430.47,320.48L81.53,320.48A186,186 0 0 1 70,256ZM95.64,350.24L416.36,350.24A186,186 0 0 1 390.03,384.96L121.97,384.96A186,186 0 0 1 95.64,350.24ZM159.03,414.72L352.97,414.72A186,186 0 0 1 256,442A186,186 0 0 1 159.03,414.72Z'/%3E%3C/svg%3E"
    },
    "touch": {
      "bold": "data:image/png;base64,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"
    }
  };
  /*END-BRAND-DATA*/

  /* The three tile colours (top left, middle, bottom right) for each look and accent palette. 'default' is not listed: it is ICONS above. */
  const TILES = {
    glass: {
      ocean: ['#0496f4', '#0097cd', '#00acae'],
      blush: ['#cf6acb', '#a96ede', '#669cd5'],
      meadow: ['#6a9d26', '#009f8a', '#a985d0'],
      dusk: ['#7a86fd', '#9773ea', '#c97baa'],
    },
    bold: {
      ocean: ['#033851', '#15588b', '#216dfb'],
      blush: ['#631639', '#a61a58', '#db3164'],
      meadow: ['#293903', '#376111', '#008b13'],
      dusk: ['#082e77', '#3643ca', '#7a5af9'],
    },
  };

  let shown = ''; // 'glass' or 'bold': the look the two links show now
  let shownKey = ''; // look + '/' + palette
  let drawn = 0; // counts touch icons asked for, so a slow one never lands after a newer choice

  const known = (id) => (id === 'bold' ? 'bold' : id === 'glass' ? 'glass' : '');
  const current = () => known(root.getAttribute('data-look')) || 'glass';
  const palette = (look, want) => {
    const p = want || root.getAttribute('data-palette');
    return p && TILES[look] && TILES[look][p] ? p : 'default';
  };
  const keyNow = () => {
    const l = current();
    return l + '/' + palette(l);
  };
  /* The look's SVG with its three gradient stops swapped for the palette's (the white light on top is left alone). */
  function recolour(svg, tri) {
    let i = 0;
    return svg.replace(/stop-color='%23([0-9a-fA-F]{6})'/g, (m) => (i < 3 ? "stop-color='%23" + tri[i++].slice(1) + "'" : m));
  }
  /* A 180px PNG of that SVG, for the home-screen icon. Calls back with a data URI, or nothing if this browser won't draw it. */
  function toPng(svgHref, done) {
    try {
      const img = new Image();
      img.onload = () => {
        try {
          const c = document.createElement('canvas');
          c.width = c.height = 180;
          c.getContext('2d').drawImage(img, 0, 0, 180, 180);
          done(c.toDataURL('image/png'));
        } catch (e) {
          done('');
        }
      };
      img.onerror = () => done('');
      img.src = svgHref;
    } catch (e) {
      done('');
    }
  }

  /* Browsers differ on whether editing an icon link's href is noticed, so the link is replaced rather than edited. */
  function setLink(id, rel, href, extra) {
    if (!href) return;
    const old = document.getElementById(id);
    if (old && old.getAttribute('href') === href) return;
    const el = document.createElement('link');
    el.id = id;
    el.rel = rel;
    Object.keys(extra || {}).forEach((k) => el.setAttribute(k, extra[k]));
    el.href = href;
    if (old && old.parentNode) old.parentNode.replaceChild(el, old);
    else document.head.appendChild(el);
  }

  /* id: the look to show (the one that is switching to, when called from onChange; else what <html data-look> says).
     pid: likewise the palette (from onPalette, which fires as the change starts; else what <html data-palette> says). */
  function apply(id, pid) {
    const look = known(id) || current();
    try {
      const pal = palette(look, pid);
      const mine = ++drawn;
      if (pal === 'default') {
        setLink('gu-icon', 'icon', ICONS.svg[look], { type: 'image/svg+xml' });
        setLink('gu-touch', 'apple-touch-icon', ICONS.touch[look], { sizes: '180x180' });
      } else {
        const svg = recolour(ICONS.svg[look], TILES[look][pal]);
        setLink('gu-icon', 'icon', svg, { type: 'image/svg+xml' });
        setLink('gu-touch', 'apple-touch-icon', ICONS.touch[look], { sizes: '180x180' }); // stands in until the palette's own is drawn
        toPng(svg, (png) => {
          if (png && mine === drawn) setLink('gu-touch', 'apple-touch-icon', png, { sizes: '180x180' });
        });
      }
      shown = look;
      shownKey = look + '/' + pal;
    } catch (e) {
      console.error('branding', e);
    }
  }

  function hook() {
    // the Soft Glass touch icon is the one index.html carries: keep it before the first swap
    try {
      const t = document.getElementById('gu-touch');
      if (t && !ICONS.touch.glass) ICONS.touch.glass = t.getAttribute('href');
    } catch (e) {
      /* the bold one still works */
    }
    apply();
    try {
      if (GU.look && typeof GU.look.onChange === 'function') GU.look.onChange((id) => apply(id));
      if (GU.look && typeof GU.look.onPalette === 'function') GU.look.onPalette((id) => apply(undefined, id));
    } catch (e) {
      console.error('branding', e);
    }
    try {
      new MutationObserver(() => {
        if (keyNow() !== shownKey) apply();
      }).observe(root, { attributes: true, attributeFilter: ['data-look', 'data-palette'] });
    } catch (e) {
      /* no observer: the two hooks above still cover a normal switch */
    }
  }

  GU.branding = { apply: () => apply(), shown: () => shown, shownKey: () => shownKey };
  // looks.js loads after this file, so GU.look is looked for once the page has been read in full.
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', hook);
  else hook();
})();
