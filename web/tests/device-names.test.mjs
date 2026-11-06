import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../src/device-names.ts', import.meta.url), 'utf8');
const js = stripTypeScriptTypes(source.replace(/^import .*;$/gm, '').replace(/\bexport\s+/g, ''), { mode: 'strip' })
  + '\nObject.assign(exports, { deviceNameVariable, validDeviceName, loadDeviceNames, saveDeviceName, suggestDeviceName });';

function setup({ model, os = 'Android', type = 'mobile', readFails = false } = {}) {
  const variables = new Map();
  class UAParser {
    getDevice() { return { model, type, withClientHints: async () => ({ model, type }) }; }
    getOS() { return { name: os }; }
  }
  const sandbox = { exports: {}, UAParser,
    readVariable: async (_repo, _token, key) => { if (readFails) throw new Error('network'); return variables.get(key) ?? null; },
    saveVariable: async (_repo, _token, key, value) => { variables.set(key, value); },
  };
  vm.runInNewContext(js, sandbox);
  return { api: sandbox.exports, variables };
}

test('model is used when available and reduced or unavailable models use a device type', async () => {
  assert.equal(await setup({ model: 'SM-S938N' }).api.suggestDeviceName(), 'SM-S938N');
  assert.equal(await setup({ model: 'K' }).api.suggestDeviceName(), '안드로이드 휴대폰');
  assert.equal(await setup({ os: 'Windows', type: undefined }).api.suggestDeviceName(), 'Windows PC');
});

test('names are shared by slot and invalid names or slots are rejected', async () => {
  const { api, variables } = setup();
  await api.saveDeviceName('owner/repo', 'token', 'WEB_PUSH_SUB_2', '  내 노트북  ');
  assert.equal(variables.get('PUSH_DEVICE_NAME_2'), '내 노트북');
  const loaded = await api.loadDeviceNames('owner/repo', 'token', ['WEB_PUSH_SUB_2', 'WEB_PUSH_SUB_3']);
  assert.equal(loaded.WEB_PUSH_SUB_2, '내 노트북');
  assert.equal(loaded.WEB_PUSH_SUB_3, undefined);
  await assert.rejects(api.saveDeviceName('owner/repo', 'token', 'WEB_PUSH_SUB_2', '\n'), /40자/);
  assert.throws(() => api.deviceNameVariable('WEB_PUSH_SUB_9'));
});

test('network errors are not treated as an empty name', async () => {
  const { api } = setup({ readFails: true });
  await assert.rejects(api.loadDeviceNames('owner/repo', 'token', ['WEB_PUSH_SUB_1']), /network/);
});
