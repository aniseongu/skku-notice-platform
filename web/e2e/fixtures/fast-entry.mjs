// Local PostgREST and Edge Function responses for the fast-entry tests and build measurements.
export const school = 'skku-notice01';
export const shared = 'unsubscribed';
export const sharedId = `${shared}/777`;
export const sharedTitle = '공유받은 장학 공지';
export const sharedBody = '공유받은 공지의 본문이에요.';
export const summaryOf = (user) => `${user} 계정에 저장된 요약이에요.`;
export const deepLink = (id = sharedId) => `/?notice=${encodeURIComponent(id)}&push=1`;
const url = 'https://www.skku.edu/example';
const sessionKey = 'sb-127-auth-token';
const sources = [
  { id: school, name: '성대 공지' },
  { id: shared, name: '미구독 게시판' },
  { id: 'external-intern', name: '외부 인턴', external: true },
  { id: 'linkareer', name: '링커리어', external: true },
  { id: 'jasoseol', name: '자소설닷컴', external: true },
  { id: 'skku-career-intern', name: '학생인재개발팀 인턴 게시판' },
  { id: 'skku-coop', name: '현장실습', external: true, coop: true },
];
export const plainNotice = (id, source_id, title) => ({
  id, source_id, article_no: id.split('/')[1], title, url, posted_on: new Date().toISOString().slice(0, 10), pinned: false,
  deadline: null, first_seen: null,
});
const first = plainNotice(`${school}/100`, school, '목록 첫 번째 공지');
const extra = plainNotice(`${shared}/101`, shared, '목록의 미구독 게시판 공지');

function sessionFor(id) {
  const expires_at = Math.floor(Date.now() / 1000) + 3600;
  const claims = Buffer.from(JSON.stringify({ sub: id, exp: expires_at })).toString('base64url');
  return { access_token: `e30.${claims}.Zml4dHVyZQ`, refresh_token: 'fixture', expires_at, token_type: 'bearer',
    user: { id, aud: 'authenticated', user_metadata: { full_name: '테스트 계정' } } };
}

export async function switchAccount(page, id) {
  await page.evaluate(({ session, key }) => {
    if (session) localStorage.setItem(key, JSON.stringify(session));
    else localStorage.removeItem(key);
    const channel = new BroadcastChannel(key);
    channel.postMessage({ event: session ? 'SIGNED_IN' : 'SIGNED_OUT', session });
    channel.close();
  }, { session: id ? sessionFor(id) : null, key: sessionKey });
}

