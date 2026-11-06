import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { stripTypeScriptTypes } from 'node:module';

const source = readFileSync(new URL('../src/browser-push.ts', import.meta.url), 'utf8');
const js = stripTypeScriptTypes(source.replace(/^import .*;$/gm, '').replace(/\bexport\s+/g, ''), { mode: 'strip' })
  + '\nObject.assign(exports, { defaultCanvasPushMode, canvasPushMode, connectBrowserPush, disconnectBrowserPush, setCanvasPushMode });';

function makeEnvironment({ mobile = false, subscription = true, used = {}, saveFails = false, uncertain = false, deleteFails = false, nameClearFails = false, readbackFails = false, unsubscribeFails = false } = {}) {
  const storage = new Map();
  const writes = [];
  const secretNames = { ...used };
  let permissionRequests = 0;
  const actions = [];
  let failNextList = false;
  const current = { endpoint: 'https://push.example/subscription', toJSON: () => ({
    endpoint: 'https://push.example/subscription', keys: { p256dh: 'public-key', auth: 'auth-key' },
  }) };
  let unsubscribed = false;
  current.unsubscribe = async () => { if (unsubscribeFails) return false; unsubscribed = true; return true; };
  const manager = { getSubscription: async () => subscription && !unsubscribed ? current : null, subscribe: async () => current };
  const registration = { pushManager: manager };
  const notification = { permission: 'granted', requestPermission: async () => { permissionRequests++; return 'granted'; } };
  class GitHubError extends Error {}
  class SecretWriteUncertainError extends Error {}
  const github = {
    GitHubError, SecretWriteUncertainError,
    deviceNameVariable: (slot) => `NAME_${slot}`,
    saveVariable: async (_repo, _token, name, value) => { actions.push(['name', name, value]); if (nameClearFails) throw new GitHubError('이름 삭제 실패'); },
    listSecrets: async () => { if (failNextList) { failNextList = false; throw new GitHubError('조회 실패'); } return secretNames; },
    saveSecret: async (_repo, _token, slot, value) => {
      if (saveFails) throw new GitHubError("GitHub 저장 실패");
      if (uncertain) throw new SecretWriteUncertainError('unknown');
      actions.push(['secret', slot]);
      writes.push({ slot, value: JSON.parse(value) });
      secretNames[slot] = 'date';
      if (readbackFails) failNextList = true;
    },
    deleteSecret: async (_repo, _token, slot) => { if (deleteFails) throw new GitHubError('실패'); delete secretNames[slot]; },
  };
  const sandbox = {
    exports: {}, APP_NAME: '앱', ...github,
    localStorage: { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value),
      removeItem: (key) => storage.delete(key) },
    isSecureContext: true, window: { Notification: notification, PushManager: {} }, Notification: notification,
    matchMedia: () => ({ matches: mobile }),
    navigator: { serviceWorker: { getRegistration: async () => registration, ready: Promise.resolve(registration) } },
    document: { baseURI: 'https://site.example/' },
    fetch: async () => ({ ok: true, json: async () => ({ repository: 'owner/repo', publicKey: 'AAAA' }) }),
    crypto: webcrypto, TextEncoder, Uint8Array, URL,
  };
  vm.runInNewContext(js, sandbox);
  return { api: sandbox.exports, storage, writes, actions, secretNames, permissionRequests: () => permissionRequests,
    failList: () => { failNextList = true; }, unsubscribed: () => unsubscribed };
}

test('mobile defaults to reminders and desktop to off without storing a selection', () => {
  const mobile = makeEnvironment({ mobile: true });
  const desktop = makeEnvironment();
  assert.equal(mobile.api.defaultCanvasPushMode(), 'reminders');
  assert.equal(desktop.api.defaultCanvasPushMode(), 'off');
  assert.equal(mobile.api.canvasPushMode(), null);
  assert.equal(desktop.api.canvasPushMode(), null);
});

