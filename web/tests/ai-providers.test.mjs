import assert from 'node:assert/strict';
import test from 'node:test';
import { aiModeLabel, DEFAULT_AI_PREFERENCES, loadAiKeyStatuses, loadAiPreferences, looksLikeAiKey, preferencesRow, PROVIDER_GUIDE, registerAiKey } from '../src/ai-providers.ts';

const query = (result) => ({ from: () => ({ select: () => ({ eq: () => Object.assign(Promise.resolve(result), { maybeSingle: async () => result }) }) }) });

test('default preferences keep AI on; the user picks neither provider nor price', () => {
  assert.deepEqual(DEFAULT_AI_PREFERENCES, { aiEnabled: true });
});

test('preferences row is always automatic and carries nothing about price', () => {
  const row = preferencesRow('u', { aiEnabled: false }, 'T');
  assert.deepEqual(row, { user_id: 'u', ai_enabled: false, routing_mode: 'auto', manual_provider: null, updated_at: 'T' });
});

test('status loading keeps only provider status columns and survives a missing table', async () => {
  const ok = await loadAiKeyStatuses(query({ data: [{ provider: 'groq', key_hint: 'AbCd', model: 'm', disabled_at: null, last_error: null, used_today: 2 }, { provider: 'bing', key_hint: 'x' }], error: null }), 'u');
  assert.deepEqual(ok, [{ provider: 'groq', keyHint: 'AbCd', model: 'm', disabled: false, lastError: null, usedToday: 2 }]);
  assert.deepEqual(await loadAiKeyStatuses(query({ data: null, error: { message: 'no table' } }), 'u'), []);
});

test('preferences loading falls back to defaults', async () => {
  assert.deepEqual(await loadAiPreferences(query({ data: null, error: null }), 'u'), DEFAULT_AI_PREFERENCES);
  assert.deepEqual(await loadAiPreferences(query({ data: { ai_enabled: false }, error: null }), 'u'), { aiEnabled: false });
});

test('a malformed key is refused before any request and the label states code-based fallback', async () => {
  assert.equal(looksLikeAiKey('bad key'), false);
  await assert.rejects(registerAiKey({ functions: { invoke: () => { throw new Error('must not call'); } } }, 'groq', 'bad key'), /붙여 넣어/);
  assert.match(aiModeLabel(0, DEFAULT_AI_PREFERENCES), /기본 방식/);
  assert.match(aiModeLabel(3, DEFAULT_AI_PREFERENCES), /알아서/);
  assert.match(aiModeLabel(2, { ...DEFAULT_AI_PREFERENCES, aiEnabled: false }), /꺼짐/);
  for (const g of Object.values(PROVIDER_GUIDE)) assert.match(g.url, /^https:\/\//);
});
