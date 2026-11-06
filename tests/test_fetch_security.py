import logging

import httpx
import pytest

from skku_notice import fetch
from skku_notice.fetch import UnsafeURL


@pytest.mark.parametrize("url", [
    "file:///etc/passwd",
    "ftp://cse.skku.edu/image.png",
    "https://cse.skku.edu.evil.example/image.png?token=secret",
    "https://evil.example/image.png?token=secret",
    "http://127.0.0.1/image.png",
    "https://user:pass@cse.skku.edu/image.png",
])
def test_untrusted_urls_are_rejected_before_request(monkeypatch, caplog, url) -> None:
    monkeypatch.setattr(fetch, "_resolve_addresses", lambda host: {"8.8.8.8"})
    monkeypatch.setattr(fetch.httpx, "get", lambda *args, **kwargs: pytest.fail("request sent"))
    monkeypatch.setattr(fetch.httpx, "Client", lambda **kwargs: pytest.fail("request sent"))
    with caplog.at_level(logging.WARNING):
        with pytest.raises(UnsafeURL):
            fetch.fetch_detail(url, "agent", 10)
        assert fetch.fetch_image(url, "agent") is None
    assert len(caplog.records) == 2
    assert all("secret" not in record.message and "?" not in record.message
               for record in caplog.records)


@pytest.mark.parametrize("address", [
    "127.0.0.1", "10.0.0.1", "172.16.0.1", "192.168.1.1",
    "169.254.169.254", "100.64.0.1", "192.0.2.1", "224.0.0.1", "240.0.0.1",
    "::1", "fc00::1", "fe80::1", "ff02::1",
])
def test_nonpublic_dns_addresses_are_rejected(monkeypatch, address) -> None:
    monkeypatch.setattr(fetch, "_resolve_addresses", lambda host: {"8.8.8.8", address})
    monkeypatch.setattr(fetch.httpx, "get", lambda *args, **kwargs: pytest.fail("request sent"))
    monkeypatch.setattr(fetch.httpx, "Client", lambda **kwargs: pytest.fail("request sent"))
    with pytest.raises(UnsafeURL):
        fetch.fetch_detail("https://cse.skku.edu/view?secret=hidden", "agent", 10)
    assert fetch.fetch_image("https://cse.skku.edu/image?secret=hidden", "agent") is None


def test_dns_failure_is_rejected(monkeypatch) -> None:
    def fail(host):
        raise OSError("DNS unavailable")

    monkeypatch.setattr(fetch, "_resolve_addresses", fail)
    with pytest.raises(UnsafeURL):
        fetch.fetch_detail("https://cse.skku.edu/view", "agent", 10)


def test_detail_and_image_do_not_follow_redirects(monkeypatch) -> None:
    monkeypatch.setattr(fetch, "_resolve_addresses", lambda host: {"8.8.8.8"})
    requests = []

    def respond(request):
        requests.append(request.url)
        return httpx.Response(302, headers={"Location": "http://169.254.169.254/latest/meta-data/"})

    transport = httpx.MockTransport(respond)
    original_client = httpx.Client
    monkeypatch.setattr(fetch.httpx, "Client", lambda **kwargs: original_client(
        transport=transport, **kwargs
    ))

    def get(url, **kwargs):
        with original_client(transport=transport, follow_redirects=kwargs["follow_redirects"]) as client:
            return client.get(url)

    monkeypatch.setattr(fetch.httpx, "get", get)
    with pytest.raises(fetch.FetchError):
        fetch.fetch_detail("https://cse.skku.edu/view", "agent", 10)
    assert fetch.fetch_image("https://cse.skku.edu/image", "agent") is None
    assert len(requests) == 2
    assert all(request.host == "cse.skku.edu" for request in requests)


def test_configured_host_and_skku_subdomain_are_allowed(monkeypatch) -> None:
    monkeypatch.setattr(fetch, "_source_hosts", lambda: {"board.example.org"})
    monkeypatch.setattr(fetch, "_resolve_addresses", lambda host: {"8.8.8.8"})
    for url in ("https://board.example.org/view", "http://new.skku.edu/view"):
        fetch._validate_notice_url(url)
