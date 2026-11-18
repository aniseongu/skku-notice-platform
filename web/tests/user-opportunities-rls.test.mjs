import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

test('opportunities are isolated, validated, limited and survive notice deletion', async () => {
  const db = new PGlite();
  const a = '00000000-0000-0000-0000-000000000001';
  const b = '00000000-0000-0000-0000-000000000002';
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$
        select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      grant usage on schema auth to authenticated;
      insert into auth.users values ('${a}'), ('${b}');`);
    for (const name of ['20261107030000_public_notices.sql', '20261118100000_user_opportunities.sql']) {
      await db.exec(await readFile(new URL(`../../supabase/migrations/${name}`, import.meta.url), 'utf8'));
    }
    await db.exec(`insert into platform_sources(id,name,url) values ('school','학교','https://www.skku.edu/notice');
      insert into platform_notices(id,source_id,article_no,title,url,posted_on,first_seen)
      values ('school/1','school','1','공지','https://www.skku.edu/notice?articleNo=1','2026-11-01',now());
      insert into user_opportunities(user_id,notice_id,title) values ('${b}','school/1','남의 기록');
      set role authenticated; set request.jwt.claim.sub = '${a}';`);
    assert.equal((await db.query('select * from user_opportunities')).rows.length, 0);
    assert.equal((await db.query(`update user_opportunities set note='x' where user_id='${b}' returning *`)).rows.length, 0);
    assert.equal((await db.query(`delete from user_opportunities where user_id='${b}' returning *`)).rows.length, 0);
    await assert.rejects(db.exec(`insert into user_opportunities(user_id,notice_id,title) values ('${b}','x','t')`), /row-level security/);
    await db.exec(`insert into user_opportunities(user_id,notice_id,title,url) values ('${a}','school/1','내 기록','https://www.skku.edu/x')`);
    assert.equal((await db.query('select * from user_opportunities')).rows.length, 1);
    await assert.rejects(db.exec(`update user_opportunities set user_id='${b}' where user_id='${a}'`), /row-level security/);
    // 상태·길이·링크 제약
    await assert.rejects(db.exec(`update user_opportunities set status='done'`), /check/);
    await assert.rejects(db.exec(`update user_opportunities set note='${'가'.repeat(501)}'`), /check/);
    await db.exec(`update user_opportunities set note='${'가'.repeat(500)}', status='applied'`);
    await assert.rejects(db.exec(`insert into user_opportunities(user_id,notice_id,title) values ('${a}','t1','${'가'.repeat(201)}')`), /check/);
    await assert.rejects(db.exec(`insert into user_opportunities(user_id,notice_id,title,url) values ('${a}','t2','t','javascript:alert(1)')`), /check/);
    await assert.rejects(db.exec(`insert into user_opportunities(user_id,notice_id,title,url) values ('${a}','t3','t','https://x.kr/${'a'.repeat(1000)}')`), /check/);
    // updated_at 갱신
    const before = (await db.query('select updated_at from user_opportunities')).rows[0].updated_at;
    await new Promise((r) => setTimeout(r, 5));
    await db.exec(`update user_opportunities set status='result'`);
    assert.ok((await db.query('select updated_at from user_opportunities')).rows[0].updated_at > before);
    // 공지가 삭제돼도 행 유지
    await db.exec('reset role');
    await db.exec(`delete from platform_notices where id='school/1'`);
    await db.exec(`set role authenticated; set request.jwt.claim.sub = '${a}'`);
    assert.equal((await db.query('select * from user_opportunities')).rows.length, 1);
    // 200행 제한: 이미 1행, 199행 더 가능, 201번째 거절. 다른 사용자는 영향 없음
    await db.exec(`insert into user_opportunities(user_id,notice_id,title) select '${a}','n'||g,'t' from generate_series(1,199) g`);
    assert.equal((await db.query('select count(*)::int c from user_opportunities')).rows[0].c, 200);
    await assert.rejects(db.exec(`insert into user_opportunities(user_id,notice_id,title) values ('${a}','over','t')`), /limit/);
    // 한도(200행)에 닿아도 이미 있는 행의 상태·메모 수정(upsert)은 된다
    const existing = (await db.query(`select notice_id from user_opportunities where user_id='${a}' limit 1`)).rows[0].notice_id;
    await db.exec(`insert into user_opportunities(user_id,notice_id,title,status) values ('${a}','${existing}','t','applied') on conflict (user_id,notice_id) do update set status = excluded.status`);
    assert.equal((await db.query(`select status from user_opportunities where user_id='${a}' and notice_id='${existing}'`)).rows[0].status, 'applied');
    await db.exec(`set request.jwt.claim.sub = '${b}'`);
    await db.exec(`insert into user_opportunities(user_id,notice_id,title) values ('${b}','mine','t')`);
    await db.exec('reset role; set role anon');
    await assert.rejects(db.exec('select * from user_opportunities'), /permission denied/);
    // 사용자 삭제 시 cascade
    await db.exec('reset role');
    await db.exec(`delete from auth.users where id='${a}'`);
    assert.equal((await db.query(`select count(*)::int c from user_opportunities where user_id='${a}'`)).rows[0].c, 0);
  } finally { await db.close(); }
});
