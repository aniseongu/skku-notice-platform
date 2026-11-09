// 게시판 순서. 저장된 순서를 먼저, 저장에 없는 게시판은 원래(목록) 순서로 뒤에 붙이고, 모르는 id는 무시한다.
export const BOARD_ORDER_LIMIT = 200;

export function applyBoardOrder<T extends { id: string }>(items: readonly T[], order: readonly string[]): T[] {
  const byId = new Map(items.map((item) => [item.id, item]));
  const result: T[] = [];
  const used = new Set<string>();
  for (const id of order) {
    const item = byId.get(id);
    if (item && !used.has(id)) { result.push(item); used.add(id); }
  }
  for (const item of items) if (!used.has(item.id)) { result.push(item); used.add(item.id); }
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
