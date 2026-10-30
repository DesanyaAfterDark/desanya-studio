#!/usr/bin/env python3
"""Duplicate shared partials into every page (no build step needed at runtime).

Each page contains marker pairs like:
    <!-- @partial:header -->  ...  <!-- /@partial:header -->
This script replaces everything between each pair with partials/<name>.html,
then marks the current page's nav links with aria-current="page".

Usage:  python3 tools/sync-partials.py        (run from anywhere)
Edit partials/*.html, re-run, done. Pages stay plain static HTML.
"""
import pathlib, re, sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
PARTIALS = ROOT / "partials"
# page path → (nav key, absolutize partial URLs for nested or unknown depths)
PAGES = {
    "index.html": ("home", False),
    "work.html": ("work", False),
    "gallery.html": ("gallery", False),
    "services.html": ("services", False),
    "process.html": ("process", False),
    "contact.html": ("contact", False),
    "blog/index.html": ("blog", True),
    "blog/why-your-small-business-needs-a-real-website/index.html": ("blog", True),
    "blog/google-business-profile-free-tool/index.html": ("blog", True),
    "blog/seo-basics-east-tennessee/index.html": ("blog", True),
    "blog/writing-website-copy-that-converts/index.html": ("blog", True),
    "blog/meet-our-spooky-ai-crew/index.html": ("blog", True),
    "404.html": ("", True),
    "thanks/index.html": ("", True),
    "checkout.html": ("", False),
    "esports-gaming/index.html": ("esports", True),
    "knoxville-web-design.html": ("", False),
    "local-seo-google-business-profile.html": ("", False),
    "social-media-management.html": ("", False),
    "ai-for-small-business.html": ("", False),
}
MARK = re.compile(r"(<!-- @partial:(?P<name>[\w-]+) -->)(.*?)(<!-- /@partial:(?P=name) -->)", re.S)
ATTR = re.compile(r'(\s(?:href|src|srcset)=)(["\'])([^"\']*)\2')

def absolutize(html):
    def repl(match):
        prefix, quote, url = match.group(1), match.group(2), match.group(3)
        if not url or url.startswith(("/", "#", "mailto:", "tel:", "http://", "https://", "data:")):
            return match.group(0)
        return f"{prefix}{quote}/{url}{quote}"
    return ATTR.sub(repl, html)

def render(name, page_key, absolute, _depth=0):
    html = (PARTIALS / f"{name}.html").read_text()
    # One level of nesting, so head partials can include business-jsonld.
    if _depth < 2:
        def nest(m, page_key=page_key, absolute=absolute, _depth=_depth):
            inner = render(m.group("name"), page_key, absolute, _depth + 1)
            return m.group(1) + "\n" + inner.rstrip() + "\n  " + m.group(4)
        html = MARK.sub(nest, html)
    if page_key:
        html = re.sub(
            rf'(<a [^>]*data-nav="{page_key}")',
            r'\1 aria-current="page"',
            html,
        )
    if absolute:
        html = absolutize(html)
    return html

changed = 0
for page, (key, absolute) in PAGES.items():
    path = ROOT / page
    if not path.exists():
        print(f"skip (missing): {page}")
        continue
    src = path.read_text()
    out = MARK.sub(lambda m, key=key, absolute=absolute: m.group(1) + "\n" + render(m.group("name"), key, absolute).rstrip() + "\n  " + m.group(4), src)
    if out != src:
        path.write_text(out)
        changed += 1
    names = sorted(set(m.group("name") for m in MARK.finditer(out)))
    print(f"{page:15} partials: {', '.join(names)}")
print(f"updated {changed} file(s)")
