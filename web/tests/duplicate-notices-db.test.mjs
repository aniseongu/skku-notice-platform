import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

// 같은 공지가 여러 게시판에 올라올 때: 대표는 가장 먼저 감지된 글이고, 나머지는 판정과 OCR을 건너뛴다. 고쳐진 글은 판정을 지운다.
test('duplicate notices: first seen wins, school needs the same body, external needs the same title, edits clear AI results', async () => {
  const db = new PGlite();
  const u = '00000000-0000-0000-0000-000000000001';
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create table platform_sources (id text primary key, external boolean not null default false);
      create table platform_notices (id text primary key, source_id text not null, title text not null, posted_on date not null,
        first_seen timestamptz not null, body text, dup_key text);
      create table user_source_subscriptions (user_id uuid, source_id text);
      create table user_notice_judgments (user_id uuid, notice_id text);
      create table user_notice_translations (user_id uuid, notice_id text);
      insert into platform_sources values ('skku','f'), ('biz','f'), ('cse','f'), ('ja','t'), ('lk','t');`.replace("'f'", 'false').replace("'f'", 'false').replace("'f'", 'false').replace("'t'", 'true').replace("'t'", 'true'));
    await db.exec('set check_function_bodies = off');
    await db.exec(await readFile(new URL('../../supabase/migrations/20261112110000_duplicate_notices.sql', import.meta.url), 'utf8'));
    await db.exec(await readFile(new URL('../../supabase/migrations/20261112120000_duplicate_notices_image_only.sql', import.meta.url), 'utf8'));
    const long = '장학금 신청 안내입니다. 신청 기간과 제출 서류를 확인하세요. '.repeat(4);
    await db.exec(`insert into platform_notices (id, source_id, title, posted_on, first_seen, body) values
      ('skku/1','skku','[장학] 2026학년도 동계 장학금 신청 안내','2026-11-10','2026-11-10 01:00+00','${long}'),
      ('biz/9','biz','[장학] 2026학년도 동계 장학금 신청 안내!','2026-11-11','2026-11-11 01:00+00','${long}'),
      ('cse/5','cse','[장학] 2026학년도 동계 장학금 신청 안내','2026-11-10','2026-11-10 05:00+00','${long.replace('신청', '접수')}'),
      ('ja/1','ja','[NHN AD] 2027년 상반기 인턴채용','2026-11-10','2026-11-10 02:00+00','자소설 본문'),
      ('lk/1','lk','[NHN AD] 2027 상반기 인턴채용','2026-11-11','2026-11-11 02:00+00','링커리어 본문 다름'),
      ('lk/2','lk','[NHN AD] 2027년 상반기 인턴채용','2026-11-12','2026-11-12 02:00+00','링커리어 본문 다름'),
      ('lk/3','lk','[NHN AD] 2027년 상반기 인턴채용','2026-11-20','2026-11-20 02:00+00','먼 날짜의 같은 제목'),
      ('skku/2','skku','공지','2026-11-10','2026-11-10 01:00+00','${long}');`);
    const keys = Object.fromEntries((await db.query('select id, dup_key from platform_notices')).rows.map((r) => [r.id, r.dup_key]));
    assert.equal(keys['skku/1'], keys['biz/9']);              // 표기 부호만 다른 제목, 같은 본문 → 같은 글
    assert.notEqual(keys['skku/1'], keys['cse/5']);            // 같은 제목이라도 본문이 다르면 다른 글
    assert.match(keys['ja/1'], /^x:/); assert.equal(keys['ja/1'], keys['lk/2']);
    assert.equal(keys['skku/2'], null);                        // 너무 짧은 제목은 합치지 않는다
    const loser = async (id, user = null) => (await db.query('select dup_loser($1, $2) l', [id, user])).rows[0].l;
    assert.equal(await loser('skku/1'), false);                // 가장 먼저 본 글이 대표
    assert.equal(await loser('biz/9'), true);
    assert.equal(await loser('cse/5'), false);
    assert.equal(await loser('lk/2'), true);                   // 외부 공고는 사이트가 달라도 합친다
    assert.equal(await loser('lk/3'), false);                  // 같은 제목이라도 게시일이 3일 넘게 멀면 별개 글
    // 사용자가 볼 수 없는 게시판의 글이 먼저 감지됐어도 그 사용자에게는 대표가 아니다(구독한 게시판의 글을 대표로 삼는다).
    assert.equal(await loser('biz/9', u), false);              // skku를 구독하지 않았다
    await db.exec(`insert into user_source_subscriptions values ('${u}', 'skku')`);
    assert.equal(await loser('biz/9', u), true);
    assert.equal(await loser('lk/2', u), true);                // 외부 공고는 구독과 상관없이 볼 수 있다
    // 글이 고쳐지면 그 글의 판정·번역만 지운다. 본문이 처음 채워지는 경우는 지우지 않는다.
    await db.exec(`insert into user_notice_judgments values ('${u}','skku/1'), ('${u}','biz/9');
      insert into user_notice_translations values ('${u}','skku/1');
      insert into platform_notices (id, source_id, title, posted_on, first_seen) values ('cse/6','cse','본문이 아직 없는 새 글입니다','2026-11-12','2026-11-12 00:00+00');
      insert into user_notice_judgments values ('${u}','cse/6');
      update platform_notices set body = '${long}' where id = 'cse/6';`);
    assert.equal((await db.query("select count(*)::int n from user_notice_judgments where notice_id = 'cse/6'")).rows[0].n, 1);
    await db.exec(`update platform_notices set body = '${long}  수정된 문장입니다.' where id = 'skku/1'`);
    assert.equal((await db.query("select count(*)::int n from user_notice_judgments where notice_id = 'skku/1'")).rows[0].n, 0);
    assert.equal((await db.query("select count(*)::int n from user_notice_translations")).rows[0].n, 0);
    assert.equal((await db.query("select count(*)::int n from user_notice_judgments where notice_id = 'biz/9'")).rows[0].n, 1);
    // 본문이 사진뿐인 학교 글: 정리한 제목이 같고 게시일이 3일 안이면 같은 글이다. 본문이 있는 글과는 합치지 않는다.
    await db.exec(`insert into platform_notices (id, source_id, title, posted_on, first_seen, body) values
      ('skku/20','skku','2026학년도 동계 현장실습 안내 포스터','2026-11-10','2026-11-10 01:00+00','—'),
      ('biz/20','biz','2026학년도 동계 현장실습 안내 포스터!','2026-11-11','2026-11-11 03:00+00',''),
      ('cse/20','cse','2026학년도 동계 현장실습 안내 포스터','2026-11-30','2026-11-30 04:00+00','—'),
      ('cse/21','cse','2026학년도 동계 현장실습 안내 포스터','2026-11-10','2026-11-10 06:00+00','${long}');`);
    const key = async (id) => (await db.query('select dup_key k from platform_notices where id = $1', [id])).rows[0].k;
    assert.equal(await key('skku/20'), await key('biz/20'));
    assert.equal(await loser('biz/20'), true); assert.equal(await loser('skku/20'), false);
    assert.equal(await loser('cse/20'), false);                 // 게시일이 멀면 별개 글
    assert.notEqual(await key('cse/21'), await key('skku/20'));  // 본문이 있는 글은 본문까지 같아야 한다
    assert.equal(await loser('cse/21'), false);
  } finally { await db.close(); }
});
