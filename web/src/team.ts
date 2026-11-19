import type { SupabaseClient } from '@supabase/supabase-js';
import type { AccountGuard } from './notice-state-sync.ts';

// 공고 연결형 팀원 모집(설계: docs/design/2026-11-19_team-recruit.md). 표는 RPC로만 다룬다.
// 읽기 결과에는 다른 사용자의 user_id가 없다. 이 모듈은 알려 준 필드만 골라 읽는다.
export const ROLE_MAX = 40;
export const INTRO_MAX = 200;
export const MESSAGE_MAX = 100;
export const CONTACT_MAX = 200;
export const CAPACITY_CHOICES: readonly number[] = [1, 2, 3, 4, 5];
export const DEFAULT_CAPACITY = 2;

export type TeamState = 'open' | 'full' | 'closed';
export type ApplicationStatus = 'pending' | 'approved' | 'rejected' | 'withdrawn';

export interface TeamPost {
  id: string; role: string; capacity: number; approved: number; intro: string; state: TeamState;
  closesAt: string; mine: boolean; hidden: boolean; myStatus: ApplicationStatus | null;
}
export interface TeamApplicant { id: string; anonNo: number; message: string | null; status: ApplicationStatus }
export interface TeamDraft { role: string; capacity: number; intro: string }

const STATES: readonly string[] = ['open', 'full', 'closed'];
const STATUSES: readonly string[] = ['pending', 'approved', 'rejected', 'withdrawn'];
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);

export function parseTeamPost(row: unknown): TeamPost | null {
  if (!row || typeof row !== 'object') return null;
  const r = row as Record<string, unknown>;
  if (typeof r.id !== 'string' || typeof r.role !== 'string' || typeof r.intro !== 'string' || typeof r.state !== 'string' || !STATES.includes(r.state)) return null;
  const my = str(r.my_status);
  return {
    id: r.id, role: r.role, intro: r.intro, state: r.state as TeamState,
    capacity: typeof r.capacity === 'number' ? r.capacity : 1,
    approved: typeof r.approved_count === 'number' ? r.approved_count : 0,
    closesAt: str(r.closes_at) ?? '', mine: r.mine === true, hidden: r.hidden === true,
    myStatus: my && STATUSES.includes(my) ? my as ApplicationStatus : null,
  };
}

export function parseApplicant(row: unknown): TeamApplicant | null {
  if (!row || typeof row !== 'object') return null;
  const r = row as Record<string, unknown>;
  if (typeof r.application_id !== 'string' || typeof r.anon_no !== 'number' || typeof r.status !== 'string' || !STATUSES.includes(r.status)) return null;
  return { id: r.application_id, anonNo: r.anon_no, message: str(r.message), status: r.status as ApplicationStatus };
}

/** 구역을 보일 공고: 팀을 꾸릴 만한 공모전·대회·대외활동류. 그 밖의 공고에서는 팀 구역을 두지 않는다. */
const TEAM_NOTICE = /공모전|해커톤|해커슨|아이디어톤|경진|콘테스트|대회|캡스톤|대외활동|서포터즈|챌린지|부트캠프|스터디|동아리/;
export function isTeamNotice(notice: { title: string; category: string | null; title_ko?: string | null }): boolean {
  return TEAM_NOTICE.test(`${notice.title_ko ?? ''} ${notice.title} ${notice.category ?? ''}`);
}

/** 만들기 입력 검사. 문제가 없으면 null, 있으면 화면에 보일 한 줄. */
export function validateTeamDraft(draft: TeamDraft): string | null {
  const role = draft.role.trim(), intro = draft.intro.trim();
  if (!role) return '맡을 역할을 적어 주세요';
  if (role.length > ROLE_MAX) return `역할은 ${ROLE_MAX}자까지 쓸 수 있어요`;
  if (!intro) return '한 줄 소개를 적어 주세요';
  if (intro.length > INTRO_MAX) return `소개는 ${INTRO_MAX}자까지 쓸 수 있어요`;
  if (!Number.isInteger(draft.capacity) || draft.capacity < 1 || draft.capacity > 10) return '인원을 다시 골라 주세요';
  return null;
}

