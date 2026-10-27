#!/usr/bin/env python3
"""Build assets/site.min.css from the readable stylesheets.

GitHub Pages serves the committed file. Re-run after editing styles.css,
theme.css, or assets/cart.css:

    python3 tools/minify-css.py
"""
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parent.parent
SOURCES = ["styles.css", "theme.css", "assets/cart.css", "neon-bento.css"]
OUT = ROOT / "assets" / "site.min.css"


def minify(css):
    out = []
    i = 0
    n = len(css)
    while i < n:
        if css.startswith("/*", i):
            j = css.find("*/", i + 2)
            i = n if j < 0 else j + 2
            continue
        if css[i] in "\"'":
            q = css[i]
            j = i + 1
            while j < n and css[j] != q:
                j += 2 if css[j] == "\\" else 1
            out.append(css[i:j + 1])
            i = j + 1
            continue
        out.append(css[i])
        i += 1
    css = "".join(out)
    css = re.sub(r"\s+", " ", css)
    css = re.sub(r"\s*([{}:;,])\s*", r"\1", css)
    css = re.sub(r";}", "}", css)
    return css.strip() + "\n"


parts = []
for name in SOURCES:
    parts.append(minify((ROOT / name).read_text()))
text = "\n".join(parts)
OUT.write_text(text)
raw = sum((ROOT / name).stat().st_size for name in SOURCES)
print(f"wrote {OUT.relative_to(ROOT)} {len(text)} bytes from {raw} bytes")
