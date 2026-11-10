# ruff: noqa: E501
import json
from types import SimpleNamespace

import pytest
from google.genai import types

from skku_notice.ai_providers import ProviderError
from skku_notice.ai_router import Candidate, NoProvider, Preferences, RoutedClient, select_candidates
from skku_notice.school_ai import judge_school_notices

KEYS = {"gemini": "AIza" + "G" * 35, "groq": "gsk_" + "Q" * 30, "openrouter": "sk-or-" + "R" * 30}
MODELS = {"gemini": "gemini-3.1-flash-lite", "groq": "openai/gpt-oss-20b", "openrouter": "openrouter/free"}
GOOD = json.dumps({"items": [{"id": "a/1", "verdict": "relevant", "reason": "전체 학생이 신청할 수 있어요", "summary": "신청해요",
                              "deadline_kind": "없음", "deadline_at": ""}]}, ensure_ascii=False)
ITEMS = [{"id": "a/1", "title": "장학 안내", "body": "신청"}]


def cands(*providers, used=None):
    return [Candidate(p, MODELS[p], KEYS[p], (used or {}).get(p, 0)) for p in providers]


class Provider:
    """업체별 모의 응답. 호출 횟수와 받은 모델·키를 센다."""

    def __init__(self, outcomes):
        self.outcomes, self.calls = outcomes, []

    def factory(self, provider, api_key):
        outer = self

        class Models:
            def generate_content(self, **kwargs):
                outer.calls.append((provider, kwargs["model"], api_key))
                outcome = outer.outcomes.get(provider, GOOD)
                if isinstance(outcome, Exception):
                    raise outcome
                return SimpleNamespace(text=outcome)

        return SimpleNamespace(models=Models())

    def count(self, provider=None):
        return len([c for c in self.calls if provider in (None, c[0])])


AUTO = Preferences(routing_mode="auto", auto_routing_consent=True)


def run(providers, outcomes=None, prefs=None, **kw):
    fake = Provider(outcomes or {})
    client = RoutedClient(cands(*providers, **kw), prefs or Preferences(), factory=fake.factory)
    found = judge_school_notices(ITEMS, "ignored-gemini-model", "unused", client=client)
    return found, client, fake


# ---- 키 개수별 ----
def test_zero_keys_means_no_external_call_and_code_fallback():
    found, client, fake = run([])
    assert found == {} and fake.calls == [] and client.execution_mode == "code" and client.fallback_reason == "no_key"
    assert client.result().provider is None and client.result().model is None


@pytest.mark.parametrize("provider", ["gemini", "groq", "openrouter"])
def test_single_key_uses_only_that_provider_with_its_own_model(provider):
    found, client, fake = run([provider])
    assert found["a/1"].verdict == "relevant"
    assert [c[0] for c in fake.calls] == [provider]
    assert fake.calls[0][1] == MODELS[provider]  # 다른 업체의 모델 ID를 보내지 않는다
    assert fake.calls[0][2] == KEYS[provider]
    assert client.result().execution_mode == "ai" and client.result().provider == provider


def test_ai_disabled_with_keys_makes_zero_calls():
    found, client, fake = run(["gemini", "groq"], prefs=Preferences(ai_enabled=False, **{}))
    assert found == {} and fake.calls == [] and client.fallback_reason == "user_disabled"


# ---- 자동·직접 ----
@pytest.mark.parametrize("pair", [("gemini", "groq"), ("gemini", "openrouter"), ("groq", "openrouter")])
def test_two_keys_auto_falls_back_to_other_own_key(pair):
    first, second = pair
    found, client, fake = run(list(pair), {first: ProviderError(429, "rate_limit"), second: GOOD}, AUTO, used={second: 5})
    # 오늘 덜 쓴 쪽이 먼저이므로 first부터 시도하고 실패하면 second로 넘어간다
    assert [c[0] for c in fake.calls] == [first, second]
    assert found and client.provider == second and first in client.limited


def test_three_keys_are_all_candidates_but_called_one_at_a_time():
    found, client, fake = run(["gemini", "groq", "openrouter"], {"gemini": ProviderError(503, "unavailable"), "groq": ProviderError(429, "rate_limit")}, AUTO)
    assert [c[0] for c in fake.calls] == ["gemini", "groq", "openrouter"] and found
    ok_found, ok_client, ok_fake = run(["gemini", "groq", "openrouter"], None, AUTO)
    assert ok_fake.count() == 1  # 성공하면 한 번만 부른다(3중 호출 없음)


def test_manual_mode_never_falls_back_to_another_provider():
    found, client, fake = run(["gemini", "groq"], {"groq": ProviderError(429, "rate_limit")}, Preferences(manual_provider="groq"))
    assert found == {} and [c[0] for c in fake.calls] == ["groq"] and client.fallback_reason == "quota_exhausted"


def test_auto_without_consent_behaves_like_manual():
    prefs = Preferences(routing_mode="auto", auto_routing_consent=False)
    found, client, fake = run(["gemini", "groq"], {"gemini": ProviderError(503, "unavailable")}, prefs)
    assert found == {} and [c[0] for c in fake.calls] == ["gemini"]  # 옛 사용자 호환: Gemini 하나만


def test_manual_provider_not_registered_means_no_call():
    found, client, fake = run(["gemini"], None, Preferences(manual_provider="groq"))
    assert found == {} and fake.calls == [] and client.fallback_reason == "no_key"


