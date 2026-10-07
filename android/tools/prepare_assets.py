#!/usr/bin/env python3
"""Builds the app's bundled web files: android/app/src/main/assets/www/

What goes in (and nothing else):
  * index.html, css/ and js/ from the repo root, copied byte for byte (index.html gets two small edits below)
  * android-shim.js (android/shim/android-shim.js), injected as the FIRST script tag of index.html
  * fonts/ : the Google Fonts families the page links, downloaded once (cached in android/.cache/fonts) and
    served from the app, with fonts/fonts.css replacing the <link> to fonts.googleapis.com

The website's own files are never modified; only the copy inside the APK differs.

Usage: prepare_assets.py --repo <repo root> --out <assets/www> --shim <android-shim.js> --cache <dir> [--fonts auto|off] [--refresh-fonts]
"""
import argparse
import hashlib
import os
import re
import shutil
import sys
import urllib.request

UA = ("Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) "
      "Chrome/126.0.0.0 Mobile Safari/537.36")
SKIP_NAMES = re.compile(r"(^\.|\.log$|\.map$|\.orig$|\.rej$|~$|^thumbs\.db$|^state.*\.json$|^userdb|\.test\.js$|\.spec\.js$)", re.I)
SHIM_TAG = '<script src="android-shim.js"></script>'
FONT_LINK = re.compile(r'[ \t]*<link[^>]+href="(https://fonts\.googleapis\.com/css2\?[^"]+)"[^>]*>[ \t]*\r?\n?', re.I)
PRECONNECT = re.compile(r'[ \t]*<link[^>]+rel="preconnect"[^>]+href="https://fonts\.(?:googleapis|gstatic)\.com"[^>]*>[ \t]*\r?\n?', re.I)


def log(msg):
    print("  " + msg, flush=True)


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def fetch(url, retries=4):
    last = None
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=60) as r:
                return r.read()
        except Exception as e:  # noqa: BLE001 - retry on any network problem
            last = e
    raise RuntimeError("could not download %s: %s" % (url, last))


def copy_tree(src, dst, base, copied):
    for root, dirs, files in os.walk(src):
        dirs[:] = sorted(d for d in dirs if not SKIP_NAMES.search(d))
        rel = os.path.relpath(root, src)
        os.makedirs(os.path.join(dst, rel) if rel != "." else dst, exist_ok=True)
        for name in sorted(files):
            if SKIP_NAMES.search(name):
                continue
            s = os.path.join(root, name)
            d = os.path.join(dst, rel, name) if rel != "." else os.path.join(dst, name)
            shutil.copyfile(s, d)
            copied[os.path.relpath(d, base).replace(os.sep, "/")] = s


def slug(family):
    return re.sub(r"[^a-z0-9]+", "-", family.lower()).strip("-")


