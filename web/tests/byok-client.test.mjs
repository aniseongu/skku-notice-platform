import assert from 'node:assert/strict';
import test from 'node:test';
import { byokAvailable, loadByokStatus, looksLikeGeminiKey, registerByokKey, removeByokKey } from '../src/byok.ts';

const KEY = `AIza${'C'.repeat(35)}`;

test('key format check and request never send a malformed key', async () => {
  assert.equal(looksLikeGeminiKey(KEY), true);
  assert.equal(looksLikeGeminiKey('AIza123'), false);
  let calls = 0;
  const client = { functions: { invoke: async () => { calls++; return { data: { keyHint: 'CCCC' }, error: null }; } } };
  await assert.rejects(registerByokKey(client, 'nope'), /붙여 넣어/);
  assert.equal(calls, 0);
  assert.equal(await registerByokKey(client, KEY), 'CCCC');
});

test('registration and removal surface only plain messages', async () => {
  const failing = { functions: { invoke: async () => ({ data: null, error: new Error(`boom ${KEY}`) }) } };
  await assert.rejects(registerByokKey(failing, KEY), (error) => !String(error.message).includes(KEY) && /다시 시도/.test(error.message));
  await assert.rejects(removeByokKey(failing), /지우지/);
  const odd = { functions: { invoke: async () => ({ data: {}, error: null }) } };
  await assert.rejects(registerByokKey(odd, KEY), /저장하지/);
});

test('status query never asks for the ciphertext column', async () => {
  const selects = [];
  const client = { from: () => { const q = { select: (columns) => { selects.push(columns); return q; }, eq: () => q,
    maybeSingle: async () => ({ data: { key_hint: 'CCCC', model: 'm', disabled_at: null, last_error: null, used_today: 2 }, error: null }) }; return q; } };
  assert.deepEqual(await loadByokStatus(client, 'u'), { keyHint: 'CCCC', model: 'm', disabled: false, lastError: null, usedToday: 2 });
  assert.equal(selects[0].includes('ciphertext'), false);
});

test('availability probe needs a 204 from the function and treats network errors as unavailable', async () => {
  assert.equal(await byokAvailable('https://x.supabase.co', async () => ({ status: 204 })), true);
  assert.equal(await byokAvailable('https://x.supabase.co', async () => ({ status: 404 })), false);
  assert.equal(await byokAvailable('https://x.supabase.co', async () => { throw new TypeError('cors'); }), false);
  assert.equal(await byokAvailable(undefined), false);
});

test('client accepts the AQ. key format', () => {
  assert.equal(looksLikeGeminiKey(`AQ.Ab8RN6J${'x'.repeat(40)}`), true);
});

import { loadMyDeadlines, loadMyNoticeInfo, loadMyTranslations } from '../src/byok.ts';

test('translation query is bound to the current owner', async () => {
  const filters = [];
  const client = { from: (table) => {
    assert.equal(table, 'user_notice_translations');
    const q = { select: () => q, eq: (name, value) => { filters.push([name, value]); return q; },
      not: () => q, order: () => q, range: async () => ({ data: [
        { notice_id: 'a/1', title: '한국어 제목', body: '한국어 본문', model: 'm' },
      ], error: null }) };
    return q;
  } };
  const translations = await loadMyTranslations(client, 'user-a');
  assert.deepEqual(filters, [['user_id', 'user-a']]);
  assert.equal(translations.get('a/1').body, '한국어 본문');
});

