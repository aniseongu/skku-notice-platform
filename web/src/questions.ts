import type { SupabaseClient } from '@supabase/supabase-js';
import type { AccountGuard } from './notice-state-sync.ts';
import { AccountChanged } from './team.ts';

// 공고별 질문·경험(설계: docs/design/2026-11-21_questions-experiences.md). 표는 RPC로만 다룬다.
// 읽기 결과에는 작성자 식별자가 없다. 이 모듈은 알려 준 필드만 골라 읽는다.
export const BODY_MAX = 500;
export type Stars = 1 | 2 | 3 | 4 | 5;
export interface Question { id: string; parentId: string | null; body: string; anonNo: number; createdAt: string; mine: boolean; hidden: boolean; detached: boolean }
export interface ExperienceInput { satisfaction: Stars; learning?: Stars; difficulty?: Stars; body?: string; participated?: boolean }
export interface Experience { id: string; body: string | null; satisfaction: Stars; learning: Stars | null; difficulty: Stars | null; participated: boolean; mine: boolean; hidden: boolean }
export interface RatingSummary { average: number | null; count: number }
export interface Experiences { posts: Experience[]; count: number; satisfaction: RatingSummary; learning: RatingSummary; difficulty: RatingSummary }

export const EMPTY_EXPERIENCES: Experiences = { posts: [], count: 0, satisfaction: { average: null, count: 0 }, learning: { average: null, count: 0 }, difficulty: { average: null, count: 0 } };

const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const stars = (v: unknown): Stars | null => (typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 5 ? v as Stars : null);

export function parseQuestion(row: unknown): Question | null {
  if (!row || typeof row !== 'object') return null;
  const r = row as Record<string, unknown>;
  if (typeof r.id !== 'string' || typeof r.body !== 'string' || typeof r.anon_no !== 'number') return null;
  return { id: r.id, parentId: str(r.parent_id), body: r.body, anonNo: r.anon_no, createdAt: str(r.created_at) ?? '', mine: r.mine === true, hidden: r.hidden === true, detached: r.detached === true };
}

export function parseExperience(row: unknown): Experience | null {
  if (!row || typeof row !== 'object') return null;
  const r = row as Record<string, unknown>;
  const satisfaction = stars(r.satisfaction);
  if (typeof r.id !== 'string' || !satisfaction) return null;
  return { id: r.id, body: str(r.body), satisfaction, learning: stars(r.learning), difficulty: stars(r.difficulty), participated: r.participated === true, mine: r.mine === true, hidden: r.hidden === true };
}

function parseSummary(v: unknown): RatingSummary {
  const r = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  const average = typeof r.average === 'number' ? r.average : typeof r.average === 'string' && Number.isFinite(Number(r.average)) ? Number(r.average) : null;
  return { average, count: typeof r.count === 'number' ? r.count : 0 };
}

export function parseExperiences(data: unknown): Experiences {
  if (!data || typeof data !== 'object') return EMPTY_EXPERIENCES;
  const r = data as Record<string, unknown>;
  return {
    posts: (Array.isArray(r.posts) ? r.posts : []).map(parseExperience).filter((p): p is Experience => p !== null),
    count: typeof r.count === 'number' ? r.count : 0,
    satisfaction: parseSummary(r.satisfaction), learning: parseSummary(r.learning), difficulty: parseSummary(r.difficulty),
  };
}

/** 평균 별점을 소수 한 자리로(4 → "4.0"). */
export const formatAverage = (value: number | null): string => (value === null ? '-' : value.toFixed(1));

/** 질문 본문 검사: 보이는 글자가 있고 500자 이하. 문제가 없으면 null. */
export function validateQuestionBody(raw: string): string | null {
  const body = raw.replace(/\r\n?/g, '\n').trim();
  if (!body) return '질문을 적어 주세요';
  if (body.length > BODY_MAX) return `${BODY_MAX}자까지 쓸 수 있어요`;
  return null;
}
export function validateExperience(input: ExperienceInput): string | null {
  if (!stars(input.satisfaction)) return '업무 만족 별점을 골라 주세요';
  if (input.learning !== undefined && !stars(input.learning)) return '별점을 다시 골라 주세요';
  if (input.difficulty !== undefined && !stars(input.difficulty)) return '별점을 다시 골라 주세요';
  if ((input.body ?? '').replace(/\r\n?/g, '\n').trim().length > BODY_MAX) return `${BODY_MAX}자까지 쓸 수 있어요`;
  return null;
}

const MESSAGES: Record<string, string> = {
  qe_invalid_input: '입력한 내용을 다시 확인해 주세요',
  qe_unsafe_text: '연락처나 링크처럼 쓸 수 없는 내용이 있어요',
  qe_notice_not_found: '이 공고에는 아직 남길 수 없어요',
  qe_parent_unavailable: '답할 수 없는 질문이에요',
  qe_not_found: '찾을 수 없는 글이에요. 새로 고쳐 주세요',
  qe_not_available: '지금은 할 수 없는 일이에요',
  qe_already_reviewed: '이 프로그램에는 이미 후기를 남겼어요',
  qe_hidden_recently: '잠시 동안은 새 글을 쓸 수 없어요',
  qe_limit_reached: '더 이상 글을 쓸 수 없어요',
  qe_rate_limited: '너무 빨라요. 잠시 뒤에 다시 해 주세요',
  qe_unauthenticated: '로그인한 뒤에 다시 해 주세요',
};
const FALLBACK_MESSAGE = '잠시 뒤에 다시 시도해 주세요';

