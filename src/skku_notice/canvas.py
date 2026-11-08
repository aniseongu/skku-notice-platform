# 출처: https://github.com/aniseongu/icampus-plus/blob/master/executescript.js
# 출처: https://github.com/hjkim24/learningx-alert-web/blob/main/accounts/collection.py
"""Read actionable Canvas tasks and optional, temporarily authenticated LearningX lectures."""

import json
import sys
import time
from collections import Counter
from datetime import datetime
from pathlib import Path
from urllib.parse import urljoin, urlsplit

import httpx

from skku_notice.canvas_alerts import CanvasItem
from skku_notice.learningx import LearningXError, LearningXSession

BASE = "https://canvas.skku.edu"
FAVORITES = "/api/v1/users/self/favorites/courses?per_page=100"
OFFLINE_TYPES = {"none", "on_paper", "not_graded"}


# 퀴즈 목록 API가 이 과목에 없거나 이 토큰으로는 열 수 없을 때의 고정 문구(영구적인 상태).
QUIZ_API_ABSENT = {"Canvas HTTP 404", "Canvas HTTP 403"}


class CanvasError(Exception):
    """A safe error code; never includes request details."""


def _get_pages(client: httpx.Client, path: str, gap: float = 1.0) -> list[dict]:
    rows: list[dict] = []
    url = urljoin(BASE, path)
    visited = set()
    while url and len(visited) < 25:
        parts = urlsplit(url)
        if parts.scheme != "https" or parts.netloc != "canvas.skku.edu" or url in visited:
            raise CanvasError("잘못된 페이지 링크")
        visited.add(url)
        unauthorized_seen = False
        for attempt in range(3):
            try:
                response = client.get(url)
            except httpx.RequestError:
                if attempt == 2:
                    raise CanvasError("Canvas 연결 실패") from None
                time.sleep(2**attempt)
                continue
            if response.status_code == 401:
                if unauthorized_seen:
                    raise CanvasError("토큰 거절")
                if attempt == 2:
                    raise CanvasError("Canvas 인증 응답 확인 실패")
                unauthorized_seen = True
                time.sleep(1)
                continue
            if response.status_code >= 500 and attempt < 2:
                time.sleep(2**attempt)
                continue
            if not response.is_success:
                raise CanvasError(f"Canvas HTTP {response.status_code}")
            break
        try:
            data = json.loads(response.text.removeprefix("while(1);"))
        except ValueError:
            raise CanvasError("Canvas 응답 형식 오류") from None
        if not isinstance(data, list):
            raise CanvasError("Canvas 목록 형식 오류")
        rows.extend(data)
        link = response.links.get("next", {}).get("url")
        url = urljoin(BASE, link) if link else ""
        if url:
            time.sleep(gap)
    if url:
        raise CanvasError("Canvas 페이지 제한 초과")
    return rows


def _dt(value: object) -> datetime | None:
    if not isinstance(value, str) or not value:
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        return parsed if parsed.tzinfo else None
    except ValueError:
        return None


def _quiz_assignment(row: dict) -> bool:
    return bool(
        "online_quiz" in (row.get("submission_types") or [])
        or row.get("quiz_id")
        or row.get("is_quiz_assignment")
    )


def _quiz_available(row: dict, quizzes: list[dict], now: datetime) -> bool:
    # Assignment dates alone do not describe quiz availability. Never open a quiz to check it.
    quiz_id = str(row.get("quiz_id") or "")
    assignment_id = str(row.get("id") or "")
    quiz = next((quiz for quiz in quizzes if isinstance(quiz, dict) and (
        (quiz_id and str(quiz.get("id") or "") == quiz_id)
        or (assignment_id and str(quiz.get("assignment_id") or "") == assignment_id)
    )), None)
    if quiz is None:
        return False
    unlock = _dt(quiz.get("unlock_at"))
    lock = _dt(quiz.get("lock_at"))
    permissions = quiz.get("permissions") or {}
    return not (
        quiz.get("published") is False
        or quiz.get("locked_for_user")
        or (unlock and unlock > now)
        or (lock and lock <= now)
        or permissions.get("submit") is False
    )


