import assert from 'node:assert/strict';
import test from 'node:test';
import { byokAvailable, loadByokStatus, looksLikeGeminiKey, registerByokKey, removeByokKey } from '../src/byok.ts';

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

test('client accepts the AQ. key format', () => {
  assert.equal(looksLikeGeminiKey(`AQ.Ab8RN6J${'x'.repeat(40)}`), true);
});

import { loadNoticeSummary } from '../src/byok.ts';

function summaryClient(tables) {
  const queries = [];
  return { queries, from: (table) => {
    const state = { table };
    const chain = { select: () => chain, eq: (column, value) => { (state.eq ??= {})[column] = value; return chain; },
      maybeSingle: async () => { queries.push({ table, eq: state.eq }); return { data: tables[table] ?? null, error: null }; } };
    return chain;
  } };
}

test('summary lookup prefers the one I asked for, falls back to the judgment summary, and always filters by my user', async () => {
  const asked = summaryClient({ user_notice_summaries: { summary: '눌러서 만든 요약' }, user_notice_judgments: { summary: '판정 요약' } });
  assert.equal(await loadNoticeSummary(asked, 'user-a', 'a/1'), '눌러서 만든 요약');
  assert.deepEqual(asked.queries[0].eq, { user_id: 'user-a', notice_id: 'a/1' });
  const judged = summaryClient({ user_notice_judgments: { summary: '판정 요약' } });
  assert.equal(await loadNoticeSummary(judged, 'user-a', 'a/1'), '판정 요약');
  assert.equal(await loadNoticeSummary(summaryClient({}), 'user-a', 'a/1'), null);
  assert.equal(await loadNoticeSummary(summaryClient({ user_notice_summaries: { summary: '   ' } }), 'user-a', 'a/1'), null);
});
