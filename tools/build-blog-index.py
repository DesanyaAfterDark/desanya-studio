#!/usr/bin/env python3
"""Rebuild the blog index and the topic line on each post.

Edit blog/posts.json, then run:

    python3 tools/build-blog-index.py

Topics stay in A–Z order. Posts inside a topic stay in A–Z order.
Empty topics stay in the data file and are left off the page.
A Newest block is added only when at least one post is newer than another.
Existing post URLs are not changed.

Pagination is not generated. Add /blog/page/2/ with a self canonical only
after the index passes about 15 posts. Do not point later pages at /blog/.
"""

import html
import json
import re
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "blog" / "posts.json"
INDEX = ROOT / "blog" / "index.html"
INDEX_MARK = re.compile(
    r"(<!-- @blog-index -->)(.*?)(<!-- /@blog-index -->)",
    re.S,
)
TOPIC_MARK = re.compile(
    r'(<header class="post-intro container">\s*<nav class="crumbs"[\s\S]*?</nav>\s*)'
    r"(?:<!-- @blog-topic -->[\s\S]*?<!-- /@blog-topic -->\s*)?"
    r'(?:<p class="eyebrow">[\s\S]*?</p>\s*)?'
    r"(?=<h1>)",
)


def esc(value):
    return html.escape(value, quote=True)


def pretty_date(iso):
    return datetime.strptime(iso, "%Y-%m-%d").strftime("%B %-d, %Y")


def card(post, lazy):
    loading = ' loading="lazy"' if lazy else ""
    return (
        "          <li>\n"
        f'            <a class="post-card" href="/blog/{esc(post["slug"])}/">\n'
        "              <picture>\n"
        f'                <source type="image/webp" srcset="{esc(post["imageWebp"])}">\n'
        f'                <img src="{esc(post["image"])}" alt="{esc(post["imageAlt"])}" width="1600" height="900"{loading} decoding="async">\n'
        "              </picture>\n"
        '              <span class="post-card-body">\n'
        f'                <time class="post-card-date" datetime="{esc(post["date"])}">{esc(pretty_date(post["date"]))}</time>\n'
        f'                <span class="post-card-title">{esc(post["title"])}</span>\n'
        f'                <span class="post-card-excerpt">{esc(post["excerpt"])}</span>\n'
        "              </span>\n"
        "            </a>\n"
        "          </li>"
    )


def hero(post):
    return (
        '        <section class="featured-story" aria-labelledby="featured-heading">\n'
        '          <h2 id="featured-heading" class="featured-story-label">Featured story</h2>\n'
        f'          <a class="post-card post-card--hero" href="/blog/{esc(post["slug"])}/">\n'
        "            <picture>\n"
        f'              <source type="image/webp" srcset="{esc(post["imageWebp"])}">\n'
        f'              <img src="{esc(post["image"])}" alt="{esc(post["imageAlt"])}" width="1600" height="900" fetchpriority="high" decoding="async">\n'
        "            </picture>\n"
        '            <span class="post-card-body">\n'
        f'              <time class="post-card-date" datetime="{esc(post["date"])}">{esc(pretty_date(post["date"]))}</time>\n'
        f'              <span class="post-card-title">{esc(post["title"])}</span>\n'
        f'              <span class="post-card-excerpt">{esc(post["excerpt"])}</span>\n'
        '              <span class="post-card-more" aria-hidden="true">Read the story →</span>\n'
        "            </span>\n"
        "          </a>\n"
        "        </section>"
    )


def cards(posts, start_lazy):
    lines = []
    for index, post in enumerate(posts):
        lines.append(card(post, lazy=start_lazy or index > 0))
    return "\n".join(lines)


def load():
    data = json.loads(DATA.read_text())
    topics = data["topics"]
    posts = data["posts"]
    by_id = {}
    for topic in topics:
        if topic["id"] in by_id:
            raise SystemExit(f"duplicate topic id: {topic['id']}")
        by_id[topic["id"]] = topic
    seen = set()
    for post in posts:
        if post["slug"] in seen:
            raise SystemExit(f"duplicate slug: {post['slug']}")
        seen.add(post["slug"])
        if post["topic"] not in by_id:
            raise SystemExit(f"{post['slug']} uses unknown topic {post['topic']}")
        page = ROOT / "blog" / post["slug"] / "index.html"
        if not page.is_file():
            raise SystemExit(f"missing post page: {page.relative_to(ROOT)}")
        datetime.strptime(post["date"], "%Y-%m-%d")
    topics.sort(key=lambda topic: topic["name"].casefold())
    return topics, posts, by_id


