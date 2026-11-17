import test from 'node:test';
import assert from 'node:assert/strict';
import { showTestNotification } from '../src/test-notification.ts';

test('test notification uses a fresh audible tag and checks for the notification', async () => {
  const calls = [];
  const registration = { scope: 'https://example.com/', showNotification: async (title, options) => calls.push(options), getNotifications: async ({ tag }) => calls.some((c) => c.tag === tag) ? [{}] : [] };
  assert.match(await showTestNotification(registration, 'SamsungBrowser'), /삼성 인터넷/);
  assert.match(await showTestNotification(registration, 'Chrome'), /브라우저 앱/);
  assert.notEqual(calls[0].tag, calls[1].tag);
  assert.equal(calls[0].silent, false);
  assert.match(calls[0].badge, /icon-monochrome-512\.png$/);
  registration.getNotifications = async () => [];
  assert.match(await showTestNotification(registration, ''), /확인하지 못했어요/);
});
