import type { SupabaseClient } from '@supabase/supabase-js';

export function parseKeywords(input: string): string[] {
  const values = [...new Set(input.split(/[\n,]+/).map((word) => word.trim()).filter(Boolean))];
  if (values.length > 20 || values.some((word) => word.length > 80) || new TextEncoder().encode(values.join(',')).length > 2000) {
    throw new Error('키워드는 20개 이하, 각 80자 이하로 입력해 주세요.');
  }
  return values;
}

export async function loadKeywordsPreference(client: SupabaseClient, userId: string): Promise<string[] | null> {
  const { data, error } = await client.from('user_preferences').select('keywords').eq('user_id', userId).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  if (!Array.isArray(data.keywords) || !data.keywords.every((word: unknown) => typeof word === 'string')) throw new Error('Invalid preferences');
  return data.keywords;
}

export async function saveKeywordsPreference(client: SupabaseClient, userId: string, keywords: string[]): Promise<void> {
  const { error } = await client.from('user_preferences').upsert({ user_id: userId, keywords }, { onConflict: 'user_id' });
  if (error) throw error;
}
