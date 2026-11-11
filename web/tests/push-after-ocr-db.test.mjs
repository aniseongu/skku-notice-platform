import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

// 사진뿐인 글의 알림은 사진 글자(OCR)를 읽은 뒤에 보낸다. 글자가 있는 글은 기다리지 않고, 3시간이 지나면 기다림을 끝낸다.
test('waiting_for_ocr holds only image-only notices until their images are read, for at most three hours', async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create table platform_notices (id text primary key, body text, images jsonb not null default '[]');
      create table platform_notice_images (notice_id text, image_url text, status text);
      insert into platform_notices values
        ('text/1', '장학금 신청 안내입니다', '["a.png"]'), ('img/1', '—', '["a.png","b.png"]'), ('img/2', null, '["a.png"]'), ('none/1', '—', '[]');
      insert into platform_notice_images values ('img/1','a.png','ready'), ('img/1','b.png','pending'), ('img/2','a.png','failed');`);
    await db.exec('set check_function_bodies = off');
    const migration = await readFile(new URL('../../supabase/migrations/20261112160000_push_after_ocr.sql', import.meta.url), 'utf8');
    await db.exec(migration.slice(0, migration.indexOf('create or replace function public.list_notice_push_candidates')));
    const waiting = async (id, hoursAgo) => (await db.query(`select public.waiting_for_ocr($1, now() - ($2 || ' hours')::interval) w`, [id, String(hoursAgo)])).rows[0].w;
    assert.equal(await waiting('text/1', 0), false);    // 본문에 글자가 있으면 기다리지 않는다
    assert.equal(await waiting('img/1', 0), true);      // 사진 하나가 아직 읽히는 중
    assert.equal(await waiting('img/1', 4), false);     // 3시간이 지났다
    assert.equal(await waiting('img/2', 0), false);     // 읽기에 실패한 것도 끝난 것으로 본다
    assert.equal(await waiting('none/1', 0), false);    // 사진이 없다
    await db.exec(`update platform_notice_images set status = 'ready' where notice_id = 'img/1'`);
    assert.equal(await waiting('img/1', 0), false);     // 모두 읽혔다
  } finally { await db.close(); }
});
