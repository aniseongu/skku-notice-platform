import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../src/device-name-sync.ts', import.meta.url), 'utf8');
const js = stripTypeScriptTypes(source.replace(/^import .*;$/gm, '').replace(/\bexport\s+/g, ''), { mode: 'strip' })
  + '\nObject.assign(exports, { syncCurrentDeviceName });';

function environment({ existing = null, verified = true, enabled = true, changed = false, conflict = false } = {}) {
  const calls = [];
  let reads = 0;
  const sandbox = { exports: {},
    browserPushEnabled: async () => enabled,
    currentDeviceSlot: () => 'WEB_PUSH_SUB_1',
    matchesCurrentDevice: (_slot, stamp) => verified && stamp === 'original',
    listSecrets: async () => ({ WEB_PUSH_SUB_1: ++reads > 1 && changed ? 'changed' : 'original' }),
    deviceNameVariable: () => 'PUSH_DEVICE_NAME_1',
    validDeviceName: (value) => !!value.trim() && value.length <= 40,
    readVariable: async () => existing,
    suggestDeviceName: async () => 'Windows PC',
    createVariableIfAbsent: async (_repo, _token, _name, value) => {
      calls.push(value);
      if (conflict) { existing = '내 노트북'; return false; }
      existing = value; return true;
    },
  };
  vm.runInNewContext(js, sandbox);
  return { api: sandbox.exports, calls };
}

test('a verified current device gets a shared name automatically', async () => {
  const env = environment();
  assert.equal(await env.api.syncCurrentDeviceName('owner/repo', 'token'), 'Windows PC');
  assert.deepEqual(env.calls, ['Windows PC']);
});

test('manual names and names saved concurrently are preserved', async () => {
  const saved = environment({ existing: '내 노트북' });
  assert.equal(await saved.api.syncCurrentDeviceName('owner/repo', 'token'), '내 노트북');
  assert.equal(saved.calls.length, 0);
  const concurrent = environment({ conflict: true });
  assert.equal(await concurrent.api.syncCurrentDeviceName('owner/repo', 'token'), '내 노트북');
});

test('unverified, disconnected or changed device registrations never get a name', async () => {
  for (const options of [{ verified: false }, { enabled: false }, { changed: true }]) {
    const env = environment(options);
    assert.equal(await env.api.syncCurrentDeviceName('owner/repo', 'token'), null);
    assert.equal(env.calls.length, 0);
  }
});
