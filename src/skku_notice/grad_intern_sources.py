# ruff: noqa: E501
"""졸업요건 판정이 근거로 삼는 규정의 버전과 출처. 규칙을 바꾸면 버전도 함께 올려 이전 판정을 오래된 것으로 표시한다."""

# -r2: 3품 시간 계산에 공고의 1일 근무시간·주당 일수를 쓴다(규정 원문은 그대로, 판정 규칙만 바뀜).
DEPT_RULESET = "cse-2025-06-01-r2"
P3_RULESET = "skku-3p-2026-11-10"
EXTRACTOR_VERSION = "facts-10"

# 사용자에게 보이는 근거. 조항과 쪽수는 docs/sources의 PDF 원문과 대조했다(2026-11-10).
DEPT_TERMS_PDF = "cse_com_grad_evaluation_terms_250601.pdf"
DEPT_INFO_PDF = "cse_grad_evaluation_info_240409.pdf"

SOURCES = {
    "DEPT-APPLICABLE": {"file": DEPT_TERMS_PDF, "page": 1, "article": "제3조"},
    "DEPT-ORG": {"file": DEPT_TERMS_PDF, "page": 5, "article": "제28조"},
    "DEPT-DOCS": {"file": DEPT_TERMS_PDF, "page": 5, "article": "제29조"},
    "DEPT-EVALUATION": {"file": DEPT_TERMS_PDF, "page": 6, "article": "제30조"},
    "DEPT-DEADLINE": {"file": DEPT_TERMS_PDF, "page": 6, "article": "제31조"},
    "3P": {"url": "https://www.skku.edu/skku/campus/skk_comm/notice01.do?mode=view&articleNo=141724"},
}

DEPT_FIELDS_URL = "https://skb.skku.edu/cse/resources.do?articleNo=160073&mode=view"
DEPT_OVERLAP_URL = "https://cse.skku.edu/cse/notice.do?articleNo=201662&mode=view"
