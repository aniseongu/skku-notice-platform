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
    '20261107111000_source_external_flag.sql', '20261107112000_byok_judging.sql', '20261110100000_grad_intern_assessments.sql']) {
    await db.exec(await readFile(new URL(`../../supabase/migrations/${name}`, import.meta.url), 'utf8'));
  }
  await db.exec(`insert into platform_sources(id,name,url,external) values ('ext','외부','https://linkareer.com/list',true);
    insert into platform_notices(id,source_id,article_no,title,url,posted_on,first_seen,fetched_at,body,images) values
      ('ext/1','ext','1','개발 인턴','https://linkareer.com/1',current_date,now(),now(),'전일제 근무','[]');`);
  return db;
}

const as = (user) => `reset role; set role authenticated; set request.jwt.claim.sub = '${user}'`;

test('a user can only request their own assessment and only as PENDING', async () => {
  const db = await database();
  try {
    await db.exec(`${as(A)}; insert into user_notice_graduation_assessments(user_id, notice_id) values ('${A}', 'ext/1')`);
    await assert.rejects(db.exec(`insert into user_notice_graduation_assessments(user_id, notice_id) values ('${B}', 'ext/1')`), /row-level security/);
    await assert.rejects(db.exec(`insert into user_notice_graduation_assessments(user_id, notice_id, status) values ('${A}', 'ext/1', 'READY')`), /row-level security|duplicate key|check/);
  } finally { await db.close(); }
});

test('result columns cannot be written by the user, only by the service role', async () => {
  const db = await database();
  try {
    await db.exec(`${as(A)}; insert into user_notice_graduation_assessments(user_id, notice_id) values ('${A}', 'ext/1')`);
    await assert.rejects(db.exec(`update user_notice_graduation_assessments set department = '{"status":"LIKELY"}'::jsonb`), /permission denied/);
    await assert.rejects(db.exec(`update user_notice_graduation_assessments set input_hash = 'x'`), /permission denied/);
    await assert.rejects(db.exec(`update user_notice_graduation_assessments set status = 'READY'`), /row-level security|violates/);
    await assert.rejects(db.exec(`insert into user_notice_graduation_assessments(user_id, notice_id, department) values ('${A}', 'ext/1', '{}'::jsonb)`), /permission denied/);
    await db.exec(`reset role; set role service_role; update user_notice_graduation_assessments set status='READY', department='{"status":"LIKELY"}'::jsonb`);
    await db.exec(`${as(A)}; update user_notice_graduation_assessments set status = 'PENDING', requested_at = now()`);
    assert.equal((await db.query('select department from user_notice_graduation_assessments')).rows[0].department.status, 'LIKELY');
  } finally { await db.close(); }
});

test("one user cannot read, change or delete another user's assessment", async () => {
  const db = await database();
  try {
    await db.exec(`reset role; insert into user_notice_graduation_assessments(user_id, notice_id, status, department) values ('${A}', 'ext/1', 'READY', '{"status":"LIKELY"}'::jsonb)`);
    await db.exec(as(B));
    assert.equal((await db.query('select * from user_notice_graduation_assessments')).rows.length, 0);
    await db.exec(`update user_notice_graduation_assessments set requested_at = now()`);
    await db.exec(`delete from user_notice_graduation_assessments`);
    await db.exec('reset role');
    assert.equal((await db.query('select * from user_notice_graduation_assessments')).rows.length, 1);
    await db.exec(as('00000000-0000-0000-0000-000000000000'));
    assert.equal((await db.query('select * from user_notice_graduation_assessments')).rows.length, 0);
  } finally { await db.close(); }
});

test('the worker list is service-only, ordered by request time and carries only the profile columns it needs', async () => {
  const db = await database();
  try {
    await db.exec(`insert into user_profiles(user_id, programs, admission_year, university_3p_internship_selected) values
        ('${A}', '[{"college":"소프트웨어융합대학","department":"소프트웨어학과"}]'::jsonb, 2022, true);
      insert into user_notice_graduation_assessments(user_id, notice_id, requested_at) values ('${A}', 'ext/1', now());
      set role service_role;`);
    const rows = (await db.query('select * from public.list_graduation_requests(5)')).rows;
    assert.equal(rows.length, 1);
    assert.deepEqual(Object.keys(rows[0]).sort(), ['admission_year', 'body', 'input_hash', 'notice_id', 'programs', 'title', 'university_3p_internship_selected', 'user_id']);
    assert.equal(rows[0].admission_year, 2022);
    await db.exec(as(A));
    await assert.rejects(db.exec('select * from public.list_graduation_requests(5)'), /permission denied/);
  } finally { await db.close(); }
});

test('profile accepts only a plausible admission year', async () => {
  const db = await database();
  try {
    await db.exec(`${as(A)}; insert into user_profiles(user_id, admission_year) values ('${A}', 2022)`);
    await assert.rejects(db.exec(`update user_profiles set admission_year = 1999`), /check constraint/);
    await assert.rejects(db.exec(`update user_profiles set admission_year = 2300`), /check constraint/);
  } finally { await db.close(); }
});
