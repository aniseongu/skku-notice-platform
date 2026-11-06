import test from 'node:test';
import assert from 'node:assert/strict';
import { keywordCounts } from '../src/keyword-counts.ts';

test('counts matching notices regardless of read status without duplicating the total', () => {
  const items = [
    { id: 1, read: false, words: ['인턴', '장학', '인턴'] },
    { id: 2, read: true, words: ['인턴'] },
    { id: 3, read: false, words: ['장학'] },
    { id: 4, read: false, words: ['없는 키워드'] },
  ];
  const count = keywordCounts(items, ['인턴', '장학', '공모전'], x => x.words);
  assert.deepEqual(count, { counts: { 인턴: 2, 장학: 2, 공모전: 0 }, total: 3 });
  items[0].read = true;
  assert.deepEqual(keywordCounts(items, ['인턴', '장학'], x => x.words),
    { counts: { 인턴: 2, 장학: 2 }, total: 3 });
});

test('treats special keyword names as ordinary keys', () => {
  const count = keywordCounts([{}], ['__proto__'], () => ['__proto__']);
  assert.equal(count.counts['__proto__'], 1);
});
