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
        self.started = []

    def discover(self):
        pass

    def candidate(self, cutoff):
        self.cutoff = cutoff
        return self.image

    def current_image(self, notice_id, image_url):
        return self.present

    def remove_image(self, notice_id, image_url):
        self.removed = True

    def start_attempt(self, notice_id, image_url, now):
        self.started.append((notice_id, image_url, now))

    def cached(self, digest):
        return digest in self.cache

    def save_cache(self, digest, text):
        self.cache[digest] = text

    def mark(self, notice_id, image_url, now, digest, *, was_ready):
        self.marked.append((notice_id, image_url, now, digest, was_ready))


def test_shared_ocr_is_cached_by_image_hash(monkeypatch):
    store = MemoryStore()
    monkeypatch.setattr(job, "fetch_image", lambda *_, **__: SimpleNamespace(data=b"image"))
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
        job, "fetch_image", lambda *_, **__: (_ for _ in ()).throw(AssertionError("unexpected fetch"))
    )
    assert job.run_one(store, "test", NOW) == "stale"
    assert store.removed


def test_attempt_is_recorded_before_a_worker_crash(monkeypatch):
    store = MemoryStore()
    monkeypatch.setattr(job, "fetch_image", lambda *_, **__: SimpleNamespace(data=b"image"))

    def crash(_images):
        raise RuntimeError("interrupted")

    monkeypatch.setattr(job, "read_images", crash)
    import pytest

    with pytest.raises(RuntimeError, match="interrupted"):
        job.run_one(store, "test", NOW)
    assert store.started == [("school/1", "https://www.skku.edu/image.png", NOW)]


def test_failed_refresh_preserves_last_good_result(monkeypatch):
    store = MemoryStore()
    store.image["status"] = "ready"
    monkeypatch.setattr(job, "fetch_image", lambda *_, **__: None)
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
                200,
                json=[
                    {
                        "id": "school/1",
                        "images": ["https://www.skku.edu/a.png", None],
                        "body": "",
                        "first_seen": "2026-11-07T00:00:00Z",
                    },
                    {"id": "school/2", "images": ["https://www.skku.edu/b.png"],
                     "body": "안내문", "first_seen": None},
                ],
            )
        return httpx.Response(201)

    client.client._transport = httpx.MockTransport(respond)
    try:
        client.discover()
        assert json.loads(requests[2].content) == [
            {
                "notice_id": "school/1",
                "image_url": "https://www.skku.edu/a.png",
                "priority": 0,
                "notice_seen_at": "2026-11-07T00:00:00Z",
            }
        ]
        assert "resolution=merge-duplicates" in requests[2].headers["prefer"]
    finally:
        client.close()


def test_queued_image_is_skipped_when_notice_now_has_text():
    client = job.OCRStore("https://example.supabase.co", "sb_secret_test")
    client.client._transport = httpx.MockTransport(lambda _: httpx.Response(
        200, json=[{"images": ["https://www.skku.edu/a.png"], "body": "공지 내용"}]))
    try:
        assert not client.current_image("school/1", "https://www.skku.edu/a.png")
    finally:
        client.close()


def test_batch_reuses_worker_and_stops_when_queue_is_empty(monkeypatch):
    store = MemoryStore()
    results = iter(["processed", "cached", "failed", "idle"])
    calls = []
    monkeypatch.setattr(job.time, "sleep", lambda _seconds: None)

    def run_one(_store, _agent, _now, *, discover):
        calls.append(discover)
        return next(results)

    monkeypatch.setattr(job, "run_one", run_one)
    assert job.run_batch(store, "test", NOW) == {"processed": 1, "cached": 1, "failed": 1, "stale": 0}
    assert calls == [False, False, False, False]


def test_줄표만_있는_본문은_글자가_없는_것으로_본다():
    from skku_notice.ocr_collection import has_readable_text

    assert not has_readable_text("—\n—\n—\n—\n—")
    assert not has_readable_text(None)
    assert has_readable_text("넷마블네오 AI 인턴십 모집")


def test_인턴_공고는_본문에_회사_이름과_기간과_업무가_모자라면_그림을_읽는다():
    from skku_notice.ocr_collection import wants_image_text

    thin = {"id": "jasoseol-intern/1", "source_id": "jasoseol-intern", "title": "AI 인턴십",
            "body": "자세한 내용은 아래 그림을 참고하세요"}
    full = {"id": "jasoseol-intern/2", "source_id": "jasoseol-intern", "title": "[넷마블네오] 인턴",
            "body": "모집 직무: 게임 기획\n근무 기간: 2027.01.04 ~ 2027.03.31"}
    school = {"id": "skku/3", "source_id": "skku-notice", "title": "장학 안내",
              "body": "장학금 신청 방법을 알려 드립니다"}
    assert wants_image_text(thin, {"jasoseol-intern"})
    assert not wants_image_text(full, {"jasoseol-intern"})
    assert not wants_image_text(school, {"jasoseol-intern"})


def test_read_until_complete_adds_missed_lines_and_stops_when_complete(monkeypatch):
    from skku_notice import ocr
    calls = []
    second = "처음 줄\n근무시간: 1일 8시간, 주 5일"
    monkeypatch.setattr(ocr, "read_images", lambda images, sensitive=False: calls.append(sensitive) or second)
    monkeypatch.setattr(ocr, "_tesseract", lambda images: calls.append("tess") or "")
    text = ocr.read_until_complete([b"x"], "처음 줄", lambda t: "1일 8시간" in t)
    assert text.splitlines() == ["처음 줄", "근무시간: 1일 8시간, 주 5일"]
    assert calls == [True]  # 충분해져서 tesseract는 부르지 않는다


def test_read_until_complete_survives_a_failing_step_and_keeps_earlier_text(monkeypatch):
    from skku_notice import ocr

    def boom(images, sensitive=False):
        raise RuntimeError("메모리 부족")
    monkeypatch.setattr(ocr, "read_images", boom)
    monkeypatch.setattr(ocr, "_tesseract", lambda images: "보조 도구가 읽은 줄")
    text = ocr.read_until_complete([b"x"], "처음 줄", lambda t: False)
    assert text.splitlines() == ["처음 줄", "보조 도구가 읽은 줄"]
    assert ocr.read_until_complete([b"x"], "처음 줄", lambda t: True) == "처음 줄"


def test_lacks_work_hours_reads_hours_written_without_spaces():
    from skku_notice.grad_intern_facts import lacks_work_hours
    assert lacks_work_hours("인턴", "근무지역: 서울") is True
    assert lacks_work_hours("인턴", "근무시간: 09:00~18:00 (1일8시간, 주5일)") is False
