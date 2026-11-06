"""Read public boards, judge new notices, deliver, and export snapshots."""

import argparse
import json
import os
import sys
import time
from dataclasses import replace
from datetime import date, datetime, timedelta
from pathlib import Path

import yaml
from dotenv import load_dotenv

from skku_notice.archive import (
    Archive,
    add_notice,
    load_archive,
    mark_image_attempted,
    note_body_change,
    note_list_changes,
    save_archive,
    set_source_deadlines,
    update_ai_deadlines,
    update_detail,
    update_image_text,
    update_translation,
)
from skku_notice.canvas import CanvasError, read_canvas
from skku_notice.canvas_alerts import (
    load_canvas_state,
    mark_sent,
    plan_alerts,
    problem_alert,
    save_canvas_state,
)
from skku_notice.deadline import KST
from skku_notice.deadline_ai import BATCH, read_deadlines
from skku_notice.export import export_site
from skku_notice.fetch import FetchError, UnsafeURL, fetch_detail, fetch_images, fetch_json_post, fetch_list
from skku_notice.interests import (
    is_mine,
    load_interests,
    match_interests,
    refresh_archive_interests,
)
from skku_notice.intern_ai import BATCH as INTERN_BATCH
from skku_notice.intern_ai import intern_fingerprint, judge_internships, preference_safe_reason
from skku_notice.jobs import (
    COLLECTORS,
    LK_API,
    LK_DETAIL,
    LK_HEADERS,
    parse_job_detail,
    parse_linkareer_detail,
    skku_career_list,
)
from skku_notice.judge import Judgment, judge_notices
from skku_notice.model import Match, Notice
from skku_notice.notification_policy import alert_priority
from skku_notice.notify import has_notification_channel, send_canvas, send_notice
from skku_notice.ocr import read_images
from skku_notice.parse import ParseError, parse_detail, parse_list
from skku_notice.rules import load_rules, match_notice
from skku_notice.state import baseline, external_due, is_new, load_state, record_result, save_state
from skku_notice.summary_ai import BATCH as SUMMARY_BATCH
from skku_notice.summary_ai import summarize
from skku_notice.translate import needs_translation, translate_notice

SOURCES_PATH = Path("config/sources.yaml")
STATE_PATH = Path("state/seen.json")
ARCHIVE_PATH = Path("state/archive.json")
AI_PATH = Path("config/ai.yaml")
PROFILE_PATH = Path("config/profile.yaml")
INTERESTS_PATH = Path("config/interests.yaml")
FIXTURES_PATH = Path("tests/fixtures")
CANVAS_CONFIG_PATH = Path("config/canvas.yaml")
CANVAS_STATE_PATH = Path("state/canvas.json")


def _fixture(source_id: str) -> str:
    candidates = sorted(FIXTURES_PATH.glob(f"{source_id.replace('-', '_')}_list_*.html"))
    if not candidates:
        raise FileNotFoundError(f"fixture not found: {source_id}")
    return candidates[-1].read_text(encoding="utf-8")


def _view_fixture(source_id: str, article_no: str) -> str | None:
    candidates = sorted(FIXTURES_PATH.glob(
        f"{source_id.replace('-', '_')}_view_{article_no}_*.html"
    ))
    return candidates[-1].read_text(encoding="utf-8") if candidates else None


def _retry_due(attempts: int, last: str | None, now: datetime, limit: int) -> bool:
    if attempts < limit or not last:
        return True
    try:
        checked = datetime.fromisoformat(last)
        return checked.tzinfo is None or checked > now or now - checked >= timedelta(hours=24)
    except (TypeError, ValueError):
        return True


