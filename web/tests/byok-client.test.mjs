import assert from 'node:assert/strict';
import test from 'node:test';
import { byokAvailable, EMPTY_PROFILE, loadByokStatus, loadJudgeProfile, looksLikeGeminiKey, registerByokKey, removeByokKey, saveJudgeProfile } from '../src/byok.ts';

const KEY = `AIza${'C'.repeat(35)}`;

test('key format check and request never send a malformed key', async () => {
  assert.equal(looksLikeGeminiKey(KEY), true);
  assert.equal(looksLikeGeminiKey('AIza123'), false);
  let calls = 0;
  const client = { functions: { invoke: async () => { calls++; return { data: { keyHint: 'CCCC' }, error: null }; } } };
  await assert.rejects(registerByokKey(client, 'nope'), /형식/);
  assert.equal(calls, 0);
  assert.equal(await registerByokKey(client, KEY), 'CCCC');
});

test('registration and removal surface only plain messages', async () => {
  const failing = { functions: { invoke: async () => ({ data: null, error: new Error(`boom ${KEY}`) }) } };
  await assert.rejects(registerByokKey(failing, KEY), (error) => !String(error.message).includes(KEY) && /다시 시도/.test(error.message));
  await assert.rejects(removeByokKey(failing), /지우지/);
  const odd = { functions: { invoke: async () => ({ data: {}, error: null }) } };
  await assert.rejects(registerByokKey(odd, KEY), /저장하지/);
});

test('status query never asks for the ciphertext column', async () => {
  const selects = [];
  const client = { from: () => { const q = { select: (columns) => { selects.push(columns); return q; }, eq: () => q,
    maybeSingle: async () => ({ data: { key_hint: 'CCCC', model: 'm', disabled_at: null, last_error: null, used_today: 2 }, error: null }) }; return q; } };
  assert.deepEqual(await loadByokStatus(client, 'u'), { keyHint: 'CCCC', model: 'm', disabled: false, lastError: null, usedToday: 2 });
  assert.equal(selects[0].includes('ciphertext'), false);
});

test('availability probe needs a 204 from the function and treats network errors as unavailable', async () => {
  assert.equal(await byokAvailable('https://x.supabase.co', async () => ({ status: 204 })), true);
  assert.equal(await byokAvailable('https://x.supabase.co', async () => ({ status: 404 })), false);
  assert.equal(await byokAvailable('https://x.supabase.co', async () => { throw new TypeError('cors'); }), false);
  assert.equal(await byokAvailable(undefined), false);
});

test('judge profile is validated before saving and empty when missing', async () => {
  const rows = [];
  const client = { from: () => ({ upsert: async (row) => { rows.push(row); return { error: null }; },
    select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }) };
  assert.deepEqual(await loadJudgeProfile(client, 'u'), EMPTY_PROFILE);
  await saveJudgeProfile(client, 'u', { year: 3, semester: 2, enrollmentStatus: '재학', militaryService: '해당 없음' });
  assert.equal(rows[0].user_id, 'u');
  assert.equal(rows[0].enrollment_status, '재학');
  for (const bad of [{ year: 9 }, { semester: 3 }, { year: 1.5 }, { enrollmentStatus: '자유' }, { militaryService: '모름' }]) {
    await assert.rejects(saveJudgeProfile(client, 'u', { ...EMPTY_PROFILE, ...bad }), /확인해 주세요/);
  }
  assert.equal(rows.length, 1);
});
