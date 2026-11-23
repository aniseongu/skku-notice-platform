import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { MessageChannel } from 'node:worker_threads';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../public/push-handler.js', import.meta.url), 'utf8');
function worker(windows = [], extra = {}) {
  const events = new Map();
  const notifications = [];
  const opened = [];
  const scope = 'https://example.github.io/skku-notice-alert/';
  const self = {
    location: new URL(scope + 'sw.js'),
    registration: { scope, showNotification: async (title, options) => notifications.push({ title, ...options }), pushManager: { getSubscription: async () => (extra.endpoint ? { endpoint: extra.endpoint } : null) } },
    clients: { openWindow: async (url) => opened.push(url), matchAll: async () => windows },
    addEventListener: (name, handler) => events.set(name, handler),
  };
  const { endpoint: _endpoint, ...globals } = extra;
  vm.runInNewContext(source, { self, URL, setTimeout, clearTimeout, ...globals });
  return {
    notifications, opened, scope,
    async push(payload) {
      let pending;
      events.get('push')({ data: { json: () => payload }, waitUntil: (promise) => { pending = promise; } });
      await pending;
    },
    async click(notification) {
      let pending;
      events.get('notificationclick')({ notification: { ...notification, close() {} }, waitUntil: (promise) => { pending = promise; } });
      await pending;
    },
  };
}

test('background push opens the original school notice and keeps silent priority', async () => {
  const w = worker();
  const url = 'https://cse.skku.edu/cse/notice.do?mode=view&articleNo=123';
  await w.push({ title: '장학 안내', body: '신청 마감을 확인해 주세요', url, tag: 'notice:123', silent: true });
  const notification = w.notifications[0];
  assert.equal(notification.data.url, url);
  assert.equal(notification.silent, true);
  assert.equal(notification.tag, 'notice:123');
  await w.click(notification);
  assert.equal(w.opened[0], url);
});

test('push never opens an arbitrary or executable URL', async () => {
  const w = worker();
  for (const url of ['javascript:alert(1)', 'https://skku.edu.evil.example/a', 'http://cse.skku.edu/a',
    'https://linkareer.com.evil.example/activity/123', 'https://jasoseol.com/login',
    'https://linkareer.com:8443/activity/123', 'https://name:password@linkareer.com/activity/123']) {
    await w.push({ title: '공지', url });
    assert.equal(w.notifications.at(-1).data.url, w.scope);
  }
});

test('missing or invalid payload still displays a notification', async () => {
  const w = worker();
  for (const payload of [null, [], 'invalid', {}]) {
    await w.push(payload);
    assert.equal(w.notifications.at(-1).title, '성공');
    assert.equal(w.notifications.at(-1).data.url, w.scope);
  }
});


test('background push opens an allowed internship original', async () => {
  const w = worker();
  for (const url of ['https://linkareer.com/activity/361618', 'https://jasoseol.com/recruit/107002']) {
    await w.push({ title: '인턴 공고', url });
    const notification = w.notifications.at(-1);
    assert.equal(notification.data.url, url);
    await w.click(notification);
    assert.equal(w.opened.at(-1), url);
  }
});

test('bootcamp push accepts the original and opens the app notice', async () => {
  const w = worker();
  const url = 'https://aibootcamp-skku.co.kr/news/45';
  await w.push({ url, tag: 'notice:aibootcamp-news/45' });
  assert.equal(w.notifications.at(-1).data.url, url);
  await w.click(w.notifications.at(-1));
  assert.equal(w.opened.at(-1), w.scope + '?notice=aibootcamp-news%2F45&push=1');
  for (const bad of [url.replace('.kr/', '.kr.evil.com/'), url.replace('://', '://user@'),
    url.replace('.kr/', '.kr:443/'), url.replace('.kr/', '.kr:8443/'),
    url.replace('/45', '/write'), url.replace('https:', 'http:'), url + '?page=2']) {
    await w.push({ url: bad });
    assert.equal(w.notifications.at(-1).data.url, w.scope, bad);
    await w.click({ tag: 'old', data: { url: bad } });
    assert.equal(w.opened.at(-1), w.scope, bad);
  }
});

test('a lost subscription is recreated with the same server key when the browser changes it', async () => {
  const events = new Map();
  const made = [];
  const key = new Uint8Array([4, 1, 2]);
  const self = {
    location: new URL('https://example.test/sw.js'),
    registration: { scope: 'https://example.test/', pushManager: { getSubscription: async () => null, subscribe: async (options) => { made.push(options); return {}; } } },
    addEventListener: (name, handler) => events.set(name, handler),
  };
  vm.runInNewContext(source, { self, URL });
  let pending;
  events.get('pushsubscriptionchange')({ oldSubscription: { options: { applicationServerKey: key } }, waitUntil: (promise) => { pending = promise; } });
  await pending;
  assert.equal(made.length, 1);
  assert.equal(made[0].applicationServerKey, key);
  assert.equal(made[0].userVisibleOnly, true);
});

