require('reflect-metadata');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { NestFactory } = require('@nestjs/core');
const { ValidationPipe } = require('@nestjs/common');
const { AppModule } = require('../dist/app');

test('public API validates filters and uses only the public Supabase key', async () => {
  const app = await NestFactory.create(AppModule, { logger: false });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  await app.listen(0, '127.0.0.1');
  const base = await app.getUrl();
  const realFetch = global.fetch;
  const oldUrl = process.env.SUPABASE_URL;
  const oldKey = process.env.SUPABASE_PUBLISHABLE_KEY;
  process.env.SUPABASE_URL = 'https://test-project.supabase.co';
  process.env.SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_test';
  const requests = [];
  global.fetch = async (url, options) => {
    if (String(url).startsWith(base)) return realFetch(url, options);
    requests.push({ url: new URL(url), options });
    return new Response(JSON.stringify([{ id: 'school' }]), { status: 200 });
  };
  try {
    let response = await realFetch(`${base}/notices?source=school&limit=5&offset=2`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), [{ id: 'school' }]);
    assert.equal(requests[0].url.searchParams.get('source_id'), 'eq.school');
    assert.equal(requests[0].url.searchParams.get('limit'), '5');
    assert.equal(requests[0].options.headers.apikey, 'sb_publishable_test');
    response = await realFetch(`${base}/ready`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: 'ok' });
    response = await realFetch(`${base}/notices?limit=101`);
    assert.equal(response.status, 400);
    response = await realFetch(`${base}/notices?source=school%2Cother`);
    assert.equal(response.status, 400);
    response = await realFetch(`${base}/notices?unexpected=value`);
    assert.equal(response.status, 400);
    process.env.SUPABASE_PUBLISHABLE_KEY = 'sb_secret_never-use';
    response = await realFetch(`${base}/sources`);
    assert.equal(response.status, 503);
    assert.equal(requests.length, 2);
  } finally {
    global.fetch = realFetch;
    if (oldUrl === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = oldUrl;
    if (oldKey === undefined) delete process.env.SUPABASE_PUBLISHABLE_KEY; else process.env.SUPABASE_PUBLISHABLE_KEY = oldKey;
    await app.close();
  }
});
