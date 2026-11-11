# ruff: noqa: E501
from datetime import date, timedelta

import pytest

from skku_notice.grad_intern_rules import (
    CONDITIONAL,
    LIKELY,
    NEEDS_REVIEW,
    NOT_APPLICABLE,
    NOT_ELIGIBLE,
    GradProfile,
    InternFacts,
    assess_department,
    assess_university_3p,
    spans_months,
    weekdays_between,
)

P = GradProfile(admission_year=2022, degree_track="original_major", sw_major=True, university_3p_selected=True)
D0 = date(2026, 12, 7)  # 월요일


def facts(**kw):
    base = dict(organization_type="incorporated_company", corporate_status_verified=True, work_mode="full_time",
                start_date=D0, end_date=D0 + timedelta(days=27), task_category="software_qa")
    base.update(kw)
    return InternFacts(**base)


def dept(f, profile=P):
    return assess_department(profile, f).status


def p3(f, profile=P):
    return assess_university_3p(profile, f).status


def result(assessment, rule_id):
    return next(c.result for c in assessment.checks if c.rule_id == rule_id)


def test_t01_company_6_weeks_with_300_hours():
    f = facts(end_date=D0 + timedelta(days=41), explicitly_stated_hours=300)
    assert dept(f) == LIKELY and p3(f) == CONDITIONAL


@pytest.mark.parametrize("days,expected", [(27, "fail"), (28, "pass"), (29, "pass")])
def test_full_time_boundary_is_28_days_inclusive(days, expected):
    f = facts(end_date=D0 + timedelta(days=days - 1))
    assert result(assess_department(P, f), "DEPT-COMPANY-FT") == expected
    assert dept(f) == (LIKELY if expected == "pass" else NOT_ELIGIBLE)


@pytest.mark.parametrize("hours,dept_status,p3_status", [
    (159, NOT_ELIGIBLE, NOT_ELIGIBLE), (160, LIKELY, NOT_ELIGIBLE), (161, LIKELY, NOT_ELIGIBLE),
    (279, LIKELY, NOT_ELIGIBLE), (280, LIKELY, CONDITIONAL),
])
def test_part_time_hour_boundaries_are_independent_for_dept_and_3p(hours, dept_status, p3_status):
    f = facts(work_mode="part_time", explicitly_stated_hours=hours, start_date=None, end_date=None)
    assert dept(f) == dept_status and p3(f) == p3_status


def test_t02_four_week_full_time_meets_the_department_but_cannot_reach_280_hours():
    f = facts()
    assert dept(f) == LIKELY
    # 4주 × 5일 × 8시간 = 160시간이 상한이라 비교과 280시간 기준은 채울 수 없다.
    assert p3(f) == NOT_ELIGIBLE


def test_t03_three_week_full_time_fails_both():
    f = facts(end_date=D0 + timedelta(days=20))
    assert dept(f) == NOT_ELIGIBLE and p3(f) == NOT_ELIGIBLE


def test_long_full_time_without_hours_is_not_confirmed_for_3p():
    f = facts(end_date=D0 + timedelta(days=7 * 10 - 1))  # 10주, 평일 상한 400시간
    assert dept(f) == LIKELY and p3(f) == CONDITIONAL  # 러프하게: 회사 인턴이면 공고에서 시간을 못 봐도 조건부 가능(확인 필요)


def test_t07_public_agency_security_five_weeks():
    f = facts(organization_type="public_agency", corporate_status_verified=False, task_category="security",
              end_date=D0 + timedelta(days=34))
    assert dept(f) == LIKELY


def test_t08_work_mode_unknown_needs_review_even_if_long():
    f = facts(work_mode="unknown", end_date=D0 + timedelta(days=55))
    assert dept(f) == CONDITIONAL and p3(f) == CONDITIONAL  # 근무 형태를 몰라도 회사 인턴이면 조건부 가능


def test_t09_and_t16_missing_or_title_only_task_needs_review():
    # 담당 업무가 SW인지 모르면 조건부 가능으로 올리지 않는다(다른 조건이 다 맞아도 확인 필요).
    assert dept(facts(task_category="unknown")) == NEEDS_REVIEW
    assert dept(facts(task_category="other")) == NEEDS_REVIEW


def test_t10_unverified_corporation_needs_review():
    assert dept(facts(corporate_status_verified=False)) == CONDITIONAL  # 회사로 읽혔지만 법인 근거가 약하면 조건부
    assert dept(facts(organization_type="other", corporate_status_verified=False)) == NEEDS_REVIEW
    assert dept(facts(organization_type="unknown", corporate_status_verified=False)) == NEEDS_REVIEW


def test_t11_other_university_lab_is_not_eligible_and_3p_is_a_separate_track():
    f = facts(organization_type="other_university_lab", end_date=D0 + timedelta(days=210))
    assert dept(f) == NOT_ELIGIBLE and p3(f) == NEEDS_REVIEW


def lab(**kw):
    base = dict(organization_type="skku_sw_lab", work_mode="part_time", start_date=date(2026, 3, 2),
                end_date=date(2026, 9, 1), task_category="data_ai",
                monthly_hours=(("semester", 80),) * 4 + (("vacation", 160),) * 2)
    base.update(kw)
    return InternFacts(**base)


