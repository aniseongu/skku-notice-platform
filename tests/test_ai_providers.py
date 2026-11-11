# ruff: noqa: E501
import json

import httpx
import pytest
from google.genai import types

from skku_notice.ai_models import provider_or_default, valid_model_id
from skku_notice.ai_providers import OpenAICompatClient, ProviderError, json_schema
from skku_notice.school_ai import SCHEMA, SYSTEM, judge_school_notices

SECRET = "gsk_" + "S" * 30


def client_for(provider, handler):
    return OpenAICompatClient(provider, SECRET, httpx.Client(transport=httpx.MockTransport(handler)))


def ok_body(text, model="m"):
    return {"model": model, "choices": [{"message": {"content": text}, "finish_reason": "stop"}], "usage": {"total_tokens": 9}}


def test_schema_is_converted_to_json_schema():
    converted = json_schema(SCHEMA)
    assert converted["type"] == "object" and converted["properties"]["items"]["type"] == "array"
    assert converted["additionalProperties"] is False
    assert SCHEMA["type"] == "OBJECT"  # 원본은 바뀌지 않는다


def test_request_uses_bearer_header_system_prompt_and_strict_schema_for_known_model():
    seen = {}

    def handler(request):
        seen["url"], seen["auth"], seen["body"] = str(request.url), request.headers["authorization"], json.loads(request.content)
        return httpx.Response(200, json=ok_body('{"items": []}'))

    config = types.GenerateContentConfig(system_instruction="규칙", temperature=0, response_mime_type="application/json", response_schema=SCHEMA)
    reply = client_for("groq", handler).models.generate_content(
        model="openai/gpt-oss-20b", contents=[types.Part.from_text(text="질문")], config=config)
    assert reply.text == '{"items": []}'
    assert seen["url"] == "https://api.groq.com/openai/v1/chat/completions"
    assert seen["auth"] == f"Bearer {SECRET}"
    assert seen["body"]["messages"][0] == {"role": "system", "content": "규칙"}
    assert seen["body"]["response_format"]["type"] == "json_schema"
    assert SECRET not in json.dumps(seen["body"])


def test_unknown_model_uses_json_mode_and_embeds_schema_in_prompt():
    seen = {}

    def handler(request):
        seen["body"] = json.loads(request.content)
        return httpx.Response(200, json=ok_body("{}"))

    config = types.GenerateContentConfig(system_instruction="규칙", response_schema=SCHEMA)
    client_for("openrouter", handler).models.generate_content(
        model="openrouter/free", contents=[types.Part.from_text(text="질문")], config=config)
    assert seen["body"]["response_format"] == {"type": "json_object"}
    assert "JSON 스키마" in seen["body"]["messages"][-1]["content"]


def test_images_are_never_sent_to_openai_compatible_providers():
    seen = {}

    def handler(request):
        seen["raw"] = request.content.decode()
        return httpx.Response(200, json=ok_body("{}"))

    contents = [types.Part.from_text(text="본문"), types.Part.from_bytes(data=b"\x89PNGsecretbytes", mime_type="image/png")]
    client_for("groq", handler).models.generate_content(model="openai/gpt-oss-20b", contents=contents, config=None)
    assert "secretbytes" not in seen["raw"] and "image" not in seen["raw"]


@pytest.mark.parametrize("status,kind", [(429, "rate_limit"), (401, "authentication"), (403, "authentication"),
                                          (402, "payment"), (503, "unavailable"), (400, "bad_request")])
def test_http_errors_are_classified_with_code_and_no_secret(status, kind):
    def handler(request):
        return httpx.Response(status, headers={"retry-after": "7"} if status == 429 else {}, json={"error": SECRET})

    with pytest.raises(ProviderError) as info:
        client_for("groq", handler).models.generate_content(model="openai/gpt-oss-20b", contents="x")
    assert info.value.code == status and info.value.kind == kind
    assert SECRET not in str(info.value) and SECRET not in repr(info.value)
    assert (info.value.retry_after == 7.0) == (status == 429)


