import assert from 'node:assert/strict';
import test from 'node:test';
import { GitHubError, SecretWriteUncertainError, checkGeminiKey, createVariableIfAbsent, listSecrets, readVariable, saveSecret, saveVariable } from '../src/github.ts';

test('creating a default name never overwrites an existing variable', async () => {
  const original = globalThis.fetch;
  const calls = [];
  try {
    globalThis.fetch = async (_url, init) => { calls.push(init.method); return new Response(null, { status: 409 }); };
    assert.equal(await createVariableIfAbsent('owner/repo', 'token', 'PUSH_DEVICE_NAME_1', 'PC'), false);
    assert.deepEqual(calls, ['POST']);
  } finally { globalThis.fetch = original; }
});

test('secret listing includes later pages and fails closed on an incomplete response', async () => {
  const original = globalThis.fetch;
  try {
    const first = Array.from({ length: 100 }, (_, index) => ({ name: `SECRET_${index}`, updated_at: 'date' }));
    globalThis.fetch = async (url) => Response.json(String(url).includes('page=2')
      ? { total_count: 101, secrets: [{ name: 'WEB_PUSH_SUB_1', updated_at: 'date' }] }
      : { total_count: 101, secrets: first });
    assert.equal((await listSecrets('owner/repo', 'token')).WEB_PUSH_SUB_1, 'date');
    globalThis.fetch = async () => Response.json({ total_count: 101, secrets: [] });
    await assert.rejects(listSecrets('owner/repo', 'token'), /모두 불러오지/);
  } finally { globalThis.fetch = original; }
});

test('secret metadata bypasses browser cache after a write', async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async (_url, init) => {
      assert.equal(init.cache, 'no-store');
      return Response.json({ total_count: 1, secrets: [{ name: 'WEB_PUSH_SUB_1', updated_at: 'new' }] });
    };
    assert.equal((await listSecrets('owner/repo', 'token')).WEB_PUSH_SUB_1, 'new');
  } finally { globalThis.fetch = original; }
});

test('secret write distinguishes rejected requests from uncertain responses', async () => {
  const original = globalThis.fetch;
  const sodium = (await import('libsodium-wrappers')).default;
  await sodium.ready;
  const key = sodium.to_base64(sodium.crypto_box_keypair().publicKey, sodium.base64_variants.ORIGINAL);
  try {
    for (const status of [403, 503]) {
      globalThis.fetch = async (_url, init) => init.method === 'PUT'
        ? new Response('{}', { status }) : Response.json({ key, key_id: 'id' });
      await assert.rejects(saveSecret('owner/repo', 'token', 'EXAMPLE', 'value'), (error) =>
        status === 403 ? error instanceof GitHubError && error.status === 403 : error instanceof SecretWriteUncertainError);
    }
  } finally { globalThis.fetch = original; }
});

test('a failed delete is not mistaken for an absent variable', async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async (_url, init) => init.method === 'DELETE'
      ? new Response('{}', { status: 404 }) : Response.json({ value: 'existing' });
    await assert.rejects(saveVariable('owner/repo', 'token', 'PUSH_DEVICE_NAME_1', ''), /오류 404/);
  } finally { globalThis.fetch = original; }
});

test('Gemini transient failure is not reported as a rejected key', async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response('{}', { status: 503 });
    await assert.rejects(checkGeminiKey('fixture-key'), /다시 확인/);
    globalThis.fetch = async () => new Response('{}', { status: 401 });
    assert.equal(await checkGeminiKey('fixture-key'), false);
  } finally { globalThis.fetch = original; }
});

test('authentication and temporary server failures retain distinct HTTP status', async () => {
  const original = globalThis.fetch;
  try {
    for (const status of [401, 403, 429, 500, 503]) {
      globalThis.fetch = async () => new Response('{}', { status });
      await assert.rejects(listSecrets('owner/repo', 'fixture-token'),
        error => error instanceof GitHubError && error.status === status && !error.message.includes('fixture-token'));
    }
  } finally { globalThis.fetch = original; }
});

test('only absent variables are empty; authorization and server failures propagate', async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async (url) => new Response('{}', { status: String(url).includes('?per_page=1') ? 200 : 404 });
    assert.equal(await readVariable('owner/repo', 'fixture-token', 'INTEREST_KEYWORDS'), null);
    globalThis.fetch = async () => new Response('{}', { status: 404 });
    await assert.rejects(readVariable('owner/repo', 'fixture-token', 'INTEREST_KEYWORDS'), error => error.status === 404);
    for (const status of [401, 403, 503]) {
      globalThis.fetch = async () => new Response('{}', { status });
      await assert.rejects(readVariable('owner/repo', 'fixture-token', 'INTEREST_KEYWORDS'),
        error => error instanceof GitHubError && error.status === status);
    }
  } finally { globalThis.fetch = original; }
});

test('manual collection dispatches the default branch using its existing workflow', async () => {
  const { requestCollection } = await import('../src/github.ts');
  const original = globalThis.fetch;
  const requests = [];
  try {
    globalThis.fetch = async (url, init) => {
      requests.push([url, init]);
      return requests.length === 1 ? Response.json({ default_branch: 'main' }) : new Response(null, { status: 204 });
    };
    await requestCollection('owner/repo', 'fixture-token');
    assert.match(requests[1][0], /notice-and-pages.yml\/dispatches$/);
    assert.deepEqual(JSON.parse(requests[1][1].body), { ref: 'main' });
  } finally { globalThis.fetch = original; }
});

test('manual fallback only builds links to valid GitHub repositories', async () => {
  const { collectionWorkflowUrl } = await import('../src/github.ts');
  assert.equal(collectionWorkflowUrl('owner/repo'), 'https://github.com/owner/repo/actions/workflows/notice-and-pages.yml');
  assert.equal(collectionWorkflowUrl('../evil'), null);
  assert.equal(collectionWorkflowUrl('owner/repo?x=1'), null);
});