/** 연락처 검사(서버 규칙과 같다): 제어 문자 없음, https?:// 주소이거나 콜론이 없는 아이디·이메일. */
export function validateContact(raw: string): string | null {
  const value = raw.trim();
  if (!value) return '연락처를 적어 주세요';
  if (value.length > CONTACT_MAX) return `연락처는 ${CONTACT_MAX}자까지 쓸 수 있어요`;
  if (/[\u0000-\u001f\u007f-\u009f]/.test(raw)) return '연락처에 쓸 수 없는 글자가 있어요';
  if (/^https?:\/\/\S+$/i.test(value)) return contactHref(value) ? null : '링크 모양을 확인해 주세요';
  if (value.includes(':')) return '링크는 https://로 시작해야 해요';
  return null;
}

/** 링크로 만들어도 되는 연락처면 그 주소, 아니면 null. http와 https만 링크가 된다(javascript: 등은 글자로만 보인다). */
export function contactHref(contact: string): string | null {
  const value = contact.trim();
  if (!/^https?:\/\/\S+$/i.test(value)) return null;
  try { const url = new URL(value); return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null; } catch { return null; }
}

const MESSAGES: Record<string, string> = {
  team_invalid_input: '입력한 내용을 다시 확인해 주세요',
  team_not_available: '지금은 신청할 수 없는 모집이에요',
  team_hidden_recently: '이 공고에서는 잠시 새 모집을 올릴 수 없어요',
  team_contact_required: '승인하려면 연락처를 먼저 알려 주세요',
  team_full: '자리가 모두 찼어요',
  team_already_applied: '이미 신청했어요',
  team_already_posted: '이 공고에는 이미 모집을 올렸어요',
  team_limit_reached: '진행 중인 모집이나 신청이 너무 많아요. 끝난 것을 정리해 주세요',
  team_rate_limited: '너무 빨라요. 잠시 뒤에 다시 해 주세요',
  team_rejected: '이 모집에는 다시 신청할 수 없어요',
  team_not_found: '찾을 수 없는 모집이에요. 새로 고쳐 주세요',
  team_not_pending: '이미 처리된 신청이에요',
  team_own_post: '내가 올린 모집에는 신청할 수 없어요',
  team_notice_not_found: '이 공고로는 아직 모집을 올릴 수 없어요',
  team_unauthenticated: '로그인한 뒤에 다시 해 주세요',
};
const FALLBACK_MESSAGE = '잠시 뒤에 다시 시도해 주세요';

/** 서버 오류(team_* 코드)를 해요체 한 줄로. 코드를 못 찾으면 다시 시도를 권한다. */
export function teamErrorCode(error: unknown): string | null {
  const text = [(error as { message?: unknown } | null)?.message, (error as { details?: unknown } | null)?.details, (error as { hint?: unknown } | null)?.hint]
    .filter((part): part is string => typeof part === 'string').join(' ');
  return /team_[a-z_]+/.exec(text)?.[0] ?? null;
}
export function teamErrorMessage(error: unknown): string {
  const code = teamErrorCode(error);
  return (code && MESSAGES[code]) || FALLBACK_MESSAGE;
}

/** 팀 RPC가 운영에 아직 없을 때(함수 없음 42883, PostgREST PGRST202, 표 없음)의 오류인지. 일시적인 오류와 구분한다. */
export function isTeamUnavailable(error: unknown): boolean {
  const e = error as { code?: unknown; message?: unknown } | null;
  if (e?.code === 'PGRST202' || e?.code === '42883' || e?.code === '42P01' || e?.code === 'PGRST205') return true;
  return typeof e?.message === 'string' && /team_[a-z_]+/.test(e.message) && /(could not find the function|does not exist|schema cache)/i.test(e.message);
}

export class AccountChanged extends Error { constructor() { super('계정이 바뀌었어요'); } }

async function same(guard: AccountGuard): Promise<void> { if (!await guard()) throw new AccountChanged(); }