def _fill_details(archive: Archive, state, boards: list[tuple[dict, list]], settings: dict,
                  from_fixtures: bool, now: datetime) -> Archive:
    gap = max(1.0, float(settings.get("request_gap_seconds", 1)))
    for source, notices in boards:
        count = 0
        new = [notice for notice in notices if notice.article_no not in state.sources[source["id"]].seen]
        for notice in new:
            key = f"{source['id']}/{notice.article_no}"
            if key not in archive.items:
                archive = add_notice(archive, notice, now.isoformat())
        recent = sorted(
            (item["notice"] for item in archive.items.values()
             if item["notice"]["source_id"] == source["id"]),
            key=lambda notice: (notice["posted_on"], notice["first_seen"], notice["article_no"]),
            reverse=True,
        )
        new_ids = {f"{source['id']}/{notice.article_no}" for notice in new}
        candidates = [(f"{source['id']}/{notice.article_no}", notice.url, notice.article_no)
                      for notice in new]
        candidates += [(notice["id"], notice["url"], notice["article_no"]) for notice in recent
                       if notice["id"] not in new_ids]
        for key, url, article_no in candidates:
            item = archive.items[key]
            if item.get("body_text") is not None or not _retry_due(
                item.get("body_attempts", 0), item.get("body_attempted_at"), now, 3
            ):
                continue
            if count == 5:
                break
            html = _view_fixture(source["id"], article_no) if from_fixtures else None
            if from_fixtures and html is None:
                continue
            if not from_fixtures:
                time.sleep(gap)
            count += 1
            try:
                if not from_fixtures and source.get("kind") == "linkareer":
                    data = fetch_json_post(
                        LK_API, {"query": LK_DETAIL, "variables": {"id": article_no}},
                        settings["user_agent"], float(settings["timeout_seconds"]), LK_HEADERS)
                    detail = parse_linkareer_detail(data, article_no, url)
                else:
                    if html is None:
                        html = fetch_detail(url, settings["user_agent"],
                                            float(settings["timeout_seconds"]))
                    detail = (parse_job_detail(html, source["kind"], article_no, url)
                              if source.get("external") else parse_detail(html, url))
            except (FetchError, ParseError) as exc:
                if not isinstance(exc, UnsafeURL):
                    print(f"{key}: 본문 읽기 실패: {exc}", file=sys.stderr)
                archive = update_detail(archive, key, None, (), None, attempted_at=now.isoformat())
            else:
                archive = update_detail(archive, key, detail.body_text, detail.attachments,
                                        now.isoformat(), detail.images, detail.body_html)
            save_archive(ARCHIVE_PATH, archive)
    return archive


# 무료 한도를 아끼려고 실행당 3건만 옮기고, 한 글은 두 번 실패하면 더 시도하지 않는다.
TRANSLATE_PER_RUN = 3
# 본문 마감 읽기는 한 번에 BATCH(8)건, 실행당 3번까지(D-023).
DEADLINE_CALLS = 3


def _translate(archive, ai: dict, api_key: str):
    if not api_key:
        return archive
    done = 0
    for key, item in archive.items.items():
        if done == TRANSLATE_PER_RUN:
            break
        ready = item.get("body_text") is not None or item.get("body_attempts", 0) >= 3
        if (item.get("translation") or item.get("translation_attempts", 0) >= 2 or not ready
                or not needs_translation(item["notice"]["title"], item.get("body_text"))):
            continue
        done += 1
        result = translate_notice(item["notice"]["title"], item.get("body_text"), ai["model"], api_key)
        archive = update_translation(archive, key, result, ai["model"])
        save_archive(ARCHIVE_PATH, archive)
    return archive


# 바뀐 글 다시 확인(D-025): 내 공지와 저장한 공지 중 마감이 남은 글만, 같은 글은 12시간에 한 번, 실행당 3건.
RECHECK_PER_RUN = 3
RECHECK_HOURS = 12


def _important(item: dict, saved_ids: set[str]) -> bool:
    external = ".skku.edu/" not in item["notice"]["url"]
    return item["notice"]["id"] in saved_ids or is_mine(item.get("match"), external)


def _saved_ids() -> set[str]:
    try:
        saved = json.loads(os.environ.get("SAVED_NOTICES") or "[]")
    except ValueError:
        return set()
    return {entry["id"] for entry in saved if isinstance(entry, dict) and isinstance(entry.get("id"), str)}


def _recheck_details(archive, settings: dict, now: datetime):
    saved = _saved_ids()
    external = {source['id'] for source in settings['sources'] if source.get('external')}
    done = 0
    for key, item in list(archive.items.items()):
        if done == RECHECK_PER_RUN:
            break
        deadline = item["notice"].get("deadline") or (item.get("ai_deadline") or {}).get("at")
        last = item.get("rechecked_at") or item.get("fetched_at")
        if (not _important(item, saved) or item.get("body_text") is None
                or item['notice']['source_id'] in external
                or ".skku.edu/" not in item["notice"]["url"]
                or (deadline and datetime.fromisoformat(deadline) < now)
                or (last and now - datetime.fromisoformat(last) < timedelta(hours=RECHECK_HOURS))):
            continue
        done += 1
        time.sleep(float(settings["request_gap_seconds"]))
        try:
            html = fetch_detail(item["notice"]["url"], settings["user_agent"],
                                float(settings["timeout_seconds"]))
            detail = parse_detail(html, item["notice"]["url"])
        except (FetchError, ParseError):
            archive = note_body_change(archive, key, None, now.isoformat())[0]
            continue
        archive, changed = note_body_change(archive, key, detail.body_text, now.isoformat())
        if changed:
            archive = update_detail(archive, key, detail.body_text, detail.attachments, now.isoformat(),
                                    detail.images, detail.body_html)
            marks = {"changed_at": now.isoformat(), "change_kind": "본문", "rechecked_at": now.isoformat()}
            archive = Archive({**archive.items, key: {**archive.items[key], **marks}})
        save_archive(ARCHIVE_PATH, archive)
    return archive


