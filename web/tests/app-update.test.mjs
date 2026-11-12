import assert from 'node:assert/strict';
import test from 'node:test';
import { applyUpdate, dismissUpdate, markUpdateReady, resetUpdate, safeToSwapSilently, subscribeUpdate, updateAvailable } from '../src/app-update.ts';

test('a ready update does nothing until the user applies it, and "later" hides it for this visit', () => {
  resetUpdate();
  let applied = 0, notified = 0;
  subscribeUpdate(() => { notified += 1; });
  assert.equal(updateAvailable(), false);
  markUpdateReady(() => { applied += 1; });
  assert.equal(updateAvailable(), true);
  assert.equal(applied, 0);   // 알리기만 하고 바꾸지 않는다
  dismissUpdate();
  assert.equal(updateAvailable(), false);
  assert.equal(applied, 0);
  markUpdateReady(() => { applied += 1; });   // 새 알림은 다시 보인다
  assert.equal(updateAvailable(), true);
  applyUpdate();
  assert.equal(applied, 1);
  assert.ok(notified >= 3);
});

test('the page is swapped silently only right after opening and before the user touches anything', () => {
  assert.equal(safeToSwapSilently(2_000, false), true);
  assert.equal(safeToSwapSilently(2_000, true), false);   // 이미 만졌으면 묻는다
  assert.equal(safeToSwapSilently(20_000, false), false);   // 한참 지났으면 묻는다
});
