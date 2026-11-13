import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

// 같은 공지의 사본: 번역·졸업요건 대기열에서 빼고, 대표가 바뀌면 사본의 AI 결과를 복사해 다시 부르지 않는다.
test('duplicate AI: copies skip queues, results are reused for the new representative, isolated per user', async () => {
  const db = new PGlite();
  const u = '00000000-0000-0000-0000-000000000001';
  const v = '00000000-0000-0000-0000-000000000002';
  const sql = (name) => readFile(new URL(`../../supabase/migrations/${name}`, import.meta.url), 'utf8');
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create table platform_sources (id text primary key, external boolean not null default false);
      create table platform_notices (id text primary key, source_id text not null, title text not null, posted_on date not null,
        first_seen timestamptz not null, body text, dup_key text, fetched_at timestamptz default now(), deadline timestamptz);
      create table platform_notice_images (notice_id text, image_url text, status text, content_sha256 text, engine_version text);
      create table platform_ocr_cache (content_sha256 text, engine_version text, extracted_text text, processed_at timestamptz);
      create table user_source_subscriptions (user_id uuid, source_id text, notifications_enabled boolean not null default true);
      create table user_byok_keys (user_id uuid, disabled_at timestamptz, used_on date, used_today int);
      create table user_profiles (user_id uuid, onboarded_at timestamptz, programs jsonb, dept_internship_done boolean,
        university_3p_internship_done boolean, university_3p_internship_selected boolean, updated_at timestamptz default now());
      create table user_notice_judgments (user_id uuid, notice_id text, verdict text, reason text, model text,
        created_at timestamptz default now(), summary text, deadline timestamptz, deadline_kind text, deadline_checked boolean default false,
        primary key (user_id, notice_id));
      create table user_notice_translations (user_id uuid, notice_id text, title text, body text, model text, attempts int, updated_at timestamptz,
        primary key (user_id, notice_id));
      create table user_notice_graduation_assessments (user_id uuid, notice_id text, status text default 'PENDING',
        requested_at timestamptz default now(), input_hash text, ruleset_version text, extractor_version text, ai_status text, model text,
        department jsonb, university_3p jsonb, facts jsonb, assessed_at timestamptz, primary key (user_id, notice_id));
      create function is_graduation_candidate_notice(t text, s text, e boolean) returns boolean language sql as $$ select true $$;
      insert into platform_sources values ('skku', false), ('biz', false);`);
    await db.exec('set check_function_bodies = off');
    for (const f of ['20261112110000_duplicate_notices.sql', '20261112120000_duplicate_notices_image_only.sql',
      '20261112130000_duplicate_notices_ocr_text.sql', '20261112140000_duplicate_notices_title_only_for_image.sql',
      '20261112170000_duplicate_external_company_title.sql']) await db.exec(await sql(f));
    await db.exec(await sql('20261113120000_dedupe_duplicate_ai.sql'));
    // 두 번 적용해도 같다(멱등).
    await db.exec(await sql('20261113120000_dedupe_duplicate_ai.sql'));
    const long = '장학금 신청 안내입니다. 신청 기간과 제출 서류를 확인하세요. '.repeat(4);
    const eng = 'Internship program announcement for software engineers. Please apply before the deadline. '.repeat(3);
    await db.exec(`insert into platform_notices (id, source_id, title, posted_on, first_seen, body) values
      ('skku/1','skku','[장학] 동계 장학금 신청 안내','2026-11-10','2026-11-10 01:00+00','${long}'),
      ('biz/9','biz','[장학] 동계 장학금 신청 안내','2026-11-11','2026-11-11 01:00+00','${long}'),
      ('skku/2','skku','Internship program for software engineers','2026-11-10','2026-11-10 01:00+00','${eng}'),
      ('biz/10','biz','Internship program for software engineers','2026-11-11','2026-11-11 01:00+00','${eng}');
      update platform_notices set dup_key = 'k1' where id in ('skku/1','biz/9');
      update platform_notices set dup_key = 'k2' where id in ('skku/2','biz/10');
      insert into user_byok_keys values ('${u}', null, null, 0);
      insert into user_profiles (user_id, onboarded_at, programs, university_3p_internship_selected) values ('${u}', now(), '[]', true);
      insert into user_source_subscriptions values ('${u}', 'biz'), ('${v}', 'biz');`);
    const n = async (q, args = []) => (await db.query(q, args)).rows[0].n;
    // u는 biz만 구독했다 → biz/9가 대표(보이는 글 중 먼저). 판정·번역·졸업요건이 biz/9에 있다.
    await db.exec(`insert into user_notice_judgments (user_id, notice_id, verdict, reason, model, summary) values
        ('${u}','biz/9','relevant','관련 있어요','m','요약'), ('${v}','biz/9','not_relevant','아님','m',null);
      insert into user_notice_translations values ('${u}','biz/10','번역 제목','번역 본문','m',1,now());
      insert into user_notice_graduation_assessments (user_id, notice_id, status, input_hash, ruleset_version, ai_status, assessed_at)
        values ('${u}','biz/9','READY','h1','r1','used',now()), ('${u}','biz/10','PENDING',null,null,null,null);`);
    assert.equal(await n('select reuse_duplicate_ai() n'), 0);   // 아직 skku를 구독하지 않았다 → 대표는 biz/9 그대로
    // u가 skku를 구독 → skku/1이 대표가 되고, biz/9 사본의 판정과 졸업요건이 복사된다(번역은 biz/10→skku/2).
    await db.exec(`insert into user_source_subscriptions values ('${u}', 'skku')`);
    assert.equal(await n('select reuse_duplicate_ai() n'), 3);
    assert.equal(await n(`select count(*)::int n from user_notice_judgments where user_id='${u}' and notice_id='skku/1' and reason='관련 있어요' and summary='요약'`), 1);
    assert.equal(await n(`select count(*)::int n from user_notice_translations where user_id='${u}' and notice_id='skku/2' and title='번역 제목'`), 1);
    assert.equal(await n(`select count(*)::int n from user_notice_graduation_assessments where user_id='${u}' and notice_id='skku/1' and status='READY' and input_hash='h1'`), 1); // PENDING인 biz/10 행은 복사하지 않는다
    assert.equal(await n(`select count(*)::int n from user_notice_graduation_assessments where user_id='${u}' and notice_id='skku/2'`), 0);
    assert.equal(await n('select reuse_duplicate_ai() n'), 0);   // 두 번째 호출은 복사할 것이 없다
    // 격리: 다른 사용자(skku 미구독)에게는 아무것도 생기지 않는다.
    assert.equal(await n(`select count(*)::int n from user_notice_judgments where user_id='${v}'`), 1);
    assert.equal(await n(`select count(*)::int n from user_notice_judgments where user_id='${v}' and notice_id='skku/1'`), 0);
    // 사본은 번역·졸업요건 대기열에 들어가지 않는다. (u는 skku 구독 → biz 쪽이 사본)
    await db.exec(`delete from user_notice_graduation_assessments where user_id='${u}'`);
    await db.exec(`insert into user_byok_keys values ('${v}', null, null, 0)`);
    await db.exec(`insert into user_notice_translations values ('${u}','skku/2','x','y','m',1,now()) on conflict do nothing`);
    assert.equal(await n(`select count(*)::int n from list_byok_pending_translation('${u}', 3) where notice_id = 'biz/10'`), 0);
    assert.equal(await n(`select count(*)::int n from list_byok_pending_translation('${v}', 3) where notice_id = 'biz/10'`), 1); // v는 biz만 → 대표
    await db.exec('select enqueue_graduation_assessments(50)');
    const queued = (await db.query(`select user_id, notice_id from user_notice_graduation_assessments order by 1, 2`)).rows;
    assert.ok(!queued.some((r) => r.user_id === u && r.notice_id.startsWith('biz/')), JSON.stringify(queued)); // u의 사본 biz/*
    assert.ok(queued.some((r) => r.user_id === u && r.notice_id === 'skku/1'));
    // 권한: anon·authenticated는 실행할 수 없고 service_role만 된다.
    for (const role of ['anon', 'authenticated']) {
      assert.equal(await n(`select has_function_privilege('${role}', 'public.reuse_duplicate_ai(integer)', 'execute') n`), false);
    }
    assert.equal(await n(`select has_function_privilege('service_role', 'public.reuse_duplicate_ai(integer)', 'execute') n`), true);
  } finally { await db.close(); }
});
