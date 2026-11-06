import assert from 'node:assert/strict';
import test from 'node:test';
import { READ_LIMIT, addRead, isNoticeRead, mergeRead, parseRead, parseReadState, readIds,
  mergeReadStates, serializeReadState, setReadState } from '../src/read-notices.ts';

test('editing a read notice makes it unread until a device reads the edit', () => {
  const edit = '2026-11-06T12:00:00+09:00';
  const at = Date.parse(edit);
  const old = setReadState(parseReadState(null), ['school/1'], true, at - 1000);
  assert.equal(isNoticeRead(old, 'school/1', null), true);
  assert.equal(isNoticeRead(old, 'school/1', edit), false);
  const updated = setReadState(old, ['school/1'], true, at + 1000);
  assert.equal(isNoticeRead(mergeReadStates(old, updated), 'school/1', edit), true);
  assert.equal(isNoticeRead(mergeReadStates(updated, old), 'school/1', edit), true);
  assert.equal(isNoticeRead(updated, 'school/1', '2026-11-06T12:01:00+09:00'), false);
  assert.equal(isNoticeRead(setReadState(updated, ['school/1'], false, at + 2000), 'school/1', edit), false);
  assert.equal(isNoticeRead(parseReadState('["school/1"]'), 'school/1', edit), false);
  assert.equal(isNoticeRead(updated, 'school/1', 'invalid'), true);
});

test('reading keeps the latest ids only and moves a re-read id to the end', () => {
  let ids = [];
  for (let i = 0; i < READ_LIMIT + 5; i += 1) ids = addRead(ids, `n${i}`);
  assert.equal(ids.length, READ_LIMIT);
  assert.equal(ids[0], 'n5');
  assert.deepEqual(addRead(['a', 'b'], 'a'), ['b', 'a']);
});

test('merging two devices never loses a read notice', () => {
  assert.deepEqual(mergeRead(['a', 'b'], ['b', 'c']), ['a', 'b', 'c']);
  assert.deepEqual(parseRead('{broken'), []);
  assert.deepEqual(parseRead('["a", 1, "b"]'), ['a', 'b']);
});

test('batch reading preserves existing ids and bounds storage', () => {
  const existing = Array.from({ length: READ_LIMIT }, (_, i) => `n${i}`);
  const result = mergeRead(existing, ['n799', 'new1', 'new2', 'new1']);
  assert.equal(result.length, READ_LIMIT);
  assert.deepEqual(result.slice(-3), ['n799', 'new1', 'new2']);
  assert.equal(result.filter(id => id === 'new1').length, 1);
});

test('an explicit unread operation survives merging a stale legacy device in either direction', () => {
  const legacy = parseReadState('["a","b"]');
  const changed = setReadState(legacy, ['a'], false, 100);
  for (const merged of [mergeReadStates(legacy, changed), mergeReadStates(changed, legacy)]) {
    assert.deepEqual(readIds(merged), ['b']);
    assert.equal(merged.entries.a, -100);
  }
  const again = setReadState(changed, ['a'], true, 101);
  assert.deepEqual(new Set(readIds(mergeReadStates(changed, again))), new Set(['a', 'b']));
});

test('operations resolve deterministically at equal timestamps and advance when the clock goes backwards', () => {
  const read = setReadState(parseReadState(null), ['a'], true, 100);
  const unread = setReadState(parseReadState(null), ['a'], false, 100);
  assert.deepEqual(readIds(mergeReadStates(read, unread)), []);
  assert.deepEqual(readIds(mergeReadStates(unread, read)), []);
  assert.equal(setReadState(unread, ['a'], true, 90).entries.a, 101);
});

test('serialized state remains within the variable limit, including Unicode and tombstones', () => {
  const ids = Array.from({ length: READ_LIMIT + 50 }, (_, i) => `${'한글'.repeat(30)}${i}`);
  const state = setReadState(parseReadState(null), ids, false, 500);
  const raw = serializeReadState(state);
  assert.ok(new TextEncoder().encode(raw).length <= 45_000);
  assert.ok(Object.keys(parseReadState(raw).entries).length <= READ_LIMIT);
  assert.deepEqual(readIds(parseReadState(raw)), []);
  assert.deepEqual(parseRead(raw), []);
});

test('malformed states are ignored without modifying object prototypes', () => {
  const state = parseReadState('{"v":2,"entries":{"__proto__":-10,"a":"bad","b":10}}');
  assert.equal(state.entries.__proto__, -10);
  assert.deepEqual(readIds(state), ['b']);
  assert.equal({}.polluted, undefined);
});
