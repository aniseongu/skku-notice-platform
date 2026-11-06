# 출처: https://github.com/khj1870-robotics/st-notice-alert/blob/main/monitor.py
"""Versioned seen-state, with per-board baseline and atomic persistence."""

import json
import os
import tempfile
from dataclasses import dataclass, field, replace
from datetime import datetime, timedelta
from pathlib import Path

from skku_notice.model import Notice

STATUSES = {"baseline", "skipped", "pending", "notified", "failed"}
MAX_SEEN = 500


@dataclass(frozen=True)
class SeenRecord:
    first_seen: str
    status: str
    attempts: int


@dataclass(frozen=True)
class SourceState:
    initialized_at: str
    seen: dict[str, SeenRecord] = field(default_factory=dict)


@dataclass(frozen=True)
class State:
    sources: dict[str, SourceState] = field(default_factory=dict)
    version: int = 1
    external_checked_at: dict[str, str] = field(default_factory=dict)


def load_state(path: Path) -> State:
    if not path.exists():
        return State()
    raw = json.loads(path.read_text(encoding="utf-8"))
    if raw.get("version") != 1 or not isinstance(raw.get("sources"), dict):
        raise ValueError("unsupported state format")
    sources = {}
    for source_id, source in raw["sources"].items():
        seen = {}
        for article_no, record in source["seen"].items():
            item = SeenRecord(**record)
            if item.status not in STATUSES or item.attempts < 0:
                raise ValueError(f"invalid state record: {source_id}/{article_no}")
            seen[article_no] = item
        sources[source_id] = SourceState(source["initialized_at"], seen)
    checked = raw.get("external_checked_at", {})
    if not isinstance(checked, dict) or not all(isinstance(k, str) and isinstance(v, str)
                                                for k, v in checked.items()):
        raise ValueError("invalid external check timestamps")
    return State(sources, external_checked_at=checked)


def external_due(state: State, source_id: str, now: datetime) -> bool:
    try:
        last = datetime.fromisoformat(state.external_checked_at[source_id])
        if last.tzinfo is None or last > now:
            return True
        return now - last >= timedelta(hours=1)
    except (KeyError, TypeError, ValueError):
        return True


def is_new(state: State, notice: Notice) -> bool:
    source = state.sources.get(notice.source_id)
    return source is None or notice.article_no not in source.seen


def needs_delivery(state: State, notice: Notice) -> bool:
    source = state.sources.get(notice.source_id)
    record = source.seen.get(notice.article_no) if source else None
    return record is None or record.status == "pending"


def baseline(state: State, source_id: str, notices: list[Notice], now: datetime) -> State:
    if source_id in state.sources:
        return state
    stamp = now.isoformat()
    seen = {notice.article_no: SeenRecord(stamp, "baseline", 0) for notice in notices[:MAX_SEEN]}
    sources = {**state.sources, source_id: SourceState(stamp, seen)}
    return replace(state, sources=sources)


def record_result(state: State, notice: Notice, status: str, now: datetime) -> State:
    if status not in STATUSES:
        raise ValueError(f"invalid status: {status}")
    source = state.sources.get(notice.source_id)
    if source is None:
        raise ValueError("source must be initialized before recording results")
    seen = source.seen.copy()
    previous = seen.get(notice.article_no)
    attempts = (previous.attempts if previous else 0) + (status in {"pending", "failed"})
    if status == "pending" and attempts >= 3:
        status = "failed"
    seen[notice.article_no] = SeenRecord(
        previous.first_seen if previous else now.isoformat(), status, attempts
    )
    while len(seen) > MAX_SEEN:
        del seen[next(iter(seen))]
    sources = {**state.sources, notice.source_id: replace(source, seen=seen)}
    return replace(state, sources=sources)


def save_state(path: Path, state: State) -> None:
    data = {
        "version": state.version,
        "external_checked_at": state.external_checked_at,
        "sources": {
            source_id: {
                "initialized_at": source.initialized_at,
                "seen": {article_no: vars(record) for article_no, record in source.seen.items()},
            }
            for source_id, source in state.sources.items()
        },
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
