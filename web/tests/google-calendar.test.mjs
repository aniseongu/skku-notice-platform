import assert from 'node:assert/strict';
import test from 'node:test';
import { desiredEvents, ensureCalendar, eventId, syncCalendar } from '../src/google-calendar.ts';

const NOW = new Date('2026-11-08T03:00:00Z');
const notice = (id, extra = {}) => ({ id, title: `공지 ${id}`, url: `https://www.skku.edu/${id}`, deadline: '2026-11-10T14:59:00Z', ...extra });

test('event id is stable and equal to the original Python implementation', async () => {
  assert.equal(await eventId('skku-notice01/12345'), 'skkuno5q62imcabvu12kjgv2m5r9gs5qkqjl');
  assert.equal(await eventId('a/1'), await eventId('a/1'));
  assert.notEqual(await eventId('a/1'), await eventId('a/2'));
  assert.match(await eventId('x/y'), /^skku[0-9a-v]{32}$/);
});

test('desired events follow the original rules: lead window, schedule hour, skips', async () => {
  const events = await desiredEvents([
    notice('a/1'),
    notice('a/2', { deadline_kind: '일정' }),
    notice('a/3', { deadline: '2026-11-01T00:00:00Z' }),
    notice('a/4', { deadline: null }),
    notice('a/5', { url: 'http://insecure.example' }),
    notice('a/6'),
    notice('a/7', { title_ko: '한국어 제목' }),
  ], NOW, new Set(['a/6']));
  const byNotice = Object.fromEntries([...events.values()].map((e) => [e.extendedProperties.private.skkuNotice, e]));
  assert.deepEqual(Object.keys(byNotice).sort(), ['a/1', 'a/2', 'a/7']);
  const deadline = new Date('2026-11-10T14:59:00Z').getTime();
  assert.equal(new Date(byNotice['a/1'].end.dateTime).getTime(), deadline);
  assert.equal(deadline - new Date(byNotice['a/1'].start.dateTime).getTime(), 30 * 60 * 1000);
  assert.equal(new Date(byNotice['a/2'].start.dateTime).getTime(), deadline);
  assert.equal(new Date(byNotice['a/2'].end.dateTime).getTime() - deadline, 60 * 60 * 1000);
  assert.equal(byNotice['a/7'].summary, '한국어 제목');
  assert.equal(byNotice['a/1'].start.timeZone, 'Asia/Seoul');
});

function fakeGoogle({ calendars = new Set(['cal']), events = [] } = {}) {
  const calls = [];
  const fetcher = async (url, init = {}) => {
    const method = init.method ?? 'GET';
    calls.push([method, new URL(url).pathname.replace('/calendar/v3', ''), init.body ? JSON.parse(init.body) : undefined]);
    assert.match(init.headers.Authorization, /^Bearer tok$/);
    const path = new URL(url).pathname.replace('/calendar/v3', '');
    const json = (body, status = 200) => new Response(JSON.stringify(body), { status });
    if (path === '/calendars' && method === 'POST') return json({ id: 'new-cal' });
    const cal = path.match(/^\/calendars\/([^/]+)$/);
    if (cal) return calendars.has(decodeURIComponent(cal[1])) ? json({ id: cal[1] }) : json({}, 404);
    if (path.endsWith('/events') && method === 'GET') return json({ items: events });
    if (path.endsWith('/events') && method === 'POST') return json({}, 200);
    return json({}, 200);
  };
  return { fetcher, calls };
}

test('calendar is reused, recreated only when it is gone, and connection errors are not mistaken for deletion', async () => {
  assert.equal(await ensureCalendar('tok', 'cal', fakeGoogle().fetcher), 'cal');
  const gone = fakeGoogle({ calendars: new Set() });
  assert.equal(await ensureCalendar('tok', 'old', gone.fetcher), 'new-cal');
  assert.equal(gone.calls.filter(([m, p]) => m === 'POST' && p === '/calendars').length, 1);
  const broken = async () => new Response('{}', { status: 500 });
  await assert.rejects(ensureCalendar('tok', 'cal', broken), /구글 오류 500/);
  const expired = async () => new Response('{}', { status: 401 });
  await assert.rejects(ensureCalendar('tok', 'cal', expired), /만료/);
});

