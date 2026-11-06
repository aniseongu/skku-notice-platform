from datetime import date, datetime
from zoneinfo import ZoneInfo

import pytest

from skku_notice.deadline import extract_deadline


@pytest.mark.parametrize(
    ("title", "expected"),
    [
        ("신입사원 채용(~11.12(목))", datetime(2026, 11, 12, 23, 59, tzinfo=ZoneInfo("Asia/Seoul"))),
        ("접수 마감: 2026.11.16 13:00", datetime(2026, 11, 16, 13, 0, tzinfo=ZoneInfo("Asia/Seoul"))),
        ("12/20~1/10 신청", datetime(2027, 1, 10, 23, 59, tzinfo=ZoneInfo("Asia/Seoul"))),
        ("행사 11.18 11:30~13:00", None),
        (
            "2026학년도 심산혁신장학금 장학생 선발안내( ~ 2026년 11월 6일(금) 오후 5시까지)",
            datetime(2026, 11, 6, 17, 0, tzinfo=ZoneInfo("Asia/Seoul")),
        ),
    ],
)
def test_deadline(title: str, expected: datetime | None) -> None:
    assert extract_deadline(title, date(2026, 11, 2)) == expected
