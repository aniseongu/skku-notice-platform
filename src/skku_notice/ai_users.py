# ruff: noqa: E501
"""한 사용자의 AI 설정을 읽어 라우터를 만들고, 호출 결과를 키 행에 기록한다. 판정 워커와 졸업요건 처리가 함께 쓴다.

- Gemini 키는 기존 `user_byok_keys`, Groq 키는 `user_ai_keys`에 있다. provider가 없는 옛 행은 Gemini다.
- 새 표나 설정 행이 아직 없는 환경이어도 기존처럼 Gemini 키 하나로 동작한다(저장소가 StoreError를 내면 건너뛴다).
- 키 원문은 이 모듈 밖으로 내보내지 않고 로그와 예외에 넣지 않는다.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import datetime, timedelta

from skku_notice.ai_models import DEFAULT_MODEL, cap_for, provider_or_default
from skku_notice.ai_providers import make_client
from skku_notice.ai_router import Candidate, Preferences, RoutedClient
from skku_notice.byok_crypto import ByokCryptoError, decrypt_api_key

LABEL = {"gemini": "Gemini", "groq": "Groq"}
REJECTED_CODES = {400, 401, 403}
# 최근에 실패한 키는 잠시 쉰다. 안 그러면 같은 실패를 10분마다 되풀이해서 한도만 쓴다.
FAILURE_COOLDOWN = timedelta(minutes=20)


def preferences_from_row(row: dict | None) -> Preferences:
    row = row or {}
    return Preferences(
        ai_enabled=row.get("ai_enabled") is not False,
        routing_mode="manual" if row.get("routing_mode") == "manual" else "auto",
        manual_provider=row.get("manual_provider") if row.get("manual_provider") in ("gemini", "groq") else None,
    )


def used_today(row: dict, today: str) -> int:
    return int(row.get("used_today") or 0) if row.get("used_on") == today else 0


@dataclass
class UserAi:
    user_id: str
    rows: dict[str, dict]
    used: dict[str, int]
    candidates: list[Candidate]
    client: RoutedClient
    daily_calls: int
    today: str
    _attempts_seen: int = field(default=0, repr=False)

    @property
    def primary_model(self) -> str | None:
        return self.candidates[0].model if self.candidates else None

    def capped(self) -> bool:
        """등록한 모든 키가 오늘 상한(업체마다 다르다)에 닿았다."""
        return all(self.used.get(c.provider, 0) + self.client.usage.get(c.provider, 0) >= (c.cap or self.daily_calls) for c in self.candidates)

    def settle(self, store, now, counts: dict | None = None) -> None:
        """방금 호출을 키 행에 반영한다: 사용량, 거부된 키 비활성, 한도·오류 문구. 성공한 키는 오류 표시를 지운다."""
        counts = counts if counts is not None else {}
        usage, self.client.usage = dict(self.client.usage), {}
        new_attempts = self.client.attempts[self._attempts_seen:]
        self._attempts_seen = len(self.client.attempts)
        last_by_provider = {a["provider"]: a for a in new_attempts}
        rejected_now = {a["provider"] for a in new_attempts if a.get("kind") == "authentication"}
        for provider, calls in usage.items():
            self.used[provider] = self.used.get(provider, 0) + calls
            fields: dict = {"used_on": self.today, "used_today": self.used[provider]}
            attempt = last_by_provider.get(provider)
            label = LABEL[provider]
            if provider in rejected_now:
                stamp = now.isoformat()
                fields.update(disabled_at=stamp, error_at=stamp, last_error=f"{label}가 이 키를 받아 주지 않아요. 키를 다시 등록해 주세요.")
                counts["rejected"] = counts.get("rejected", 0) + 1
            elif attempt and not attempt["ok"]:
                code = attempt.get("code")
                fields.update(error_at=now.isoformat(), last_error=(
                    f"{label} 사용 한도를 넘었어요. 잠시 뒤 다시 시도해요." if code == 429 or attempt.get("kind") == "rate_limit"
                    else f"{label} 판정을 잠시 못 했어요. 다시 시도해요."))
            else:
                fields.update(last_error=None, error_at=None)
            _update(store, self.user_id, provider, fields)
        for candidate in self.candidates:
            candidate.used_today = self.used.get(candidate.provider, 0)
        if self.client.failed and not rejected_now and usage:
            counts["errors"] = counts.get("errors", 0) + 1
        if self.client.failed and not usage:
            # 쓸 수 있는 AI 후보가 없어 호출하지 않았다: 키는 건드리지 않고 코드 기반 경로로 둔다.
            counts["ai_fallback"] = counts.get("ai_fallback", 0) + 1


def _cooling(row: dict, now: datetime) -> bool:
    """마지막 실패가 쿨다운 안이면 True. 성공하면 error_at이 비워져 곧바로 풀린다."""
    if not row.get("last_error") or not isinstance(row.get("error_at"), str):
        return False
    try:
        at = datetime.fromisoformat(row["error_at"].replace("Z", "+00:00"))
    except ValueError:
        return False
    return at.tzinfo is not None and now - at < FAILURE_COOLDOWN


def _update(store, user_id: str, provider: str, fields: dict) -> None:
    if provider == "gemini":
        store.update_key(user_id, fields)
    else:
        store.update_ai_key(user_id, provider, fields)


def gather_rows(store, user_id: str, gemini_row: dict | None) -> dict[str, dict]:
    rows: dict[str, dict] = {}
    if gemini_row and not gemini_row.get("disabled_at"):
        rows["gemini"] = gemini_row
    ai_keys = getattr(store, "ai_keys_for", None)
    for extra in (ai_keys(user_id) if ai_keys else []):
        provider = provider_or_default(extra.get("provider"))
        if provider != "gemini" and not extra.get("disabled_at"):
            rows[provider] = extra
    return rows


def build_user_ai(
    store, master_key: str, user_id: str, rows: dict[str, dict], today: str, now, daily_calls: int,
    gemini_client_for: Callable[[str], object], provider_client_for: Callable[[str, str], object] = make_client,
    counts: dict | None = None,
) -> UserAi:
    """키를 풀어 후보를 만든다. 읽지 못하는 키는 비활성으로 표시하고 후보에서 뺀다."""
    prefs_reader = getattr(store, "preferences", None)
    prefs = preferences_from_row(prefs_reader(user_id) if prefs_reader else None)
    candidates, used = [], {}
    for provider, row in rows.items():
        used[provider] = used_today(row, today)
        try:
            # Gemini 키는 사용자 ID에, 다른 업체 키는 "<사용자 ID>:<업체>"에 묶인 암호문이다.
            aad = user_id if provider == "gemini" else f"{user_id}:{provider}"
            api_key = decrypt_api_key(master_key, aad, row["ciphertext"])
        except ByokCryptoError:
            stamp = now.isoformat()
            _update(store, user_id, provider, {"disabled_at": stamp, "error_at": stamp,
                                              "last_error": "저장된 키를 읽지 못했어요. 다시 등록해 주세요."})
            if counts is not None:
                counts["errors"] = counts.get("errors", 0) + 1
            continue
        cap = cap_for(provider, daily_calls)
        if used[provider] < cap and not _cooling(row, now):
            candidates.append(Candidate(provider, row.get("model") or DEFAULT_MODEL[provider], api_key, used[provider], cap))

    def factory(provider: str, api_key: str):
        return gemini_client_for(api_key) if provider == "gemini" else provider_client_for(provider, api_key)

    client = RoutedClient(candidates, prefs, factory=factory, provider_cap=daily_calls)
    return UserAi(user_id, rows, used, candidates, client, daily_calls, today)
