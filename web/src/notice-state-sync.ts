import type { SupabaseClient } from '@supabase/supabase-js';
import { mergeReadStates, type ReadState } from './read-notices.ts';
import type { Notice } from './data';
import { snapshot, type SavedNotice } from './saved-notices.ts';

const LOAD_LIMIT = 1000;
const CHUNK = 10;

export interface RemoteNoticeStates { savedIds: Set<string>; read: ReadState }

export async function loadNoticeStates(client: SupabaseClient, userId: string): Promise<RemoteNoticeStates> {
  const { data, error } = await client.from('user_notice_states').select('notice_id,is_saved,read_at')
    .eq('user_id', userId).or('is_saved.eq.true,read_at.not.is.null')
    .order('updated_at', { ascending: false }).limit(LOAD_LIMIT);
  if (error) throw error;
  const savedIds = new Set<string>();
  const read: ReadState = { v: 2, entries: Object.create(null) as Record<string, number> };
  for (const row of data ?? []) {
    if (typeof row.notice_id !== 'string') continue;
    if (row.is_saved === true) savedIds.add(row.notice_id);
    const stamp = typeof row.read_at === 'string' ? Date.parse(row.read_at) : NaN;
    if (Number.isFinite(stamp) && stamp > 0) read.entries[row.notice_id] = stamp;
  }
  return { savedIds, read };
}

export interface StatePlan {
  saved: SavedNotice[];
  read: ReadState;
  uploadSaved: { id: string; saved: boolean }[];
  uploadRead: { id: string; read: boolean }[];
}

/**
 * 서버와 이 브라우저의 값을 합친다. 서버에만 있는 저장은 현재 목록에서 글 정보를 찾을 수 있을 때만 가져오고,
 * 브라우저에만 있는 명시적 읽음·저장은 서버로 올린다. 기준선(타임스탬프 0)은 사용자 동작이 아니므로 올리지 않는다.
 */
export function planStateSync(remote: RemoteNoticeStates, localSaved: SavedNotice[], localRead: ReadState, notices: readonly Notice[]): StatePlan {
  const byId = new Map(notices.map((notice) => [notice.id, notice]));
  const saved = [...localSaved];
  const have = new Set(localSaved.map((item) => item.id));
  for (const id of remote.savedIds) {
    const notice = byId.get(id);
    if (!have.has(id) && notice) saved.push(snapshot(notice));
  }
  const uploadSaved = localSaved.filter((item) => !remote.savedIds.has(item.id)).map((item) => ({ id: item.id, saved: true }));
  const read = mergeReadStates(remote.read, localRead);
  const uploadRead: StatePlan['uploadRead'] = [];
  for (const [id, stamp] of Object.entries(read.entries)) {
    if (stamp === 0 || localRead.entries[id] !== stamp) continue;
    const remoteStamp = remote.read.entries[id];
    if (stamp > 0 && remoteStamp === undefined) uploadRead.push({ id, read: true });
    else if (stamp < 0 && remoteStamp !== undefined) uploadRead.push({ id, read: false });
  }
  return { saved, read, uploadSaved, uploadRead };
}

// 업로드 RPC는 사용자 ID 없이 현재 세션으로 쓴다. 청크를 보내기 직전마다 계정이 그대로인지 확인하고, 바뀌었으면 중단한다.
export type AccountGuard = () => boolean | Promise<boolean>;

async function inChunks<T>(items: T[], guard: AccountGuard, run: (item: T) => Promise<void>): Promise<boolean> {
  let ok = true;
  for (let i = 0; i < items.length; i += CHUNK) {
    if (!await guard()) throw new Error('계정이 바뀌었어요');
    const results = await Promise.allSettled(items.slice(i, i + CHUNK).map(run));
    if (results.some((result) => result.status === 'rejected')) ok = false;
  }
  return ok;
}

/** 현재 세션의 사용자와 기대한 사용자가 같은지 확인한다. 세션이 없어도 같지 않은 것으로 본다. */
export async function sessionIs(client: SupabaseClient, userId: string): Promise<boolean> {
  const { data } = await client.auth.getSession();
  return data.session?.user.id === userId;
}

export async function pushSaved(client: SupabaseClient, items: { id: string; saved: boolean }[], guard: AccountGuard): Promise<boolean> {
  return inChunks(items, guard, async ({ id, saved }) => {
    const { error } = await client.rpc('set_notice_saved', { p_notice_id: id, p_saved: saved });
    if (error) throw error;
  });
}

export async function pushRead(client: SupabaseClient, items: { id: string; read: boolean }[], guard: AccountGuard): Promise<boolean> {
  return inChunks(items, guard, async ({ id, read }) => {
    const { error } = await client.rpc('set_notice_read', { p_notice_id: id, p_read: read });
    if (error) throw error;
  });
}
