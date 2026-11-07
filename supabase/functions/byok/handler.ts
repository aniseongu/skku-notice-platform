import { encryptApiKey, looksLikeGeminiKey } from './crypto.ts';

export const ALLOWED_ORIGINS = ['https://skku-notice-platform.pages.dev', 'http://localhost:5173', 'http://127.0.0.1:5173'];
const MODEL_PATTERN = /^[a-z0-9.-]{3,60}$/;
export const DEFAULT_MODEL = 'gemini-3.1-flash-lite';
const MAX_BODY_BYTES = 2048;

export interface ByokDeps {
  masterKey: CryptoKey;
  /** Returns the user id of a verified session token, or null. */
  userFromAuthorization: (authorization: string | null) => Promise<string | null>;
  /** Checks the key against Gemini without storing or logging it. */
  verifyGeminiKey: (apiKey: string) => Promise<'valid' | 'invalid' | 'unavailable'>;
  saveKey: (row: { user_id: string; ciphertext: string; key_hint: string; model: string }) => Promise<void>;
  deleteKey: (userId: string) => Promise<void>;
}

function headers(origin: string | null): Headers {
  const h = new Headers({ 'Content-Type': 'application/json', 'Cache-Control': 'no-store', Vary: 'Origin' });
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    h.set('Access-Control-Allow-Origin', origin);
    h.set('Access-Control-Allow-Headers', 'authorization, content-type, apikey, x-client-info');
    h.set('Access-Control-Allow-Methods', 'POST, DELETE, OPTIONS');
  }
  return h;
}

const reply = (status: number, origin: string | null, body: Record<string, unknown> = {}) =>
  new Response(status === 204 ? null : JSON.stringify(body), { status, headers: headers(origin) });

// 키와 암호문은 응답·로그에 넣지 않는다. 오류 메시지는 사용자에게 보일 고정 문구만 쓴다.
export async function handle(req: Request, deps: ByokDeps): Promise<Response> {
  const origin = req.headers.get('Origin');
  if (req.method === 'OPTIONS') return reply(204, origin);
  if (origin && !ALLOWED_ORIGINS.includes(origin)) return reply(403, origin, { error: '허용되지 않은 주소예요.' });
  if (req.method !== 'POST' && req.method !== 'DELETE') return reply(405, origin, { error: '지원하지 않는 요청이에요.' });
  const userId = await deps.userFromAuthorization(req.headers.get('Authorization')).catch(() => null);
  if (!userId) return reply(401, origin, { error: '로그인이 필요해요.' });
  try {
    if (req.method === 'DELETE') {
      await deps.deleteKey(userId);
      return reply(200, origin, { ok: true });
    }
    const text = await req.text();
    if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) return reply(413, origin, { error: '요청이 너무 커요.' });
    let body: { apiKey?: unknown; model?: unknown };
    try { body = JSON.parse(text); } catch { return reply(400, origin, { error: '요청 형식을 확인해 주세요.' }); }
    if (!looksLikeGeminiKey(body.apiKey)) return reply(400, origin, { error: 'Gemini API 키 형식이 맞지 않아요.' });
    const model = body.model === undefined ? DEFAULT_MODEL : body.model;
    if (typeof model !== 'string' || !MODEL_PATTERN.test(model)) return reply(400, origin, { error: '모델 이름을 확인해 주세요.' });
    const verdict = await deps.verifyGeminiKey(body.apiKey);
    if (verdict === 'invalid') return reply(400, origin, { error: 'Gemini에서 이 키를 받아 주지 않아요. 키를 확인해 주세요.' });
    if (verdict === 'unavailable') return reply(502, origin, { error: '지금은 키를 확인할 수 없어요. 잠시 뒤 다시 시도해 주세요.' });
    const ciphertext = await encryptApiKey(deps.masterKey, userId, body.apiKey);
    const keyHint = body.apiKey.slice(-4);
    await deps.saveKey({ user_id: userId, ciphertext, key_hint: keyHint, model });
    return reply(200, origin, { ok: true, keyHint, model });
  } catch {
    return reply(500, origin, { error: '저장하지 못했어요. 잠시 뒤 다시 시도해 주세요.' });
  }
}
