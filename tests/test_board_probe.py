import socket
from pathlib import Path

import pytest

from skku_notice import board_probe
from skku_notice.board_probe import BoardProbeError, _public_addresses, validate_candidate


@pytest.mark.parametrize("url", [
    "http://www.skku.edu/a.do",
    "https://skku.edu.example.com/a.do",
    "https://user@www.skku.edu/a.do",
    "https://www.skku.edu:444/a.do",
    "https://www.skku.edu/a.do?mode=delete",
    "https://www.skku.edu/a/../b.do",
    "https://www.skku.edu/%2e%2e/a.do",
    "https://www.skku.edu/a.do#x",
])
def test_candidate_rejects_untrusted_or_action_urls(url):
    with pytest.raises(BoardProbeError):
        validate_candidate(url)


def test_candidate_canonicalizes_school_url():
    assert validate_candidate(" https://WWW.SKKU.EDU/skku/notice.do ").url == (
        "https://www.skku.edu/skku/notice.do"
    )


def test_dns_must_contain_only_public_addresses(monkeypatch):
    def answers(*_args, **_kwargs):
        return [(socket.AF_INET, socket.SOCK_STREAM, 0, "", (ip, 443))
                for ip in ("8.8.8.8", "127.0.0.1")]

    monkeypatch.setattr(socket, "getaddrinfo", answers)
    with pytest.raises(BoardProbeError):
        _public_addresses("www.skku.edu")


def test_probe_verifies_list_and_detail_without_model(monkeypatch):
    fixtures = Path(__file__).parent / "fixtures"
    listing = (fixtures / "skku_notice01_list_2026-11-02.html").read_text()
    detail = (fixtures / "skku_notice01_view_141498_2026-11-02.html").read_text()
    calls = []

    def get(host, target, **_kwargs):
        calls.append(target)
        if target == "/robots.txt":
            return "User-agent: *\nAllow: /"
        return detail if "?" in target else listing

    monkeypatch.setattr(board_probe, "_get", get)
    monkeypatch.setattr(board_probe.time, "sleep", lambda _: None)
    board, notices = board_probe.probe_board("https://www.skku.edu/skku/notice.do")
    assert board.host == "www.skku.edu"
    assert len(notices) > 0
    assert calls[0] == "/robots.txt" and len(calls) == 3


def test_probe_stops_before_page_when_robots_disallows(monkeypatch):
    calls = []

    def get(host, target, **_kwargs):
        calls.append(target)
        return "User-agent: *\nDisallow: /"

    monkeypatch.setattr(board_probe, "_get", get)
    with pytest.raises(BoardProbeError, match="not allowed"):
        board_probe.probe_board("https://www.skku.edu/skku/notice.do")
    assert calls == ["/robots.txt"]


def test_shared_detail_cannot_change_host_or_execute_action(monkeypatch):
    monkeypatch.setattr(board_probe, "_get", lambda *_a, **_k: pytest.fail("request sent"))
    for url in ("https://evil.skku.edu/notice.do?mode=view&articleNo=1",
                "https://www.skku.edu/notice.do?mode=delete&articleNo=1"):
        with pytest.raises(BoardProbeError):
            board_probe.fetch_shared_page("https://www.skku.edu/notice.do", url)
