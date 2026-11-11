# ruff: noqa: E501
"""키를 몇 개 연결했느냐에 따른 동작: 0개, 1개(업체별 3가지), 2개(3가지 조합), 3개.
기준: 본인 키만 쓰고, 업체마다 다른 하루 상한을 넘기지 않으며, 한 곳이 막히면 다른 곳으로 넘어가고, 모두 막히면 AI 없이 규칙으로 끝낸다."""
from itertools import combinations

import pytest

from skku_notice.ai_models import CAP_RATIO, PROVIDERS, cap_for
from skku_notice.ai_router import Candidate, NoProvider, Preferences, RoutedClient, select_candidates

DAILY = 60


def candidates(providers, used=None):
    used = used or {}
    return [Candidate(p, f"{p}-model", f"key-{p}", used.get(p, 0), cap_for(p, DAILY)) for p in providers]


class Provider:
    """업체 하나의 가짜 응답기. 호출 수를 센다. fail이 있으면 그 예외를 낸다."""

    def __init__(self, name, fail=None):
        self.name, self.calls, self.fail = name, 0, fail

    def make(self):
        outer = self

        class Client:
            class models:  # noqa: N801
                @staticmethod
                def generate_content(**kwargs):
                    outer.calls += 1
                    if outer.fail:
                        raise outer.fail
                    return type("R", (), {"text": "{}", "model": kwargs["model"]})()

        return Client


class HttpError(Exception):
    def __init__(self, code):
        super().__init__(str(code))
        self.code = code


def router(providers, fails=None, used=None, prefs=None):
    fails = fails or {}
    fakes = {p: Provider(p, fails.get(p)) for p in providers}
    client = RoutedClient(candidates(providers, used), prefs or Preferences(), factory=lambda provider, key: fakes[provider].make())
    return client, fakes


def test_caps_follow_each_providers_free_tier_not_one_number():
    assert cap_for("gemini", DAILY) == 60 and cap_for("groq", DAILY) == 60
    assert cap_for("openrouter", DAILY) == 36 < 50   # OpenRouter 무료 모델은 크레딧이 없으면 50회/일이라 더 낮게 잡는다
    assert set(CAP_RATIO) == set(PROVIDERS)


def test_zero_keys_means_no_ai_at_all():
    ranked, reason = select_candidates([], Preferences())
    assert ranked == [] and reason == "no_key"
    client, _ = router([])
    with pytest.raises(NoProvider) as error:
        client.generate_content(model="x", contents="hi")
    assert error.value.reason == "no_key"


@pytest.mark.parametrize("provider", PROVIDERS)
def test_one_key_gets_every_call_until_its_own_cap_then_stops(provider):
    client, fakes = router([provider])
    cap = cap_for(provider, DAILY)
    for _ in range(cap):
        client.generate_content(model="x", contents="hi")
    assert fakes[provider].calls == cap
    with pytest.raises(NoProvider) as error:
        client.generate_content(model="x", contents="hi")   # 상한을 넘기면 부르지 않고 코드 판정으로 둔다
    assert error.value.reason == "quota_exhausted" and fakes[provider].calls == cap


@pytest.mark.parametrize("pair", list(combinations(PROVIDERS, 2)))
def test_two_keys_share_the_load_in_proportion_to_their_caps(pair):
    client, fakes = router(list(pair))
    total = sum(cap_for(p, DAILY) for p in pair)
    for _ in range(total):
        client.generate_content(model="x", contents="hi")
    # 쓴 비율이 같게 번갈아 쓰므로 각 키는 자기 상한만큼 정확히 쓴다. 상한이 낮은 키가 먼저 바닥나지 않는다.
    assert {p: fakes[p].calls for p in pair} == {p: cap_for(p, DAILY) for p in pair}
    with pytest.raises(NoProvider):
        client.generate_content(model="x", contents="hi")


def test_three_keys_use_the_sum_of_their_caps_and_never_exceed_any_cap():
    client, fakes = router(list(PROVIDERS))
    total = sum(cap_for(p, DAILY) for p in PROVIDERS)
    for _ in range(total):
        client.generate_content(model="x", contents="hi")
    assert {p: fakes[p].calls for p in PROVIDERS} == {p: cap_for(p, DAILY) for p in PROVIDERS}
    assert sum(f.calls for f in fakes.values()) == total == 156


def test_with_two_keys_a_rate_limited_one_hands_over_to_the_other_within_the_same_call():
    client, fakes = router(["gemini", "groq"], fails={"gemini": HttpError(429)})
    client.generate_content(model="x", contents="hi")
    assert fakes["gemini"].calls == 1 and fakes["groq"].calls == 1   # 429를 받은 키는 쉬게 하고 다른 키가 같은 요청을 이어받는다
    client.generate_content(model="x", contents="hi")
    assert fakes["gemini"].calls == 1 and fakes["groq"].calls == 2   # 이번 실행에서는 막힌 키를 다시 두드리지 않는다


def test_a_rejected_key_is_dropped_but_the_others_keep_working():
    client, fakes = router(list(PROVIDERS), fails={"groq": HttpError(401)})
    for _ in range(5):
        client.generate_content(model="x", contents="hi")
    assert fakes["groq"].calls == 1 and client.rejected == {"groq"}   # 거부된 키는 한 번만 시도하고 뺀다
    assert fakes["gemini"].calls + fakes["openrouter"].calls == 5


def test_all_keys_failing_ends_without_looping_so_no_tokens_are_wasted():
    client, fakes = router(list(PROVIDERS), fails={p: HttpError(429) for p in PROVIDERS})
    with pytest.raises(HttpError):
        client.generate_content(model="x", contents="hi")
    assert [f.calls for f in fakes.values()] == [1, 1, 1]
    with pytest.raises(NoProvider):
        client.generate_content(model="x", contents="hi")   # 모두 쉬는 중이면 더 두드리지 않는다
    assert [f.calls for f in fakes.values()] == [1, 1, 1]


def test_a_lower_cap_key_is_not_drained_first_when_usage_is_compared_as_a_ratio():
    # 둘 다 18회 썼다: 절대 횟수는 같지만 OpenRouter(상한 36)는 절반, Gemini(상한 60)는 30%이므로 Gemini를 먼저 쓴다.
    ranked, _ = select_candidates(candidates(["openrouter", "gemini"], {"openrouter": 18, "gemini": 18}), Preferences())
    assert [c.provider for c in ranked] == ["gemini", "openrouter"]


def test_manual_choice_uses_only_that_provider_and_is_not_a_fallback():
    prefs = Preferences(routing_mode="manual", manual_provider="groq")
    client, fakes = router(list(PROVIDERS), prefs=prefs)
    for _ in range(3):
        client.generate_content(model="x", contents="hi")
    assert fakes["groq"].calls == 3 and fakes["gemini"].calls == 0 and fakes["openrouter"].calls == 0


def test_calls_alternate_between_keys_inside_one_run_instead_of_draining_the_first_key():
    client, fakes = router(["gemini", "groq"])
    for _ in range(10):
        client.generate_content(model="x", contents="hi")
    assert fakes["gemini"].calls == 5 and fakes["groq"].calls == 5   # 한 키로 몰리지 않는다(한 키의 한도가 먼저 닳지 않는다)
    client, fakes = router(["gemini", "openrouter"])   # 상한이 다르면 상한에 비례해서 나눈다(60:36)
    for _ in range(48):
        client.generate_content(model="x", contents="hi")
    assert abs(fakes["gemini"].calls - 30) <= 1 and abs(fakes["openrouter"].calls - 18) <= 1
