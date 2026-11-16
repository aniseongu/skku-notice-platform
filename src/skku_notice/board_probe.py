"""Bounded probing of user-submitted public SKKU CMS boards.

This module does not register sources.  It validates a candidate for a separate
registration step and pins each HTTPS connection to a public resolved address.
"""

import http.client
import ipaddress
import re
import socket
import ssl
import time
from dataclasses import dataclass
from urllib.parse import parse_qs, urlsplit, urlunsplit
from urllib.robotparser import RobotFileParser

from skku_notice.model import Notice
from skku_notice.parse import ParseError, parse_detail, parse_list

MAX_BODY = 2 * 1024 * 1024
AGENT = "SKKUNoticePlatform"


class BoardProbeError(ValueError):
    """A candidate could not be verified safely."""


@dataclass(frozen=True)
class Candidate:
    url: str
    host: str
    path: str


def validate_candidate(url: str) -> Candidate:
    try:
        parsed = urlsplit(url.strip())
        host = parsed.hostname or ""
        path = parsed.path
        if (
            len(url) > 400 or parsed.scheme != "https" or parsed.username is not None
            or parsed.password is not None or parsed.port not in (None, 443)
            or not (host == "skku.edu" or host.endswith(".skku.edu"))
            or not re.fullmatch(r"[a-z0-9-]+(?:\.[a-z0-9-]+)*", host)
            or not re.fullmatch(r"/[A-Za-z0-9_./-]+\.do", path)
            or "//" in path or any(part in {".", ".."} for part in path.split("/"))
            or parsed.query or parsed.fragment
        ):
            raise BoardProbeError("unsupported address")
        return Candidate(urlunsplit(("https", host, path, "", "")), host, path)
    except ValueError as exc:
        raise BoardProbeError("unsupported address") from exc


def _public_addresses(host: str) -> list[str]:
    try:
        addresses = sorted({entry[4][0] for entry in socket.getaddrinfo(host, 443, type=socket.SOCK_STREAM)})
        if not addresses or any(
            not ipaddress.ip_address(ip).is_global or ipaddress.ip_address(ip).is_multicast
            or ipaddress.ip_address(ip).is_reserved for ip in addresses
        ):
            raise BoardProbeError("address is not public")
        return addresses
    except (OSError, ValueError) as exc:
        raise BoardProbeError("address lookup failed") from exc


def _get_bytes(host: str, target: str, *, limit: int = MAX_BODY, image: bool = False) -> bytes:
    """Connect directly to a vetted IP while verifying the hostname's TLS certificate."""
    address = _public_addresses(host)[0]
    try:
        with socket.create_connection((address, 443), timeout=10) as raw:
            with ssl.create_default_context().wrap_socket(raw, server_hostname=host) as conn:
                conn.settimeout(10)
                conn.sendall(f"GET {target} HTTP/1.1\r\nHost: {host}\r\nUser-Agent: {AGENT}\r\n"
                             "Accept: text/html,text/plain\r\nAccept-Encoding: identity\r\n"
                             "Connection: close\r\n\r\n".encode("ascii"))
                response = http.client.HTTPResponse(conn)
                response.begin()
                if response.status != 200:
                    raise BoardProbeError("page unavailable")
                if image and not response.getheader("Content-Type", "").lower().startswith("image/"):
                    raise BoardProbeError("not an image")
                body = response.read(limit + 1)
                if len(body) > limit:
                    raise BoardProbeError("page too large")
                return body
    except (OSError, ssl.SSLError, http.client.HTTPException, UnicodeError) as exc:
        raise BoardProbeError("page unavailable") from exc


def _get(host: str, target: str, *, limit: int = MAX_BODY) -> str:
    return _get_bytes(host, target, limit=limit).decode("utf-8", errors="replace")


