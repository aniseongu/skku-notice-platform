"""신고와 후기 기수를 관리한다. 쓰기 명령은 --yes를 붙일 때만 실행한다."""

import argparse
import hashlib
import json
import os
import re
import sys
import unicodedata
from collections import Counter, defaultdict
from collections.abc import Iterator
from difflib import SequenceMatcher
from uuid import UUID

from skku_notice.scheduled_collection import NoticeStore, StoreError

KINDS = ("question", "answer", "experience", "team")
TITLE_MARKERS = re.compile(r"(?<!\d)(?:19|20)\d{2}\s*(?:년도?)?|제?\s*\d+\s*기(?![가-힣])")
MIN_SIMILARITY = 0.75
CANDIDATE_LIMIT = 3


class ModerationStore(NoticeStore):
    def rows(self, table: str, select: str, order: str, **filters: str) -> Iterator[dict]:
        offset = 0
        while True:
            page = self._request("GET", table, params={
                "select": select, "order": order, "limit": 500, "offset": offset, **filters,
            }).json()
            if not page:
                return
            yield from page
            offset += len(page)

    def rpc(self, name: str, payload: dict) -> None:
        self._request("POST", f"rpc/{name}", json=payload)


def author_hash(user_id: str) -> str:
    return hashlib.sha256(UUID(user_id).bytes).hexdigest()[:8]


def reported_posts(store: ModerationStore) -> list[dict]:
    posts = []
    for table, selection in (
        ("qe_reports", "post:qe_posts(id,kind,parent_id,hidden_at,deleted_at,author:user_id,body)"),
        ("team_reports", "post:team_posts(id,hidden_at,deleted_at,author:owner_id,body:intro)"),
    ):
        counts = Counter()
        targets = {}
        for report in store.rows(table, selection, "post_id,reporter_id"):
            post = report["post"]
            counts[post["id"]] += 1
            targets[post["id"]] = post
        for post_id, post in targets.items():
            kind = "answer" if post.get("parent_id") else post.get("kind", "team")
            posts.append({
                "kind": kind, "id": post_id, "reports": counts[post_id],
                "hidden": post["hidden_at"] is not None, "deleted": post["deleted_at"] is not None,
                "author": author_hash(post["author"]), "body": (post["body"] or "")[:80],
            })
    return sorted(posts, key=lambda post: (-post["reports"], post["kind"], post["id"]))


def normalize_title(title: str) -> str:
    title = unicodedata.normalize("NFKC", title).casefold()
    title = TITLE_MARKERS.sub("", title)
    return "".join(char for char in title if char.isalnum())


def matching_series(title: str, aliases: dict[str, set[str]]) -> list[tuple[str, float]]:
    title = normalize_title(title)
    if not title:
        return []
    matches = []
    matcher = SequenceMatcher(None, autojunk=False, b=title)
    for series_id, names in aliases.items():
        best = 0.0
        for name in names:
            matcher.set_seq1(name)
            if matcher.quick_ratio() >= MIN_SIMILARITY:
                best = max(best, matcher.ratio())
        if best >= MIN_SIMILARITY:
            matches.append((series_id, best))
    return sorted(matches, key=lambda match: (-match[1], match[0]))[:CANDIDATE_LIMIT]


def series_candidates(store: ModerationStore) -> list[dict]:
    series = {
        row["id"]: row for row in store.rows(
            "qe_series", "id,organization_key,program_key", "id", organization_key="not.is.null",
        )
    }
    if not series:
        return []
    notices = {
        row["id"]: row["title"] for row in store.rows("platform_notices", "id,title", "id")
    }
    aliases = defaultdict(set)
    for series_id, row in series.items():
        aliases[series_id].add(normalize_title(f"{row['organization_key']} {row['program_key']}"))
    linked = set()
    for row in store.rows("qe_notice_series", "notice_id,series_id", "notice_id"):
        notice_id, series_id = row["notice_id"], row["series_id"]
        if series_id in series:
            linked.add(notice_id)
            if notice_id in notices:
                aliases[series_id].add(normalize_title(notices[notice_id]))
    for row in store.rows("qe_posts", "series_id,notice_title_snapshot", "id", kind="eq.experience"):
        if row["series_id"] in series:
            aliases[row["series_id"]].add(normalize_title(row["notice_title_snapshot"]))

    return [
        {
            "notice_id": notice_id, "title": title,
            "candidates": [
                {**series[series_id], "similarity": round(score, 3)} for series_id, score in matches
            ],
        }
        for notice_id, title in notices.items()
        if notice_id not in linked and (matches := matching_series(title, aliases))
    ]


def uuid_arg(value: str) -> str:
    try:
        return str(UUID(value))
    except ValueError as exc:
        raise argparse.ArgumentTypeError("UUID 형식이어야 합니다.") from exc


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("reports", help="신고 목록과 숨김 상태를 조회합니다.")
    commands.add_parser("series-candidates", help="후기 기수를 연결할 후보를 조회합니다.")
    for command in ("hide", "unhide"):
        change = commands.add_parser(command, allow_abbrev=False)
        change.add_argument("kind", choices=KINDS)
        change.add_argument("id", type=uuid_arg)
        change.add_argument("--yes", action="store_true", help="변경을 적용합니다.")
    bind = commands.add_parser("bind", allow_abbrev=False)
    bind.add_argument("notice_id")
    bind.add_argument("series_id", type=uuid_arg)
    bind.add_argument("--yes", action="store_true", help="변경을 적용합니다.")
    return parser.parse_args(argv)


def print_json(value: object) -> None:
    # Escape terminal controls and direction overrides that JSON leaves intact.
    output = json.dumps(value, ensure_ascii=False)
    print("".join(
        json.dumps(char)[1:-1] if unicodedata.category(char) in ("Cc", "Cf") else char
        for char in output
    ))


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    if args.command in ("hide", "unhide"):
        rpc = "moderation_set_hidden"
        payload = {"p_kind": args.kind, "p_post_id": args.id, "p_hidden": args.command == "hide"}
        effect = (
            "글을 숨깁니다." if args.command == "hide"
            else "숨겨진 글을 복구하고 해당 글의 신고를 정리합니다."
        )
    elif args.command == "bind":
        rpc = "qe_bind_series"
        payload = {"p_notice_id": args.notice_id, "p_series_id": args.series_id}
        effect = "공고를 기존 기수에 연결하고 임시 기수의 후기가 있으면 합칩니다."

    if hasattr(args, "yes") and not args.yes:
        print(f"미리보기 (--yes로 적용). {effect}")
        print_json({"command": args.command, **payload})
        return 0

    try:
        store = ModerationStore(os.environ.get("SUPABASE_URL", ""), os.environ.get("SUPABASE_SECRET_KEY", ""))
        try:
            if args.command == "reports":
                print_json(reported_posts(store))
            elif args.command == "series-candidates":
                print_json(series_candidates(store))
            else:
                store.rpc(rpc, payload)
                print("적용했습니다.")
        finally:
            store.close()
    except (StoreError, ValueError, KeyError, TypeError):
        print("Supabase 요청을 처리하지 못했습니다. 환경 변수, 권한, migration 적용 상태를 확인하세요.",
              file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
