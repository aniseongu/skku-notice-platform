import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../public/push-handler.js', import.meta.url), 'utf8');
function worker() {
  const events = new Map();
  const notifications = [];
  const opened = [];
  const scope = 'https://example.github.io/skku-notice-alert/';
  const self = {
    location: new URL(scope + 'sw.js'),
    registration: { scope, showNotification: async (title, options) => notifications.push({ title, ...options }) },
    clients: { openWindow: async (url) => opened.push(url) },
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
