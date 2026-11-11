import assert from 'node:assert/strict';
import test from 'node:test';
import { dropDuplicates } from '../src/dup-notices.ts';

const notice = (id, key, seen, posted = '2026-11-10') => ({ id, source_id: id.split('/')[0], article_no: '1', title: 't', category: null, url: 'https://x', posted_on: posted, pinned: false, deadline: null, first_seen: seen, dup_key: key });

test('같은 열쇠의 글은 가장 먼저 감지된 글 하나만 남긴다', () => {
  const list = [notice('biz/1', 's:a', '2026-11-11T01:00Z', '2026-11-11'), notice('skku/1', 's:a', '2026-11-10T01:00Z'), notice('cse/1', 's:b', '2026-11-10T05:00Z')];
  assert.deepEqual(dropDuplicates(list).map((n) => n.id), ['skku/1', 'cse/1']);
});

test('같은 시각에 감지됐으면 번호가 앞선 글이 대표다', () => {
  const list = [notice('b/1', 'x:a', '2026-11-10T01:00Z'), notice('a/1', 'x:a', '2026-11-10T01:00Z')];
  assert.deepEqual(dropDuplicates(list).map((n) => n.id), ['a/1']);
});

test('게시일이 3일 넘게 떨어지면 다른 글이고, 열쇠가 없으면 합치지 않는다', () => {
  assert.equal(dropDuplicates([notice('a/1', 'x:a', '2026-11-10T01:00Z'), notice('b/1', 'x:a', '2026-11-20T01:00Z', '2026-11-20')]).length, 2);
  assert.equal(dropDuplicates([notice('a/1', null, '2026-11-10T01:00Z'), notice('b/1', null, '2026-11-10T02:00Z')]).length, 2);
});

test('이 목록에 없는 게시판의 글은 대표가 되지 못한다(목록 안에서만 묶는다)', () => {
  const visible = [notice('biz/1', 's:a', '2026-11-11T01:00Z', '2026-11-11')];   // skku/1은 구독하지 않아 목록에 없다
  assert.deepEqual(dropDuplicates(visible).map((n) => n.id), ['biz/1']);
});
