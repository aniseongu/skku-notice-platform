# ruff: noqa: E501
"""AI 제공업체별 기본 모델. 모두 무료 사용량이 있는 모델이다(유료 키는 지원하지 않는다: 사용자 결정, 2026-11-11).
공식 목록과 한도는 바뀐다. 이 표는 시작값이다.
이 모듈은 google-genai 없이 가져올 수 있어야 한다(OCR 서버 환경).
"""

from __future__ import annotations

import re

PROVIDERS = ("gemini", "groq")
Provider = str  # "gemini" | "groq"

# 업체마다 무료 한도가 달라서 모든 키를 같은 숫자로 자르지 않는다. 하루 상한(daily_calls)에 업체별 비율을 곱한다.
# 2026-11 웹 조사(공식 문서가 표를 내리거나 출처마다 달라 모두 바뀔 수 있다): Gemini Flash-Lite 무료 약 500회/일(분당 15회),
# Groq 무료는 모델별 약 1,000회/일(분당 30회)이다. 그래서 앱 상한은 실제 한도보다 훨씬 낮게 둔다.
# OpenRouter는 2026-11-12에 뺐다: 무료 자동 선택이 요청마다 1~3B급 모델을 무작위로 골라 판정과 이유 문장이 엉터리로 저장됐다(사용자 결정).
CAP_RATIO = {"gemini": 1.0, "groq": 1.0}


def cap_for(provider: str, daily_calls: int) -> int:
    """이 업체의 키 하나에 오늘 쓸 수 있는 호출 수."""
    return max(1, round(daily_calls * CAP_RATIO.get(provider, 1.0)))


DEFAULT_MODEL = {
    "gemini": "gemini-3.1-flash-lite",
    "groq": "openai/gpt-oss-20b",
}
# 구조화(JSON 스키마) 출력을 쓸 수 있다고 확인한 모델. 그 밖의 모델은 JSON 모드 후 검증한다.
STRICT_SCHEMA_MODELS = {
    ("groq", "openai/gpt-oss-20b"), ("groq", "openai/gpt-oss-120b"),
}
_MODEL_PATTERN = re.compile(r"^[A-Za-z0-9._:/-]{3,100}$")


def valid_model_id(model: object) -> bool:
    return isinstance(model, str) and bool(_MODEL_PATTERN.match(model))


def supports_strict_schema(provider: str, model: str) -> bool:
    return (provider, model) in STRICT_SCHEMA_MODELS


def supports_images(provider: str, model: str) -> bool:
    """공고 그림을 직접 보내도 되는 모델. 확인한 것은 Gemini뿐이고, 다른 업체는 OCR 텍스트만 쓴다."""
    return provider == "gemini"


def provider_or_default(value: object) -> str:
    """provider가 비었거나 모르는 값이면 기존 Gemini로 읽는다(옛 행 호환)."""
    return value if isinstance(value, str) and value in PROVIDERS else "gemini"
