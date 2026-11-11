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
import re
from types import SimpleNamespace

import httpx

from skku_notice.ai_models import supports_strict_schema

BASE_URL = {"groq": "https://api.groq.com/openai/v1", "openrouter": "https://openrouter.ai/api/v1"}
TIMEOUT_SECONDS = 60.0
MAX_OUTPUT_TOKENS = 8192


class ProviderError(Exception):
    """제공업체 호출 실패. 문구에는 키나 요청 내용을 넣지 않는다."""

    def __init__(self, code: int | None, kind: str, retry_after: float | None = None, detail: str = ""):
        super().__init__(f"{kind} ({code})" if code else kind)
        self.code = code
        self.detail = detail  # 업체가 알려 준 짧은 사유(키는 지운다). 진단 로그에만 쓴다
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


def _detail(response, api_key: str) -> str:
    """업체 오류 본문의 error.message 앞부분. 키가 섞여 있으면 지운다."""
    try:
        error = response.json().get("error")
        message = error.get("message") if isinstance(error, dict) else error
    except (ValueError, AttributeError):
        return ""
    text = " ".join(str(message or "").split())[:160]
    return text.replace(api_key, "***") if api_key else text


class _Models:
    def __init__(self, provider: str, api_key: str, http: httpx.Client | None):
        self._provider, self._api_key, self._http = provider, api_key, http

    def _body(self, model: str, contents: object, config: object | None, json_mode_only: bool = False) -> dict:
        system = getattr(config, "system_instruction", None)
        schema = getattr(config, "response_schema", None)
        messages = []
        if isinstance(system, str) and system:
            messages.append({"role": "system", "content": system})
        user = _text_of(contents)
        strict = supports_strict_schema(self._provider, model) and not json_mode_only
        if schema is not None and not strict:
            # 스키마를 지원하지 않는 모델은 JSON 모드로 받고 호출한 쪽이 형식을 검증한다.
            user += "\n\n반드시 아래 JSON 스키마를 따르는 JSON 객체 하나만 답하세요.\n" + json.dumps(
                json_schema(schema), ensure_ascii=False)
        messages.append({"role": "user", "content": user})
        body: dict = {"model": model, "messages": messages, "temperature": getattr(config, "temperature", 0) or 0}
        # 출처: https://console.groq.com/docs/reasoning, https://openrouter.ai/docs/guides/best-practices/reasoning-tokens
        # 추론 토큰도 답 길이 한도에 들어가서, 추론이 길면 내용이 빈 채로 finish_reason이 length로 끝난다. 추론을 낮춘다.
        if self._provider == "groq":
            body["max_completion_tokens"] = MAX_OUTPUT_TOKENS
            if model.startswith("openai/gpt-oss"):
                body["reasoning_effort"] = "low"
                body["include_reasoning"] = False
        else:
            body["max_tokens"] = MAX_OUTPUT_TOKENS
            body["reasoning"] = {"effort": "low"}
        if schema is not None:
            if strict:
                body["response_format"] = {"type": "json_schema", "json_schema": {
                    "name": "result", "strict": False, "schema": json_schema(schema)}}
            else:
                body["response_format"] = {"type": "json_object"}
        return body

    def generate_content(self, *, model: str, contents: object, config: object | None = None):
        body = self._body(model, contents, config)
        headers = {"Authorization": f"Bearer {self._api_key}", "Content-Type": "application/json"}
        if self._provider == "openrouter":
            headers["X-Title"] = "SKKU Notice Platform"
        try:
            http = self._http or httpx.Client(timeout=TIMEOUT_SECONDS)
            response = http.post(f"{BASE_URL[self._provider]}/chat/completions", json=body, headers=headers)
        except httpx.HTTPError as exc:
            # 예외 문구에는 요청 주소와 헤더가 들어갈 수 있어 종류만 남긴다.
            raise ProviderError(None, "network") from exc
        if (response.status_code == 400 and body.get("response_format", {}).get("type") == "json_schema"
                and re.search(r"response_format|json_schema|structured", _detail(response, self._api_key), re.I)):
            # 이 모델이 스키마 모드를 받지 않는다. JSON 모드로 한 번만 다시 보낸다(호출한 쪽이 형식을 검증한다).
            body = self._body(model, contents, config, json_mode_only=True)
            try:
                response = http.post(f"{BASE_URL[self._provider]}/chat/completions", json=body, headers=headers)
            except httpx.HTTPError as exc:
                raise ProviderError(None, "network") from exc
        if response.status_code >= 400:
            retry = response.headers.get("retry-after", "")
            raise ProviderError(response.status_code, classify(response.status_code),
                                float(retry) if retry.replace(".", "", 1).isdigit() else None,
                                _detail(response, self._api_key))
        try:
            payload = response.json()
        except ValueError as exc:
            raise ProviderError(None, "bad_output", detail="not json") from exc
        # 출처: https://openrouter.ai/docs/api/reference/errors-and-debugging
        # 요청이 받아들여진 뒤 실패하면 HTTP는 200이고 본문에 error만 오거나, choices 안에 finish_reason "error"와 error가 같이 온다.
        error = payload.get("error") if isinstance(payload, dict) else None
        if error is None and isinstance(payload, dict):
            choices = payload.get("choices")
            first = choices[0] if isinstance(choices, list) and choices and isinstance(choices[0], dict) else {}
            error = first.get("error")
        if error:
            code = error.get("code") if isinstance(error, dict) else None
            code = code if isinstance(code, int) else None
            note = (error.get("message") if isinstance(error, dict) else error) or "error"
            raise ProviderError(code, classify(code) if code else "bad_output",
                                detail=" ".join(str(note).split())[:160].replace(self._api_key, "***"))
        text, why = _extract_text(payload)
        if text is None:
            raise ProviderError(None, "bad_output", detail=why)
        usage = payload.get("usage") if isinstance(payload.get("usage"), dict) else {}
        return SimpleNamespace(text=text, usage=usage, model=payload.get("model") or model)


_FENCE = re.compile(r"^```(?:json)?\s*(.*?)\s*```$", re.S)


def _extract_text(payload: object) -> tuple[str | None, str]:
    """답 글자를 꺼낸다. 코드 블록(```json)으로 감싼 답과 글자 조각 목록으로 온 답도 받는다. 못 꺼내면 (None, 이유)."""
    try:
        choice = payload["choices"][0]  # type: ignore[index]
        content = choice["message"]["content"]
    except (KeyError, IndexError, TypeError):
        return None, "no choices"
    if isinstance(content, list):
        content = "".join(part.get("text", "") for part in content if isinstance(part, dict))
    if not isinstance(content, str) or not content.strip():
        return None, f"empty content finish={choice.get('finish_reason')}"
    text = content.strip()
    fenced = _FENCE.match(text)
    if fenced:
        text = fenced.group(1)
    if choice.get("finish_reason") == "length":
        # 잘린 답이면 JSON이 끝까지 닫히지 않는다. 호출한 쪽이 형식을 검증해서 버린다.
        try:
            json.loads(text)
        except ValueError:
            return None, "truncated (finish=length)"
    return text, ""


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
