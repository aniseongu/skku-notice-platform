import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';

const compile = (name) => stripTypeScriptTypes(readFileSync(new URL(`../src/${name}.ts`, import.meta.url), 'utf8')
  .replace(/^import .*;$/gm, '').replace(/\bexport\s+/g, ''), { mode: 'strip' });
const js = `${compile('connection-chain')}\n${compile('key-connection')}\nObject.assign(exports, { keyConnection });`;

function environment({ valid = true, saveFailures = 0, preflightFailures = 0 } = {}) {
  const calls = [];
  const sandbox = { exports: {},
    listSecrets: async () => { calls.push('preflight'); if (preflightFailures-- > 0) throw new Error('temporary'); },
    checkGeminiKey: async () => { calls.push('verify'); return valid; },
    saveSecret: async (_repo, _token, name, value) => {
      calls.push(`save:${name}`);
      assert.equal(value, 'test-value');
      if (saveFailures-- > 0) throw new Error('temporary');
    },
  };
  vm.runInNewContext(js, sandbox);
  return { api: sandbox.exports, calls };
}

test('Gemini retry does not repeat successful preflight and key verification', async () => {
  const { api, calls } = environment({ saveFailures: 1 });
  const chain = api.keyConnection('owner/repo', 'token', 'GEMINI_API_KEY', 'test-value');
  await assert.rejects(chain.run(), /temporary/);
  await chain.run();
  assert.deepEqual(calls, ['preflight', 'verify', 'save:GEMINI_API_KEY', 'save:GEMINI_API_KEY']);
});

test('rejected Gemini key never replaces the saved key', async () => {
  const { api, calls } = environment({ valid: false });
  await assert.rejects(api.keyConnection('owner/repo', 'token', 'GEMINI_API_KEY', 'test-value').run(), /키와 사용 권한/);
  assert.deepEqual(calls, ['preflight', 'verify']);
});

test('Canvas preflight failure stops before saving and retry resumes there', async () => {
  const { api, calls } = environment({ preflightFailures: 1 });
  const chain = api.keyConnection('owner/repo', 'token', 'CANVAS_TOKEN', 'test-value');
  await assert.rejects(chain.run(), /temporary/);
  await chain.run();
  assert.deepEqual(calls, ['preflight', 'preflight', 'save:CANVAS_TOKEN']);
});
