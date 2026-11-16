import test from 'node:test';
import assert from 'node:assert/strict';
import { pushSheetDismissed, pushSheetDue } from '../src/push-sheet-rule.ts';

const DAY = 24 * 60 * 60 * 1000;
const NOW = 1_000_000_000_000;

test('기록이 없으면 보인다', () => assert.equal(pushSheetDue(null, NOW), true));
test('깨진 기록은 보이지 않는다', () => {
  assert.equal(pushSheetDue('abc', NOW), false);
  assert.equal(pushSheetDue('1:x', NOW), false);
  assert.equal(pushSheetDue('0:5', NOW), false);
});
test('한 번 닫으면 3일, 두 번이면 7일, 세 번 이후는 30일 뒤에 다시 보인다', () => {
  assert.equal(pushSheetDue(`1:${NOW - 3 * DAY + 1}`, NOW), false);
  assert.equal(pushSheetDue(`1:${NOW - 3 * DAY}`, NOW), true);
  assert.equal(pushSheetDue(`2:${NOW - 6 * DAY}`, NOW), false);
  assert.equal(pushSheetDue(`2:${NOW - 7 * DAY}`, NOW), true);
  assert.equal(pushSheetDue(`3:${NOW - 29 * DAY}`, NOW), false);
  assert.equal(pushSheetDue(`9:${NOW - 30 * DAY}`, NOW), true);
});
test('닫으면 횟수가 늘고 시각이 남는다', () => {
  assert.equal(pushSheetDismissed(null, NOW), `1:${NOW}`);
  assert.equal(pushSheetDismissed(`2:5`, NOW), `3:${NOW}`);
  assert.equal(pushSheetDismissed('broken', NOW), `1:${NOW}`);
});
