import httpx
import pytest

from skku_notice import fetch


class FlakyClient:
    def __init__(self, outcomes):
        self.outcomes = list(outcomes)
        self.calls = 0

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def get(self, url):
        self.calls += 1
        outcome = self.outcomes.pop(0)
        if isinstance(outcome, Exception):
            raise outcome
        return outcome


def install(monkeypatch, outcomes):
    client = FlakyClient(outcomes)
    monkeypatch.setattr(fetch.httpx, "Client", lambda **_: client)
    monkeypatch.setattr(fetch.time, "sleep", lambda _: None)
    return client


def test_fetch_list_recovers_after_three_timeouts(monkeypatch):
    timeout = httpx.ReadTimeout("timed out")
    client = install(monkeypatch, [timeout, timeout, timeout, httpx.Response(200, text="ok")])
    assert fetch.fetch_list("https://example.edu/n", "agent", 20) == "ok"
    assert client.calls == 4


def test_fetch_list_gives_up_after_four_timeouts(monkeypatch):
    timeout = httpx.ReadTimeout("timed out")
    client = install(monkeypatch, [timeout] * 4)
    with pytest.raises(fetch.FetchError, match="failed after 4 attempts"):
        fetch.fetch_list("https://example.edu/n", "agent", 20)
    assert client.calls == 4