test('connecting includes per-device default and respects explicit selection', async () => {
  const env = makeEnvironment({ mobile: true });
  await env.api.connectBrowserPush('owner/repo', 'token');
  assert.equal(env.writes[0].slot, 'WEB_PUSH_SUB_1');
  assert.equal(env.writes[0].value.preferences.canvas, 'reminders');
  assert.equal(env.api.canvasPushMode(), 'reminders');
  env.storage.set('browser-push-canvas-mode', 'off');
  await env.api.connectBrowserPush('owner/repo', 'token');
  assert.equal(env.writes[1].slot, 'WEB_PUSH_SUB_1');
  assert.equal(env.writes[1].value.preferences.canvas, 'off');
});

test('updating mode requires an existing subscription and does not request permission', async () => {
  const env = makeEnvironment({ subscription: false });
  await assert.rejects(() => env.api.setCanvasPushMode('owner/repo', 'token', 'summary'), /먼저 이 기기/);
  assert.equal(env.permissionRequests(), 0);
  assert.equal(env.writes.length, 0);
  assert.equal(env.api.canvasPushMode(), null);
});

test('legacy subscription migrates into free slot without changing another device', async () => {
  const env = makeEnvironment({ used: { WEB_PUSH_SUB_1: 'date', WEB_PUSH_SUBSCRIPTION: 'date' } });
  env.storage.set('browser-push-registered', 'old-fingerprint');
  await env.api.setCanvasPushMode('owner/repo', 'token', 'summary');
  assert.equal(env.writes[0].slot, 'WEB_PUSH_SUB_2');
  assert.equal(env.writes[0].value.preferences.canvas, 'summary');
  assert.equal(env.api.canvasPushMode(), 'summary');
  assert.equal(env.permissionRequests(), 0);
});

test('old fingerprint cannot overwrite a slot and unsuccessful writes do not set mode', async () => {
  const env = makeEnvironment({ used: { WEB_PUSH_SUB_1: 'date' } });
  env.storage.set('browser-push-device', JSON.stringify({ fingerprint: 'different', slot: 'WEB_PUSH_SUB_1' }));
  await assert.rejects(() => env.api.setCanvasPushMode('other/repo', 'token', 'reminders'), /배포한 GitHub/);
  assert.equal(env.api.canvasPushMode(), null);
  await env.api.setCanvasPushMode('owner/repo', 'token', 'reminders');
  assert.equal(env.writes[0].slot, 'WEB_PUSH_SUB_2');
  assert.equal(env.api.canvasPushMode(), 'reminders');
});


test('failed secret save does not change the remembered preference', async () => {
  const env = makeEnvironment({ saveFails: true });
  env.storage.set('browser-push-canvas-mode', 'off');
  await assert.rejects(() => env.api.setCanvasPushMode('owner/repo', 'token', 'summary'), /GitHub 저장 실패/);
  assert.equal(env.api.canvasPushMode(), 'off');
  assert.equal(env.writes.length, 0);
});

test('failed remote disconnect keeps the subscription and can be retried', async () => {
  const env = makeEnvironment({ deleteFails: true });
  await env.api.connectBrowserPush('owner/repo', 'token');
  await assert.rejects(() => env.api.disconnectBrowserPush('owner/repo', 'token'), /실패/);
  assert.equal(env.unsubscribed(), false);
  assert.notEqual(env.storage.get('browser-push-device'), undefined);
});

test('disconnect can stop this browser without deleting a slot whose owner is uncertain', async () => {
  const env = makeEnvironment();
  await env.api.connectBrowserPush('owner/repo', 'token');
  env.secretNames.WEB_PUSH_SUB_1 = 'changed-by-another-device';
  const result = await env.api.disconnectBrowserPush('owner/repo', 'token');
  assert.equal(result.remoteRetained, true);
  assert.equal(env.unsubscribed(), true);
  assert.equal(env.secretNames.WEB_PUSH_SUB_1, 'changed-by-another-device');
  assert.notEqual(env.storage.get('browser-push-device'), undefined);
});

