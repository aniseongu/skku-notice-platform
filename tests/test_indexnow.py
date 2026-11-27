import json
from html import escape

import httpx
import pytest

from skku_notice.indexnow import ENDPOINT, SITE, read_sitemap, run


def sitemap(entries):
    return (
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'
        + "".join(
            f"<url><loc>{escape(url)}</loc><lastmod>{escape(stamp)}</lastmod></url>"
            for url, stamp in entries.items()
        )
        + "</urlset>"
    )


def test_baseline_only_home_then_new_changed_deleted_and_failure_retries(tmp_path):
    state = tmp_path / "state.json"
    entries = {SITE + "/": "", SITE + "/?notice=coop%2F1": "2026-11-27"}
    sent = []
    status = 200

    def handler(request):
        if request.method == "GET":
            return httpx.Response(200, text=sitemap(entries))
        assert str(request.url) == ENDPOINT
        sent.append(json.loads(request.content))
        return httpx.Response(status)

    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        assert run(client, state, "a" * 32) == (1, 200)
        assert sent[0]["urlList"] == [SITE + "/"]
        assert run(client, state, "a" * 32) == (0, 0)
        entries[SITE + "/?notice=school%2F2"] = "2026-11-28"
        entries[SITE + "/?notice=coop%2F1"] = "2026-11-28"
        status = 429
        before = state.read_bytes()
        with pytest.raises(ValueError):
            run(client, state, "a" * 32)
        assert state.read_bytes() == before
        status = 202
        assert run(client, state, "a" * 32) == (2, 202)
        del entries[SITE + "/?notice=coop%2F1"]
        assert run(client, state, "a" * 32) == (1, 202)
        assert sent[-1]["urlList"] == [SITE + "/?notice=coop%2F1"]


@pytest.mark.parametrize(
    "url",
    [
        "https://evil.test/",
        SITE + "/?code=private",
        SITE + "/?notice=school%2F1&code=private",
        SITE + "/?notice=bad",
    ],
)
def test_rejects_nonpublic_urls(url):
    with httpx.Client(
        transport=httpx.MockTransport(lambda r: httpx.Response(200, text=sitemap({SITE + "/": "", url: ""})))
    ) as client:
        with pytest.raises(ValueError):
            read_sitemap(client)


def test_sitemap_index_is_bounded_and_cannot_fetch_arbitrary_hosts():
    requested = []

    def handler(request):
        requested.append(str(request.url))
        return httpx.Response(
            200,
            text='<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><sitemap><loc>http://169.254.169.254/</loc></sitemap></sitemapindex>',
        )

    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        with pytest.raises(ValueError):
            read_sitemap(client)
    assert requested == [SITE + "/sitemap.xml"]


def test_reads_all_index_pages_and_aborts_snapshot_on_missing_page(tmp_path):
    state = tmp_path / "state.json"
    index = (
        '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'
        f"<sitemap><loc>{SITE}/sitemap.xml?page=0</loc></sitemap>"
        f"<sitemap><loc>{SITE}/sitemap.xml?page=1</loc></sitemap></sitemapindex>"
    )
    failure = False

    def handler(request):
        if request.url.query == b"page=0":
            return httpx.Response(
                200, text=sitemap({SITE + "/": "", SITE + "/?notice=school%2F1": "2026-11-27"})
            )
        if request.url.query == b"page=1":
            return httpx.Response(
                503 if failure else 200, text=sitemap({SITE + "/?notice=coop%2F1": "2026-11-27"})
            )
        if request.method == "POST":
            return httpx.Response(200)
        return httpx.Response(200, text=index)

    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        assert len(read_sitemap(client)) == 3
        assert run(client, state, "a" * 32) == (1, 200)
        before = state.read_bytes()
        failure = True
        with pytest.raises(httpx.HTTPStatusError):
            run(client, state, "a" * 32)
        assert state.read_bytes() == before
