# ruff: noqa: E501
"""소프트웨어학과 졸업평가(인턴십)와 학교 신3품 인턴십 영역 판정 엔진.

외부 API를 쓰지 않는다. Gemini는 공고에서 사실만 뽑고(grad_intern_facts), 규정의 하드 조건은 여기서 결정한다.
공고만 보고 확정할 수 없는 것(기관 평가 60점, 증빙 서류, 위원회 심의, 학교 승인)은 "수행 후 확인"으로 남기고
절대 통과로 표시하지 않는다. 학과(DEPT)와 학교 3품(3P)은 서로 독립이다.
"""

from __future__ import annotations

import calendar
from dataclasses import dataclass, field
from datetime import date, timedelta

from skku_notice.grad_intern_sources import DEPT_RULESET, P3_RULESET, SOURCES

LIKELY = "LIKELY"
CONDITIONAL = "CONDITIONAL"
NEEDS_REVIEW = "NEEDS_REVIEW"
NOT_ELIGIBLE = "NOT_ELIGIBLE"
NOT_APPLICABLE = "NOT_APPLICABLE"

PASS = "pass"
FAIL = "fail"
UNKNOWN = "unknown"

ORG_TYPES = (
    "incorporated_company", "incorporated_institute", "public_agency", "skku_sw_lab",
    "other_university_lab", "other", "unknown",
)
COMPANY_TYPES = ("incorporated_company", "incorporated_institute", "public_agency")
WORK_MODES = ("full_time", "part_time", "unknown")
SW_CATEGORIES = (
    "application_embedded", "cloud_platform", "data_ai", "system_network", "security", "software_qa",
)
TASK_CATEGORIES = SW_CATEGORIES + ("non_software", "other", "unknown")

MIN_FULL_TIME_DAYS = 28  # 제28조 1호: 전일제 4주 이상
MIN_PART_TIME_HOURS = 160  # 제28조 1호: 파트타임 160시간 이상
LAB_MIN_MONTHS = 6  # 제28조 2호
LAB_SEMESTER_MONTHS, LAB_SEMESTER_HOURS = 4, 80
LAB_VACATION_MONTHS, LAB_VACATION_HOURS = 2, 160
P3_MIN_HOURS = 280  # 학교 공지: 비교과 현장실습 280시간
P3_MAX_DAILY_HOURS = 8  # 1일 8시간, 주 5일 이내


@dataclass(frozen=True)
class GradProfile:
    """학번은 입학 연도 네 자리까지만 쓴다. 이름, 학번 전체, 연락처는 다루지 않는다."""

    admission_year: int | None = None
    degree_track: str = "unknown"  # original_major | double_major | other | unknown
    sw_major: bool | None = None
    university_3p_selected: bool | None = None


@dataclass(frozen=True)
class InternFacts:
    """공고에서 뽑은 사실. 값이 없으면 unknown/None이고, 추측으로 채우지 않는다."""

    organization_type: str = "unknown"
    corporate_status_verified: bool = False
    work_mode: str = "unknown"
    start_date: date | None = None
    end_date: date | None = None
    explicitly_stated_hours: int | None = None
    task_category: str = "unknown"
    academic_credit: float | None = None
    # 공고에 "5개월"처럼 기간만 적힌 경우의 개월 수(시작·종료일이 없을 때만 쓴다)
    duration_months: int | None = None
    # 개월·주·근무일수로 적힌 기간을 날짜 수로 바꾼 값(시작·종료일이 없을 때만)
    duration_days: int | None = None
    # 교내 연구실: 월별 계획 시간. ("semester"|"vacation", 시간)
    monthly_hours: tuple[tuple[str, int], ...] = ()


@dataclass(frozen=True)
class Check:
    rule_id: str
    result: str  # pass | fail | unknown
    note: str


@dataclass(frozen=True)
class Assessment:
    status: str
    rule_version: str
    label: str
    checks: tuple[Check, ...] = ()
    unknowns: tuple[str, ...] = ()
    after_completion: tuple[str, ...] = ()
    notes: tuple[str, ...] = ()
    sources: tuple[dict, ...] = field(default_factory=tuple)

    def as_dict(self) -> dict:
        return {
            "status": self.status, "rule_version": self.rule_version, "label": self.label,
            "checks": [{"rule_id": c.rule_id, "result": c.result, "note": c.note} for c in self.checks],
            "unknowns": list(self.unknowns), "after_completion": list(self.after_completion),
            "notes": list(self.notes), "sources": list(self.sources),
        }


# --- 날짜 계산 ----------------------------------------------------------------------------------

def inclusive_days(start: date | None, end: date | None) -> int | None:
    if start is None or end is None or end < start:
        return None
    return (end - start).days + 1


