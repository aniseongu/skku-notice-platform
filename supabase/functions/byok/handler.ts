import { encryptApiKey, looksLikeGeminiKey } from './crypto.ts';

export const ALLOWED_ORIGINS = ['https://skku-notice-platform.pages.dev', 'http://localhost:5173', 'http://127.0.0.1:5173'];
const MODEL_PATTERN = /^[a-z0-9.-]{3,60}$/;
export const DEFAULT_MODEL = 'gemini-3.1-flash-lite';
const MAX_BODY_BYTES = 2048;

export type SummaryFailure = 'no_key' | 'not_found' | 'limit' | 'rejected' | 'busy' | 'error';
export class SummaryError extends Error {
  code: SummaryFailure;
  constructor(code: SummaryFailure) { super(code); this.code = code; }
}
const NOTICE_ID = /^[\w-]{1,60}\/\d{1,12}$/;
const SUMMARY_MESSAGES: Record<SummaryFailure, [number, string]> = {
  no_key: [409, '먼저 설정의 연결 키에서 Gemini 키를 넣어 주세요.'],
  not_found: [404, '이 공지를 찾지 못했어요.'],
  limit: [429, '오늘 쓸 수 있는 요약을 모두 썼어요. 내일 다시 눌러 주세요.'],
  rejected: [400, 'Gemini가 이 키를 받아 주지 않아요. 설정에서 키를 다시 넣어 주세요.'],
  busy: [429, 'Gemini 사용 한도를 넘었어요. 잠시 뒤 다시 눌러 주세요.'],
  error: [502, '지금은 요약을 만들 수 없어요. 잠시 뒤 다시 눌러 주세요.'],
};

export interface ByokDeps {
  /** 사용자의 Gemini 키로 공지 한 건을 요약해 저장하고 요약 글을 돌려준다. 실패는 SummaryError로 알린다. */
  summarize?: (userId: string, noticeId: string) => Promise<string>;
  masterKey: CryptoKey;
  /** Returns the user id of a verified session token, or null. */
  userFromAuthorization: (authorization: string | null) => Promise<string | null>;
  /** Checks the key against Gemini without storing or logging it. */
  verifyGeminiKey: (apiKey: string) => Promise<'valid' | 'invalid' | 'unavailable'>;
  saveKey: (row: { user_id: string; ciphertext: string; key_hint: string; model: string }) => Promise<void>;
  deleteKey: (userId: string) => Promise<void>;
  /** 아이캠퍼스(Canvas) 토큰: 저장 없이 canvas.skku.edu에 확인만 한다. */
  verifyCanvasToken: (token: string) => Promise<'valid' | 'invalid' | 'unavailable'>;
  saveCanvasToken: (row: { user_id: string; ciphertext: string; token_hint: string }) => Promise<void>;
  deleteCanvasToken: (userId: string) => Promise<void>;
}

/** Canvas 개인 액세스 토큰 형식(숫자~영숫자). 형식이 맞아도 실제 유효성은 별도 호출로 확인한다. */
export function looksLikeCanvasToken(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9A-Za-z~_-]{16,200}$/.test(value);
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
      if (new URL(req.url).searchParams.get('provider') === 'canvas') await deps.deleteCanvasToken(userId);
      else await deps.deleteKey(userId);
      return reply(200, origin, { ok: true });
    }
    const text = await req.text();
    if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) return reply(413, origin, { error: '요청이 너무 커요.' });
    let body: { apiKey?: unknown; model?: unknown; provider?: unknown; token?: unknown; action?: unknown; noticeId?: unknown };
    try { body = JSON.parse(text); } catch { return reply(400, origin, { error: '요청 형식을 확인해 주세요.' }); }
    if (body.action === 'summarize') {
      if (!deps.summarize || typeof body.noticeId !== 'string' || !NOTICE_ID.test(body.noticeId)) return reply(400, origin, { error: '요청 형식을 확인해 주세요.' });
      try { return reply(200, origin, { ok: true, summary: await deps.summarize(userId, body.noticeId) }); }
      catch (error) {
        const [status, message] = SUMMARY_MESSAGES[error instanceof SummaryError ? error.code : 'error'];
        return reply(status, origin, { error: message });
      }
    }
    if (body.provider === 'canvas') {
      if (!looksLikeCanvasToken(body.token)) return reply(400, origin, { error: '아이캠퍼스 토큰 형식이 맞지 않아요.' });
      const result = await deps.verifyCanvasToken(body.token);
      if (result === 'invalid') return reply(400, origin, { error: '아이캠퍼스에서 이 토큰을 받아 주지 않아요. 토큰을 확인해 주세요.' });
      if (result === 'unavailable') return reply(502, origin, { error: '지금은 토큰을 확인할 수 없어요. 잠시 뒤 다시 시도해 주세요.' });
      // 암호문은 "<사용자 ID>:canvas"에 묶어서 Gemini 키 표나 다른 사용자 행으로 옮겨도 열리지 않게 한다.
      const ciphertext = await encryptApiKey(deps.masterKey, `${userId}:canvas`, body.token);
      const tokenHint = body.token.slice(-4);
      await deps.saveCanvasToken({ user_id: userId, ciphertext, token_hint: tokenHint });
      return reply(200, origin, { ok: true, keyHint: tokenHint });
    }
    if (!looksLikeGeminiKey(body.apiKey)) return reply(400, origin, { error: 'Gemini API 키 형식이 맞지 않아요.' });
    const model = body.model === undefined ? DEFAULT_MODEL : body.model;
    if (typeof model !== 'string' || !MODEL_PATTERN.test(model)) return reply(400, origin, { error: '모델 이름을 확인해 주세요.' });
    const verdict = await deps.verifyGeminiKey(body.apiKey);
    if (verdict === 'invalid') return reply(400, origin, { error: 'Gemini에서 이 키를 받아 주지 않아요. 키를 확인해 주세요.' });
    if (verdict === 'unavailable') return reply(502, origin, { error: '지금은 키를 확인할 수 없어요. 잠시 뒤 다시 시도해 주세요.' });
    const ciphertext = await encryptApiKey(deps.masterKey, userId, body.apiKey);
    const keyHint = body.apiKey.slice(-4).replace(/[^A-Za-z0-9_-]/g, '_'); // 표시용 끝 4글자(점은 표 제약에 맞게 바꾼다)
    await deps.saveKey({ user_id: userId, ciphertext, key_hint: keyHint, model });
    return reply(200, origin, { ok: true, keyHint, model });
  } catch {
    return reply(500, origin, { error: '저장하지 못했어요. 잠시 뒤 다시 시도해 주세요.' });
  }
}
