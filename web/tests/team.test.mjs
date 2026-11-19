import assert from 'node:assert/strict';
import test from 'node:test';
import { AccountChanged, contactHref, createTeamApi, isTeamNotice, isTeamUnavailable, parseApplicant, parseTeamPost, teamErrorMessage, validateContact, validateTeamDraft } from '../src/team.ts';

const row = (o = {}) => ({ id: 'p1', role: '백엔드', capacity: 3, approved_count: 1, intro: '같이 해요', state: 'open', closes_at: 'x', mine: false, hidden: false, my_status: null, my_application_id: 'a', owner_id: 'LEAK', ...o });

test('parse keeps only known fields and drops bad rows', () => {
  const post = parseTeamPost(row());
  assert.equal(post.approved, 1);
  assert.equal(JSON.stringify(post).includes('LEAK'), false);
  assert.equal(parseTeamPost(row({ state: 'weird' })), null);
  assert.equal(parseTeamPost(null), null);
  assert.equal(parseTeamPost(row({ my_status: 'approved' })).myStatus, 'approved');
  assert.equal(parseApplicant({ application_id: 'a', anon_no: 2, message: null, status: 'pending', applicant_id: 'LEAK' }).anonNo, 2);
  assert.equal(parseApplicant({ application_id: 'a', anon_no: '2', status: 'pending' }), null);
});

test('draft validation: three fields only', () => {
  assert.equal(validateTeamDraft({ role: '', capacity: 2, intro: 'x' }), '맡을 역할을 적어 주세요');
  assert.equal(validateTeamDraft({ role: 'a', capacity: 2, intro: ' ' }), '한 줄 소개를 적어 주세요');
  assert.match(validateTeamDraft({ role: 'a'.repeat(41), capacity: 2, intro: 'x' }), /40자/);
  assert.equal(validateTeamDraft({ role: 'a', capacity: 0, intro: 'x' }), '인원을 다시 골라 주세요');
  assert.equal(validateTeamDraft({ role: '개발', capacity: 2, intro: '같이' }), null);
});

test('contact: https links or ids without a colon; others rejected and never linked', () => {
  assert.equal(validateContact('https://open.kakao.com/o/abc'), null);
  assert.equal(validateContact('kakao_id'), null);
  assert.equal(validateContact('me@example.com'), null);
  assert.ok(validateContact('javascript:alert(1)'));
  assert.ok(validateContact('data:text/html,x'));
  assert.ok(validateContact('java\tscript:x'));
  assert.ok(validateContact(''));
  assert.equal(contactHref('https://a.com/x'), 'https://a.com/x');
  assert.equal(contactHref('HTTP://a.com'), 'http://a.com/');
  for (const bad of ['javascript:alert(1)', 'data:x', 'kakao_id', 'me@a.com', 'ftp://a.com', 'https://a b']) assert.equal(contactHref(bad), null);
});

test('error codes map to one polite line, unknown falls back', () => {
  for (const code of ['team_invalid_input', 'team_not_available', 'team_hidden_recently', 'team_contact_required', 'team_full', 'team_rate_limited']) {
    const text = teamErrorMessage({ message: code });
    assert.ok(text.length > 4 && !text.includes('team_'));
  }
  assert.equal(teamErrorMessage({ message: 'boom' }), '잠시 뒤에 다시 시도해 주세요');
  assert.notEqual(teamErrorMessage({ message: 'ERROR: team_full' }), teamErrorMessage(null));
});

test('missing function is detected, other errors are not', () => {
  assert.equal(isTeamUnavailable({ code: 'PGRST202', message: 'x' }), true);
  assert.equal(isTeamUnavailable({ code: '42883', message: 'x' }), true);
  assert.equal(isTeamUnavailable({ code: 'P0001', message: 'team_full' }), false);
  assert.equal(isTeamUnavailable({ message: 'network' }), false);
});

test('only team-like notices show the section', () => {
  assert.equal(isTeamNotice({ title: '기숙사 콘텐츠 공모전', category: '일반' }), true);
  assert.equal(isTeamNotice({ title: '해커톤 참가자', category: null }), true);
  assert.equal(isTeamNotice({ title: '장학금 안내', category: '장학' }), false);
});

test('rpc wrapper: uses user-less args and discards a response after account switch', async () => {
  const calls = [];
  const client = { rpc: async (fn, args) => { calls.push([fn, args]); return { data: [row()], error: null }; } };
  const api = createTeamApi(client);
  assert.equal((await api.list('n1', () => true)).length, 1);
  assert.deepEqual(calls[0], ['team_list_posts', { p_notice_id: 'n1' }]);
  let account = 'a';
  const late = { rpc: async () => { account = 'b'; return { data: [row()], error: null }; } };
  await assert.rejects(createTeamApi(late).list('n1', () => account === 'a'), AccountChanged);
  await assert.rejects(api.apply('p', 'x'.repeat(101), () => true), /team_invalid_input/);
  await api.apply('p', '  ', () => true);
  assert.deepEqual(calls.at(-1), ['team_apply', { p_post_id: 'p', p_message: null }]);
  await assert.rejects(api.setContact('p', 'javascript:x', () => true), /team_invalid_input/);
  await assert.rejects(api.create('n', { role: '', capacity: 2, intro: 'x' }, () => true), /team_invalid_input/);
});

test('rpc error is thrown so the code can be mapped', async () => {
  const api = createTeamApi({ rpc: async () => ({ data: null, error: { message: 'team_full', code: 'P0001' } }) });
  await assert.rejects(api.apply('p', '', () => true), (e) => teamErrorMessage(e) === '자리가 모두 찼어요');
});
