#!/usr/bin/env bash
# 린트와 테스트. 성공하면 아무것도 출력하지 않는다(토큰 절약). 실패하면 원인만 보여 주고 1로 끝난다.
set -uo pipefail
cd "$(dirname "$0")/.."

out=$(uvx --quiet ruff check --quiet src tests 2>&1) || { echo "[ruff]"; echo "$out" | tail -30; exit 1; }

# 테스트 파일이 하나라도 있으면(하위 폴더 포함) pytest는 0으로 끝나야 한다. 0건 수집(5)도 실패다.
# 코드가 없는 M0 단계에서만 pytest를 건너뛴다.
if find tests -name 'test_*.py' -print -quit 2>/dev/null | grep -q .; then
  out=$(uv run --quiet --with pytest pytest -q 2>&1) || { echo "[pytest]"; echo "$out" | tail -30; exit 1; }
fi