def _assignment(course: dict, row: dict, now: datetime) -> CanvasItem | None:
    if not row.get("id") or not row.get("name") or row.get("published") is False:
        return None
    submission = row.get("submission") or {}
    done = bool(
        submission.get("submitted_at")
        or submission.get("excused")
        or submission.get("grade") not in (None, "")
        or submission.get("workflow_state") in {"submitted", "graded", "pending_review"}
    )
    due = _dt(row.get("due_at")) or _dt(row.get("lock_at"))
    unlock = _dt(row.get("unlock_at"))
    lock = _dt(row.get("lock_at"))
    types = set(row.get("submission_types") or [])
    if (
        done
        or not due
        or due <= now
        or (unlock and unlock > now)
        or (lock and lock <= now)
        or row.get("locked_for_user")
        or (types and types <= OFFLINE_TYPES)
    ):
        return None
    quiz = bool(
        "online_quiz" in types
        or row.get("quiz_id")
        or row.get("is_quiz_assignment")
        or any(word in row["name"].casefold() for word in ("퀴즈", "시험", "quiz", "exam"))
    )
    course_id = str(course["id"])
    url = row.get("html_url") or f"{BASE}/courses/{course_id}/assignments/{row['id']}"
    if urlsplit(url).netloc != "canvas.skku.edu":
        url = f"{BASE}/courses/{course_id}/assignments/{row['id']}"
    return CanvasItem(
        f"{course_id}:assignment:{row['id']}",
        row["name"],
        course["name"],
        "퀴즈" if quiz else "과제",
        due,
        url,
    )


def _lecture_completion(value: object) -> bool | None:
    if isinstance(value, bool):
        return value
    if isinstance(value, int):
        return {0: False, 1: True}.get(value)
    if isinstance(value, str):
        value = value.strip().casefold()
        if value in {"true", "1", "complete", "completed"}:
            return True
        if value in {"false", "0", "incomplete", "not_completed"}:
            return False
    return None


def _lecture_skip(row: dict, now: datetime) -> str | None:
    """Why a lecture row is not alerted, or None when it is. Names only, never titles."""
    info = row.get("content_data") or {}
    if info.get("use_attendance") is not True:
        return "출석 안 씀"
    due = _dt(info.get("due_at"))
    if row.get("published") is False or info.get("published") is False:
        return "비공개"
    completed = _lecture_completion(row.get("completed"))
    if completed is not False:
        return "완료" if completed else "완료 여부 모름"
    if not due:
        return "마감 없음"
    if due <= now:
        return "마감 지남"
    if row.get("attendance_status") == "attendance":
        return "출석 처리됨"
    if _dt(info.get("unlock_at")) and _dt(info["unlock_at"]) > now:
        return "아직 안 열림"
    return None


def _lecture(course: dict, row: dict, now: datetime) -> CanvasItem | None:
    info = row.get("content_data") or {}
    if _lecture_skip(row, now):
        return None
    due = _dt(info.get("due_at"))
    item_id = row.get("module_item_id") or row.get("id")
    if not item_id or not row.get("title"):
        return None
    course_id = str(course["id"])
    key_id = row.get("content_id") or info.get("id") or item_id
    return CanvasItem(
        f"{course_id}:lecture:{key_id}",
        row["title"],
        course["name"],
        "강의",
        due,
        f"{BASE}/courses/{course_id}/modules/items/{item_id}",
    )


