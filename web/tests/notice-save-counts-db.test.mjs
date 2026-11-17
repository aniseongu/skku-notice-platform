import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

test('saved counts aggregate across owners, limit input and exclude anonymous access', async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated;
      create table public.user_notice_states (user_id text, notice_id text, is_saved boolean);
      insert into public.user_notice_states values ('a','one',true), ('b','one',true), ('a','two',false), ('a','last',true);`);
    await db.exec(await readFile(new URL('../../supabase/migrations/20261117110000_notice_save_counts.sql', import.meta.url), 'utf8'));
    await db.exec('set role authenticated');
    const result = await db.query("select * from public.notice_save_counts(array['one','two'])");
    assert.deepEqual(result.rows, [{ notice_id: 'one', saves: 2 }]);
    assert.deepEqual(result.fields.map((field) => field.name), ['notice_id', 'saves']);
    const capped = await db.query("select * from public.notice_save_counts(array_fill('none'::text,array[500]) || array['last'])");
    assert.equal(capped.rows.length, 0);
    await db.exec('reset role; set role anon');
    await assert.rejects(db.query("select * from public.notice_save_counts(array['one'])"), /permission denied/);
  } finally { await db.close(); }
});
