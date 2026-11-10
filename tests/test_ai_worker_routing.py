# ruff: noqa: E501
import json
from datetime import UTC, datetime
from types import SimpleNamespace

import httpx

from skku_notice import byok_judge as judge
from skku_notice import grad_intern_service as svc
from skku_notice.ai_providers import OpenAICompatClient
from skku_notice.byok_crypto import b64encode, encrypt_api_key
from tests.test_byok_judge import ApiError, FakeStore, Reply
from tests.test_grad_intern_service import AI as GRAD_AI
from tests.test_grad_intern_service import Store as GradStore
from tests.test_grad_intern_service import request as grad_request

MASTER = b64encode(b"k" * 32)
NOW = datetime(2026, 11, 7, 12, 0, tzinfo=UTC)
GROQ_KEY, OR_KEY, GEM_KEY = "gsk_" + "G" * 30, "sk-or-" + "O" * 30, "AIza" + "M" * 35
SCHOOL = [{"notice_id": "s/1", "title": "장학 안내", "body": "신청"}]
REPLY = json.dumps({"items": [{"id": "s/1", "verdict": "relevant", "reason": "전체 학생이 신청할 수 있어요", "summary": "신청해요",
                               "deadline_kind": "없음", "deadline_at": ""}]}, ensure_ascii=False)


def enc(user, secret):
    return encrypt_api_key(MASTER, user, secret, b"i" * 12)


def gem_row(user, used=0):
    return {"user_id": user, "ciphertext": enc(user, GEM_KEY), "model": "gemini-3.1-flash-lite", "used_on": "2026-11-07", "used_today": used}


def ai_row(user, provider, secret, model, used=0):
    return {"provider": provider, "ciphertext": enc(user, secret), "model": model, "disabled_at": None, "used_on": "2026-11-07", "used_today": used}


class AiStore(FakeStore):
    def __init__(self, gem_rows=(), extra=None, prefs=None, **kw):
        super().__init__(list(gem_rows), pending=[], school=SCHOOL, **kw)
        self.extra, self.prefs, self.ai_updates = extra or {}, prefs or {}, []

    def ai_key_users(self):
        return list(self.extra)

    def ai_keys_for(self, user_id):
        return self.extra.get(user_id, [])

    def preferences(self, user_id):
        return self.prefs.get(user_id)

    def update_ai_key(self, user_id, provider, fields):
        self.ai_updates.append((user_id, provider, fields))


class Net:
    """업체 주소별 모의 응답과 호출 기록. 어떤 키가 어느 주소로 갔는지 센다."""

    def __init__(self, routes):
        self.routes, self.requests = routes, []
        self.http = httpx.Client(transport=httpx.MockTransport(self.handle))

    def handle(self, request):
        host = request.url.host
        self.requests.append((host, request.headers["authorization"].removeprefix("Bearer "), json.loads(request.content)["model"]))
        outcome = self.routes.get(host, 200)
        if outcome == 200:
            return httpx.Response(200, json={"model": "served-model", "choices": [{"message": {"content": REPLY}, "finish_reason": "stop"}]})
        return httpx.Response(outcome, json={})

    def factory(self, provider, key):
        return OpenAICompatClient(provider, key, self.http)

    def hosts(self):
        return [h for h, _, _ in self.requests]


GROQ, OPENROUTER = "api.groq.com", "openrouter.ai"


def run(store, net, gemini=None):
    gemini_models = gemini or SimpleNamespace(calls=0)

    def gemini_factory(key):
        class Models:
            def generate_content(self, **kw):
                gemini_models.calls += 1
                if isinstance(getattr(gemini_models, "outcome", None), Exception):
                    raise gemini_models.outcome
                return Reply(REPLY)

        return SimpleNamespace(models=Models())

    return judge.run_judging(store, MASTER, NOW, gemini_factory, provider_factory=net.factory), gemini_models


