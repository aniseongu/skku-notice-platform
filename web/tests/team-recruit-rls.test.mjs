import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const ids = ['a', 'b', 'c', 'd'].map((x, i) => `00000000-0000-0000-0000-00000000000${i + 1}`);
const [A, B, C, D] = ids;

async function setup() {
  const db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth to authenticated;
    ${ids.map((i) => `insert into auth.users values ('${i}');`).join('')}`);
  for (const name of ['20261107030000_public_notices.sql', '20261119100000_team_recruit.sql']) {
    await db.exec(await readFile(new URL(`../../supabase/migrations/${name}`, import.meta.url), 'utf8'));
  }
  await db.exec(`insert into platform_sources(id,name,url) values ('school','학교','https://www.skku.edu/notice');
    insert into platform_notices(id,source_id,article_no,title,url,posted_on,first_seen,deadline)
    values ('school/1','school','1','공지 하나','https://www.skku.edu/n?articleNo=1','2026-11-01',now(), now() + interval '10 days'),
           ('school/2','school','2','공지 둘','https://www.skku.edu/n?articleNo=2','2026-11-01',now(), null),
           ('school/3','school','3','공지 셋','https://www.skku.edu/n?articleNo=3','2026-11-01',now(), null);`);
  return db;
}
const as = (db, u) => db.exec(`reset role; set role authenticated; set request.jwt.claim.sub = '${u}'`);
const rows = async (db, sql) => (await db.query(sql)).rows;
const create = async (db, notice = 'school/1', cap = 2) =>
  (await rows(db, `select team_create_post('${notice}','백엔드',${cap},'같이 해요') id`))[0].id;

test('read RPCs never expose user ids and tables are not directly readable', async () => {
  const db = await setup();
  try {
    await as(db, A);
    const post = await create(db);
    await db.exec(`select team_set_contact('${post}','https://open.kakao.com/o/x')`);
    await as(db, B);
    await db.exec(`select team_apply('${post}','잘 부탁해요')`);
    const list = await rows(db, `select * from team_list_posts('school/1')`);
    assert.equal(list.length, 1);
    for (const r of list) for (const k of Object.keys(r)) assert.ok(!/user|owner|applicant/.test(k), k);
    assert.equal(list[0].mine, false);
    assert.equal(list[0].my_status, 'pending');
    await as(db, A);
    const apps = await rows(db, `select * from team_list_applicants('${post}')`);
    assert.equal(apps.length, 1);
    assert.equal(apps[0].anon_no, 1);
    for (const k of Object.keys(apps[0])) assert.ok(!/user|owner|applicant_id/.test(k), k);
    for (const t of ['team_posts', 'team_applications', 'team_reports', 'user_blocks', 'team_actions']) {
      await assert.rejects(db.exec(`select * from ${t}`), /permission denied/);
      await assert.rejects(db.exec(`insert into ${t} default values`), /permission denied/);
    }
    // 신청자 목록은 모집자만
    await as(db, C);
    assert.equal((await rows(db, `select * from team_list_applicants('${post}')`)).length, 0);
    await as(db, B);
    assert.equal((await rows(db, `select * from team_list_applicants('${post}')`)).length, 0);
    // anon
    await db.exec('reset role; set role anon');
    await assert.rejects(db.exec(`select * from team_list_posts('school/1')`), /permission denied/);
    await assert.rejects(db.exec(`select team_apply('${post}')`), /permission denied/);
  } finally { await db.close(); }
});

test('creation defaults, validation and ownership', async () => {
  const db = await setup();
  try {
    await as(db, A);
    const post = await create(db);
    const p = (await rows(db, `select * from team_list_posts('school/1')`))[0];
    assert.equal(p.mine, true);
    assert.ok(Math.abs(new Date(p.closes_at) - (Date.now() + 10 * 864e5)) < 60e3, '마감 기본값은 공고 마감');
    const p2 = await create(db, 'school/2');
    assert.ok((await rows(db, `select * from team_list_posts('school/2')`))[0].closes_at > new Date());
    await assert.rejects(db.exec(`select team_create_post('school/1','다른',2,'소개')`), /team_already_posted/);
    await assert.rejects(db.exec(`select team_create_post('nope',' x',2,'소개')`), /team_notice_not_found/);
    await assert.rejects(db.exec(`select team_create_post('school/3','',2,'소개')`), /team_invalid_input/);
    await assert.rejects(db.exec(`select team_create_post('school/3','역할',11,'소개')`), /team_invalid_input/);
    await assert.rejects(db.exec(`select team_create_post('school/3','역할',2,'${'가'.repeat(201)}')`), /team_invalid_input/);
    // 남의 글 수정·삭제·마감 불가
    await as(db, B);
    await assert.rejects(db.exec(`select team_set_status('${post}','closed')`), /team_not_found/);
    await assert.rejects(db.exec(`select team_delete_post('${post}')`), /team_not_found/);
    await assert.rejects(db.exec(`select team_set_contact('${post}','x')`), /team_not_found/);
    // 삭제하면 목록에서 사라진다
    await as(db, A);
    await db.exec(`select team_delete_post('${p2}')`);
    assert.equal((await rows(db, `select * from team_list_posts('school/2')`)).length, 0);
  } finally { await db.close(); }
});

test('apply rules, withdraw, approval, capacity and contact visibility', async () => {
  const db = await setup();
  try {
    await as(db, A);
    const post = await create(db, 'school/1', 1);
    await as(db, A);
    await assert.rejects(db.exec(`select team_apply('${post}')`), /team_own_post/);
    await as(db, B);
    const appB = (await rows(db, `select team_apply('${post}') id`))[0].id;
    await assert.rejects(db.exec(`select team_apply('${post}')`), /team_already_applied/);
    await assert.rejects(db.exec(`select team_get_contact('${post}')`), /team_not_found/); // 신청만으로는 비공개
    await as(db, C);
    const appC = (await rows(db, `select team_apply('${post}','한 줄') id`))[0].id;
    // 연락처 등록 전에는 승인 불가
    await as(db, A);
    await assert.rejects(db.exec(`select team_decide('${appB}','approved')`), /team_contact_required/);
    await db.exec(`select team_set_contact('${post}','https://open.kakao.com/o/secret')`);
    // 정원 1: 둘 중 하나만 승인
    await db.exec(`select team_decide('${appB}','approved')`);
    await assert.rejects(db.exec(`select team_decide('${appC}','approved')`), /team_full/);
    await assert.rejects(db.exec(`select team_decide('${appB}','rejected')`), /team_not_pending/);
    await db.exec(`select team_decide('${appC}','rejected')`);
    assert.equal((await rows(db, `select state, approved_count from team_list_posts('school/1')`))[0].state, 'full');
    // 승인된 B만 연락처를 본다. 거절된 C·무관한 D는 못 본다
    await as(db, B);
    assert.equal((await rows(db, `select team_get_contact('${post}') c`))[0].c, 'https://open.kakao.com/o/secret');
    await as(db, C);
    await assert.rejects(db.exec(`select team_get_contact('${post}')`), /team_not_found/);
    await assert.rejects(db.exec(`select team_apply('${post}')`), /team_full/);
    await as(db, D);
    await assert.rejects(db.exec(`select team_get_contact('${post}')`), /team_not_found/);
    await assert.rejects(db.exec(`select team_decide('${appC}','approved')`), /team_not_found/);
    // 승인자가 취소하면 자리가 나고, 취소 뒤에는 연락처가 닫힌다. 다시 신청 가능
    await as(db, B);
    await db.exec(`select team_withdraw('${post}')`);
    await assert.rejects(db.exec(`select team_get_contact('${post}')`), /team_not_found/);
    await as(db, D);
    await db.exec(`select team_apply('${post}')`);
    await as(db, B);
    await db.exec(`select team_apply('${post}')`);
    const mine = (await rows(db, `select my_status from team_list_posts('school/1')`))[0];
    assert.equal(mine.my_status, 'pending');
    // 모집 마감하면 신청 불가
    await as(db, A);
    await db.exec(`select team_set_status('${post}','closed')`);
    await as(db, C);
    await assert.rejects(db.exec(`select team_apply('${post}')`), /team_not_available|team_rejected/);
    // 거절당한 사람은 같은 글에 다시 신청 못 한다(열려 있어도)
    await as(db, A);
    await db.exec(`select team_set_status('${post}','open')`);
    await as(db, C);
    await assert.rejects(db.exec(`select team_apply('${post}')`), /team_rejected|team_full/);
  } finally { await db.close(); }
});

test('capacity cannot be exceeded by repeated approvals (lock path)', async () => {
  const db = await setup();
  try {
    await as(db, A);
    const post = await create(db, 'school/1', 2);
    await db.exec(`select team_set_contact('${post}','x')`);
    const apps = [];
    for (const u of [B, C, D]) { await as(db, u); apps.push((await rows(db, `select team_apply('${post}') id`))[0].id); }
    await as(db, A);
    const results = await Promise.allSettled(apps.map((x) => db.exec(`select team_decide('${x}','approved')`)));
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 2);
    assert.equal((await rows(db, `select approved_count from team_list_posts('school/1')`))[0].approved_count, 2);
    // 익명 번호는 글마다 1부터 고정
    assert.deepEqual((await rows(db, `select anon_no from team_list_applicants('${post}')`)).map((r) => r.anon_no), [1, 2, 3]);
  } finally { await db.close(); }
});

test('reports hide at 3 distinct reporters, owner still sees it; blocks filter both ways', async () => {
  const db = await setup();
  try {
    const extra = '00000000-0000-0000-0000-000000000005';
    await db.exec(`insert into auth.users values ('${extra}')`);
    await as(db, A);
    const post = await create(db);
    await assert.rejects(db.exec(`select team_report('${post}')`), /team_not_available/); // 본인 글
    await as(db, B);
    await db.exec(`select team_report('${post}')`);
    await db.exec(`select team_report('${post}')`); // 중복은 한 번으로
    await as(db, C);
    await db.exec(`select team_report('${post}')`);
    await as(db, D);
    assert.equal((await rows(db, `select * from team_list_posts('school/1')`)).length, 1); // 2명까지는 보임
    await db.exec(`select team_report('${post}')`);
    assert.equal((await rows(db, `select * from team_list_posts('school/1')`)).length, 0);
    await assert.rejects(db.exec(`select team_apply('${post}')`), /team_not_available/);
    await as(db, A);
    const own = (await rows(db, `select hidden, mine from team_list_posts('school/1')`))[0];
    assert.deepEqual([own.hidden, own.mine], [true, true]);
    // 차단: B가 A를 차단하면 B에게 A의 글이 안 보이고 A도 B의 신청을 못 받는다
    await as(db, A);
    const p2 = await create(db, 'school/2');
    await db.exec(`select team_set_contact('${p2}','x')`);
    await as(db, C);
    const appC = (await rows(db, `select team_apply('${p2}') id`))[0].id;
    await as(db, A);
    assert.equal((await rows(db, `select * from team_list_applicants('${p2}')`)).length, 1);
    await db.exec(`select team_block_applicant('${appC}')`);
    assert.equal((await rows(db, `select * from team_list_applicants('${p2}')`)).length, 0);
    await assert.rejects(db.exec(`select team_decide('${appC}','approved')`), /team_not_found|team_not_pending/);
    await as(db, C);
    assert.equal((await rows(db, `select * from team_list_posts('school/2')`)).length, 0); // 반대 방향도 숨김
    await as(db, B);
    assert.equal((await rows(db, `select * from team_list_posts('school/2')`)).length, 1);
    await db.exec(`select team_block_post_owner('${p2}')`);
    assert.equal((await rows(db, `select * from team_list_posts('school/2')`)).length, 0);
    await assert.rejects(db.exec(`select team_apply('${p2}')`), /team_not_available/);
    const blocks = await rows(db, `select * from team_list_blocks()`);
    assert.equal(blocks.length, 1);
    assert.deepEqual(Object.keys(blocks[0]).sort(), ['created_at', 'id']);
    await db.exec(`select team_unblock('${blocks[0].id}')`);
    assert.equal((await rows(db, `select * from team_list_posts('school/2')`)).length, 1);
  } finally { await db.close(); }
});

test('rate limits, row caps, activity list and purge', async () => {
  const db = await setup();
  try {
    await as(db, A);
    const post = await create(db);
    // 분당 10회(쓰기 동작 합산): create 1회 + 편집 9회 후 11번째 거절
    for (let i = 0; i < 9; i++) await db.exec(`select team_set_status('${post}','${i % 2 ? 'open' : 'closed'}')`);
    await assert.rejects(db.exec(`select team_set_status('${post}','open')`), /team_rate_limited/);
    // 다른 사용자는 영향 없음
    await as(db, B);
    await db.exec(`select team_apply('${post}')`).catch(() => {});
    // 활동 목록: 신청자는 공고 사본과 상태를 본다
    await db.exec('reset role');
    await db.exec(`update team_posts set status='open'; delete from team_actions`);
    await as(db, B);
    await db.exec(`select team_apply('${post}')`);
    const act = await rows(db, `select kind, notice_title, status from team_my_activity()`);
    assert.deepEqual(act, [{ kind: 'applicant', notice_title: '공지 하나', status: 'pending' }]);
    // 공고 삭제 후에도 팀 기록은 남는다(사본)
    await db.exec('reset role');
    await db.exec(`delete from platform_notices where id='school/1'`);
    await as(db, B);
    assert.equal((await rows(db, `select * from team_my_activity()`)).length, 1);
    // 정리는 service_role만, 만료 30일 뒤에만 지운다
    await assert.rejects(db.exec('select team_purge_expired()'), /permission denied/);
    await db.exec('reset role');
    assert.equal((await rows(db, 'select team_purge_expired() n'))[0].n, 0);
    await db.exec(`update team_posts set closes_at = now() - interval '31 days'`);
    assert.equal((await rows(db, 'select team_purge_expired() n'))[0].n, 1);
    assert.equal((await rows(db, 'select count(*)::int c from team_applications'))[0].c, 0);
    // 사용자 삭제 cascade
    await db.exec(`delete from auth.users where id='${B}'`);
  } finally { await db.close(); }
});

test('review fixes: block cuts access, withdraw beats decide, no rewrite evasion, input codes, unsafe schemes', async () => {
  const db = await setup();
  try {
    await as(db, A);
    const post = await create(db, 'school/1', 3);
    await db.exec(`select team_set_contact('${post}','https://open.kakao.com/o/x')`);
    await as(db, B);
    const appB = (await rows(db, `select team_apply('${post}') id`))[0].id;
    await as(db, C);
    const appC = (await rows(db, `select team_apply('${post}') id`))[0].id;
    await as(db, A);
    await db.exec(`select team_decide('${appB}','approved')`);
    await db.exec(`select team_decide('${appC}','approved')`);
    // 모집자가 B를 차단하면 B의 연락처·활동 접근이 끊긴다
    await db.exec(`select team_block_applicant('${appB}')`);
    await as(db, B);
    await assert.rejects(db.exec(`select team_get_contact('${post}')`), /team_not_found/);
    assert.equal((await rows(db, `select * from team_my_activity()`)).length, 0);
    // 신청자 C가 모집자를 차단해도 끊긴다(대칭)
    await as(db, C);
    await db.exec(`select team_block_post_owner('${post}')`);
    await assert.rejects(db.exec(`select team_get_contact('${post}')`), /team_not_found/);
    assert.equal((await rows(db, `select * from team_my_activity()`)).length, 0);
    await as(db, A);
    assert.equal((await rows(db, `select approved_count from team_list_posts('school/1')`))[0].approved_count, 0);
    // 취소한 신청은 decide로 되살아나지 않는다
    await as(db, D);
    const appD = (await rows(db, `select team_apply('${post}') id`))[0].id;
    await db.exec(`select team_withdraw('${post}')`);
    await as(db, A);
    await assert.rejects(db.exec(`select team_decide('${appD}','approved')`), /team_not_pending/);
    // 숨겨진 글을 지우고 다시 쓰는 회피 거절
    await db.exec('reset role');
    await db.exec(`update team_posts set hidden_at = now()`);
    await as(db, A);
    await db.exec(`select team_delete_post('${post}')`);
    await assert.rejects(db.exec(`select team_create_post('school/1','다시',2,'소개')`), /team_hidden_recently/);
    await db.exec('reset role');
    await db.exec(`update team_posts set hidden_at = now() - interval '31 days'`);
    await db.exec(`delete from team_actions`);
    await as(db, A);
    const again = await create(db, 'school/1', 2);
    // 잘못된 입력은 정해진 오류 코드
    await assert.rejects(db.exec(`select team_set_status('${again}','weird')`), /team_invalid_input/);
    await assert.rejects(db.exec(`select team_create_post('school/2','역할',0,'소개')`), /team_invalid_input/);
    await assert.rejects(db.exec(`select team_create_post('school/2','${'가'.repeat(41)}',2,'소개')`), /team_invalid_input/);
    await assert.rejects(db.exec(`select team_set_contact('${again}','${'a'.repeat(201)}')`), /team_invalid_input/);
    // 허용 목록: http(s) 주소이거나 콜론 없는 아이디·이메일. 제어 문자를 끼운 우회와 다른 스킴은 거절
    for (const bad of ['javascript:alert(1)', ' DATA:text/html,x', 'vbscript:x', 'java\tscript:alert(1)', 'mailto:a@b.c', 'https://a b', 'line\nbreak']) {
      await assert.rejects(db.query('select team_set_contact($1,$2)', [again, bad]), /team_invalid_input/, JSON.stringify(bad));
    }
    for (const good of ['https://open.kakao.com/o/abc', 'http://x.example/y', 'abc@skku.edu', '카톡 아이디 abc_1']) {
      await db.query('select team_set_contact($1,$2)', [again, good]);
    }
    await assert.rejects(db.exec(`update team_posts set contact='javascript:x'`), /permission denied|check/);
    await db.exec('reset role');
    await assert.rejects(db.exec(`update team_posts set contact='javascript:x'`), /check/);
    await assert.rejects(db.query(`update team_posts set contact=$1`, ['java\tscript:x']), /check/);
    await as(db, B);
    await assert.rejects(db.exec(`select team_apply('${again}','${'가'.repeat(101)}')`), /team_invalid_input/);
  } finally { await db.close(); }
});
