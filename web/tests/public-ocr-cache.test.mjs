import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

test('OCR results are public but only the worker may modify them', async () => {
  const db = new PGlite();
  try {
    await db.exec('create role anon; create role authenticated; create role service_role bypassrls');
    for (const name of ['20261107030000_public_notices.sql', '20261107070000_public_ocr_cache.sql']) {
      await db.exec(await readFile(new URL(`../../supabase/migrations/${name}`, import.meta.url), 'utf8'));
    }
    await db.exec(`insert into platform_sources(id,name,url) values ('school','학교','https://www.skku.edu/notice');
      insert into platform_notices(id,source_id,article_no,title,url,posted_on,first_seen)
      values ('school/1','school','1','공지','https://www.skku.edu/notice?articleNo=1','2026-11-01',now());`);
    const hash = 'a'.repeat(64);
    await db.exec(`set role service_role;
      insert into platform_ocr_cache(content_sha256,engine_version,extracted_text) values ('${hash}','rapidocr-3.10.0','공지');
      insert into platform_notice_images(notice_id,image_url,content_sha256,engine_version,status)
      values ('school/1','https://www.skku.edu/image.png','${hash}','rapidocr-3.10.0','ready'); reset role;`);
    for (const role of ['anon', 'authenticated']) {
      await db.exec(`set role ${role}`);
      assert.equal((await db.query('select extracted_text from platform_ocr_cache')).rows[0].extracted_text, '공지');
      await assert.rejects(db.exec('delete from platform_ocr_cache'), /permission denied/);
      await assert.rejects(db.exec("update platform_notice_images set status='failed'"), /permission denied/);
      await db.exec('reset role');
    }
  } finally { await db.close(); }
});