const APP_ID = 'skku-notice01/12345';
const appUrl = (w) => `${w.scope}?notice=skku-notice01%2F12345&push=1`;

test('clicking a notice alert opens that notice inside the app, not the original page', async () => {
  const w = worker();
  await w.push({ title: '장학', url: 'https://cse.skku.edu/cse/notice.do?mode=view&articleNo=123', tag: `notice:${APP_ID}` });
  assert.equal(w.notifications[0].data.notice, APP_ID);
  assert.equal(w.notifications[0].data.url, 'https://cse.skku.edu/cse/notice.do?mode=view&articleNo=123');   // 원문 검증은 그대로
  await w.click(w.notifications[0]);
  assert.deepEqual(w.opened, [appUrl(w)]);
});

test('an older open app window falls back to browser navigation', async () => {
  const calls = [];
  const scope = 'https://example.github.io/skku-notice-alert/';
  const window = { url: scope + '?tab=all', focus: async () => calls.push('focus'), navigate: async (url) => { calls.push(['navigate', url]); return window; } };
  const other = { url: 'https://example.github.io/other/', focus: async () => calls.push('wrong'), navigate: async () => calls.push('wrong') };
  const w = worker([other, window]);
  await w.push({ title: '장학', tag: `notice:${APP_ID}` });
  await w.click(w.notifications[0]);
  assert.deepEqual(calls, ['focus', ['navigate', appUrl(w)]]);
  assert.deepEqual(w.opened, []);
});

test('a ready app tab opens the notice without a new document or window', async () => {
  const seen = [];
  const window = {
    url: 'https://example.github.io/skku-notice-alert/?tab=all',
    focus: async () => { seen.push('focus'); },
    postMessage(message, [reply]) { seen.push(message.type, message.noticeId); reply.postMessage(true); reply.close(); },
    navigate: async () => assert.fail('The page already accepted the notice'),
  };
  const w = worker([window], { MessageChannel });
  await w.push({ tag: `notice:${APP_ID}` });
  await w.click(w.notifications[0]);
  assert.deepEqual(seen, ['focus', 'open-notice', APP_ID]);
  assert.deepEqual(w.opened, []);
});

test('an older click cannot reload a window after a newer notice was accepted', async () => {
  let firstSent;
  const firstMessage = new Promise((resolve) => { firstSent = resolve; });
  const window = {
    url: 'https://example.github.io/skku-notice-alert/',
    focus: async () => {},
    postMessage({ noticeId }, [reply]) {
      if (noticeId === APP_ID) firstSent();
      else reply.postMessage(true);
      reply.close();
    },
    navigate: async () => assert.fail('The earlier click must not navigate'),
  };
  const w = worker([window], { MessageChannel });
  const first = w.click({ tag: `notice:${APP_ID}` });
  await firstMessage;
  await w.click({ tag: 'notice:skku-notice01/2' });
  await first;
  assert.deepEqual(w.opened, []);
});

test('if the window cannot be moved the app link opens in a new window', async () => {
  const w = worker([{ url: 'https://example.github.io/skku-notice-alert/', focus: async () => {}, navigate: async () => { throw new TypeError('uncontrolled'); } }]);
  await w.push({ title: '장학', tag: `notice:${APP_ID}` });
  await w.click(w.notifications[0]);
  assert.deepEqual(w.opened, [appUrl(w)]);
});

test('canvas, required-info, forged and old alerts keep opening the checked url', async () => {
  const w = worker();
  const url = 'https://cse.skku.edu/cse/notice.do?mode=view&articleNo=9';
  for (const tag of ['canvas:123', 'required', 'notice:../x/1', 'notice:a/1/2', 'notice:' + 'a/1'.padEnd(300, '1'), 'skku-notice']) {
    await w.push({ title: 't', url, tag });
    await w.click(w.notifications.at(-1));
    assert.equal(w.opened.at(-1), url, tag);
  }
  // 알림 객체의 data.notice가 위조돼도 형식이 틀리면 열지 않는다
  await w.click({ tag: 'x', data: { url, notice: 'https://evil.example/' } });
  assert.equal(w.opened.at(-1), url);
});

