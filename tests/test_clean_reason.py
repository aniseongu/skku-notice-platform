from skku_notice.judge import clean_reason


def test_prompt_ending_example_echo_is_removed():
    base = "마케팅·교육 인턴은 소프트웨어 개발 업무가 아니에요, 학부생 지원이 불가합니다"
    assert clean_reason(base + "~돼요") == base
    assert clean_reason("전체 학생이 신청할 수 있어요 ~예요") == "전체 학생이 신청할 수 있어요"


def test_normal_reason_is_unchanged():
    assert clean_reason("교직원 채용 공고예요") == "교직원 채용 공고예요"
