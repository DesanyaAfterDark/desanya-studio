#!/usr/bin/env python3
"""Write the three noindex gallery style previews from gallery/items.json.

    python3 tools/build-gallery-previews.py

The pages stay out of the nav and the sitemap. They are style studies.
"""

import html
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "gallery" / "items.json"

PAGES = {
    "showcase": (
        "gallery-preview-showcase.html",
        "Showcase preview",
        "A large hero of the best pieces, a thumbnail strip, and a swipeable row for each group.",
    ),
    "masonry": (
        "gallery-preview-masonry.html",
        "Masonry preview",
        "A wall at each piece’s true shape. Hover or tap reveals the title and group, then the viewer.",
    ),
    "carousel": (
        "gallery-preview-carousel.html",
        "Carousel preview",
        "A coverflow of the best pieces, with each group in a row underneath.",
    ),
}


def esc(value):
    return html.escape(str(value), quote=True)


def item_key(item):
    pending = 1 if item.get("placeholder") else 0
    if item.get("series"):
        return (
            pending,
            item["series"].casefold(),
            int(item["episode"]),
            item["title"].casefold(),
        )
    return (pending, item["title"].casefold(), 0, "")


def is_logo(item):
    fit = item.get("fit")
    if fit == "logo":
        return True
    if fit == "cover":
        return False
    return item.get("group") == "client-logos"


def thumb(item):
    return item.get("webp720") or item.get("webp") or item["image"]


def viewer(item):
    webp = item.get("webp") or ""
    webp720 = item.get("webp720") or ""
    if webp and webp720:
        full_w = int(item.get("webpWidth") or item["width"])
        return webp if full_w > 720 else webp720
    return webp or webp720 or item.get("image")


def load():
    data = json.loads(DATA.read_text())
    groups = sorted(data["groups"], key=lambda group: group["name"].casefold())
    by_title = {item["title"]: item for item in data["items"]}
    best = []
    for title in data.get("bestOf") or []:
        item = by_title.get(title)
        if not item or item.get("placeholder"):
            raise SystemExit(f"bestOf title missing: {title}")
        best.append(item)
    sections = []
    for group in groups:
        members = [item for item in data["items"] if item["group"] == group["id"]]
        members.sort(key=item_key)
        members = [item for item in members if not item.get("placeholder")]
        if members:
            sections.append((group, members))
    return best, sections


def attrs(item, set_name):
    caption = item.get("caption") or item.get("zoomCaption") or item["title"]
    return (
        f'data-pv-open data-pv-set="{esc(set_name)}" '
        f'data-pv-src="{esc(viewer(item))}" '
        f'data-pv-alt="{esc(item["alt"])}" '
        f'data-pv-caption="{esc(caption)}"'
    )


def row(group, members):
    cards = []
    for item in members:
        logo = " fit-logo" if is_logo(item) else ""
        cards.append(
            "        <li>\n"
            f'          <button type="button" class="pv-tile" {attrs(item, group["id"])}>\n'
            f'            <img src="{esc(thumb(item))}" alt="" width="{int(item["width"])}" '
            f'height="{int(item["height"])}" class="{logo.strip()}" loading="lazy" decoding="async">\n'
            f'            <span>{esc(item["title"])}</span>\n'
            "          </button>\n"
            "        </li>"
        )
    return (
        f'    <section class="pv-section" aria-labelledby="group-{esc(group["id"])}">\n'
        f'      <h2 class="pv-section-title" id="group-{esc(group["id"])}">{esc(group["name"])}</h2>\n'
        '      <ul class="pv-row">\n'
        + "\n".join(cards)
        + "\n      </ul>\n"
        "    </section>"
    )


def hero(best):
    slides = []
    tabs = []
    for index, item in enumerate(best):
        hidden = "" if index == 0 else " hidden"
        loading = ' fetchpriority="high"' if index == 0 else ' loading="lazy"'
        group_name = item.get("_group_name", "")
        slides.append(
            f'        <button type="button" class="pv-hero-slide" data-hero-slide{hidden} {attrs(item, "best")}>\n'
            f'          <img src="{esc(thumb(item))}" alt="{esc(item["alt"])}" '
            f'width="{int(item["width"])}" height="{int(item["height"])}"{loading} decoding="async">\n'
            '          <span class="pv-hero-copy">\n'
            f'            <span class="pv-kicker">{esc(group_name)}</span>\n'
            f'            <strong>{esc(item["title"])}</strong>\n'
            "          </span>\n"
            "        </button>"
        )
        tabs.append(
            f'        <button type="button" data-hero-tab="{index}" role="tab" '
            f'aria-selected="{"true" if index == 0 else "false"}" '
            f'aria-label="{esc(item["title"])}">\n'
            f'          <img src="{esc(thumb(item))}" alt="" width="72" height="72" loading="lazy" decoding="async">\n'
            "        </button>"
        )
    return (
        '    <section class="pv-hero" data-showcase aria-roledescription="carousel" aria-label="Best pieces">\n'
        '      <div class="pv-hero-stage">\n'
        + "\n".join(slides)
        + '\n        <div class="pv-hero-nav">\n'
        '          <button type="button" data-hero-prev aria-label="Previous piece">‹</button>\n'
        '          <button type="button" data-hero-next aria-label="Next piece">›</button>\n'
        "        </div>\n"
        "      </div>\n"
        '      <div class="pv-strip" role="tablist" aria-label="Best pieces">\n'
        + "\n".join(tabs)
        + "\n      </div>\n"
        "    </section>"
    )


