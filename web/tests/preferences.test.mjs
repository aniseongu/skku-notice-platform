import assert from 'node:assert/strict';
import test from 'node:test';
import { parseKeywords } from '../src/preferences.ts';

test('normalizes keywords and enforces account preference limits', () => {
  assert.deepEqual(parseKeywords(' 장학, 취업\n장학\n'), ['장학', '취업']);
  assert.deepEqual(parseKeywords(' , \n '), []);
  assert.throws(() => parseKeywords(Array.from({ length: 21 }, (_, i) => `단어${i}`).join(',')), /20개/);
  assert.throws(() => parseKeywords('가'.repeat(81)), /80자/);
});
