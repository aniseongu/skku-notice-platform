import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { renderPublicContent, SITE_URL, parseSitemapPage, sitemapXml, publicCache } from '../functions/seo.ts';
import { onRequestGet as sitemap, onRequestHead } from '../functions/sitemap.xml.ts';
import { onRequestGet as rss, feedXml } from '../functions/rss.xml.ts';
import { onRequestGet as home, onRequestHead as homeHead } from '../functions/index.ts';

const HTML='<html><head><title>성공</title><meta name="description" content="기본"><meta name="google-site-verification" content="keep"></head><body><div id="app"></div></body></html>';
const env={SUPABASE_URL:'https://public.supabase.co',SUPABASE_PUBLISHABLE_KEY:'public',ASSETS:{fetch:async()=>new Response(HTML,{headers:{'content-type':'text/html',etag:'build-1'}})}};
const notice={title:'공지 </script><script>bad()</script>',source_name:'학과 & 소식',deadline:null,posted_on:'2026-11-27',body:'본문 <img src=x onerror=bad()>\n둘째 줄',url:'https://school.test/1'};
const data={pages:2,notices:[{id:'school/1',lastmod:'2026-11-27'}]};
const context=(path,extra={})=>({request:new Request(SITE_URL+path),env,...extra});

test('public notice is rendered before JavaScript with one canonical and safe matching JSON-LD',()=>{
  const html=renderPublicContent(HTML,notice,'school/1');
  assert.equal((html.match(/rel="canonical"/g)||[]).length,1);
  assert.ok(html.includes('href="'+SITE_URL+'/?notice=school%2F1"'));
  assert.ok(html.includes('&lt;img src=x onerror=bad()&gt;'));
  assert.ok(!html.includes('<script>bad'));
  const json=JSON.parse(html.match(/<script type="application\/ld\+json">(.*?)<\/script>/s)[1]);
  assert.equal(json.headline,notice.title); assert.equal(json.datePublished,notice.posted_on);
  assert.ok(html.includes('<notice-app>')); assert.ok(html.includes('원문 보기'));
  assert.ok(html.includes('content="keep"'));
});
test('homepage has website schema and no fictional dates; unsafe original URLs cannot be rendered through fetch',()=>{
  const html=renderPublicContent(HTML);
  assert.ok(html.includes('"@type":"WebSite"')); assert.ok(!html.includes('dateModified'));
  assert.ok(html.includes(SITE_URL+'/rss.xml'));
});
test('sitemap index/parts encode public URLs and retain source modification dates',()=>{
  assert.ok(sitemapXml(data,true,0).includes('<sitemapindex'));
  assert.ok(sitemapXml(data,true,0).includes('/sitemap.xml?page=1'));
  const part=sitemapXml(data,false,0);
  assert.ok(part.includes('school%2F1')); assert.ok(part.includes('<lastmod>2026-11-27</lastmod>'));
  assert.ok(!sitemapXml(data,false,1).includes('<loc>'+SITE_URL+'/</loc>'));
  for(const bad of [null,{pages:0,notices:[]},{pages:1,notices:[{id:'../bad',lastmod:'2026-11-27'}]},{pages:1,notices:[{id:'s/1',lastmod:'bad'}]}]) assert.throws(()=>parseSitemapPage(bad));
});
test('sitemap HTTP, pagination, HEAD, normalized keys, preview noindex, and noncached failures',async()=>{
  const saved=globalThis.fetch;
  try {
    let calls=0;
    globalThis.fetch=async(u,init)=>{calls++; assert.ok(String(u).endsWith('/get_public_sitemap')); assert.equal(init.headers.authorization,'Bearer public'); return Response.json(data);};
    const index=await sitemap(context('/sitemap.xml?utm_source=test'));
    assert.equal(index.status,200); assert.match(index.headers.get('content-type'),/application\/xml/); assert.match(await index.text(),/sitemapindex/);
    assert.equal(index.headers.get('cache-control'),'public, max-age=600');
    const part=await sitemap(context('/sitemap.xml?page=1')); assert.match(await part.text(),/urlset/);
    const head=await onRequestHead(context('/sitemap.xml')); assert.equal(await head.text(),'');
    const preview=await sitemap({...context('/sitemap.xml'),request:new Request('https://dev.skku-notice-platform.pages.dev/sitemap.xml')}); assert.match(preview.headers.get('x-robots-tag'),/noindex/);
    for(const page of ['-1','50000','1.2','foo','01','0%26code=abc']) assert.equal((await sitemap(context('/sitemap.xml?page='+page))).status,404);
    assert.equal(calls,4);
    assert.equal((await sitemap(context('/sitemap.xml?page=2'))).status,404);
    globalThis.fetch=async()=>new Response('no',{status:500});
    const fail=await sitemap(context('/sitemap.xml')); assert.equal(fail.status,503); assert.equal(fail.headers.get('cache-control'),'no-store');
  } finally { globalThis.fetch=saved; }
});
test('public cache reuses successes, does not forward cookies, and retries failures',async()=>{
  const saved=globalThis.caches;
  const map=new Map(); const seen=[];
  globalThis.caches={default:{match:async r=>{seen.push(r);return map.get(r.url)?.clone();},put:async(r,res)=>map.set(r.url,res)}};
  try {
    let calls=0; const key=SITE_URL+'/test'; const create=async()=>{calls++;return new Response('public');};
    await publicCache(context('/',{request:new Request(SITE_URL,{headers:{cookie:'private'}})}),key,create);
    await publicCache(context('/'),key,create); assert.equal(calls,1); assert.equal(seen[0].headers.get('cookie'),null);
    for(let i=0;i<2;i++) await publicCache(context('/'),key+'fail',async()=>{calls++;return new Response('fail',{status:503});});
    assert.equal(calls,3);
  } finally { globalThis.caches=saved; }
});
test('homepage private/push queries skip public RPC; valid notices prerender and absent/transient responses differ',async()=>{
  const saved=globalThis.fetch;
  try {
    globalThis.fetch=async()=>{assert.fail('private query must not request public data');};
    for(const qs of ['?notice=s%2F1&push=1','?view=settings','?notice=s%2F1&code=private','?tab=saved']) {
      const response=await home(context('/'+qs)); assert.equal(response.headers.get('cache-control'),'private, no-store'); assert.match(response.headers.get('x-robots-tag'),/noindex/);
    }
    const root=await home(context('/')); assert.ok((await root.text()).includes('"@type":"WebSite"'));
    globalThis.fetch=async()=>Response.json([notice]);
    const good=await home(context('/?notice=school%2F1&utm_source=tracking')); const html=await good.text(); assert.ok(html.includes('&lt;img')); assert.ok(!html.includes('utm_source=tracking'));
    globalThis.fetch=async()=>Response.json([]); assert.equal((await home(context('/?notice=s%2F1'))).status,404);
    globalThis.fetch=async()=>new Response('fail',{status:500}); const bad=await home(context('/?notice=s%2F1')); assert.equal(bad.status,503); assert.equal(bad.headers.get('cache-control'),'no-store');
  } finally {globalThis.fetch=saved;}
});
test('RSS escapes titles, shares production notice URLs, and returns proper MIME type',async()=>{
  const entries=[{id:'coop/1',title:'<제목> & 안내',source_name:'현장실습',posted_on:'2026-11-27',changed_at:null}];
  const xml=feedXml(entries); assert.ok(xml.includes('&lt;제목&gt; &amp; 안내')); assert.ok(xml.includes('coop%2F1')); assert.ok(xml.includes('Thu, 26 Nov 2026 15:00:00 GMT'));
  assert.ok(!feedXml([{...entries[0],title:'잘못된\u0001문자\ud800'}]).includes('\u0001'));
  const saved=globalThis.fetch; try {globalThis.fetch=async()=>Response.json(entries);const response=await rss(context('/rss.xml'));assert.equal(response.status,200);assert.match(response.headers.get('content-type'),/application\/rss\+xml/);} finally{globalThis.fetch=saved;}
});
test('ownership verification files remain byte-identical to their public tokens',async()=>{
  for(const name of ['google4da781af427eb6cf','naver5876662b897f95fc680e70b62483c30f']) {
    const provider=name.startsWith('google')?'google':'naver';
    assert.equal(await readFile(new URL('../public/'+name+'.html',import.meta.url),'utf8'),`${provider}-site-verification: ${name}.html`);
  }
});

test('a HEAD request cannot cache an empty page for subsequent GET requests',async()=>{
  const saved=globalThis.caches;
  const map=new Map();
  globalThis.caches={default:{match:async r=>map.get(r.url)?.clone(),put:async(r,res)=>map.set(r.url,res)}};
  const backend={...env,ASSETS:{fetch:async request=>new Response(request.method==='HEAD'?null:HTML,{headers:{'content-type':'text/html',etag:'head-build'}})}};
  try {
    const response=await homeHead({request:new Request(SITE_URL+'/',{method:'HEAD'}),env:backend});
    assert.equal(await response.text(),'');
    const get=await home({request:new Request(SITE_URL+'/'),env:backend});
    assert.ok((await get.text()).includes('<notice-app>'));
  } finally {globalThis.caches=saved;}
});
