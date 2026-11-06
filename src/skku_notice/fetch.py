# 출처: https://github.com/tsungmnli/skku-notice-api/blob/main/app/crawler/fetch.py
"""Network access to public list pages, with bounded retries."""

import ipaddress
import logging
import socket
import time
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urlsplit

import httpx
import yaml

RETRY_STATUS = {429, 500, 502, 503, 504}
MAX_IMAGE_BYTES = 5 * 1024 * 1024
SOURCES_PATH = Path("config/sources.yaml")
LOGGER = logging.getLogger(__name__)
# Exact public image hosts observed in collected internship notices; no wildcard CDN host matching.
EXTERNAL_IMAGE_HOSTS = frozenset({
    "daoift3qrrnil.cloudfront.net", "media-cdn.linkareer.com", "linkareer.com",
    "image.ninehire.com", "file2.jobkorea.co.kr", "psk.recruiter.co.kr", "i0.wp.com",
})


@dataclass(frozen=True)
class ImageData:
    data: bytes
    mime_type: str


class FetchError(RuntimeError):
    """A board page could not be fetched."""


class UnsafeURL(FetchError):
    """An untrusted notice URL was rejected before a request."""


def _source_hosts() -> set[str]:
    settings = yaml.safe_load(SOURCES_PATH.read_text(encoding="utf-8"))
    return {urlsplit(source["url"]).hostname.lower() for source in settings["sources"]}


def _resolve_addresses(host: str) -> set[str]:
    return {entry[4][0] for entry in socket.getaddrinfo(host, None, type=socket.SOCK_STREAM)}


def _external_source_hosts() -> set[str]:
    settings = yaml.safe_load(SOURCES_PATH.read_text(encoding="utf-8"))
    return {urlsplit(source["url"]).hostname.lower() for source in settings["sources"]
            if source.get("external")}


def _validate_notice_url(
    url: str, *, allowed_hosts: set[str] | None = None, https_only: bool = False,
) -> None:
    try:
        parsed = urlsplit(url)
        host = parsed.hostname
        safe_label = f"{parsed.scheme}://{host}" if host else "invalid URL"
        if (
            parsed.scheme not in ({"https"} if https_only else {"http", "https"})
            or not host
            or parsed.username is not None
            or parsed.password is not None
            or parsed.port is not None and parsed.port not in ({443} if https_only else {80, 443})
            or not (host in (allowed_hosts if allowed_hosts is not None else _source_hosts())
                    or host.endswith(".skku.edu"))
        ):
            raise UnsafeURL(safe_label)
        addresses = _resolve_addresses(host)
        if not addresses or any(
            not ipaddress.ip_address(address).is_global
            or ipaddress.ip_address(address).is_multicast
            or ipaddress.ip_address(address).is_reserved
            for address in addresses
        ):
            raise UnsafeURL(safe_label)
    except (OSError, ValueError, yaml.YAMLError) as exc:
        LOGGER.warning("공지 주소 거부: %s", safe_label if "safe_label" in locals() else "invalid URL")
        raise UnsafeURL("unsafe notice URL") from exc
    except UnsafeURL:
        LOGGER.warning("공지 주소 거부: %s", safe_label)
        raise


def fetch_list(url: str, user_agent: str, timeout_seconds: float) -> str:
    headers = {"User-Agent": user_agent, "Accept-Language": "ko"}
    with httpx.Client(headers=headers, timeout=timeout_seconds, follow_redirects=True) as client:
        for attempt in range(3):
            try:
                response = client.get(url)
            except httpx.TransportError as exc:
                error = exc
            else:
                if response.status_code == 200:
                    response.encoding = "utf-8"
                    return response.text
                if response.status_code not in RETRY_STATUS:
                    raise FetchError(f"{url}: HTTP {response.status_code}")
                error = FetchError(f"{url}: HTTP {response.status_code}")
            if attempt < 2:
                time.sleep(2**attempt)
    raise FetchError(f"{url}: failed after 3 attempts ({error})") from error


