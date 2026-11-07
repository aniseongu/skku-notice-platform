import assert from 'node:assert/strict';
import test from 'node:test';
import { decryptApiKey, importMasterKey } from '../../supabase/functions/byok/crypto.ts';
import { handle } from '../../supabase/functions/byok/handler.ts';

const MASTER = 'a2tra2tra2tra2tra2tra2tra2tra2tra2tra2tra2s';
const KEY = `AIza${'B'.repeat(35)}`;
const ORIGIN = 'https://skku-notice-platform.pages.dev';

async function setup({ user = 'user-a', verdict = 'valid', saveError = false } = {}) {
  const masterKey = await importMasterKey(MASTER);
  const saved = [], deleted = [], verified = [];
  const deps = { masterKey,
    userFromAuthorization: async (auth) => (auth === 'Bearer good' ? user : null),
    verifyGeminiKey: async (k) => { verified.push(k); return verdict; },
    saveKey: async (row) => { if (saveError) throw new Error(`boom ${KEY}`); saved.push(row); },
    deleteKey: async (id) => { deleted.push(id); } };
  const call = (method, body, auth = 'Bearer good', origin = ORIGIN) => handle(new Request('https://x/byok', {
    method, headers: { Origin: origin, ...(auth ? { Authorization: auth } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) }), deps);
  return { call, saved, deleted, verified, masterKey };
}

test('stores an encrypted key for the signed-in user and only returns the last four characters', async () => {
  const t = await setup();
  const response = await t.call('POST', { apiKey: KEY });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body, { ok: true, keyHint: 'BBBB', model: 'gemini-3.1-flash-lite' });
  assert.equal(JSON.stringify(body).includes(KEY), false);
  assert.equal(t.saved.length, 1);
  assert.equal(t.saved[0].user_id, 'user-a');
  assert.equal(t.saved[0].ciphertext.includes(KEY), false);
  assert.equal(await decryptApiKey(t.masterKey, 'user-a', t.saved[0].ciphertext), KEY);
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), ORIGIN);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
});

test('rejects anonymous callers, bad origins, bad keys and models before touching storage', async () => {
  const t = await setup();
  assert.equal((await t.call('POST', { apiKey: KEY }, null)).status, 401);
  assert.equal((await t.call('POST', { apiKey: KEY }, 'Bearer other')).status, 401);
  assert.equal((await t.call('POST', { apiKey: KEY }, 'Bearer good', 'https://evil.example')).status, 403);
  assert.equal((await t.call('POST', { apiKey: 'not-a-key' })).status, 400);
  assert.equal((await t.call('POST', { apiKey: KEY, model: 'x; drop' })).status, 400);
  assert.equal((await t.call('POST', { apiKey: KEY, junk: 'x'.repeat(3000) })).status, 413);
  assert.equal((await t.call('GET')).status, 405);
  assert.equal(t.saved.length, 0);
  assert.equal(t.verified.length, 0);
});

test('does not store a key Gemini refuses and reports an outage separately', async () => {
  const refused = await setup({ verdict: 'invalid' });
  assert.equal((await refused.call('POST', { apiKey: KEY })).status, 400);
  assert.equal(refused.saved.length, 0);
  const outage = await setup({ verdict: 'unavailable' });
  assert.equal((await outage.call('POST', { apiKey: KEY })).status, 502);
  assert.equal(outage.saved.length, 0);
});

test('storage failures never echo the key and delete removes only the caller key', async () => {
  const failing = await setup({ saveError: true });
  const response = await failing.call('POST', { apiKey: KEY });
  assert.equal(response.status, 500);
  assert.equal((await response.text()).includes(KEY), false);
  const t = await setup({ user: 'user-b' });
  assert.equal((await t.call('DELETE')).status, 200);
  assert.deepEqual(t.deleted, ['user-b']);
  assert.equal((await t.call('OPTIONS')).status, 204);
});