export function qeErrorCode(error: unknown): string | null {
  const text = [(error as { message?: unknown } | null)?.message, (error as { details?: unknown } | null)?.details, (error as { hint?: unknown } | null)?.hint]
    .filter((part): part is string => typeof part === 'string').join(' ');
  return /qe_[a-z_]+/.exec(text)?.[0] ?? null;
}
export function qeErrorMessage(error: unknown): string {
  const code = qeErrorCode(error);
  return (code && MESSAGES[code]) || FALLBACK_MESSAGE;
}

/** 질문·경험 RPC가 운영에 아직 없을 때(함수·표 없음)의 오류인지. 일시적인 오류와 구분한다. */
export function isQeUnavailable(error: unknown): boolean {
  const e = error as { code?: unknown; message?: unknown } | null;
  if (e?.code === 'PGRST202' || e?.code === '42883' || e?.code === '42P01' || e?.code === 'PGRST205') return true;
  return typeof e?.message === 'string' && /qe_[a-z_]+/.test(e.message) && /(could not find the function|does not exist|schema cache)/i.test(e.message);
}

async function same(guard: AccountGuard): Promise<void> { if (!await guard()) throw new AccountChanged(); }
async function call(client: SupabaseClient, fn: string, args: Record<string, unknown>, guard: AccountGuard): Promise<unknown> {
  await same(guard);
  const { data, error } = await client.rpc(fn, args);
  await same(guard);   // 계정이 바뀐 뒤 늦게 도착한 응답은 버린다
  if (error) throw error;
  return data;
}
const asArray = (data: unknown): unknown[] => (Array.isArray(data) ? data : []);
const invalid = () => Promise.reject(Object.assign(new Error('qe_invalid_input'), { code: '22023' }));

/** 화면이 쓰는 동작 묶음. 시험에서는 같은 모양의 가짜로 바꿀 수 있다. */
export interface QuestionsApi {
  listQuestions(noticeId: string, guard: AccountGuard): Promise<Question[]>;
  listExperiences(noticeId: string, guard: AccountGuard): Promise<Experiences>;
  createQuestion(noticeId: string, body: string, parentId: string | undefined, guard: AccountGuard): Promise<string>;
  createExperience(noticeId: string, input: ExperienceInput, guard: AccountGuard): Promise<string>;
  editQuestion(postId: string, body: string, guard: AccountGuard): Promise<void>;
  editExperience(postId: string, input: ExperienceInput, guard: AccountGuard): Promise<void>;
  deletePost(postId: string, guard: AccountGuard): Promise<void>;
  report(postId: string, guard: AccountGuard): Promise<void>;
  blockAuthor(postId: string, guard: AccountGuard): Promise<string>;
  listBlocks(guard: AccountGuard): Promise<{ id: string; createdAt: string }[]>;
  unblock(blockId: string, guard: AccountGuard): Promise<void>;
}

export function createQuestionsApi(client: SupabaseClient): QuestionsApi {
  const run = async (fn: string, args: Record<string, unknown>, guard: AccountGuard) => { await call(client, fn, args, guard); };
  const expArgs = (input: ExperienceInput) => ({ p_satisfaction: input.satisfaction, p_learning: input.learning ?? null, p_difficulty: input.difficulty ?? null, p_body: input.body?.trim() || null, p_participated: input.participated === true });
  return {
    listQuestions: async (noticeId, guard) => asArray(await call(client, 'qe_list_questions', { p_notice_id: noticeId }, guard)).map(parseQuestion).filter((q): q is Question => q !== null),
    listExperiences: async (noticeId, guard) => parseExperiences(await call(client, 'qe_list_experiences', { p_notice_id: noticeId }, guard)),
    createQuestion: async (noticeId, body, parentId, guard) => {
      if (validateQuestionBody(body)) return invalid();
      const id = await call(client, 'qe_create_question', { p_notice_id: noticeId, p_body: body.trim(), p_parent_id: parentId ?? null }, guard);
      return typeof id === 'string' ? id : '';
    },
    createExperience: async (noticeId, input, guard) => {
      if (validateExperience(input)) return invalid();
      const id = await call(client, 'qe_create_experience', { p_notice_id: noticeId, ...expArgs(input) }, guard);
      return typeof id === 'string' ? id : '';
    },
    editQuestion: (postId, body, guard) => validateQuestionBody(body) ? invalid() : run('qe_edit', { p_post_id: postId, p_body: body.trim() }, guard),
    editExperience: (postId, input, guard) => validateExperience(input) ? invalid() : run('qe_edit', { p_post_id: postId, ...expArgs(input) }, guard),
    deletePost: (postId, guard) => run('qe_delete', { p_post_id: postId }, guard),
    report: (postId, guard) => run('qe_report', { p_post_id: postId }, guard),
    blockAuthor: async (postId, guard) => { const id = await call(client, 'qe_block_author', { p_post_id: postId }, guard); return typeof id === 'string' ? id : ''; },
    listBlocks: async (guard) => asArray(await call(client, 'qe_list_blocks', {}, guard))
      .flatMap((row) => { const r = row as Record<string, unknown>; return typeof r?.id === 'string' ? [{ id: r.id, createdAt: str(r.created_at) ?? '' }] : []; }),
    unblock: (blockId, guard) => run('qe_unblock', { p_block_id: blockId }, guard),
  };
}
