
from skku_notice.judge import Judgment
from skku_notice.notification_policy import alert_priority, is_internship


def test_school_always_alerts_and_internship_requires_relevant_ai():
    assert alert_priority(external=False, title="대학원생", body="", match=None,
                          judgment=Judgment("not_relevant", "이유", "model"), interests=()) == "low"
    for verdict in (None, "maybe", "not_relevant"):
        judgment = Judgment(verdict, "이유", "m") if verdict else None
        assert alert_priority(external=True, title="개발자", body="개발 업무", match=None,
                              judgment=judgment, interests=("개발",)) is None
    assert alert_priority(external=True, title="제목에 직무 없음", body="모집 분야: 개발",
                          match=None, judgment=Judgment("relevant", "개발 직무", "m"),
                          interests=()) == "default"


def test_school_internship_with_ineligible_judgment_does_not_alert():
    assert alert_priority(external=False, title="졸업예정자 인턴 모집", body="", match=None,
                          judgment=Judgment("not_relevant", "지원 불가", "m"), interests=()) is None
    assert not is_internship("International conference")
    assert is_internship("Summer internship")
    for verdict in ("relevant", "maybe"):
        assert alert_priority(external=False, title="인턴 모집", body="", match=None,
                              judgment=Judgment(verdict, "이유", "m"), interests=()) is not None




