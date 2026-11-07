"""Process a small shared OCR queue independently of notice collection."""

import hashlib
import os
import time
from datetime import UTC, datetime, timedelta
from pathlib import Path

import yaml

from skku_notice.fetch import fetch_image
from skku_notice.ocr import read_images
from skku_notice.scheduled_collection import NoticeStore, StoreError

ENGINE_VERSION = "rapidocr-3.10.0-ppocrv5-korean-tiled-v1"


class OCRStore(NoticeStore):
    def discover(self) -> None:
        notices = self._request(
            "GET",
            "platform_notices",
            params={
                "select": "id,images,body,first_seen",
                "order": "posted_on.desc,id.desc",
                "limit": "100",
            },
        ).json()
        rows = []
        for notice in notices:
            if (notice.get("body") or "").strip():
                continue
            images = notice.get("images")
            if not isinstance(images, list):
                continue
            for url in images[:3]:
                if isinstance(url, str) and 0 < len(url) <= 2048:
                    rows.append(
                        {
                            "notice_id": notice["id"],
                            "image_url": url,
                            "priority": 0,
                            "notice_seen_at": notice.get("first_seen"),
                        }
                    )
        if rows:
            # Update priority without resetting status, hashes or attempt timestamps.
            self._request(
                "POST",
                "platform_notice_images",
                params={"on_conflict": "notice_id,image_url"},
                json=rows,
                headers={"Prefer": "resolution=merge-duplicates,return=minimal"},
            )

    def candidate(self, cutoff: datetime) -> dict | None:
        rows = self._request(
            "GET",
            "platform_notice_images",
            params={
                "select": "notice_id,image_url,status",
                "or": f"(last_attempt_at.is.null,last_attempt_at.lt.{cutoff.isoformat()})",
                "order": "priority.asc,last_attempt_at.asc.nullsfirst,notice_seen_at.desc.nullslast",
                "limit": "1",
            },
        ).json()
        return rows[0] if rows else None

    def current_image(self, notice_id: str, image_url: str) -> bool:
        rows = self._request(
            "GET",
            "platform_notices",
            params={
                "id": f"eq.{notice_id}",
                "select": "images,body",
                "limit": "1",
            },
        ).json()
        return bool(rows and not (rows[0].get("body") or "").strip()
                    and isinstance(rows[0].get("images"), list) and image_url in rows[0]["images"])

    def remove_image(self, notice_id: str, image_url: str) -> None:
        self._request(
            "DELETE",
            "platform_notice_images",
            params={
                "notice_id": f"eq.{notice_id}",
                "image_url": f"eq.{image_url}",
            },
        )

    def start_attempt(self, notice_id: str, image_url: str, now: datetime) -> None:
        self._request(
            "PATCH",
            "platform_notice_images",
            params={"notice_id": f"eq.{notice_id}", "image_url": f"eq.{image_url}"},
            json={"last_attempt_at": now.isoformat()},
        )

    def cached(self, digest: str) -> bool:
        rows = self._request(
            "GET",
            "platform_ocr_cache",
            params={
                "content_sha256": f"eq.{digest}",
                "engine_version": f"eq.{ENGINE_VERSION}",
                "select": "content_sha256",
                "limit": "1",
            },
        ).json()
        return bool(rows)

    def save_cache(self, digest: str, text: str) -> None:
        self._request(
            "POST",
            "platform_ocr_cache",
            params={"on_conflict": "content_sha256,engine_version"},
            json=[{"content_sha256": digest, "engine_version": ENGINE_VERSION, "extracted_text": text}],
            headers={"Prefer": "resolution=ignore-duplicates,return=minimal"},
        )

    def mark(
        self, notice_id: str, image_url: str, now: datetime, digest: str | None, *, was_ready: bool
    ) -> None:
        values = {"last_attempt_at": now.isoformat()}
        # A temporary download/inference failure must not discard the last good OCR result.
        if digest or not was_ready:
            values.update(
                {
                    "status": "ready" if digest else "failed",
                    "content_sha256": digest,
                    "engine_version": ENGINE_VERSION if digest else None,
                }
            )
        self._request(
            "PATCH",
            "platform_notice_images",
            params={
                "notice_id": f"eq.{notice_id}",
                "image_url": f"eq.{image_url}",
            },
            json=values,
        )


def run_one(store: OCRStore, user_agent: str, now: datetime, *, discover: bool = True) -> str:
    """Process one due image, optionally discovering recent images first."""
    if discover:
        store.discover()
    candidate = store.candidate(now - timedelta(hours=24))
    if not candidate:
        return "idle"
    notice_id, image_url = candidate["notice_id"], candidate["image_url"]
    was_ready = candidate.get("status") == "ready"
    if not store.current_image(notice_id, image_url):
        store.remove_image(notice_id, image_url)
        return "stale"
    # Record the attempt first so an OOM or timeout cannot block the queue forever.
    store.start_attempt(notice_id, image_url, now)
    image = fetch_image(image_url, user_agent)
    if image is None:
        store.mark(notice_id, image_url, now, None, was_ready=was_ready)
        return "failed"
    digest = hashlib.sha256(image.data).hexdigest()
    if store.cached(digest):
        store.mark(notice_id, image_url, now, digest, was_ready=was_ready)
        return "cached"
    text = read_images([image.data])
    if not text or len(text.encode("utf-8")) > 1_000_000:
        store.mark(notice_id, image_url, now, None, was_ready=was_ready)
        return "failed"
    store.save_cache(digest, text)
    store.mark(notice_id, image_url, now, digest, was_ready=was_ready)
    return "processed"


def run_batch(store: OCRStore, user_agent: str, now: datetime, *, limit: int = 5) -> dict[str, int]:
    """Process a bounded batch while reusing the initialized OCR engine."""
    counts = {"processed": 0, "cached": 0, "failed": 0, "stale": 0}
    store.discover()
    for index in range(min(5, max(0, limit))):
        if index:
            time.sleep(1.5)
        result = run_one(store, user_agent, now, discover=False)
        if result == "idle":
            break
        counts[result] += 1
    return counts


def main() -> int:
    try:
        settings = yaml.safe_load(Path("config/sources.yaml").read_text(encoding="utf-8"))
        store = OCRStore(os.environ.get("SUPABASE_URL", ""), os.environ.get("SUPABASE_SECRET_KEY", ""))
        try:
            counts = run_batch(store, settings["user_agent"], datetime.now(UTC))
        finally:
            store.close()
    except (OSError, ValueError, KeyError, TypeError, yaml.YAMLError, StoreError) as exc:
        print(f"OCR worker failed: {type(exc).__name__}", flush=True)
        return 1
    print(f"OCR worker: {counts}", flush=True)
    return int(counts["failed"] > 0)


if __name__ == "__main__":
    raise SystemExit(main())
