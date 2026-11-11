import test from 'node:test';
import assert from 'node:assert/strict';
import { applyBoardOrder, moveBoardId, parseBoardOrder } from '../src/board-order.ts';

const catalog = ['a', 'b', 'c', 'd'].map((id) => ({ id }));

test('saved order is applied first', () => {
  assert.deepEqual(applyBoardOrder(catalog, ['c', 'a']).map((x) => x.id), ['c', 'a', 'b', 'd']);
});

test('unknown and repeated ids are ignored', () => {
  assert.deepEqual(applyBoardOrder(catalog, ['x', 'd', 'd', 'y']).map((x) => x.id), ['d', 'a', 'b', 'c']);
});

test('new boards follow in catalog order and an empty order keeps the catalog', () => {
  assert.deepEqual(applyBoardOrder(catalog, ['b']).map((x) => x.id), ['b', 'a', 'c', 'd']);
  assert.deepEqual(applyBoardOrder(catalog, []).map((x) => x.id), ['a', 'b', 'c', 'd']);
});

test('moveBoardId moves one item and ignores out of range', () => {
  assert.deepEqual(moveBoardId(['a', 'b', 'c'], 0, 2), ['b', 'c', 'a']);
  assert.deepEqual(moveBoardId(['a', 'b', 'c'], 2, 1), ['a', 'c', 'b']);
  assert.deepEqual(moveBoardId(['a', 'b'], 0, 5), ['a', 'b']);
});

test('parseBoardOrder keeps only unique strings', () => {
  assert.deepEqual(parseBoardOrder(['a', 1, 'a', '', 'b']), ['a', 'b']);
  assert.deepEqual(parseBoardOrder(null), []);
});

test('저장된 순서가 없으면 성균관대 > 대학 > 학과 > 기타 순서로 놓고, 같은 구분 안에서는 원래 순서를 지킨다', async () => {
  const { applyBoardOrder } = await import('../src/board-order.ts');
  const boards = [
    { id: 'futurecar-notice', name: '미래차 부트캠프 공지' }, { id: 'sw-dept', name: '소프트웨어학과' }, { id: 'ai-notice', name: '인공지능학과' },
    { id: 'swcol', name: '소프트웨어융합대학' }, { id: 'skku-notice01', name: '성균관대' }, { id: 'biz-notice', name: '경영대학 공지' },
  ];
  assert.deepEqual(applyBoardOrder(boards, []).map((x) => x.id), ['skku-notice01', 'swcol', 'biz-notice', 'sw-dept', 'ai-notice', 'futurecar-notice']);
  // 저장된 순서가 있으면 그 순서가 먼저다.
  assert.deepEqual(applyBoardOrder(boards, ['ai-notice']).map((x) => x.id)[0], 'ai-notice');
});
