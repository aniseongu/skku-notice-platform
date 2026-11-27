import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

test('sitemap/feed expose bounded public metadata for every notice kind while tables stay private', async () => {
  const db = new PGlite();
  const sql = await readFile(new URL('../../supabase/migrations/20261127120000_public_sitemap.sql', import.meta.url), 'utf8');
  try {
    await db.exec('create role anon; create role authenticated; create role service_role bypassrls');
    for (const name of ['20261107030000_public_notices.sql', '20261107031000_notice_changes.sql']) await db.exec(await readFile(new URL(`../../supabase/migrations/${name}`, import.meta.url), 'utf8'));
    await db.exec(`alter table platform_sources add column coop boolean not null default false;
      alter table platform_notices add column expires_at timestamptz;
      revoke select on platform_sources, platform_notices from anon;
      insert into platform_sources(id,name,url,coop) values ('school','학교','https://school.test',false),('coop','현장실습','https://tollgate.test',true);
      insert into platform_notices(id,source_id,article_no,title,url,posted_on,first_seen,changed_at,body)
      select 'school/'||i,'school',i::text,'공지 '||i,'https://school.test/'||i,'2026-11-01',now(),null,'PRIVATE BODY NOT IN FEED' from generate_series(1,1001) i;
      insert into platform_notices(id,source_id,article_no,title,url,posted_on,first_seen) values ('coop/1','coop','1','실습','https://tollgate.test/1','2026-11-02',now());
      update platform_notices set changed_at='2026-11-25T10:00:00Z' where id='school/1';
      update platform_notices set expires_at=now()-interval '1 day' where id='school/2';`);
    await db.exec(sql); await db.exec(sql);
    const page = async (n) => (await db.query('select get_public_sitemap($1) data', [n])).rows[0].data;
    await db.exec('set role anon');
    const first = await page(0), second = await page(1);
    assert.equal(first.pages, 2); assert.equal(first.notices.length, 1000); assert.equal(second.notices.length, 1);
    const all = [...first.notices, ...second.notices];
    assert.equal(new Set(all.map(n => n.id)).size, 1001);
    assert.ok(all.some(n => n.id === 'coop/1'));
    assert.ok(!all.some(n => n.id === 'school/2'));
    assert.match(all.find(n => n.id === 'school/1').lastmod, /2026-11-25/);
    assert.equal(all.find(n => n.id === 'coop/1').lastmod, '2026-11-02');
    assert.deepEqual(Object.keys(first).sort(), ['notices','pages']);
    assert.deepEqual(Object.keys(first.notices[0]).sort(), ['id','lastmod']);
    assert.deepEqual((await page(2)).notices, []);
    for (const n of [-1, null, 50000]) await assert.rejects(page(n), /invalid sitemap page/);
    for (const table of ['platform_notices','platform_sources']) await assert.rejects(db.query(`select * from ${table}`), /permission denied/);
    const feed = (await db.query('select * from get_public_notice_feed()')).rows;
    assert.equal(feed.length, 50); assert.equal(feed[0].id, 'school/1');
    assert.deepEqual(Object.keys(feed[0]).sort(), ['changed_at','id','posted_on','source_name','title']);
    assert.ok(feed.some(n => n.id === 'coop/1'));
    await db.exec('reset role');
    await db.exec("delete from platform_notices where id='school/3'; update platform_notices set changed_at='2026-11-26T11:00:00Z' where id='coop/1'");
    await db.exec('set role authenticated');
    const next = await page(0);
    assert.equal(next.pages,1); assert.equal(next.notices.length,1000);
    assert.match(next.notices.find(n=>n.id==='coop/1').lastmod,/2026-11-26/);
    await db.exec('reset role');
    const config=(await db.query("select prosecdef,proconfig from pg_proc where oid='get_public_sitemap(integer)'::regprocedure")).rows[0];
    assert.equal(config.prosecdef,true); assert.ok(config.proconfig.some(v=>v.startsWith('search_path=')));
  } finally { await db.close(); }
});
