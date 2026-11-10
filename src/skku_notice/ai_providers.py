# ruff: noqa: E501
"""Groq와 OpenRouter 어댑터. Gemini 클라이언트와 같은 `client.models.generate_content(...)` 인터페이스를 흉내 낸다.

판정 모듈(intern_ai, school_ai, judge 등)은 contents에 google.genai Part를, config에 GenerateContentConfig를 넘기고
`response.text`를 읽는다. 어댑터가 이를 OpenAI 호환 Chat Completions 요청으로 바꾸므로 판정 모듈은 고치지 않는다.
- 사용자의 키는 요청 헤더에만 쓰고 로그, 예외 문구, 반환값에 넣지 않는다.
- 실패는 `.code`(HTTP 상태)가 있는 ProviderError로 올린다. 호출한 쪽은 기존처럼 결정 없음으로 처리한다.
- 그림은 보내지 않는다(텍스트 전용). 그림이 필요한 작업은 라우터가 Gemini 후보만 고른다.
이 모듈은 google-genai 없이 가져올 수 있어야 한다.
"""

from __future__ import annotations

import json
from types import SimpleNamespace

import httpx

from skku_notice.ai_models import supports_strict_schema

BASE_URL = {"groq": "https://api.groq.com/openai/v1", "openrouter": "https://openrouter.ai/api/v1"}
TIMEOUT_SECONDS = 60.0
MAX_OUTPUT_TOKENS = 4096


class ProviderError(Exception):
    """제공업체 호출 실패. 문구에는 키나 요청 내용을 넣지 않는다."""

    def __init__(self, code: int | None, kind: str, retry_after: float | None = None):
        super().__init__(f"{kind} ({code})" if code else kind)
        self.code = code
        self.kind = kind  # rate_limit | authentication | payment | unavailable | bad_request | bad_output | network
        self.retry_after = retry_after


def classify(code: int | None) -> str:
    if code == 429:
        return "rate_limit"
    if code in (401, 403):
        return "authentication"
    if code == 402:
        return "payment"
    if code in (408, 500, 502, 503, 504, 529):
        return "unavailable"
    if code in (400, 404, 422):
        return "bad_request"
    return "unavailable"


def json_schema(schema: object) -> object:
    """Gemini 방식 스키마(`OBJECT`, `STRING` 등 대문자 형식)를 JSON Schema로 바꾼다."""
    if isinstance(schema, dict):
        out = {}
        for key, value in schema.items():
            if key == "type" and isinstance(value, str):
                out[key] = value.lower()
            else:
                out[key] = json_schema(value)
        if out.get("type") == "object":
            out.setdefault("additionalProperties", False)
        return out
    if isinstance(schema, list):
        return [json_schema(v) for v in schema]
    return schema


def _text_of(contents: object) -> str:
    parts = contents if isinstance(contents, list) else [contents]
    texts = []
    for part in parts:
        text = part if isinstance(part, str) else getattr(part, "text", None)
        if isinstance(text, str):
            texts.append(text)
        # 그림 등 바이너리 부분은 이 어댑터가 보내지 않는다.
    return "\n".join(texts)


class _Models:
    def __init__(self, provider: str, api_key: str, http: httpx.Client | None):
        self._provider, self._api_key, self._http = provider, api_key, http

    def generate_content(self, *, model: str, contents: object, config: object | None = None):
        system = getattr(config, "system_instruction", None)
        schema = getattr(config, "response_schema", None)
        messages = []
        if isinstance(system, str) and system:
            messages.append({"role": "system", "content": system})
        user = _text_of(contents)
        if schema is not None and not supports_strict_schema(self._provider, model):
            # 스키마를 지원하지 않는 모델은 JSON 모드로 받고 호출한 쪽이 형식을 검증한다.
            user += "\n\n반드시 아래 JSON 스키마를 따르는 JSON 객체 하나만 답하세요.\n" + json.dumps(
                json_schema(schema), ensure_ascii=False)
        messages.append({"role": "user", "content": user})
        body: dict = {"model": model, "messages": messages, "temperature": getattr(config, "temperature", 0) or 0,
                      "max_tokens": MAX_OUTPUT_TOKENS}
        if schema is not None:
            if supports_strict_schema(self._provider, model):
                body["response_format"] = {"type": "json_schema", "json_schema": {
                    "name": "result", "strict": False, "schema": json_schema(schema)}}
            else:
                body["response_format"] = {"type": "json_object"}
        headers = {"Authorization": f"Bearer {self._api_key}", "Content-Type": "application/json"}
        if self._provider == "openrouter":
            headers["X-Title"] = "SKKU Notice Platform"
        try:
            http = self._http or httpx.Client(timeout=TIMEOUT_SECONDS)
            response = http.post(f"{BASE_URL[self._provider]}/chat/completions", json=body, headers=headers)
        except httpx.HTTPError as exc:
            # 예외 문구에는 요청 주소와 헤더가 들어갈 수 있어 종류만 남긴다.
            raise ProviderError(None, "network") from exc
        if response.status_code >= 400:
            retry = response.headers.get("retry-after", "")
            raise ProviderError(response.status_code, classify(response.status_code),
                                float(retry) if retry.replace(".", "", 1).isdigit() else None)
        try:
            payload = response.json()
            choice = payload["choices"][0]
            text = choice["message"]["content"]
        except (ValueError, KeyError, IndexError, TypeError) as exc:
            raise ProviderError(None, "bad_output") from exc
        if not isinstance(text, str) or not text.strip() or choice.get("finish_reason") == "length":
            raise ProviderError(None, "bad_output")
        usage = payload.get("usage") if isinstance(payload.get("usage"), dict) else {}
        return SimpleNamespace(text=text, usage=usage, model=payload.get("model") or model)


class OpenAICompatClient:
    def __init__(self, provider: str, api_key: str, http: httpx.Client | None = None):
        if provider not in BASE_URL:
            raise ValueError("unsupported provider")
        self.provider = provider
        self.models = _Models(provider, api_key, http)


def make_client(provider: str, api_key: str, http: httpx.Client | None = None):
    """업체별 클라이언트. Gemini는 기존 클라이언트를 그대로 쓴다."""
    if provider == "gemini":
        from skku_notice.gemini_client import gemini_client

        return gemini_client(api_key)
    return OpenAICompatClient(provider, api_key, http)
