import assert from 'node:assert/strict';
import test from 'node:test';
import { disableDevicePush, enableDevicePush, inspectDevicePush } from '../src/platform-browser-push.ts';

const publicKey = Buffer.concat([Buffer.from([4]), Buffer.alloc(64, 1)]).toString('base64url');
function fixture({ owner = null, saveError = null, deleteError = null } = {}) {
  const values = new Map(owner ? [['platform:push-owner', owner]] : []);
  const storage = { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key) };
  let current = null, unsubscribed = 0;
  const records = [];
  function makeSubscription() {
    return { endpoint: 'https://fcm.googleapis.com/fcm/send/test', options: { applicationServerKey: null },
      toJSON: () => ({ endpoint: 'https://fcm.googleapis.com/fcm/send/test', keys: { p256dh: 'public', auth: 'auth' } }),
      unsubscribe: async () => { unsubscribed++; current = null; return true; } };
  }
  const registration = { pushManager: { getSubscription: async () => current,
    subscribe: async () => { current = makeSubscription(); return current; } } };
  const client = { from() {
    const query = { upsert: async (row) => { records.push(row); return { error: saveError }; },
      select: () => query, delete: () => query, eq: () => query,
      maybeSingle: async () => ({ data: records.length ? { id: 'device' } : null, error: null }),
      then: (resolve) => resolve({ error: deleteError }) };
    return query;
  } };
  return { storage, registration, client, records, values, makeSubscription,
    setCurrent: (value) => { current = value; }, getUnsubscribed: () => unsubscribed };
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