def masonry(sections):
    cards = []
    first = True
    for group, members in sections:
        for item in members:
            loading = ' fetchpriority="high"' if first else ' loading="lazy"'
            first = False
            cards.append(
                '      <figure class="masonry-card">\n'
                f'        <button type="button" class="masonry-hit" {attrs(item, group["id"])}>\n'
                f'          <img src="{esc(thumb(item))}" alt="{esc(item["alt"])}" '
                f'width="{int(item["width"])}" height="{int(item["height"])}"{loading} decoding="async">\n'
                '          <span class="masonry-meta">\n'
                f'            <span class="pv-kicker">{esc(group["name"])}</span>\n'
                f'            <strong>{esc(item["title"])}</strong>\n'
                "          </span>\n"
                "        </button>\n"
                "      </figure>"
            )
    return '    <div class="masonry">\n' + "\n".join(cards) + "\n    </div>"


def coverflow(best):
    cards = []
    n = len(best)
    for index, item in enumerate(best):
        # Center, plus two on either side, including the wrap from the end.
        distance = min((index - 0) % n, (0 - index) % n)
        src_attr = f'src="{esc(thumb(item))}"' if distance <= 2 else f'data-src="{esc(thumb(item))}"'
        cards.append(
            f'        <button type="button" class="cover-card" data-cover-card {attrs(item, "best")}>\n'
            f"          <img {src_attr} alt=\"\" width=\"{int(item['width'])}\" "
            f'height="{int(item["height"])}" decoding="async">\n'
            f'          <span>{esc(item["title"])}</span>\n'
            "        </button>"
        )
    return (
        '    <section class="cover-stage" data-cover tabindex="0" '
        'aria-roledescription="carousel" aria-label="Best pieces">\n'
        + "\n".join(cards)
        + '\n      <div class="cover-nav">\n'
        '        <button type="button" data-cover-prev aria-label="Previous piece">‹</button>\n'
        '        <button type="button" data-cover-next aria-label="Next piece">›</button>\n'
        "      </div>\n"
        "    </section>"
    )


def lightbox():
    return """    <dialog class="pv-lightbox" data-pv-lightbox aria-label="Image viewer">
      <div class="pv-lb-inner">
        <button type="button" class="pv-lb-btn pv-lb-close" data-pv-close aria-label="Close viewer">×</button>
        <button type="button" class="pv-lb-btn pv-lb-prev" data-pv-prev aria-label="Previous image">‹</button>
        <figure class="pv-lb-figure">
          <img alt="" decoding="async">
          <figcaption data-pv-cap></figcaption>
          <p class="pv-lb-count" data-pv-count></p>
        </figure>
        <button type="button" class="pv-lb-btn pv-lb-next" data-pv-next aria-label="Next image">›</button>
      </div>
    </dialog>"""


def page(kind, best, sections):
    filename, title, lede = PAGES[kind]
    by_id = {}
    for group, members in sections:
        by_id[group["id"]] = group["name"]
        for item in members:
            item["_group_name"] = group["name"]
    for item in best:
        item["_group_name"] = by_id.get(item["group"], "")
    if kind == "showcase":
        body = hero(best) + "\n" + "\n".join(row(group, members) for group, members in sections)
    elif kind == "masonry":
        body = masonry(sections)
    else:
        body = coverflow(best) + "\n" + "\n".join(row(group, members) for group, members in sections)
    doc = f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex">
  <title>{esc(title)} — Desanya Studio</title>
  <meta name="description" content="{esc(lede)}">
  <link rel="stylesheet" href="assets/gallery-preview.css">
</head>
<body>
  <header class="pv-top">
    <a href="gallery.html">Gallery</a>
    <p>{esc(title)}</p>
  </header>
  <main class="pv-wrap">
    <div class="pv-intro">
      <p class="pv-kicker">Style study</p>
      <h1>{esc(title)}</h1>
      <p>{esc(lede)} Same pieces as the gallery. This page is not in the site menu.</p>
    </div>
{body}
  </main>
{lightbox()}
  <script src="assets/gallery-preview.js" defer></script>
</body>
</html>
"""
    path = ROOT / filename
    path.write_text(doc)
    print(f"wrote {filename}")


def main():
    best, sections = load()
    for kind in PAGES:
        page(kind, best, sections)


if __name__ == "__main__":
    main()
