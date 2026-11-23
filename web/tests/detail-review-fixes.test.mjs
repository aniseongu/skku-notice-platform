import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import test from 'node:test';
import { setImmediate } from 'node:timers/promises';
import vm from 'node:vm';

// 반대 리뷰(fe45876..f7d742e) 지적의 컨트롤러 경로 재현. 컨트롤러에서 해당 메서드만 잘라 낸다.
const source = readFileSync(new URL('../src/app-controller.ts', import.meta.url), 'utf8');
const method = (start) => source.slice(source.indexOf(start), source.indexOf('\n  }', source.indexOf(start)) + 4);
const build = (names, globals) => new vm.Script(stripTypeScriptTypes(`(class { ${names.map(method).join('\n')} })`)).runInNewContext(globals);

test('a translation server read that fails before the cache restore does not hide the later cached translation', async () => {
  const cachedTranslation = { title: '번역 제목', body: '번역 본문' };
  let resolveRestore;
  const Controller = build(['  detailTranslation(', '  private refreshDetailTranslation('], {
    authClient: {}, loadMyTranslation: () => Promise.reject(new Error('offline')),
  });
  const app = Object.assign(new Controller(), {
    authUserId: 'u', subscriptionsEpoch: 1, detailTranslations: new Map(), myTranslations: new Map([['n', {}]]),
    isCurrentAccount: () => true, requestUpdate() {}, cacheDetail() {},
    restoreDetail: () => new Promise((resolve) => { resolveRestore = resolve; }),
  });
  const notice = { id: 'n', title: 'Intern', title_ko: '인턴' };
  assert.equal(app.detailTranslation(notice, null), null);
  await setImmediate();            // 서버 읽기가 먼저 실패한다
  resolveRestore({ translation: cachedTranslation });
  await setImmediate();
  assert.deepEqual(app.detailTranslation(notice, null), cachedTranslation);
});

test('a successful detail read wins over a stale cached list judgement, including an empty result', () => {
  const Controller = build(['  detailAi('], {});
  const stale = { verdict: 'relevant', reason: '옛 이유' }, fresh = { verdict: 'not_relevant', reason: '새 이유' };
  const app = Object.assign(new Controller(), {
    summaries: new Map(), liveInfo: new Set(), judgement: () => ({ ai: stale }), myInfo: () => null,
  });
  const notice = { id: 'n' };
  assert.equal(app.detailAi(notice), stale);                         // 상세 조회 전에는 목록 판정
  app.summaries.set('n', { ai: fresh }); app.liveInfo.add('n');
  assert.equal(app.detailAi(notice), fresh);                         // 조회가 성공하면 그 결과
  app.summaries.set('n', null);
  assert.equal(app.detailAi(notice), null);                          // 빈 결과도 우선
});

function summaryApp(locks, calls, existing = null) {
  const Controller = build(['  async makeSummary('], {
    authClient: {}, sessionIs: async () => true,
    requestNoticeSummary: async () => { calls.push('summarize'); return { summary: '요약', deadline: null, deadlineKind: null }; },
    loadMyNoticeInfo: async () => existing,
    navigator: { locks }, setTimeout: () => 0,
  });
  return Object.assign(new Controller(), {
    authUserId: 'u', subscriptionsEpoch: 1, summarizing: null, summaryError: '', summaryErrorId: null,
    summaries: new Map(), missingSummaries: new Set(['n']), isCurrentAccount: () => true, detailIsOpen: () => true, cacheDetail() {},
    requestUpdate() {},
  });
}

test('two tabs do not both call the summary API for the same account and notice', async () => {
  const calls = [];
  const busy = { request: async (_name, _options, callback) => callback(null) };     // 다른 탭이 이미 만드는 중
  await summaryApp(busy, calls).makeSummary({ id: 'n' });
  assert.deepEqual(calls, []);
  const free = { request: async (_name, _options, callback) => callback({ name: 'lock' }) };
  await summaryApp(free, calls).makeSummary({ id: 'n' });
  assert.deepEqual(calls, ['summarize']);
  // 잠금을 얻은 뒤 서버에 이미 요약이 생겼으면 다시 만들지 않는다.
  await summaryApp(free, calls, { summary: '다른 탭이 만든 요약', deadline: null, deadlineKind: null, ai: null }).makeSummary({ id: 'n' });
  assert.deepEqual(calls, ['summarize']);
});
