# 출처: https://github.com/tsungmnli/skku-notice-api/blob/main/app/crawler/parser.py
"""Parse one SKKU CMS list page without network access."""

import re
from dataclasses import dataclass
from datetime import date
from html import escape, unescape
from urllib.parse import parse_qs, urljoin, urlsplit

import nh3
from selectolax.lexbor import LexborHTMLParser, LexborNode

from skku_notice.model import Notice

ROW_SELECTOR = "ul.board-list-wrap > li"
TITLE_SELECTOR = "dt.board-list-content-title"
LINK_SELECTOR = "a[href]"
CATEGORY_SELECTOR = ".c-board-list-category"
INFO_SELECTOR = "dd.board-list-content-info li"
DATE_RE = re.compile(r"\d{4}-\d{2}-\d{2}")
DETAIL_SELECTORS = ("dl.board-write-box dd", ".board-view-content-wrap")
ATTACHMENT_SELECTOR = ".filedown_list a[href*='mode=download'], .board-view-box a[href*='mode=download']"
BLOCK_TAGS = {"p", "div", "li", "tr", "h1", "h2", "h3", "h4", "h5", "h6", "br"}
HTML_TAGS = {"p", "br", "strong", "b", "em", "i", "u", "ul", "ol", "li", "table", "thead",
             "tbody", "tr", "th", "td", "a", "img", "h1", "h2", "h3", "h4", "blockquote",
             "hr", "span", "div"}
HTML_ATTRIBUTES = {"a": {"href"}, "img": {"src", "alt"},
                   "td": {"colspan", "rowspan"}, "th": {"colspan", "rowspan"}}
URL_RE = re.compile(r"https?://[^\s<>\"']+")
SIZE_RE = re.compile(r"\b\d+(?:\.\d+)?\s*(?:[KMGT]?B|바이트)\b", re.I)


@dataclass(frozen=True)
class Detail:
    body_text: str
    attachments: tuple[tuple[str, str, str, str | None], ...]
    images: tuple[str, ...]
    body_html: str = ""


class ParseError(ValueError):
    """The board list has unexpected markup or missing required data."""


def _clean(node: LexborNode) -> str:
    return " ".join(node.text(separator=" ").replace("\ufeff", "").replace("\u200b", "").split())


def _parse_row(row: LexborNode, source_id: str, board_url: str) -> Notice:
    title_node = row.css_first(TITLE_SELECTOR)
    link = title_node.css_first(LINK_SELECTOR) if title_node else None
    if link is None:
        raise ParseError("row without title link")
    href = link.attributes.get("href", "")
    article_no = parse_qs(urlsplit(urljoin(board_url, href)).query).get("articleNo", [""])[0]
    title = _clean(link)
    if not article_no.isdecimal() or not title:
        raise ParseError("row without articleNo or title")
    info = row.css(INFO_SELECTOR)
    if len(info) < 3:
        raise ParseError(f"article {article_no}: missing date column")
    date_text = _clean(info[2])
    found = DATE_RE.search(date_text)
    if not found:
        raise ParseError(f"article {article_no}: invalid date {date_text!r}")
    try:
        posted_on = date.fromisoformat(found.group())
    except ValueError as exc:
        raise ParseError(f"article {article_no}: invalid date {date_text!r}") from exc
    category_node = title_node.css_first(CATEGORY_SELECTOR)
    category = _clean(category_node).strip("[] ") if category_node else None
    pinned = "board-list-content-top" in title_node.attributes.get("class", "").split()
    base = board_url.split("?", 1)[0]
    return Notice(
        source_id, article_no, title, category, f"{base}?mode=view&articleNo={article_no}", posted_on, pinned
    )


def parse_list(html: str, source_id: str, board_url: str) -> list[Notice]:
    tree = LexborHTMLParser(html)
    if tree.css_first("ul.board-list-wrap") is None:
        raise ParseError("ul.board-list-wrap not found")
    rows = [row for row in tree.css(ROW_SELECTOR) if row.css_first("dl.board-list-content-wrap")]
    if not rows:
        raise ParseError("board list has no articles")
    return [_parse_row(row, source_id, board_url) for row in rows]


def _body(node: LexborNode) -> str:
    if node.tag in {"script", "style"}:
        return ""
    if node.tag == "-text":
        return node.text().replace("\ufeff", "").replace("\u200b", "").replace("\xa0", " ")
    parts = []
    child = node.child
    while child:
        parts.append(_body(child))
        child = child.next
    value = "".join(parts)
    if node.tag in BLOCK_TAGS:
        value += "\n"
    return value


