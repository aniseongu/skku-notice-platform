import type { SupabaseClient } from '@supabase/supabase-js';
import type { AccountGuard } from './notice-state-sync.ts';

// 내 기회함. 공지가 지워져도 남도록 제목·링크·마감 사본을 함께 저장한다(DB에 공지 FK 없음).
export type OpportunityStatus = 'interested' | 'preparing' | 'applied' | 'result';
export const OPPORTUNITY_STATUSES: readonly OpportunityStatus[] = ['interested', 'preparing', 'applied', 'result'];
export const OPPORTUNITY_LABELS: Record<OpportunityStatus, string> = {
  interested: '관심 있음', preparing: '준비 중', applied: '지원함', result: '결과 나옴',
};
export const NOTE_MAX = 500;
export const TITLE_MAX = 200;
export const URL_MAX = 1000;
export const OPPORTUNITY_LIMIT = 200;

export interface Opportunity {
  notice_id: string; title: string; url: string | null; board: string | null;
  deadline: string | null; status: OpportunityStatus; note: string | null;
  created_at: string; updated_at: string;
}
export interface OpportunityDraft {
  notice_id: string; title: string; url?: string | null; board?: string | null;
  deadline?: string | null; status?: OpportunityStatus; note?: string | null;
}

const COLUMNS = 'notice_id,title,url,board,deadline,status,note,created_at,updated_at';
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
export const isStatus = (v: unknown): v is OpportunityStatus => OPPORTUNITY_STATUSES.includes(v as OpportunityStatus);

export function parseOpportunity(row: unknown): Opportunity | null {
  if (!row || typeof row !== 'object') return null;
  const r = row as Record<string, unknown>;
  if (typeof r.notice_id !== 'string' || typeof r.title !== 'string' || !isStatus(r.status)) return null;
  return {
    notice_id: r.notice_id, title: r.title, url: str(r.url), board: str(r.board), deadline: str(r.deadline),
    status: r.status, note: str(r.note), created_at: str(r.created_at) ?? '', updated_at: str(r.updated_at) ?? '',
  };
}

async function ensureSame(guard: AccountGuard): Promise<void> {
  if (!await guard()) throw new Error('계정이 바뀌었어요');
}

/** 계정이 바뀐 뒤 늦게 도착한 응답은 버리고 오류로 알린다. */
export async function loadOpportunities(client: SupabaseClient, userId: string, guard: AccountGuard): Promise<Opportunity[]> {
  const { data, error } = await client.from('user_opportunities').select(COLUMNS)
    .eq('user_id', userId).order('updated_at', { ascending: false }).limit(OPPORTUNITY_LIMIT);
  await ensureSame(guard);
  if (error) throw error;
  return (data ?? []).map(parseOpportunity).filter((item): item is Opportunity => item !== null);
}

function validate(draft: OpportunityDraft): void {
  if (!draft.notice_id || !draft.title.trim()) throw new Error('제목이 없어요');
  if (draft.title.length > TITLE_MAX) throw new Error('제목이 너무 길어요');
  if (draft.url && (draft.url.length > URL_MAX || !/^https?:\/\//i.test(draft.url))) throw new Error('링크가 올바르지 않아요');
  if (draft.note && draft.note.length > NOTE_MAX) throw new Error(`메모는 ${NOTE_MAX}자까지 쓸 수 있어요`);
  if (draft.status !== undefined && !isStatus(draft.status)) throw new Error('상태가 올바르지 않아요');
}

/** 상태·메모 저장(upsert). 지정하지 않은 필드는 보내지 않아 기존 값을 덮지 않는다.
 *  ifAbsent는 행이 이미 있으면(다른 탭·기기에서 바꾼 상태 포함) 아무것도 덮지 않고 있는 행을 돌려준다. */
export async function saveOpportunity(client: SupabaseClient, userId: string, draft: OpportunityDraft, guard: AccountGuard, options: { ifAbsent?: boolean } = {}): Promise<Opportunity> {
  validate(draft);
  await ensureSame(guard);
  const row: Record<string, unknown> = { user_id: userId, notice_id: draft.notice_id, title: draft.title.trim() };
  for (const key of ['url', 'board', 'deadline', 'status', 'note'] as const) if (draft[key] !== undefined) row[key] = draft[key];
  let result;
  if (options.ifAbsent) {
    const { error: insertError } = await client.from('user_opportunities').upsert(row, { onConflict: 'user_id,notice_id', ignoreDuplicates: true });
    if (insertError) { await ensureSame(guard); throw insertError; }
    result = await client.from('user_opportunities').select(COLUMNS).eq('user_id', userId).eq('notice_id', draft.notice_id).single();
  } else {
    result = await client.from('user_opportunities').upsert(row, { onConflict: 'user_id,notice_id' }).select(COLUMNS).single();
  }
  await ensureSame(guard);
  if (result.error) throw result.error;
  const parsed = parseOpportunity(result.data);
  if (!parsed) throw new Error('저장 결과를 읽지 못했어요');
  return parsed;
}

/** 표가 운영에 아직 없을 때(Postgres 42P01, PostgREST PGRST205)의 오류인지. 일시적인 네트워크 오류와 구분한다. */
export function isMissingTable(error: unknown): boolean {
  const e = error as { code?: unknown; message?: unknown } | null;
  return e?.code === '42P01' || e?.code === 'PGRST205' || (typeof e?.message === 'string' && /user_opportunities/.test(e.message) && /(does not exist|schema cache)/i.test(e.message));
}

/** 기록이 200개 한도에 닿았을 때의 오류인지(migration의 트리거 메시지). */
export function isLimitReached(error: unknown): boolean {
  const message = (error as { message?: unknown } | null)?.message;
  return typeof message === 'string' && /limit reached/i.test(message);
}

export async function removeOpportunity(client: SupabaseClient, userId: string, noticeId: string, guard: AccountGuard): Promise<void> {
  await ensureSame(guard);
  const { error } = await client.from('user_opportunities').delete().eq('user_id', userId).eq('notice_id', noticeId);
  if (error) throw error;
}

/** 공지의 마감 글자를 timestamptz로 보낼 수 있는 ISO 문자열로 바꾼다(읽을 수 없으면 null). */
export function deadlineIso(value: string | null | undefined): string | null {
  if (!value) return null;
  const stamp = Date.parse(value);
  return Number.isFinite(stamp) ? new Date(stamp).toISOString() : null;
}
