import assert from 'node:assert/strict';
import test from 'node:test';
import { loadSubscriptions, setSubscription } from '../src/source-subscriptions.ts';

function fakeClient(result = { data: [], error: null }) {
  const calls = [];
  const query = {
    select: (...args) => { calls.push(['select', ...args]); return query; },
    eq: (...args) => { calls.push(['eq', ...args]); return query; },
    order: async (...args) => { calls.push(['order', ...args]); return result; },
    upsert: async (...args) => { calls.push(['upsert', ...args]); return result; },
    delete: () => { calls.push(['delete']); return query; },
    then: (resolve) => resolve(result),
  };
  return { calls, from: (table) => { calls.push(['from', table]); return query; } };
}

test('loads only the current user subscription identifiers', async () => {
  const client = fakeClient({ data: [{ source_id: 'school' }], error: null });
  assert.deepEqual(await loadSubscriptions(client, 'user-a'), ['school']);
  assert.ok(client.calls.some((call) => call[0] === 'eq' && call[1] === 'user_id' && call[2] === 'user-a'));
});

test('subscription changes include owner and source and report errors', async () => {
  const client = fakeClient();
  await setSubscription(client, 'user-a', 'school', true);
  assert.deepEqual(client.calls.find((call) => call[0] === 'upsert')[1], { user_id: 'user-a', source_id: 'school' });
  client.calls.length = 0;
  await setSubscription(client, 'user-a', 'school', false);
  assert.deepEqual(client.calls.filter((call) => call[0] === 'eq'), [['eq', 'user_id', 'user-a'], ['eq', 'source_id', 'school']]);
  await assert.rejects(setSubscription(fakeClient({ data: null, error: new Error('unavailable') }), 'user-a', 'school', true), /unavailable/);
});