def weekdays_between(start: date, end: date) -> int:
    """시작일과 종료일을 포함한 평일 수. 공휴일은 알 수 없어 빼지 않는다(그래서 시간의 상한이다)."""
    count, day = 0, start
    while day <= end:
        count += day.weekday() < 5
        day += timedelta(days=1)
    return count


def _add_months(day: date, months: int) -> date:
    index = day.month - 1 + months
    year, month = day.year + index // 12, index % 12 + 1
    return date(year, month, min(day.day, calendar.monthrange(year, month)[1]))


def spans_months(start: date | None, end: date | None, months: int) -> bool | None:
    """시작일부터 달력으로 months개월 이상인지. 날짜를 모르면 None."""
    if start is None or end is None or end < start:
        return None
    return end >= _add_months(start, months) - timedelta(days=1)


def _crosses_year(start: date | None, end: date | None) -> bool:
    return start is not None and end is not None and start.year != end.year


# --- 학과 졸업평가 -------------------------------------------------------------------------------

def _dept_applicability(profile: GradProfile) -> tuple[str, str]:
    """('yes'|'no'|'unknown', 이유). 제3조: 소프트웨어학과 원전공 2017학번 이후만 인턴십이 졸업평가 항목이다."""
    if profile.sw_major is False:
        return "no", "소프트웨어학과 학생이 아니라서 이 졸업요건은 해당 없어요"
    if profile.degree_track == "double_major":
        return "no", "복수전공은 인턴십이 아니라 다른 졸업평가를 받아요"
    if profile.admission_year is not None and profile.admission_year < 2017:
        return "no", "2017학번 이전은 인턴십이 졸업평가 항목이 아니에요"
    if profile.sw_major and profile.degree_track == "original_major" and profile.admission_year is not None:
        return "yes", ""
    return "unknown", "전공과 입학 연도를 알려 주면 졸업요건 해당 여부를 확인해요"


def _work_check(facts: InternFacts) -> Check:
    if facts.task_category in SW_CATEGORIES:
        return Check("DEPT-WORK", PASS, "공고의 담당 업무가 학과가 정한 SW 업무 분야로 보여요(심의는 따로 있어요)")
    if facts.task_category == "non_software":
        return Check("DEPT-WORK", FAIL, "공고의 담당 업무가 IT·SW 교육과 거리가 있어요")
    return Check("DEPT-WORK", UNKNOWN, "실제 담당 업무를 공고에서 확인하지 못했어요")


def _company_time_check(facts: InternFacts) -> Check:
    days = inclusive_days(facts.start_date, facts.end_date)
    if days is None and facts.duration_days:
        days = facts.duration_days  # 날짜 없이 개월·주·근무일수만 적힌 공고
    if facts.work_mode == "full_time":
        if days is None:
            return Check("DEPT-COMPANY-FT", UNKNOWN, "전일제이지만 근무 기간을 확인하지 못했어요")
        if days >= MIN_FULL_TIME_DAYS:
            return Check("DEPT-COMPANY-FT", PASS, f"전일제 {days}일로 4주(28일) 이상이에요")
        return Check("DEPT-COMPANY-FT", FAIL, f"전일제 {days}일로 4주(28일)에 못 미쳐요")
    if facts.work_mode == "part_time":
        hours = facts.explicitly_stated_hours
        if hours is None:
            return Check("DEPT-COMPANY-PT", UNKNOWN, "파트타임이지만 총 근무 시간을 확인하지 못했어요")
        if hours >= MIN_PART_TIME_HOURS:
            return Check("DEPT-COMPANY-PT", PASS, f"파트타임 {hours}시간으로 160시간 이상이에요")
        return Check("DEPT-COMPANY-PT", FAIL, f"파트타임 {hours}시간으로 160시간에 못 미쳐요")
    return Check("DEPT-COMPANY-TIME", UNKNOWN, "전일제인지 파트타임인지 공고에 없어요")


def _corporate_check(facts: InternFacts) -> Check:
    if facts.organization_type == "public_agency":
        return Check("DEPT-CORPORATE", PASS, "공공기관으로 표시돼 있어요")
    if facts.corporate_status_verified:
        return Check("DEPT-CORPORATE", PASS, "기업·연구소 공고라 법인으로 봤어요")
    return Check("DEPT-CORPORATE", UNKNOWN, "법인으로 설립된 기관인지 공고에서 확인하지 못했어요")


