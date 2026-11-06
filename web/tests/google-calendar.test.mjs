import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../src/google-calendar.ts', import.meta.url), 'utf8');
const js = stripTypeScriptTypes(source.replace(/^import .*;$/gm, '').replace(/\bexport\s+/g, ''), { mode: 'strip' })
  + '\nObject.assign(exports, { existingCalendar, connectGoogleCalendar });';

function setup(variable, response, pending = '') {
  let requests = 0;
  const sandbox = {
    exports: {},
    readVariable: async () => { if (variable instanceof Error) throw variable; return variable; },
    fetch: async () => { requests++; return response; },
    localStorage: { getItem: () => pending, setItem: () => {}, removeItem: () => {} },
    URL, URLSearchParams,
  };
  vm.runInNewContext(js, sandbox);
  return { api: sandbox.exports, requests: () => requests };
}

test('existing calendar is reused, absent or deleted calendar may be created', async () => {
  const found = setup('calendar-id', { ok: true, status: 200 });
  assert.equal(await found.api.existingCalendar('owner/repo', 'token', {}), 'calendar-id');
  const absent = setup(null);
  assert.equal(await absent.api.existingCalendar('owner/repo', 'token', {}), '');
  assert.equal(absent.requests(), 0);
  const deleted = setup('calendar-id', { ok: false, status: 404 });
  assert.equal(await deleted.api.existingCalendar('owner/repo', 'token', {}), '');
  const resumed = setup('older-id', { ok: true, status: 200 }, 'new-pending-id');
  assert.equal(await resumed.api.existingCalendar('owner/repo', 'token', {}), 'new-pending-id');
});

test('temporary GitHub or Google failure does not look like an absent calendar', async () => {
  const github = setup(new Error('temporary'));
  await assert.rejects(() => github.api.existingCalendar('owner/repo', 'token', {}), /temporary/);
  assert.equal(github.requests(), 0);
  const google = setup('calendar-id', { ok: false, status: 503 });
  await assert.rejects(() => google.api.existingCalendar('owner/repo', 'token', {}), /기존 캘린더/);
});

test('calendar connection resumes after a failed final write without repeating OAuth or secret save', async () => {
  const chainSource = readFileSync(new URL('../src/connection-chain.ts', import.meta.url), 'utf8');
  const chainJs = stripTypeScriptTypes(chainSource.replace(/\bexport\s+/g, ''), { mode: 'strip' });
  const calls = [];
  let authUrl = '';
  let failVariable = true;
  class Channel {
    set onmessage(callback) {
      queueMicrotask(() => callback({ data: { state: new URL(authUrl).searchParams.get('state'), code: 'code' } }));
    }
    close() {}
  }
  const popup = { closed: false, location: { set href(value) { authUrl = value; } } };
  const sandbox = {
    exports: {}, URL, URLSearchParams, TextEncoder, Uint8Array, btoa, crypto: webcrypto, queueMicrotask,
    window: { open: () => popup, setInterval: () => 1 }, clearInterval: () => {}, BroadcastChannel: Channel,
    document: { baseURI: 'https://example.test/' },
    readVariable: async () => null,
    saveSecret: async (_repo, _token, name, value) => { calls.push(['secret', name, JSON.parse(value)]); },
    saveVariable: async () => { calls.push(['variable']); if (failVariable) throw new Error('temporary'); },
    fetch: async (url) => {
      calls.push([String(url)]);
      const value = String(url).includes('oauth2.googleapis.com')
        ? { access_token: 'access', refresh_token: 'refresh' } : { id: 'calendar-id' };
      return { ok: true, status: 200, json: async () => value };
    },
  };
  vm.runInNewContext(chainJs + '\n' + js, sandbox);
  const chain = await sandbox.exports.connectGoogleCalendar('owner/repo', 'token', 'id', 'secret');
  await assert.rejects(chain.run(), /temporary/);
  failVariable = false;
  await chain.run();
  assert.equal(calls.filter((c) => c[0] === 'secret').length, 1);
  assert.equal(calls.filter((c) => c[0] === 'variable').length, 2);
  assert.equal(calls.filter((c) => c[0].includes('oauth2.googleapis.com')).length, 1);
  assert.equal(calls.filter((c) => c[0].includes('calendar/v3/calendars')).length, 1);
  assert.equal(calls.find((c) => c[0] === 'secret')[1], 'GOOGLE_CONNECTION');
});