def read_canvas(
    token: str, now: datetime, fixture_dir: Path | None = None, gap: float = 1.0,
    reserve_learningx=None, on_incomplete=None,
) -> list[CanvasItem]:
    """Use fixture responses or sequential, bearer-authenticated API calls."""
    if fixture_dir:

        def read(name: str) -> list[dict]:
            data = json.loads((fixture_dir / name).read_text(encoding="utf-8"))
            if not isinstance(data, list):
                raise CanvasError("Canvas fixture 목록 형식 오류")
            return data

        courses = read("favorites.json")
    else:
        client = httpx.Client(
            headers={"Accept": "application/json", "Authorization": f"Bearer {token}"},
            timeout=10.0,
            follow_redirects=False,
        )
        lecture_session = None
        try:
            courses = _get_pages(client, FAVORITES, gap)
            reserved = bool(reserve_learningx and courses and reserve_learningx())
            if reserved:
                lecture_session = LearningXSession()
                try:
                    if not lecture_session.authenticate(client, courses, gap):
                        lecture_session.close()
                        lecture_session = None
                        print("강의 조회 대기: 강의콘텐츠 도구를 찾지 못했어요", file=sys.stderr)
                except LearningXError as exc:
                    print(f"강의 조회 대기: {exc}", file=sys.stderr)
                    lecture_session.close()
                    lecture_session = None
            if courses and not lecture_session and on_incomplete:
                # 사유를 남긴다. 건너뛴 이유가 로그에 없으면 불완전 경고의 원인을 알 수 없다.
                if reserve_learningx and not reserved:
                    print("강의 조회 대기: 1시간 안에 이미 조회해서 건너뛰었어요", file=sys.stderr)
                on_incomplete()
            result = _read_courses(courses, now, lambda path: _get_pages(client, path, gap),
                                   gap, True, lecture_session, on_incomplete)
            if reserve_learningx:
                print(f"Canvas 조회: 과제와 퀴즈 {sum(i.kind != '강의' for i in result)}개, "
                      f"강의 {sum(i.kind == '강의' for i in result)}개")
            return result
        finally:
            if lecture_session:
                lecture_session.close()
            client.close()
    return _read_courses(courses, now, read, 0, False)


def _read_courses(courses: list[dict], now: datetime, get, gap: float, network: bool,
                  lecture_session=None, on_incomplete=None) -> list[CanvasItem]:
    found: dict[str, CanvasItem] = {}
    skipped: Counter[str] = Counter()
    for course in courses:
        if not isinstance(course, dict) or not str(course.get("id", "")).isdigit() or not course.get("name"):
            continue
        course_id = str(course["id"])
        if network:
            time.sleep(gap)
        assignments = get(
            f"assignments_{course_id}.json"
            if not network
            else f"/api/v1/courses/{course_id}/assignments?include%5B%5D=submission&per_page=100"
        )
        modules = [] if network else get(f"modules_{course_id}.json")
        if network and lecture_session:
            time.sleep(gap)
            try:
                modules = lecture_session.read_modules(course_id, gap)
            except LearningXError as exc:
                print(f"강의 조회 대기: {exc}", file=sys.stderr)
                if on_incomplete:
                    on_incomplete()
        quizzes: list[dict] | None = []
        if network and any(_quiz_assignment(row) for row in assignments):
            time.sleep(gap)
            try:
                quizzes = get(f"/api/v1/courses/{course_id}/quizzes?per_page=100")
            except CanvasError as exc:
                if str(exc) == "토큰 거절":
                    raise
                if str(exc) in QUIZ_API_ABSENT:
                    # 이 과목은 고전 퀴즈 목록 API가 없다(새 퀴즈 등). 영구적인 상태라
                    # 불완전 표시를 켜지 않고, 아이캠퍼스 플러스처럼 과제의 열림·잠금 필드로만 판단한다.
                    quizzes = None
                else:
                    print(f"퀴즈 조회 대기: {exc}", file=sys.stderr)
                    if on_incomplete:
                        on_incomplete()
                    # 일시적인 오류: 이번 조회에서는 확인하지 못한 퀴즈를 뺀다.
        for row in assignments:
            quiz_checked = network and quizzes is not None and _quiz_assignment(row)
            if quiz_checked and not _quiz_available(row, quizzes, now):
                continue
            item = _assignment(course, row, now)
            if item:
                found[item.key] = item
        for module in modules:
            for row in module.get("module_items") or []:
                if network and lecture_session:
                    skipped[_lecture_skip(row, now) or "알림 대상"] += 1
                item = _lecture(course, row, now)
                if item and item.key not in found:
                    found[item.key] = item
    if skipped:
        # 강의가 0개일 때 어느 조건에서 빠졌는지 알 수 있게 분류별 개수만 남긴다(제목과 과목명은 쓰지 않는다).
        print("강의 항목 분류: " + ", ".join(f"{key} {count}" for key, count in sorted(skipped.items())))
    return sorted(found.values(), key=lambda item: (item.due, item.key))
