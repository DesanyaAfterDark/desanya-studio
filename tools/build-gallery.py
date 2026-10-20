#!/usr/bin/env python3
"""Rebuild the gallery grid from gallery/items.json.

Add a piece to gallery/items.json, then run:

    python3 tools/build-gallery.py

Group names are A–Z. Finished pieces inside a group are A–Z by title.
A series is ordered by episode number (Ep. 01 before Ep. 02).
Coming-soon placeholders follow the finished pieces in that group.
The generated HTML is committed. GitHub Pages does not run this script.
"""

import html
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "gallery" / "items.json"
PAGE = ROOT / "gallery.html"
MARK = re.compile(
    r"(<!-- @gallery -->)(.*?)(<!-- /@gallery -->)",
    re.S,
)
SIZES = "(max-width: 639px) 92vw, (max-width: 959px) 46vw, 340px"


def esc(value):
    return html.escape(str(value), quote=True)


def local_path(url):
    return ROOT / url.split("?", 1)[0].lstrip("/")


def require_file(url, label):
    if url.startswith("http://") or url.startswith("https://"):
        return
    path = local_path(url)
    if not path.is_file():
        raise SystemExit(f"missing file for {label}: {url}")


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


def logo_background(item):
    """Edge color of an opaque logo. A transparent badge uses the card color."""
    try:
        from PIL import Image
    except ImportError:
        return "var(--bg-card)"
    image = Image.open(local_path(item["image"])).convert("RGBA")
    width, height = image.size
    points = []
    step_x = max(1, width // 30)
    step_y = max(1, height // 30)
    samples = []
    for x in range(0, width, step_x):
        samples.append((x, min(2, height - 1)))
        samples.append((x, max(0, height - 3)))
    for y in range(0, height, step_y):
        samples.append((min(2, width - 1), y))
        samples.append((max(0, width - 3), y))
    for x, y in samples:
        red, green, blue, alpha = image.getpixel((x, y))
        if alpha < 200:
            continue
        points.append((red // 8 * 8, green // 8 * 8, blue // 8 * 8))
    if len(points) < 8:
        return "var(--bg-card)"
    buckets = {}
    for key in points:
        buckets[key] = buckets.get(key, 0) + 1
    red, green, blue = max(buckets, key=buckets.get)
    return f"#{red:02x}{green:02x}{blue:02x}"


def webp_sibling(url):
    """A same-name .webp next to a JPEG or PNG, when that file is on disk."""
    if not url or url.startswith("http://") or url.startswith("https://"):
        return ""
    path = url.split("?", 1)[0]
    if path.lower().endswith(".webp"):
        return url
    sibling = str(Path(path).with_suffix(".webp"))
    if (ROOT / sibling).is_file():
        return sibling
    return ""


def viewer_webp(item):
    """Widest WebP for the viewer. A 720 file can be wider than a 512 icon WebP."""
    webp = item.get("webp") or ""
    webp720 = item.get("webp720") or ""
    if webp and webp720:
        full_w = int(item.get("webpWidth") or item["width"])
        return webp if full_w > 720 else webp720
    return webp or webp720 or webp_sibling(item.get("href") or item.get("zoomHref") or "")


def webp_attr(url):
    found = url if str(url).lower().split("?", 1)[0].endswith(".webp") else webp_sibling(url)
    if not found:
        return ""
    return f' data-webp="{esc(found)}"'


def frame_markup(item, lazy, sizes=None):
    classes = "gallery-frame"
    style = ""
    if is_logo(item):
        classes += " gallery-frame--logo"
        style = f' style="--frame-bg: {logo_background(item)}"'
    return (
        f'            <span class="{classes}"{style}>\n'
        f"              {picture(item, lazy, sizes)}\n"
        "            </span>"
    )


def picture(item, lazy, sizes=None):
    sizes = sizes or SIZES
    webp = item.get("webp")
    source = ""
    if webp:
        width = int(item.get("webpWidth") or item["width"])
        webp720 = item.get("webp720")
        if webp720 and webp720.split("?", 1)[0] != webp.split("?", 1)[0]:
            source = (
                f'<source type="image/webp" srcset="{esc(webp720)} 720w, '
                f'{esc(webp)} {width}w" sizes="{esc(sizes)}">'
            )
        else:
            source = (
                f'<source type="image/webp" srcset="{esc(webp)} {width}w" '
                f'sizes="{esc(sizes)}">'
            )
    loading = ' loading="lazy"' if lazy else ' fetchpriority="high"'
    return (
        "<picture>\n"
        f"                {source}\n"
        f'                <img src="{esc(item["image"])}" alt="{esc(item["alt"])}" '
        f'width="{int(item["width"])}" height="{int(item["height"])}"'
        f"{loading} decoding=\"async\">\n"
        "              </picture>"
    )


def outbound_links(item):
    parts = []
    for link in item.get("links") or []:
        parts.append(
            f'            <a class="gallery-steps" href="{esc(link["href"])}" '
            f'target="_blank" rel="noopener">{esc(link["label"])}</a>'
        )
    if not parts:
        return ""
    return "\n" + "\n".join(parts)


def hidden_frame(frame, lb_set):
    return (
        f'<a class="visually-hidden" href="{esc(frame["href"])}" data-lightbox '
        f'data-lb-set="{esc(lb_set)}" data-caption="{esc(frame["caption"])}" '
        f'tabindex="-1" data-alt="{esc(frame["alt"])}" '
        f'aria-label="{esc(frame["alt"])}"{webp_attr(frame["href"])}></a>'
    )


def card(item, lazy):
    if item.get("placeholder"):
        return (
            '          <li class="gallery-card gallery-card--placeholder">\n'
            '            <div class="gallery-ph">\n'
            '              <span class="gallery-ph-icon" aria-hidden="true">◐</span>\n'
            f'              <span class="gallery-title">{esc(item["title"])}</span>\n'
            f'              <span class="gallery-tag">{esc(item["tag"])}</span>\n'
            "            </div>\n"
            "          </li>"
        )

    meta = (
        '            <span class="gallery-meta">\n'
        f'              <span class="gallery-title">{esc(item["title"])}</span>\n'
        f'              <span class="gallery-tag">{esc(item["tag"])}</span>\n'
    )
    if item.get("description"):
        meta += f'              <span class="gallery-desc">{esc(item["description"])}</span>\n'
    meta += "            </span>"
    frame = frame_markup(item, lazy)

    if item.get("external"):
        place = "YouTube" if "youtu" in item["external"].lower() else "Instagram"
        label = f'{item["title"]} on {place}, opens in a new tab'
        body = (
            f'            <a class="gallery-link" href="{esc(item["external"])}" '
            f'target="_blank" rel="noopener" aria-label="{esc(label)}">\n'
            f"{frame}\n{meta}\n"
            "            </a>"
        )
        extra = ""
        if item.get("zoomHref"):
            zoom_webp = viewer_webp(item)
            zoom_attr = f' data-webp="{esc(zoom_webp)}"' if zoom_webp else ""
            extra += (
                f'\n            <a class="gallery-zoom" href="{esc(item["zoomHref"])}" '
                f'data-lightbox data-alt="{esc(item.get("zoomAlt") or item["alt"])}" '
                f'data-caption="{esc(item.get("zoomCaption") or item["title"])}"'
                f'{zoom_attr} aria-label="View larger">⤢</a>'
            )
        if item.get("stepsHref"):
            extra += (
                f'\n            <a class="gallery-steps" href="{esc(item["stepsHref"])}">'
                f'{esc(item["stepsLabel"])}</a>'
            )
        return f'          <li class="gallery-card gallery-card--reel">\n{body}{extra}\n          </li>'

    lb = item.get("lbSet") or ""
    lb_attr = f' data-lb-set="{esc(lb)}"' if lb else ""
    view = viewer_webp(item)
    view_attr = f' data-webp="{esc(view)}"' if view else ""
    body = (
        f'            <a class="gallery-link" href="{esc(item["href"])}" data-lightbox'
        f'{lb_attr} data-caption="{esc(item["caption"])}"{view_attr}>\n'
        f"{frame}\n{meta}\n"
        "            </a>"
    )
    frames = "\n".join(
        "            " + hidden_frame(frame_item, lb)
        for frame_item in item.get("frames") or []
    )
    if frames:
        frames = "\n" + frames
    return f'          <li class="gallery-card">\n{body}{frames}{outbound_links(item)}\n          </li>'


def cover_href(item):
    if item.get("href"):
        return item["href"]
    return item.get("zoomHref") or item["image"]


def cover_caption(item):
    return item.get("caption") or item.get("zoomCaption") or item["title"]


def cover_thumb(item):
    return item.get("webp720") or item.get("webp") or item["image"]


def best_html(data, by_id, lazy_state):
    titles = data.get("bestOf") or []
    if not titles:
        return ""
    by_title = {item["title"]: item for item in data["items"]}
    total = len(titles)
    cards = []
    for index, title in enumerate(titles):
        item = by_title[title]
        distance = min(index, total - index)
        near = distance <= 2
        thumb = cover_thumb(item)
        src_attr = f'src="{esc(thumb)}"' if near else f'data-src="{esc(thumb)}"'
        priority = ""
        if index == 0:
            priority = ' fetchpriority="high"'
            lazy_state["used"] = True
        view = viewer_webp(item)
        view_attr = f' data-webp="{esc(view)}"' if view else ""
        cards.append(
            f'        <a class="cover-card" data-cover-card href="{esc(cover_href(item))}" '
            f'data-lightbox data-lb-set="best-of" data-caption="{esc(cover_caption(item))}" '
            f'data-alt="{esc(item["alt"])}"{view_attr}>\n'
            f'          <img {src_attr} alt="" width="{int(item["width"])}" height="{int(item["height"])}"'
            f'{priority} decoding="async">\n'
            f'          <span>{esc(item["title"])}</span>\n'
            "        </a>"
        )
    return "\n".join([
        '    <section class="gallery-cover" aria-labelledby="gallery-best-heading">',
        '      <h2 id="gallery-best-heading">Best of</h2>',
        "      <p>Eight pieces in a row. Swipe, or use the arrow keys. The centre piece opens full size.</p>",
        '      <div class="cover-clip">',
        '      <div class="cover-stage" data-cover tabindex="0" aria-roledescription="carousel" aria-label="Best pieces">',
        *cards,
        '        <div class="cover-nav">',
        '          <button type="button" data-cover-prev aria-label="Previous piece">‹</button>',
        '          <button type="button" data-cover-next aria-label="Next piece">›</button>',
        "        </div>",
        "      </div>",
        "      </div>",
        '      <p class="visually-hidden" data-cover-live aria-live="polite"></p>',
        "    </section>",
    ])


def group_html(group, items, lazy_state):
    parts = [
        f'    <section class="gallery-group" id="{esc(group["id"])}" '
        f'data-gallery-group="{esc(group["id"])}" '
        f'aria-labelledby="gallery-{esc(group["id"])}">',
        '      <header class="gallery-group-head">',
        f'        <h2 id="gallery-{esc(group["id"])}">{esc(group["name"])}</h2>',
    ]
    if group.get("lede"):
        parts.append(f'        <p>{esc(group["lede"])}</p>')
    if group.get("note"):
        parts.append(f'        <p>{esc(group["note"])}</p>')
    if group.get("specs"):
        parts.append('        <ul class="gallery-specs" aria-label="Project details">')
        for spec in group["specs"]:
            parts.append(f"          <li>{esc(spec)}</li>")
        parts.append("        </ul>")
    parts.append("      </header>")
    parts.append('      <ul class="gallery-grid">')
    for item in items:
        lazy = lazy_state["used"]
        lazy_state["used"] = True
        parts.append(card(item, lazy=lazy))
    parts.append("      </ul>")
    parts.append("    </section>")
    return "\n".join(parts)


def schema(items):
    elements = []
    position = 1
    for item in items:
        if item.get("placeholder"):
            continue
        url = item.get("external") or item.get("href")
        if url.startswith("assets/"):
            url = "https://desanya.tech/" + url
        elements.append({
            "@type": "ListItem",
            "position": position,
            "name": item["title"],
            "url": url,
        })
        position += 1
    data = {
        "@context": "https://schema.org",
        "@type": "ImageGallery",
        "name": "Illustration & visuals",
        "url": "https://desanya.tech/gallery.html",
        "mainEntity": {
            "@type": "ItemList",
            "itemListOrder": "https://schema.org/ItemListOrderAscending",
            "itemListElement": elements,
        },
    }
    return (
        '    <script type="application/ld+json">\n'
        + json.dumps(data, indent=2, ensure_ascii=False)
        + "\n    </script>"
    )


def load():
    data = json.loads(DATA.read_text())
    groups = data["groups"]
    items = data["items"]
    by_id = {}
    for group in groups:
        if group["id"] in by_id:
            raise SystemExit(f"duplicate group id: {group['id']}")
        by_id[group["id"]] = group
    seen = set()
    for item in items:
        title = item["title"]
        if title in seen:
            raise SystemExit(f"duplicate title: {title}")
        seen.add(title)
        if item["group"] not in by_id:
            raise SystemExit(f"unknown group for {title}: {item['group']}")
        if item.get("series") and item.get("episode") is None:
            raise SystemExit(f"series needs an episode number: {title}")
        if item.get("placeholder"):
            continue
        if item.get("external"):
            require_file(item["image"], title)
            if item.get("webp"):
                require_file(item["webp"], title)
            if item.get("webp720"):
                require_file(item["webp720"], title)
            if item.get("zoomHref"):
                require_file(item["zoomHref"], title)
            if not item["external"].startswith("https://"):
                raise SystemExit(f"external link must be https: {title}")
        else:
            for key in ("href", "image"):
                require_file(item[key], title)
            if item.get("webp"):
                require_file(item["webp"], title)
            if item.get("webp720"):
                require_file(item["webp720"], title)
        for frame in item.get("frames") or []:
            require_file(frame["href"], title + " frame")
        for link in item.get("links") or []:
            href = link.get("href") or ""
            if not href.startswith("https://"):
                raise SystemExit(f"outbound link must be https: {title}")
            if not link.get("label"):
                raise SystemExit(f"outbound link needs a label: {title}")
    for title in data.get("bestOf") or []:
        match = next((item for item in items if item["title"] == title), None)
        if match is None:
            raise SystemExit(f"bestOf title missing: {title}")
        if match.get("placeholder"):
            raise SystemExit(f"bestOf cannot be a placeholder: {title}")
    groups.sort(key=lambda group: group["name"].casefold())
    return data, groups, by_id


def render(data, groups, by_id):
    buttons = ['      <button type="button" data-filter="all" aria-pressed="true">All</button>']
    for group in groups:
        buttons.append(
            f'      <button type="button" data-filter="{esc(group["id"])}" '
            f'aria-pressed="false">{esc(group["name"])}</button>'
        )
    lazy_state = {"used": False}
    blocks = []
    best = best_html(data, by_id, lazy_state)
    if best:
        blocks.append(best)
    blocks.extend([
        '    <nav class="gallery-filters" data-gallery-filters aria-label="Gallery groups">',
        "\n".join(buttons),
        "    </nav>",
        '    <p class="visually-hidden" data-gallery-live aria-live="polite"></p>',
    ])
    ordered = []
    for group in groups:
        members = [item for item in data["items"] if item["group"] == group["id"]]
        members.sort(key=item_key)
        if not members:
            continue
        ordered.extend(members)
        blocks.append(group_html(group, members, lazy_state))
    commission = data["commission"]
    blocks.append(
        '    <aside class="gallery-commission">\n'
        f'      <a class="gallery-cta" href="{esc(commission["href"])}">\n'
        '        <span class="gallery-cta-arrow" aria-hidden="true">→</span>\n'
        f'        <span class="gallery-title">{esc(commission["title"])}</span>\n'
        f'        <span class="gallery-tag">{esc(commission["tag"])}</span>\n'
        "      </a>\n"
        "    </aside>"
    )
    blocks.append(schema(ordered))
    body = "\n".join(blocks)
    return (
        '<section class="page-section page-section--flush-top" aria-label="Gallery">\n'
        '      <div class="container">\n'
        + body
        + "\n      </div>\n"
        "    </section>"
    )


def main():
    data, groups, by_id = load()
    page = PAGE.read_text()
    match = MARK.search(page)
    if not match:
        raise SystemExit("gallery markers missing in gallery.html")
    replacement = match.group(1) + "\n" + render(data, groups, by_id) + "\n    " + match.group(3)
    PAGE.write_text(page[:match.start()] + replacement + page[match.end():])
    print(f"updated {PAGE.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
