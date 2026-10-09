# The Ground Up: the mark and the app icon

## The idea

**A G rising out of layered ground.** The bottom half of the letter is solid earth, cut into layers like strata; the top half is open
ring, the way up. It says the product's name ("The Ground Up": start from the ground, build upwards) and what the app does (your money and
paperwork, laid down in layers you can build on). One heavy shape, one idea, no extra decoration.

Why it works as a mark:

- It reads as a **G** first (the open mouth and the crossbar do that), and as ground and horizon second.
- The layers are the only detail, and they degrade gracefully: at 16px they become two light stripes, the G stays.
- Everything is a circle and straight lines, so the mark sits well inside a circle, a squircle or a square mask.
- It is **white on a colour tile** in both looks, so it never fights the page it sits on.

## The mark

Drawn on a 512 canvas, centred, outer radius 164 (a 328px circle, 64% of the tile; Android's adaptive-icon safe zone is 61% of the
whole 108dp layer, and this sits well inside it). In the drawing's own units (outer radius 150):

| Part | Value |
|---|---|
| Ring | outer radius 150, inner radius 94 (a stroke of 56), open from 38 degrees above the horizontal (the mouth) round the top and down the left |
| Crossbar | 28 high, from 6 right of the centre to the outer circle, sitting on the horizon |
| Ground | the lower half-disc, cut by three 11-unit slits at 42, 78 and 114 below the horizon (four layers) |
| Small sizes (16 to 48px) | two 24-unit slits at 52 and 104, so the layers survive; the mark is drawn a little larger in the tile |

## Colours

The mark is always `#ffffff`. Only the tile changes with the look (a diagonal gradient from the top left, with a soft white light in the
top left corner at 30%).

| Look | Tile gradient | Where |
|---|---|---|
| Soft Glass (the default) | `#a07cf5` lilac, `#6f6be8` at the middle, `#1fa9c4` aqua | `icon.svg`, the Android icon, the first favicon |
| Bold Colour | `#4a1080` plum, `#8a1fa6` at the middle, `#d92a8f` magenta | `icon-bold.svg`, the favicon while the Bold Colour look is on |

`js/branding.js` swaps the browser tab icon and the home-screen icon when the look changes (and on load). The Android app is a static
icon, so it wears Soft Glass.

The accent colour sets (Settings > Look > Colours: Ocean, Blush, Meadow, Dusk) recolour the tile in the browser as well: same mark, same
shape, only the three gradient stops change. They are listed in `TILES` in `js/branding.js` (outside the generated data block, so
`make-icons.js` leaves them alone), worked out from each set's own Home and Work colours. The tab icon is the look's SVG with its stops
swapped; the home-screen icon is that SVG drawn to a 180px canvas at the time (the look's own PNG stands in until it is ready). The original
colours always bring back the files in this folder exactly.

## Files

| File | What |
|---|---|
| `icon.svg` | the master: Soft Glass, 512, full bleed (no rounded corners: the platform's mask shapes it) |
| `icon-bold.svg` | the same in Bold Colour |
| `mark.svg`, `mark-mono.svg` | the mark alone (white, black), transparent, for use on your own colour |
| `png/icon-512.png`, `icon-512-bold.png` | 512px store-style icons (full bleed) |
| `png/apple-touch-180*.png` | the home-screen icons that are inlined in `index.html` and `js/branding.js` |
| `png/favicon-16/32/48*.png` | the small sizes, for checking (the page uses the SVG) |
| `make-icons.js` | draws the mark once and writes everything above, the Android icon resources, and the data inside `js/branding.js`, `css/banner.css` (the brand tile) and the icon links in `index.html` |

To change the mark or a colour, edit `make-icons.js` and run it from the repository root (it needs Node and Playwright with Chromium, only to
turn the SVG into PNGs; nothing in it ships):

```
NODE_PATH=/path/to/node_modules node brand/make-icons.js
```

## Where it is used

- **Browser tab and home screen (web)**: `index.html` has the Soft Glass `<link rel="icon">` (SVG) and `<link rel="apple-touch-icon">` (180px
  PNG), both as data URIs so there are no extra files. `js/branding.js` replaces them with the Bold Colour ones when that look is on, and with
  the recoloured tile when one of the other colour sets is picked.
- **In the app**: the tile at the top of the menu (and in the phone top bar), the lock screen and the disc between the Home and Work cards wear the mark instead of the letter G (`css/banner.css`, drawn as
  a mask in the tile's text colour, so each look and each colour scheme keeps its own tile and its own mark colour).
- **The online Android app** (`android-live/`): an adaptive icon (gradient background layer, white mark in the foreground layer inside the
  safe zone, and a single-colour layer for Android 13 themed icons), plus legacy PNGs for Android 7 (`mipmap-*dpi/ic_launcher*.png`,
  48 to 192px) and `android-live/store/icon-512.png`. The offline Android app (`android/`) keeps its original G icon.

## Rules of thumb

- Keep clear space around the mark of at least a quarter of its width. Never stretch, rotate, outline or add a shadow.
- On a colour that is not one of the two tiles, use `mark.svg` (white) on a dark or saturated colour, or `mark-mono.svg` on a light one.
- Below 48px use the small-size drawing (the favicon files); above that, the full one.
