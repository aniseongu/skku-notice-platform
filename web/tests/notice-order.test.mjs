import test from 'node:test';
import assert from 'node:assert/strict';
import { orderNotices } from '../src/notice-order.ts';

const now = Date.parse('2026-11-03T12:00:00+09:00');
const notices = [
  { id: 'ended-old', posted_on: '2026-10-01', deadline: '2026-10-30T12:00:00+09:00' },
  { id: 'unknown', posted_on: '2026-11-03', deadline: null },
  { id: 'later', posted_on: '2026-11-01', deadline: '2026-12-01T12:00:00+09:00' },
  { id: 'soon', posted_on: '2026-11-02', deadline: '2026-11-04T12:00:00+09:00' },
  { id: 'ended-recent', posted_on: '2026-10-31', deadline: '2026-11-02T12:00:00+09:00' },
];

test('deadline ordering preserves unknown and ended notices at the end', () => {
  const before = [...notices];
  const ordered = orderNotices(notices, 'deadline', now);
  assert.deepEqual(ordered.map(n => n.id), ['soon', 'later', 'unknown', 'ended-recent', 'ended-old']);
  assert.deepEqual(notices, before);
});

test('latest ordering preserves all notices regardless of deadline', () => {
  assert.deepEqual(orderNotices(notices, 'latest', now).map(n => n.id),
    ['unknown', 'soon', 'later', 'ended-recent', 'ended-old']);
});
