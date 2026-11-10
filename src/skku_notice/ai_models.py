# ruff: noqa: E501
"""AI 제공업체별 기본 모델과 비용 분류.

키는 무료 키와 유료 키로 나뉘지 않는다. 같은 키라도 계정 상태와 모델에 따라 비용이 달라서, 비용은 (업체, 모델)로 분류한다.
- free: 무료 사용량이 있는 것으로 알려진 모델(계정 상태에 따라 유료일 수 있음)
- paid: 유료로 확인된 모델
- unknown: 확인하지 못한 모델. 무료 우선 모드에서는 쓰지 않는다.
공식 목록과 한도는 바뀐다. 이 표는 시작값이고 사용자가 모델을 고르면 그 값을 따른다.
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


def cost_class(provider: str, model: str) -> str:
    """무료 우선 모드에서 쓸 수 있는지를 가르는 분류. 확신이 없으면 unknown이다."""
    if not valid_model_id(model):
        return "unknown"
    if provider == "gemini":
        # 기존 사용자의 flash 계열 모델은 무료 사용량이 있다. pro 계열은 유료로 본다.
        if re.search(r"-pro", model):
            return "paid"
        return "free" if model.startswith("gemini-") and "flash" in model else "unknown"
    if provider == "groq":
        # Groq는 계정 플랜에 따라 한도가 다르다. 기본 후보 모델만 무료 사용량이 있는 것으로 본다.
        return "free" if model in {m for p, m in STRICT_SCHEMA_MODELS if p == "groq"} else "unknown"
    if provider == "openrouter":
        return "free" if model == "openrouter/free" or model.endswith(":free") else "paid"
    return "unknown"


def supports_strict_schema(provider: str, model: str) -> bool:
    return (provider, model) in STRICT_SCHEMA_MODELS


def supports_images(provider: str, model: str) -> bool:
    """공고 그림을 직접 보내도 되는 모델. 확인한 것은 Gemini뿐이고, 다른 업체는 OCR 텍스트만 쓴다."""
    return provider == "gemini"


def provider_or_default(value: object) -> str:
    """provider가 비었거나 모르는 값이면 기존 Gemini로 읽는다(옛 행 호환)."""
    return value if isinstance(value, str) and value in PROVIDERS else "gemini"
