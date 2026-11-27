"""Notify Naver IndexNow of changed public URLs using the canonical sitemap only."""

import json
import os
import re
from pathlib import Path
from urllib.parse import parse_qs, urlsplit
from xml.etree import ElementTree as ET

import httpx

SITE = "https://skku-notice-platform.pages.dev"
ENDPOINT = "https://searchadvisor.naver.com/indexnow"
NS = {"s": "http://www.sitemaps.org/schemas/sitemap/0.9"}
MAX_PAGES = 100
MAX_URLS = 10000


def valid_notice_url(url: str) -> bool:
    if url == SITE + "/":
        return True
    parts = urlsplit(url)
    query = parse_qs(parts.query, strict_parsing=True)
    return (
        f"{parts.scheme}://{parts.netloc}" == SITE
        and parts.path == "/"
        and not parts.fragment
        and set(query) == {"notice"}
        and len(query["notice"]) == 1
        and re.fullmatch(r"[a-z0-9-]+/[0-9]+", query["notice"][0]) is not None
    )


def _xml(client: httpx.Client, url: str) -> ET.Element:
    response = client.get(url)
    response.raise_for_status()
    if len(response.content) > 4 * 1024 * 1024:
        raise ValueError("sitemap is too large")
    return ET.fromstring(response.content)


def read_sitemap(client: httpx.Client) -> dict[str, str]:
    root = _xml(client, SITE + "/sitemap.xml")
    pages = [root]
    if root.tag == "{" + NS["s"] + "}sitemapindex":
        links = [entry.findtext("s:loc", namespaces=NS) or "" for entry in root]
        if not links or len(links) > MAX_PAGES or len(links) != len(set(links)):
            raise ValueError("invalid sitemap index")
        # No arbitrary URLs or redirects, even if the remote XML is malformed.
        if any(
            not re.fullmatch(re.escape(SITE) + r"/sitemap\.xml\?page=(0|[1-9][0-9]{0,4})", link)
            for link in links
        ):
            raise ValueError("invalid sitemap page URL")
        pages = [_xml(client, link) for link in links]
    result = {}
    for page in pages:
        if page.tag != "{" + NS["s"] + "}urlset":
            raise ValueError("invalid sitemap root")
        for entry in page:
            url = entry.findtext("s:loc", namespaces=NS) or ""
            if not valid_notice_url(url) or url in result:
                raise ValueError("invalid canonical URL")
            result[url] = entry.findtext("s:lastmod", default="", namespaces=NS)
    if SITE + "/" not in result:
        raise ValueError("incomplete sitemap")
    return result


def run(client: httpx.Client, state_path: Path, key: str) -> tuple[int, int]:
    if not re.fullmatch(r"[a-fA-F0-9-]{8,128}", key):
        raise ValueError("invalid IndexNow configuration")
    current = read_sitemap(client)
    previous = json.loads(state_path.read_text()) if state_path.exists() else None
    if previous is not None and (
        not isinstance(previous, dict)
        or any(not valid_notice_url(url) or not isinstance(stamp, str) for url, stamp in previous.items())
    ):
        raise ValueError("invalid IndexNow snapshot")
    # Baseline existing notices. Only the newly revised homepage is sent on installation.
    changed = (
        [SITE + "/"]
        if previous is None
        else sorted(
            url
            for url in current.keys() | previous.keys()
            if url not in current or url not in previous or current[url] != previous[url]
        )
    )
    statuses = []
    for start in range(0, len(changed), MAX_URLS):
        response = client.post(
            ENDPOINT,
            json={
                "host": urlsplit(SITE).netloc,
                "key": key,
                "keyLocation": SITE + "/indexnow-key.txt",
                "urlList": changed[start : start + MAX_URLS],
            },
        )
        if response.status_code not in (200, 202):
            raise ValueError(f"IndexNow rejected request: HTTP {response.status_code}")
        statuses.append(response.status_code)
    state_path.parent.mkdir(parents=True, exist_ok=True)
    temporary = state_path.with_suffix(".tmp")
    temporary.write_text(json.dumps(current, ensure_ascii=False))
    temporary.replace(state_path)
    return len(changed), max(statuses, default=0)


def main() -> int:
    try:
        with httpx.Client(
            timeout=20, follow_redirects=False, headers={"User-Agent": "skku-notice-platform-indexnow/0.1"}
        ) as client:
            sent, status = run(
                client,
                Path(os.environ.get("INDEXNOW_STATE", "/var/lib/skku-indexnow/state.json")),
                os.environ.get("INDEXNOW_KEY", ""),
            )
        print(f"IndexNow: submitted={sent} http={status}", flush=True)
        return 0
    except (httpx.HTTPError, OSError, ValueError, ET.ParseError) as exc:
        # Never log the payload, the key or the original exception text.
        print(f"IndexNow: failed={type(exc).__name__}", flush=True)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
