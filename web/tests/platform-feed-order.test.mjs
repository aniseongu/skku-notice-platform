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

test('a paused board (jasoseol) does not drag the feed time back, while a failing active board still does', async () => {
  const feedWith = async (rows) => {
    const notices = { select: () => notices, order: () => notices, limit: async () => ({ data: [{ id: 'a/1' }], error: null }) };
    const sources = { select: () => sources, order: async () => ({ data: rows, error: null }) };
    return loadPublicFeed({ from: (table) => (table === 'platform_notices' ? notices : sources) });
  };
  const school = { id: 'cse-notice', name: 'A', url: 'https://x.test', last_success_at: '2026-11-24T08:00:00+09:00' };
  const paused = { id: 'jasoseol-intern', name: '자소설닷컴', url: 'https://x.test', external: true, last_success_at: '2026-11-23T15:00:00+09:00' };
  assert.equal((await feedWith([school, paused])).generated_at, school.last_success_at);
  const failing = { ...paused, id: 'linkareer-intern' };
  assert.equal((await feedWith([school, failing])).generated_at, failing.last_success_at);
});
