import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import test from 'node:test';
import { setImmediate } from 'node:timers/promises';
import vm from 'node:vm';

const source = readFileSync(new URL('../src/app-controller.ts', import.meta.url), 'utf8');
const methods = ['  async refresh(', '  body(', '  abortBodies(', '  retryBody('].map((start) =>
  source.slice(source.indexOf(start), source.indexOf('\n  }', source.indexOf(start)) + 4));
const timeout = source.slice(source.indexOf('function withTimeout'));
const script = new vm.Script(stripTypeScriptTypes(`${timeout}\n(class { ${methods.join('\n')} })`));

const notice = { id: 'coop-1', source_id: 'coop', article_no: '1' };
const newBody = { id: notice.id, body: '새 본문' };

function setup() {
  const requests = [];
  const Controller = script.runInNewContext({
    fetchBody: (_notice, signal) => new Promise((resolve) => requests.push({ generation: app.generatedAt, resolve, signal })),
    fetchJson: async () => ({ generated_at: 'new', notices: [notice], sources: [] }),
    isExpired: () => false,
    PAUSED_SOURCES: new Set(),
    remember() {},
    console,
    AbortController,
    setTimeout,
    clearTimeout,
  });
  const app = Object.assign(new Controller(), {
    bodies: new Map(), bodyAborts: new Map(), subscriptionsEpoch: 0, generatedAt: 'old', board: 'all',
    hasCoop: () => true, syncStates() {}, tab: () => 'saved', requestUpdate() {},
  });
  return { app, requests };
}

test('a stale body response clears its loading entry and triggers one request for the current generation', async () => {
  const { app, requests } = setup();
  assert.equal(app.body(notice), 'loading');
  app.generatedAt = 'new';
  app.requestUpdate = () => app.body(notice);
  requests[0].resolve({ body: '이전 본문' });
  await setImmediate();
  assert.equal(app.body(notice), 'loading');
  assert.deepEqual(requests.map(({ generation }) => generation), ['old', 'new']);
  requests[1].resolve(newBody);
  await setImmediate();
  assert.equal(app.body(notice), newBody);
  assert.equal(requests.length, 2);
});

test('refresh publishes the new body cache generation before updating the notice list', async () => {
  const { app, requests } = setup();
  app.body(notice);
  Object.defineProperty(app, 'notices', { set: () => app.body(notice) });
  await app.refresh();
  assert.deepEqual(requests.map(({ generation }) => generation), ['old', 'new']);
  requests[0].resolve({ body: '이전 본문' });
  await setImmediate();
  assert.equal(app.body(notice), 'loading');
  assert.equal(requests.length, 2);
  requests[1].resolve(newBody);
  await setImmediate();
  assert.equal(app.body(notice), newBody);
});

test('a stalled body request becomes retryable after 20 seconds', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { app, requests } = setup();
  assert.equal(app.body(notice), 'loading');
  t.mock.timers.tick(20_000);
  await setImmediate();
  assert.equal(app.body(notice), null);
  app.bodies.delete(notice.id);
  assert.equal(app.body(notice), 'loading');
  requests[1].resolve(newBody);
  await setImmediate();
  assert.equal(app.body(notice), newBody);
  requests[0].resolve({ body: '시간이 지난 본문' });
  await setImmediate();
  assert.equal(app.body(notice), newBody);
});

test('timeout aborts the stalled request and retry sends one new request while the old result is ignored', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { app, requests } = setup();
  assert.equal(app.body(notice), 'loading');
  t.mock.timers.tick(20_000);
  await setImmediate();
  assert.equal(requests[0].signal.aborted, true);
  assert.equal(app.body(notice), null);
  app.retryBody(notice);
  assert.equal(app.body(notice), 'loading');
  assert.equal(requests.length, 2);
  assert.equal(requests[1].signal.aborted, false);
  // 재시도 중에 다시 눌러도 이전 요청은 끊기고 새 요청 한 개만 남는다.
  app.retryBody(notice);
  assert.equal(requests[1].signal.aborted, true);
  assert.equal(app.body(notice), 'loading');
  assert.equal(requests.length, 3);
  requests[1].resolve({ body: '끊긴 요청의 본문' });
  await setImmediate();
  assert.equal(app.body(notice), 'loading');
  requests[2].resolve(newBody);
  await setImmediate();
  assert.equal(app.body(notice), newBody);
});

test('a late response after an account switch is discarded and the request is aborted', async () => {
  const { app, requests } = setup();
  assert.equal(app.body(notice), 'loading');
  app.abortBodies();
  app.subscriptionsEpoch++;
  app.bodies.clear();
  assert.equal(requests[0].signal.aborted, true);
  requests[0].resolve({ body: '이전 계정 본문' });
  await setImmediate();
  assert.equal(app.bodies.has(notice.id), false);
});
