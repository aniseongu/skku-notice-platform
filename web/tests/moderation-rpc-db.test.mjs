import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const [author, reporter, question, answer, experience, team, series] = Array.from(
  { length: 7 }, (_, index) => `00000000-0000-0000-0000-00000000000${index + 1}`,
);

test('moderation RPC is service-only and restores each kind with its reports cleared', async (t) => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role bypassrls;
    create role unprivileged;
    create schema auth;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
    insert into auth.users values ('${author}'), ('${reporter}');
  `);
  for (const file of [
    '20261107030000_public_notices.sql',
    '20261119100000_team_recruit.sql',
    '20261121100000_questions_experiences.sql',
    '20261123110000_moderation_rpc.sql',
  ]) {
    await db.exec(await readFile(new URL(`../../supabase/migrations/${file}`, import.meta.url), 'utf8'));
  }
  await db.exec(`
    insert into platform_sources(id,name,url) values ('school','학교','https://www.skku.edu/notice');
    insert into platform_notices(id,source_id,article_no,title,url,posted_on,first_seen)
      values ('school/1','school','1','공고','https://www.skku.edu/1',now(),now());
    insert into qe_posts(id,kind,user_id,question_notice_id,parent_id,body)
      values ('${question}','question','${author}','school/1',null,'질문'),
             ('${answer}','question','${author}','school/1','${question}','답변');
    insert into qe_series(id) values ('${series}');
    insert into qe_posts(id,kind,user_id,series_id,notice_id_snapshot,
                         notice_title_snapshot,notice_board_snapshot,satisfaction)
      values ('${experience}','experience','${author}','${series}','school/1','공고','학교',5);
    insert into team_posts(id,owner_id,notice_id,notice_title,role,capacity,intro,closes_at)
      values ('${team}','${author}','school/1','공고','개발',2,'소개',now() + interval '1 day');
  `);
  const moderation = (kind, id, hidden) =>
    db.query('select public.moderation_set_hidden($1, $2, $3)', [kind, id, hidden]);
  const { rows: [definition] } = await db.query(`
    select prosecdef, proconfig from pg_proc
    where oid = 'public.moderation_set_hidden(text,uuid,boolean)'::regprocedure
  `);
  assert.deepEqual(definition, { prosecdef: true, proconfig: ['search_path=""'] });
  for (const role of ['anon', 'authenticated', 'unprivileged']) {
    await db.exec(`set role ${role}`);
    await assert.rejects(moderation('question', question, true), { code: '42501' });
    await db.exec('reset role');
  }

  for (const [kind, id, tablePrefix] of [
    ['question', question, 'qe'], ['answer', answer, 'qe'],
    ['experience', experience, 'qe'], ['team', team, 'team'],
  ]) {
    const state = async () => (await db.query(`
      select hidden_at, (select count(*)::int from ${tablePrefix}_reports where post_id = $1) as reports
      from ${tablePrefix}_posts where id = $1
    `, [id])).rows[0];

    await db.exec('set role authenticated');
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [reporter]);
    await db.query(`select public.${tablePrefix}_report($1)`, [id]);
    await db.exec('reset role; set role service_role');
    await moderation(kind, id, false);
    assert.deepEqual(await state(), { hidden_at: null, reports: 1 });
    await moderation(kind, id, true);
    const hidden = await state();
    assert.ok(hidden.hidden_at);
    assert.equal(hidden.reports, 1);
    await moderation(kind, id, true);
    assert.deepEqual(await state(), hidden);
    await moderation(kind, id, false);
    assert.deepEqual(await state(), { hidden_at: null, reports: 0 });
    await db.exec('reset role');
  }

  await db.exec('set role service_role');
  await assert.rejects(moderation('question', answer, true), { message: 'moderation_post_not_found' });
  await assert.rejects(moderation('unknown', question, true), { code: '22023' });
  await db.query('update qe_posts set deleted_at = now() where id = $1', [question]);
  await assert.rejects(moderation('question', question, false), { message: 'moderation_post_not_found' });
});
