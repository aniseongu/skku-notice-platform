#!/usr/bin/env bash
set -euo pipefail

# Local-only agent instructions, skills, plans and notes must not enter commits.
pattern='(^|/)(AGENTS\.md|CLAUDE\.md|GOAL\.md|HANDOFF\.md|SKILL\.md)$|(^|/)(\.agents|\.claude|\.codex)/|^docs/|\.(md|mdx|MD)$'
allow='^(README\.md|PRIVACY\.md|SECURITY\.md)$'
check_paths() {
  local found
  found=$(grep -E "$pattern" | grep -Ev "$allow" || true)
  if [[ -n "$found" ]]; then
    printf 'AI 또는 로컬 전용 문서가 Git에 포함되어 있습니다:\n%s\n' "$found" >&2
    return 1
  fi
}
git ls-files | check_paths
# When an upstream exists, check all unpublished snapshots too: deleting a file
# in the latest commit alone does not keep it out of a push.
if git rev-parse --verify '@{upstream}' >/dev/null 2>&1; then
  while IFS= read -r rev; do
    git ls-tree -r --name-only "$rev" | check_paths || exit 1
  done < <(git rev-list '@{upstream}..HEAD')
fi
