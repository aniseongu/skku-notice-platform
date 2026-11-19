import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../public/push-handler.js', import.meta.url), 'utf8');
function worker(windows = []) {
  const events = new Map();
  const notifications = [];
  const opened = [];
  const scope = 'https://example.github.io/skku-notice-alert/';
  const self = {
    location: new URL(scope + 'sw.js'),
    registration: { scope, showNotification: async (title, options) => notifications.push({ title, ...options }) },
    clients: { openWindow: async (url) => opened.push(url), matchAll: async () => windows },
    addEventListener: (name, handler) => events.set(name, handler),
  };
  vm.runInNewContext(source, { self, URL });
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
const appUrl = (w) => `${w.scope}?notice=skku-notice01%2F12345`;

test('clicking a notice alert opens that notice inside the app, not the original page', async () => {
  const w = worker();
  await w.push({ title: '장학', url: 'https://cse.skku.edu/cse/notice.do?mode=view&articleNo=123', tag: `notice:${APP_ID}` });
  assert.equal(w.notifications[0].data.notice, APP_ID);
  assert.equal(w.notifications[0].data.url, 'https://cse.skku.edu/cse/notice.do?mode=view&articleNo=123');   // 원문 검증은 그대로
  await w.click(w.notifications[0]);
  assert.deepEqual(w.opened, [appUrl(w)]);
});

test('an open app window is focused and moved to the notice instead of opening another window', async () => {
  const calls = [];
  const scope = 'https://example.github.io/skku-notice-alert/';
  const window = { url: scope + '?tab=all', focus: async () => calls.push('focus'), navigate: async (url) => calls.push(['navigate', url]) };
  const other = { url: 'https://example.github.io/other/', focus: async () => calls.push('wrong'), navigate: async () => calls.push('wrong') };
  const w = worker([other, window]);
  await w.push({ title: '장학', tag: `notice:${APP_ID}` });
  await w.click(w.notifications[0]);
  assert.deepEqual(calls, ['focus', ['navigate', appUrl(w)]]);
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
