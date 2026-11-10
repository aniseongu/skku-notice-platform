// AES-256-GCM. 저장 형식: base64url(iv(12) || ciphertext || tag(16)), AAD = 사용자 ID.
// AAD 덕분에 다른 사용자 행으로 옮긴 암호문은 복호화되지 않는다. Python 워커도 같은 형식으로 복호화한다.
const enc = new TextEncoder();
const dec = new TextDecoder();

export function b64urlEncode(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function b64urlDecode(value: string): Uint8Array<ArrayBuffer> {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4);
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
}

export async function importMasterKey(masterKey: string): Promise<CryptoKey> {
  const raw = b64urlDecode(masterKey);
  if (raw.length !== 32) throw new Error('BYOK master key must be 32 bytes');
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

export async function encryptApiKey(key: CryptoKey, userId: string, plaintext: string, iv: Uint8Array<ArrayBuffer> = crypto.getRandomValues(new Uint8Array(12))): Promise<string> {
  const body = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: enc.encode(userId) }, key, enc.encode(plaintext)));
  const out = new Uint8Array(iv.length + body.length);
  out.set(iv); out.set(body, iv.length);
  return b64urlEncode(out);
}

export async function decryptApiKey(key: CryptoKey, userId: string, stored: string): Promise<string> {
  const raw = b64urlDecode(stored);
  if (raw.length < 12 + 16 + 1) throw new Error('invalid ciphertext');
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: raw.slice(0, 12), additionalData: enc.encode(userId) }, key, raw.slice(12));
  return dec.decode(plain);
}

/** Gemini 키는 형식을 미리 정하지 않는다(AIza, AQ., gen-lang-client 등 계속 바뀐다). 복사 실수(공백·줄바꿈·너무 짧음)만 걸러 내고 유효성은 저장할 때 Gemini 호출로 확인한다. */
export function looksLikeGeminiKey(value: unknown): value is string {
  return typeof value === 'string' && value.length >= 8 && value.length <= 512 && !/[\s\u0000-\u001f\u007f]/.test(value);
}
