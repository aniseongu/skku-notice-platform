import assert from 'node:assert/strict';
import test from 'node:test';
import { SAVED_LIMIT_BYTES, orderSaved, parseSaved, toggleSaved } from '../src/saved-notices.ts';

test('saved order uses saved time and deadline order uses current notice data without dropping older items', () => {
  const old = { ...notice('1'), posted_on: '2026-11-01', deadline: null, saved_at: '2026-11-05T01:00:00.000Z' };
  const recent = { ...notice('2'), posted_on: '2026-11-04', deadline: '2999-12-01T00:00:00Z', saved_at: '2026-11-04T01:00:00.000Z' };
  const current = [{ ...notice('1'), deadline: '2999-01-01T00:00:00Z' }];
  assert.deepEqual(orderSaved([recent, old], current, 'latest').map((n) => n.id), ['1', '2']);
  assert.deepEqual(orderSaved([recent, old], current, 'deadline').map((n) => n.id), ['1', '2']);
  assert.deepEqual(orderSaved([recent, old], [], 'deadline').map((n) => n.id), ['2', '1']);
});

const notice = (id) => ({
  id, source_id: 'cse-notice', article_no: id, title: `공지 ${id}`, category: '채용', url: `https://cse.skku.edu/${id}`,
  posted_on: '2026-11-03', pinned: false, deadline: null, first_seen: '2026-11-03T00:00:00Z',
});

test('saving keeps a snapshot so the notice survives leaving the list, and toggling removes it', () => {
  const saved = toggleSaved([], notice('1'), new Date('2026-11-03T01:00:00Z'));
  assert.equal(saved.length, 1);
  assert.equal(saved[0].title, '공지 1');
  assert.equal(saved[0].saved_at, '2026-11-03T01:00:00.000Z');
  assert.equal('first_seen' in saved[0], false);
  assert.deepEqual(toggleSaved(saved, notice('1')), []);
});

test('refuses to grow past the GitHub variable size limit', () => {
  let saved = [];
  for (let i = 0; saved !== null; i += 1) {
    const next = toggleSaved(saved, notice(String(i)));
    if (next === null) break;
    saved = next;
  }
  assert.ok(new TextEncoder().encode(JSON.stringify(saved)).length <= SAVED_LIMIT_BYTES);
  assert.ok(saved.length > 100);
});

test('ignores broken or tampered saved data', () => {
  assert.deepEqual(parseSaved('{broken'), []);
  assert.deepEqual(parseSaved('{"a":1}'), []);
  assert.equal(parseSaved(JSON.stringify([{ id: 1 }, toggleSaved([], notice('2'))[0]])).length, 1);
});