async function call(client: SupabaseClient, fn: string, args: Record<string, unknown>, guard: AccountGuard): Promise<unknown> {
  await same(guard);
  const { data, error } = await client.rpc(fn, args);
  await same(guard);   // 계정이 바뀐 뒤 늦게 도착한 응답은 버린다
  if (error) throw error;
  return data;
}
const rows = <T>(data: unknown, parse: (row: unknown) => T | null): T[] => (Array.isArray(data) ? data : []).map(parse).filter((item): item is T => item !== null);

/** 화면이 쓰는 팀 동작 묶음. 시험에서는 같은 모양의 가짜로 바꿀 수 있다. */
export interface TeamApi {
  list(noticeId: string, guard: AccountGuard): Promise<TeamPost[]>;
  create(noticeId: string, draft: TeamDraft, guard: AccountGuard): Promise<void>;
  apply(postId: string, message: string, guard: AccountGuard): Promise<void>;
  withdraw(postId: string, guard: AccountGuard): Promise<void>;
  setStatus(postId: string, status: 'open' | 'closed', guard: AccountGuard): Promise<void>;
  remove(postId: string, guard: AccountGuard): Promise<void>;
  applicants(postId: string, guard: AccountGuard): Promise<TeamApplicant[]>;
  decide(applicationId: string, decision: 'approved' | 'rejected', guard: AccountGuard): Promise<void>;
  setContact(postId: string, contact: string, guard: AccountGuard): Promise<void>;
  contact(postId: string, guard: AccountGuard): Promise<string | null>;
  report(postId: string, guard: AccountGuard): Promise<void>;
  blockOwner(postId: string, guard: AccountGuard): Promise<void>;
  blockApplicant(applicationId: string, guard: AccountGuard): Promise<void>;
}

export function createTeamApi(client: SupabaseClient): TeamApi {
  const run = async (fn: string, args: Record<string, unknown>, guard: AccountGuard) => { await call(client, fn, args, guard); };
  return {
    list: async (noticeId, guard) => rows(await call(client, 'team_list_posts', { p_notice_id: noticeId }, guard), parseTeamPost),
    create: async (noticeId, draft, guard) => {
      const problem = validateTeamDraft(draft);
      if (problem) throw Object.assign(new Error('team_invalid_input'), { code: '22023' });
      await run('team_create_post', { p_notice_id: noticeId, p_role: draft.role.trim(), p_capacity: draft.capacity, p_intro: draft.intro.trim() }, guard);
    },
    apply: (postId, message, guard) => {
      if (message.trim().length > MESSAGE_MAX) return Promise.reject(Object.assign(new Error('team_invalid_input'), { code: '22023' }));
      return run('team_apply', { p_post_id: postId, p_message: message.trim() || null }, guard);
    },
    withdraw: (postId, guard) => run('team_withdraw', { p_post_id: postId }, guard),
    setStatus: (postId, status, guard) => run('team_set_status', { p_post_id: postId, p_status: status }, guard),
    remove: (postId, guard) => run('team_delete_post', { p_post_id: postId }, guard),
    applicants: async (postId, guard) => rows(await call(client, 'team_list_applicants', { p_post_id: postId }, guard), parseApplicant),
    decide: (applicationId, decision, guard) => run('team_decide', { p_application_id: applicationId, p_decision: decision }, guard),
    setContact: (postId, contact, guard) => {
      if (validateContact(contact)) return Promise.reject(Object.assign(new Error('team_invalid_input'), { code: '22023' }));
      return run('team_set_contact', { p_post_id: postId, p_contact: contact.trim() }, guard);
    },
    contact: async (postId, guard) => { const data = await call(client, 'team_get_contact', { p_post_id: postId }, guard); return typeof data === 'string' ? data : null; },
    report: (postId, guard) => run('team_report', { p_post_id: postId }, guard),
    blockOwner: (postId, guard) => run('team_block_post_owner', { p_post_id: postId }, guard),
    blockApplicant: (applicationId, guard) => run('team_block_applicant', { p_application_id: applicationId }, guard),
  };
}
