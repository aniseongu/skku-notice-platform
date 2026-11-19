import assert from 'node:assert/strict';
import test from 'node:test';
import { loadSavedOrderPreference, parseKeywords } from '../src/preferences.ts';

test('normalizes keywords and enforces account preference limits', () => {
  assert.deepEqual(parseKeywords(' 장학, 취업\n장학\n'), ['장학', '취업']);
  assert.deepEqual(parseKeywords(' , \n '), []);
  assert.throws(() => parseKeywords(Array.from({ length: 21 }, (_, i) => `단어${i}`).join(',')), /20개/);
  assert.throws(() => parseKeywords('가'.repeat(81)), /80자/);
});

const fakeClient = (error, data = null) => ({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data, error }) }) }) }) });

test('saved order: only a missing column means unavailable; other errors are transient and thrown', async () => {
  assert.deepEqual(await loadSavedOrderPreference(fakeClient({ code: '42703' }), 'u'), { available: false, order: [] });
  await assert.rejects(loadSavedOrderPreference(fakeClient({ code: '57014', message: 'timeout' }), 'u'));
  assert.deepEqual(await loadSavedOrderPreference(fakeClient(null, { saved_order: ['a', 'a', 'b'] }), 'u'), { available: true, order: ['a', 'b'] });
});