test('sync adds new, changes edited and removes only events marked as ours', async () => {
  const desired = await desiredEvents([notice('a/1'), notice('a/2')], NOW);
  const [id1, id2] = [await eventId('a/1'), await eventId('a/2')];
  const mine = (id, noticeId, extra = {}) => ({ id, summary: '옛 제목', description: 'x', end: { dateTime: '2026-11-10T14:59:00Z' }, extendedProperties: { private: { skkuNotice: noticeId } }, ...extra });
  const google = fakeGoogle({ events: [
    mine(id1, 'a/1'),                                  // 제목이 달라서 고친다
    mine('skkustale', 'a/9'),                          // 더는 저장하지 않은 일정이라 지운다
    { id: 'personal', summary: '내 개인 일정' },          // 표시가 없으면 건드리지 않는다
  ] });
  const result = await syncCalendar('tok', 'cal', desired, google.fetcher);
  assert.deepEqual(result, { added: 1, changed: 1, removed: 1 });
  const writes = google.calls.filter(([m]) => m !== 'GET').map(([m, p]) => `${m} ${p.split('/events')[1] || '/events'}`);
  assert.deepEqual(writes.sort(), ['DELETE /skkustale', 'POST /events', `PUT /${id1}`].sort());
  assert.ok(!JSON.stringify(google.calls).includes('personal'));
  assert.ok(desired.has(id2));
});

test('a deleted event id is restored instead of failing with a conflict', async () => {
  const desired = await desiredEvents([notice('a/1')], NOW);
  const calls = [];
  const fetcher = async (url, init = {}) => {
    const method = init.method ?? 'GET'; calls.push(method);
    if (method === 'GET') return new Response(JSON.stringify({ items: [] }), { status: 200 });
    if (method === 'POST') return new Response('{}', { status: 409 });
    return new Response('{}', { status: 200 });
  };
  assert.deepEqual(await syncCalendar('tok', 'cal', desired, fetcher), { added: 1, changed: 0, removed: 0 });
  assert.deepEqual(calls, ['GET', 'POST', 'PUT']);
});

import { googleReturnDenied, hasCalendarPending, markCalendarPending, takeCalendarPending } from '../src/google-calendar.ts';

const fakeStore = () => { const map = new Map(); return { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, String(v)), removeItem: (k) => void map.delete(k) }; };

test('pending mark survives a different tab when it is in the shared store, and expires after 10 minutes', () => {
  const session = fakeStore(), local = fakeStore();
  markCalendarPending([session, local], 1000);
  // 돌아온 탭: sessionStorage는 비었고 localStorage에만 남아 있다.
  assert.equal(takeCalendarPending([fakeStore(), local], 1000 + 60_000), true);
  assert.equal(takeCalendarPending([fakeStore(), local], 1000 + 61_000), false);   // 한 번만 쓰인다
  markCalendarPending([local], 1000);
  assert.equal(takeCalendarPending([local], 1000 + 11 * 60_000), false);           // 오래된 표시는 버린다
  assert.equal(hasCalendarPending([local]), false);
});

test('legacy "1" mark still counts, and a missing mark does not', () => {
  const session = fakeStore(); session.setItem('google-calendar-pending', '1');
  assert.equal(takeCalendarPending([session]), true);
  assert.equal(takeCalendarPending([session]), false);
});

test('google denial is detected from the return url', () => {
  assert.equal(googleReturnDenied('https://x.dev/?error=access_denied&error_code=provider_denied'), true);
  assert.equal(googleReturnDenied('https://x.dev/#error=server_error'), true);
  assert.equal(googleReturnDenied('https://x.dev/?view=settings&section=calendar'), false);
});