export async function fastEntryFixture(page, options = {}) {
  const { user = 'A', delay = 0, dev = true, hasKey = false, onboarded = true } = options;
  const requests = [];
  const opportunities = new Map();
  const saved = options.saved ?? new Map();
  const subscriptions = new Map();
  const summaries = new Map();
  const settings = { ...options };
  await page.addInitScript(({ session, key, onboarded }) => {
    if (!sessionStorage.getItem('fast-entry-seeded')) {
      if (session) localStorage.setItem(key, JSON.stringify(session));
      else localStorage.removeItem(key);
      sessionStorage.setItem('fast-entry-seeded', '1');
    }
    if (onboarded) for (const id of ['A', 'B']) localStorage.setItem(`platform:onboarded:${id}`, '1');
    Object.defineProperty(navigator, 'serviceWorker', { value: undefined });
    Reflect.deleteProperty(window, 'PushManager');
  }, { session: user ? sessionFor(user) : null, key: sessionKey, onboarded });
  if (dev) {
    await page.route(/\/src\/auth\.ts$/, (route) => route.fulfill({ contentType: 'text/javascript', body: `
      import { createAuthClient } from '/src/auth.ts?fixture';
      export const authClient = createAuthClient('http://127.0.0.1:54321', 'sb_publishable_fixture');
    ` }));
    await page.route(/\/src\/byok\.ts$/, (route) => route.fulfill({ contentType: 'text/javascript', body: `
      export * from '/src/byok.ts?fixture';
      export const checkByokAvailability = () => Promise.resolve(${hasKey});
    ` }));
  }
  await page.route('http://127.0.0.1:54321/**', async (route) => {
    const request = route.request();
    const requestUrl = new URL(request.url());
    const endpoint = requestUrl.pathname.split('/').at(-1);
    const method = request.method();
    const id = requestUrl.searchParams.get('notice_id')?.slice(3) ?? requestUrl.searchParams.get('id')?.slice(3);
    const owner = requestUrl.searchParams.get('user_id')?.slice(3) ?? user;
    const columns = requestUrl.searchParams.get('select') ?? '';
    const arguments_ = request.postDataJSON();
    const headers = {
      'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS',
      'access-control-allow-headers': '*',
    };
    if (method === 'OPTIONS') return route.fulfill({ status: 204, headers });
    requests.push({ endpoint, method, id, owner, columns, args: arguments_ });
    if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
    let result = [];
    switch (endpoint) {
      case 'platform_sources': result = sources.map((source) => ({ ...source, url, last_success_at: new Date().toISOString() })); break;
      case 'platform_notices': {
        if (requestUrl.searchParams.get('id')?.startsWith('in.')) {
          result = [plainNotice(sharedId, shared, sharedTitle)];
          break;
        }
        if (!id) {
          if (settings.feedGate) await settings.feedGate;
          result = [first, extra, ...(settings.additionalNotices ?? [])];
          break;
        }
        const body = id === first.id ? '목록 공지 본문이에요.' : sharedBody;
        result = [{ id, body, body_html: `<p>${body}</p>`, attachments: [], images: [], fetched_at: new Date().toISOString() }];
        break;
      }
      case 'get_public_notice': {
        const [board] = arguments_.p_id.split('/');
        const source = sources.find((entry) => entry.id === board);
        if (!source || settings.missingIds?.includes(arguments_.p_id)) break;
        const title = settings.english ? 'Scholarship Program Application Details' : board === shared ? sharedTitle : `${source.name} 공고`;
        const body = settings.english ? 'Applications are open for the scholarship program.' : sharedBody;
        result = [{ ...plainNotice(arguments_.p_id, board, title), source_name: source.name, external: source.external === true, coop: source.coop === true,
          deadline: settings.publicDeadline ?? null, body, body_html: `<p>${body}</p>`, attachments: settings.attachments ?? [] }];
        break;
      }
      case 'user_profiles': result = onboarded ? [{
        programs: [{ college: '경영대학', department: '경영학과' }], year: 3, enrollment_status: '재학',
        military_service: '해당 없음', onboarded_at: '2026-01-01', university_3p_internship_selected: !!settings.graduation,
        university_3p_internship_done: false,
      }] : []; break;
      case 'user_source_subscriptions': {
        const account = arguments_?.user_id ?? owner;
        const current = subscriptions.get(account) ?? new Set([school]);
        subscriptions.set(account, current);
        if (method === 'POST') {
          if (settings.subscriptionGate) await settings.subscriptionGate;
          if (settings.subscriptionError) return route.fulfill({ status: 400, headers, json: { message: 'fixture subscription failed' } });
          current.add(arguments_.source_id);
          break;
        }
        if (method === 'DELETE') { current.delete(requestUrl.searchParams.get('source_id')?.slice(3)); break; }
        result = [...current].map((source_id) => ({ source_id }));
        break;
      }
      case 'user_byok_keys': result = hasKey ? [{ key_hint: 'demo', model: 'fixture', used_today: 0 }] : []; break;
      case 'user_ai_preferences': result = [{ ai_enabled: true }]; break;
      case 'user_notice_summaries': {
        if (id && settings.infoGate) await settings.infoGate(owner);
        if (!id && columns === 'notice_id,deadline,deadline_kind' && settings.deadlinesGate) await settings.deadlinesGate;
        if (id && settings.summaryError) return route.fulfill({ status: 503, headers, json: { message: 'fixture read failed' } });
        const summary = summaries.get(id) ?? (id === sharedId && settings.storedSummary !== false ? summaryOf(owner) : null);
        result = id && summary ? [{ summary, deadline: '2099-02-01T00:00:00Z', deadline_kind: '마감' }] : [];
        break;
      }
      case 'user_notice_judgments': {
        if (id && settings.infoGate) await settings.infoGate(owner);
        if (!id && columns === 'notice_id,deadline,deadline_kind' && settings.deadlinesGate) await settings.deadlinesGate;
        if (settings.unrelatedId && columns.includes('verdict') && (!id || id === settings.unrelatedId)) {
          result = [{ notice_id: settings.unrelatedId, verdict: 'not_relevant', reason: '내 조건에 맞지 않아요.', model: 'fixture' }];
        } else result = id && settings.judgmentOnly ? [{ verdict: 'maybe', reason: '판정 이유예요.', model: 'fixture' }] : [];
        break;
      }
      case 'user_notice_translations': {
        if (!id && settings.translationTitlesGate) await settings.translationTitlesGate;
        if (settings.english) result = [{ notice_id: sharedId, title: '장학금 신청 안내', body: '저장된 번역 본문이에요.', model: 'fixture' }];
        break;
      }
      case 'user_notice_graduation_assessments': {
        if (id && settings.graduationGate) await settings.graduationGate;
        if (id && settings.graduation) result = [{ status: 'READY', ai_status: 'used', department: { status: 'NOT_APPLICABLE' }, university_3p: { status: 'LIKELY', label: '인턴십 요건 근거예요.' } }];
        break;
      }
      case 'user_opportunities': {
        if (method === 'POST') {
          const previous = opportunities.get(arguments_.notice_id);
          if (!previous || !request.headers().prefer?.includes('ignore-duplicates')) {
            opportunities.set(arguments_.notice_id, { status: 'interested', ...previous, ...arguments_ });
          }
          result = request.headers().accept?.includes('vnd.pgrst.object') ? opportunities.get(arguments_.notice_id) : [];
          break;
        }
        if (settings.opportunityGate) await settings.opportunityGate;
        result = id ? [opportunities.get(id)].filter(Boolean) : [...opportunities.values()];
        break;
      }
      case 'user_notice_states': result = [...saved.values()]; break;
      case 'set_notice_saved': {
        if (arguments_.p_saved) saved.set(arguments_.p_notice_id, { notice_id: arguments_.p_notice_id, is_saved: true, read_at: null });
        else saved.delete(arguments_.p_notice_id);
        result = null;
        break;
      }
      case 'byok': {
        if (arguments_?.action === 'summarize') {
          const summary = '이번에 만든 요약이에요.';
          summaries.set(arguments_.noticeId, summary);
          result = { summary };
        }
        break;
      }
      case 'my_byok_backfill_count': case 'my_notice_save_counts': result = 0; break;
    }
    if (Array.isArray(result) && request.headers().accept?.includes('vnd.pgrst.object')) result = result[0] ?? null;
    return route.fulfill({ headers, json: result });
  });
  return { requests, settings, opportunities, subscriptions };
}
