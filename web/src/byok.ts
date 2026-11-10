import { FunctionsHttpError, type SupabaseClient } from '@supabase/supabase-js';

export interface ByokStatus {
  keyHint: string;
  model: string;
  disabled: boolean;
  lastError: string | null;
  usedToday: number;
}

/** 키 문자열은 이 모듈 밖으로 나가지 않고 요청 한 번에만 쓴다. 화면과 로그에는 마지막 4글자만 남는다. */
export function looksLikeGeminiKey(value: string): boolean {
  return /^[0-9A-Za-z_.~-]{20,300}$/.test(value);
}

export interface CanvasStatus { keyHint: string; disabled: boolean; lastError: string | null; lastOkAt: string | null }

/** 아이캠퍼스(Canvas) 개인 액세스 토큰 형식. 실제 유효성은 서버가 아이캠퍼스에 확인한다. */
export function looksLikeCanvasToken(value: string): boolean {
  return /^[0-9A-Za-z~_-]{16,200}$/.test(value);
}

export async function loadCanvasStatus(client: SupabaseClient, userId: string): Promise<CanvasStatus | null> {
  const { data, error } = await client.from('user_canvas_tokens')
    .select('token_hint,disabled_at,last_error,last_ok_at').eq('user_id', userId).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return { keyHint: data.token_hint, disabled: !!data.disabled_at, lastError: data.last_error, lastOkAt: data.last_ok_at };
}

export async function registerCanvasToken(client: SupabaseClient, token: string): Promise<void> {
  if (!looksLikeCanvasToken(token)) throw new Error('아이캠퍼스 토큰 형식이 맞지 않아요.');
  const { error } = await client.functions.invoke('byok', { method: 'POST', body: { provider: 'canvas', token } });
  if (error) throw await failure(error, '토큰을 저장하지 못했어요. 잠시 뒤 다시 시도해 주세요.');
}

export async function removeCanvasToken(client: SupabaseClient): Promise<void> {
  const { error } = await client.functions.invoke('byok?provider=canvas', { method: 'DELETE' });
  if (error) throw await failure(error, '토큰을 지우지 못했어요. 잠시 뒤 다시 시도해 주세요.');
}

/** 내 Gemini 키로 만든 공지 정보: 요약, 본문에서 읽은 마감, 판정(맞는지와 이유). 본인 행만 읽힌다. */
export interface MyNoticeInfo {
  summary: string | null;
  deadline: string | null;
  deadlineKind: '마감' | '일정' | null;
  ai: { verdict: 'relevant' | 'maybe' | 'not_relevant'; reason: string; model: string } | null;
}

export interface MyTranslation { title: string; body: string; model: string }

/** 번역은 계정별 행에서 읽는다. 계정의 키로 만든 결과만 목록과 상세에 표시한다. */
export async function loadMyTranslations(client: SupabaseClient, userId: string): Promise<Map<string, MyTranslation>> {
  const translations = new Map<string, MyTranslation>();
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await client.from('user_notice_translations').select('notice_id,title,body,model')
      .eq('user_id', userId).not('title', 'is', null).order('notice_id').range(offset, offset + 499);
    if (error) throw error;
    for (const row of data ?? []) {
      if (typeof row.notice_id === 'string' && typeof row.title === 'string' && typeof row.body === 'string')
        translations.set(row.notice_id, { title: row.title, body: row.body, model: String(row.model ?? '') });
    }
    if (!data || data.length < 500) break;
  }
  return translations;
}

const clean = (value: unknown): string | null => (typeof value === 'string' && value.trim() ? value : null);
const kindOf = (value: unknown): '마감' | '일정' | null => (value === '마감' || value === '일정' ? value : null);

