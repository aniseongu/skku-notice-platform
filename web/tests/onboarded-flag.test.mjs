import assert from 'node:assert/strict';
import test from 'node:test';
import { isRememberedOnboarded, rememberOnboarded, onboardedKey } from '../src/onboarded-flag.ts';

test('onboarded flag is per account and tolerates unavailable storage', () => {
  const values = new Map();
  globalThis.localStorage = { getItem: (k) => values.get(k) ?? null, setItem: (k, v) => values.set(k, v), removeItem: (k) => values.delete(k) };
  rememberOnboarded('a', true);
  assert.equal(isRememberedOnboarded('a'), true);
  assert.equal(isRememberedOnboarded('b'), false);
  assert.equal(isRememberedOnboarded(null), false);
  assert.notEqual(onboardedKey('a'), onboardedKey('b'));
  rememberOnboarded('a', false);
  assert.equal(isRememberedOnboarded('a'), false);
  globalThis.localStorage = { getItem() { throw new Error('x'); }, setItem() { throw new Error('x'); }, removeItem() { throw new Error('x'); } };
  assert.equal(isRememberedOnboarded('a'), false);
  rememberOnboarded('a', true);
});
