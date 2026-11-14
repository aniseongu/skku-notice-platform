import assert from 'node:assert/strict';
import test from 'node:test';
import { aiKeysLead, connectedAiKeys } from '../src/ai-keys.ts';

test('키를 0·1·2·3개 연결했을 때 안내가 달라진다', () => {
  assert.match(aiKeysLead(0), /하나 이상 연결하면/);
  assert.match(aiKeysLead(1), /하나 이상 있어야/);       // 하나일 때는 그 키를 지울 수 없는 이유와 다음 행동(다른 곳 연결)을 말한다
  assert.match(aiKeysLead(2), /번갈아 쓰고/);
  assert.equal(aiKeysLead(2), aiKeysLead(3));
});

test('연결한 키 개수는 Gemini와 다른 업체를 합치고 끊긴 키는 세지 않는다', () => {
  const key = (provider, disabled = false) => ({ provider, keyHint: 'x', model: 'm', disabled, lastError: null, usedToday: 0 });
  assert.equal(connectedAiKeys({ byok: undefined }), 0);
  assert.equal(connectedAiKeys({ byok: { status: null, ai: { keys: [] } } }), 0);
  assert.equal(connectedAiKeys({ byok: { status: { disabled: false }, ai: { keys: [] } } }), 1);
  assert.equal(connectedAiKeys({ byok: { status: { disabled: false }, ai: { keys: [key('groq')] } } }), 2);
  assert.equal(connectedAiKeys({ byok: { status: { disabled: true }, ai: { keys: [key('groq')] } } }), 1);
  assert.equal(connectedAiKeys({ byok: { status: { disabled: false }, ai: { keys: [key('groq', true)] } } }), 1);
});

import { canRemoveKey } from '../src/ai-keys.ts';
test('the last usable key cannot be removed, a broken key always can', () => {
  assert.equal(canRemoveKey({ disabled: false }, 1), false);
  assert.equal(canRemoveKey({ disabled: false }, 2), true);
  assert.equal(canRemoveKey({ disabled: true }, 1), true);
});