def fetch_detail(url: str, user_agent: str, timeout_seconds: float) -> str:
    _validate_notice_url(url)
    headers = {"User-Agent": user_agent, "Accept-Language": "ko"}
    try:
        response = httpx.get(url, headers=headers, timeout=timeout_seconds, follow_redirects=False)
        response.raise_for_status()
    except httpx.HTTPError as exc:
        raise FetchError("detail fetch failed") from exc
    response.encoding = "utf-8"
    return response.text


def fetch_image(url: str, user_agent: str, *, allow_external: bool = False) -> ImageData | None:
    try:
        hosts = _source_hosts() - _external_source_hosts()
        if allow_external:
            hosts.update(EXTERNAL_IMAGE_HOSTS)
        _validate_notice_url(url, allowed_hosts=hosts, https_only=True)
        with httpx.Client(headers={"User-Agent": user_agent}, timeout=10,
                          follow_redirects=False) as client:
            with client.stream("GET", url) as response:
                response.raise_for_status()
                mime_type = response.headers.get("Content-Type", "").split(";", 1)[0].strip().lower()
                if not mime_type.startswith("image/"):
                    return None
                size = response.headers.get("Content-Length")
                if size is not None and int(size) > MAX_IMAGE_BYTES:
                    return None
                data = bytearray()
                for chunk in response.iter_bytes():
                    data.extend(chunk)
                    if len(data) > MAX_IMAGE_BYTES:
                        return None
                return ImageData(bytes(data), mime_type)
    except (UnsafeURL, httpx.HTTPError, ValueError, OSError, yaml.YAMLError):
        return None


def fetch_images(
    urls: list[str], user_agent: str, limit: int, *, allow_external: bool = False,
) -> list[ImageData]:
    images = []
    previous_request: float | None = None
    for url in urls[:min(3, max(0, limit))]:
        if previous_request is not None:
            time.sleep(max(0, 1 - (time.monotonic() - previous_request)))
        previous_request = time.monotonic()
        image = fetch_image(url, user_agent, allow_external=allow_external)
        if image is not None:
            images.append(image)
    return images


# 외부 인턴 공고 API(D-026). 학교 주소가 아니라서 이 둘만 따로 허용한다.
EXTERNAL_API_HOSTS = frozenset({"api.linkareer.com", "jasoseol.com"})


def fetch_json_post(url: str, body: dict, user_agent: str, timeout_seconds: float,
                    headers: dict[str, str] | None = None) -> dict:
    parsed = urlsplit(url)
    host = (parsed.hostname or "").lower()
    if parsed.scheme != "https" or host not in EXTERNAL_API_HOSTS or parsed.port not in (None, 443):
        raise UnsafeURL(f"https://{host}")
    try:
        addresses = _resolve_addresses(host)
    except OSError as exc:
        raise FetchError(f"{host}: 주소를 찾지 못했어요") from exc
    if not addresses or any(not ipaddress.ip_address(address).is_global for address in addresses):
        raise UnsafeURL(f"https://{host}")
    request_headers = {"User-Agent": user_agent, **(headers or {})}
    with httpx.Client(headers=request_headers, timeout=timeout_seconds, follow_redirects=False) as client:
        for attempt in range(3):
            try:
                response = client.post(url, json=body)
            except httpx.TransportError as exc:
                error: Exception = exc
            else:
                if response.status_code == 200:
                    try:
                        return response.json()
                    except ValueError as exc:
                        raise FetchError(f"{host}: invalid JSON") from exc
                if response.status_code not in RETRY_STATUS:
                    raise FetchError(f"{host}: HTTP {response.status_code}")
                error = FetchError(f"{host}: HTTP {response.status_code}")
            if attempt < 2:
                time.sleep(2**attempt)
    raise FetchError(f"{host}: failed after 3 attempts ({error})") from error
