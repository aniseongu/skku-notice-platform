import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const A = '00000000-0000-0000-0000-000000000001';
const B = '00000000-0000-0000-0000-000000000002';

async function database() {
  const db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth to authenticated; insert into auth.users values ('${A}'), ('${B}');`);
  for (const name of ['20261107030000_public_notices.sql', '20261107070000_public_ocr_cache.sql', '20261107110000_user_byok.sql',
    '20261107111000_source_external_flag.sql', '20261107112000_byok_judging.sql']) {
    await db.exec(await readFile(new URL(`../../supabase/migrations/${name}`, import.meta.url), 'utf8'));
  }
  return db;
}

test('profile is owner-only and validated', async () => {
  const db = await database();
  try {
    await db.exec(`set role authenticated; set request.jwt.claim.sub = '${A}';
      insert into user_profiles(user_id, year, enrollment_status) values ('${A}', 3, '재학');`);
    await assert.rejects(db.exec(`insert into user_profiles(user_id, year) values ('${B}', 2)`), /row-level security/);
    await assert.rejects(db.exec(`update user_profiles set year = 9`), /check constraint/);
    await assert.rejects(db.exec(`update user_profiles set enrollment_status = '자유'`), /check constraint/);
    await db.exec(`reset role; insert into user_profiles(user_id, year) values ('${B}', 1); set role authenticated; set request.jwt.claim.sub = '${A}'`);
    assert.deepEqual((await db.query('select year from user_profiles')).rows, [{ year: 3 }]);
  } finally { await db.close(); }
});

test('pending list contains only ready external postings that this user has not judged', async () => {
  const db = await database();
  try {
    await db.exec(`insert into platform_sources(id,name,url,external) values ('school','학교','https://www.skku.edu/n',false), ('ext','외부','https://linkareer.com/list',true);
      insert into platform_notices(id,source_id,article_no,title,url,posted_on,first_seen,fetched_at,body,images) values
        ('school/1','school','1','학교 인턴','https://www.skku.edu/1',current_date,now(),now(),'본문','[]'),
        ('ext/1','ext','1','외부 준비됨','https://linkareer.com/1',current_date,now()-interval '1 hour',now(),'개발 인턴','[]'),
        ('ext/2','ext','2','본문 대기','https://linkareer.com/2',current_date,now(),null,null,'[]'),
        ('ext/3','ext','3','이미지 대기','https://linkareer.com/3',current_date,now(),now(),'본문','["https://img/a.png"]'),
        ('ext/4','ext','4','이미지 완료','https://linkareer.com/4',current_date,now()-interval '2 hours',now(),'본문','["https://img/b.png"]'),
        ('ext/5','ext','5','오래된 이미지 실패','https://linkareer.com/5',current_date,now()-interval '3 hours',now()-interval '25 hours','본문','["https://img/c.png"]');
      insert into platform_ocr_cache(content_sha256,engine_version,extracted_text) values ('${'b'.repeat(64)}','t','그림 속 우대사항');
      insert into platform_notice_images(notice_id,image_url,content_sha256,engine_version,status) values ('ext/4','https://img/b.png','${'b'.repeat(64)}','t','ready');
      insert into user_notice_judgments(user_id,notice_id,verdict,reason,model) values ('${B}','ext/1','relevant','x','m');
      set role service_role;`);
    const forA = (await db.query(`select * from public.list_byok_pending('${A}', 6)`)).rows;
    assert.deepEqual(forA.map((r) => r.notice_id), ['ext/1', 'ext/4', 'ext/5']);
    assert.match(forA.find((r) => r.notice_id === 'ext/4').body, /그림 속 우대사항/);
    const forB = (await db.query(`select * from public.list_byok_pending('${B}', 6)`)).rows;
    assert.deepEqual(forB.map((r) => r.notice_id), ['ext/4', 'ext/5']);
    await db.exec('reset role; set role authenticated');
    await assert.rejects(db.exec(`select * from public.list_byok_pending('${A}', 6)`), /permission denied/);
  } finally { await db.close(); }
});
