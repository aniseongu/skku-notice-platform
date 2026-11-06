import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// Vite 환경 변수는 브라우저에 공개된다. secret/service-role 키는 허용하지 않는다.
export function createAuthClient(url: string | undefined, key: string | undefined): SupabaseClient | null {
  if (!url || !key || !key.startsWith('sb_publishable_')) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(parsed.hostname))) return null;
    return createClient(url, key, { auth: { flowType: 'pkce' } });
  } catch { return null; }
}

export const authClient = createAuthClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY);
