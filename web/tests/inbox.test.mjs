import test from 'node:test';
import assert from 'node:assert/strict';
import { changeInbox, clearInbox, inboxTime, loadInbox, pruneInbox, pruneStoredInbox, releaseInbox, safeInboxUrl, setInboxOwner, unreadCount, visibleInbox, noticeIdOfItem, listenInboxChanged, INBOX_KEY } from '../src/inbox.ts';

function fakeStore(initial = []) {
  const data = new Map(initial);
  return { data, get: async (key) => data.get(key), update: async (key, updater) => { data.set(key, updater(data.get(key))); } };
}
const DAY = 86400000;
const make = (id, owner, at, extra = {}) => ({ id, owner, tag: `t${id}`, title: `제목${id}`, body: '본문', noticeId: null, url: 'https://x.example/', at, read: false, ...extra });
const record = (items, owner = null) => ({ version: 1, owner, items });
const NOW = Date.UTC(2026, 10, 20);
const stored = (store) => store.data.get(INBOX_KEY);

test('prune drops entries older than 30 days and keeps the newest 200', () => {
  const items = [make('old', 'a', NOW - 31 * DAY), ...Array.from({ length: 205 }, (_, i) => make(`n${i}`, 'a', NOW - i * 1000))];
  const kept = pruneInbox(items, NOW);
  assert.equal(kept.length, 200);
  assert.equal(kept[0].id, 'n0');
  assert.ok(!kept.some((item) => item.id === 'old'));
  assert.equal(pruneInbox([make('edge', 'a', NOW - 30 * DAY)], NOW).length, 1);
});

test('only the current owner sees entries and nobody sees them when logged out', async () => {
  const store = fakeStore([[INBOX_KEY, record([make('1', 'a', NOW - 1000), make('2', 'b', NOW - 500), make('3', 'a', NOW - 200)])]]);
  assert.deepEqual((await loadInbox('a', store, NOW)).map((item) => item.id), ['3', '1']);
  assert.deepEqual((await loadInbox('b', store, NOW)).map((item) => item.id), ['2']);
  assert.deepEqual(await loadInbox(null, store, NOW), []);
  assert.deepEqual(visibleInbox([make('1', 'a', 1)], null), []);
});

test('switching the owner removes the previous account entries and forgets its push endpoint in one write', async () => {
  const store = fakeStore([[INBOX_KEY, record([make('1', 'a', NOW - 1000), make('2', 'b', NOW - 500)], { userId: 'a', endpoint: 'ep-a' })]]);
  await setInboxOwner('b', undefined, store, NOW);
  assert.deepEqual(stored(store).owner, { userId: 'b', endpoint: null });   // A의 구독 주소는 B의 것이 아니다
  assert.deepEqual(stored(store).items.map((item) => item.id), ['2']);
  await setInboxOwner('a', undefined, store, NOW);
  assert.deepEqual(stored(store).items, []);
});

test('the owner endpoint is recorded for the same user, kept on reload, and cleared by an explicit null', async () => {
  const store = fakeStore();
  await setInboxOwner('a', undefined, store, NOW);
  assert.deepEqual(stored(store).owner, { userId: 'a', endpoint: null });
  await setInboxOwner('a', 'ep-a', store, NOW);                // 이 계정으로 기기를 등록한 직후
  assert.deepEqual(stored(store).owner, { userId: 'a', endpoint: 'ep-a' });
  await setInboxOwner('a', undefined, store, NOW);             // 새로고침: 같은 사용자의 주소는 유지
  assert.deepEqual(stored(store).owner, { userId: 'a', endpoint: 'ep-a' });
  await setInboxOwner('a', null, store, NOW);                  // 알림 끄기
  assert.deepEqual(stored(store).owner, { userId: 'a', endpoint: null });
});

test('a late logout cleanup of A never wipes B who already logged in', async () => {
  const store = fakeStore([[INBOX_KEY, record([make('1', 'a', NOW - 1000), make('2', 'b', NOW - 500)], { userId: 'b', endpoint: 'ep-b' })]]);
  assert.equal(await releaseInbox('a', store), true);
  assert.deepEqual(stored(store).owner, { userId: 'b', endpoint: 'ep-b' });
  assert.deepEqual(stored(store).items.map((item) => item.id), ['2']);
});

test('logging out or deleting the account clears that owner entries and the owner', async () => {
  const store = fakeStore([[INBOX_KEY, record([make('1', 'a', NOW), make('2', 'b', NOW)], { userId: 'a', endpoint: 'ep-a' })]]);
  assert.equal(await releaseInbox('a', store), true);
  assert.equal(stored(store).owner, null);
  assert.deepEqual(stored(store).items.map((item) => item.id), ['2']);
  assert.equal(await clearInbox(store), true);
  assert.deepEqual(stored(store), { version: 1, owner: null, items: [] });
});