def test_user_with_only_a_groq_key_is_judged_with_groq_and_nothing_else():
    store = AiStore(extra={"u1": [ai_row("u1", "groq", GROQ_KEY, "openai/gpt-oss-20b")]})
    net = Net({})
    counts, gem = run(store, net)
    assert counts["judged"] == 1 and gem.calls == 0
    assert net.hosts() == [GROQ] and net.requests[0][1] == GROQ_KEY and net.requests[0][2] == "openai/gpt-oss-20b"
    assert store.saved[0]["user_id"] == "u1" and store.saved[0]["model"] == "served-model"
    assert store.ai_updates[-1][:2] == ("u1", "groq") and store.ai_updates[-1][2]["used_today"] == 1
    assert store.updates == []  # Gemini 행은 건드리지 않는다


def test_legacy_gemini_only_user_behaves_exactly_as_before():
    store = AiStore(gem_rows=[gem_row("u1")])
    net = Net({})
    counts, gem = run(store, net)
    assert counts["judged"] == 1 and gem.calls == 1 and net.requests == []
    assert store.saved[0]["model"] == "gemini-3.1-flash-lite" and store.updates[-1][1]["used_today"] == 1


def test_two_keys_without_consent_never_send_to_the_other_provider():
    store = AiStore(gem_rows=[gem_row("u1")], extra={"u1": [ai_row("u1", "groq", GROQ_KEY, "openai/gpt-oss-20b")]})
    net, gem = Net({}), SimpleNamespace(calls=0, outcome=ApiError(503))
    counts, _ = run(store, net, gem)
    assert net.requests == [] and counts["judged"] == 0  # Gemini가 실패해도 Groq로 몰래 보내지 않는다


def test_two_keys_with_consent_fall_back_and_the_failed_key_gets_its_own_error():
    prefs = {"u1": {"routing_mode": "auto", "auto_routing_consent_at": "2026-11-07T00:00:00Z"}}
    store = AiStore(gem_rows=[gem_row("u1")], extra={"u1": [ai_row("u1", "groq", GROQ_KEY, "openai/gpt-oss-20b")]}, prefs=prefs)
    net, gem = Net({}), SimpleNamespace(calls=0, outcome=ApiError(429))
    counts, _ = run(store, net, gem)
    assert counts["judged"] == 1 and gem.calls == 1 and net.hosts() == [GROQ]
    assert "한도" in store.updates[-1][1]["last_error"] and "Gemini" in store.updates[-1][1]["last_error"]
    assert store.ai_updates[-1][2]["last_error"] is None  # 성공한 키는 오류 표시가 없다
    assert store.saved[0]["model"] == "served-model"


def test_all_providers_fail_keeps_pending_work_and_raises_nothing():
    prefs = {"u1": {"routing_mode": "auto", "auto_routing_consent_at": "2026-11-07T00:00:00Z"}}
    extra = {"u1": [ai_row("u1", "groq", GROQ_KEY, "openai/gpt-oss-20b"), ai_row("u1", "openrouter", OR_KEY, "openrouter/free")]}
    store = AiStore(gem_rows=[gem_row("u1")], extra=extra, prefs=prefs)
    net, gem = Net({GROQ: 429, OPENROUTER: 503}), SimpleNamespace(calls=0, outcome=ApiError(401))
    counts, _ = run(store, net, gem)
    assert counts["judged"] == 0 and store.saved == []
    assert net.hosts().count(GROQ) == 1 and net.hosts().count(OPENROUTER) == 1 and gem.calls == 1  # 키마다 한 번
    assert "disabled_at" in store.updates[-1][1]  # 거부된 Gemini 키만 비활성
    assert all("disabled_at" not in f for _, _, f in store.ai_updates)


def test_free_only_blocks_a_paid_openrouter_model_without_any_call():
    row = ai_row("u1", "openrouter", OR_KEY, "anthropic/claude-sonnet")
    store = AiStore(extra={"u1": [row]})
    net = Net({})
    counts, _ = run(store, net)
    assert net.requests == [] and counts["judged"] == 0 and counts.get("ai_fallback") == 1
    store = AiStore(extra={"u1": [row]}, prefs={"u1": {"free_only": False, "paid_calls_opt_in_at": "2026-11-07T00:00:00Z"}})
    counts, _ = run(store, Net({}))
    assert counts["judged"] == 1


