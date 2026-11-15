import assert from 'node:assert/strict';
import test from 'node:test';
import { createEnableChain, disableDevicePush, enableDevicePush, inspectDevicePush, releaseDevicePush } from '../src/platform-browser-push.ts';

const publicKey = Buffer.concat([Buffer.from([4]), Buffer.alloc(64, 1)]).toString('base64url');
function fixture({ owner = null, saveError = null, deleteError = null, endpoint = null } = {}) {
  const values = new Map(owner ? [['platform:push-owner', owner]] : []);
  if (endpoint) values.set('platform:push-endpoint', endpoint);
  const storage = { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key) };
  let current = null, unsubscribed = 0, serial = 0;
  const records = [];
  const deleted = [];
  function makeSubscription(url = `https://fcm.googleapis.com/fcm/send/test-${++serial}`) {
    return { endpoint: url, options: { applicationServerKey: null },
      toJSON: () => ({ endpoint: url, keys: { p256dh: 'public', auth: 'auth' } }),
      unsubscribe: async () => { unsubscribed++; current = null; return true; } };
  }
  const registration = { pushManager: { getSubscription: async () => current,
    subscribe: async () => { current = makeSubscription(); return current; } } };
  const client = { from() {
    const filters = {};
    let mode = 'select';
    const query = { upsert: async (row) => { records.push(row); return { error: saveError }; },
      select: () => query, delete: () => { mode = 'delete'; return query; }, eq: (column, value) => { filters[column] = value; return query; },
      maybeSingle: async () => ({ data: records.some((row) => row.user_id === filters.user_id && row.endpoint === filters.endpoint) ? { id: 'device' } : null, error: null }),
      then: (resolve, reject) => {
        if (mode === 'delete' && !deleteError) { deleted.push(filters.endpoint); for (let i = records.length - 1; i >= 0; i--) if (records[i].endpoint === filters.endpoint) records.splice(i, 1); }
        return Promise.resolve({ error: deleteError }).then(resolve, reject);
      } };
    return query;
  } };
  return { storage, registration, client, records, values, deleted, makeSubscription,
    setCurrent: (value) => { current = value; }, getCurrent: () => current, getUnsubscribed: () => unsubscribed };
}

test('registers a browser device for its owner and can inspect it', async () => {
  const f = fixture();
  await enableDevicePush(f.client, 'a', f.registration, f.storage, publicKey, async () => 'granted');
  assert.equal(f.records[0].user_id, 'a');
  assert.equal(f.values.get('platform:push-owner'), 'a');
  assert.equal(await inspectDevicePush(f.client, 'a', f.registration, f.storage), true);
});

test('account switch removes the prior browser subscription before registration', async () => {
  const f = fixture({ owner: 'a' });
  f.setCurrent(f.makeSubscription());
  await enableDevicePush(f.client, 'b', f.registration, f.storage, publicKey, async () => 'granted');
  assert.equal(f.getUnsubscribed(), 1);
  assert.equal(f.records[0].user_id, 'b');
  assert.equal(f.values.get('platform:push-owner'), 'b');
});

test('failed server registration removes newly created local subscription', async () => {
  const f = fixture({ saveError: new Error('offline') });
  await assert.rejects(enableDevicePush(f.client, 'a', f.registration, f.storage, publicKey, async () => 'granted'), /offline/);
  assert.equal(f.getUnsubscribed(), 1);
  assert.equal(f.values.has('platform:push-owner'), false);
});

test('disable stops the local device even when server cleanup fails', async () => {
  const f = fixture({ owner: 'a', deleteError: new Error('offline') });
  f.setCurrent(f.makeSubscription());
  assert.equal(await disableDevicePush(f.client, 'a', f.registration, f.storage), false);
  assert.equal(f.getUnsubscribed(), 1);
  assert.equal(f.values.has('platform:push-owner'), false);
});

test('release drops only the previous owner device locally without touching the server', async () => {
  const f = fixture({ owner: 'a' });
  f.setCurrent(f.makeSubscription());
  await releaseDevicePush('a', f.registration, f.storage);
  assert.equal(f.getUnsubscribed(), 1);
  assert.equal(f.values.has('platform:push-owner'), false);
  assert.equal(f.records.length, 0);
});

test('release leaves a device owned by another account alone', async () => {
  const f = fixture({ owner: 'b' });
  f.setCurrent(f.makeSubscription());
  await releaseDevicePush('a', f.registration, f.storage);
  assert.equal(f.getUnsubscribed(), 0);
  assert.equal(f.values.get('platform:push-owner'), 'b');
});

test('enable chain resumes at the failed server step without asking permission or subscribing again', async () => {
  const f = fixture();
  let permissionAsks = 0, subscribes = 0, saves = 0, failSave = true;
  const registration = { pushManager: { getSubscription: async () => f.registration.pushManager.getSubscription(),
    subscribe: async (options) => { subscribes++; return f.registration.pushManager.subscribe(options); } } };
  const client = { from: () => ({ upsert: async (row) => { saves++; if (failSave) return { error: new Error('offline') }; f.records.push(row); return { error: null }; } }) };
  const chain = createEnableChain(client, 'a', registration, f.storage, publicKey, async () => { permissionAsks++; return 'granted'; });
  await assert.rejects(chain.run(), /offline/);
  assert.equal(f.values.has('platform:push-owner'), false);
  failSave = false;
  await chain.run();
  assert.deepEqual([permissionAsks, subscribes, saves], [1, 1, 2]);
  assert.equal(f.values.get('platform:push-owner'), 'a');
  await chain.discard();
  assert.equal(f.getUnsubscribed(), 0);
});

