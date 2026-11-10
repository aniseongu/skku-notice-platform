import assert from 'node:assert/strict';
import test from 'node:test';
import { aiModeLabel, DEFAULT_AI_PREFERENCES, loadAiKeyStatuses, loadAiPreferences, looksLikeAiKey, preferencesRow, PROVIDER_GUIDE, registerAiKey } from '../src/ai-providers.ts';

const query = (result) => ({ from: () => ({ select: () => ({ eq: () => Object.assign(Promise.resolve(result), { maybeSingle: async () => result }) }) }) });

test('default preferences are free-only, manual and keep AI on', () => {
  assert.deepEqual(DEFAULT_AI_PREFERENCES, { aiEnabled: true, routingMode: 'manual', autoRoutingConsent: false, manualProvider: null, freeOnly: true, paidOptIn: false });
});

test('preferences row never enables auto routing or paid calls without a timestamp', () => {
  const manual = preferencesRow('u', DEFAULT_AI_PREFERENCES, 'T');
  assert.equal(manual.auto_routing_consent_at, null); assert.equal(manual.free_only, true); assert.equal(manual.paid_calls_opt_in_at, null);
  const auto = preferencesRow('u', { ...DEFAULT_AI_PREFERENCES, routingMode: 'auto', paidOptIn: true, manualProvider: 'groq' }, 'T');
  assert.equal(auto.routing_mode, 'auto'); assert.equal(auto.auto_routing_consent_at, 'T'); assert.equal(auto.manual_provider, null);
  assert.equal(auto.free_only, false); assert.equal(auto.paid_calls_opt_in_at, 'T');
});

test('status loading keeps only provider status columns and survives a missing table', async () => {
  const ok = await loadAiKeyStatuses(query({ data: [{ provider: 'groq', key_hint: 'AbCd', model: 'm', disabled_at: null, last_error: null, used_today: 2 }, { provider: 'bing', key_hint: 'x' }], error: null }), 'u');
  assert.deepEqual(ok, [{ provider: 'groq', keyHint: 'AbCd', model: 'm', disabled: false, lastError: null, usedToday: 2 }]);
  assert.deepEqual(await loadAiKeyStatuses(query({ data: null, error: { message: 'no table' } }), 'u'), []);
});

test('preferences loading falls back to defaults and ignores auto without consent', async () => {
  assert.deepEqual(await loadAiPreferences(query({ data: null, error: null }), 'u'), DEFAULT_AI_PREFERENCES);
  const row = { ai_enabled: true, routing_mode: 'auto', auto_routing_consent_at: null, manual_provider: 'bing', free_only: true, paid_calls_opt_in_at: null };
  const prefs = await loadAiPreferences(query({ data: row, error: null }), 'u');
  assert.equal(prefs.routingMode, 'manual'); assert.equal(prefs.manualProvider, null);
});

test('a malformed key is refused before any request and the label states code-based fallback', async () => {
  assert.equal(looksLikeAiKey('bad key'), false);
  await assert.rejects(registerAiKey({ functions: { invoke: () => { throw new Error('must not call'); } } }, 'groq', 'bad key'), /붙여 넣어/);
  assert.match(aiModeLabel(0, DEFAULT_AI_PREFERENCES), /코드 기반/);
  assert.match(aiModeLabel(3, { ...DEFAULT_AI_PREFERENCES, routingMode: 'auto', autoRoutingConsent: true }), /자동 선택/);
  assert.match(aiModeLabel(2, { ...DEFAULT_AI_PREFERENCES, aiEnabled: false }), /꺼짐/);
  for (const g of Object.values(PROVIDER_GUIDE)) assert.match(g.url, /^https:\/\//);
});
