import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const [A, B, C, D] = [1, 2, 3, 4].map((number) => `00000000-0000-0000-0000-00000000000${number}`);
const notice = 'school/1';
const next = 'external/2';
const sameTitle = 'school/3';
const tables = ['qe_series', 'qe_notice_series', 'qe_question_aliases', 'qe_posts', 'qe_reports', 'qe_actions', 'qe_blocks'];
const migrationDir = new URL('../../supabase/migrations/', import.meta.url);
const readMigration = (name) => readFile(new URL(name, migrationDir), 'utf8');
const migrations = await Promise.all([
  '20261107030000_public_notices.sql',
  '20261119100000_team_recruit.sql',
  '20261121100000_questions_experiences.sql',
].map(readMigration));

async function setup(t, allMigrations = false) {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role bypassrls;
    create schema auth;
    create schema extensions;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
    insert into auth.users values ('${A}'), ('${B}'), ('${C}');
  `);
  const scripts = allMigrations
    ? await Promise.all((await readdir(migrationDir)).filter((name) => name.endsWith('.sql')).sort().map(readMigration))
    : migrations;
  for (const migration of scripts) await db.exec(migration);
  await db.exec(`
    insert into platform_sources(id,name,url) values
      ('school','학교 게시판','https://www.skku.edu/notice'),
      ('external','외부 게시판','https://example.test/external');
    insert into platform_notices(id,source_id,article_no,title,url,posted_on,first_seen) values
      ('${notice}','school','1','데이터 인턴','https://www.skku.edu/1','2026-11-01',now()),
      ('${next}','external','2','데이터 실습 다음 기수','https://example.test/2','2026-11-02',now()),
      ('${sameTitle}','school','3','데이터 인턴','https://www.skku.edu/3','2026-11-03',now());
  `);
  return db;
}

async function as(db, user = '', role = 'authenticated') {
  await db.exec(`reset role; set role ${role}`);
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [user]);
}

async function rows(db, sql, args = []) {
  return (await db.query(sql, args)).rows;
}

async function value(db, sql, args = []) {
  return (await rows(db, sql, args))[0].value;
}

const question = (db, body = '질문이에요', parent = null, target = notice) =>
  value(db, 'select qe_create_question($1, $2, $3) as value', [target, body, parent]);
const experience = (db, score = 5, target = notice, learning = null, difficulty = null, body = null, participated = false) =>
  value(db, 'select qe_create_experience($1, $2, $3, $4, $5, $6) as value', [target, score, learning, difficulty, body, participated]);
const questions = (db, target = notice) => rows(db, 'select * from qe_list_questions($1)', [target]);
const experiences = (db, target = notice) => value(db, 'select qe_list_experiences($1) as value', [target]);
const report = (db, post) => db.query('select qe_report($1)', [post]);
const remove = (db, post) => db.query('select qe_delete($1)', [post]);
const block = (db, post) => value(db, 'select qe_block_author($1) as value', [post]);
const rejects = (call, message, code = 'P0001') => assert.rejects(call, { message, code });

test('migration reapplication preserves data, RLS and RPC permissions', async (t) => {
  const db = await setup(t);
  await as(db, A);
  const id = await question(db);
  await db.exec('reset role');
  await db.exec(migrations.at(-1));
  const flags = await rows(db, `
    select c.relname, c.relrowsecurity, count(p.oid)::int as policies
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    left join pg_policy p on p.polrelid = c.oid
    where n.nspname = 'public' and c.relname = any($1::text[])
    group by c.relname, c.relrowsecurity
  `, [tables]);
  assert.equal(flags.length, tables.length);
  for (const flag of flags) {
    assert.equal(flag.relrowsecurity, true, flag.relname);
    assert.equal(flag.policies, 0, flag.relname);
  }
  const functions = await rows(db, `
    select p.proname, p.prosecdef, p.proconfig, has_function_privilege('anon', p.oid, 'EXECUTE') as anon
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and left(p.proname, 3) = 'qe_'
  `);
  assert.equal(functions.length, 17);
  for (const functionInfo of functions) {
    assert.equal(functionInfo.prosecdef, true, functionInfo.proname);
    assert.deepEqual(functionInfo.proconfig, ['search_path=""'], functionInfo.proname);
    assert.equal(functionInfo.anon, false, functionInfo.proname);
  }
  await as(db, A);
  assert.equal((await questions(db))[0].id, id);
  for (const table of [...tables, 'user_blocks']) {
    for (const command of [
      `select * from ${table}`,
      `insert into ${table} default values`,
      `update ${table} set ${table === 'qe_notice_series' || table === 'qe_question_aliases' ? 'notice_id' : table === 'qe_reports' ? 'post_id' : 'id'} = default`,
      `delete from ${table}`,
    ]) {
      await assert.rejects(db.exec(command), { code: '42501' });
    }
  }
  await assert.rejects(db.query('select qe_uid()'), { code: '42501' });
  await assert.rejects(db.query('select qe_bind_series($1, $2)', [notice, A]), { code: '42501' });
  await assert.rejects(db.query('select qe_purge()'), { code: '42501' });
  await as(db, A, 'anon');
  await assert.rejects(questions(db), { code: '42501' });
  await assert.rejects(experiences(db), { code: '42501' });
  await assert.rejects(question(db), { code: '42501' });
  await as(db);
  await rejects(questions(db), 'qe_unauthenticated', '28000');
  await rejects(experiences(db), 'qe_unauthenticated', '28000');
  await rejects(question(db), 'qe_unauthenticated', '28000');
  await rejects(db.query('select * from qe_list_blocks()'), 'qe_unauthenticated', '28000');
  await rejects(db.query('select qe_unblock($1)', [id]), 'qe_unauthenticated', '28000');
  await as(db, '', 'service_role');
  await assert.rejects(db.query('select * from qe_blocks'), { code: '42501' });
});

test('question aliases stay fixed per notice and only owners can change posts', async (t) => {
  const db = await setup(t);
  await as(db, A);
  const root = await question(db);
  const another = await question(db, '두 번째 질문이에요');
  await as(db, B);
  const reply = await question(db, '답변이에요', root);
  const elsewhere = await question(db, '다른 공고 질문', null, next);
  await rejects(db.query('select qe_edit($1, $2)', [root, '남의 글 수정']), 'qe_not_found');
  await rejects(remove(db, root), 'qe_not_found');
  const list = await questions(db);
  assert.equal(list.length, 3);
  assert.deepEqual(Object.keys(list[0]).sort(), ['id', 'parent_id', 'body', 'anon_no', 'created_at', 'mine', 'hidden', 'detached'].sort());
  assert.equal(list.find((item) => item.id === root).anon_no, 1);
  assert.equal(list.find((item) => item.id === another).anon_no, 1);
  assert.equal(list.find((item) => item.id === root).mine, false);
  assert.equal(list.find((item) => item.id === reply).anon_no, 2);
  assert.equal(list.find((item) => item.id === reply).mine, true);
  assert.equal((await questions(db, next)).find((item) => item.id === elsewhere).anon_no, 1);
  await as(db, A);
  await db.query('select qe_edit($1, $2)', [root, '수정한 질문']);
  await remove(db, another);
  const replacement = await question(db);
  const changed = await questions(db);
  assert.equal(changed.find((item) => item.id === root).body, '수정한 질문');
  assert.equal(changed.find((item) => item.id === replacement).anon_no, 1);
  assert.ok(!changed.some((item) => item.id === another));
});

test('answers are one level and detached answers only reach their authors', async (t) => {
  const db = await setup(t);
  await as(db, A);
  const root = await question(db);
  const review = await experience(db);
  await as(db, B);
  const reply = await question(db, '답변', root);
  await rejects(question(db, '두 번째 깊이', reply), 'qe_parent_unavailable');
  await rejects(question(db, '공고가 달라요', root, next), 'qe_parent_unavailable');
  await rejects(question(db, '후기에 답변', review), 'qe_parent_unavailable');
  await as(db, A);
  await remove(db, root);
  await as(db, C);
  assert.deepEqual(await questions(db), []);
  await rejects(question(db, '삭제된 질문에 답변', root), 'qe_parent_unavailable');
  await rejects(report(db, reply), 'qe_not_available');
  await rejects(block(db, reply), 'qe_not_available');
  await as(db, B);
  const [detached] = await questions(db);
  assert.deepEqual([detached.id, detached.parent_id, detached.detached, detached.mine], [reply, null, true, true]);
});

test('reviews show averages from the first review with no author labels or origin metadata', async (t) => {
  const db = await setup(t);
  await as(db, A);
  const empty = await experiences(db);
  assert.deepEqual(empty.satisfaction, { count: 0, average: null });
  const first = await experience(db);
  await as(db, B);
  const single = await experiences(db);
  assert.deepEqual(single, {
    count: 1,
    satisfaction: { count: 1, average: 5 },
    learning: { count: 0, average: null },
    difficulty: { count: 0, average: null },
    posts: [{ id: first, body: null, satisfaction: 5, learning: null, difficulty: null, participated: false, mine: false, hidden: false }],
  });
  const second = await experience(db, 2, notice, 4, 3, '내용은 선택', true);
  await rejects(experience(db), 'qe_already_reviewed');
  await rejects(db.query('select qe_edit($1, $2, $3)', [first, null, 1]), 'qe_not_found');
  await rejects(remove(db, first), 'qe_not_found');
  const both = await experiences(db);
  assert.equal(both.count, 2);
  assert.deepEqual(both.satisfaction, { count: 2, average: 3.5 });
  assert.deepEqual(both.learning, { count: 1, average: 4 });
  assert.deepEqual(both.difficulty, { count: 1, average: 3 });
  assert.equal(both.posts.find((item) => item.id === second).participated, true);
  await db.query('select qe_edit($1, $2, $3)', [second, null, 3]);
  assert.deepEqual((await experiences(db)).learning, { count: 0, average: null });
  await remove(db, second);
  assert.deepEqual((await experiences(db)).satisfaction, { count: 1, average: 5 });
});

test('three distinct other accounts hide a post but the author still sees it', async (t) => {
  const db = await setup(t);
  // Three distinct reporters plus their target author cannot fit in the default three accounts.
  await db.query('insert into auth.users values ($1)', [D]);
  await as(db, A);
  const review = await experience(db);
  const root = await question(db);
  await rejects(report(db, review), 'qe_not_available');
  await as(db, B);
  for (const post of [review, root]) {
    await report(db, post);
    await report(db, post);
  }
  await as(db, C);
  await report(db, review);
  await report(db, root);
  assert.equal((await experiences(db)).count, 1);
  assert.equal((await questions(db)).length, 1);
  await as(db, D);
  await report(db, review);
  await report(db, root);
  await report(db, review);
  assert.equal((await experiences(db)).count, 0);
  assert.deepEqual((await experiences(db)).posts, []);
  assert.deepEqual(await questions(db), []);
  await as(db, A);
  const mine = await experiences(db);
  assert.equal(mine.posts[0].mine, true);
  assert.equal(mine.posts[0].hidden, true);
  assert.equal(mine.count, 0);
  assert.equal((await questions(db))[0].hidden, true);
  await rejects(db.query('select qe_edit($1, $2, $3)', [review, null, 5]), 'qe_not_found');
  await remove(db, review);
  await rejects(experience(db), 'qe_hidden_recently');
  await remove(db, root);
  await rejects(question(db), 'qe_hidden_recently');
  await question(db, '다른 공고 질문', null, next);
  await db.exec('reset role');
  await db.query("update qe_posts set hidden_at = now() - interval '31 days' where id = $1", [root]);
  await as(db, A);
  await question(db);
});

test('question and experience blocks are two-way, owner-controlled and isolated from team blocks', async (t) => {
  const db = await setup(t);
  await as(db, A);
  const root = await question(db);
  const review = await experience(db);
  const team = await value(db, "select team_create_post($1, '역할', 2, '소개') as value", [notice]);
  await rejects(block(db, root), 'qe_not_available');
  await as(db, B);
  await experience(db, 1);
  const blockId = await block(db, root);
  const [savedBlock] = await rows(db, 'select * from qe_list_blocks()');
  assert.deepEqual(Object.keys(savedBlock).sort(), ['created_at', 'id']);
  assert.equal(savedBlock.id, blockId);
  assert.deepEqual(await rows(db, 'select * from team_list_blocks()'), []);
  assert.equal((await rows(db, 'select id from team_list_posts($1)', [notice]))[0].id, team);
  await db.query('select team_unblock($1)', [blockId]);
  assert.deepEqual(await questions(db), []);
  assert.deepEqual((await experiences(db)).satisfaction, { count: 1, average: 1 });
  await rejects(report(db, review), 'qe_not_available');
  await rejects(question(db, '차단된 질문에 답변', root), 'qe_parent_unavailable');
  await as(db, A);
  assert.deepEqual(await rows(db, 'select * from qe_list_blocks()'), []);
  await db.query('select qe_unblock($1)', [blockId]);
  assert.deepEqual((await experiences(db)).satisfaction, { count: 1, average: 5 });
  await as(db, C);
  assert.equal((await experiences(db)).count, 2);
  await as(db, B);
  assert.deepEqual(await questions(db), []);
  await db.query('select team_block_post_owner($1)', [team]);
  const [{ id: teamBlockId }] = await rows(db, 'select id from team_list_blocks()');
  assert.notEqual(teamBlockId, blockId);
  await db.query('select qe_unblock($1)', [blockId]);
  await db.query('select qe_unblock($1)', [teamBlockId]);
  assert.deepEqual(await rows(db, 'select * from qe_list_blocks()'), []);
  assert.deepEqual(await rows(db, 'select id from team_list_posts($1)', [notice]), []);
  assert.equal((await questions(db)).length, 1);
  assert.deepEqual((await experiences(db)).satisfaction, { count: 2, average: 3 });
});

test('frequency is account scoped and applies to both post kinds', async (t) => {
  const db = await setup(t);
  await as(db, A);
  await experience(db);
  for (let index = 0; index < 9; index++) await question(db);
  await rejects(question(db), 'qe_rate_limited');
  await as(db, B);
  await question(db);
  await db.exec(`reset role; update qe_actions set at = now() - interval '2 minutes' where user_id = '${A}'`);
  await as(db, A);
  for (let index = 0; index < 10; index++) await question(db);
  await db.exec("reset role; update qe_actions set at = now() - interval '2 minutes'");
  await as(db, A);
  await rejects(question(db), 'qe_rate_limited');
});

test('account and notice row caps are enforced independently', async (t) => {
  const db = await setup(t);
  // Seed older active posts as the table owner to isolate the count caps from time limits.
  await db.query(`
    insert into qe_posts(kind,user_id,question_notice_id,body)
    select 'question',$1,$2,'질문' from generate_series(1,100)
  `, [A, notice]);
  await as(db, A);
  await rejects(question(db, '계정 상한', null, next), 'qe_limit_reached');
  await db.exec('reset role');
  await db.query(`
    insert into qe_posts(kind,user_id,question_notice_id,body)
    select 'question',$1,$2,'질문' from generate_series(1,100)
  `, [B, notice]);
  await as(db, C);
  await rejects(question(db), 'qe_limit_reached');
  await question(db, '다른 공고는 작성 가능', null, next);
});

test('rating ranges and unsafe text are rejected on creation and editing', async (t) => {
  const db = await setup(t);
  await as(db, A);
  for (const input of [null, '', ' \n ', '가'.repeat(501)]) {
    await rejects(question(db, input), 'qe_invalid_input', '22023');
  }
  for (const input of ['<img onerror=alert(1)>', '&lt;script&gt;', 'JaVaScRiPt:alert(1)', 'https://example.test',
    'name@example.test', '010-1234-5678', 'javascript\t:', 'java\u200Bscript:', '병신']) {
    await rejects(question(db, input), 'qe_unsafe_text', '22023');
  }
  await rejects(experience(db, null), 'qe_invalid_input', '22023');
  await rejects(experience(db, 6), 'qe_invalid_input', '22023');
  await rejects(experience(db, 5, notice, 0), 'qe_invalid_input', '22023');
  await rejects(experience(db, 5, notice, null, 6), 'qe_invalid_input', '22023');
  await rejects(experience(db, 5, notice, null, null, 'data:text/html'), 'qe_unsafe_text', '22023');
  await rejects(question(db, '없는 공고', null, 'school/999'), 'qe_notice_not_found');
  await rejects(experience(db, 5, 'school/999'), 'qe_notice_not_found');
  const id = await question(db, '  정상 질문\n두 번째 줄  ');
  assert.equal((await questions(db))[0].body, '정상 질문\n두 번째 줄');
  await rejects(db.query('select qe_edit($1, $2)', [id, '</div>']), 'qe_unsafe_text', '22023');
});

test('invisible bodies, explicit control ranges and Windows line endings are handled consistently', async (t) => {
  const db = await setup(t);
  await as(db, A);
  const blanks = ['\u00a0', '\u3164', '\u115f', '\u1160', '\u2800', '\u3000'];
  for (const blank of blanks) await rejects(question(db, blank), 'qe_invalid_input', '22023');
  await rejects(question(db, blanks.join('') + '\r\n\t'), 'qe_invalid_input', '22023');
  await rejects(question(db, '\u034f \ufe0f\u{e0100}'), 'qe_invalid_input', '22023');
  for (const unsafe of ['\u0001', '\u000b', '\u001f', '\u007f', '\u0085', '\u009f', '\u00ad']) {
    await rejects(question(db, `가${unsafe}나`), 'qe_unsafe_text', '22023');
  }
  await rejects(question(db, 'https\u00a0:'), 'qe_unsafe_text', '22023');
  const id = await question(db, '\u00a0첫째\r\n둘째\r셋째\t항목\u3000');
  assert.equal((await questions(db))[0].body, '첫째\n둘째\n셋째 항목');
  await db.query('select qe_edit($1, $2)', [id, '수정\r\n두 번째\t항목 ☀️']);
  assert.equal((await questions(db))[0].body, '수정\n두 번째 항목 ☀️');
  await experience(db, 5, notice, null, null, blanks.join(''));
  assert.equal((await experiences(db)).posts[0].body, null);
});

test('confirmed next cohort inherits experiences after original notice deletion', async (t) => {
  const db = await setup(t);
  await as(db, A);
  const root = await question(db);
  const review = await experience(db);
  await as(db, B);
  await question(db, '답변', root);
  assert.equal((await experiences(db, sameTitle)).count, 0);
  assert.equal((await experiences(db, next)).count, 0);
  await as(db, '', 'service_role');
  const series = await value(db, 'select series_id as value from qe_notice_series where notice_id = $1', [notice]);
  await rejects(db.query('select qe_bind_series($1, $2)', [next, series]), 'qe_series_not_found');
  await db.exec('reset role');
  await db.query('delete from platform_notices where id = $1', [notice]);
  assert.equal(await value(db, 'select count(*)::int as value from qe_posts where kind = $1', ['question']), 0);
  assert.equal(await value(db, 'select count(*)::int as value from qe_question_aliases'), 0);
  assert.equal(await value(db, 'select count(*)::int as value from qe_notice_series'), 0);
  assert.deepEqual(await rows(db, `
    select id, notice_id_snapshot, notice_title_snapshot, notice_board_snapshot from qe_posts
  `), [{ id: review, notice_id_snapshot: notice, notice_title_snapshot: '데이터 인턴', notice_board_snapshot: '학교 게시판' }]);
  await as(db, C);
  assert.deepEqual(await questions(db), []);
  assert.equal((await experiences(db)).count, 0);
  assert.equal((await experiences(db, next)).count, 0);

  await as(db, '', 'service_role');
  await db.query("update qe_series set organization_key = 'example-labs', program_key = 'data-intern-seoul' where id = $1", [series]);
  await db.query('select qe_bind_series($1, $2)', [next, series]);
  await db.query('select qe_bind_series($1, $2)', [next, series]);
  const other = await value(db, `
    insert into qe_series(organization_key, program_key) values ('another-lab','data-intern-seoul')
    returning id as value
  `);
  await rejects(db.query('select qe_bind_series($1, $2)', [next, other]), 'qe_series_conflict');
  await as(db, A);
  await rejects(experience(db, 5, next), 'qe_already_reviewed');
  await as(db, C);
  assert.equal((await experiences(db, next)).posts[0].id, review);
  assert.equal((await experiences(db, sameTitle)).count, 0);
});

test('binding merges auto-series reviews and preserves moderation history', async (t) => {
  const db = await setup(t);
  await as(db, '', 'service_role');
  const official = await value(db, `
    insert into qe_series(organization_key, program_key) values ('example-labs', 'data-intern')
    returning id as value
  `);
  await db.query('select qe_bind_series($1, $2)', [next, official]);
  await as(db, A);
  const oldAuto = await experience(db, 1, notice);
  const newOfficial = await experience(db, 5, next);
  await as(db, B);
  const oldOfficial = await experience(db, 2, next);
  const newAuto = await experience(db, 4, notice);
  await as(db, C);
  const onlyAuto = await experience(db, 3, notice);
  await report(db, oldAuto);
  await db.exec('reset role');
  const auto = await value(db, 'select series_id as value from qe_notice_series where notice_id = $1', [notice]);
  await db.query("update qe_posts set created_at = now() - interval '1 day' where id in ($1, $2)", [oldAuto, oldOfficial]);
  await db.query("update qe_posts set hidden_at = now() where id = $1", [oldAuto]);
  await as(db, '', 'service_role');
  await db.query('select qe_bind_series($1, $2)', [notice, official]);
  await db.query('select qe_bind_series($1, $2)', [notice, official]);
  assert.deepEqual(await rows(db, 'select id from qe_series order by id'), [{ id: official }]);
  assert.deepEqual(await rows(db, 'select distinct series_id from qe_posts'), [{ series_id: official }]);
  assert.deepEqual((await rows(db, 'select id from qe_posts where deleted_at is not null')).map((row) => row.id).sort(),
    [oldAuto, oldOfficial].sort());
  assert.equal(await value(db, 'select count(*)::int as value from qe_reports where post_id = $1', [oldAuto]), 1);
  assert.equal(await value(db, 'select count(*)::int as value from qe_notice_series where series_id = $1', [auto]), 0);
  await as(db, C);
  assert.deepEqual(await experiences(db, notice), await experiences(db, next));
  assert.deepEqual((await experiences(db)).posts.map((post) => post.id).sort(), [newOfficial, newAuto, onlyAuto].sort());
  await rejects(experience(db, 5, next), 'qe_already_reviewed');
  await as(db, A);
  await remove(db, newOfficial);
  await rejects(experience(db, 5, next), 'qe_hidden_recently');
});

test('account deletion removes authored posts without recycling anonymous numbers', async (t) => {
  const db = await setup(t);
  await as(db, A);
  const root = await question(db);
  await experience(db);
  await as(db, B);
  await report(db, root);
  await db.exec('reset role');
  await db.query('delete from auth.users where id = $1', [A]);
  await as(db, B);
  await question(db);
  assert.equal((await questions(db))[0].anon_no, 2);
  assert.equal((await experiences(db)).count, 0);
  await db.exec('reset role');
  assert.equal(await value(db, 'select count(*)::int as value from qe_reports'), 0);
  assert.equal(await value(db, 'select count(*)::int as value from qe_question_aliases where user_id is null and anon_no = 1'), 1);
});

test('scheduled purge RPC is service-only and cleans question records alongside team retention', async (t) => {
  const db = await setup(t, true);
  await as(db, A);
  const root = await question(db);
  const review = await experience(db);
  const team = await value(db, "select team_create_post($1, '역할', 2, '소개') as value", [notice]);
  await as(db, B);
  const child = await question(db, '답변', root);
  await as(db, A);
  await remove(db, root);
  await assert.rejects(db.query('select purge_expired_data()'), { code: '42501' });
  await as(db, '', 'anon');
  await assert.rejects(db.query('select purge_expired_data()'), { code: '42501' });
  await db.exec('reset role');
  await db.query("update qe_posts set deleted_at = now() - interval '31 days' where id = $1", [root]);
  await db.query("update qe_actions set at = now() - interval '3 days' where user_id = $1", [B]);
  await db.query("update team_posts set deleted_at = now() - interval '8 days' where id = $1", [team]);
  await as(db, '', 'service_role');
  const result = await value(db, 'select purge_expired_data() as value');
  assert.equal(result.qe, 1);
  assert.equal(result.team, 1);
  assert.equal(await value(db, 'select qe_purge() as value'), 0);
  assert.equal(await value(db, 'select count(*)::int as value from qe_posts where id = $1', [child]), 0);
  assert.equal(await value(db, 'select count(*)::int as value from qe_actions where user_id = $1', [B]), 0);
  await as(db, C);
  assert.equal((await experiences(db)).posts[0].id, review);
});
