// 알림을 받으면 서비스 워커(public/push-handler.js)가 그 공지를 get_public_notice로 미리 받아 IndexedDB에 둔다.
// 알림을 눌러 앱이 열리면 서버를 기다리지 않고 이 사본으로 상세를 바로 그린다. 공개 함수가 주는 내용과 같은 것만 저장한다.
import { get, set } from 'idb-keyval';
import { isNoticeId, publicRowToNotice, type PublicNotice } from './deeplink';

export const PREFETCH_KEY = 'notice-prefetch:v1';
export const CONFIG_KEY = 'sw-public-config:v1';
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

/** 서비스 워커가 공개 함수를 부를 수 있게 공개 주소와 공개 키를 기기에 적어 둔다(번들에 이미 있는 값). */
export function saveWorkerConfig(url: string | undefined, key: string | undefined): void {
  if (url && key) void set(CONFIG_KEY, { url, key }).catch(() => undefined);
}

export async function loadPrefetchedNotice(id: string, now = Date.now()): Promise<PublicNotice | null> {
  if (!isNoticeId(id)) return null;
  try {
    const record = await get(PREFETCH_KEY) as { items?: Record<string, { at: number; row: unknown }> } | undefined;
    const hit = record?.items?.[id];
    if (!hit || now - hit.at > MAX_AGE_MS || !hit.row || typeof hit.row !== 'object') return null;
    return publicRowToNotice(hit.row as Parameters<typeof publicRowToNotice>[0]);
  } catch { return null; }
}
