from skku_notice.judge import clean_reason


def test_prompt_ending_example_echo_is_removed():
    base = "마케팅·교육 인턴은 소프트웨어 개발 업무가 아니에요, 학부생 지원이 불가합니다"
    # 꼬리를 지운 뒤 격식체 끝맺음은 해요체로 바꾼다(토스 문구 규칙, 2026-11-13)
    assert clean_reason(base + "~돼요") == base.replace("불가합니다", "불가해요")
    assert clean_reason("전체 학생이 신청할 수 있어요 ~예요") == "전체 학생이 신청할 수 있어요"


def test_normal_reason_is_unchanged():
    assert clean_reason("교직원 채용 공고예요") == "교직원 채용 공고예요"


def test_hyphen_before_the_ending_example_is_removed_too():
    # 작은 무료 모델이 프롬프트의 "~예요" 예시를 "-예요"로 따라 붙인다.
    assert clean_reason("데이터 직무라서 지원 가능합니다.-예요") == "데이터 직무라서 지원 가능해요."
    assert clean_reason("마케팅 직무라서 지원 불가합니다. – 해요") == "마케팅 직무라서 지원 불가해요."
    assert clean_reason("상시 운영-예요") == "상시 운영"
    # 문장 가운데의 하이픈이나 정상적인 끝맺음은 그대로 둔다.
    assert clean_reason("신입-경력 공고예요") == "신입-경력 공고예요"
