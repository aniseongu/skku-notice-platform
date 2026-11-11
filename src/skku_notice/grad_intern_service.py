# ruff: noqa: E501
"""졸업요건 확인 요청을 처리한다. 판정 워커(byok_judge)가 같은 타이머에서 부른다.

요청은 사용자가 공지마다 누르는 "졸업요건 확인"이다. 키가 있고 일일 한도가 남았으면 Gemini로 사실을 뽑고, 아니면 공고의
표기만 읽는 규칙 판정으로 끝낸다. 같은 입력(공지, 프로필, 규칙 버전)이면 이전 결과를 다시 쓰고 Gemini를 부르지 않는다.
"""

from __future__ import annotations

import hashlib
import time
from datetime import UTC, datetime

from skku_notice.ai_users import build_user_ai, gather_rows, used_today
from skku_notice.grad_intern_facts import build_facts, call_gemini, facts_from_dict
from skku_notice.grad_intern_rules import GradProfile, assess_department, assess_university_3p
from skku_notice.grad_intern_sources import DEPT_RULESET, EXTRACTOR_VERSION, P3_RULESET

# 규칙만으로 끝나는 판정은 가볍다. 실행당 많이 처리하고, Gemini 같은 AI 호출이 필요한 것만 실행당 일부로 제한한다.
MAX_PER_RUN = 40
AI_CALLS_PER_RUN = 6
ENQUEUE_PER_RUN = 10
RETRY_PER_RUN, RETRY_AFTER_HOURS = 5, 12  # 한도·장애로 AI 없이 끝난 판정을 12시간 뒤 다시(실행당 5건)
STALE_PER_RUN = 10  # 규칙 버전이 바뀐 옛 판정을 실행마다 이만큼씩 새 규칙으로 다시 만든다(AI 호출은 위 상한과 일일 한도 안에서만)
SW_COLLEGE, SW_DEPARTMENT = "소프트웨어융합대학", "소프트웨어학과"


def profile_from_row(row: dict) -> GradProfile:
    """프로필 행에서 판정에 필요한 값만 꺼낸다. 첫 전공이 원전공, 나머지가 복수전공이다."""
    programs = [p for p in (row.get("programs") or []) if isinstance(p, dict)]
    index = next((i for i, p in enumerate(programs) if p.get("college") == SW_COLLEGE and p.get("department") == SW_DEPARTMENT), None)
    if index is None:
        sw_major, track = (False if programs else None), ("original_major" if programs else "unknown")
    else:
        sw_major, track = True, "original_major" if index == 0 else "double_major"
    year = row.get("admission_year")
    selected = row.get("university_3p_internship_selected")
    return GradProfile(year if isinstance(year, int) else None, track, sw_major, selected if isinstance(selected, bool) else None)


def assess(profile: GradProfile, title: str, body: str, ai: dict | None, judgment: tuple | None = None) -> dict:
    extracted = build_facts(title, body, ai, judgment)
    return {
        "department": assess_department(profile, extracted.facts).as_dict(),
        "university_3p": assess_university_3p(profile, extracted.facts).as_dict(),
        "facts": extracted.as_dict(),
    }


def assess_from_stored(profile: GradProfile, stored: dict) -> dict | None:
    """저장해 둔 사실로 규칙만 다시 돌린다(AI 호출 0회). 사실을 되살릴 수 없으면 None."""
    facts = facts_from_dict(stored)
    if facts is None:
        return None
    return {"department": assess_department(profile, facts).as_dict(),
            "university_3p": assess_university_3p(profile, facts).as_dict(), "facts": stored}


def rows_for(store, user_id: str, gemini_row: dict | None) -> dict[str, dict]:
    return gather_rows(store, user_id, gemini_row)


