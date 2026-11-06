#!/usr/bin/env bash
set -euo pipefail

# The short override is for a deliberate manual end-to-end test only.
delay="${RELAY_DELAY_SECONDS:-3300}"
if [[ ! "$delay" =~ ^[0-9]+$ ]] || (( delay < 10 || delay > 3300 )); then
  echo '잘못된 대기 시간입니다.' >&2
  exit 1
fi
sleep "$delay"
active="$(gh run list --workflow collect-school.yml --limit 50 --json status \
  --jq '[.[] | select(.status == "queued" or .status == "in_progress" or .status == "waiting" or .status == "pending")] | length')"
if [[ "$active" == 0 ]]; then
  gh workflow run collect-school.yml --ref "$GITHUB_REF_NAME"
  echo '다음 공지 확인을 요청했어요.'
else
  gh workflow run relay-school.yml --ref "$GITHUB_REF_NAME"
  echo '수집이 진행 중이라 다음 확인을 예약했어요.'
fi
