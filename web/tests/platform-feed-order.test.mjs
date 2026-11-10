import assert from 'node:assert/strict';
import test from 'node:test';
import { loadPublicFeed } from '../src/platform-data.ts';

test('the public feed asks for notices by posting date, first-seen time and id, newest first (same as the original)', async () => {
  const orders = [];
  const notices = { select: () => notices, order(column, options) { orders.push([column, options.ascending]); return notices; }, limit: async () => ({ data: [{ id: 'a/1' }], error: null }) };
  const sources = { select: () => sources, order: async () => ({ data: [{ id: 'a', name: 'A', url: 'https://x.test', last_success_at: '2026-11-10T00:00:00Z' }], error: null }) };
  const client = { from: (table) => (table === 'platform_notices' ? notices : sources) };
  const feed = await loadPublicFeed(client);
  assert.equal(feed.notices.length, 1);
  assert.deepEqual(orders, [['posted_on', false], ['first_seen', false], ['id', false]]);
});