def test_network_error_and_bad_output_have_no_secret():
    def boom(request):
        raise httpx.ConnectError(f"connect failed {SECRET}")

    with pytest.raises(ProviderError) as info:
        client_for("groq", boom).models.generate_content(model="openai/gpt-oss-20b", contents="x")
    assert info.value.kind == "network" and SECRET not in str(info.value)

    for body in ({"choices": []}, {"choices": [{"message": {"content": ""}}]},
                 {"choices": [{"message": {"content": "{"}, "finish_reason": "length"}]},
                 {"error": {"message": f"provider down {SECRET}"}}):
        with pytest.raises(ProviderError) as bad:
            client_for("groq", lambda r, b=body: httpx.Response(200, json=b)).models.generate_content(model="m", contents="x")
        assert bad.value.kind == "bad_output" and SECRET not in bad.value.detail
    assert "provider down" in bad.value.detail


def test_fenced_list_and_cut_but_valid_answers_are_accepted():
    for content in ('```json\n{"items": []}\n```', [{"type": "text", "text": '{"items": []}'}]):
        body = {"model": "m", "choices": [{"message": {"content": content}, "finish_reason": "stop"}]}
        reply = client_for("openrouter", lambda r, b=body: httpx.Response(200, json=b)).models.generate_content(model="openrouter/free", contents="x")
        assert json.loads(reply.text) == {"items": []}
    done = {"choices": [{"message": {"content": '{"items": []}'}, "finish_reason": "length"}]}
    assert client_for("groq", lambda r: httpx.Response(200, json=done)).models.generate_content(model="m", contents="x").text


def test_existing_school_judge_works_unchanged_through_groq_adapter():
    reply = {"items": [{"id": "a/1", "verdict": "relevant", "reason": "전체 학생이 신청할 수 있어요", "summary": "신청해요",
                        "deadline_kind": "없음", "deadline_at": ""}]}
    client = client_for("groq", lambda r: httpx.Response(200, json=ok_body(json.dumps(reply, ensure_ascii=False))))
    found = judge_school_notices([{"id": "a/1", "title": "장학", "body": "신청"}], "openai/gpt-oss-20b", SECRET, client=client)
    assert found["a/1"].verdict == "relevant" and found["a/1"].model == "openai/gpt-oss-20b"
    assert SYSTEM  # 프롬프트는 그대로다


def test_provider_failure_makes_existing_judge_return_no_decision():
    client = client_for("groq", lambda r: httpx.Response(429, json={}))
    assert judge_school_notices([{"id": "a/1", "title": "t", "body": "b"}], "openai/gpt-oss-20b", SECRET, client=client) == {}


def test_legacy_provider_default_and_model_id_check():
    assert provider_or_default(None) == "gemini" and provider_or_default("") == "gemini" and provider_or_default("x") == "gemini"
    assert provider_or_default("groq") == "groq"
    assert valid_model_id("openai/gpt-oss-20b") and valid_model_id("vendor/model:free") and not valid_model_id("bad model!")


@pytest.mark.parametrize("body,code,kind", [
    ({"error": {"code": 429, "message": "Rate limit exceeded"}}, 429, "rate_limit"),
    ({"error": {"code": 502, "message": "provider down"}}, 502, "unavailable"),
    ({"choices": [{"message": {"content": "partial"}, "finish_reason": "error", "error": {"code": 402, "message": "no credits"}}]}, 402, "payment"),
])
def test_openrouter_errors_inside_a_200_response_keep_their_code(body, code, kind):
    with pytest.raises(ProviderError) as info:
        client_for("openrouter", lambda r: httpx.Response(200, json=body)).models.generate_content(model="openrouter/free", contents="x")
    assert info.value.code == code and info.value.kind == kind
