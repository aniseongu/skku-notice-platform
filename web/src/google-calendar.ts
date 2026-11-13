// 저장한 공지의 마감을 사용자의 구글 캘린더에 맞춘다. 원본 gcal.py와 같은 규칙이다
// (마감 30분 전부터 마감까지, "일정"은 시작부터 한 시간, 우리가 만든 일정에만 표시를 달아 그것만 고친다).
// 구글 로그인으로 받은 접근 토큰을 브라우저에서 한 번 쓰고 서버에는 보내지 않는다.
// 범위 calendar.app.created는 이 앱이 만든 보조 캘린더 안의 일정만 다룬다(사용자의 다른 캘린더는 읽지도 쓰지도 못한다).
import type { Notice } from './data';

export const CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.app.created';
export const CALENDAR_NAME = '성대 공지';
const API = 'https://www.googleapis.com/calendar/v3';
const MARK = 'skkuNotice';
const LEAD_MS = 30 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

export class GoogleError extends Error {}

export type CalendarSource = Pick<Notice, 'id' | 'title' | 'url' | 'deadline'> & Partial<Pick<Notice, 'title_ko' | 'deadline_kind'>>;

export interface CalendarEvent {
  summary: string;
  description: string;
  start: { dateTime: string; timeZone: string };
  end: { dateTime: string; timeZone: string };
  source: { title: string; url: string };
  transparency: 'transparent';
  extendedProperties: { private: Record<string, string> };
}

const BASE32HEX = '0123456789abcdefghijklmnopqrstuv';