def run_graduation(store, master_key: str, now: datetime, client_factory=None, sleep=time.sleep,
                   provider_factory=None) -> dict[str, int]:
    from skku_notice.ai_providers import make_client
    from skku_notice.byok_judge import DAILY_CALLS, PACE_SECONDS, _RecordingClient
    from skku_notice.gemini_client import gemini_client

    provider_factory = provider_factory or make_client

    client_factory = client_factory or gemini_client
    counts = {"grad_queued": 0, "grad_stale": 0, "grad_retry": 0, "grad_rerule": 0, "grad_assessed": 0, "grad_cached": 0, "grad_ai": 0, "grad_ai_unavailable": 0}
    # 버튼 없이 미리 판정한다: 아직 채우지 못한 요건이 있는 사용자의 최근 인턴 공고를 대기열에 넣는다.
    counts["grad_queued"] = store.enqueue_graduation(ENQUEUE_PER_RUN)
    counts["grad_stale"] = store.requeue_stale(DEPT_RULESET, STALE_PER_RUN) if hasattr(store, "requeue_stale") else 0
    counts["grad_retry"] = store.requeue_retryable(RETRY_AFTER_HOURS, RETRY_PER_RUN) if hasattr(store, "requeue_retryable") else 0
    today = now.astimezone(UTC).date().isoformat()
    used_calls = 0
    for req in store.graduation_requests(MAX_PER_RUN):
        user_id, notice_id = req["user_id"], req["notice_id"]
        key = store.key_for(user_id)
        previous = store.assessment(user_id, notice_id) or {}
        same_input = (
            previous.get("input_hash") == req.get("input_hash") and previous.get("ruleset_version") == DEPT_RULESET
            and previous.get("extractor_version") == EXTRACTOR_VERSION
        )
        if same_input and previous.get("ai_status") == "used":
            store.save_assessment({"user_id": user_id, "notice_id": notice_id, "status": "READY"})
            counts["grad_cached"] += 1
            continue
        # 공고도 프로필도 그대로인데 규칙 문구만 바뀐 판정(자동 갱신)은 저장된 사실로 규칙만 다시 돌린다: AI 호출도, 다른 계산도 없다.
        # AI로 읽은 사실은 추출기 버전이 옛것이어도 버리지 않는다(다시 뽑으면 키의 한도를 쓴다). 그 밖의 판정은 사실을 공짜로
        # 다시 뽑을 수 있으니 추출기가 바뀌었으면 새 추출기로 만든다.
        if (previous.get("input_hash") == req.get("input_hash") and previous.get("ruleset_version") != DEPT_RULESET
                and (previous.get("extractor_version") == EXTRACTOR_VERSION or previous.get("ai_status") == "used")
                and isinstance(previous.get("facts"), dict)):
            rerun = assess_from_stored(profile_from_row(req), previous["facts"])
            if rerun is not None:
                store.save_assessment({
                    "user_id": user_id, "notice_id": notice_id, "status": "READY", "input_hash": req.get("input_hash"),
                    "ruleset_version": DEPT_RULESET, "extractor_version": previous.get("extractor_version") or EXTRACTOR_VERSION,
                    "ai_status": previous.get("ai_status"), "model": previous.get("model"),
                    "department": rerun["department"], "university_3p": rerun["university_3p"], "facts": rerun["facts"],
                    "assessed_at": now.isoformat()})
                counts["grad_rerule"] += 1
                continue

        ai, ai_status, model = None, "no_key", None
        # 이 사용자가 이미 같은 공고 글에서 뽑아 둔 사실은 다시 묻지 않는다. 다른 사용자의 키로 뽑은 것은 쓰지 않는다.
        text_hash = hashlib.md5(f"{req['title']}|{req.get('body') or ''}".encode()).hexdigest()
        shared = store.cached_ai_facts(user_id, notice_id, text_hash, EXTRACTOR_VERSION) if hasattr(store, "cached_ai_facts") else None
        if shared is not None:
            ai, ai_status = shared, "used"
            counts["grad_shared"] = counts.get("grad_shared", 0) + 1
        elif rows_for(store, user_id, key):
            rows = rows_for(store, user_id, key)
            if used_calls >= AI_CALLS_PER_RUN:
                continue  # 이번 실행의 AI 호출 몫을 다 썼다. 대기 상태로 두고 다음 실행에서 이어서 처리한다.
            half = DAILY_CALLS // 2  # 하루 한도의 절반까지만 졸업요건에 쓰고, 나머지는 인턴 공고 판정에 남겨 둔다.
            user_ai = build_user_ai(store, master_key, user_id, rows, today, now, half,
                                    gemini_client_for=lambda k: _RecordingClient(client_factory(k)),
                                    provider_client_for=provider_factory)
            if not user_ai.candidates:
                at_limit = any(used_today(r, today) >= half for r in rows.values())
                ai_status = "limit" if at_limit else "unavailable"
            else:
                if used_calls:
                    sleep(PACE_SECONDS)
                used_calls += 1
                ai = call_gemini(req["title"], req.get("body") or "", user_ai.primary_model, "routed", client=user_ai.client)
                user_ai.settle(store, now)
                if ai is None:
                    ai_status = "unavailable"
                    counts["grad_ai_unavailable"] += 1
                else:
                    ai_status, model = "used", user_ai.client.model
                    counts["grad_ai"] += 1
                    if hasattr(store, "save_ai_facts"):
                        store.save_ai_facts(user_id, notice_id, text_hash, EXTRACTOR_VERSION, ai, model)

        result = assess(profile_from_row(req), req["title"], req.get("body") or "", ai,
                        (req.get("judgment_verdict"), req.get("judgment_reason")))
        store.save_assessment({
            "user_id": user_id, "notice_id": notice_id, "status": "READY", "input_hash": req.get("input_hash"),
            "ruleset_version": DEPT_RULESET, "extractor_version": EXTRACTOR_VERSION, "ai_status": ai_status,
            "model": model, "department": result["department"], "university_3p": result["university_3p"],
            "facts": result["facts"], "assessed_at": now.isoformat(),
        })
        counts["grad_assessed"] += 1
    return counts


__all__ = ["P3_RULESET", "assess", "profile_from_row", "run_graduation"]
