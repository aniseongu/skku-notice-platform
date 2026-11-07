import assert from 'node:assert/strict';
import test from 'node:test';
import { loadNoticeStates, planStateSync, pushRead, pushSaved } from '../src/notice-state-sync.ts';

const notice = (id) => ({ id, source_id: 's', article_no: id, title: id, url: 'https://www.skku.edu/x', posted_on: '2026-11-01', first_seen: null });
const saved = (id) => ({ ...notice(id), first_seen: undefined, saved_at: '2026-11-02T00:00:00Z' });
const read = (entries) => ({ v: 2, entries });

test('loads only own saved and read rows into state', async () => {
  const calls = [];
  const query = { select: () => query, eq: (...a) => { calls.push(a); return query; }, or: () => query, order: () => query,
    limit: async () => ({ error: null, data: [
      { notice_id: 's/1', is_saved: true, read_at: null },
      { notice_id: 's/2', is_saved: false, read_at: '2026-11-03T00:00:00Z' }] }) };
  const state = await loadNoticeStates({ from: () => query }, 'user-a');
  assert.deepEqual(calls, [['user_id', 'user-a']]);
  assert.deepEqual([...state.savedIds], ['s/1']);
  assert.equal(state.read.entries['s/2'], Date.parse('2026-11-03T00:00:00Z'));
});

test('plan imports remote saves that are visible and uploads explicit local changes', () => {
  const remote = { savedIds: new Set(['s/1', 's/gone']), read: read({ 's/r': 500 }) };
  const plan = planStateSync(remote, [saved('s/local')], read({ 's/new': 900, 's/base': 0, 's/r': 500, 's/off': -700 }),
    [notice('s/1'), notice('s/local')]);
  assert.deepEqual(plan.saved.map((x) => x.id).sort(), ['s/1', 's/local']);
  assert.deepEqual(plan.uploadSaved, [{ id: 's/local', saved: true }]);
  assert.deepEqual(plan.uploadRead, [{ id: 's/new', read: true }]);
});

test('newer local unread operation is uploaded when the server says read', () => {
  const plan = planStateSync({ savedIds: new Set(), read: read({ 's/a': 100 }) }, [], read({ 's/a': -200 }), []);
  assert.deepEqual(plan.uploadRead, [{ id: 's/a', read: false }]);
  assert.equal(plan.read.entries['s/a'], -200);
});

test('a newer remote read wins over an older local unread and is not uploaded', () => {
  const plan = planStateSync({ savedIds: new Set(), read: read({ 's/a': 300 }) }, [], read({ 's/a': -200 }), []);
  assert.deepEqual(plan.uploadRead, []);
  assert.equal(plan.read.entries['s/a'], 300);
});

test('push reports partial failure instead of hiding it', async () => {
  const seen = [];
  const client = { rpc: async (name, args) => { seen.push([name, args]); return { error: args.p_notice_id === 'bad' ? new Error('x') : null }; } };
  assert.equal(await pushSaved(client, [{ id: 'a', saved: true }, { id: 'bad', saved: true }]), false);
  assert.equal(await pushRead(client, [{ id: 'a', read: false }]), true);
  assert.deepEqual(seen.at(-1), ['set_notice_read', { p_notice_id: 'a', p_read: false }]);
});