def index_html(topics, posts):
    by_topic = {topic["id"]: [] for topic in topics}
    for post in posts:
        by_topic[post["topic"]].append(post)
    for group in by_topic.values():
        group.sort(key=lambda post: post["title"].casefold())

    visible = [topic for topic in topics if by_topic[topic["id"]]]
    parts = []

    dates = [post["date"] for post in posts]
    latest = max(dates) if dates else None
    newest = []
    if latest and any(date < latest for date in dates):
        newest = sorted(
            (post for post in posts if post["date"] == latest),
            key=lambda post: post["title"].casefold(),
        )
    featured = [post for post in posts if post.get("featured")]
    for post in featured:
        parts.append(hero(post))
    newest = [post for post in newest if not post.get("featured")]
    if newest:
        parts.append(
            '        <section class="newest-block" aria-labelledby="newest-heading">\n'
            '          <h2 id="newest-heading">Newest</h2>\n'
            '          <ul class="post-grid">\n'
            + cards(newest, start_lazy=False)
            + "\n          </ul>\n"
            "        </section>"
        )

    if len(visible) > 1:
        links = "\n".join(
            f'          <a href="#{esc(topic["id"])}">{esc(topic["name"])}</a>'
            for topic in visible
        )
        parts.append(
            '        <nav class="jump-links" aria-label="Topics">\n'
            + links
            + "\n        </nav>"
        )

    list_items = []
    position = 1
    for topic in visible:
        group = by_topic[topic["id"]]
        for post in group:
            list_items.append(
                "      {\n"
                '        "@type": "ListItem",\n'
                f'        "position": {position},\n'
                f'        "name": {json.dumps(post["title"])},\n'
                f'        "url": "https://desanya.tech/blog/{post["slug"]}/"\n'
                "      }"
            )
            position += 1
        parts.append(
            f'        <section class="topic-group" id="{esc(topic["id"])}" aria-labelledby="topic-{esc(topic["id"])}">\n'
            '          <header class="topic-group-head">\n'
            f'            <h2 id="topic-{esc(topic["id"])}">{esc(topic["name"])}</h2>\n'
            f'            <p class="topic-service"><a href="{esc(topic["serviceHref"])}">{esc(topic["serviceLabel"])}</a></p>\n'
            "          </header>\n"
            '          <ul class="post-grid">\n'
            + cards(group, start_lazy=bool(newest or featured))
            + "\n          </ul>\n"
            "        </section>"
        )

    schema = (
        '        <script type="application/ld+json">\n'
        "        {\n"
        '          "@context": "https://schema.org",\n'
        '          "@type": "CollectionPage",\n'
        '          "name": "Notes on websites, SEO, and content that works",\n'
        '          "url": "https://desanya.tech/blog/",\n'
        '          "mainEntity": {\n'
        '            "@type": "ItemList",\n'
        '            "itemListOrder": "https://schema.org/ItemListOrderAscending",\n'
        '            "itemListElement": [\n'
        + ",\n".join(list_items)
        + "\n            ]\n"
        "          }\n"
        "        }\n"
        "        </script>"
    )
    parts.append(schema)
    return "\n".join(parts) + "\n"


def topic_line(topic):
    return (
        "        <!-- @blog-topic -->\n"
        f'        <p class="post-topic"><a href="/blog/#{esc(topic["id"])}">{esc(topic["name"])}</a>'
        f' · <a href="{esc(topic["serviceHref"])}">{esc(topic["serviceLabel"])}</a></p>\n'
        "        <!-- /@blog-topic -->\n"
    )


def main():
    topics, posts, by_id = load()
    index = INDEX.read_text()
    if not INDEX_MARK.search(index):
        raise SystemExit("blog/index.html is missing <!-- @blog-index --> markers")
    updated = INDEX_MARK.sub(
        lambda match: match.group(1) + "\n" + index_html(topics, posts) + "        " + match.group(3),
        index,
        count=1,
    )
    INDEX.write_text(updated)
    print(f"updated {INDEX.relative_to(ROOT)}")

    for post in posts:
        path = ROOT / "blog" / post["slug"] / "index.html"
        text = path.read_text()
        topic = by_id[post["topic"]]
        new_text, count = TOPIC_MARK.subn(
            lambda match, topic=topic: match.group(1) + topic_line(topic),
            text,
            count=1,
        )
        if count != 1:
            raise SystemExit(f"could not place topic line in {path.relative_to(ROOT)}")
        path.write_text(new_text)
        print(f"updated {path.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
