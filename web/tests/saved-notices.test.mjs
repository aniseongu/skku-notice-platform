import assert from 'node:assert/strict';
import test from 'node:test';
import { SAVED_LIMIT_BYTES, applySavedOrder, orderSaved, parseSaved, parseSavedOrder, savedOrderToStore, toggleSaved } from '../src/saved-notices.ts';

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


test('내가 정한 순: 순서에 없는 새 공지는 맨 위, 사라진 id는 무시', () => {
  const items = ['n', 'a', 'b', 'c'].map((id) => ({ id }));      // 저장한 순(최신 먼저): n은 새로 저장한 것
  assert.deepEqual(applySavedOrder(items, ['c', 'gone', 'a', 'b']).map((x) => x.id), ['n', 'c', 'a', 'b']);
  assert.deepEqual(applySavedOrder(items, []).map((x) => x.id), ['n', 'a', 'b', 'c']);
});

test('저장할 순서는 놓은 순서 뒤에 보이지 않던 저장 공지를 붙이고 없는 id를 버린다', () => {
  assert.deepEqual(savedOrderToStore(['b', 'a', 'x'], ['a', 'b', 'c', 'd']), ['b', 'a', 'c', 'd']);
  assert.equal(savedOrderToStore(Array.from({ length: 300 }, (_, i) => `n${i}`), Array.from({ length: 300 }, (_, i) => `n${i}`)).length, 200);
  assert.deepEqual(parseSavedOrder(['a', 1, 'a', '', 'b']), ['a', 'b']);
});

test('orderSaved custom 정렬이 직접 정한 순서를 쓰고 순서가 없으면 저장한 순이다', () => {
  const saved = [{ id: 'a', saved_at: '2026-01-01' }, { id: 'b', saved_at: '2026-01-03' }, { id: 'c', saved_at: '2026-01-02' }];
  const base = (id) => ({ id, source_id: 's', article_no: id, title: id, url: 'https://x', posted_on: '2026-01-01', deadline: null });
  const items = saved.map((s) => ({ ...base(s.id), saved_at: s.saved_at }));
  assert.deepEqual(orderSaved(items, [], 'custom', ['a', 'c', 'b']).map((n) => n.id), ['a', 'c', 'b']);
  assert.deepEqual(orderSaved(items, [], 'custom', []).map((n) => n.id), ['b', 'c', 'a']);
});