/** 목록에 쓸 본인 날짜를 페이지 단위로 가져온다. 요청한 요약의 날짜가 판정 날짜보다 우선이다. */
export async function loadMyDeadlines(client: SupabaseClient, userId: string): Promise<Map<string, Pick<MyNoticeInfo, 'deadline' | 'deadlineKind'>>> {
  const result = new Map<string, Pick<MyNoticeInfo, 'deadline' | 'deadlineKind'>>();
  for (const table of ['user_notice_summaries', 'user_notice_judgments']) {
    for (let offset = 0; ; offset += 500) {
      const { data, error } = await client.from(table).select('notice_id,deadline,deadline_kind')
        .eq('user_id', userId).not('deadline', 'is', null).order('notice_id').range(offset, offset + 499);
      if (error) throw error;
      for (const row of data ?? []) {
        const deadline = clean(row.deadline);
        if (deadline && typeof row.notice_id === 'string' && !result.has(row.notice_id))
          result.set(row.notice_id, { deadline, deadlineKind: kindOf(row.deadline_kind) });
      }
      if (!data || data.length < 500) break;
    }
  }
  return result;
}

/** 눌러서(또는 열어서) 만든 요약을 먼저 보고, 없으면 판정할 때 같이 만든 것을 본다. 아무것도 없으면 null. */
export async function loadMyNoticeInfo(client: SupabaseClient, userId: string, noticeId: string): Promise<MyNoticeInfo | null> {
  const made = await client.from('user_notice_summaries').select('summary,deadline,deadline_kind').eq('user_id', userId).eq('notice_id', noticeId).maybeSingle();
  if (made.error) throw made.error;
  const judged = await client.from('user_notice_judgments').select('summary,verdict,reason,model,deadline,deadline_kind').eq('user_id', userId).eq('notice_id', noticeId).maybeSingle();
  if (judged.error) throw judged.error;
  const m = made.data as Record<string, unknown> | null;
  const j = judged.data as Record<string, unknown> | null;
  if (!m && !j) return null;
  const verdict = j?.verdict;
  const ai: MyNoticeInfo['ai'] = j && (verdict === 'relevant' || verdict === 'maybe' || verdict === 'not_relevant') && clean(j.reason)
    ? { verdict, reason: String(j.reason), model: String(j.model ?? '') } : null;
  const deadline = clean(m?.deadline) ?? clean(j?.deadline);
  const deadlineKind = deadline ? (kindOf(m?.deadline_kind) ?? kindOf(j?.deadline_kind)) : null;
  return { summary: clean(m?.summary) ?? clean(j?.summary), deadline, deadlineKind, ai };
}

/** 내 계정과 거기 딸린 모든 정보(구독, 키워드, 저장·읽음, 프로필, 암호화한 키와 토큰, 알림 기기)를 지운다. 되돌릴 수 없다. */
export async function deleteMyAccount(client: SupabaseClient): Promise<void> {
  const { error } = await client.functions.invoke('byok', { method: 'POST', body: { action: 'delete-account' } });
  if (error) throw await failure(error, '계정을 지우지 못했어요. 잠시 뒤 다시 눌러 주세요.');
}

/** 구글 갱신 열쇠를 서버에 맡겨 암호화해 보관하게 한다. 서버가 이 열쇠로 캘린더를 자동으로 맞춘다. */
export async function linkGoogleCalendar(client: SupabaseClient, refreshToken: string): Promise<void> {
  const { error } = await client.functions.invoke('byok', { method: 'POST', body: { action: 'google-calendar-link', refreshToken } });
  if (error) throw await failure(error, '자동으로 맞추는 설정을 저장하지 못했어요. 잠시 뒤 다시 연결해 주세요.');
}

export interface GoogleAutoStatus { active: boolean; error: string | null; lastRunAt: string | null }

/** 서버가 캘린더를 자동으로 맞추고 있는지(내 상태 열만 읽힌다). 열쇠가 없으면 active는 false. */
export async function loadGoogleAutoStatus(client: SupabaseClient, userId: string): Promise<GoogleAutoStatus> {
  const { data, error } = await client.from('user_google_tokens').select('disabled_at,last_error,last_run_at').eq('user_id', userId).maybeSingle();
  if (error) throw error;
  if (!data) return { active: false, error: null, lastRunAt: null };
  return { active: !data.disabled_at, error: typeof data.last_error === 'string' ? data.last_error : null, lastRunAt: typeof data.last_run_at === 'string' ? data.last_run_at : null };
}

