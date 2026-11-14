from skku_notice.judge import three_lines

# web/tests/summary-lines.test.mjs가 같은 예시로 화면과 Edge Function의 결과를 확인한다.


def test_splits_sentences_written_on_one_line():
    first, second, third = (
        "당근마켓이 디자이너 인턴을 모집해요.",
        "재학생도 지원할 수 있어요.",
        "마감은 12월 28일(월)이며, 온라인으로 지원해요",
    )
    assert three_lines(f"{first} {second} {third}") == f"{first}\n{second}\n{third}"


def test_splits_haeyo_endings_without_periods_but_not_words_ending_in_yo():
    first, second, third = (
        "필요 서류를 내는 장학금 공고예요",
        "대상은 재학생이에요",
        "주요 일정은 홈페이지에서 확인해요",
    )
    assert three_lines(f"{first} {second} {third}") == f"{first}\n{second}\n{third}"


def test_keeps_three_lines_and_merges_extra_into_third():
    assert three_lines("가요.\n나요.\n다요.") == "가요.\n나요.\n다요."
    merged = "첫째예요.\n둘째예요.\n셋째예요. 넷째예요."
    assert three_lines("첫째예요.\n둘째예요.\n셋째예요.\n넷째예요.") == merged
    assert three_lines("첫째예요. 둘째예요. 셋째예요. 넷째예요.") == merged


def test_does_not_split_decimals_lists_or_english_abbreviations():
    assert three_lines("평점 3.5 이상이면 지원해요") == "평점 3.5 이상이면 지원해요"
    assert three_lines("Co. Ltd. 인턴을 뽑아요") == "Co. Ltd. 인턴을 뽑아요"


def test_drops_invisible_characters_and_empty_input():
    assert three_lines("모집해요​.\n\n\n대상은 학생이에요.") == "모집해요.\n대상은 학생이에요."
    assert three_lines("  \n ") is None
    assert three_lines(None) is None