def fetch_shared_image(url: str) -> bytes:
    try:
        parsed = urlsplit(url)
        host = parsed.hostname or ""
        if (len(url) > 2048 or parsed.scheme != "https" or parsed.username is not None
                or parsed.password is not None or parsed.port not in (None, 443) or parsed.fragment
                or not (host == "skku.edu" or host.endswith(".skku.edu"))
                or not re.fullmatch(r"[a-z0-9-]+(?:\.[a-z0-9-]+)*", host)):
            raise BoardProbeError("unsupported image address")
        target = parsed.path or "/"
        target += f"?{parsed.query}" if parsed.query else ""
        robots = RobotFileParser()
        robots.parse(_get(host, "/robots.txt", limit=128 * 1024).splitlines())
        if not robots.can_fetch(AGENT, url):
            raise BoardProbeError("collection not allowed")
        time.sleep(1.5)
        return _get_bytes(host, target, limit=5 * 1024 * 1024, image=True)
    except ValueError as exc:
        raise BoardProbeError("unsupported image address") from exc


def fetch_shared_page(board_url: str, page_url: str) -> str:
    """Recheck policy and pin every request, including later scheduled fetches."""
    board = validate_candidate(board_url)
    page = urlsplit(page_url)
    try:
        if (page.scheme != "https" or page.hostname != board.host or page.path != board.path
                or page.username is not None or page.password is not None
                or page.port not in (None, 443) or page.fragment):
            raise BoardProbeError("unsupported detail address")
    except ValueError as exc:
        raise BoardProbeError("unsupported detail address") from exc
    if page.query:
        query = parse_qs(page.query, strict_parsing=True)
        if set(query) == {"mode", "articleNo"}:
            valid = (len(query["articleNo"]) == 1 and query["articleNo"][0].isascii()
                     and query["articleNo"][0].isdigit())
        elif set(query) == {"mode", "viewBoardId", "itemId"}:
            valid = (len(query["viewBoardId"]) == 1 and query["viewBoardId"][0].isascii()
                     and query["viewBoardId"][0].isdigit() and len(query["itemId"]) == 1
                     and re.fullmatch(r"[0-9A-F]{32}[A-Z0-9]{6}", query["itemId"][0]))
        else:
            valid = False
        if not valid or query.get("mode") != ["view"]:
            raise BoardProbeError("unsupported detail address")
    robots = RobotFileParser()
    robots.parse(_get(board.host, "/robots.txt", limit=128 * 1024).splitlines())
    if not robots.can_fetch(AGENT, page_url):
        raise BoardProbeError("collection not allowed")
    time.sleep(1.5)
    return _get(board.host, page.path + (f"?{page.query}" if page.query else ""))


def probe_board(url: str) -> tuple[Candidate, list[Notice]]:
    candidate = validate_candidate(url)
    robots = RobotFileParser()
    robots.parse(_get(candidate.host, "/robots.txt", limit=128 * 1024).splitlines())
    if not robots.can_fetch(AGENT, candidate.url):
        raise BoardProbeError("collection not allowed")
    try:
        time.sleep(1.5)
        notices = parse_list(_get(candidate.host, candidate.path), "candidate", candidate.url)
        if not notices or len(notices) > 100:
            raise BoardProbeError("empty board")
        detail = notices[0].url
        detail_url = urlsplit(detail)
        if detail_url.hostname != candidate.host or detail_url.scheme != "https":
            raise BoardProbeError("unsupported detail address")
        if not robots.can_fetch(AGENT, detail):
            raise BoardProbeError("collection not allowed")
        target = detail_url.path + (f"?{detail_url.query}" if detail_url.query else "")
        time.sleep(1.5)
        parsed_detail = parse_detail(_get(candidate.host, target), detail)
        if not parsed_detail.body_text and not parsed_detail.images and not parsed_detail.attachments:
            raise BoardProbeError("empty notice")
    except ParseError as exc:
        raise BoardProbeError("unsupported board") from exc
    return candidate, notices
