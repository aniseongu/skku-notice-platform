import assert from 'node:assert/strict';
import test from 'node:test';
import { missingAlertColumn } from '../src/devices.ts';

test('only an undefined-column error for alert_all_new counts as a missing column', () => {
  assert.equal(missingAlertColumn({ code: '42703', message: 'column user_push_subscriptions.alert_all_new does not exist' }), true);
  // 권한 오류처럼 다른 오류는 열이 없다고 보지 않는다(설정을 잃지 않게 등록을 멈춘다).
  assert.equal(missingAlertColumn({ code: '42501', message: 'permission denied for column alert_all_new' }), false);
  assert.equal(missingAlertColumn({ code: '42703', message: 'column user_push_subscriptions.other does not exist' }), false);
  assert.equal(missingAlertColumn(null), false);
});