test('a saved subscription with an unconfirmed timestamp can be turned off without deleting the slot', async () => {
  const env = makeEnvironment({ readbackFails: true });
  await assert.rejects(env.api.connectBrowserPush('owner/repo', 'token'), /조회 실패/);
  assert.equal((await env.api.disconnectBrowserPush('owner/repo', 'token')).remoteRetained, true);
  assert.equal(env.unsubscribed(), true);
  assert.equal(env.secretNames.WEB_PUSH_SUB_1, 'date');
});

test('a refused browser unsubscribe does not claim that notifications are off', async () => {
  const env = makeEnvironment({ unsubscribeFails: true });
  await env.api.connectBrowserPush('owner/repo', 'token');
  env.secretNames.WEB_PUSH_SUB_1 = 'other-device';
  await assert.rejects(env.api.disconnectBrowserPush('owner/repo', 'token'), /끄지 못했어요/);
  assert.equal(env.secretNames.WEB_PUSH_SUB_1, 'other-device');
  assert.equal(env.unsubscribed(), false);
  assert.notEqual(env.storage.get('browser-push-device'), undefined);
});

test('a temporary failure to read GitHub still permits local unsubscribe', async () => {
  const env = makeEnvironment();
  await env.api.connectBrowserPush('owner/repo', 'token');
  env.failList();
  const result = await env.api.disconnectBrowserPush('owner/repo', 'token');
  assert.equal(result.remoteRetained, true);
  assert.equal(env.unsubscribed(), true);
  assert.equal(env.secretNames.WEB_PUSH_SUB_1, 'date');
});

test('a free slot clears an orphaned name before saving a new subscription', async () => {
  const env = makeEnvironment();
  await env.api.connectBrowserPush('owner/repo', 'token');
  assert.equal(env.actions[0][0], 'name');
  assert.equal(env.actions[1][0], 'secret');
  const failing = makeEnvironment({ nameClearFails: true });
  await assert.rejects(failing.api.connectBrowserPush('owner/repo', 'token'), /이름 삭제 실패/);
  assert.equal(failing.writes.length, 0);
});

test('a slot changed by another device is never overwritten', async () => {
  const env = makeEnvironment();
  await env.api.connectBrowserPush('owner/repo', 'token');
  env.secretNames.WEB_PUSH_SUB_1 = 'changed-by-another-device';
  await assert.rejects(env.api.connectBrowserPush('owner/repo', 'token'), /기존 등록을 확인할 수 없어요/);
  assert.equal(env.writes.length, 1);
  assert.equal(env.secretNames.WEB_PUSH_SUB_1, 'changed-by-another-device');
});

test('a failed readback after saving does not create another slot on retry', async () => {
  const env = makeEnvironment({ readbackFails: true });
  await assert.rejects(env.api.connectBrowserPush('owner/repo', 'token'), /조회 실패/);
  await assert.rejects(env.api.connectBrowserPush('owner/repo', 'token'), /기존 등록을 확인할 수 없어요/);
  assert.equal(env.writes.length, 1);
});

test('an uncertain secret write leaves a pending local slot, but a rejected write does not', async () => {
  const rejected = makeEnvironment({ saveFails: true });
  await assert.rejects(rejected.api.connectBrowserPush('owner/repo', 'token'));
  assert.equal(rejected.storage.has('browser-push-device'), false);
  const ambiguous = makeEnvironment({ uncertain: true });
  await assert.rejects(ambiguous.api.connectBrowserPush('owner/repo', 'token'), /저장 결과를 확인하지 못했어요/);
  assert.equal(JSON.parse(ambiguous.storage.get('browser-push-device')).updatedAt, null);
});

test('legacy duplicate is checked before deleting a newer slot', async () => {
  const env = makeEnvironment({ used: { WEB_PUSH_SUBSCRIPTION: 'date' } });
  await env.api.connectBrowserPush('owner/repo', 'token');
  env.storage.set('browser-push-registered', JSON.parse(env.storage.get('browser-push-device')).fingerprint);
  const result = await env.api.disconnectBrowserPush('owner/repo', 'token');
  assert.equal(result.remoteRetained, true);
  assert.equal(env.secretNames.WEB_PUSH_SUB_1, 'date');
  assert.equal(env.unsubscribed(), true);
});