def _notify_changes(archive, names: dict[str, str], external: frozenset[str] = frozenset()):
    """학교가 고친 중요한 글을 한 번 알린다. 실패하면 다음 실행에 다시 보낸다."""
    saved = _saved_ids()
    for key, item in archive.items.items():
        changed = item.get("changed_at")
        if item['notice']['source_id'] in external:
            continue
        if not changed or item.get("change_notified") == changed or not _important(item, saved):
            continue
        public = item["notice"]
        title = (item.get("translation") or {}).get("title") or public["title"]
        notice = Notice(public["source_id"], public["article_no"], f"[수정] {title}", public.get("category"),
                        public["url"], date.fromisoformat(public["posted_on"]), public.get("pinned", False))
        what = "제목이 바뀌었어요" if item.get("change_kind") == "제목" else "본문이 바뀌었어요"
        if send_notice(notice, names.get(public["source_id"], public["source_id"]), "default", None,
                       f"학교가 글을 고쳤어요. {what}"):
            archive = Archive({**archive.items, key: {**item, "change_notified": changed}})
            save_archive(ARCHIVE_PATH, archive)
    return archive


def _ai_deadlines(archive, ai: dict, api_key: str):
    # 제목에 마감이 없는 글만, 본문을 받은 뒤 한 번 호출에 BATCH개씩 묻는다(D-023).
    if not api_key:
        return archive
    waiting = [
        {"id": key, "title": item["notice"]["title"], "posted_on": item["notice"]["posted_on"],
         "body": item.get("body_text") or item.get("ocr_text") or ""}
        for key, item in archive.items.items()
        if not item["notice"].get("deadline") and not (item.get("ai_deadline") or {}).get("checked")
        and (item.get("body_text") is not None or item.get("body_attempts", 0) >= 3)
    ][:BATCH * DEADLINE_CALLS]
    # 밀린 글도 한 번에 따라잡도록 실행당 몇 번까지 부른다. 실패하면 남은 것은 다음 실행에 맡긴다.
    for start in range(0, len(waiting), BATCH):
        results = read_deadlines(waiting[start:start + BATCH], ai["model"], api_key)
        if results is None:
            break
        archive = update_ai_deadlines(archive, results, ai["model"])
        save_archive(ARCHIVE_PATH, archive)
    return archive



def _fill_summaries(archive: Archive, ai: dict, api_key: str, school_sources: set[str],
                    seen_ids: set[str]) -> Archive:
    # 이미 요약된 글은 건드리지 않고, 공개 학교 본문만 한 번에 최대 6건 보낸다.
    if not api_key:
        return archive
    now = datetime.now(KST)
    waiting = [
        {"id": key, "title": item["notice"]["title"],
         "body": item.get("body_text") or item.get("ocr_text") or ""}
        for key, item in sorted(archive.items.items(),
                                key=lambda entry: (entry[1]["notice"].get("posted_on") or "",
                                                   entry[1]["notice"].get("first_seen") or ""), reverse=True)
        if key in seen_ids and item["notice"]["source_id"] in school_sources and not item.get("summary")
        and len((item.get("body_text") or item.get("ocr_text") or "").strip()) >= 50
        and _retry_due(item.get("summary_attempts", 0), item.get("summary_attempted_at"), now, 2)
    ][:SUMMARY_BATCH]
    if not waiting:
        return archive
    results = summarize(waiting, ai["model"], api_key)
    if results is None:
        archive = Archive({**archive.items, **{
            entry["id"]: {**archive.items[entry["id"]], "summary_last_failed_at": now.isoformat()}
            for entry in waiting
        }})
        save_archive(ARCHIVE_PATH, archive)
        return archive
    items = dict(archive.items)
    for entry in waiting:
        key = entry["id"]
        current = items[key]
        summary = results.get(key)
        if summary:
            items[key] = {**current, "summary": summary, "summary_last_failed_at": None}
        else:
            items[key] = {**current, "summary_attempts": current.get("summary_attempts", 0) + 1,
                          "summary_attempted_at": now.isoformat(), "summary_last_failed_at": now.isoformat()}
    archive = Archive(items)
    save_archive(ARCHIVE_PATH, archive)
    return archive

def _profile() -> dict:
    raw = os.environ.get("PROFILE_YAML")
    if raw is None and PROFILE_PATH.exists():
        raw = PROFILE_PATH.read_text(encoding="utf-8")
    parsed = yaml.safe_load(raw) if raw else {}
    if not isinstance(parsed, dict):
        raise ValueError("profile must be a YAML mapping")
    return parsed


