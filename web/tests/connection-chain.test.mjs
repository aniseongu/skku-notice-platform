import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../src/connection-chain.ts', import.meta.url), 'utf8');
const js = stripTypeScriptTypes(source.replace(/\bexport\s+/g, ''), { mode: 'strip' })
  + '\nObject.assign(exports, { connectionChain });';
const sandbox = { exports: {} };
vm.runInNewContext(js, sandbox);

test('retries only the failed step and executes later steps once', async () => {
  const calls = [];
  let fails = true;
  const chain = sandbox.exports.connectionChain([
    async () => calls.push('authorize'),
    async () => { calls.push('save'); if (fails) throw new Error('temporary'); },
    async () => calls.push('finish'),
  ]);
  await assert.rejects(chain.run(), /temporary/);
  fails = false;
  await chain.run();
  await chain.run();
  assert.deepEqual(calls, ['authorize', 'save', 'save', 'finish']);
});
