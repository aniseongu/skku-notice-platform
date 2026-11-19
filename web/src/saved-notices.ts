import { localKey } from './local-scope.ts';
// 저장한 공지. 목록에서 밀려나도 남도록 글 정보를 통째로 둔다(kw-notice-v1의 FavNotice 방식).
// 출처: https://github.com/kw-service/kw-notice-v1/blob/main/kw-notice-android/app/src/main/java/dev/yjyoon/kwnotice/repository/favorite/FavRepository.kt
// 이 기기에 먼저 저장하고, GitHub에 연결돼 있으면 Actions 변수 SAVED_NOTICES로 모든 기기와 맞춘다.
import type { Notice } from './data';
import { orderNotices, type Sort } from './notice-order.ts';

export type SavedNotice = Omit<Notice, 'first_seen'> & { saved_at: string };

/** 저장 목록의 정렬. 'custom'은 사용자가 직접 정한 순서(계정에 저장)다. */
export type SavedSort = Sort | 'custom';
export const SAVED_ORDER_LIMIT = 200;

/** 직접 정한 순서를 적용한다. 순서에 있는 공지는 그 순서대로, 없는 공지(새로 저장했거나 순서를 정하기 전에 저장한 것)는 맨 위에 들어온 순서(items의 순서)대로 둔다. 사라진 id는 무시한다. */
export function applySavedOrder<T extends { id: string }>(items: readonly T[], order: readonly string[]): T[] {
  const rank = new Map<string, number>();
  order.forEach((id, index) => { if (!rank.has(id)) rank.set(id, index); });
  const fresh = items.filter((item) => !rank.has(item.id));
  const ordered = items.filter((item) => rank.has(item.id)).sort((a, b) => rank.get(a.id)! - rank.get(b.id)!);
  return [...fresh, ...ordered];
}

/** 놓은 순서(화면에 보이던 공지)와 그 밖의 저장 공지를 합쳐 저장할 순서를 만든다. 현재 저장 집합에 없는 id는 버린다. */
export function savedOrderToStore(moved: readonly string[], allSaved: readonly string[]): string[] {
  const known = new Set(allSaved);
  const head = [...new Set(moved)].filter((id) => known.has(id));
  const used = new Set(head);
  return [...head, ...allSaved.filter((id) => !used.has(id))].slice(0, SAVED_ORDER_LIMIT);
}

export function parseSavedOrder(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.filter((id): id is string => typeof id === 'string' && id.length > 0 && id.length <= 100))].slice(0, SAVED_ORDER_LIMIT);
}

export function orderSaved(items: readonly SavedNotice[], current: readonly Notice[], sort: SavedSort, order: readonly string[] = []): Notice[] {
  const byId = new Map(current.map((notice) => [notice.id, notice]));
  const ordered = [...items].sort((a, b) => b.saved_at.localeCompare(a.saved_at))
    .map((item) => byId.get(item.id) ?? { ...item, first_seen: null });
  if (sort === 'custom') return applySavedOrder(ordered, order);
  return sort === 'deadline' ? orderNotices(ordered, 'deadline') : ordered;
}

const KEY = 'saved-notices';
export const SAVED_VARIABLE = 'SAVED_NOTICES';
// Actions 변수 한 개는 48KB까지다. 여유를 두고 넘기 전에 막는다.
export const SAVED_LIMIT_BYTES = 45_000;

function valid(value: unknown): value is SavedNotice {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  return ['id', 'source_id', 'article_no', 'title', 'url', 'posted_on', 'saved_at'].every((k) => typeof item[k] === 'string');
}

export function parseSaved(raw: string | null): SavedNotice[] {
  try {
    const parsed: unknown = JSON.parse(raw ?? '[]');
    return Array.isArray(parsed) ? parsed.filter(valid) : [];
  } catch { return []; }
}

export function loadSaved(): SavedNotice[] {
  try { return parseSaved(localStorage.getItem(localKey(KEY))); } catch { return []; }
}

export function storeSaved(items: SavedNotice[]): void {
  try { localStorage.setItem(localKey(KEY), JSON.stringify(items)); } catch { /* 저장하지 못해도 화면은 돈다 */ }
}

export function snapshot(notice: Notice, now = new Date()): SavedNotice {
  const { first_seen: _seen, ...rest } = notice;
  return { ...rest, saved_at: now.toISOString() };
}

/** 저장 목록을 바꾼 결과. 너무 커서 GitHub 변수에 못 넣으면 null */
export function toggleSaved(items: SavedNotice[], notice: Notice, now = new Date()): SavedNotice[] | null {
  if (items.some((item) => item.id === notice.id)) return items.filter((item) => item.id !== notice.id);
  const next = [snapshot(notice, now), ...items];
  return new TextEncoder().encode(JSON.stringify(next)).length > SAVED_LIMIT_BYTES ? null : next;
}
