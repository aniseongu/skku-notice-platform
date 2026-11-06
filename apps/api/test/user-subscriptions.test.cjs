require('reflect-metadata');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { NestFactory } = require('@nestjs/core');
const { AppModule } = require('../dist/app');

test('subscription API verifies JWT and preserves its user context', async () => {
  const app = await NestFactory.create(AppModule, { logger: false });
  await app.listen(0, '127.0.0.1');
  const base = await app.getUrl();
  const realFetch = global.fetch, oldUrl = process.env.SUPABASE_URL, oldKey = process.env.SUPABASE_PUBLISHABLE_KEY;
  process.env.SUPABASE_URL = 'https://test-project.supabase.co';
  process.env.SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_test';
  const a = '00000000-0000-0000-0000-000000000001';
  const b = '00000000-0000-0000-0000-000000000002';
  const rows = new Set();
  let calls = 0;
  global.fetch = async (url, options) => {
    const endpoint = new URL(url); calls++;
    const id = options.headers.Authorization === 'Bearer a.b.c' ? a : options.headers.Authorization === 'Bearer d.e.f' ? b : null;
    if (!id) return new Response('', { status: 401 });
    if (endpoint.pathname === '/auth/v1/user') return Response.json({ id });
    assert.equal(options.headers.apikey, 'sb_publishable_test');
    if (options.method === 'POST') {
      const body = JSON.parse(options.body);
      assert.equal(body.user_id, id);
      rows.add(`${id}/${body.source_id}`);
      return new Response(null, { status: 201 });
    }
    assert.equal(endpoint.searchParams.get('user_id'), `eq.${id}`);
    if (options.method === 'DELETE') {
      rows.delete(`${id}/${endpoint.searchParams.get('source_id').slice(3)}`);
      return new Response(null, { status: 204 });
    }
    return Response.json([...rows].filter((r) => r.startsWith(id+'/')).map((r) => ({ source_id: r.slice(id.length+1) })));
  };
  try {
    assert.equal((await realFetch(`${base}/me/subscriptions`)).status, 401);
    assert.equal(calls, 0);
    assert.equal((await realFetch(`${base}/me/subscriptions/school`, { method: 'PUT', headers: { Authorization: 'Bearer a.b.c' } })).status, 200);
    const bResponse = await realFetch(`${base}/me/subscriptions`, { headers: { Authorization: 'Bearer d.e.f' } });
    assert.deepEqual(await bResponse.json(), []);
    assert.equal((await realFetch(`${base}/me/subscriptions/school`, { method: 'DELETE', headers: { Authorization: 'Bearer d.e.f' } })).status, 200);
    const aResponse = await realFetch(`${base}/me/subscriptions`, { headers: { Authorization: 'Bearer a.b.c' } });
    assert.deepEqual(await aResponse.json(), [{ source_id: 'school' }]);
    assert.equal((await realFetch(`${base}/me/subscriptions/invalid%2Csource`, { method: 'PUT', headers: { Authorization: 'Bearer a.b.c' } })).status, 400);
    assert.equal((await realFetch(`${base}/me/subscriptions`, { headers: { Authorization: 'Bearer x.y.z' } })).status, 401);
  } finally {
    global.fetch = realFetch;
    if (oldUrl === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = oldUrl;
    if (oldKey === undefined) delete process.env.SUPABASE_PUBLISHABLE_KEY; else process.env.SUPABASE_PUBLISHABLE_KEY = oldKey;
    await app.close();
  }
});