def _lab_checks(facts: InternFacts) -> list[Check]:
    checks: list[Check] = []
    long_enough = spans_months(facts.start_date, facts.end_date, LAB_MIN_MONTHS)
    if long_enough is None:
        checks.append(Check("DEPT-LAB-6M", UNKNOWN, "연구 기간을 확인하지 못했어요"))
    elif long_enough:
        checks.append(Check("DEPT-LAB-6M", PASS, "6개월 이상이에요"))
    else:
        checks.append(Check("DEPT-LAB-6M", FAIL, "6개월에 못 미쳐요"))
    semester = [hours for kind, hours in facts.monthly_hours if kind == "semester"]
    vacation = [hours for kind, hours in facts.monthly_hours if kind == "vacation"]
    low = any(h < LAB_SEMESTER_HOURS for h in semester) or any(h < LAB_VACATION_HOURS for h in vacation)
    if low:
        checks.append(Check("DEPT-LAB-HOURS", FAIL, "월별 시간이 기준(학기 중 80시간, 방학 중 160시간)에 못 미치는 달이 있어요"))
    elif len(semester) >= LAB_SEMESTER_MONTHS and len(vacation) >= LAB_VACATION_MONTHS:
        checks.append(Check("DEPT-LAB-HOURS", PASS, "월별 시간이 기준 이상이에요"))
    else:
        checks.append(Check("DEPT-LAB-HOURS", UNKNOWN, "학기 중 4개월(월 80시간)과 방학 중 2개월(월 160시간)의 시간을 확인하지 못했어요"))
    return checks


def _combine(checks: list[Check]) -> str:
    if any(c.result == FAIL for c in checks):
        return NOT_ELIGIBLE
    if any(c.result == UNKNOWN for c in checks):
        return NEEDS_REVIEW
    return LIKELY


DEPT_LABELS = {
    LIKELY: "학과 졸업 인턴십 인정 가능성 높음 — 수행 후 평가·증빙 필요",
    NEEDS_REVIEW: "학과 졸업 인턴십: 공고에서 확인되지 않은 조건이 있어요",
    NOT_ELIGIBLE: "학과 졸업 인턴십 기준에 맞지 않아 보여요",
    NOT_APPLICABLE: "학과 졸업 인턴십 해당 없음",
}


def assess_department(profile: GradProfile, facts: InternFacts) -> Assessment:
    refs = (SOURCES["DEPT-APPLICABLE"], SOURCES["DEPT-ORG"])
    applicable, reason = _dept_applicability(profile)
    if applicable == "no":
        return Assessment(NOT_APPLICABLE, DEPT_RULESET, DEPT_LABELS[NOT_APPLICABLE], notes=(reason,), sources=refs)
    if applicable == "unknown":
        return Assessment(NEEDS_REVIEW, DEPT_RULESET, DEPT_LABELS[NEEDS_REVIEW], unknowns=("전공·입학 연도",),
                          notes=(reason,), sources=refs)

    org = facts.organization_type
    checks: list[Check] = []
    notes: list[str] = []
    after = ["DEPT-EVALUATION", "DEPT-WORK-COMMITTEE", "DEPT-DEADLINE"]
    if org == "other_university_lab":
        checks.append(Check("DEPT-OTHER-UNIVERSITY", FAIL, "타 대학에서 수행한 인턴십은 졸업요건으로 인정하지 않아요"))
    elif org == "skku_sw_lab":
        checks.extend(_lab_checks(facts))
        checks.append(_work_check(facts))
        after.append("DEPT-LAB-DOCS")
    elif org in COMPANY_TYPES:
        checks.append(_corporate_check(facts))
        checks.append(_company_time_check(facts))
        checks.append(_work_check(facts))
        after.append("DEPT-COMPANY-DOCS")
    else:
        checks.append(Check("DEPT-OTHER-INSTITUTION", UNKNOWN,
                            "기관 종류를 확인하지 못했어요. 기타 기관은 수행 전에 졸업평가위원회 심의가 필요해요"))
        checks.append(_work_check(facts))
        after.append("DEPT-OTHER-APPROVAL")
        if org == "other":
            notes.append("법인 기업·공공기관이 아니면 시작 전에 신청서를 내고 졸업평가위원회 심의를 받아야 해요")

    status = _combine(checks)
    if status == LIKELY and _crosses_year(facts.start_date, facts.end_date):
        notes.append("연도가 바뀌어요. 인증은 당해 신청이 원칙이라 신청 시기를 학과에 확인하세요")
    unknowns = tuple(c.note for c in checks if c.result == UNKNOWN)
    return Assessment(status, DEPT_RULESET, DEPT_LABELS[status], tuple(checks), unknowns, tuple(after), tuple(notes),
                      refs + (SOURCES["DEPT-EVALUATION"], SOURCES["DEPT-DEADLINE"]))


# --- 학교 신3품 인턴십 영역 -----------------------------------------------------------------------

