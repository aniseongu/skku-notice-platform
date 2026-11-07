import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { Reactive, defineReactive } from '../src/reactive.ts';

// node의 클래스 필드는 접근자를 가리므로 생성자에서 대입한다. 앱 빌드는 tsconfig의 useDefineForClassFields=false로 같은 효과를 낸다.
class Demo extends Reactive {
  constructor() {
    super();
    this.count = 0;
    this.label = 'a';
    this.untracked = 1;
  }
  bump() { this.count = this.count + 1; }
}
defineReactive(Demo, ['count', 'label']);

test('assigning a tracked property notifies synchronously and only when the value changes', () => {
  const demo = new Demo();
  const seen = [];
  const stop = demo.subscribe(() => seen.push([demo.count, demo.label]));
  const first = demo.getVersion();
  demo.count = 0;
  assert.deepEqual(seen, [], 'same value does not notify');
  demo.bump();
  demo.label = 'b';
  assert.deepEqual(seen, [[1, 'a'], [1, 'b']], 'each change is visible inside the same call stack');
  assert.equal(demo.getVersion(), first + 2);
  stop();
  demo.bump();
  assert.equal(seen.length, 2, 'unsubscribed listeners are not called');
});

test('field initializers go through the accessors and untracked fields do not notify', () => {
  const demo = new Demo();
  let calls = 0;
  demo.subscribe(() => calls++);
  demo.untracked = 2;
  assert.equal(calls, 0);
  assert.equal(demo.count, 0);
  demo.requestUpdate();
  assert.equal(calls, 1, 'in-place edits can request an update explicitly');
});

test('updateComplete resolves after commit and never hangs without one', async () => {
  const demo = new Demo();
  const pending = demo.updateComplete;
  demo.commit();
  await pending;
  const started = Date.now();
  await demo.updateComplete;
  assert.ok(Date.now() - started < 1000);
});

test('the build keeps class field assignment semantics that the reactive accessors depend on', () => {
  const config = JSON.parse(readFileSync(new URL('../tsconfig.json', import.meta.url), 'utf8').replace(/\/\/.*$/gm, ''));
  assert.equal(config.compilerOptions.useDefineForClassFields, false);
});
