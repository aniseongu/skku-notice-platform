import httpx
import pytest

from skku_notice import fetch


@pytest.fixture
def image_server(monkeypatch):
    requests = []

    def respond(request):
        requests.append(request)
        return httpx.Response(200, headers={"Content-Type": "image/png"}, content=b"image")

    original = httpx.Client
    monkeypatch.setattr(fetch, "_resolve_addresses", lambda host: {"8.8.8.8"})
    monkeypatch.setattr(fetch.httpx, "Client", lambda **kwargs: original(
        transport=httpx.MockTransport(respond), **kwargs
    ))
    return requests


@pytest.mark.parametrize("host", [
    "daoift3qrrnil.cloudfront.net", "media-cdn.linkareer.com", "linkareer.com",
    "image.ninehire.com", "file2.jobkorea.co.kr", "psk.recruiter.co.kr", "i0.wp.com",
])
def test_exact_intern_image_hosts_require_opt_in(image_server, host):
    url = f"https://{host}/poster.png"
    assert fetch.fetch_image(url, "agent") is None
    assert image_server == []
    assert fetch.fetch_image(url, "agent", allow_external=True) == fetch.ImageData(b"image", "image/png")
    assert len(image_server) == 1


@pytest.mark.parametrize("url", [
    "https://evil.example/image.png",
    "https://media-cdn.linkareer.com.evil.example/image.png",
    "https://another.cloudfront.net/image.png",
    "https://i9.wp.com/arbitrary.example/image.png",
    "https://jasoseol.com/image.png",
    "http://media-cdn.linkareer.com/image.png",
    "https://user:password@media-cdn.linkareer.com/image.png",
    "https://media-cdn.linkareer.com:8443/image.png",
    "https://127.0.0.1/image.png",
])
def test_external_mode_still_blocks_arbitrary_urls(image_server, url):
    assert fetch.fetch_image(url, "agent", allow_external=True) is None
    assert image_server == []


def test_external_cdn_resolving_to_private_network_is_blocked(image_server, monkeypatch):
    monkeypatch.setattr(fetch, "_resolve_addresses", lambda host: {"8.8.8.8", "169.254.169.254"})
    image = fetch.fetch_image("https://media-cdn.linkareer.com/poster.png", "agent", allow_external=True)
    assert image is None
    assert image_server == []


def test_external_redirect_is_never_followed(monkeypatch):
    requests = []

    def respond(request):
        requests.append(request)
        return httpx.Response(302, headers={"Location": "https://127.0.0.1/private"})

    original = httpx.Client
    monkeypatch.setattr(fetch, "_resolve_addresses", lambda host: {"8.8.8.8"})
    monkeypatch.setattr(fetch.httpx, "Client", lambda **kwargs: original(
        transport=httpx.MockTransport(respond), **kwargs
    ))
    image = fetch.fetch_image("https://media-cdn.linkareer.com/poster.png", "agent", allow_external=True)
    assert image is None
    assert len(requests) == 1


def test_fetch_images_forwards_opt_in_and_keeps_per_notice_limit(monkeypatch):
    calls = []
    sleeps = []
    monkeypatch.setattr(fetch.time, "monotonic", lambda: 0)
    monkeypatch.setattr(fetch.time, "sleep", sleeps.append)

    def image(url, agent, *, allow_external=False):
        calls.append((url, allow_external))
        return fetch.ImageData(b"image", "image/png")

    monkeypatch.setattr(fetch, "fetch_image", image)
    assert len(fetch.fetch_images(["a", "b", "c", "d"], "agent", 10, allow_external=True)) == 3
    assert calls == [("a", True), ("b", True), ("c", True)]
    assert sleeps == [1, 1]
