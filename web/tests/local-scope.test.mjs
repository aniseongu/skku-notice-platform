import assert from 'node:assert/strict';
import test from 'node:test';
import { setLocalOwner, localKey } from '../src/local-scope.ts';
import { loadSaved, storeSaved } from '../src/saved-notices.ts';
import { loadReadState, storeReadState, setReadState, parseReadState } from '../src/read-notices.ts';

test('saved and read data remain separate across two users and a logged-out browser', () => {
  const values = new Map();
  globalThis.localStorage = { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  const item = { id: 'a', source_id: 'source', article_no: '1', title: 'A', url: 'https://example.com', posted_on: '2026-01-01', saved_at: '2026-01-01' };
  setLocalOwner('user-a');
  storeSaved([item]);
  storeReadState(setReadState(parseReadState(null), ['a'], true, 123));
  setLocalOwner('user-b');
  assert.deepEqual(loadSaved(), []);
  assert.equal(loadReadState(), null);
  assert.notEqual(localKey('keywords'), 'platform:user:user-a:keywords');
  setLocalOwner(null);
  assert.deepEqual(loadSaved(), []);
  assert.equal(loadReadState(), null);
  setLocalOwner('user-a');
  assert.equal(loadSaved()[0].id, 'a');
  assert.equal(loadReadState().entries.a, 123);
  delete globalThis.localStorage;
});
