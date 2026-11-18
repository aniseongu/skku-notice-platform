import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const ALLOWED = ['id', 'source_id', 'source_name', 'external', 'title', 'category', 'url', 'posted_on', 'deadline', 'body', 'body_html'].sort();

test('public notice preview reads one notice by id without opening the tables', async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;`);
    for (const name of ['20261107030000_public_notices.sql', '20261107111000_source_external_flag.sql',
      '20261107031000_notice_changes.sql']) {
      await db.exec(await readFile(new URL(`../../supabase/migrations/${name}`, import.meta.url), 'utf8'));
    }
    // 20261113140000_coop_login_only.sql의 표 접근 상태를 재현한다(그 파일은 다른 표가 많아 통째로 못 올린다).
    await db.exec(`alter table platform_sources add column if not exists coop boolean not null default false;
      alter table platform_notices add column if not exists expires_at timestamptz;
      revoke select on platform_sources, platform_notices from anon;
      drop policy "Public can read school sources" on platform_sources;
      drop policy "Public can read school notices" on platform_notices;
      create policy "Signed-in can read sources" on platform_sources for select to authenticated using (true);
      create policy "Signed-in can read notices" on platform_notices for select to authenticated using (true);
      create function public.purge_expired_data(a integer, b integer, c integer) returns jsonb language sql as $$ select '{}'::jsonb $$;
      revoke all on function public.purge_expired_data(integer,integer,integer) from public, anon, authenticated;`);
    await db.exec(await readFile(new URL('../../supabase/migrations/20261118110000_public_notice_preview.sql', import.meta.url), 'utf8'));
    // 두 번 적용해도 된다(멱등)
    await db.exec(await readFile(new URL('../../supabase/migrations/20261118110000_public_notice_preview.sql', import.meta.url), 'utf8'));
    await db.exec(`insert into platform_sources(id,name,url) values ('school','학교','https://www.skku.edu/notice');
      insert into platform_notices(id,source_id,article_no,title,url,posted_on,first_seen,body,body_html,deadline)
      values ('school/1','school','1','공지','https://www.skku.edu/n?1','2026-11-01',now(),'본문','<p>본문</p>','2026-12-01'),
             ('school/2','school','2','만료','https://www.skku.edu/n?2','2026-11-01',now(),'x','x',null);
      update platform_notices set expires_at = now() - interval '1 day' where id='school/2';
      insert into platform_sources(id,name,url,external,coop) values ('skku-coop','현장실습','https://tollgate.skku.edu/x',true,true);
      insert into platform_notices(id,source_id,article_no,title,url,posted_on,first_seen,body,body_html)
      values ('skku-coop/7','skku-coop','7','현장실습','https://tollgate.skku.edu/7','2026-11-01',now(),'x','x');`);

    await db.exec('set role anon');
    const r = await db.query(`select * from public.get_public_notice('school/1')`);
    assert.equal(r.rows.length, 1);
    assert.deepEqual(r.fields.map((f) => f.name).sort(), ALLOWED);
    assert.equal(r.rows[0].title, '공지');
    assert.equal(r.rows[0].source_name, '학교');
    assert.equal(r.rows[0].external, false);
    // 표는 직접 못 읽는다
    await assert.rejects(db.exec('select * from platform_notices'), /permission denied/);
    await assert.rejects(db.exec('select * from platform_sources'), /permission denied/);
    // 없는 id, 만료된 공지는 빈 결과
    assert.equal((await db.query(`select * from public.get_public_notice('school/999')`)).rows.length, 0);
    assert.equal((await db.query(`select * from public.get_public_notice('school/2')`)).rows.length, 0);
    // 현장실습(coop)도 미리보기에 포함한다(사용자 결정)
    assert.equal((await db.query(`select * from public.get_public_notice('skku-coop/7')`)).rows.length, 1);
    // 잘못된 입력은 거절
    for (const bad of ['', 'school', 'school/1 or 1=1', "school/1'--", 'School/1', 'school/a', `s/${'1'.repeat(200)}`, '../etc/1']) {
      await assert.rejects(db.query('select * from public.get_public_notice($1)', [bad]), /invalid notice id/, bad);
    }
    await assert.rejects(db.query('select * from public.get_public_notice($1)', [null]), /invalid notice id/);

    // 권한: anon·authenticated 가능, 다른 내부 함수는 불가 유지
    await db.exec('reset role');
    const has = async (role, fn) => (await db.query(`select has_function_privilege('${role}', '${fn}', 'execute') ok`)).rows[0].ok;
    assert.equal(await has('anon', 'public.get_public_notice(text)'), true);
    assert.equal(await has('authenticated', 'public.get_public_notice(text)'), true);
    assert.equal(await has('anon', 'public.purge_expired_data(integer,integer,integer)'), false);
    assert.equal(await has('authenticated', 'public.purge_expired_data(integer,integer,integer)'), false);
    // 이 함수 말고 anon이 실행할 수 있는 public 함수가 없다
    const open = (await db.query(`select p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and has_function_privilege('anon', p.oid, 'execute')`)).rows.map((x) => x.proname);
    assert.deepEqual(open, ['get_public_notice']);
  } finally { await db.close(); }
});