def _images_for_judgment(
    archive: Archive, notices: list, now: datetime, user_agent: str, budget: list[int] | None = None,
) -> tuple[Archive, dict]:
    images = {}
    budget = budget if budget is not None else [10]
    remaining = budget[0]
    for notice in notices:
        key = f"{notice.source_id}/{notice.article_no}"
        item = archive.items.get(key)
        if not item or item.get("image_attempted") or item.get("fetched_at") != now.isoformat():
            continue
        if len((item.get("body_text") or "").strip()) >= 50 or not item.get("images"):
            continue
        if remaining == 0:
            break
        urls = item["images"][:min(3, remaining)]
        archive = mark_image_attempted(archive, key)
        save_archive(ARCHIVE_PATH, archive)
        if remaining < 10:
            time.sleep(1)
        fetched = fetch_images(urls, user_agent, remaining)
        if fetched:
            images[key] = fetched
        remaining -= len(urls)
        budget[0] = remaining
    return archive, images



def _intern_decisions(
    archive: Archive, state, sources: list[dict], ai: dict, api_key: str,
    budget: list[int], user_agent: str, profile: dict | None = None,
) -> tuple[Archive, dict[str, Judgment]]:
    """Judge up to six ready public internships; cached decisions never create an alert by themselves."""
    if not api_key:
        return archive, {}
    external = {s["id"] for s in sources if s.get("external")}
    ranked = []
    judgments = {}
    model = ai["model"]
    profile = {key: value for key, value in (profile or {}).items()
               if key in {"year", "semester", "enrolled_semester", "enrollment_status", "military_service"}}
    for key, item in archive.items.items():
        notice = item["notice"]
        if notice["source_id"] not in external or item.get("body_text") is None:
            continue
        body = "\n".join(filter(None, (item.get("body_text"), item.get("ocr_text"))))
        urls = item.get("images") or []
        fingerprint = intern_fingerprint(notice["title"], body, urls, model, profile)
        cache = item.get("intern_judgment") or {}
        if (cache.get("fingerprint") == fingerprint
                and cache.get("verdict") in {"relevant", "maybe", "not_relevant"}):
            judgments[key] = Judgment(cache["verdict"], cache.get("reason", ""), model)
            continue
        source = state.sources.get(notice["source_id"])
        seen = source.seen.get(notice["article_no"]) if source else None
        previous = (item.get("match") or {}).get("ai") or {}
        old_reason = previous.get("reason") or ""
        needs_preference_review = preference_safe_reason(old_reason) != old_reason
        rank = 0 if seen is None or seen.status == "pending" else 1 if needs_preference_review else 2
        ranked.append((rank, key, item, body, urls, fingerprint))
    ranked.sort(key=lambda entry: entry[0])
    selected, images, fingerprints = [], {}, {}
    for _, key, item, body, urls, fingerprint in ranked:
        if len(selected) >= INTERN_BATCH:
            break
        parts = []
        image_urls = urls[:3]
        if image_urls and budget[0] >= len(image_urls):
            if budget[0] < 10:
                time.sleep(1)
            parts = fetch_images(image_urls, user_agent, len(image_urls), allow_external=True)
            budget[0] -= len(image_urls)
        # 그림이 있으면 판단에 함께 필요하다. 못 받았거나 예산이 없으면 다음 실행에 맡긴다.
        if (image_urls and len(parts) != len(image_urls)) or (not body.strip() and not parts):
            continue
        if parts:
            images[key] = parts
        selected.append({"id": key, "title": item["notice"]["title"], "body": body})
        fingerprints[key] = fingerprint
    if selected:
        found = judge_internships(selected, model, api_key, profile=profile, images=images)
        print(f"인턴 AI: {len(selected)}건 요청, {len(found)}건 판정")
        items = dict(archive.items)
        for key, result in found.items():
            if key not in fingerprints:
                continue
            old = items[key]
            decision = {"fingerprint": fingerprints[key], "verdict": result.verdict,
                        "reason": result.reason, "model": model}
            match = {**(old.get("match") or {}), "ai": {"verdict": result.verdict,
                     "reason": result.reason, "model": model, "interests": []}}
            items[key] = {**old, "intern_judgment": decision, "match": match}
            judgments[key] = result
        if found:
            archive = Archive(items)
            save_archive(ARCHIVE_PATH, archive)
    elif ranked:
        print(f"인턴 AI: 본문과 이미지 준비 대기 {len(ranked)}건")
    return archive, judgments

def _apply_ocr(archive: Archive, images: dict) -> Archive:
    for notice_id, parts in images.items():
        text = read_images([part.data for part in parts])
        if text:
            archive = update_image_text(archive, notice_id, text)
    return archive


