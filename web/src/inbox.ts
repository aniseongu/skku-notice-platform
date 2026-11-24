// 알림함: 서비스 워커(public/push-handler.js)가 푸시를 받을 때 이 기기의 IndexedDB에 쌓고, 앱이 읽는다. 서버에는 아무것도 없다.
// 계정 분리: 워커는 받은 푸시의 수신자 해시와 구독 주소를 현재 소유자와 비교한다.
// 소유자가 바뀌면 남의 항목은 지운다. 설계는 docs/design/2026-11-20_notification-inbox.md.
import { get, update } from 'idb-keyval';
import { isAiBootcampArticle } from './aibootcamp-url.ts';
import { isNoticeId } from './deeplink.ts';

export const INBOX_KEY = 'inbox:v1';
export const INBOX_MAX_ITEMS = 200;
export const INBOX_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
export const GENERIC_TAG = 'skku-notice';

export interface InboxItem { id: string; owner: string; tag: string; title: string; body: string; noticeId: string | null; url: string; at: number; read: boolean }
/** 소유자: 이 기기에 로그인한 사용자와, 그 계정으로 서버에 등록한 이 기기 푸시 구독의 주소. 주소가 null이면(등록 전·해제 뒤·계정 전환 중) 워커는 저장하지 않는다. */
export interface InboxOwner { userId: string; endpoint: string | null; recipientHash?: string }
// 소유자와 항목은 한 레코드에 둔다. 소유자를 바꾸면서 남의 항목을 지우는 일이 한 트랜잭션이라 사이에 푸시가 끼어들지 못한다.
interface InboxRecord { version: 1; owner: InboxOwner | null; items: InboxItem[] }
export interface InboxStore {
  get(key: string): Promise<unknown>;
  update(key: string, updater: (old: unknown) => unknown): Promise<void>;
}
const defaultStore: InboxStore = { get: (key) => get(key), update: (key, updater) => update(key, updater as (old: unknown) => unknown) };
type InboxWriteOptions = { store?: InboxStore; isCurrent?: () => boolean };
const alwaysCurrent = () => true;

async function inboxRecipientHash(userId: string): Promise<string> {
  const bytes = new TextEncoder().encode(`skku-inbox:${userId}`);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest, 0, 8), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function isItem(value: unknown): value is InboxItem {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return typeof v.id === 'string' && typeof v.owner === 'string' && typeof v.tag === 'string' && typeof v.title === 'string' && typeof v.body === 'string'
    && (v.noticeId === null || typeof v.noticeId === 'string') && typeof v.url === 'string' && typeof v.at === 'number' && typeof v.read === 'boolean';
}
function parse(value: unknown): InboxRecord {
  const raw = value as Partial<InboxRecord> | undefined;
  if (!raw || raw.version !== 1) return { version: 1, owner: null, items: [] };
  const owner = raw.owner && typeof raw.owner.userId === 'string' && raw.owner.userId && (raw.owner.endpoint === null || typeof raw.owner.endpoint === 'string')
    ? { userId: raw.owner.userId, endpoint: raw.owner.endpoint,
        ...(typeof raw.owner.recipientHash === 'string' ? { recipientHash: raw.owner.recipientHash } : {}) } : null;
  return { version: 1, owner, items: Array.isArray(raw.items) ? raw.items.filter(isItem) : [] };
}
const itemsOf = (value: unknown) => parse(value).items;

/** 30일이 지난 것을 지우고 새 순으로 200건만 남긴다(서비스 워커의 pruneInbox와 같은 규칙). */
export function pruneInbox(items: InboxItem[], now: number): InboxItem[] {
  return items.filter((item) => now - item.at <= INBOX_MAX_AGE_MS).sort((a, b) => b.at - a.at).slice(0, INBOX_MAX_ITEMS);
}

/** 이 사용자의 항목만, 새 순으로. */
export function visibleInbox(items: InboxItem[], owner: string | null): InboxItem[] {
  return owner ? items.filter((item) => item.owner === owner).sort((a, b) => b.at - a.at) : [];
}
export const unreadCount = (items: InboxItem[]) => items.filter((item) => !item.read).length;

// 다른 탭에도 바뀜을 알린다(서비스 워커의 알림은 postMessage로 따로 온다). BroadcastChannel이 없으면 다음 복귀 때 읽는다.
const CHANNEL = 'skku-inbox';
export function notifyInboxChanged(): void {
  try { const channel = new BroadcastChannel(CHANNEL); channel.postMessage({ type: 'inbox-changed' }); channel.close(); } catch { /* 없으면 건너뛴다 */ }
}
export function listenInboxChanged(onChange: () => void): () => void {
  try {
    const channel = new BroadcastChannel(CHANNEL);
    channel.onmessage = () => onChange();
    return () => channel.close();
  } catch { return () => undefined; }
}

/**
 * 주소를 생략하면 로그인 사용자를 소유자로 적고 남의 항목을 지운다.
 * 주소를 넘긴 기기 확인·등록은 같은 소유자의 주소와 해시만 갱신한다.
 */
