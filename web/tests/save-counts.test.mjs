import test from 'node:test';
import assert from 'node:assert/strict';
import { loadSaveCounts } from '../src/save-counts.ts';

test('counts are batched and absent function is silent', async () => {
  const calls = [];
  const client = { rpc: async (_name, { p_ids }) => { calls.push(p_ids); return { data: [{ notice_id: p_ids[0], saves: 2 }], error: null }; } };
  const ids = Array.from({ length: 501 }, (_, i) => String(i));
  const counts = await loadSaveCounts(client, ids);
  assert.deepEqual(calls.map((batch) => batch.length), [500, 1]);
  assert.equal(counts.get('0'), 2);
  assert.equal(counts.get('1'), 0);
  assert.equal(counts.get('500'), 2);
  assert.equal(await loadSaveCounts({ rpc: async () => ({ error: {} }) }, ['x']), null);
});
