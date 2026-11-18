import assert from 'node:assert/strict';
import test from 'node:test';
import { OPPORTUNITY_LABELS, OPPORTUNITY_STATUSES, loadOpportunities, parseOpportunity, removeOpportunity, saveOpportunity } from '../src/opportunities.ts';

const row = (o = {}) => ({ notice_id: 's/1', title: '공모전', url: null, board: null, deadline: null, status: 'interested', note: null, created_at: 'a', updated_at: 'b', ...o });

test('labels and order are fixed', () => {
  assert.deepEqual(OPPORTUNITY_STATUSES.map((s) => OPPORTUNITY_LABELS[s]), ['관심 있음', '준비 중', '지원함', '결과 나옴']);
});

test('parse rejects malformed rows', () => {
  assert.equal(parseOpportunity(null), null);
  assert.equal(parseOpportunity(row({ status: 'x' })), null);
  assert.equal(parseOpportunity(row({ title: 3 })), null);
  assert.equal(parseOpportunity(row()).status, 'interested');
});

test('load filters by user and drops bad rows', async () => {
  const calls = [];
  const q = { select: () => q, eq: (...a) => { calls.push(a); return q; }, order: () => q, limit: async () => ({ error: null, data: [row(), { bad: 1 }] }) };
  const list = await loadOpportunities({ from: () => q }, 'u1', () => true);
  assert.deepEqual(calls, [['user_id', 'u1']]);
  assert.equal(list.length, 1);
});

test('late response after account switch is discarded', async () => {
  let account = 'a';
  const q = { select: () => q, eq: () => q, order: () => q, limit: async () => { account = 'b'; return { error: null, data: [row()] }; } };
  await assert.rejects(loadOpportunities({ from: () => q }, 'a', () => account === 'a'), /계정이 바뀌었어요/);
});

test('save upserts only given fields and validates', async () => {
  let sent;
  const q = { upsert: (r, o) => { sent = [r, o]; return q; }, select: () => q, single: async () => ({ error: null, data: row({ status: 'applied' }) }) };
  const client = { from: () => q };
  const saved = await saveOpportunity(client, 'u1', { notice_id: 's/1', title: ' 공모전 ', status: 'applied' }, () => true);
  assert.equal(saved.status, 'applied');
  assert.deepEqual(sent[0], { user_id: 'u1', notice_id: 's/1', title: '공모전', status: 'applied' });
  assert.equal(sent[1].onConflict, 'user_id,notice_id');
  await assert.rejects(saveOpportunity(client, 'u1', { notice_id: 's/1', title: 't', note: 'x'.repeat(501) }, () => true), /500/);
  await assert.rejects(saveOpportunity(client, 'u1', { notice_id: 's/1', title: 't', url: 'javascript:1' }, () => true), /링크/);
  await assert.rejects(saveOpportunity(client, 'u1', { notice_id: 's/1', title: 't', status: 'zzz' }, () => true), /상태/);
  await assert.rejects(saveOpportunity(client, 'u1', { notice_id: 's/1', title: 't' }, () => false), /계정이 바뀌었어요/);
});

test('remove scopes delete to user and notice, and respects the guard', async () => {
  const calls = [];
  const q = { delete: () => q, eq: (...a) => { calls.push(a); return calls.length === 2 ? Promise.resolve({ error: null }) : q; } };
  await removeOpportunity({ from: () => q }, 'u1', 's/1', () => true);
  assert.deepEqual(calls, [['user_id', 'u1'], ['notice_id', 's/1']]);
  await assert.rejects(removeOpportunity({ from: () => q }, 'u1', 's/1', () => false), /계정이 바뀌었어요/);
});

test('deadlineIso turns a notice deadline into a timestamp or null', async () => {
  const { deadlineIso } = await import('../src/opportunities.ts');
  assert.equal(deadlineIso(null), null);
  assert.equal(deadlineIso('아님'), null);
  assert.equal(deadlineIso('2026-11-30T00:00:00+09:00'), '2026-11-29T15:00:00.000Z');
});

test('ifAbsent never overwrites an existing row: ignoreDuplicates upsert, then reads the stored row', async () => {
  const log = [];
  const q = {
    upsert: (r, o) => { log.push(['upsert', r, o]); return Promise.resolve({ error: null }); },
    select: () => q, eq: (...a) => { log.push(['eq', ...a]); return q; },
    single: async () => ({ error: null, data: row({ status: 'applied' }) }),
  };
  const saved = await saveOpportunity({ from: () => q }, 'u1', { notice_id: 's/1', title: '공모전', status: 'interested' }, () => true, { ifAbsent: true });
  assert.equal(saved.status, 'applied');   // 다른 기기에서 바꾼 상태가 남는다
  assert.equal(log[0][2].ignoreDuplicates, true);
  assert.deepEqual(log.filter((l) => l[0] === 'eq'), [['eq', 'user_id', 'u1'], ['eq', 'notice_id', 's/1']]);
});

test('missing table and limit errors are told apart from transient ones', async () => {
  const { isMissingTable, isLimitReached } = await import('../src/opportunities.ts');
  assert.equal(isMissingTable({ code: '42P01' }), true);
  assert.equal(isMissingTable({ code: 'PGRST205' }), true);
  assert.equal(isMissingTable({ message: 'Failed to fetch' }), false);
  assert.equal(isMissingTable(null), false);
  assert.equal(isLimitReached({ message: 'user_opportunities limit reached' }), true);
  assert.equal(isLimitReached({ message: 'network' }), false);
});
