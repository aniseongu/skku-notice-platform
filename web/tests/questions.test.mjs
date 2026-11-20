import assert from 'node:assert/strict';
import test from 'node:test';
import { createQuestionsApi, formatAverage, isQeUnavailable, parseExperiences, parseQuestion, qeErrorMessage, validateExperience, validateQuestionBody } from '../src/questions.ts';
import { AccountChanged } from '../src/team.ts';

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
  const client = { rpc: async (fn, args) => { calls.push([fn, args]); return { data: fn === 'qe_list_questions' ? [{ id: 'q', body: 'b', anon_no: 1 }] : 'new-id', error: null }; } };
  const api = createQuestionsApi(client);
  assert.equal((await api.listQuestions('n1', () => true)).length, 1);
  assert.deepEqual(calls[0], ['qe_list_questions', { p_notice_id: 'n1' }]);
  await api.createExperience('n1', { satisfaction: 5, body: '  ' }, () => true);
  assert.deepEqual(calls.at(-1), ['qe_create_experience', { p_notice_id: 'n1', p_satisfaction: 5, p_learning: null, p_difficulty: null, p_body: null, p_participated: false }]);
  await api.createQuestion('n1', ' 질문 ', 'p1', () => true);
  assert.deepEqual(calls.at(-1), ['qe_create_question', { p_notice_id: 'n1', p_body: '질문', p_parent_id: 'p1' }]);
  const before = calls.length;
  await assert.rejects(api.createQuestion('n1', '   ', undefined, () => true), /qe_invalid_input/);
  await assert.rejects(api.createExperience('n1', { satisfaction: 9 }, () => true), /qe_invalid_input/);
  assert.equal(calls.length, before);
  let account = 'a';
  const late = { rpc: async () => { account = 'b'; return { data: [], error: null }; } };
  await assert.rejects(createQuestionsApi(late).listQuestions('n1', () => account === 'a'), AccountChanged);
});

test('errors map to one polite line; missing functions are "unavailable"', async () => {
  const api = createQuestionsApi({ rpc: async () => ({ data: null, error: { message: 'qe_already_reviewed', code: 'P0001' } }) });
  await assert.rejects(api.createExperience('n', { satisfaction: 3 }, () => true), (e) => qeErrorMessage(e) === '이 프로그램에는 이미 후기를 남겼어요');
  assert.equal(qeErrorMessage(new Error('boom')), '잠시 뒤에 다시 시도해 주세요');
  assert.equal(isQeUnavailable({ code: 'PGRST202' }), true);
  assert.equal(isQeUnavailable({ code: '42883' }), true);
  assert.equal(isQeUnavailable({ code: 'P0001', message: 'qe_limit_reached' }), false);
});