/** 같은 공지는 늘 같은 일정 id를 받는다(구글은 base32hex 소문자만 받는다). 원본 gcal.py의 _event_id와 같다. */
export async function eventId(noticeId: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(noticeId))).slice(0, 20);
  let bits = 0, value = 0, out = '';
  for (const byte of digest) {
    value = (value << 8) | byte; bits += 8;
    while (bits >= 5) { out += BASE32HEX[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += BASE32HEX[(value << (5 - bits)) & 31];
  return `skku${out}`;
}

/** 앞으로 올 마감이 있는 저장 공지만 일정으로 만든다. 판정이 "맞지 않음"인 공지는 뺀다. */
export async function desiredEvents(
  saved: readonly CalendarSource[], now: Date, notRelevant: ReadonlySet<string> = new Set(),
): Promise<Map<string, CalendarEvent>> {
  const events = new Map<string, CalendarEvent>();
  for (const notice of saved) {
    if (!notice.deadline || !notice.url.startsWith('https://') || notRelevant.has(notice.id)) continue;
    const at = new Date(notice.deadline);
    if (Number.isNaN(at.getTime()) || at <= now) continue;
    const isSchedule = notice.deadline_kind === '일정';
    const start = isSchedule ? at : new Date(at.getTime() - LEAD_MS);
    const end = isSchedule ? new Date(at.getTime() + HOUR_MS) : at;
    events.set(await eventId(notice.id), {
      summary: (notice.title_ko || notice.title).slice(0, 250),
      description: `${notice.url}\n성공이 넣은 일정이에요.`,
      start: { dateTime: start.toISOString(), timeZone: 'Asia/Seoul' },
      end: { dateTime: end.toISOString(), timeZone: 'Asia/Seoul' },
      source: { title: '원문', url: notice.url },
      transparency: 'transparent',
      extendedProperties: { private: { [MARK]: notice.id } },
    });
  }
  return events;
}

type Fetcher = typeof fetch;

async function call(fetcher: Fetcher, token: string, path: string, init: RequestInit = {}): Promise<Response> {
  const response = await fetcher(`${API}${path}`, {
    ...init, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...init.headers },
  });
  if (response.status === 401) throw new GoogleError('구글 연결이 만료됐어요. 다시 연결해 주세요');
  if (response.status === 403) throw new GoogleError('구글이 이 일을 허용하지 않았어요. 캘린더 권한을 허용하고 다시 연결해 주세요');
  return response;
}

const fail = (what: string, response: Response) => new GoogleError(`${what}하지 못했어요(구글 오류 ${response.status}). 잠시 뒤 다시 눌러 주세요`);

/** 이미 만든 캘린더가 있으면 그것을 쓰고, 없거나 지워졌으면 새로 만든다. 연결 오류를 삭제로 오인하지 않는다. */
export async function ensureCalendar(token: string, calendarId: string | null, fetcher: Fetcher = fetch): Promise<string> {
  if (calendarId) {
    const found = await call(fetcher, token, `/calendars/${encodeURIComponent(calendarId)}`);
    if (found.ok) return calendarId;
    if (found.status !== 404 && found.status !== 410) throw fail('캘린더를 확인', found);
  }
  const created = await call(fetcher, token, '/calendars', { method: 'POST', body: JSON.stringify({ summary: CALENDAR_NAME, timeZone: 'Asia/Seoul' }) });
  if (!created.ok) throw fail('캘린더를 만들지', created);
  const id = ((await created.json()) as { id?: unknown }).id;
  if (typeof id !== 'string' || !id) throw new GoogleError('캘린더를 만들었는데 확인하지 못했어요. 구글 캘린더를 확인해 주세요');
  return id;
}

interface RemoteEvent { id: string; summary?: string; description?: string; end?: { dateTime?: string }; extendedProperties?: { private?: Record<string, string> } }

/** 우리가 만든 일정(표시가 있는 것)만 넣고, 고치고, 지운다. */
export async function syncCalendar(
  token: string, calendarId: string, desired: ReadonlyMap<string, CalendarEvent>, fetcher: Fetcher = fetch,
): Promise<{ added: number; changed: number; removed: number }> {
  const base = `/calendars/${encodeURIComponent(calendarId)}/events`;
  const existing = new Map<string, RemoteEvent>();
  let page = '';
  do {
    const response = await call(fetcher, token, `${base}?maxResults=250${page ? `&pageToken=${encodeURIComponent(page)}` : ''}`);
    if (!response.ok) throw fail('일정 목록을 읽지', response);
    const body = await response.json() as { items?: RemoteEvent[]; nextPageToken?: string };
    for (const event of body.items ?? []) if (event.extendedProperties?.private?.[MARK]) existing.set(event.id, event);
    page = body.nextPageToken ?? '';
  } while (page);
  let added = 0, changed = 0, removed = 0;
  for (const [id, event] of desired) {
    const old = existing.get(id);
    if (!old) {
      const response = await call(fetcher, token, base, { method: 'POST', body: JSON.stringify({ id, ...event }) });
      if (response.status === 409) {
        const restored = await call(fetcher, token, `${base}/${id}`, { method: 'PUT', body: JSON.stringify({ ...event, status: 'confirmed' }) });
        if (!restored.ok) throw fail('일정을 되살리지', restored);
      } else if (!response.ok) throw fail('일정을 넣지', response);
      added++;
    } else if (old.summary !== event.summary || old.description !== event.description
      || new Date(old.end?.dateTime ?? 0).getTime() !== new Date(event.end.dateTime).getTime()) {
      const response = await call(fetcher, token, `${base}/${id}`, { method: 'PUT', body: JSON.stringify(event) });
      if (!response.ok) throw fail('일정을 고치지', response);
      changed++;
    }
  }
  for (const id of existing.keys()) {
    if (desired.has(id)) continue;
    const response = await call(fetcher, token, `${base}/${id}`, { method: 'DELETE' });
    if (!response.ok && response.status !== 404 && response.status !== 410) throw fail('일정을 지우지', response);
    removed++;
  }
  return { added, changed, removed };
}

// ----- 연결하러 구글에 다녀오는 동안의 표시 -----
// 휴대폰에서는 구글 허용 화면이 다른 탭이나 다른 창(설치한 앱 -> 브라우저 등)에서 열려, 돌아온 곳의 sessionStorage가 비어 있을 수 있다.
// 그래서 같은 출처에서 공유되는 localStorage에 시각과 함께 두고, 10분이 지나면 버린다.
export const PENDING_KEY = 'google-calendar-pending';
const PENDING_TTL_MS = 10 * 60 * 1000;
type KV = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export function markCalendarPending(stores: KV[], now = Date.now()): void {
  for (const store of stores) { try { store.setItem(PENDING_KEY, String(now)); } catch { /* 저장소를 못 쓰는 환경 */ } }
}

/** 표시가 있으면 지우고 true. 예전 형식('1')이나 시각이 없는 표시는 이 탭(sessionStorage)에서만 믿는다. */
export function takeCalendarPending(stores: KV[], now = Date.now()): boolean {
  let found = false;
  for (const store of stores) {
    try {
      const raw = store.getItem(PENDING_KEY);
      store.removeItem(PENDING_KEY);
      if (raw === null) continue;
      const at = Number(raw);
      if (raw === '1' || (Number.isFinite(at) && now - at >= 0 && now - at < PENDING_TTL_MS)) found = true;
    } catch { /* 읽지 못하면 없는 것으로 본다 */ }
  }
  return found;
}

export function hasCalendarPending(stores: KV[], now = Date.now()): boolean {
  for (const store of stores) {
    try {
      const raw = store.getItem(PENDING_KEY);
      const at = Number(raw);
      if (raw === '1' || (raw !== null && Number.isFinite(at) && now - at >= 0 && now - at < PENDING_TTL_MS)) return true;
    } catch { /* 없는 것으로 본다 */ }
  }
  return false;
}

/** 구글이 허용을 거절하거나 오류로 돌려보낸 주소인지(주소의 error 값). */
export function googleReturnDenied(href: string): boolean {
  try {
    const url = new URL(href);
    const hash = new URLSearchParams(url.hash.replace(/^#/, ''));
    return !!(url.searchParams.get('error') || hash.get('error'));
  } catch { return false; }
}