test('discard removes a subscription that never reached the server', async () => {
  const f = fixture({ saveError: new Error('offline') });
  const chain = createEnableChain(f.client, 'a', f.registration, f.storage, publicKey, async () => 'granted');
  await assert.rejects(chain.run(), /offline/);
  await chain.discard();
  assert.equal(f.getUnsubscribed(), 1);
});

const heal = { vapidKey: publicKey, permission: 'granted' };

test('app update that loses the browser subscription is re-registered silently on next open', async () => {
  const f = fixture();
  await enableDevicePush(f.client, 'a', f.registration, f.storage, publicKey, async () => 'granted');
  const first = f.records[0].endpoint;
  f.setCurrent(null);   // 업데이트 뒤 브라우저가 구독을 잃었다
  f.records.length = 0; // 서버도 410으로 정리했다
  assert.equal(await inspectDevicePush(f.client, 'a', f.registration, f.storage, heal), true);
  assert.equal(f.records.length, 1);
  assert.notEqual(f.records[0].endpoint, first);
  assert.equal(f.values.get('platform:push-endpoint'), f.records[0].endpoint);
});

test('a browser-replaced subscription is uploaded and the dead address removed', async () => {
  const f = fixture();
  await enableDevicePush(f.client, 'a', f.registration, f.storage, publicKey, async () => 'granted');
  const old = f.records[0].endpoint;
  f.setCurrent(f.makeSubscription());   // 서비스 워커가 pushsubscriptionchange에서 새로 만들었다
  assert.equal(await inspectDevicePush(f.client, 'a', f.registration, f.storage, heal), true);
  assert.deepEqual(f.deleted, [old]);
  assert.equal(f.records.at(-1).endpoint, f.getCurrent().endpoint);
});

test('a device deleted from another device list is not revived', async () => {
  const f = fixture();
  await enableDevicePush(f.client, 'a', f.registration, f.storage, publicKey, async () => 'granted');
  f.records.length = 0;   // 다른 기기에서 이 기기를 지웠다. 브라우저 구독은 그대로다.
  assert.equal(await inspectDevicePush(f.client, 'a', f.registration, f.storage, heal), false);
  assert.equal(f.records.length, 0);
});

test('no silent re-registration without permission, for another owner, or after turning off', async () => {
  for (const [owner, permission] of [['a', 'default'], ['b', 'granted'], [null, 'granted']]) {
    const f = fixture({ owner });
    assert.equal(await inspectDevicePush(f.client, 'a', f.registration, f.storage, { vapidKey: publicKey, permission }), false);
    assert.equal(f.records.length, 0);
  }
});

test('turning on replaces a leftover subscription that the server does not know', async () => {
  const f = fixture({ owner: 'a' });
  const stale = f.makeSubscription();
  f.setCurrent(stale);
  await enableDevicePush(f.client, 'a', f.registration, f.storage, publicKey, async () => 'granted');
  assert.equal(f.getUnsubscribed(), 1);
  assert.notEqual(f.records[0].endpoint, stale.endpoint);
  assert.deepEqual(f.deleted, [stale.endpoint]);
});

test('a browser that never answers does not leave the check hanging', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = fixture({ owner: 'a' });
  const registration = { pushManager: { getSubscription: () => new Promise(() => {}) } };
  const pending = inspectDevicePush(f.client, 'a', registration, f.storage, heal);
  t.mock.timers.tick(10_000);
  await assert.rejects(pending, /알림 상태를 확인하지 못했어요/);
});

test('turning on does not wait forever for a dead subscription that never finishes unsubscribing', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = fixture({ owner: 'a' });
  const stale = { ...f.makeSubscription(), unsubscribe: () => new Promise(() => {}) };
  f.setCurrent(stale);
  const pending = enableDevicePush(f.client, 'a', f.registration, f.storage, publicKey, async () => 'granted');
  for (let i = 0; i < 5; i++) { await new Promise((resolve) => setImmediate(resolve)); t.mock.timers.tick(10_000); }
  await pending;
  assert.equal(f.records.length, 1);
  assert.notEqual(f.records[0].endpoint, stale.endpoint);
});

test('deviceEndpoint gives up quietly when the browser never answers', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { deviceEndpoint } = await import('../src/platform-browser-push.ts');
  const pending = deviceEndpoint({ pushManager: { getSubscription: () => new Promise(() => {}) } });
  t.mock.timers.tick(10_000);
  assert.equal(await pending, '');
});

test('a permission prompt that never shows stops waiting and says where to allow it', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { permissionHelp } = await import('../src/platform-browser-push.ts');
  const f = fixture();
  const pending = enableDevicePush(f.client, 'a', f.registration, f.storage, publicKey, () => new Promise(() => {}));
  t.mock.timers.tick(10_000);
  await assert.rejects(pending, /알림 허용 창이 뜨지 않았어요/);
  assert.equal(f.records.length, 0);
  assert.match(permissionHelp('Mozilla/5.0 (Linux; Android 10; K) SamsungBrowser/29.0 Chrome/130 Mobile'), /삼성 인터넷 메뉴 → 설정 → 사이트 및 다운로드 → 사이트 알림/);
});
