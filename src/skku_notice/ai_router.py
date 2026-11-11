# ruff: noqa: E501
"""사용자 본인 키 사이에서 AI 호출을 고르는 라우터.

`RoutedClient`는 Gemini 클라이언트와 같은 `client.models.generate_content(...)` 인터페이스를 가진다. 판정 모듈은 그대로 쓴다.
- 후보는 사용자가 등록하고 켜 둔 본인 키뿐이다. 운영자 키나 다른 사용자의 키는 없다.
- 기본은 자동 선택이다: 사용자가 키를 연결한 곳 사이에서 알아서 고르고, 실패하면 다음 곳으로 넘어간다. 업체를 고르는 질문은 하지 않는다.
  (옛 설정 행이 직접 선택(manual)이면 그 업체 하나만 쓰고 넘기지 않는다.)
- 무료만 쓴다고 본다. 유료 키는 지원하지 않으므로 요금 설정도, 유료 모델 분류도 없다(사용자 결정, 2026-11-11).
- 모든 후보가 없거나 실패하면 예외를 올린다. 호출한 쪽은 기존처럼 결정 없음으로 돌려 코드 기반 경로를 유지한다.
- 같은 요청을 여러 업체에 동시에 보내지 않는다. 한 후보씩 시도한다.
이 모듈은 google-genai 없이 가져올 수 있어야 한다.
"""

from __future__ import annotations

import sys
from collections.abc import Callable
from dataclasses import dataclass, field
from types import SimpleNamespace

from skku_notice.ai_models import PROVIDERS, supports_images
from skku_notice.ai_providers import ProviderError, classify, make_client

# 이 사유들일 때만 자동 선택에서 다음 본인 키로 넘어간다. 요청 규격 오류(400)는 키를 바꿔도 같다.
FALLBACK_KINDS = {"rate_limit", "unavailable", "authentication", "payment", "bad_output", "network", "model_unavailable", "too_large"}
PROVIDER_ORDER = {name: index for index, name in enumerate(PROVIDERS)}


@dataclass
class Candidate:
    provider: str
    model: str
    api_key: str = field(repr=False)  # repr에 키가 찍히지 않게 한다
    used_today: int = 0
    cap: int = 0  # 이 키의 오늘 상한(업체마다 다르다). 0이면 모른다

    @property
    def load(self) -> float:
        """오늘 상한 중 쓴 비율. 상한이 다른 키를 공평하게 비교하는 기준이다."""
        return self.used_today / self.cap if self.cap else float(self.used_today)


@dataclass
class Preferences:
    ai_enabled: bool = True
    routing_mode: str = "auto"  # auto(기본) | manual(옛 설정 행)
    manual_provider: str | None = None

    @property
    def auto(self) -> bool:
        return self.routing_mode == "auto"



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
    # 오늘 상한 대비 덜 쓴 키를 먼저, 같으면 고정 순서. 어느 업체가 낫다고 하드코딩하지 않는다.
    # 절대 횟수가 아니라 비율로 비교해서, 상한이 낮은 키가 먼저 바닥나지 않게 한다(LiteLLM의 업체별 rpm 한도 필터와 같은 생각).
    pool.sort(key=lambda c: (c.load, PROVIDER_ORDER[c.provider]))
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
                  and (c.used_today + self.usage.get(c.provider, 0) < (c.cap or self._provider_cap or 10**9))]
        # 이번 실행에서 방금 쓴 호출도 비율에 넣어, 한 키만 계속 쓰다 상한에 닿지 않고 키들을 번갈아 쓴다.
        ranked.sort(key=lambda c: ((c.used_today + self.usage.get(c.provider, 0)) / c.cap if c.cap
                                   else float(c.used_today + self.usage.get(c.provider, 0)), PROVIDER_ORDER[c.provider]))
        if not ranked:
            self._fail(reason or "quota_exhausted", None)
            raise NoProvider(self.fallback_reason or "quota_exhausted")
        last: ProviderError | Exception | None = None
        for candidate in ranked:
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
                # 진단용: 업체, 모델, 상태와 업체가 알려 준 짧은 사유(키·공지 내용은 없다)
                print(f"AI 호출 실패: {candidate.provider} {candidate.model} {code or kind} {getattr(exc, 'detail', '')}",
                      file=sys.stderr)
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
            # 요청한 이름과 실제로 답한 모델이 다를 수 있다. 답한 모델을 기록한다.
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
    "too_large": "request_too_large", "unavailable": "provider_unavailable", "network": "provider_unavailable", "bad_output": "provider_unavailable",
    "bad_request": "model_unavailable", "model_unavailable": "model_unavailable",
}
