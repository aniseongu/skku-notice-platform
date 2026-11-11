// 게시판 순서. 저장된 순서를 먼저, 저장에 없는 게시판은 원래(목록) 순서로 뒤에 붙이고, 모르는 id는 무시한다.
import { DEFAULT_BOARD, OTHER_BOARDS } from './skku-boards.ts';

export const BOARD_ORDER_LIMIT = 200;

/** 기본 순서의 구분: 성균관대(0) → 대학(1) → 학과(2) → 기타(3). 저장된 순서가 없는 게시판은 이 순서로 놓는다. */
export function boardRank(item: { id: string; name?: string; label?: string }): number {
  if (item.id === DEFAULT_BOARD) return 0;
  if (OTHER_BOARDS.some((board) => board.id === item.id)) return 3;
  const name = (item.name ?? item.label ?? '').replace(/\s*공지$/, '').trim();
  if (name === '성균관대') return 0;
  return /대학$/.test(name) ? 1 : 2;
}

export function applyBoardOrder<T extends { id: string; name?: string; label?: string }>(items: readonly T[], order: readonly string[]): T[] {
  const byId = new Map(items.map((item) => [item.id, item]));
  const result: T[] = [];
  const used = new Set<string>();
  for (const id of order) {
    const item = byId.get(id);
    if (item && !used.has(id)) { result.push(item); used.add(id); }
  }
  // 저장된 순서에 없는 게시판은 성균관대 > 대학 > 학과 > 기타 순으로, 같은 구분 안에서는 원래 순서로 뒤에 붙인다.
  const rest = items.filter((item) => !used.has(item.id)).map((item, index) => ({ item, index, rank: boardRank(item) }));
  rest.sort((a, b) => a.rank - b.rank || a.index - b.index);
  for (const { item } of rest) { result.push(item); used.add(item.id); }
  return result;
}

export function moveBoardId(ids: readonly string[], from: number, to: number): string[] {
  if (from === to || from < 0 || to < 0 || from >= ids.length || to >= ids.length) return [...ids];
  const next = [...ids];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

export function parseBoardOrder(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.filter((id): id is string => typeof id === 'string' && id.length > 0 && id.length <= 100))].slice(0, BOARD_ORDER_LIMIT);
}