test('read, read-all, remove and clear touch only the current owner and keep the owner record', async () => {
  const owner = { userId: 'a', endpoint: 'ep-a' };
  const store = fakeStore([[INBOX_KEY, record([make('1', 'a', NOW - 3), make('2', 'a', NOW - 2), make('3', 'b', NOW - 1)], owner)]]);
  assert.equal(await changeInbox('a', { kind: 'read', ids: ['1'] }, store), true);
  assert.deepEqual(stored(store).items.map((i) => [i.id, i.read]), [['1', true], ['2', false], ['3', false]]);
  await changeInbox('a', { kind: 'read-all' }, store);
  assert.deepEqual(stored(store).items.map((i) => [i.id, i.read]), [['1', true], ['2', true], ['3', false]]);
  await changeInbox('a', { kind: 'remove', ids: ['2'] }, store);
  assert.deepEqual(stored(store).items.map((i) => i.id), ['1', '3']);
  await changeInbox('a', { kind: 'clear' }, store);
  assert.deepEqual(stored(store).items.map((i) => i.id), ['3']);
  assert.deepEqual(stored(store).owner, owner);
});

test('expired entries are really removed from storage when the app opens, without touching the owner', async () => {
  const owner = { userId: 'a', endpoint: 'ep-a' };
  const store = fakeStore([[INBOX_KEY, record([make('old', 'a', NOW - 31 * DAY), make('new', 'a', NOW - 1000)], owner)]]);
  await pruneStoredInbox(store, NOW);
  assert.deepEqual(stored(store).items.map((i) => i.id), ['new']);
  assert.deepEqual(stored(store).owner, owner);
});

test('corrupt or foreign records are ignored and storage failures do not throw', async () => {
  const bad = fakeStore([[INBOX_KEY, { version: 2, items: [make('1', 'a', NOW)] }]]);
  assert.deepEqual(await loadInbox('a', bad, NOW), []);
  const junk = fakeStore([[INBOX_KEY, { version: 1, owner: { userId: 5 }, items: [make('1', 'a', NOW), { id: 5 }, null, 'x'] }]]);
  assert.deepEqual((await loadInbox('a', junk, NOW)).map((i) => i.id), ['1']);
  const broken = { get: async () => { throw new Error('x'); }, update: async () => { throw new Error('x'); } };
  assert.deepEqual(await loadInbox('a', broken, NOW), []);
  assert.equal(await changeInbox('a', { kind: 'read-all' }, broken), false);
  assert.equal(await setInboxOwner('a', undefined, broken, NOW), false);
  assert.equal(await releaseInbox('a', broken), false);
  assert.equal(await clearInbox(broken), false);
});

test('a change in one tab is announced to the others', async () => {
  let heard = 0;
  const stop = listenInboxChanged(() => { heard += 1; });
  const store = fakeStore([[INBOX_KEY, record([make('1', 'a', NOW)], { userId: 'a', endpoint: 'ep-a' })]]);
  await changeInbox('a', { kind: 'read-all' }, store);
  await new Promise((resolve) => setTimeout(resolve, 50));
  stop();
  assert.ok(heard >= 1);
});

test('stored alert urls are re-checked with the same rules as when they were received', () => {
  const app = 'https://skku-notice-platform.pages.dev';
  for (const ok of ['https://cse.skku.edu/cse/notice.do?mode=view', 'https://skku.edu/a', 'https://skku-notice-platform.pages.dev/?notice=x', 'https://linkareer.com/activity/361618', 'https://jasoseol.com/recruit/107002'])
    assert.ok(safeInboxUrl(ok, app), ok);
  for (const bad of ['javascript:alert(1)', 'http://cse.skku.edu/a', 'https://skku.edu.evil.example/a', 'https://evil.example/', 'https://linkareer.com/login',
    'https://linkareer.com:8443/activity/1', 'https://u:p@cse.skku.edu/a', 'https://jasoseol.com/recruit/abc', 'not a url', ''])
    assert.equal(safeInboxUrl(bad, app), null, bad);
});

test('unread count, notice id check and short time labels', () => {
  assert.equal(unreadCount([make('1', 'a', 1), make('2', 'a', 1, { read: true })]), 1);
  assert.equal(noticeIdOfItem({ noticeId: 'skku-notice01/123' }), 'skku-notice01/123');
  assert.equal(noticeIdOfItem({ noticeId: 'https://evil.example/' }), null);
  assert.equal(noticeIdOfItem({ noticeId: null }), null);
  assert.equal(inboxTime(NOW - 10000, NOW), '방금 전');
  assert.equal(inboxTime(NOW - 5 * 60000, NOW), '5분 전');
  assert.equal(inboxTime(NOW - 3 * 3600000, NOW), '3시간 전');
  assert.equal(inboxTime(NOW - 30 * 3600000, NOW), '어제');
  assert.equal(inboxTime(NOW - 3 * DAY, NOW), '3일 전');
  assert.match(inboxTime(NOW - 20 * DAY, NOW), /월 \d+일$/);
});
