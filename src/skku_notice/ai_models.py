# ruff: noqa: E501
"""AI 제공업체별 기본 모델. 모두 무료 사용량이 있는 모델이다(유료 키는 지원하지 않는다: 사용자 결정, 2026-11-11).
공식 목록과 한도는 바뀐다. 이 표는 시작값이다.
이 모듈은 google-genai 없이 가져올 수 있어야 한다(OCR 서버 환경).
"""

from __future__ import annotations

import re

PROVIDERS = ("gemini", "groq", "openrouter")
Provider = str  # "gemini" | "groq" | "openrouter"

DEFAULT_MODEL = {
    "gemini": "gemini-3.1-flash-lite",
    "groq": "openai/gpt-oss-20b",
    "openrouter": "openrouter/free",
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
