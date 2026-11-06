// 저장한 키의 이름과 날짜만 기억한다. 키 값과 토큰은 저장하지 않는다.
function metadata(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter(([name, date]) =>
    /^[A-Z][A-Z0-9_]*$/.test(name) && typeof date === 'string' && Number.isFinite(Date.parse(date))));
}

export function readSavedSecrets(repo: string): Record<string, string> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(`saved-secrets:${repo}`) ?? '{}');
    return metadata(parsed);
  } catch { return {}; }
}

export function rememberSavedSecrets(repo: string, saved: Record<string, string>): void {
  try {
    localStorage.setItem(`saved-secrets:${repo}`, JSON.stringify(metadata(saved)));
  } catch { /* 기억하지 못해도 GitHub에 저장한 키는 유지된다 */ }
}

// GitHub 연결 토큰은 이 기기 전용 암호 키(내보낼 수 없는 AES-GCM)로 잠가서 IndexedDB에 둔다.
// 저장된 파일이나 동기화된 브라우저 데이터만으로는 토큰을 읽을 수 없다.
const DB_NAME = 'skku-notice-secure';
const STORE = 'vault';

function openVault(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function vault<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest): Promise<T> {
  return openVault().then((db) => new Promise<T>((resolve, reject) => {
    const request = run(db.transaction(STORE, mode).objectStore(STORE));
    request.onsuccess = () => resolve(request.result as T);
    request.onerror = () => reject(request.error);
  }).finally(() => db.close()));
}

async function deviceKey(): Promise<CryptoKey> {
  const existing = await vault<CryptoKey | undefined>('readonly', (s) => s.get('device-key'));
  if (existing) return existing;
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  await vault('readwrite', (s) => s.put(key, 'device-key'));
  return key;
}

export async function storeToken(token: string): Promise<void> {
  try {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const sealed = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await deviceKey(), new TextEncoder().encode(token));
    await vault('readwrite', (s) => s.put({ iv, sealed }, 'github-token'));
  } catch { /* 기억하지 못하면 다음에 토큰을 한 번 더 넣는다 */ }
}

export async function loadToken(): Promise<string> {
  try {
    const item = await vault<{ iv: Uint8Array<ArrayBuffer>; sealed: ArrayBuffer } | undefined>('readonly', (s) => s.get('github-token'));
    if (!item) return '';
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: item.iv }, await deviceKey(), item.sealed);
    return new TextDecoder().decode(plain);
  } catch { return ''; }
}

export async function forgetToken(): Promise<void> {
  try { await vault('readwrite', (s) => s.delete('github-token')); } catch { /* 이미 없으면 그대로 둔다 */ }
}