def test_t12_lab_six_months_with_required_hours():
    f = lab()
    assert dept(f) == LIKELY and p3(f) == NEEDS_REVIEW


@pytest.mark.parametrize("semester,vacation,expected", [(79, 160, NOT_ELIGIBLE), (80, 159, NOT_ELIGIBLE), (80, 160, LIKELY)])
def test_t13_lab_monthly_hour_boundaries(semester, vacation, expected):
    f = lab(monthly_hours=(("semester", semester),) * 4 + (("vacation", vacation),) * 2)
    assert dept(f) == expected


def test_lab_without_monthly_hours_or_short_period():
    assert dept(lab(monthly_hours=())) == CONDITIONAL
    assert dept(lab(end_date=date(2026, 8, 31))) == NOT_ELIGIBLE  # 6개월에 하루 모자람
    assert spans_months(date(2026, 3, 2), date(2026, 9, 1), 6) is True
    assert spans_months(date(2026, 3, 2), date(2026, 8, 31), 6) is False
    assert spans_months(date(2026, 8, 31), date(2027, 2, 27), 6) is True  # 2월 말일 보정
    assert spans_months(date(2026, 8, 31), date(2027, 2, 26), 6) is False


def test_t15_and_t24_non_software_work_is_not_eligible():
    assert dept(facts(task_category="non_software", end_date=D0 + timedelta(days=55))) == NOT_ELIGIBLE


def test_t17_credit_course_can_satisfy_3p_but_not_the_department():
    f = facts(end_date=D0 + timedelta(days=13), academic_credit=1, task_category="unknown")
    assert p3(f) == CONDITIONAL and dept(f) != LIKELY
    assert p3(facts(academic_credit=0.5)) != CONDITIONAL


def test_t18_3p_not_selected_is_not_applicable_and_dept_is_unchanged():
    chosen = GradProfile(2022, "original_major", True, False)
    assert p3(facts(), chosen) == NOT_APPLICABLE
    assert dept(facts(), chosen) == LIKELY


def test_t19_2016_original_major_has_no_department_internship():
    old = GradProfile(2016, "original_major", True, True)
    assert dept(facts(), old) == NOT_APPLICABLE


def test_applicability_by_profile():
    assert dept(facts(), GradProfile(2017, "original_major", True, None)) == LIKELY
    assert dept(facts(), GradProfile(2022, "double_major", True, None)) == NOT_APPLICABLE
    assert dept(facts(), GradProfile(2022, "original_major", False, None)) == NOT_APPLICABLE
    for unknown in (GradProfile(), GradProfile(None, "original_major", True, None), GradProfile(2022, "unknown", True, None)):
        assert dept(facts(), unknown) == NEEDS_REVIEW


def test_3p_before_2020_and_unknown_selection():
    assert p3(facts(), GradProfile(2019, "original_major", True, True)) == NEEDS_REVIEW
    result_unknown = assess_university_3p(GradProfile(2022, "original_major", True, None), facts(explicitly_stated_hours=300))
    assert result_unknown.status == CONDITIONAL and any("선택" in note for note in result_unknown.notes)


def test_t21_never_claims_post_completion_requirements_are_met():
    a = assess_department(P, facts())
    assert a.status == LIKELY
    assert {"DEPT-EVALUATION", "DEPT-WORK-COMMITTEE", "DEPT-COMPANY-DOCS", "DEPT-DEADLINE"} <= set(a.after_completion)
    assert all(c.rule_id != "DEPT-EVALUATION" for c in a.checks)
    assert "확정" not in a.label and "완료" not in a.label


def test_t22_year_boundary_is_a_note_not_a_rejection():
    f = facts(start_date=date(2026, 12, 21), end_date=date(2027, 2, 28))
    a = assess_department(P, f)
    assert a.status == LIKELY and any("당해" in note for note in a.notes)


def test_weekday_count_is_an_upper_bound():
    assert weekdays_between(date(2026, 12, 7), date(2027, 1, 3)) == 20
    assert weekdays_between(date(2026, 12, 5), date(2026, 12, 6)) == 0


def test_3p_note_says_it_does_not_imply_department_credit():
    a = assess_university_3p(P, facts(explicitly_stated_hours=300))
    assert any("학과" in note for note in a.notes)
    assert "3P-APPLICATION" in a.after_completion


def test_assessment_serializes_without_extra_fields():
    data = assess_department(P, facts()).as_dict()
    assert set(data) == {"status", "rule_version", "label", "checks", "unknowns", "after_completion", "notes", "sources"}
    assert data["rule_version"] == "cse-2025-06-01"


def test_3p_hours_use_the_period_even_when_the_work_mode_is_not_written():
    from skku_notice.grad_intern_rules import _p3_hours_check
    long = _p3_hours_check(facts(work_mode="unknown", start_date=None, end_date=None, duration_days=90))
    assert long.result == "unknown" and "전일제인지" in long.note  # 기간은 충분하지만 근무 형태·시간이 없다고 정확히 알린다
    short = _p3_hours_check(facts(work_mode="unknown", start_date=None, end_date=None, duration_days=28))
    assert short.result == "fail"  # 평일 8시간으로도 280시간에 못 미치면 형태와 상관없이 미달
    assert _p3_hours_check(facts(work_mode="part_time", start_date=None, end_date=None, duration_days=90)).result == "unknown"
