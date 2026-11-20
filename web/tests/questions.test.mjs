import assert from 'node:assert/strict';
import test from 'node:test';
import { createClient } from '@supabase/supabase-js';
import { createQuestionsApi, formatAverage, isQeUnavailable, parseExperiences, parseQuestion, qeErrorMessage, validateExperience, validateQuestionBody } from '../src/questions.ts';
import { AccountChanged } from '../src/team.ts';

const writeGuard = () => ({ accessToken: async () => 'checked-token', signal: new AbortController().signal });
const builder = (response) => Object.assign(Promise.resolve(response), {
  setHeader() { return this; },
  abortSignal() { return this; },
});

test('parse keeps only known fields and drops bad rows', () => {
  const q = parseQuestion({ id: 'q1', parent_id: null, body: '언제까지예요?', anon_no: 2, created_at: 't', mine: true, hidden: false, detached: false, user_id: 'LEAK' });
  assert.equal(q.anonNo, 2);
  assert.equal(JSON.stringify(q).includes('LEAK'), false);
  assert.equal(parseQuestion({ id: 'q', body: 'x', anon_no: '2' }), null);
  const e = parseExperiences({ posts: [{ id: 'e1', body: null, satisfaction: 4, learning: null, difficulty: 3, participated: true, mine: false, hidden: false, user_id: 'LEAK' }, { id: 'bad', satisfaction: 9 }],
    count: 1, satisfaction: { average: '4.0', count: 1 }, learning: { average: null, count: 0 }, difficulty: { average: 3, count: 1 } });
  assert.equal(e.posts.length, 1);
  assert.equal(e.satisfaction.average, 4);
  assert.equal(JSON.stringify(e).includes('LEAK'), false);
  assert.equal(parseExperiences(null).count, 0);
  assert.equal(formatAverage(4), '4.0');
  assert.equal(formatAverage(null), '-');
});

test('validation: stars required, body optional for reviews and required for questions', () => {
  assert.ok(validateExperience({ satisfaction: 0 }));
  assert.equal(validateExperience({ satisfaction: 3 }), null);
  assert.ok(validateExperience({ satisfaction: 3, body: 'a'.repeat(501) }));
  assert.ok(validateQuestionBody('  '));
  assert.ok(validateQuestionBody('a'.repeat(501)));
  assert.equal(validateQuestionBody('궁금해요'), null);
});

test('rpc wrapper: args, invalid input never sent, account switch discards the response', async () => {
  const calls = [];
  const client = { rpc: (fn, args) => { calls.push([fn, args]); return builder({ data: fn === 'qe_list_questions' ? [{ id: 'q', body: 'b', anon_no: 1 }] : 'new-id', error: null }); } };
  const api = createQuestionsApi(client);
  assert.equal((await api.listQuestions('n1', () => true)).length, 1);
  assert.deepEqual(calls[0], ['qe_list_questions', { p_notice_id: 'n1' }]);
  await api.createExperience('n1', { satisfaction: 5, body: '  ' }, writeGuard());
  assert.deepEqual(calls.at(-1), ['qe_create_experience', { p_notice_id: 'n1', p_satisfaction: 5, p_learning: null, p_difficulty: null, p_body: null, p_participated: false }]);
  await api.createQuestion('n1', ' 질문 ', 'p1', writeGuard());
  assert.deepEqual(calls.at(-1), ['qe_create_question', { p_notice_id: 'n1', p_body: '질문', p_parent_id: 'p1' }]);
  const before = calls.length;
  await assert.rejects(api.createQuestion('n1', '   ', undefined, writeGuard()), /qe_invalid_input/);
  await assert.rejects(api.createExperience('n1', { satisfaction: 9 }, writeGuard()), /qe_invalid_input/);
  assert.equal(calls.length, before);
  let account = 'a';
  const late = { rpc: async () => { account = 'b'; return { data: [], error: null }; } };
  await assert.rejects(createQuestionsApi(late).listQuestions('n1', () => account === 'a'), AccountChanged);
});

test('every write sends the checked token even if the SDK resolves a different token', async () => {
  const requests = [];
  const client = createClient('https://tests.invalid', 'test-key', {
    accessToken: async () => 'sdk-token',
    global: { fetch: async (url, init) => {
      requests.push([new URL(url).pathname.split('/').at(-1), init.headers.get('Authorization'), init.signal]);
      return Response.json('new-id');
    } },
  });
  const api = createQuestionsApi(client);
  const guard = writeGuard();
  await api.createQuestion('n1', '질문', undefined, guard);
  await api.createExperience('n1', { satisfaction: 5 }, guard);
  await api.editQuestion('p1', '수정', guard);
  await api.editExperience('p1', { satisfaction: 4 }, guard);
  await api.deletePost('p1', guard);
  await api.report('p1', guard);
  await api.blockAuthor('p1', guard);
  await api.unblock('b1', guard);
  const names = ['create_question', 'create_experience', 'edit', 'edit', 'delete', 'report', 'block_author', 'unblock'];
  assert.deepEqual(requests, names.map((name) => [`qe_${name}`, 'Bearer checked-token', guard.signal]));
});

test('a missing session or an account change before dispatch prevents writing', async () => {
  let calls = 0;
  const api = createQuestionsApi({ rpc: () => { calls++; return builder({ data: null, error: null }); } });
  const controller = new AbortController();
  await assert.rejects(api.deletePost('p1', { signal: controller.signal, accessToken: async () => null }), AccountChanged);
  const pending = api.deletePost('p1', { signal: controller.signal, accessToken: async () => 'checked-token' });
  controller.abort();
  await assert.rejects(pending, AccountChanged);
  assert.equal(calls, 0);
});

test('errors map to one polite line; missing functions are "unavailable"', async () => {
  const api = createQuestionsApi({ rpc: () => builder({ data: null, error: { message: 'qe_already_reviewed', code: 'P0001' } }) });
  await assert.rejects(api.createExperience('n', { satisfaction: 3 }, writeGuard()), (e) => qeErrorMessage(e) === '이 프로그램에는 이미 후기를 남겼어요');
  assert.equal(qeErrorMessage(new Error('boom')), '잠시 뒤에 다시 시도해 주세요');
  assert.equal(isQeUnavailable({ code: 'PGRST202', message: 'Could not find the function qe_list_questions in the schema cache' }), false);
  assert.equal(isQeUnavailable({ code: 'PGRST205' }), false);
  assert.equal(isQeUnavailable({ code: '42P01' }), true);
  assert.equal(isQeUnavailable({ code: '42883' }), true);
  assert.equal(isQeUnavailable({ code: 'P0001', message: 'qe_limit_reached' }), false);
});