def run(args: argparse.Namespace) -> int:
    if args.all and not args.dry_run:
        print("--all requires --dry-run", file=sys.stderr)
        return 2
    if not args.rules.exists():
        print(f"{args.rules} 없음: config/rules.example.yaml을 복사하세요", file=sys.stderr)
        return 2
    load_dotenv(override=False)
    if not args.dry_run:
        try:
            if not has_notification_channel():
                print("설정 오류: NOTIFY_URLS 또는 웹 푸시 설정이 필요해요", file=sys.stderr)
                return 2
        except ValueError as exc:
            print(f"설정 오류: {exc}", file=sys.stderr)
            return 2
    try:
        rules = load_rules(args.rules)
        interests = load_interests(INTERESTS_PATH, os.environ.get("INTEREST_KEYWORDS", ""))
        settings = yaml.safe_load(SOURCES_PATH.read_text(encoding="utf-8"))
        ai = yaml.safe_load(AI_PATH.read_text(encoding="utf-8"))
        state = load_state(STATE_PATH)
        archive = Archive() if args.dry_run else load_archive(ARCHIVE_PATH)
        profile = _profile() if ai.get("enabled") and not getattr(args, "no_ai", False) else {}
    except (OSError, ValueError, yaml.YAMLError) as exc:
        print(f"설정 오류: {exc}", file=sys.stderr)
        return 2
    now = datetime.now(KST)
    gap = max(1.0, float(settings.get("request_gap_seconds", 1)))
    previous_network = False
    failed = False
    boards: list[tuple[dict, list]] = []
    external_deadlines: dict[str, str] = {}
    external_success: set[str] = set()
    image_budget = [10]
    intern_judgments: dict[str, Judgment] = {}
    for source in settings["sources"]:
        source_id = source["id"]
        if getattr(args, "skip_external", False) and source.get("external"):
            continue
        if (getattr(args, "external_if_due", False) and source.get("external")
                and not external_due(state, source_id, now)):
            continue
        if source.get("kind") in COLLECTORS:
            # 외부 인턴 공고 목록: 사이트마다 한 번 요청한다. fixture 실행에서는 건너뛴다.
            if args.from_fixtures:
                continue
            if previous_network:
                time.sleep(gap)
            previous_network = True
            try:
                postings = COLLECTORS[source["kind"]](
                    lambda url, body, headers: fetch_json_post(
                        url, body, settings["user_agent"], float(settings["timeout_seconds"]), headers),
                    now, source_id)
            except (FetchError, KeyError, TypeError, ValueError) as exc:
                print(f"{source_id}: 외부 공고 읽기 실패: {type(exc).__name__}", file=sys.stderr)
                continue
            external_deadlines.update({f"{source_id}/{n.article_no}": d for n, d in postings if d})
            external_success.add(source_id)
            if postings:
                boards.append((source, [notice for notice, _ in postings]))
            continue
        try:
            if args.from_fixtures:
                html = _fixture(source_id)
            else:
                if previous_network:
                    time.sleep(gap)
                previous_network = True
                html = fetch_list(source["url"], settings["user_agent"], float(settings["timeout_seconds"]))
            if source.get("kind") == "skku-career-intern":
                postings = skku_career_list(html, now, source_id)
                notices = [notice for notice, _ in postings]
                external_deadlines.update({f"{source_id}/{n.article_no}": d for n, d in postings if d})
                external_success.add(source_id)
            else:
                notices = parse_list(html, source_id, source["url"])
        except (FileNotFoundError, FetchError, ParseError) as exc:
            print(f"{source_id}: {exc}", file=sys.stderr)
            failed = True
            continue
        if not notices:
            print(f"{source_id}: 파싱 결과 0건", file=sys.stderr)
            failed = True
            continue
        boards.append((source, notices))
    if not args.dry_run:
        for source, notices in boards:
            if source["id"] not in state.sources:
                state = baseline(state, source["id"], notices, now)
                save_state(STATE_PATH, state)
                for notice in notices:
                    archive = add_notice(archive, notice, now.isoformat())
                save_archive(ARCHIVE_PATH, archive)
        archive = set_source_deadlines(archive, external_deadlines)
        for _source, notices in boards:
            archive, title_changes = note_list_changes(archive, notices, now.isoformat())
            if title_changes:
                save_archive(ARCHIVE_PATH, archive)
        archive = _fill_details(archive, state, boards, settings, args.from_fixtures, now)
        archive = set_source_deadlines(archive, external_deadlines)
        save_archive(ARCHIVE_PATH, archive)
        if not args.from_fixtures:
            archive = _recheck_details(archive, settings, now)
        if ai.get("enabled") and not getattr(args, "no_ai", False) and not args.from_fixtures:
            # 알림 대상 판단을 번역, 마감 추출과 요약보다 먼저 실행한다.
            archive, intern_judgments = _intern_decisions(
                archive, state, settings["sources"], ai, os.environ.get("GEMINI_API_KEY", ""),
                image_budget, settings["user_agent"], profile,
            )
            archive = _translate(archive, ai, os.environ.get("GEMINI_API_KEY", ""))
            archive = _ai_deadlines(archive, ai, os.environ.get("GEMINI_API_KEY", ""))
            school_sources = {source["id"] for source in settings["sources"] if not source.get("external")}
            seen_ids = {f"{source_id}/{number}" for source_id, record in state.sources.items()
                        for number in record.seen}
            archive = _fill_summaries(archive, ai, os.environ.get("GEMINI_API_KEY", ""),
                                      school_sources, seen_ids)
    candidates = []
    image_candidates = []
    for source, notices in boards:
        for notice in notices:
            record = state.sources.get(source["id"])
            seen = record.seen.get(notice.article_no) if record else None
            entry = archive.items.get(f"{source['id']}/{notice.article_no}", {})
            deferred = (source.get("external") and seen is not None and seen.status == "pending"
                        and not (entry.get("match") or {}).get("priority")
                        and entry.get("body_text") is not None)
            if (args.dry_run and (args.all or is_new(state, notice))) or (
                not args.dry_run and record is not None and (seen is None or deferred)
            ):
                if not source.get("external"):
                    image_candidates.append(notice)
                if not source.get("external") and not any(
                    word.strip().casefold() in notice.title.casefold() for word in rules.exclude_title
                ):
                    candidates.append(notice)
    judgments = {}
    image_parts = {}
    if image_candidates and not args.dry_run and not args.from_fixtures:
        archive, image_parts = _images_for_judgment(
            archive, image_candidates, now, settings["user_agent"], image_budget
        )
        archive = _apply_ocr(archive, image_parts)
        if image_parts:
            save_archive(ARCHIVE_PATH, archive)
    if (not args.dry_run and ai.get("enabled") and not getattr(args, "no_ai", False)
            and (profile or interests)):
        items = dict(archive.items)
        for notice in candidates:
            key = f"{notice.source_id}/{notice.article_no}"
            if key not in items:
                archive = add_notice(Archive(items), notice, now.isoformat())
                items = dict(archive.items)
            items[key] = {**items[key], "ai_judgment_pending": True}
        archive = Archive(items)
        save_archive(ARCHIVE_PATH, archive)
        current_ids = {f"{notice.source_id}/{notice.article_no}" for notice in candidates}
        school_ids = {source["id"] for source in settings["sources"] if not source.get("external")}
        for key, item in archive.items.items():
            data = item["notice"]
            if (key in current_ids or not item.get("ai_judgment_pending")
                    or data["source_id"] not in school_ids):
                continue
            try:
                candidates.append(Notice(data["source_id"], data["article_no"], data["title"],
                                         data.get("category"), data["url"],
                                         date.fromisoformat(data["posted_on"]), data.get("pinned", False)))
            except (KeyError, TypeError, ValueError):
                continue
    if candidates and ai.get("enabled") and not getattr(args, "no_ai", False):
        key = os.environ.get("GEMINI_API_KEY")
        if not key:
            print("GEMINI_API_KEY 없음: 규칙만 적용")
        elif not profile and not interests:
            print("프로필 없음: 규칙만 적용")
        else:
            selected = candidates[: max(0, int(ai.get("max_per_run", 30)))]
            judgments = judge_notices(
                selected,
                {source["id"]: source["name"] for source in settings["sources"]},
                profile,
                ai["model"],
                key,
                interests=interests,
                bodies={key: "\n".join(filter(None, (
                    item.get("body_text") or "", item.get("ocr_text") or ""
                ))) for key, item in archive.items.items()},
                images=image_parts,
            )
            if not args.dry_run and judgments:
                items = dict(archive.items)
                for key, result in judgments.items():
                    if key not in items:
                        continue
                    item = items[key]
                    match = {**(item.get("match") or {}), "ai": {
                        "verdict": result.verdict, "reason": result.reason, "model": result.model,
                        "interests": list(result.interests),
                    }}
                    updated = {**item, "match": match}
                    updated.pop("ai_judgment_pending", None)
                    if result.summary:
                        updated["summary"] = result.summary
                    items[key] = updated
                archive = Archive(items)
                save_archive(ARCHIVE_PATH, archive)
    for source, notices in boards:
        if args.dry_run and source["id"] not in state.sources:
            print(f"{source['id']}: state 없음: 실제 첫 실행이면 알림 없이 기준선만 저장")
        for notice in notices:
            record = state.sources.get(source["id"])
            seen = record.seen.get(notice.article_no) if record else None
            new = seen is None
            process = (
                (args.all or new)
                if args.dry_run
                else (record is not None and (new or seen.status == "pending"))
            )
            excluded = any(word.strip().casefold() in notice.title.casefold() for word in rules.exclude_title)
            match = match_notice(notice, rules) if process and not excluded else None
            if source.get("external"):
                judgment = intern_judgments.get(f"{source['id']}/{notice.article_no}")
            else:
                judgment = (judgments.get(f"{source['id']}/{notice.article_no}")
                            if process and not excluded else None)
            item = archive.items.get(f"{source['id']}/{notice.article_no}", {})
            text_interests = (
                match_interests(notice, interests,
                                f"{item.get('body_text') or ''} {item.get('ocr_text') or ''}")
                if process and not excluded else ()
            )
            shown_interests = tuple(
                word for word in interests
                if word in text_interests
            )
            # 실패했던 알림도 이전 판정과 현재 정책으로 다시 확인한다.
            previous_priority = None
            if not args.dry_run and seen is not None and seen.status == "pending":
                previous = archive.items.get(f"{source['id']}/{notice.article_no}", {}).get("match") or {}
                previous_priority = previous.get("priority")
                # priority가 없는 pending은 본문을 기다린 글이므로 새 판정을 쓴다.
                if previous_priority and not source.get("external"):
                    if previous.get("rule_name"):
                        match = Match(notice, previous["rule_name"], previous_priority,
                                      tuple(previous.get("reasons", [])))
                    ai_data = previous.get("ai")
                    judgment = Judgment(**ai_data) if ai_data else None
                    shown_interests = tuple(previous.get("interests", [])) or shown_interests
            body = "\n".join(filter(None, (item.get("body_text"), item.get("ocr_text"))))
            external = bool(source.get("external"))
            priority = (alert_priority(external=external, title=notice.title, body=body, match=match,
                                       judgment=judgment, interests=shown_interests)
                        if process else None)
            if priority is not None and previous_priority:
                priority = previous_priority
            if args.dry_run:
                name = match.rule_name if match else "-"
                ai_text = f" AI={judgment.verdict}: {judgment.reason}" if judgment else ""
                interest_text = f" 관심 {', '.join(shown_interests)}" if shown_interests else ""
                label = "새 글" if new else "본 글"
                print(
                    f"[{label}] [{name}] [{priority or '-'}] "
                    f"{notice.title} {notice.url}{interest_text}{ai_text}"
                )
                first_seen = seen.first_seen if seen else now.isoformat()
                archive = add_notice(
                    archive, notice, first_seen, match, judgment, priority,
                    interests=shown_interests,
                )
                continue
            if not process:
                continue
            if external and priority is None and judgment is None:
                # 본문 대기는 발송 실패가 아니다. 배송 재시도 횟수를 보존한다.
                state = record_result(state, notice, "pending", now)
                current_source = state.sources[notice.source_id]
                current_record = current_source.seen[notice.article_no]
                preserved = replace(current_record, status="pending", attempts=seen.attempts if seen else 0)
                updated_source = replace(current_source,
                                         seen={**current_source.seen, notice.article_no: preserved})
                state = replace(state, sources={**state.sources, notice.source_id: updated_source})
                save_state(STATE_PATH, state)
                archive = add_notice(archive, notice, preserved.first_seen)
                save_archive(ARCHIVE_PATH, archive)
                continue
            if priority is None:
                state = record_result(state, notice, "skipped", now)
                save_state(STATE_PATH, state)
                archive = add_notice(
                    archive,
                    notice,
                    state.sources[source["id"]].seen[notice.article_no].first_seen,
                    match,
                    judgment,
                    priority,
                    interests=shown_interests,
                )
                save_archive(ARCHIVE_PATH, archive)
                continue
            # 영어 공지는 옮긴 제목으로 알린다.
            translated = archive.items.get(f"{source['id']}/{notice.article_no}", {}).get("translation") or {}
            korean = translated.get("title")
            sent = send_notice(
                replace(notice, title=korean) if korean else notice, source["name"], priority, match,
                judgment.reason if judgment else None, shown_interests,
            )
            state = record_result(state, notice, "notified" if sent else "pending", now)
            save_state(STATE_PATH, state)
            archive = add_notice(
                archive,
                notice,
                state.sources[source["id"]].seen[notice.article_no].first_seen,
                match,
                judgment,
                priority,
                sent,
                shown_interests,
            )
            save_archive(ARCHIVE_PATH, archive)
            if not sent:
                failed = True
                print(f"{source['id']}/{notice.article_no}: 알림 실패", file=sys.stderr)
    if not args.dry_run and external_success:
        state = replace(state, external_checked_at={**state.external_checked_at,
                        **dict.fromkeys(external_success, now.isoformat())})
        save_state(STATE_PATH, state)
    if not args.dry_run:
        archive = _notify_changes(
            archive, {s["id"]: s["name"] for s in settings["sources"]},
            frozenset(s["id"] for s in settings["sources"] if s.get("external")))
    if not getattr(args, "no_canvas", False):
        try:
            canvas_config = yaml.safe_load(CANVAS_CONFIG_PATH.read_text(encoding="utf-8"))
            fixture_dir = getattr(args, "canvas_fixtures", None)
            token = os.environ.get("CANVAS_TOKEN", "")
            if canvas_config.get("enabled") and (token or fixture_dir):
                canvas_state = load_canvas_state(CANVAS_STATE_PATH)
                minimum = max(60, int(canvas_config.get("min_refresh_minutes", 60)))
                recently_refreshed = (
                    not args.dry_run
                    and CANVAS_STATE_PATH.exists()
                    and canvas_state.last_learningx_launch is not None
                    and time.time() - CANVAS_STATE_PATH.stat().st_mtime < minimum * 60
                )
                if not recently_refreshed:
                    def reserve_learningx() -> bool:
                        nonlocal canvas_state
                        reserved_at = datetime.now(KST)
                        last = canvas_state.last_learningx_launch
                        if last and (reserved_at - datetime.fromisoformat(last)).total_seconds() < 3600:
                            return False
                        canvas_state = replace(canvas_state, last_learningx_launch=reserved_at.isoformat())
                        # Persist the attempt before launching; never store issued credentials.
                        save_canvas_state(CANVAS_STATE_PATH, canvas_state)
                        return True

                    incomplete = [False]
                    if args.dry_run or fixture_dir:
                        items = read_canvas(token, now, fixture_dir)
                    else:
                        items = read_canvas(token, now, fixture_dir, reserve_learningx=reserve_learningx,
                                            on_incomplete=lambda: incomplete.__setitem__(0, True))
                    clock = os.environ.get("CANVAS_SUMMARY_TIME") or canvas_config["summary_time"]
                    try:
                        summary_time = datetime.strptime(clock, "%H:%M").time()
                    except ValueError:
                        summary_time = datetime.strptime(canvas_config["summary_time"], "%H:%M").time()
                    alerts, next_state = plan_alerts(
                        items, canvas_state, now,
                        canvas_config["leads"], summary_time
                    )
                    if incomplete[0]:
                        alerts = [
                            replace(alert, title="아이캠퍼스 일정을 모두 확인하지 못했어요",
                                    body="잠시 뒤 다시 확인할게요. 아이캠퍼스에서도 확인할 수 있어요")
                            if alert.summary_day else alert for alert in alerts
                            if not alert.summary_day
                            or canvas_state.partial_summary_sent_on != alert.summary_day
                        ]
                    if canvas_state.problem:
                        next_state = replace(next_state, problem=None)
                    if args.dry_run:
                        for alert in alerts:
                            print(f"[Canvas 알림 예정] {alert.title} | {alert.body} | {alert.url}")
                    elif not canvas_state.initialized:
                        for alert in alerts:
                            next_state = mark_sent(next_state, alert, now)
                        save_canvas_state(CANVAS_STATE_PATH, next_state)
                    else:
                        for alert in alerts:
                            if send_canvas(alert.title, alert.body, alert.url, alert.priority,
                                           summary=bool(alert.summary_day)):
                                next_state = mark_sent(next_state, alert, now)
                                if incomplete[0] and alert.summary_day:
                                    next_state = replace(
                                        next_state, summary_sent_on=canvas_state.summary_sent_on,
                                        partial_summary_sent_on=alert.summary_day,
                                    )
                                save_canvas_state(CANVAS_STATE_PATH, next_state)
                            else:
                                failed = True
                                print("Canvas 알림 실패", file=sys.stderr)
                        save_canvas_state(CANVAS_STATE_PATH, next_state)
            elif canvas_config.get("enabled"):
                print("CANVAS_TOKEN 없음: Canvas 건너뜀")
        except CanvasError as exc:
            if str(exc) == "토큰 거절":
                current = load_canvas_state(CANVAS_STATE_PATH)
                problem = current.problem or {"code": "token-rejected", "notifiedProblem": False}
                current = replace(current, problem=problem)
                alert = problem_alert(current)
                if args.dry_run:
                    print(f"[Canvas 알림 예정] {alert.title}")
                else:
                    save_canvas_state(CANVAS_STATE_PATH, current)
                    if alert and send_canvas(
                        alert.title, alert.body, alert.url, alert.priority, summary=True,
                    ):
                        save_canvas_state(
                            CANVAS_STATE_PATH, replace(current, problem={**problem, "notifiedProblem": True})
                        )
                failed = True
            else:
                print(f"Canvas: {exc}", file=sys.stderr)
                failed = True
        except (OSError, ValueError, KeyError, yaml.YAMLError) as exc:
            print(f"Canvas 설정 또는 fixture 오류: {type(exc).__name__}", file=sys.stderr)
            failed = True
    if getattr(args, "export", None):
        # 예전 규칙(비슷한 말)으로 저장된 관심 표시도 지금 키워드와 글자 그대로 다시 맞춘다(D-024).
        archive = Archive(refresh_archive_interests(archive.items, interests))
        export_site(args.export, archive, settings["sources"], now)
    return 1 if failed else 0


def main() -> int:
    parser = argparse.ArgumentParser(description="성균관대 공지 알림")
    parser.add_argument("--rules", type=Path, default=Path("config/rules.yaml"))
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--all", action="store_true")
    parser.add_argument("--from-fixtures", action="store_true")
    parser.add_argument("--no-ai", action="store_true")
    parser.add_argument("--skip-external", action="store_true")
    parser.add_argument("--external-if-due", action="store_true")
    parser.add_argument("--export", type=Path)
    parser.add_argument("--no-canvas", action="store_true")
    parser.add_argument("--canvas-fixtures", type=Path)
    return run(parser.parse_args())
