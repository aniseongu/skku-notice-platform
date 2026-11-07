// AES-256-GCM. 저장 형식: base64url(iv(12) || ciphertext || tag(16)), AAD = 사용자 ID.
// AAD 덕분에 다른 사용자 행으로 옮긴 암호문은 복호화되지 않는다. Python 워커도 같은 형식으로 복호화한다.
const enc = new TextEncoder();
const dec = new TextDecoder();

export function b64urlEncode(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function b64urlDecode(value: string): Uint8Array {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4);
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
}

export async function importMasterKey(masterKey: string): Promise<CryptoKey> {
  const raw = b64urlDecode(masterKey);
  if (raw.length !== 32) throw new Error('BYOK master key must be 32 bytes');
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

export async function encryptApiKey(key: CryptoKey, userId: string, plaintext: string, iv = crypto.getRandomValues(new Uint8Array(12))): Promise<string> {
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

/** Gemini API 키 형식. 형식이 맞아도 실제 유효성은 별도 호출로 확인한다. */
export function looksLikeGeminiKey(value: unknown): value is string {
  return typeof value === 'string' && /^AIza[0-9A-Za-z_-]{35}$/.test(value);
}