// 알림함: 받은 알림을 이 기기의 IndexedDB(키 inbox:v1, owner {userId, endpoint, recipientHash} + items)에 쌓는다. 날 IndexedDB를 흉내 낸 가짜로 워커 코드를 그대로 돌린다.
function fakeIndexedDb(data, { hang = false, blocked = false, openGate = Promise.resolve() } = {}) {
  return {
    open() {
      const request = {};
      if (hang) return request;
      void openGate.then(() => setTimeout(() => {
        if (blocked) { request.onblocked?.(); return; }
        request.result = {
          createObjectStore() {}, close() {},
          transaction() {
            const tx = {};
            let pending = 0;
            const done = () => { if (--pending === 0) setTimeout(() => tx.oncomplete?.(), 0); };
            tx.objectStore = () => ({
              get(key) { const r = {}; pending++; setTimeout(() => { r.result = data.has(key) ? JSON.parse(data.get(key)) : undefined; r.onsuccess?.(); done(); }, 0); return r; },
              put(value, key) { data.set(key, JSON.stringify(value)); },
            });
            return tx;
          },
        };
        request.onsuccess?.();
      }, 0));
      return request;
    },
  };
}
const EP_A = 'https://push.example/a';
const EP_B = 'https://push.example/b';
const recipient = (userId) => createHash('sha256').update('skku-inbox:' + userId).digest('hex').slice(0, 16);
const inboxOwner = (userId, endpoint) => ({ userId, endpoint, recipientHash: recipient(userId) });
const recordOf = (owner) => new Map([['inbox:v1', JSON.stringify({ version: 1, owner, items: [] })]]);
const inboxOf = (data) => (data.has('inbox:v1') ? JSON.parse(data.get('inbox:v1')).items : []);
const registered = (data, endpoint, extra = {}) => worker([], { indexedDB: fakeIndexedDb(data), endpoint, ...extra });

test('a received alert is kept in the inbox for the owner whose subscription received it, newest first', async () => {
  const data = recordOf(inboxOwner('user-a', EP_A));
  const w = registered(data, EP_A);
  await w.push({ to: recipient('user-a'), title: '첫 공지', body: '본문', url: 'https://cse.skku.edu/a', tag: `notice:${APP_ID}` });
  await w.push({ to: recipient('user-a'), title: '두 번째', body: '본문2', tag: 'skku-notice' });
  const items = inboxOf(data);
  assert.deepEqual(items.map((item) => item.title), ['두 번째', '첫 공지']);
  assert.equal(items[1].owner, 'user-a');
  assert.equal(items[1].noticeId, APP_ID);
  assert.equal(items[1].url, 'https://cse.skku.edu/a');
  assert.equal(items[1].read, false);
  assert.equal(items[0].noticeId, null);
  assert.deepEqual(JSON.parse(data.get('inbox:v1')).owner, inboxOwner('user-a', EP_A));   // 소유자는 그대로 보존된다
});

test('a push for account A arriving after B logged in is shown but never stored under B', async () => {
  // A가 이 기기를 EP_A로 등록해 둔 채 B로 바꿨다. 앱은 B를 소유자로 적었지만(endpoint null) 아직 B의 구독을 등록하기 전이다.
  const data = recordOf(inboxOwner('user-b', null));
  const late = registered(data, EP_A);
  await late.push({ to: recipient('user-a'), title: 'A에게 온 장학 안내', body: 'A의 알림', tag: `notice:${APP_ID}` });
  assert.equal(late.notifications.length, 1);
  assert.deepEqual(inboxOf(data), []);
  // 구독 주소가 아직 A 것인데 owner가 B의 옛 주소를 가리켜도 저장하지 않는다
  const other = recordOf(inboxOwner('user-b', EP_B));
  await registered(other, EP_A).push({ to: recipient('user-a'), title: 'A에게 온 알림' });
  assert.deepEqual(inboxOf(other), []);
  // B가 자기 구독을 등록해 앱이 owner.endpoint를 EP_B로 기록한 뒤에는 저장된다
  const after = recordOf(inboxOwner('user-b', EP_B));
  await registered(after, EP_B).push({ to: recipient('user-b'), title: 'B에게 온 알림' });
  assert.deepEqual(inboxOf(after).map((item) => [item.title, item.owner]), [['B에게 온 알림', 'user-b']]);
});

