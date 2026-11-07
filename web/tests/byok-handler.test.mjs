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
    deleteKey: async (id) => { deleted.push(id); },
    verifyCanvasToken: async (t) => { verified.push(t); return verdict; },
    saveCanvasToken: async (row) => { saved.push({ canvas: true, ...row }); },
    deleteCanvasToken: async (id) => { deleted.push(`canvas:${id}`); } };
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

const CANVAS = `1234~${'x'.repeat(40)}`;

test('stores an iCampus token encrypted for "<user>:canvas" and cannot be opened as the user alone', async () => {
  const t = await setup();
  const response = await t.call('POST', { provider: 'canvas', token: CANVAS });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body, { ok: true, keyHint: 'xxxx' });
  assert.equal(JSON.stringify(body).includes(CANVAS), false);
  assert.equal(t.saved[0].canvas, true);
  assert.equal(t.saved[0].ciphertext.includes(CANVAS), false);
  assert.equal(await decryptApiKey(t.masterKey, 'user-a:canvas', t.saved[0].ciphertext), CANVAS);
  await assert.rejects(decryptApiKey(t.masterKey, 'user-a', t.saved[0].ciphertext));
  await assert.rejects(decryptApiKey(t.masterKey, 'user-b:canvas', t.saved[0].ciphertext));
});

test('iCampus token: bad format, rejected and unreachable checks never reach storage, and delete is scoped', async () => {
  const bad = await setup();
  assert.equal((await bad.call('POST', { provider: 'canvas', token: 'short' })).status, 400);
  assert.equal((await bad.call('POST', { provider: 'canvas', token: CANVAS }, null)).status, 401);
  assert.equal(bad.saved.length, 0);
  const invalid = await setup({ verdict: 'invalid' });
  assert.equal((await invalid.call('POST', { provider: 'canvas', token: CANVAS })).status, 400);
  const down = await setup({ verdict: 'unavailable' });
  assert.equal((await down.call('POST', { provider: 'canvas', token: CANVAS })).status, 502);
  assert.equal(invalid.saved.length + down.saved.length, 0);
  const t = await setup();
  const response = await handle(new Request('https://x/byok?provider=canvas', { method: 'DELETE', headers: { Origin: ORIGIN, Authorization: 'Bearer good' } }), {
    masterKey: t.masterKey, userFromAuthorization: async () => 'user-a', deleteCanvasToken: async (id) => { t.deleted.push(`canvas:${id}`); }, deleteKey: async () => { throw new Error('gemini'); } });
  assert.equal(response.status, 200);
  assert.deepEqual(t.deleted, ['canvas:user-a']);
});

test('stores an AQ. key and shows a table-safe last four characters', async () => {
  const t = await setup();
  const key = `AQ.Ab8RN6J${'x'.repeat(38)}.z`;
  const response = await t.call('POST', { apiKey: key });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.match(body.keyHint, /^[A-Za-z0-9_-]{4}$/);
  assert.equal(body.keyHint, 'xx_z');
  assert.equal(await decryptApiKey(t.masterKey, 'user-a', t.saved[0].ciphertext), key);
});

import { SummaryError } from '../../supabase/functions/byok/handler.ts';

test('summarize runs with the caller identity only, validates the notice id and maps failures to plain messages', async () => {
  const masterKey = await importMasterKey(MASTER);
  const asked = [];
  const make = (summarize) => ({ masterKey, userFromAuthorization: async (a) => (a === 'Bearer good' ? 'user-a' : null), summarize });
  const call = (deps, body, auth = 'Bearer good') => handle(new Request('https://x/byok', {
    method: 'POST', headers: { Origin: ORIGIN, ...(auth ? { Authorization: auth } : {}) }, body: JSON.stringify(body) }), deps);
  const ok = make(async (user, notice) => { asked.push([user, notice]); return '12월 5일까지 내요.'; });
  const response = await call(ok, { action: 'summarize', noticeId: 'skku-notice01/12345' });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, summary: '12월 5일까지 내요.' });
  assert.deepEqual(asked, [['user-a', 'skku-notice01/12345']]);
  assert.equal((await call(ok, { action: 'summarize', noticeId: 'skku-notice01/12345' }, null)).status, 401);
  for (const noticeId of ['../etc/passwd', 'a/b', 'x'.repeat(100) + '/1', 42, undefined]) {
    assert.equal((await call(ok, { action: 'summarize', noticeId })).status, 400, String(noticeId));
  }
  assert.equal(asked.length, 1, 'bad ids never reach the summarizer');
  const failures = { no_key: 409, not_found: 404, limit: 429, rejected: 400, busy: 429, error: 502 };
  for (const [code, status] of Object.entries(failures)) {
    const failing = make(async () => { throw new SummaryError(code); });
    const r = await call(failing, { action: 'summarize', noticeId: 'a/1' });
    assert.equal(r.status, status, code);
    const text = JSON.stringify(await r.json());
    assert.match(text, /[가-힣]/);
    assert.ok(!text.includes('AIza'));
  }
  const crashing = make(async () => { throw new Error('boom AIza' + 'X'.repeat(35)); });
  const crashed = await call(crashing, { action: 'summarize', noticeId: 'a/1' });
  assert.equal(crashed.status, 502);
  assert.ok(!JSON.stringify(await crashed.json()).includes('AIza'));
});