def _image_url(src: str, base_url: str) -> str | None:
    url = urljoin(base_url, src.strip())
    path = urlsplit(url).path.lower()
    if (urlsplit(url).scheme not in {"http", "https"}
            or re.search(r"/_res/[^/]+/img/common/", path)
            or re.search(r"(?:^|[/_-])(?:sns|icon|ico)(?:[/_.-]|$)", path)):
        return None
    return url


def _pre_html(value: str) -> str:
    lines = value.splitlines()
    parts = []
    listing = False
    for line in lines:
        stripped = line.strip()
        if not stripped:
            if listing:
                parts.append("</ul>")
                listing = False
            continue
        is_list = stripped.startswith("- ")
        if is_list and not listing:
            parts.append("<ul>")
            listing = True
        elif not is_list and listing:
            parts.append("</ul>")
            listing = False
        content = stripped[2:] if is_list else stripped
        cursor = 0
        linked_parts = []
        for match in URL_RE.finditer(content):
            linked_parts.append(escape(content[cursor:match.start()]))
            linked_parts.append(f'<a href="{escape(match.group(), quote=True)}">{escape(match.group())}</a>')
            cursor = match.end()
        linked_parts.append(escape(content[cursor:]))
        linked = "".join(linked_parts)
        parts.append(f"<li>{linked}</li>" if is_list else f"<p>{linked}</p>")
    if listing:
        parts.append("</ul>")
    return "".join(parts)


def _html_body(body: LexborNode, base_url: str) -> str:
    markup = re.sub(r"<pre\b[^>]*>(.*?)</pre>",
                    lambda match: _pre_html(unescape(match.group(1))), body.html, flags=re.I | re.S)
    fragment = LexborHTMLParser(markup)
    for node in fragment.css("a[href], img[src]"):
        attr = "href" if node.tag == "a" else "src"
        raw = node.attrs.get(attr, "").strip()
        url = urljoin(base_url, raw)
        if urlsplit(url).scheme not in {"http", "https", "mailto"} or (node.tag == "img" and
                _image_url(raw, base_url) is None):
            if node.tag == "img":
                node.decompose()
            else:
                del node.attrs[attr]
            continue
        node.attrs[attr] = url
    result = nh3.clean(fragment.body.html if fragment.body else fragment.html,
                       tags=HTML_TAGS, attributes=HTML_ATTRIBUTES,
                       url_schemes={"http", "https", "mailto"}, clean_content_tags={"script", "style"},
                       link_rel=None)
    return re.sub(r"<p>\s*(?:&nbsp;|<br\s*/?>)*\s*</p>", "", result, flags=re.I).strip()


def parse_detail(html: str, base_url: str) -> Detail:
    tree = LexborHTMLParser(html)
    body = next((tree.css_first(selector) for selector in DETAIL_SELECTORS if tree.css_first(selector)), None)
    if body is None:
        raise ParseError("detail body not found")
    raw = _body(body).replace("\r\n", "\n").replace("\r", "\n")
    lines = [" ".join(line.split()) for line in raw.split("\n")]
    cleaned = []
    for line in lines:
        if line or (cleaned and cleaned[-1]):
            cleaned.append(line)
    text = "\n".join(cleaned).strip()
    attachments = tuple(
        (_clean(link), urljoin(base_url, link.attributes["href"]),
         _clean(link).rsplit(".", 1)[-1].upper() if "." in _clean(link) else "",
         (size.group().replace(" ", "") if (size := SIZE_RE.search(_clean(link.parent))) else None))
        for link in tree.css(ATTACHMENT_SELECTOR)
        if _clean(link)
    )
    images = []
    for image in body.css("img[src]"):
        src = image.attributes["src"].strip()
        if not src:
            continue
        url = _image_url(src, base_url)
        if url is None or url in images:
            continue
        images.append(url)
        if len(images) == 10:
            break
    return Detail(text, attachments, tuple(images), _html_body(body, base_url))


def parse_external_fragment(markup: str, base_url: str) -> Detail:
    """Parse a public external posting using the same HTML and URL sanitization as school notices."""
    body = LexborHTMLParser(markup).body
    if body is None:
        raise ParseError("external detail body not found")
    text = "\n".join(" ".join(line.split()) for line in _body(body).splitlines()).strip()
    images = []
    for image in body.css("img[src]"):
        url = _image_url(image.attributes["src"], base_url)
        if url and url not in images:
            images.append(url)
            if len(images) == 10:
                break
    cleaned = _html_body(body, base_url)
    if not text and not images:
        raise ParseError("external detail body empty")
    return Detail(text, (), tuple(images), cleaned)
