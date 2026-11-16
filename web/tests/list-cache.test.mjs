import test from 'node:test';
import assert from 'node:assert/strict';
import { saveListCache, loadListCache, clearListCache } from '../src/list-cache.ts';

function fakeStore() {
  const data = new Map();
  return { data, get: async (key) => data.get(key), set: async (key, value) => { data.set(key, value); }, del: async (key) => { data.delete(key); } };
}
function fixture() {
  return { generatedAt: 'today', sources: [{ id: 's', name: 'S', url: 'https://example.com', token: 'secret' }],
    notices: Array.from({ length: 1002 }, (_, i) => ({ id: String(i), source_id: 's', article_no: String(i), title: 'title', category: null, url: 'https://example.com', posted_on: '2026-01-01', pinned: false, deadline: null, first_seen: null, body: 'secret body', apiKey: 'secret' })),
    subscriptions: ['s'], keywords: ['word'], boardOrder: ['s'], deadlines: new Map([['0', { deadline: null, deadlineKind: null, body: 'secret' }]]),
    judgments: new Map(), interests: new Map(), translations: new Map([['0', { title: 'title', body: 'secret' }]]), graduation: new Map() };
}
test('cache isolates accounts, caps rows, and excludes bodies and secrets', async () => {
  const store = fakeStore(); await saveListCache('a', fixture(), store);
  assert.equal(await loadListCache('b', store), null);
  const cached = await loadListCache('a', store);
  assert.equal(cached.notices.length, 1000);
  assert.equal(JSON.stringify(store.data.get('list-cache:v1:a')).includes('secret'), false);
  assert.equal(cached.translations.get('0').title, 'title');
  await clearListCache('a', store); assert.equal(await loadListCache('a', store), null);
});
test('ignores other schema versions and storage failures', async () => {
  const store = fakeStore(); await saveListCache('a', fixture(), store);
  store.data.get('list-cache:v1:a').version = 2;
  assert.equal(await loadListCache('a', store), null);
  const broken = { get: async () => { throw Error(); }, set: async () => { throw Error(); }, del: async () => { throw Error(); } };
  assert.equal(await loadListCache('a', broken), null);
  await saveListCache('a', fixture(), broken); await clearListCache('a', broken);
});
