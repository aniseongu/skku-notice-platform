import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const A = '00000000-0000-0000-0000-000000000001';
const SHA = 'a'.repeat(64);

async function database() {
  const db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
    grant usage on schema auth to authenticated; insert into auth.users values ('${A}');`);
  for (const name of ['20261107030000_public_notices.sql', '20261107070000_public_ocr_cache.sql', '20261107110000_user_byok.sql',
    '20261107111000_source_external_flag.sql', '20261107112000_byok_judging.sql', '20261110100000_grad_intern_assessments.sql',
    '20261113110000_requeue_graduation_matching.sql']) {
    await db.exec(await readFile(new URL(`../../supabase/migrations/${name}`, import.meta.url), 'utf8'));
  }
  await db.exec(`insert into platform_sources(id,name,url,external) values ('ext','외부','https://linkareer.com/list',true);
    insert into platform_ocr_cache(content_sha256, engine_version, extracted_text) values ('${SHA}', 'e1', '주 5일 근무 포스터');
    insert into platform_notices(id,source_id,article_no,title,url,posted_on,first_seen,fetched_at,body,images) values
      ('ext/1','ext','1','개발 인턴','https://linkareer.com/1',current_date,now() - interval '3 days',now(),'하루 8시간 근무','[]'),
      ('ext/2','ext','2','디자인 인턴','https://linkareer.com/2',current_date,now() - interval '2 days',now(),'하루 8시간 근무','[]'),
      ('ext/3','ext','3','기획 인턴','https://linkareer.com/3',current_date,now() - interval '1 days',now(),'다른 내용','[]'),
      ('ext/4','ext','4','포스터 인턴','https://linkareer.com/4',current_date,now(),now(),'본문 없음','[]');
    insert into platform_notice_images(notice_id, image_url, content_sha256, engine_version, status)
      values ('ext/4', 'https://linkareer.com/p.png', '${SHA}', 'e1', 'ready');
    insert into user_notice_graduation_assessments(user_id, notice_id, status, input_hash)
      select '${A}', id, 'READY', 'h-' || id from platform_notices;`);
  return db;
}

const state = async (db) => Object.fromEntries((await db.query('select notice_id, status, input_hash from user_notice_graduation_assessments')).rows.map((r) => [r.notice_id, r]));

test('only READY rows whose text matches become PENDING with a reset input_hash', async () => {
  const db = await database();
  try {
    assert.equal((await db.query(`select public.requeue_graduation_matching('8시간') as n`)).rows[0].n, 2);
    const s = await state(db);
    for (const id of ['ext/1', 'ext/2']) assert.deepEqual([s[id].status, s[id].input_hash], ['PENDING', null]);
    assert.deepEqual([s['ext/3'].status, s['ext/3'].input_hash], ['READY', 'h-ext/3']);
    // 대소문자를 가리지 않는다
    assert.equal((await db.query(`select public.requeue_graduation_matching('다른 \\s*내용') as n`)).rows[0].n, 1);
  } finally { await db.close(); }
});

test('OCR text of ready images is matched', async () => {
  const db = await database();
  try {
    assert.equal((await db.query(`select public.requeue_graduation_matching('주 5일 근무 포스터') as n`)).rows[0].n, 1);
    assert.equal((await state(db))['ext/4'].status, 'PENDING');
  } finally { await db.close(); }
});

test('limit is respected newest notices first, and blank patterns do nothing', async () => {
  const db = await database();
  try {
    assert.equal((await db.query(`select public.requeue_graduation_matching('인턴', 2) as n`)).rows[0].n, 2);
    const s = await state(db);
    assert.equal(s['ext/4'].status, 'PENDING');
    assert.equal(s['ext/3'].status, 'PENDING');
    assert.equal(s['ext/1'].status, 'READY');
    for (const blank of [null, '', '   ']) {
      assert.equal((await db.query('select public.requeue_graduation_matching($1) as n', [blank])).rows[0].n, 0);
    }
    assert.equal((await db.query(`select has_function_privilege('authenticated', 'public.requeue_graduation_matching(text,integer)', 'execute') as a,
      has_function_privilege('service_role', 'public.requeue_graduation_matching(text,integer)', 'execute') as s`)).rows[0].a, false);
  } finally { await db.close(); }
});
