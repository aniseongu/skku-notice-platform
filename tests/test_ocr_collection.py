from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

import httpx

from skku_notice import ocr_collection as job

NOW = datetime(2026, 11, 7, tzinfo=UTC)


class MemoryStore:
    def __init__(self):
        self.image = {
            "notice_id": "school/1",
            "image_url": "https://www.skku.edu/image.png",
            "status": "pending",
        }
        self.cache = {}
        self.marked = []
        self.present = True
        self.removed = False
        self.cutoff = None

    def discover(self):
        pass

    def candidate(self, cutoff):
        self.cutoff = cutoff
        return self.image

    def current_image(self, notice_id, image_url):
        return self.present

    def remove_image(self, notice_id, image_url):
        self.removed = True

    def cached(self, digest):
        return digest in self.cache

    def save_cache(self, digest, text):
        self.cache[digest] = text

    def mark(self, notice_id, image_url, now, digest, *, was_ready):
        self.marked.append((notice_id, image_url, now, digest, was_ready))


def test_shared_ocr_is_cached_by_image_hash(monkeypatch):
    store = MemoryStore()
    monkeypatch.setattr(job, "fetch_image", lambda *_: SimpleNamespace(data=b"image"))
    calls = []
    monkeypatch.setattr(job, "read_images", lambda images: calls.append(images) or "한국어 공지")
    assert job.run_one(store, "test", NOW) == "processed"
    assert list(store.cache.values()) == ["한국어 공지"]
    assert job.run_one(store, "test", NOW) == "cached"
    assert len(calls) == 1
    assert store.cutoff == NOW - timedelta(hours=24)


def test_stale_images_are_removed_without_fetching(monkeypatch):
    store = MemoryStore()
    store.present = False
    monkeypatch.setattr(
        job, "fetch_image", lambda *_: (_ for _ in ()).throw(AssertionError("unexpected fetch"))
    )
    assert job.run_one(store, "test", NOW) == "stale"
    assert store.removed


def test_failed_refresh_preserves_last_good_result(monkeypatch):
    store = MemoryStore()
    store.image["status"] = "ready"
    monkeypatch.setattr(job, "fetch_image", lambda *_: None)
    assert job.run_one(store, "test", NOW) == "failed"
    assert store.marked[0][-2:] == (None, True)

    client = job.OCRStore("https://example.supabase.co", "sb_secret_test")
    requests = []
    client.client._transport = httpx.MockTransport(
        lambda request: requests.append(request) or httpx.Response(204)
    )
    try:
        client.mark("school/1", "https://www.skku.edu/image.png", NOW, None, was_ready=True)
        import json

        body = json.loads(requests[0].content)
        assert set(body) == {"last_attempt_at"}
    finally:
        client.close()


def test_discovery_only_enqueues_public_image_strings_without_resetting_status():
    import json

    client = job.OCRStore("https://example.supabase.co", "sb_secret_test")
    requests = []

    def respond(request):
        requests.append(request)
        if request.method == "GET":
            return httpx.Response(
                200, json=[{"id": "school/1", "images": ["https://www.skku.edu/a.png", None]}]
            )
        return httpx.Response(201)

    client.client._transport = httpx.MockTransport(respond)
    try:
        client.discover()
        assert json.loads(requests[1].content) == [
            {"notice_id": "school/1", "image_url": "https://www.skku.edu/a.png"}
        ]
        assert "resolution=ignore-duplicates" in requests[1].headers["prefer"]
    finally:
        client.close()
