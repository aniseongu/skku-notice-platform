import assert from 'node:assert/strict';
import test from 'node:test';
import { readSavedSecrets, rememberSavedSecrets } from '../src/settings-storage.ts';

test('saved-key metadata survives refresh without storing key values', () => {
  const storage = new Map();
  globalThis.localStorage = {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value),
  };
  const date = '2026-11-02T14:00:00Z';
  rememberSavedSecrets('owner/repo', { GEMINI_API_KEY: date, RAW_KEY: 'not-a-date', bad_name: date });
  assert.deepEqual(readSavedSecrets('owner/repo'), { GEMINI_API_KEY: date });
  assert.deepEqual(readSavedSecrets('other/repo'), {});
  assert.equal([...storage.values()].some((value) => value.includes('not-a-date')), false);
  storage.set('saved-secrets:owner/repo', '{broken');
  assert.deepEqual(readSavedSecrets('owner/repo'), {});
  delete globalThis.localStorage;
});
