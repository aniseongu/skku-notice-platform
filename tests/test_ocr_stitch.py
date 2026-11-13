from skku_notice.ocr import stitch_lines


def box(x0, y0, x1, y1):
    return [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]


def test_split_line_is_joined_left_to_right():
    boxes = [box(200, 10, 400, 40), box(0, 12, 150, 42)]
    assert stitch_lines(boxes, ["Mon-Fri 9:00 AM", "Working hours:"]) == ["Working hours: Mon-Fri 9:00 AM"]


def test_two_lines_stay_separate_and_ordered():
    boxes = [box(0, 60, 150, 90), box(0, 10, 150, 40), box(170, 62, 300, 92)]
    assert stitch_lines(boxes, ["Program 2026", "Global Internship", "Samsung"]) == [
        "Global Internship", "Program 2026 Samsung"]


def test_far_apart_columns_are_not_merged():
    boxes = [box(0, 10, 100, 40), box(600, 10, 700, 40)]
    assert stitch_lines(boxes, ["left column", "right column"]) == ["left column", "right column"]


def test_korean_and_english_mixed():
    boxes = [box(0, 10, 90, 40), box(110, 8, 220, 38), box(240, 10, 330, 40)]
    assert stitch_lines(boxes, ["Samsung", "Research", "인턴 모집"]) == ["Samsung Research 인턴 모집"]


def test_empty_and_blank_texts_ignored():
    assert stitch_lines([], []) == []
    assert stitch_lines([box(0, 0, 10, 10)], ["  "]) == []
