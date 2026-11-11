import type { Notice } from './data.ts';

// 같은 공지가 여러 게시판에 올라오면 가장 먼저 감지된 글 하나만 보여 준다(그 글의 게시판 이름이 줄에 적힌다).
// 서버가 정리한 제목(학교 글은 본문 앞부분까지)으로 만든 dup_key가 같고 게시일이 3일 안이면 같은 글이다.
// DB 함수 dup_loser와 같은 규칙이다. 사용자가 볼 수 있는 목록 안에서만 묶으므로, 구독하지 않은 게시판의 글이 대표가 되어
// 구독한 게시판의 글이 사라지는 일은 없다.
const WINDOW_DAYS = 3;
const DAY = 86_400_000;

function day(notice: Notice): number {
  const value = Date.parse(notice.posted_on);
  return Number.isFinite(value) ? Math.floor(value / DAY) : Number.NaN;
}

function earlier(a: Notice, b: Notice): boolean {
  const left = a.first_seen ?? '', right = b.first_seen ?? '';
  return left !== right ? left < right : a.id < b.id;
}

export function dropDuplicates(list: readonly Notice[]): Notice[] {
  const groups = new Map<string, Notice[]>();
  for (const notice of list) {
    if (!notice.dup_key) continue;
    const group = groups.get(notice.dup_key);
    if (group) group.push(notice); else groups.set(notice.dup_key, [notice]);
  }
  const hidden = new Set<string>();
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    for (const notice of group) {
      if (group.some((other) => other !== notice && earlier(other, notice) && Math.abs(day(other) - day(notice)) <= WINDOW_DAYS)) hidden.add(notice.id);
    }
  }
  return hidden.size ? list.filter((notice) => !hidden.has(notice.id)) : [...list];
}
