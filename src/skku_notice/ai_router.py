# ruff: noqa: E501
"""사용자 본인 키 사이에서 AI 호출을 고르는 라우터.

`RoutedClient`는 Gemini 클라이언트와 같은 `client.models.generate_content(...)` 인터페이스를 가진다. 판정 모듈은 그대로 쓴다.
- 후보는 사용자가 등록하고 켜 둔 본인 키뿐이다. 운영자 키나 다른 사용자의 키는 없다.
- 직접 선택이면 고른 업체 하나만 쓰고 다른 업체로 몰래 넘기지 않는다. 자동 선택은 사용자가 동의한 뒤에만 후보를 순회한다.
- 무료 우선(기본)이면 무료로 확인되지 않은 모델은 후보에서 뺀다. 유료는 사용자가 허용했을 때만 쓴다.
- 모든 후보가 없거나 실패하면 예외를 올린다. 호출한 쪽은 기존처럼 결정 없음으로 돌려 코드 기반 경로를 유지한다.
- 같은 요청을 여러 업체에 동시에 보내지 않는다. 한 후보씩 시도한다.
이 모듈은 google-genai 없이 가져올 수 있어야 한다.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass, field
from types import SimpleNamespace

from skku_notice.ai_models import PROVIDERS, cost_class, supports_images
from skku_notice.ai_providers import ProviderError, classify, make_client

# 이 사유들일 때만 자동 선택에서 다음 본인 키로 넘어간다. 요청 규격 오류(400)는 키를 바꿔도 같다.
FALLBACK_KINDS = {"rate_limit", "unavailable", "authentication", "payment", "bad_output", "network", "model_unavailable"}
PROVIDER_ORDER = {name: index for index, name in enumerate(PROVIDERS)}


@dataclass
class Candidate:
    provider: str
    model: str
    api_key: str = field(repr=False)  # repr에 키가 찍히지 않게 한다
    used_today: int = 0


@dataclass
class Preferences:
    ai_enabled: bool = True
    routing_mode: str = "manual"  # manual | auto
    auto_routing_consent: bool = False
    manual_provider: str | None = None
    free_only: bool = True
    paid_opt_in: bool = False
    daily_request_cap: int | None = None

    @property
    def auto(self) -> bool:
        return self.routing_mode == "auto" and self.auto_routing_consent

    @property
    def paid_allowed(self) -> bool:
        return self.paid_opt_in and not self.free_only


class NoProvider(Exception):
    """쓸 수 있는 AI 후보가 없다. code는 항상 None이고 reason이 이유다(no_key, user_disabled 등)."""

    code = None

    def __init__(self, reason: str):
        super().__init__(reason)
        self.reason = reason


def _has_image(contents: object) -> bool:
    parts = contents if isinstance(contents, list) else [contents]
    return any(getattr(part, "inline_data", None) is not None for part in parts)


def select_candidates(candidates: list[Candidate], prefs: Preferences, needs_images: bool = False) -> tuple[list[Candidate], str | None]:
    """하드 필터를 통과한 후보를 시도할 순서대로 돌려준다. 비면 이유를 함께 돌려준다."""
    if not prefs.ai_enabled:
        return [], "user_disabled"
    pool = [c for c in candidates if c.provider in PROVIDERS and c.api_key]
    if not pool:
        return [], "no_key"
    if not prefs.auto:
        wanted = prefs.manual_provider
        if wanted is None:
            # 고른 업체가 없으면 기존 사용자의 Gemini를 쓰고, 없으면 등록한 첫 업체 하나만 쓴다.
            wanted = min(pool, key=lambda c: PROVIDER_ORDER[c.provider]).provider
        pool = [c for c in pool if c.provider == wanted]
        if not pool:
            return [], "no_key"
    if needs_images:
        pool = [c for c in pool if supports_images(c.provider, c.model)]
        if not pool:
            return [], "model_unavailable"
    if not prefs.paid_allowed:
        pool = [c for c in pool if cost_class(c.provider, c.model) == "free"]
        if not pool:
            return [], "paid_not_allowed"
    total = sum(c.used_today for c in candidates)  # 분산해도 예산은 연결한 모든 업체의 합산이다
    if prefs.daily_request_cap is not None and total >= prefs.daily_request_cap:
        return [], "quota_exhausted"
    # 무료 후보를 먼저, 그다음 오늘 덜 쓴 키, 같으면 고정 순서. 어느 업체가 낫다고 하드코딩하지 않는다.
    pool.sort(key=lambda c: (cost_class(c.provider, c.model) != "free", c.used_today, PROVIDER_ORDER[c.provider]))
    return pool, None


class RoutedClient:
    """`models.generate_content(**kwargs)`를 후보 순서대로 시도한다. 성공한 응답의 업체와 모델을 남긴다."""

    def __init__(self, candidates: list[Candidate], prefs: Preferences | None = None,
                 factory: Callable[[str, str], object] = make_client, provider_cap: int | None = None):
        self.models = self
        self._provider_cap = provider_cap
        self._candidates, self._prefs, self._factory = candidates, prefs or Preferences(), factory
        self.attempts: list[dict] = []  # 키와 내용은 넣지 않는다: 업체, 모델, 결과, 사유뿐
        self.usage: dict[str, int] = {}  # 업체별 이번 실행 호출 수(실패 포함)
        self.rejected: set[str] = set()  # 키를 거부한 업체(401/403)
        self.limited: set[str] = set()  # 한도에 걸린 업체(429)
        self.cooldown: set[str] = set()  # 이번 실행에서 더 시도하지 않는 업체
        self.failed = False
        self.error_code: int | None = None
        self.execution_mode = "code"
        self.provider: str | None = None
        self.model: str | None = None
        self.fallback_reason: str | None = None

    def generate_content(self, **kwargs):
        ranked, reason = select_candidates(self._candidates, self._prefs, _has_image(kwargs.get("contents")))
        ranked = [c for c in ranked if c.provider not in self.cooldown and c.provider not in self.rejected
                  and (self._provider_cap is None or c.used_today + self.usage.get(c.provider, 0) < self._provider_cap)]
        if not ranked:
            self._fail(reason or "quota_exhausted", None)
            raise NoProvider(self.fallback_reason or "quota_exhausted")
        last: ProviderError | Exception | None = None
        for candidate in ranked:
            cap = self._prefs.daily_request_cap
            if cap is not None and sum(c.used_today + self.usage.get(c.provider, 0) for c in self._candidates) >= cap:
                break
            client = self._factory(candidate.provider, candidate.api_key)
            self.usage[candidate.provider] = self.usage.get(candidate.provider, 0) + 1
            try:
                response = client.models.generate_content(**{**kwargs, "model": candidate.model})
            except Exception as exc:  # noqa: BLE001 - 업체 SDK마다 예외가 달라 코드 번호로만 분류한다
                code = getattr(exc, "code", None)
                code = code if isinstance(code, int) else None
                kind = getattr(exc, "kind", None) or (classify(code) if code else "network")
                if candidate.provider == "gemini" and code == 400:
                    kind = "authentication"  # Gemini는 잘못된 키에도 400을 준다(기존 동작과 같다)
                self.attempts.append({"provider": candidate.provider, "model": candidate.model, "ok": False,
                                      "kind": kind, "code": code})
                if kind == "authentication":
                    self.rejected.add(candidate.provider)
                elif kind == "rate_limit":
                    self.limited.add(candidate.provider)
                    self.cooldown.add(candidate.provider)
                elif kind in {"unavailable", "network"}:
                    self.cooldown.add(candidate.provider)
                self._fail(_REASON.get(kind, "provider_unavailable"), code)
                last = exc
                if not self._prefs.auto or kind not in FALLBACK_KINDS:
                    break
                continue
            self.attempts.append({"provider": candidate.provider, "model": candidate.model, "ok": True})
            self.failed, self.error_code, self.fallback_reason = False, None, None
            # openrouter/free처럼 요청한 이름과 실제로 답한 모델이 다를 수 있다. 답한 모델을 기록한다.
            resolved = getattr(response, "model", None)
            resolved = resolved if isinstance(resolved, str) and 3 <= len(resolved) <= 100 else candidate.model
            self.execution_mode, self.provider, self.model = "ai", candidate.provider, resolved
            return response
        if last is None:  # 호출 상한에 막혀 한 번도 못 부른 경우
            self._fail("quota_exhausted", None)
            raise NoProvider("quota_exhausted")
        raise last

    def _fail(self, reason: str, code: int | None) -> None:
        self.failed, self.error_code, self.fallback_reason = True, code, reason
        self.execution_mode, self.provider, self.model = "code", None, None

    def result(self) -> SimpleNamespace:
        """마지막 호출의 출처. 코드 폴백이면 업체와 모델은 None이다."""
        return SimpleNamespace(execution_mode=self.execution_mode, provider=self.provider, model=self.model,
                               fallback_reason=self.fallback_reason)


_REASON = {
    "rate_limit": "quota_exhausted", "authentication": "authentication", "payment": "paid_not_allowed",
    "unavailable": "provider_unavailable", "network": "provider_unavailable", "bad_output": "provider_unavailable",
    "bad_request": "model_unavailable", "model_unavailable": "model_unavailable",
}
