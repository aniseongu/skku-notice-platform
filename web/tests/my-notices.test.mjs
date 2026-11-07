import assert from 'node:assert/strict';
import test from 'node:test';
import { asJudgement, loadMyInterests, loadMyJudgments } from '../src/my-notices.ts';

function client({ judgments = [], interests = [], error = null } = {}) {
  const asked = [];
  return { asked,
    from: (table) => { const q = { table }; const c = { select: () => c, eq: (k, v) => { (q.eq ??= {})[k] = v; return c; }, order: () => c,
      limit: async (n) => { asked.push({ ...q, limit: n }); return { data: judgments, error }; } }; return c; },
    rpc: async (name, args) => { asked.push({ rpc: name, args }); return { data: interests, error }; } };
}

test('my judgments become the original judgement shape and bad rows are dropped', async () => {
  const c = client({ judgments: [
    { notice_id: 'a/1', verdict: 'relevant', reason: '대상이에요', model: 'm', deadline: '2026-11-10T05:00:00Z', deadline_kind: '마감' },
    { notice_id: 'a/2', verdict: 'maybe', reason: '확인이 필요해요', model: 'm', deadline: null, deadline_kind: null },
    { notice_id: 'a/3', verdict: 'weird', reason: 'x', model: 'm' },
    { notice_id: 'a/4', verdict: 'relevant', reason: '   ', model: 'm' },
    { notice_id: 5, verdict: 'relevant', reason: 'x', model: 'm' },
  ] });
  const map = await loadMyJudgments(c, 'user-a');
  assert.deepEqual([...map.keys()], ['a/1', 'a/2']);
  assert.equal(map.get('a/1').deadlineKind, '마감');
  assert.deepEqual(c.asked[0].eq, { user_id: 'user-a' }, 'only my own rows are asked for');
  assert.deepEqual(asJudgement(map.get('a/2')).ai, { verdict: 'maybe', reason: '확인이 필요해요', model: 'm' });
  assert.equal(asJudgement(map.get('a/2')).notified, false);
  await assert.rejects(loadMyJudgments(client({ error: new Error('boom') }), 'user-a'));
});

test('my interests map notice ids to the keywords found by the server', async () => {
  const c = client({ interests: [{ notice_id: 'a/1', words: ['장학', '인턴'] }, { notice_id: 'a/2', words: [] }, { notice_id: 3, words: ['x'] }, { notice_id: 'a/4', words: 'oops' }] });
  const map = await loadMyInterests(c);
  assert.deepEqual([...map], [['a/1', ['장학', '인턴']], ['a/2', []]]);
  assert.deepEqual(c.asked[0], { rpc: 'my_notice_interests', args: { p_limit: 300 } });
});
