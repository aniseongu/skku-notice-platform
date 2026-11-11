import type { Notice } from './data.ts';

// 같은 공지가 여러 게시판에 올라오면 가장 먼저 감지된 글 하나만 보여 준다(그 글의 게시판 이름이 줄에 적힌다).
// 게시일이 3일 안이고, 정리한 제목이 같거나(dup_key) 제목이 달라도 본문이나 사진 글자가 같으면(dup_text_key) 같은 글이다.
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
  // 열쇠(제목 열쇠, 그림 글자 열쇠)마다 글을 모은다. 두 열쇠 중 하나라도 같으면 같은 글이다.
  const groups = new Map<string, Notice[]>();
  const add = (key: string, notice: Notice) => { const group = groups.get(key); if (group) group.push(notice); else groups.set(key, [notice]); };
  for (const notice of list) {
    if (notice.dup_key) add(`k:${notice.dup_key}`, notice);
    if (notice.dup_text_key) add(`t:${notice.dup_text_key}`, notice);
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

/** 같은 공지끼리 서로 찾는 색인(글 번호 → 같은 공지인 다른 글들). 읽음과 저장을 묶음 전체에 맞출 때 쓴다. 순서와 상관없이 서로 같은 글이다. */
export function groupMates(list: readonly Notice[]): Map<string, Notice[]> {
  const groups = new Map<string, Notice[]>();
  const add = (key: string, notice: Notice) => { const group = groups.get(key); if (group) group.push(notice); else groups.set(key, [notice]); };
  for (const notice of list) {
    if (notice.dup_key) add(`k:${notice.dup_key}`, notice);
    if (notice.dup_text_key) add(`t:${notice.dup_text_key}`, notice);
  }
  const mates = new Map<string, Map<string, Notice>>();
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    for (const notice of group) {
      for (const other of group) {
        if (other === notice || Math.abs(day(other) - day(notice)) > WINDOW_DAYS) continue;
        const found = mates.get(notice.id) ?? new Map<string, Notice>();
        found.set(other.id, other); mates.set(notice.id, found);
      }
    }
  }
  return new Map([...mates].map(([id, found]) => [id, [...found.values()]]));
}