def test_ai_off_with_keys_makes_no_external_call():
    store = AiStore(gem_rows=[gem_row("u1")], extra={"u1": [ai_row("u1", "groq", GROQ_KEY, "openai/gpt-oss-20b")]}, prefs={"u1": {"ai_enabled": False}})
    net, gem = Net({}), SimpleNamespace(calls=0)
    counts, _ = run(store, net, gem)
    assert net.requests == [] and gem.calls == 0 and counts["judged"] == 0


def test_rejected_groq_key_is_disabled_without_touching_other_users_or_gemini():
    extra = {"u1": [ai_row("u1", "groq", GROQ_KEY, "openai/gpt-oss-20b")]}
    store = AiStore(extra=extra)
    counts, _ = run(store, Net({GROQ: 401}))
    assert counts["rejected"] == 1 and store.ai_updates[-1][2]["disabled_at"] and store.updates == []
    assert GROQ_KEY not in str(store.ai_updates)


def test_groq_user_keys_are_decrypted_only_for_their_own_user():
    row = ai_row("u2", "groq", GROQ_KEY, "openai/gpt-oss-20b")  # u2의 암호문을 u1 행에 넣었다
    store = AiStore(extra={"u1": [row]})
    net = Net({})
    counts, _ = run(store, net)
    assert net.requests == [] and counts["errors"] == 1


# ---- 졸업요건: 키가 없거나 모두 실패하면 규칙 판정으로 끝난다 ----
class GroqGradStore(GradStore):
    def __init__(self, requests, extra, prefs=None):
        super().__init__(requests, None)
        self.extra, self.prefs, self.ai_updates = extra, prefs, []

    def ai_keys_for(self, user_id):
        return self.extra

    def preferences(self, user_id):
        return self.prefs

    def update_ai_key(self, user_id, provider, fields):
        self.ai_updates.append((provider, fields))


def grad_net(status):
    def handler(request):
        if status != 200:
            return httpx.Response(status, json={})
        return httpx.Response(200, json={"choices": [{"message": {"content": GRAD_AI}, "finish_reason": "stop"}]})

    http = httpx.Client(transport=httpx.MockTransport(handler))
    return lambda provider, key: OpenAICompatClient(provider, key, http)


def run_grad(store, status):
    return svc.run_graduation(store, MASTER, datetime(2026, 11, 10, 12, 0, tzinfo=UTC), client_factory=lambda k: None,
                              sleep=lambda s: None, provider_factory=grad_net(status))


def test_graduation_facts_can_come_from_a_groq_key_and_rules_still_decide():
    row = ai_row("u1", "groq", GROQ_KEY, "openai/gpt-oss-20b")
    row["used_on"] = "2026-11-10"
    store = GroqGradStore([grad_request()], [row])
    counts = run_grad(store, 200)
    saved = store.saved[0]
    assert counts["grad_ai"] == 1 and saved["ai_status"] == "used" and saved["department"]["status"] == "LIKELY"
    assert saved["ruleset_version"] == svc.DEPT_RULESET and saved["model"] == "openai/gpt-oss-20b"


def test_graduation_with_failing_groq_key_still_returns_a_rule_result():
    row = ai_row("u1", "groq", GROQ_KEY, "openai/gpt-oss-20b")
    row["used_on"] = "2026-11-10"
    store = GroqGradStore([grad_request()], [row])
    counts = run_grad(store, 503)
    saved = store.saved[0]
    assert counts["grad_ai_unavailable"] == 1 and saved["status"] == "READY" and saved["ai_status"] == "unavailable"
    assert saved["department"]["status"] in ("LIKELY", "CONDITIONAL", "NEEDS_REVIEW")  # 불합격으로 바꾸지 않는다