test('deadline list is owner scoped, paginated, and favors an explicitly requested summary', async () => {
  const queries = [];
  const client = { from: (table) => {
    const state = { table };
    const q = { select: () => q, eq: (key, value) => { state[key] = value; return q; }, not: () => q,
      order: () => q, range: async (start, end) => {
        queries.push({ ...state, start, end });
        return { data: table === 'user_notice_summaries'
          ? [{ notice_id: 'a/1', deadline: '2026-12-01T00:00:00Z', deadline_kind: '마감' }]
          : [{ notice_id: 'a/1', deadline: '2026-12-02T00:00:00Z', deadline_kind: '일정' },
             { notice_id: 'a/2', deadline: '2026-12-03T00:00:00Z', deadline_kind: '일정' }], error: null };
      } };
    return q;
  } };
  const result = await loadMyDeadlines(client, 'user-a');
  assert.equal(result.get('a/1').deadline, '2026-12-01T00:00:00Z');
  assert.equal(result.get('a/2').deadlineKind, '일정');
  assert.deepEqual(queries.map((q) => q.user_id), ['user-a', 'user-a']);
});

function summaryClient(tables) {
  const queries = [];
  return { queries, from: (table) => {
    const state = { table };
    const chain = { select: () => chain, eq: (column, value) => { (state.eq ??= {})[column] = value; return chain; },
      maybeSingle: async () => { queries.push({ table, eq: state.eq }); return { data: tables[table] ?? null, error: null }; } };
    return chain;
  } };
}

test('my notice info merges what I asked for with the judgment, and always filters by my user', async () => {
  const asked = summaryClient({
    user_notice_summaries: { summary: '눌러서 만든 요약', deadline: '2026-11-10T05:00:00Z', deadline_kind: '마감' },
    user_notice_judgments: { summary: '판정 요약', verdict: 'relevant', reason: '대상이에요', model: 'm', deadline: null, deadline_kind: null },
  });
  const info = await loadMyNoticeInfo(asked, 'user-a', 'a/1');
  assert.deepEqual(info, { summary: '눌러서 만든 요약', deadline: '2026-11-10T05:00:00Z', deadlineKind: '마감', ai: { verdict: 'relevant', reason: '대상이에요', model: 'm' } });
  assert.deepEqual(asked.queries.map((q) => q.eq), [{ user_id: 'user-a', notice_id: 'a/1' }, { user_id: 'user-a', notice_id: 'a/1' }]);
  const judged = summaryClient({ user_notice_judgments: { summary: '판정 요약', verdict: 'maybe', reason: '확인이 필요해요', model: 'm', deadline: '2026-12-01T00:00:00Z', deadline_kind: '일정' } });
  const fromJudgment = await loadMyNoticeInfo(judged, 'user-a', 'a/1');
  assert.equal(fromJudgment.summary, '판정 요약');
  assert.equal(fromJudgment.deadlineKind, '일정');
  assert.equal(fromJudgment.ai.verdict, 'maybe');
  assert.equal(await loadMyNoticeInfo(summaryClient({}), 'user-a', 'a/1'), null);
  const blank = await loadMyNoticeInfo(summaryClient({ user_notice_summaries: { summary: '   ', deadline: null } }), 'user-a', 'a/1');
  assert.equal(blank.summary, null);
  assert.equal(blank.deadline, null);
  // 알 수 없는 판정 값이나 이유가 없는 판정은 쓰지 않는다.
  const odd = await loadMyNoticeInfo(summaryClient({ user_notice_judgments: { summary: 's', verdict: 'weird', reason: 'x', model: 'm' } }), 'user-a', 'a/1');
  assert.equal(odd.ai, null);
});

import { backfillNote, loadByokBackfillCount } from '../src/byok.ts';

test('backfill note appears only while notices are waiting and the key works', () => {
  assert.equal(backfillNote(12, false), '공지 12개를 내 기준으로 다시 보고 있어요');
  assert.equal(backfillNote(0, false), null);
  assert.equal(backfillNote(5, true), null);
});

test('backfill count falls back to zero on errors or odd values', async () => {
  const client = (result) => ({ rpc: async () => result });
  assert.equal(await loadByokBackfillCount(client({ data: 7, error: null })), 7);
  assert.equal(await loadByokBackfillCount(client({ data: null, error: new Error('x') })), 0);
  assert.equal(await loadByokBackfillCount(client({ data: 'many', error: null })), 0);
});