P3_LABELS = {
    CONDITIONAL: "학교 신3품 인턴십: 가능성이 있지만 승인과 증빙이 남아 있어요",
    NEEDS_REVIEW: "학교 신3품 인턴십: 시간과 승인 확인이 필요해요",
    NOT_ELIGIBLE: "학교 신3품 인턴십(비교과 280시간) 기준에 못 미쳐요",
    NOT_APPLICABLE: "학교 신3품 인턴십 선택 안 함",
}


def _p3_hours_check(facts: InternFacts) -> Check:
    hours = facts.explicitly_stated_hours
    if hours is not None:
        if hours >= P3_MIN_HOURS:
            return Check("3P-HOURS", PASS, f"공고에 {hours}시간으로 적혀 있어요(실제 인정은 출근 기록 기준이에요)")
        return Check("3P-HOURS", FAIL, f"공고의 {hours}시간은 비교과 현장실습 기준 280시간에 못 미쳐요")
    if facts.work_mode == "full_time" and facts.start_date and facts.end_date and facts.end_date >= facts.start_date:
        cap = weekdays_between(facts.start_date, facts.end_date) * P3_MAX_DAILY_HOURS
        if cap < P3_MIN_HOURS:
            return Check("3P-HOURS", FAIL, f"평일 하루 8시간으로 계산해도 최대 {cap}시간이라 280시간에 못 미쳐요")
        return Check("3P-HOURS", UNKNOWN, "기간은 충분할 수 있지만 실제 인정 시간은 공휴일과 출근 기록으로 정해져요")
    if facts.work_mode == "full_time" and facts.duration_days:
        cap = facts.duration_days * 5 // 7 * P3_MAX_DAILY_HOURS
        if cap < P3_MIN_HOURS:
            return Check("3P-HOURS", FAIL, f"공고의 기간 {facts.duration_days}일은 평일 하루 8시간으로 계산해도 최대 {cap}시간이라 280시간에 못 미쳐요")
        return Check("3P-HOURS", UNKNOWN, f"공고에 {facts.duration_days}일 정도로 적혀 있어요. 실제 인정 시간은 출근 기록으로 정해져요")
    return Check("3P-HOURS", UNKNOWN, "근무 시간을 공고에서 확인하지 못했어요")


def assess_university_3p(profile: GradProfile, facts: InternFacts) -> Assessment:
    refs = (SOURCES["3P"],)
    if profile.university_3p_selected is False:
        return Assessment(NOT_APPLICABLE, P3_RULESET, P3_LABELS[NOT_APPLICABLE],
                          notes=("인턴십 영역을 고르지 않았다면 다른 영역으로 충족해도 돼요",), sources=refs)
    if profile.admission_year is not None and profile.admission_year < 2020:
        return Assessment(NEEDS_REVIEW, P3_RULESET, P3_LABELS[NEEDS_REVIEW], unknowns=("2020학번 이전의 3품 기준",),
                          notes=("신3품제는 2020학번부터라 이전 학번은 학교에 확인해야 해요",), sources=refs)

    after = ["3P-EVIDENCE", "3P-APPLICATION"]
    notes: list[str] = []
    if profile.university_3p_selected is None:
        notes.append("인턴십 3품을 선택했는지 알려 주면 해당 여부를 정확히 보여 드려요")
    if facts.organization_type in ("skku_sw_lab", "other_university_lab"):
        check = Check("3P-RESEARCH", UNKNOWN, "연구실 활동은 연구체험 트랙이라 비교과 현장실습 280시간과 다르게 판단해요")
        return Assessment(NEEDS_REVIEW, P3_RULESET, P3_LABELS[NEEDS_REVIEW], (check,), (check.note,), tuple(after),
                          tuple(notes), refs)

    checks: list[Check] = []
    credit = facts.academic_credit
    course = credit is not None and credit >= 1
    if course:
        checks.append(Check("3P-COURSE", PASS, "교과 현장실습 1학점 이상으로 보여요(실제 취득은 따로 확인해야 해요)"))
    checks.append(_p3_hours_check(facts))
    hours_check = checks[-1]
    if course or hours_check.result == PASS:
        status = CONDITIONAL
    elif hours_check.result == FAIL:
        status = NOT_ELIGIBLE
        notes.append("교과 현장실습(1학점)으로 인정받는 길은 학교 산학사업팀 인정 과목일 때만 가능해요")
    else:
        status = NEEDS_REVIEW
    unknowns = tuple(c.note for c in checks if c.result == UNKNOWN)
    notes.append("학교 3품만으로 학과 인턴십이 인정되지는 않아요. 업무 분야와 기관 조건을 학과도 충족해야 중복 인정돼요")
    return Assessment(status, P3_RULESET, P3_LABELS[status], tuple(checks), unknowns, tuple(after), tuple(notes), refs)