export async function setInboxOwner(userId: string, endpoint?: string | null,
  { store = defaultStore, isCurrent = alwaysCurrent, now = Date.now() }: InboxWriteOptions & { now?: number } = {}): Promise<boolean> {
  try {
    if (!isCurrent()) return false;
    const hash = endpoint ? await inboxRecipientHash(userId) : undefined;
    let changed = false;
    await store.update(INBOX_KEY, (old) => {
      if (!isCurrent()) return old;
      const current = parse(old);
      const sameOwner = current.owner?.userId === userId ? current.owner : null;
      if (endpoint !== undefined && !sameOwner) return old;
      const recipientHash = hash ?? sameOwner?.recipientHash;
      const owner = { userId, endpoint: endpoint === undefined ? sameOwner?.endpoint ?? null : endpoint,
        ...(recipientHash !== undefined ? { recipientHash } : {}) };
      changed = true;
      const items = endpoint === undefined ? pruneInbox(current.items.filter((item) => item.owner === userId), now) : current.items;
      return { version: 1, owner, items } satisfies InboxRecord;
    });
    if (changed) notifyInboxChanged();
    return changed;
  } catch { return false; }
}

/**
 * 이 사용자의 보관분을 지운다(로그아웃·계정 삭제). 소유자가 다른 사용자로 이미 바뀌었으면 그 사용자의 것은 건드리지 않는다.
 * 늦게 도착한 이전 로그아웃 정리가 새 계정의 알림을 지우지 않게 한다. 소유자가 이 사용자였다면 비운다(이후 알림은 저장하지 않는다).
 */
export async function releaseInbox(userId: string, { store = defaultStore, isCurrent = alwaysCurrent }: InboxWriteOptions = {}): Promise<boolean> {
  try {
    await store.update(INBOX_KEY, (old) => {
      if (!isCurrent()) return old;
      const current = parse(old);
      return { version: 1, owner: current.owner?.userId === userId ? null : current.owner, items: current.items.filter((item) => item.owner !== userId) } satisfies InboxRecord;
    });
    notifyInboxChanged();
    return true;
  } catch { return false; }
}

/** 로그인한 사용자가 없을 때(앱을 처음 열었는데 로그아웃 상태): 모두 지우고 소유자를 비운다. */
export async function clearInbox({ store = defaultStore, isCurrent = alwaysCurrent }: InboxWriteOptions = {}): Promise<boolean> {
  try {
    await store.update(INBOX_KEY, (old) => isCurrent() ? ({ version: 1, owner: null, items: [] } satisfies InboxRecord) : old);
    notifyInboxChanged();
    return true;
  } catch { return false; }
}

export async function loadInbox(owner: string | null, store: InboxStore = defaultStore, now = Date.now()): Promise<InboxItem[]> {
  if (!owner) return [];
  try {
    return visibleInbox(pruneInbox(itemsOf(await store.get(INBOX_KEY)), now), owner);
  } catch { return []; }
}

/** 정리한 목록을 되써서 만료된 것을 실제로 비운다(앱을 열거나 다시 보일 때). 소유자는 그대로 둔다. */
export async function pruneStoredInbox(store: InboxStore = defaultStore, now = Date.now()): Promise<void> {
  try { await store.update(INBOX_KEY, (old) => { const current = parse(old); return { ...current, items: pruneInbox(current.items, now) } satisfies InboxRecord; }); } catch { /* 위와 같다 */ }
}

export type InboxChange = { kind: 'read'; ids: string[] } | { kind: 'read-all' } | { kind: 'remove'; ids: string[] } | { kind: 'clear' };
/** 이 사용자의 항목만 바꾼다. 다른 소유자의 항목은 건드리지 않는다. 바뀌면 다른 탭에도 알린다. */
export async function changeInbox(owner: string, change: InboxChange, store: InboxStore = defaultStore): Promise<boolean> {
  try {
    await store.update(INBOX_KEY, (old) => {
      const current = parse(old);
      return { ...current, items: current.items.flatMap((item): InboxItem[] => {
        if (item.owner !== owner) return [item];
        switch (change.kind) {
          case 'read': return [change.ids.includes(item.id) ? { ...item, read: true } : item];
          case 'read-all': return [{ ...item, read: true }];
          case 'remove': return change.ids.includes(item.id) ? [] : [item];
          case 'clear': return [];
        }
      }) } satisfies InboxRecord;
    });
    notifyInboxChanged();
    return true;
  } catch { return false; }
}

/** 알림함 항목의 원문 주소를 수신 때(push-handler.js)와 같은 규칙으로 다시 확인한다. */
export function safeInboxUrl(value: string, appOrigin: string): string | null {
  try {
    const url = new URL(value);
    const internship = (url.hostname === 'linkareer.com' && /^\/activity\/\d+\/?$/.test(url.pathname)) || (url.hostname === 'jasoseol.com' && /^\/recruit\/\d+\/?$/.test(url.pathname));
    const allowed = url.origin === appOrigin || url.hostname === 'skku.edu' || url.hostname.endsWith('.skku.edu') || internship || isAiBootcampArticle(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.port && allowed ? url.href : null;
  } catch { return null; }
}

/** "3분 전", "어제", "11월 18일" 같은 짧은 시각. */
export function inboxTime(at: number, now = Date.now()): string {
  const minutes = Math.floor((now - at) / 60000);
  if (minutes < 1) return '방금 전';
  if (minutes < 60) return `${minutes}분 전`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}시간 전`;
  const days = Math.floor(hours / 24);
  if (days === 1) return '어제';
  if (days < 7) return `${days}일 전`;
  const date = new Date(at);
  return `${date.getMonth() + 1}월 ${date.getDate()}일`;
}

export const noticeIdOfItem = (item: Pick<InboxItem, 'noticeId'>): string | null => isNoticeId(item.noticeId) ? item.noticeId : null;
