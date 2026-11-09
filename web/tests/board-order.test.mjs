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
