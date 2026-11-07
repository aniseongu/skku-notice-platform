import { FunctionsHttpError, type SupabaseClient } from '@supabase/supabase-js';

export interface ByokStatus {
  keyHint: string;
  model: string;
  disabled: boolean;
  lastError: string | null;
  usedToday: number;
}

export interface JudgeProfile {
  year: number | null;
  semester: number | null;
  enrollmentStatus: string | null;
  militaryService: string | null;
}

export const ENROLLMENT = ['재학', '휴학', '졸업예정', '졸업'] as const;
export const MILITARY = ['복무 전', '복무 완료', '해당 없음'] as const;
export const EMPTY_PROFILE: JudgeProfile = { year: null, semester: null, enrollmentStatus: null, militaryService: null };

/** 키 문자열은 이 모듈 밖으로 나가지 않고 요청 한 번에만 쓴다. 화면과 로그에는 마지막 4글자만 남는다. */
export function looksLikeGeminiKey(value: string): boolean {
  return /^AIza[0-9A-Za-z_-]{35}$/.test(value);
}

/** 암호문 열은 브라우저가 읽을 수 없으므로 상태 열만 고른다. */
export async function loadByokStatus(client: SupabaseClient, userId: string): Promise<ByokStatus | null> {
  const { data, error } = await client.from('user_byok_keys')
    .select('key_hint,model,disabled_at,last_error,used_today').eq('user_id', userId).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return { keyHint: data.key_hint, model: data.model, disabled: !!data.disabled_at, lastError: data.last_error, usedToday: data.used_today };
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
  if (!looksLikeGeminiKey(apiKey)) throw new Error('Gemini API 키 형식이 맞지 않아요.');
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

export async function loadJudgeProfile(client: SupabaseClient, userId: string): Promise<JudgeProfile> {
  const { data, error } = await client.from('user_judge_profiles')
    .select('year,semester,enrollment_status,military_service').eq('user_id', userId).maybeSingle();
  if (error) throw error;
  return data ? { year: data.year, semester: data.semester, enrollmentStatus: data.enrollment_status, militaryService: data.military_service } : EMPTY_PROFILE;
}

export async function saveJudgeProfile(client: SupabaseClient, userId: string, profile: JudgeProfile): Promise<void> {
  const inRange = (value: number | null, low: number, high: number) => value === null || (Number.isInteger(value) && value >= low && value <= high);
  if (!inRange(profile.year, 1, 6) || !inRange(profile.semester, 1, 2)) throw new Error('학년과 학기를 확인해 주세요.');
  if (profile.enrollmentStatus !== null && !(ENROLLMENT as readonly string[]).includes(profile.enrollmentStatus)) throw new Error('재학 상태를 확인해 주세요.');
  if (profile.militaryService !== null && !(MILITARY as readonly string[]).includes(profile.militaryService)) throw new Error('병역 상태를 확인해 주세요.');
  const { error } = await client.from('user_judge_profiles').upsert({
    user_id: userId, year: profile.year, semester: profile.semester, enrollment_status: profile.enrollmentStatus,
    military_service: profile.militaryService, updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id' });
  if (error) throw error;
}