test('an endpoint re-registered to B stores only pushes addressed to B', async () => {
  const data = recordOf(inboxOwner('user-b', EP_A));
  const w = registered(data, EP_A);
  await w.push({ title: 'A에게 온 지연 알림', to: recipient('user-a') });
  await w.push({ title: '이전 서버의 알림' });
  await w.push({ title: 'B에게 온 알림', to: recipient('user-b') });
  assert.equal(w.notifications.length, 3);
  assert.deepEqual(inboxOf(data).map((item) => [item.title, item.owner]), [['B에게 온 알림', 'user-b']]);
});

test('without an owner, a subscription or a stored record nothing is kept, but the alert still shows', async () => {
  const cases = [
    [new Map(), EP_A],
    [recordOf({ userId: 'user-a', endpoint: EP_A }), EP_A], // old owner record has no hash
    [recordOf(null), EP_A],
    [recordOf(inboxOwner('user-a', EP_A)), null],     // 구독이 없다(해제·전환 중)
    [recordOf({ userId: '', endpoint: EP_A }), EP_A],
  ];
  for (const [data, endpoint] of cases) {
    const w = registered(data, endpoint);
    await w.push({ to: recipient('user-a'), title: '공지', tag: `notice:${APP_ID}` });
    assert.equal(w.notifications.length, 1);
    assert.deepEqual(inboxOf(data), []);
  }
});

test('the same notice tag replaces its earlier entry and comes back unread; the generic tag does not merge', async () => {
  const data = recordOf(inboxOwner('user-a', EP_A));
  const w = registered(data, EP_A);
  await w.push({ to: recipient('user-a'), title: '장학', tag: `notice:${APP_ID}` });
  await w.push({ to: recipient('user-a'), title: '장학 (수정됨)', tag: `notice:${APP_ID}` });
  await w.push({ to: recipient('user-a'), title: 'a', tag: 'skku-notice' });
  await w.push({ to: recipient('user-a'), title: 'b' });
  assert.deepEqual(inboxOf(data).map((item) => item.title).sort(), ['a', 'b', '장학 (수정됨)']);
});

test('each digest shows once, opens the inbox and stores its notices as individual unread entries', async () => {
  const data = recordOf(inboxOwner('user-a', EP_A));
  const w = registered(data, EP_A);
  const to = recipient('user-a');
  const url = w.scope + '?view=settings&section=inbox';
  const notice = { id: APP_ID, title: '수정 공지', url: 'https://cse.skku.edu/a', tag: `notice:${APP_ID}` };
  const second = { id: 'school/2', title: '새 공지', url: 'javascript:alert(1)', tag: 'notice:school/2' };
  const tags = ['digest:2026-11-23:12345678', 'digest:2026-11-23:abcdef01'];
  await w.push({ to, title: '이전 공지', tag: notice.tag });
  await w.push({ to, title: '밤사이 알림 2건', url, tag: tags[0], items: [notice, second] });
  await w.push({ to, title: '밤사이 알림 1건', url, tag: tags[1], items: [
    { id: 'school/3', title: '다음 공지', tag: 'notice:school/3' },
  ] });

  assert.deepEqual(w.notifications.slice(1).map(({ tag }) => tag), tags);
  await w.click(w.notifications[1]);
  assert.deepEqual(w.opened, [url]);
  const items = inboxOf(data).sort((a, b) => a.title.localeCompare(b.title));
  assert.equal(new Set(items.map(({ id }) => id)).size, 3);
  assert.deepEqual(items.map(({ id, at, ...item }) => item), [
    { owner: 'user-a', tag: 'notice:school/3', title: '다음 공지', body: '', noticeId: 'school/3', url: w.scope, read: false },
    { owner: 'user-a', tag: second.tag, title: second.title, body: '', noticeId: second.id, url: w.scope, read: false },
    { owner: 'user-a', tag: notice.tag, title: notice.title, body: '', noticeId: notice.id, url: notice.url, read: false },
  ]);
});

test('digest items require the same recipient and endpoint and reject mismatched notice tags', async () => {
  const data = recordOf(inboxOwner('user-a', EP_A));
  const digest = { tag: 'digest:2026-11-23:12345678', items: [
    { id: 'school/1', tag: 'notice:school/1', title: '공지' },
  ] };
  await registered(data, EP_B).push({ ...digest, to: recipient('user-a') });
  await registered(data, EP_A).push({ ...digest, to: recipient('user-b') });
  const w = registered(data, EP_A);
  await w.push({ ...digest, to: recipient('user-a'), items: [null, { ...digest.items[0], id: 'school/2' }] });
  await w.push({ ...digest, to: recipient('user-a'), items: [] });
  assert.equal(w.notifications.length, 2);
  assert.deepEqual(inboxOf(data), []);

  await w.push({ ...digest, to: recipient('user-a'), items: Array.from({ length: 21 }, (_, i) => ({
    id: `school/${i}`, tag: `notice:school/${i}`, title: `공지 ${i}`,
  })) });
  assert.equal(inboxOf(data).length, 20);
  assert.ok(inboxOf(data).every(({ noticeId }) => noticeId !== 'school/20'));
});

