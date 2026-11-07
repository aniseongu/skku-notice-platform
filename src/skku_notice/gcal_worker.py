# ruff: noqa: E501  (한국어 문구와 상태 열 이름이 한 줄에 있다)
"""Keep each user's "성대 공지" Google calendar in step with their saved notices, automatically.

The browser creates the calendar and stores the user's Google refresh token (encrypted, bound to "<user id>:gcal")
through the Edge Function. This worker, which holds the key that opens it, refreshes an access token with the OAuth
client and applies the original service's rules (skku_notice.gcal.desired_events / sync): only events marked as ours
are added, changed or removed, and the user's other calendars are never touched (scope calendar.app.created).
Never log tokens, ciphertext or response bodies.
"""

import os
from datetime import UTC, datetime, timedelta

import httpx

from skku_notice.byok_crypto import ByokCryptoError, decrypt_api_key
from skku_notice.deadline import KST
from skku_notice.gcal import CalendarError, access_token, desired_events, sync
from skku_notice.scheduled_collection import NoticeStore, StoreError

MAX_USERS_PER_RUN = 50
MIN_GAP = timedelta(minutes=25)
RECONNECT = "구글 연결이 끊겼어요. 설정에서 구글 캘린더를 다시 연결해 주세요."


class GcalStore(NoticeStore):
    def tokens(self) -> list[dict]:
        return self._request(
            "GET",
            "user_google_tokens",
            params={
                "select": "user_id,ciphertext,last_run_at",
                "disabled_at": "is.null",
                "order": "last_run_at.asc.nullsfirst",
                "limit": str(MAX_USERS_PER_RUN),
            },
        ).json()

    def calendar_id(self, user_id: str) -> str | None:
        rows = self._request("GET", "user_calendar", params={"user_id": f"eq.{user_id}", "select": "calendar_id"}).json()
        return rows[0]["calendar_id"] if rows else None

    def saved_notices(self, user_id: str) -> list[dict]:
        states = self._request(
            "GET", "user_notice_states",
            params={"user_id": f"eq.{user_id}", "is_saved": "eq.true", "select": "notice_id", "limit": "500"},
        ).json()
        ids = [row["notice_id"] for row in states]
        if not ids:
            return []
        listed = ",".join('"' + i.replace('"', "") + '"' for i in ids)
        return self._request(
            "GET", "platform_notices",
            params={"id": f"in.({listed})", "select": "id,source_id,title,url,deadline,category", "limit": "500"},
        ).json()

    def judgments(self, user_id: str, notice_ids: list[str]) -> list[dict]:
        if not notice_ids:
            return []
        listed = ",".join('"' + i.replace('"', "") + '"' for i in notice_ids)
        return self._request(
            "GET", "user_notice_judgments",
            params={"user_id": f"eq.{user_id}", "notice_id": f"in.({listed})",
                    "select": "notice_id,verdict,deadline,deadline_kind"},
        ).json()

    def external_sources(self) -> frozenset[str]:
        rows = self._request("GET", "platform_sources", params={"external": "eq.true", "select": "id"}).json()
        return frozenset(row["id"] for row in rows)

    def update(self, user_id: str, fields: dict) -> None:
        self._request("PATCH", "user_google_tokens", params={"user_id": f"eq.{user_id}"}, json=fields)

    def synced(self, user_id: str, stamp: str) -> None:
        self._request("PATCH", "user_calendar", params={"user_id": f"eq.{user_id}"}, json={"synced_at": stamp})


def build_desired(store, user_id: str, now: datetime) -> dict[str, dict]:
    """Events for this user's saved notices. A deadline the user's own Gemini read from the body fills in when the
    shared notice has none, and notices the user's Gemini judged not relevant are left out (original rule)."""
    notices = store.saved_notices(user_id)
    mine = {row["notice_id"]: row for row in store.judgments(user_id, [n["id"] for n in notices])}
    prepared = []
    for notice in notices:
        info = mine.get(notice["id"]) or {}
        if not notice.get("deadline") and info.get("deadline"):
            notice = {**notice, "deadline": info["deadline"], "deadline_kind": info.get("deadline_kind")}
        prepared.append(notice)
    judgments = {nid: {"ai": {"verdict": row["verdict"]}} for nid, row in mine.items() if row.get("verdict")}
    return desired_events(prepared, prepared, now.astimezone(KST), store.external_sources(), judgments)


def process_user(store, master_key: str, client_id: str, secret: str, row: dict, now: datetime, client_factory=httpx.Client) -> str:
    """One user: ok, skipped (no calendar yet) or error. A broken connection disables the row with a plain reason."""
    user_id = row["user_id"]
    stamp = now.isoformat()
    try:
        refresh = decrypt_api_key(master_key, f"{user_id}:gcal", row["ciphertext"])
    except ByokCryptoError:
        store.update(user_id, {"disabled_at": stamp, "last_error": "저장된 구글 열쇠를 읽지 못했어요. 다시 연결해 주세요."})
        return "error"
    calendar = store.calendar_id(user_id)
    if not calendar:
        return "skipped"   # 브라우저가 캘린더를 만들기 전이다
    try:
        desired = build_desired(store, user_id, now)
        with client_factory(timeout=20) as client:
            token = access_token(client, client_id, secret, refresh)
            client.headers["Authorization"] = f"Bearer {token}"
            added, changed, removed = sync(client, calendar, desired)
    except CalendarError as exc:
        reconnect = "끊겼어요" in str(exc)
        message = RECONNECT if reconnect else str(exc)[:180]
        store.update(user_id, {"last_run_at": stamp, "last_error": message, **({"disabled_at": stamp} if reconnect else {})})
        print(f"gcal {user_id[:8]}: {'연결 끊김' if reconnect else '실패'}", flush=True)
        return "error"
    except httpx.HTTPError as exc:
        store.update(user_id, {"last_run_at": stamp, "last_error": f"구글에 연결하지 못했어요({type(exc).__name__}). 다시 시도해요."})
        return "error"
    store.update(user_id, {"last_run_at": stamp, "last_error": None})
    store.synced(user_id, stamp)
    print(f"gcal {user_id[:8]}: 넣음 {added}, 고침 {changed}, 뺌 {removed}, 지금 {len(desired)}개", flush=True)
    return "ok"


def run(store, master_key: str, client_id: str, secret: str, now: datetime, client_factory=httpx.Client) -> dict[str, int]:
    counts = {"ok": 0, "skipped": 0, "error": 0, "waiting": 0}
    for row in store.tokens():
        last = row.get("last_run_at")
        if last:
            try:
                if now - datetime.fromisoformat(last) < MIN_GAP:
                    counts["waiting"] += 1
                    continue
            except ValueError:
                pass
        counts[process_user(store, master_key, client_id, secret, row, now, client_factory)] += 1
    return counts


def main() -> int:
    master_key = os.environ.get("BYOK_MASTER_KEY", "")
    client_id, secret = os.environ.get("GOOGLE_CLIENT_ID", ""), os.environ.get("GOOGLE_CLIENT_SECRET", "")
    if not (master_key and client_id and secret):
        print("Gcal worker configuration error", flush=True)
        return 1
    try:
        store = GcalStore(os.environ.get("SUPABASE_URL", ""), os.environ.get("SUPABASE_SECRET_KEY", ""))
        try:
            counts = run(store, master_key, client_id, secret, datetime.now(UTC))
        finally:
            store.client.close()
    except (ValueError, StoreError):
        print("Gcal worker configuration or store error", flush=True)
        return 1
    print("Gcal worker: " + " ".join(f"{k}={v}" for k, v in counts.items()), flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
