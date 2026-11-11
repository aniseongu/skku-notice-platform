import { FunctionsHttpError, type SupabaseClient } from '@supabase/supabase-js';

/** Groq 본인 키(Gemini 키는 byok.ts가 맡는다)와 AI 사용 설정. 키 원문은 요청 한 번에만 쓰고 저장하지 않는다. */
export type AiProvider = 'groq';
export const AI_PROVIDERS: readonly AiProvider[] = ['groq'];

export interface AiKeyStatus { provider: AiProvider; keyHint: string; model: string; disabled: boolean; lastError: string | null; usedToday: number }
/** 업체와 요금은 사용자가 고르지 않는다. 켜기·끄기만 사용자가 정한다. 무료가 기본이고 유료 모델을 직접 고른 키는 막지 않는다. */
export interface AiPreferences { aiEnabled: boolean }
export const DEFAULT_AI_PREFERENCES: AiPreferences = { aiEnabled: true };

/** 발급 안내. 화면 이름과 한도는 바뀔 수 있어 숫자를 약속하지 않는다. */
export const PROVIDER_GUIDE: Record<AiProvider, { name: string; url: string; blurb: string; steps: string[]; placeholder: string }> = {
  groq: {
    name: 'Groq', url: 'https://console.groq.com/keys', placeholder: '키를 붙여 넣어 주세요',
    blurb: '빠르게 답해요. 무료로 시작할 수 있어요',
    steps: ['Groq 키 만들기 화면을 열고 로그인해요. 처음이면 가입부터 해요',
      '"Create API Key"를 누르고 이름을 아무거나 적어요 (예: 성공)',
      '만들어진 키를 복사해요. 키는 이때 한 번만 보여요',
      '여기로 돌아와 키를 붙여 넣고 "연결하기"를 눌러요'],
  },
};

export function looksLikeAiKey(value: string): boolean {
  return value.length >= 8 && value.length <= 512 && !/[\s\u0000-\u001f\u007f]/.test(value);
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

/** 암호문 열은 읽지 않는다. 표가 없는 환경이면 빈 목록이다. */
export async function loadAiKeyStatuses(client: SupabaseClient, userId: string): Promise<AiKeyStatus[]> {
  const { data, error } = await client.from('user_ai_keys').select('provider,key_hint,model,disabled_at,last_error,used_today').eq('user_id', userId);
  if (error) return [];
  return (data ?? []).flatMap((row) => (row.provider === 'groq'
    ? [{ provider: row.provider as AiProvider, keyHint: String(row.key_hint), model: String(row.model), disabled: !!row.disabled_at,
      lastError: typeof row.last_error === 'string' ? row.last_error : null, usedToday: Number(row.used_today) || 0 }] : []));
}

export async function registerAiKey(client: SupabaseClient, provider: AiProvider, apiKey: string, model?: string): Promise<void> {
  if (!looksLikeAiKey(apiKey)) throw new Error('키를 끝까지 복사해 공백 없이 붙여 넣어 주세요.');
  const { error } = await client.functions.invoke('byok', { method: 'POST', body: { provider, apiKey, ...(model ? { model } : {}) } });
  if (error) throw await failure(error, '키를 저장하지 못했어요. 잠시 뒤 다시 시도해 주세요.');
}

export async function removeAiKey(client: SupabaseClient, provider: AiProvider): Promise<void> {
  const { error } = await client.functions.invoke(`byok?provider=${provider}`, { method: 'DELETE' });
  if (error) throw await failure(error, '키를 지우지 못했어요. 잠시 뒤 다시 시도해 주세요.');
}

export async function loadAiPreferences(client: SupabaseClient, userId: string): Promise<AiPreferences> {
  const { data, error } = await client.from('user_ai_preferences').select('ai_enabled').eq('user_id', userId).maybeSingle();
  if (error || !data) return DEFAULT_AI_PREFERENCES;
  return { aiEnabled: data.ai_enabled !== false };
}

/** 설정 행으로 바꾼다. 업체 선택은 항상 자동이다. */
export function preferencesRow(userId: string, prefs: AiPreferences, now = new Date().toISOString()) {
  return { user_id: userId, ai_enabled: prefs.aiEnabled, routing_mode: 'auto', manual_provider: null, updated_at: now };
}

export async function saveAiPreferences(client: SupabaseClient, userId: string, prefs: AiPreferences): Promise<void> {
  const { error } = await client.from('user_ai_preferences').upsert(preferencesRow(userId, prefs), { onConflict: 'user_id' });
  if (error) throw new Error('AI 설정을 저장하지 못했어요. 잠시 뒤 다시 시도해 주세요.');
}

/** 키 개수에 따른 한 줄 상태. 키가 없어도 기본 분석은 계속 쓰는 상태다. */
export function aiModeLabel(connected: number, prefs: AiPreferences): string {
  if (!prefs.aiEnabled) return 'AI 꺼짐 · 기본 방식으로 분석 중';
  if (connected === 0) return 'AI 미연결 · 기본 방식으로 분석 중';
  return connected > 1 ? `AI ${connected}곳 연결 · 알아서 골라 써요` : 'AI 1곳 연결';
}