test('old entries (30 days) are dropped and at most 200 are kept; other owners are not merged away', async () => {
  const now = Date.now();
  const make = (i, at, owner = 'user-a') => ({ id: `i${i}`, owner, tag: `t${i}`, title: `제목${i}`, body: '', noticeId: null, url: 'https://x', at, read: true });
  const items = [make(0, now - 31 * 86400000), ...Array.from({ length: 205 }, (_, i) => make(i + 1, now - i * 1000))];
  const data = new Map([['inbox:v1', JSON.stringify({ version: 1, owner: inboxOwner('user-a', EP_A), items })]]);
  const w = registered(data, EP_A);
  await w.push({ to: recipient('user-a'), title: '새 알림', tag: 'skku-notice' });
  const kept = inboxOf(data);
  assert.equal(kept.length, 200);
  assert.equal(kept[0].title, '새 알림');
  assert.ok(!kept.some((item) => item.id === 'i0'));
});

test('a failing, blocked or hanging inbox write never blocks or fails the notification', async () => {
  const data = recordOf(inboxOwner('user-a', EP_A));
  const failing = { open() { const request = {}; setTimeout(() => request.onerror?.(), 0); request.error = new Error('x'); return request; } };
  const broken = worker([], { indexedDB: failing, endpoint: EP_A });
  await broken.push({ to: recipient('user-a'), title: '공지', tag: `notice:${APP_ID}` });
  assert.equal(broken.notifications.length, 1);
  const blocked = registered(data, EP_A, { indexedDB: fakeIndexedDb(data, { blocked: true }) });
  await blocked.push({ to: recipient('user-a'), title: '공지' });
  assert.equal(blocked.notifications.length, 1);
  assert.deepEqual(inboxOf(data), []);
  const noDb = worker([], { endpoint: EP_A });
  await noDb.push({ to: recipient('user-a'), title: '공지' });
  assert.equal(noDb.notifications.length, 1);
  const noPush = worker();
  await noPush.push({ to: recipient('user-a'), title: '공지' });
  assert.equal(noPush.notifications.length, 1);
});

test('a hung inbox open gives up after about three seconds while the alert is already shown', async () => {
  const data = recordOf(inboxOwner('user-a', EP_A));
  const w = registered(data, EP_A, { indexedDB: fakeIndexedDb(data, { hang: true }) });
  const started = Date.now();
  await w.push({ to: recipient('user-a'), title: '공지' });
  const elapsed = Date.now() - started;
  assert.equal(w.notifications.length, 1);
  assert.ok(elapsed >= 2500 && elapsed < 6000, `elapsed ${elapsed}`);
  assert.deepEqual(inboxOf(data), []);
});

test('open windows are told the inbox changed only when something was stored', async () => {
  const messages = [];
  const data = recordOf(inboxOwner('user-a', EP_A));
  const windows = [{ url: 'https://example.github.io/skku-notice-alert/', postMessage: (message) => messages.push(message) }];
  await worker(windows, { indexedDB: fakeIndexedDb(data), endpoint: EP_A }).push({ to: recipient('user-a'), title: '공지' });
  assert.deepEqual(JSON.parse(JSON.stringify(messages)), [{ type: 'inbox-changed' }]);
  messages.length = 0;
  await worker(windows, { indexedDB: fakeIndexedDb(data), endpoint: EP_B }).push({ to: recipient('user-a'), title: '다른 구독' });
  assert.deepEqual(messages, []);
});

test('a write completing after the cap still tells open windows', { timeout: 1000 }, async () => {
  const data = recordOf(inboxOwner('user-a', EP_A));
  const open = Promise.withResolvers();
  const message = Promise.withResolvers();
  const w = worker([{ postMessage: message.resolve }], {
    indexedDB: fakeIndexedDb(data, { openGate: open.promise }),
    endpoint: EP_A,
    setTimeout: (callback) => setTimeout(callback, 0),
  });
  await w.push({ to: recipient('user-a'), title: '늦게 저장된 알림' });
  assert.equal(w.notifications.length, 1);
  assert.deepEqual(inboxOf(data), []);
  open.resolve();
  assert.equal((await message.promise).type, 'inbox-changed');
  assert.equal(inboxOf(data)[0].title, '늦게 저장된 알림');
});
