# 출처: WhaleExtentions/extensions/icampus-check/notify.js
"""Pure Canvas alert decisions and the private, minimal reminder state."""

import json
import os
import tempfile
from dataclasses import dataclass, field, replace
from datetime import datetime, time, timedelta
from pathlib import Path

from skku_notice.deadline import KST

CANVAS_URL = "https://canvas.skku.edu/"



@dataclass(frozen=True)
class CanvasItem:
    key: str
    title: str
    course: str
    kind: str
    due: datetime
    url: str


@dataclass(frozen=True)
class CanvasState:
    notified: dict[str, str] = field(default_factory=dict)
    summary_sent_on: str | None = None
    problem: dict | None = None
    version: int = 1
    initialized: bool = False
    last_learningx_launch: str | None = None
    partial_summary_sent_on: str | None = None


@dataclass(frozen=True)
class CanvasAlert:
    title: str
    body: str
    url: str
    priority: str = "default"
    keys: tuple[str, ...] = ()
    summary_day: str | None = None


def load_canvas_state(path: Path) -> CanvasState:
    if not path.exists():
        return CanvasState()
    raw = json.loads(path.read_text(encoding="utf-8"))
    if raw.get("version") != 1 or not isinstance(raw.get("notified"), dict):
        raise ValueError("unsupported Canvas state format")
    return CanvasState(raw["notified"], raw.get("summary_sent_on"), raw.get("problem"),
                       initialized=raw.get("initialized", True),
                       last_learningx_launch=raw.get("last_learningx_launch"),
                       partial_summary_sent_on=raw.get("partial_summary_sent_on"))


def save_canvas_state(path: Path, state: CanvasState) -> None:
    data = {
        "version": 1,
        "notified": state.notified,
        "summary_sent_on": state.summary_sent_on,
        "partial_summary_sent_on": state.partial_summary_sent_on,
        "problem": state.problem,
        "initialized": state.initialized,
        "last_learningx_launch": state.last_learningx_launch,
    }
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=path.parent, delete=False) as output:
            temporary = Path(output.name)
            json.dump(data, output, ensure_ascii=False, indent=2)
            output.write("\n")
            output.flush()
            os.fsync(output.fileno())
        temporary.replace(path)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def remaining_text(delta: timedelta) -> str:
    hours = delta.total_seconds() / 3600
    if hours >= 36:
        return f"{round(hours / 24)}일"
    if hours >= 20:
        return "하루"
    if hours >= 1:
        return f"{round(hours)}시간"
    return f"{max(1, round(delta.total_seconds() / 60))}분"


def _context(item: CanvasItem) -> str:
    due = item.due.astimezone(KST)
    weekday = "월화수목금토일"[due.weekday()]
    return f"{item.course}, {due.month}월 {due.day}일({weekday}) {due:%H:%M} 마감"


def _summary(items: list[CanvasItem], now: datetime, summary_time: time) -> CanvasAlert | None:
    if now.astimezone(KST).time() < summary_time:
        return None
    local = now.astimezone(KST)
    today = local.date()
    end_day = today + timedelta(days=2 if summary_time.hour >= 18 else 1)
    upcoming = sorted(
        (item for item in items if local < item.due.astimezone(KST)
         and item.due.astimezone(KST).date() < end_day),
        key=lambda item: item.due,
    )
    label = "내일까지" if summary_time.hour >= 18 else "오늘"
    if upcoming:
        title = f"{label} 마감 {len(upcoming)}개가 있어요"
        body = ", ".join(item.title for item in upcoming[:2])
    else:
        title = f"{label} 마감이 없어요"
        body = "편하게 쉬어도 돼요"
    return CanvasAlert(title, body, CANVAS_URL, summary_day=today.isoformat())



def plan_alerts(
    items: list[CanvasItem], state: CanvasState, now: datetime, leads: list[int], summary_time: time
) -> tuple[list[CanvasAlert], CanvasState]:
    stamp = now.isoformat()
    cutoff = now - timedelta(days=30)
    notified = {
        key: value for key, value in state.notified.items() if datetime.fromisoformat(value) >= cutoff
    }
    alerts = []
    if state.summary_sent_on != now.astimezone(KST).date().isoformat():
        summary = _summary(items, now, summary_time)
        if summary:
            alerts.append(summary)
    for item in items:
        left = item.due - now
        if left <= timedelta(0):
            continue
        elapsed = sorted(lead for lead in leads if left <= timedelta(minutes=lead))
        pending = [lead for lead in elapsed if f"{item.key}|m{lead}" not in notified]
        if not pending:
            continue
        keys = tuple(f"{item.key}|m{lead}" for lead in elapsed if lead >= pending[0])
        alerts.append(
            CanvasAlert(
                f"{item.kind} 마감까지 {remaining_text(left)} 남았어요",
                f"{item.title}\n{_context(item)}",
                item.url,
                "high" if pending[0] <= 180 else "default",
                keys=keys,
            )
        )
        if not state.initialized:
            notified.update(dict.fromkeys(keys, stamp))
    return alerts, replace(state, notified=notified, initialized=True)


def mark_sent(state: CanvasState, alert: CanvasAlert, now: datetime) -> CanvasState:
    notified = {**state.notified, **dict.fromkeys(alert.keys, now.isoformat())}
    return replace(state, notified=notified, summary_sent_on=alert.summary_day or state.summary_sent_on)


def problem_alert(state: CanvasState) -> CanvasAlert | None:
    if state.problem and not state.problem.get("notifiedProblem"):
        return CanvasAlert(
            "아이캠퍼스 연결이 끊겼어요",
            "설정 화면에서 아이캠퍼스 토큰을 새로 넣어 주세요",
            CANVAS_URL,
            "high",
        )
    return None