# ---- 무료/유료 ----
def test_free_only_blocks_paid_models_even_with_registered_key():
    paid = [Candidate("openrouter", "anthropic/claude-sonnet", KEYS["openrouter"])]
    ranked, reason = select_candidates(paid, Preferences())
    assert ranked == [] and reason == "paid_not_allowed"
    ranked, reason = select_candidates(paid, Preferences(free_only=False, paid_opt_in=True))
    assert len(ranked) == 1 and reason is None


def test_paid_opt_in_alone_is_not_enough_while_free_only_is_on():
    paid = [Candidate("openrouter", "anthropic/claude-sonnet", KEYS["openrouter"])]
    assert select_candidates(paid, Preferences(free_only=True, paid_opt_in=True))[1] == "paid_not_allowed"


def test_unknown_priced_model_is_not_auto_used_under_free_only():
    unknown = [Candidate("groq", "some/new-model", KEYS["groq"])]
    assert select_candidates(unknown, Preferences())[1] == "paid_not_allowed"


def test_free_candidates_are_ranked_before_paid_when_paid_allowed():
    pool = [Candidate("openrouter", "anthropic/claude-sonnet", KEYS["openrouter"]), Candidate("groq", MODELS["groq"], KEYS["groq"])]
    ranked, _ = select_candidates(pool, Preferences(routing_mode="auto", auto_routing_consent=True, free_only=False, paid_opt_in=True))
    assert [c.provider for c in ranked] == ["groq", "openrouter"]


# ---- 오류별 ----
@pytest.mark.parametrize("code,kind", [(401, "authentication"), (403, "authentication"), (402, "payment"), (429, "rate_limit"), (503, "unavailable")])
def test_all_keys_failing_returns_code_fallback_without_raising_to_callers(code, kind):
    err = {p: ProviderError(code, kind) for p in ("gemini", "groq", "openrouter")}
    found, client, fake = run(["gemini", "groq", "openrouter"], err, AUTO)
    assert found == {} and client.execution_mode == "code" and client.failed
    assert fake.count() == 3 and client.error_code == code  # 각 키를 한 번씩만 시도한다(폭주 없음)


def test_timeout_like_network_error_is_a_fallback_too():
    found, client, fake = run(["groq"], {"groq": ProviderError(None, "network")})
    assert found == {} and client.fallback_reason == "provider_unavailable"


def test_bad_request_stops_without_trying_other_keys():
    found, client, fake = run(["gemini", "groq"], {"groq": ProviderError(400, "bad_request")}, AUTO, used={"gemini": 5})
    assert found == {} and [c[0] for c in fake.calls] == ["groq"]


def test_gemini_400_keeps_the_old_meaning_of_a_rejected_key():
    found, client, fake = run(["gemini"], {"gemini": ProviderError(400, "bad_request")})
    assert found == {} and client.rejected == {"gemini"}


def test_gemini_sdk_style_error_with_only_code_attribute_is_handled():
    class ApiError(Exception):
        def __init__(self, code):
            self.code = code

    found, client, fake = run(["gemini", "groq"], {"gemini": ApiError(429)}, AUTO)
    assert found and client.provider == "groq" and "gemini" in client.limited


def test_authentication_failure_marks_provider_rejected_and_skips_it_afterwards():
    fake = Provider({"gemini": ProviderError(401, "authentication")})
    client = RoutedClient(cands("gemini", "groq"), AUTO, factory=fake.factory)
    judge_school_notices(ITEMS, "x", "k", client=client)
    judge_school_notices(ITEMS, "x", "k", client=client)
    assert client.rejected == {"gemini"} and [c[0] for c in fake.calls] == ["gemini", "groq", "groq"]


def test_daily_request_cap_blocks_all_calls_and_total_across_providers():
    found, client, fake = run(["gemini", "groq"], None, Preferences(daily_request_cap=5), used={"gemini": 3, "groq": 2})
    assert found == {} and fake.calls == [] and client.fallback_reason == "quota_exhausted"
    found, client, fake = run(["gemini", "groq"], {"gemini": ProviderError(503, "unavailable")}, Preferences(routing_mode="auto", auto_routing_consent=True, daily_request_cap=2))
    assert fake.count() <= 2  # 분산해도 합산 상한을 넘지 않는다


# ---- 입력 형식 ----
def test_image_input_is_only_sent_to_image_capable_provider():
    contents = [types.Part.from_text(text="x"), types.Part.from_bytes(data=b"img", mime_type="image/png")]
    fake = Provider({})
    client = RoutedClient(cands("groq", "gemini"), AUTO, factory=fake.factory)
    client.models.generate_content(model="m", contents=contents)
    assert [c[0] for c in fake.calls] == ["gemini"]
    only_groq = RoutedClient(cands("groq"), AUTO, factory=fake.factory)
    with pytest.raises(NoProvider):
        only_groq.models.generate_content(model="m", contents=contents)
    assert only_groq.fallback_reason == "model_unavailable"


# ---- 격리·비밀 ----
def test_keys_never_appear_in_repr_attempts_or_results():
    found, client, fake = run(["gemini", "groq"], {"gemini": ProviderError(503, "unavailable")}, AUTO)
    blob = repr(client.attempts) + repr(client.result()) + repr(client._candidates)
    assert all(secret not in blob for secret in KEYS.values())


def test_only_the_users_own_candidates_are_used():
    mine = cands("groq")
    fake = Provider({})
    judge_school_notices(ITEMS, "x", "k", client=RoutedClient(mine, AUTO, factory=fake.factory))
    assert {c[2] for c in fake.calls} == {KEYS["groq"]}