/** 공지 한 건의 요약과 마감을 내 키로 지금 만든다. 서버가 키를 풀어 Gemini에 보내고 결과를 저장한다. */
export async function requestNoticeSummary(client: SupabaseClient, noticeId: string): Promise<Pick<MyNoticeInfo, 'summary' | 'deadline' | 'deadlineKind'>> {
  const { data, error } = await client.functions.invoke('byok', { method: 'POST', body: { action: 'summarize', noticeId } });
  if (error) throw await failure(error, '요약을 만들지 못했어요. 잠시 뒤 다시 눌러 주세요.');
  const body = data as { summary?: unknown; deadline?: unknown; deadlineKind?: unknown } | null;
  const summary = clean(body?.summary);
  if (!summary) throw new Error('요약을 만들지 못했어요. 잠시 뒤 다시 눌러 주세요.');
  const deadline = clean(body?.deadline);
  return { summary, deadline, deadlineKind: deadline ? kindOf(body?.deadlineKind) : null };
}

/** 암호문 열은 브라우저가 읽을 수 없으므로 상태 열만 고른다. */
export async function loadByokStatus(client: SupabaseClient, userId: string): Promise<ByokStatus | null> {
  const { data, error } = await client.from('user_byok_keys')
    .select('key_hint,model,disabled_at,last_error,used_today').eq('user_id', userId).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return { keyHint: data.key_hint, model: data.model, disabled: !!data.disabled_at, lastError: data.last_error, usedToday: data.used_today };
}

/** 내 키로 아직 판정하지 못한, 마감이 지나지 않은 공지 수. 값을 못 읽으면 0으로 보고 화면에 아무것도 띄우지 않는다. */
export async function loadByokBackfillCount(client: SupabaseClient): Promise<number> {
  const { data, error } = await client.rpc('my_byok_backfill_count');
  return !error && typeof data === 'number' && data > 0 ? Math.trunc(data) : 0;
}

/** 키 상태 아래에 보일 안내. 키가 꺼져 있거나 남은 공지가 없으면 null. */
export function backfillNote(count: number, disabled: boolean): string | null {
  return count > 0 && !disabled ? `공지 ${count}개를 내 기준으로 다시 보고 있어요` : null;
}

async function failure(error: unknown, fallback: string): Promise<Error> {
  if (error instanceof FunctionsHttpError) {
    try {
      const body = await error.context.json() as { error?: unknown };
      if (typeof body.error === 'string' && /[가-힣]/.test(body.error)) return new Error(body.error);
    } catch { /* 본문이 없으면 기본 문구를 쓴다 */ }
  }
  return new Error(fallback);
}

export async function registerByokKey(client: SupabaseClient, apiKey: string): Promise<string> {
  if (!looksLikeGeminiKey(apiKey)) throw new Error('키를 끝까지 복사해 공백 없이 붙여 넣어 주세요.');
  const { data, error } = await client.functions.invoke('byok', { method: 'POST', body: { apiKey } });
  if (error) throw await failure(error, '키를 저장하지 못했어요. 잠시 뒤 다시 시도해 주세요.');
  const hint = (data as { keyHint?: unknown } | null)?.keyHint;
  if (typeof hint !== 'string') throw new Error('키를 저장하지 못했어요. 잠시 뒤 다시 시도해 주세요.');
  return hint;
}

export async function removeByokKey(client: SupabaseClient): Promise<void> {
  const { error } = await client.functions.invoke('byok', { method: 'DELETE' });
  if (error) throw await failure(error, '키를 지우지 못했어요. 잠시 뒤 다시 시도해 주세요.');
}

/** 키 등록 기능이 이 환경에 배포돼 있는지 확인한다. 없으면 설정 화면에 입력란을 보이지 않는다. */
export async function byokAvailable(supabaseUrl: string | undefined, fetcher: typeof fetch = fetch): Promise<boolean> {
  if (!supabaseUrl) return false;
  try {
    const response = await fetcher(new URL('/functions/v1/byok', supabaseUrl), { method: 'OPTIONS', cache: 'no-store' });
    return response.status === 204;
  } catch { return false; }
}
