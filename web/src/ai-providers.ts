import { FunctionsHttpError, type SupabaseClient } from '@supabase/supabase-js';

/** Groq·OpenRouter 본인 키(Gemini 키는 byok.ts가 맡는다)와 AI 사용 설정. 키 원문은 요청 한 번에만 쓰고 저장하지 않는다. */
export type AiProvider = 'groq' | 'openrouter';
export const AI_PROVIDERS: readonly AiProvider[] = ['groq', 'openrouter'];

export interface AiKeyStatus { provider: AiProvider; keyHint: string; model: string; disabled: boolean; lastError: string | null; usedToday: number }
export interface AiPreferences {
  aiEnabled: boolean;
  routingMode: 'manual' | 'auto';
  autoRoutingConsent: boolean;
  manualProvider: 'gemini' | AiProvider | null;
  freeOnly: boolean;
  paidOptIn: boolean;
}
export const DEFAULT_AI_PREFERENCES: AiPreferences = {
  aiEnabled: true, routingMode: 'manual', autoRoutingConsent: false, manualProvider: null, freeOnly: true, paidOptIn: false,
};

/** 발급 안내. 화면 이름과 한도는 바뀔 수 있어 숫자를 약속하지 않는다. */
export const PROVIDER_GUIDE: Record<AiProvider, { name: string; url: string; blurb: string; steps: string[]; placeholder: string }> = {
  groq: {
    name: 'Groq', url: 'https://console.groq.com/keys', placeholder: 'GroqCloud에서 만든 키',
    blurb: '빠르게 답해요. 무료로 시작할 수 있지만 한도는 계정마다 달라요',
    steps: ['GroqCloud의 API 키 화면을 열고 로그인해요', '"Create API Key"를 눌러 내 키를 만들어요',
      '만들어진 키를 붙여 넣고 "저장하기"를 눌러요. 저장하면 Groq에 확인한 뒤 암호화해 서버에만 보관해요',
      '무료 한도와 요금은 Groq 콘솔에서 확인해요. 성공은 무료 모델만 써요'],
  },
  openrouter: {
    name: 'OpenRouter', url: 'https://openrouter.ai/settings/keys', placeholder: 'OpenRouter에서 만든 키',
    blurb: '한 키로 여러 모델을 써요. 처음에는 무료 모델(openrouter/free)로 시작해요',
    steps: ['OpenRouter의 키 화면을 열고 로그인해요', '"Create Key"를 눌러 내 키를 만들어요. 무료·유료 키가 따로 있지 않아요',
      '만들어진 키를 붙여 넣고 "저장하기"를 눌러요. 저장하면 OpenRouter에 확인한 뒤 암호화해 서버에만 보관해요',
      '유료 모델은 성공에서 따로 허용하기 전에는 쓰지 않아요'],
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
  return (data ?? []).flatMap((row) => (row.provider === 'groq' || row.provider === 'openrouter'
    ? [{ provider: row.provider as AiProvider, keyHint: String(row.key_hint), model: String(row.model), disabled: !!row.disabled_at,
      lastError: typeof row.last_error === 'string' ? row.last_error : null, usedToday: Number(row.used_today) || 0 }] : []));
}

export async function registerAiKey(client: SupabaseClient, provider: AiProvider, apiKey: string): Promise<void> {
  if (!looksLikeAiKey(apiKey)) throw new Error('키를 끝까지 복사해 공백 없이 붙여 넣어 주세요.');
  const { error } = await client.functions.invoke('byok', { method: 'POST', body: { provider, apiKey } });
  if (error) throw await failure(error, '키를 저장하지 못했어요. 잠시 뒤 다시 시도해 주세요.');
}

export async function removeAiKey(client: SupabaseClient, provider: AiProvider): Promise<void> {
  const { error } = await client.functions.invoke(`byok?provider=${provider}`, { method: 'DELETE' });
  if (error) throw await failure(error, '키를 지우지 못했어요. 잠시 뒤 다시 시도해 주세요.');
}

export async function loadAiPreferences(client: SupabaseClient, userId: string): Promise<AiPreferences> {
  const { data, error } = await client.from('user_ai_preferences')
    .select('ai_enabled,routing_mode,auto_routing_consent_at,manual_provider,free_only,paid_calls_opt_in_at').eq('user_id', userId).maybeSingle();
  if (error || !data) return DEFAULT_AI_PREFERENCES;
  const manual = data.manual_provider;
  return {
    aiEnabled: data.ai_enabled !== false,
    routingMode: data.routing_mode === 'auto' && data.auto_routing_consent_at ? 'auto' : 'manual',
    autoRoutingConsent: !!data.auto_routing_consent_at,
    manualProvider: manual === 'gemini' || manual === 'groq' || manual === 'openrouter' ? manual : null,
    freeOnly: data.free_only !== false,
    paidOptIn: !!data.paid_calls_opt_in_at,
  };
}

/** 설정 행으로 바꾼다. 자동 선택은 동의 시각이, 유료 허용은 허용 시각이 있어야 DB가 받아 준다. */
export function preferencesRow(userId: string, prefs: AiPreferences, now = new Date().toISOString()) {
  const auto = prefs.routingMode === 'auto';
  return {
    user_id: userId, ai_enabled: prefs.aiEnabled, routing_mode: auto ? 'auto' : 'manual',
    auto_routing_consent_at: auto ? now : null, manual_provider: auto ? null : prefs.manualProvider,
    free_only: !prefs.paidOptIn, paid_calls_opt_in_at: prefs.paidOptIn ? now : null, updated_at: now,
  };
}

export async function saveAiPreferences(client: SupabaseClient, userId: string, prefs: AiPreferences): Promise<void> {
  const { error } = await client.from('user_ai_preferences').upsert(preferencesRow(userId, prefs), { onConflict: 'user_id' });
  if (error) throw new Error('AI 설정을 저장하지 못했어요. 잠시 뒤 다시 시도해 주세요.');
}

/** 키 개수에 따른 한 줄 상태. 키가 없어도 기본 분석은 계속 쓰는 상태다. */
export function aiModeLabel(connected: number, prefs: AiPreferences): string {
  if (!prefs.aiEnabled) return 'AI 꺼짐 · 코드 기반 분석 사용 중';
  if (connected === 0) return 'AI 미연결 · 코드 기반 분석 사용 중';
  if (connected > 1 && prefs.routingMode === 'auto') return `AI ${connected}곳 자동 선택`;
  return connected > 1 ? `AI ${connected}곳 연결 · 직접 선택` : 'AI 1곳 연결';
}
