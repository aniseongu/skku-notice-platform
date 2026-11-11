import assert from 'node:assert/strict';
import test from 'node:test';
import { dropDuplicates, groupMates } from '../src/dup-notices.ts';

const notice = (id, key, seen, posted = '2026-11-10', text = null) => ({ id, source_id: id.split('/')[0], article_no: '1', title: 't', category: null, url: 'https://x', posted_on: posted, pinned: false, deadline: null, first_seen: seen, dup_key: key, dup_text_key: text });

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

test('제목이 달라도 그림 글자 열쇠가 같으면 같은 글이고, 먼저 감지된 글이 대표다', () => {
  const list = [notice('biz/1', 's:다른제목', '2026-11-11T01:00Z', '2026-11-11', 's:ocr1'), notice('skku/1', 's:제목', '2026-11-10T01:00Z', '2026-11-10', 's:ocr1'), notice('cse/1', 's:또다른', '2026-11-10T03:00Z', '2026-11-10', 's:ocr2')];
  assert.deepEqual(dropDuplicates(list).map((n) => n.id), ['skku/1', 'cse/1']);
});

test('같은 공지로 묶인 글끼리 서로 찾을 수 있고, 묶이지 않은 글은 색인에 없다', () => {
  const list = [notice('skku/1', 's:a', '2026-11-10T01:00Z'), notice('biz/1', 's:a', '2026-11-11T01:00Z', '2026-11-11'), notice('cse/1', 's:b', '2026-11-10T03:00Z'),
    notice('lk/1', null, '2026-11-10T05:00Z', '2026-11-10', 'x:ocr'), notice('ja/1', null, '2026-11-10T06:00Z', '2026-11-10', 'x:ocr')];
  const mates = groupMates(list);
  assert.deepEqual(mates.get('skku/1').map((n) => n.id), ['biz/1']);
  assert.deepEqual(mates.get('biz/1').map((n) => n.id), ['skku/1']);      // 대표가 아니어도 서로 찾는다
  assert.deepEqual(mates.get('lk/1').map((n) => n.id), ['ja/1']);
  assert.equal(mates.has('cse/1'), false);
});
