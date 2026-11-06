// 읽은 공지 id. 이 기기에 두고, GitHub에 연결돼 있으면 Actions 변수 READ_NOTICES로 기기 간에 맞춘다.
export const READ_VARIABLE = 'READ_NOTICES';
export const READ_STATE_VARIABLE = 'READ_NOTICES_V2';
// 변수 크기(48KB) 안에서 최근 것만 남긴다. 목록에 오래 남는 글보다 넉넉하다.
export const READ_LIMIT = 800;
const KEY = 'read-notices';
const MAX_BYTES = 45_000;

// A negative timestamp represents an explicit unread operation. Legacy IDs use
// timestamp zero so either kind of explicit operation takes precedence.
export type ReadState = { v: 2; entries: Record<string, number> };

function emptyState(): ReadState { return { v: 2, entries: Object.create(null) as Record<string, number> }; }

export function parseReadState(raw: string | null): ReadState {
  const state = emptyState();
  try {
    const parsed: unknown = JSON.parse(raw ?? '[]');
    if (Array.isArray(parsed)) {
      for (const id of parsed) if (typeof id === 'string') state.entries[id] = 0;
    } else if (parsed && typeof parsed === 'object' && 'v' in parsed && parsed.v === 2
      && 'entries' in parsed && parsed.entries && typeof parsed.entries === 'object' && !Array.isArray(parsed.entries)) {
      for (const [id, stamp] of Object.entries(parsed.entries)) {
        if (typeof stamp === 'number' && Number.isSafeInteger(stamp)) state.entries[id] = stamp;
      }
    }
  } catch { /* malformed data is treated as empty */ }
  return state;
}

export function readIds(state: ReadState): string[] {
  return Object.entries(state.entries).filter(([, stamp]) => stamp >= 0).map(([id]) => id);
}

/** A later source edit makes a previously read notice unread until it is read again. */
export function isNoticeRead(state: ReadState, id: string, changedAt?: string | null): boolean {
  const stamp = state.entries[id];
  if (stamp === undefined || stamp < 0) return false;
  const changed = changedAt ? Date.parse(changedAt) : NaN;
  return !Number.isFinite(changed) || stamp >= changed;
}

export function mergeReadStates(remote: ReadState, local: ReadState): ReadState {
  const merged = emptyState();
  for (const state of [remote, local]) {
    for (const [id, stamp] of Object.entries(state.entries)) {
      const previous = merged.entries[id];
      if (previous === undefined || Math.abs(stamp) > Math.abs(previous)
        || (Math.abs(stamp) === Math.abs(previous) && stamp < previous)) merged.entries[id] = stamp;
    }
  }
  return boundedReadState(merged);
}

function boundedReadState(state: ReadState): ReadState {
  const bounded = emptyState();
  const ordered = Object.entries(state.entries).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]) || a[0].localeCompare(b[0]));
  const encoder = new TextEncoder();
  let bytes = encoder.encode(JSON.stringify(bounded)).length;
  let count = 0;
  for (const [id, stamp] of ordered.slice(0, READ_LIMIT)) {
    const entryBytes = encoder.encode(`${JSON.stringify(id)}:${stamp}`).length + (count ? 1 : 0);
    if (bytes + entryBytes > MAX_BYTES) continue;
    bounded.entries[id] = stamp;
    bytes += entryBytes;
    count++;
  }
  return bounded;
}

export function setReadState(state: ReadState, ids: string[], read: boolean, now = Date.now()): ReadState {
  const updated = emptyState();
  Object.assign(updated.entries, state.entries);
  const latest = Math.max(0, ...Object.values(updated.entries).map(Math.abs));
  const stamp = Math.max(1, Math.trunc(now), latest + 1);
  for (const id of ids) updated.entries[id] = read ? stamp : -stamp;
  return boundedReadState(updated);
}

export function serializeReadState(state: ReadState): string { return JSON.stringify(boundedReadState(state)); }

export function loadReadState(): ReadState | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw === null ? null : parseReadState(raw);
  } catch { return emptyState(); }
}

export function storeReadState(state: ReadState): void {
  try { localStorage.setItem(KEY, serializeReadState(state)); } catch { /* keep in memory */ }
}

export function parseRead(raw: string | null): string[] {
  return readIds(parseReadState(raw));
}

export function loadRead(): string[] | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw === null ? null : parseRead(raw);
  } catch { return []; }
}

export function storeRead(ids: string[]): void {
  try { localStorage.setItem(KEY, JSON.stringify(ids)); } catch { /* 기억하지 못해도 화면은 돈다 */ }
}

export function addRead(ids: string[], id: string): string[] {
  return [...ids.filter((x) => x !== id), id].slice(-READ_LIMIT);
}

/** 두 기기의 읽음을 합친다. 순서는 먼저 읽은 것부터, 최근 READ_LIMIT개. */
export function mergeRead(remote: string[], local: string[]): string[] {
  return [...new Set([...remote, ...local])].slice(-READ_LIMIT);
}
