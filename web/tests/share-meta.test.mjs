import test from 'node:test';
import assert from 'node:assert/strict';
import { escapeHtml, injectMeta, isNoticeId, fetchNotice, describe } from '../functions/share-meta.ts';
import { onRequestGet } from '../functions/index.ts';

const HTML = '<html><head><title>성공</title><meta name="description" content="기본"></head><body></body></html>';
const N = { title: '<script>"장학" & \'인턴\'', source_name: '학부 공지', deadline: '2026-12-05' };

test('id 검증', () => {
  assert.ok(isNoticeId('skku-main/12345'));
  for (const bad of ['', 'a', 'a/b', 'A/1', 'a/1/2', '../1', 'a/1"', 'a'.repeat(201) + '/1', null]) assert.equal(isNoticeId(bad), false);
});
test('이스케이프와 메타 삽입', () => {
  const out = injectMeta(HTML, N, 'https://x.dev/?notice=a%2F1');
  assert.ok(!out.includes('<script>'));
  assert.ok(out.includes('og:title" content="&lt;script&gt;&quot;장학&quot; &amp; &#39;인턴&#39;"'));
  assert.ok(out.includes('학부 공지 · 마감 12월 5일'));
  assert.ok(out.includes('og:url" content="https://x.dev/?notice=a%2F1"'));
  assert.ok(!out.includes('content="기본"'));
  assert.equal(escapeHtml('a&b'), 'a&amp;b');
  assert.equal(describe({ title: 't', source_name: 's', deadline: null }), 's');
});
test('head 없으면 원본', () => assert.equal(injectMeta('<p>x</p>', N, 'u'), '<p>x</p>'));

const assets = (html = HTML) => ({ fetch: async () => new Response(html, { headers: { 'content-type': 'text/html' } }) });
const call = (qs, env) => onRequestGet({ request: new Request(`https://x.dev/${qs}`), env });
const realFetch = globalThis.fetch;

test('핸들러: id 잘못되면 RPC 호출 없이 원본', async () => {
  let called = false; globalThis.fetch = async () => { called = true; return new Response('[]'); };
  const res = await call('?notice=bad', { ASSETS: assets(), SUPABASE_URL: 'https://s.co', SUPABASE_PUBLISHABLE_KEY: 'k' });
  assert.equal(await res.text(), HTML); assert.equal(called, false);
  globalThis.fetch = realFetch;
});
test('핸들러: 성공하면 메타 삽입, RPC 본문 id만', async () => {
  let body;
  globalThis.fetch = async (u, init) => { body = init.body; assert.ok(String(u).endsWith('/rest/v1/rpc/get_public_notice')); return new Response(JSON.stringify([N]), { status: 200 }); };
  const res = await call('?notice=skku-main%2F1', { ASSETS: assets(), SUPABASE_URL: 'https://s.co', SUPABASE_PUBLISHABLE_KEY: 'k' });
  assert.ok((await res.text()).includes('og:title')); assert.equal(body, '{"p_id":"skku-main/1"}');
  assert.equal(res.headers.get('cache-control'), 'public, max-age=300');
  globalThis.fetch = realFetch;
});

test('알림 링크는 공유 메타 RPC 없이 바로 앱 HTML을 돌려준다', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => { assert.fail('알림 진입에 공유 메타 조회를 요청했어요'); };
  try {
    const res = await call('?notice=a%2F1&push=1', { ASSETS: assets(), SUPABASE_URL: 'https://s.co', SUPABASE_PUBLISHABLE_KEY: 'k' });
    assert.equal(await res.text(), HTML);
  } finally { globalThis.fetch = originalFetch; }
});
test('핸들러: RPC 실패·예외·빈 결과·환경변수 없음이면 원본', async () => {
  for (const f of [async () => new Response('x', { status: 500 }), async () => { throw new Error('net'); }, async () => new Response('[]')]) {
    globalThis.fetch = f;
    const res = await call('?notice=a%2F1', { ASSETS: assets(), SUPABASE_URL: 'https://s.co', SUPABASE_PUBLISHABLE_KEY: 'k' });
    assert.equal(await res.text(), HTML);
  }
  const res = await call('?notice=a%2F1', { ASSETS: assets() });
  assert.equal(await res.text(), HTML);
  globalThis.fetch = realFetch;
});