def build_fonts(google_css_url, out_dir, cache_dir, refresh):
    """Returns the number of font files, writing out_dir/fonts/fonts.css. Raises on any failure."""
    fonts_out = os.path.join(out_dir, "fonts")
    os.makedirs(cache_dir, exist_ok=True)
    key = hashlib.sha1(google_css_url.encode()).hexdigest()[:10]
    cached_css = os.path.join(cache_dir, "google-%s.css" % key)
    if refresh or not os.path.exists(cached_css):
        css = fetch(google_css_url).decode("utf-8")
        with open(cached_css, "w", encoding="utf-8") as f:
            f.write(css)
    else:
        with open(cached_css, encoding="utf-8") as f:
            css = f.read()

    faces = re.findall(r"(/\*\s*([\w-]+)\s*\*/\s*)?@font-face\s*\{(.*?)\}", css, re.S)
    if not faces:
        raise RuntimeError("no @font-face rules in the Google Fonts CSS")
    os.makedirs(fonts_out, exist_ok=True)
    url_to_name = {}
    rules = []
    for _, subset, body in faces:
        m = re.search(r"url\((https://[^)]+\.woff2)\)", body)
        fam = re.search(r"font-family:\s*'?\"?([^;'\"]+)", body)
        if not m or not fam:
            raise RuntimeError("unexpected @font-face rule: " + body[:80])
        url = m.group(1)
        if url not in url_to_name:
            name = "%s-%s-%s.woff2" % (slug(fam.group(1)), subset or "all", hashlib.sha1(url.encode()).hexdigest()[:8])
            cached = os.path.join(cache_dir, name)
            if refresh or not os.path.exists(cached):
                data = fetch(url)
                if data[:4] != b"wOF2":
                    raise RuntimeError("%s is not a woff2 file" % url)
                with open(cached, "wb") as f:
                    f.write(data)
            shutil.copyfile(cached, os.path.join(fonts_out, name))
            url_to_name[url] = name
        rules.append("/* %s */\n@font-face {%s}" % (subset or "all", body.replace(url, url_to_name[url])))
    with open(os.path.join(fonts_out, "fonts.css"), "w", encoding="utf-8") as f:
        f.write("/* Google Fonts, saved inside the app so they work offline. Made by android/tools/prepare_assets.py. */\n"
                + "\n".join(rules) + "\n")
    return len(url_to_name)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--repo", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--shim", required=True)
    ap.add_argument("--cache", required=True)
    ap.add_argument("--fonts", choices=["auto", "off"], default="auto")
    ap.add_argument("--refresh-fonts", action="store_true")
    a = ap.parse_args()

    repo, out = os.path.abspath(a.repo), os.path.abspath(a.out)
    if os.path.basename(out) != "www" or "assets" not in out:
        sys.exit("refusing to clear %s (expected .../assets/www)" % out)
    shutil.rmtree(out, ignore_errors=True)
    os.makedirs(out)

    copied = {}
    shutil.copyfile(os.path.join(repo, "index.html"), os.path.join(out, "index.html"))
    copied["index.html"] = os.path.join(repo, "index.html")
    copy_tree(os.path.join(repo, "css"), os.path.join(out, "css"), out, copied)
    copy_tree(os.path.join(repo, "js"), os.path.join(out, "js"), out, copied)
    shutil.copyfile(a.shim, os.path.join(out, "android-shim.js"))

    # ---- index.html: the shim first, then local fonts in place of the Google Fonts link
    path = os.path.join(out, "index.html")
    with open(path, encoding="utf-8") as f:
        html = f.read()
    if "android-shim.js" in html:
        sys.exit("index.html already mentions android-shim.js")
    anchor = re.search(r"[ \t]*<title>", html) or re.search(r"[ \t]*</head>", html)
    if not anchor:
        sys.exit("index.html has no <title> or </head> to put the shim before")
    html = html[:anchor.start()] + "  " + SHIM_TAG + "\n" + html[anchor.start():]

    fonts_note = "off"
    link = FONT_LINK.search(html)
    if a.fonts == "auto" and link:
        try:
            n = build_fonts(link.group(1).replace("&amp;", "&"), out, a.cache, a.refresh_fonts)
            html = PRECONNECT.sub("", html)
            html = FONT_LINK.sub('  <link rel="stylesheet" href="fonts/fonts.css">\n', html, count=1)
            fonts_note = "%d font files, served from the app" % n
        except Exception as e:  # noqa: BLE001
            shutil.rmtree(os.path.join(out, "fonts"), ignore_errors=True)
            fonts_note = "ONLINE LINK KEPT (%s)" % e
            print("WARNING: fonts not bundled: %s" % e, file=sys.stderr)
    with open(path, "w", encoding="utf-8", newline="") as f:
        f.write(html)

    # ---- checks: the shim is the first script, and the files are exactly the repo's plus shim and fonts
    first = re.search(r"<script\b[^>]*>", html)
    if not first or first.group(0) + "</script>" != SHIM_TAG:
        sys.exit("the shim is not the first script tag in index.html")
    for rel, src in copied.items():
        if rel != "index.html" and sha256(os.path.join(out, rel)) != sha256(src):
            sys.exit("copy of %s differs from the source" % rel)
    expected = set(copied) | {"android-shim.js"}
    found = set()
    for root, _, files in os.walk(out):
        for name in files:
            found.add(os.path.relpath(os.path.join(root, name), out).replace(os.sep, "/"))
    extra = {f for f in found - expected if not f.startswith("fonts/")}
    missing = expected - found
    if extra or missing:
        sys.exit("unexpected asset set: extra=%s missing=%s" % (sorted(extra), sorted(missing)))

    total = sum(os.path.getsize(os.path.join(out, f)) for f in found)
    print("  bundled %d files (%d bytes): %d web files + shim; fonts: %s" % (len(found), total, len(copied), fonts_note))


if __name__ == "__main__":
    main()
