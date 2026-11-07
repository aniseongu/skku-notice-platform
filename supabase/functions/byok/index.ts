// Supabase Edge Function `byok`: 로그인한 사용자의 Gemini 키를 검증하고 암호화해 저장하거나 삭제한다.
// 필요한 비밀: BYOK_MASTER_KEY(32바이트 base64url). SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY는 플랫폼이 넣는다.
// 배포 시 JWT 검증을 켠 상태(기본값)로 둔다.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { importMasterKey } from './crypto.ts';
import { handle } from './handler.ts';

const url = Deno.env.get('SUPABASE_URL')!;
const anon = Deno.env.get('SUPABASE_ANON_KEY')!;
const service = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
const masterKey = await importMasterKey(Deno.env.get('BYOK_MASTER_KEY') ?? '');

Deno.serve((req) => handle(req, {
  masterKey,
  async userFromAuthorization(authorization) {
    if (!authorization?.startsWith('Bearer ')) return null;
    const client = createClient(url, anon, { global: { headers: { Authorization: authorization } }, auth: { persistSession: false } });
    const { data, error } = await client.auth.getUser();
    return error ? null : data.user?.id ?? null;
  },
  async verifyGeminiKey(apiKey) {
    try {
      const response = await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=1', {
        headers: { 'x-goog-api-key': apiKey }, signal: AbortSignal.timeout(8000), redirect: 'error',
      });
      if (response.ok) return 'valid';
      return [400, 401, 403].includes(response.status) ? 'invalid' : 'unavailable';
    } catch { return 'unavailable'; }
  },
  async saveKey(row) {
    const { error } = await service.from('user_byok_keys').upsert({
      ...row, disabled_at: null, last_error: null, error_at: null, updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id' });
    if (error) throw error;
  },
  async deleteKey(userId) {
    const { error } = await service.from('user_byok_keys').delete().eq('user_id', userId);
    if (error) throw error;
  },
}));
