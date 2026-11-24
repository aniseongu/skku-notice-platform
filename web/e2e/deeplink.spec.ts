import { test, expect, type Page } from '@playwright/test';

// 로그인 모의: test-user가 localStorage에 있으면 로그인 상태, 없으면 비로그인. get_public_notice는 skku-notice01/777만 돌려준다.
async function mockAuth(page: Page, user: string | null, long = false, fresh = false, external = false) {
  await page.route('**/src/auth.ts*', (route) => route.fulfill({ contentType: 'application/javascript', body: `
    const session = () => localStorage.getItem('test-user') ? { user: { id: localStorage.getItem('test-user'), user_metadata: {} } } : null;
    const query = (table) => {
      const result = () => table === 'user_profiles' ? {data: null, error: ${fresh} ? null : {message: 'unavailable'}} : table === 'user_source_subscriptions' ? {data: [{source_id: 'skku-notice01'}], error: null} : {data: [], error: null};
      const q = new Proxy({}, { get(_, prop) { if (prop === 'then') return (resolve) => resolve(result()); if (prop === 'maybeSingle' || prop === 'single') return () => Promise.resolve(result()); return () => q; } });
      return q;
    };
    const row = { id: 'skku-notice01/777', source_id: 'skku-notice01', source_name: ${external ? "'외부 게시판'" : "'성대 공지'"}, external: ${external}, title: '공유받은 장학 안내', category: '장학', url: 'https://www.skku.edu/a', posted_on: '2026-11-18', deadline: null, body: '공유 본문입니다', body_html: '<p>공유 본문입니다</p>' };
    if (${long}) row.body_html = Array.from({ length: 40 }, (_, i) => '<p>긴 본문 ' + i + '번째 줄이에요</p>').join('') + '<p>마지막 줄이에요</p>';
    window.__rpc = []; window.__oauth = []; window.__byokChecks = 0;
    export const authClient = { auth: {
      onAuthStateChange(cb) {
        setTimeout(() => cb('INITIAL_SESSION', session()), 0);
        window.__completeOAuth = () => {
          localStorage.setItem('test-user', 'a');
          localStorage.setItem('platform:onboarded:a', '1');
          cb('SIGNED_IN', session());
        };
        return {data: {subscription: {unsubscribe() {}}}};
      },
      getSession: async () => ({data: {session: session()}}),
      signInWithOAuth: async (args) => { window.__oauth.push(args); return {error: null}; },
      signOut: async () => ({error: null}) },
      from: query, rpc: async (name, args) => { window.__rpc.push([name, args]); return {data: args.p_id === row.id ? [row] : [], error: null}; }, functions: {invoke: async () => ({data: null, error: null})} };
  ` }));
  await page.route(/\/src\/byok\.ts$/, (route) => route.fulfill({ contentType: 'text/javascript', body: `
    export * from '/src/byok.ts?fixture';
    export const checkByokAvailability = async () => { window.__byokChecks++; return null; };
  ` }));
  await page.addInitScript((f) => { (window as unknown as { __fresh: boolean }).__fresh = f; }, fresh);
  await page.addInitScript((u) => {
    if (u) { localStorage.setItem('test-user', u); if (!window.__fresh) localStorage.setItem(`platform:onboarded:${u}`, '1'); } else localStorage.removeItem('test-user');
  }, user);
}
const open = (page: Page, search: string) => page.goto(`/?api=sample/api/v1${search}`);
const login = (page: Page) => page.getByRole('button', { name: 'Google로 계속하기' });
const signIn = login;

test('without ?notice= a signed-out visitor sees the login screen and the preview code never runs', async ({ page }) => {
  await mockAuth(page, null);
  await open(page, '');
  await expect(login(page)).toBeVisible();
  await expect(page.getByRole('region', { name: '로그인 안내' })).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as { __rpc: unknown[] }).__rpc)).toEqual([]);
});

test('the shared body is public and OAuth returns to that same notice', async ({ page }) => {
  await mockAuth(page, null);
  await open(page, '&notice=skku-notice01%2F777');
  const panel = page.getByRole('region', { name: '로그인 안내' });
  await expect(page.getByRole('heading', { name: '공유받은 장학 안내' })).toBeVisible();
  await expect(page.getByText('공유 본문입니다')).toBeVisible();
  await expect(panel).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { __rpc: unknown[] }).__rpc)).toEqual([['get_public_notice', { p_id: 'skku-notice01/777' }]]);
  expect(await page.evaluate(() => (window as unknown as { __byokChecks: number }).__byokChecks)).toBe(0);
  await expect(page.locator('notice-rows-screen')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /설정/ })).toHaveCount(0);
  await signIn(page).click();
  const oauth = await page.evaluate(() => (window as unknown as { __oauth: { options: { redirectTo: string } }[] }).__oauth);
  expect(new URL(oauth[0].options.redirectTo).searchParams.get('notice')).toBe('skku-notice01/777');
  await page.evaluate(() => (window as unknown as { __completeOAuth(): void }).__completeOAuth());
  await expect(panel).toHaveCount(0);
  await expect(page.getByRole('heading', { name: '공유받은 장학 안내' })).toBeVisible();
  await expect(page.getByRole('button', { name: '저장하기' })).toBeVisible();
  expect(new URL(page.url()).searchParams.has('notice')).toBe(false);
});

test('a malformed id falls back to the plain login screen without any request', async ({ page }) => {
  await mockAuth(page, null);
  await open(page, '&notice=not-an-id');
  await expect(login(page)).toBeVisible();
  await expect(page.getByRole('region', { name: '로그인 안내' })).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as { __rpc: unknown[] }).__rpc)).toEqual([]);
});

test('a missing signed-out notice opens Empty and returns to the normal login screen', async ({ page }) => {
  await mockAuth(page, null);
  await open(page, '&notice=skku-notice01%2F999');
  await expect(page.getByRole('heading', { name: '공지를 찾을 수 없어요' })).toBeVisible();
  await expect(page.getByRole('region', { name: '로그인 안내' })).toBeVisible();
  await page.getByRole('button', { name: '로그인하고 다른 공지 보기' }).click();
  await expect(login(page)).toBeVisible();
  await expect(page.locator('.notice-preview')).toHaveCount(0);
});

test('a signed-in user opens the shared notice directly: in the list, and when it is not in the list', async ({ page }, testInfo) => {
  await mockAuth(page, 'a');
  await open(page, '&notice=skku-notice01%2F141494');
  const title = page.getByRole('heading', { name: /배워서 남 주는 프로젝트 성과공유회/ });
  await expect(title.first()).toBeVisible();
  await expect(page.getByRole('region', { name: '로그인 안내' })).toHaveCount(0);
  expect(await page.evaluate(() => location.search)).not.toContain('notice=');   // 주소는 정리된다
  if (testInfo.project.name === 'mobile') {   // 뒤로 가기는 목록으로
    await page.getByRole('button', { name: '목록으로' }).click();
    await expect(page.locator('notice-rows-screen a.row').first()).toBeVisible();
  }
  await page.goto('about:blank');
  await open(page, '&notice=skku-notice01%2F777');
  await expect(page.getByRole('heading', { name: '공유받은 장학 안내' }).first()).toBeVisible();
  await expect(page.getByText('공유 본문입니다')).toBeVisible();
});

test('a signed-in user sees a note, not a crash, when the shared notice is gone', async ({ page }) => {
  await mockAuth(page, 'a');
  await open(page, '&notice=skku-notice01%2F999');
  await expect(page.getByRole('heading', { name: '공지를 찾을 수 없어요' })).toBeVisible();
  await page.getByRole('button', { name: '목록으로 돌아가기' }).click();
  await expect(page.locator('notice-rows-screen a.row').first()).toBeVisible();
});

test('a push link opens the notice while the full feed is still blocked', async ({ page }) => {
  await mockAuth(page, 'a', false, false, true);
  let release = () => {};
  const blocked = new Promise<void>((resolve) => { release = resolve; });
  await page.route('**/sample/api/v1/notices.json', async (route) => {
    await blocked;
    await route.continue();
  });
  try {
    await open(page, '&notice=skku-notice01%2F777&push=1');
    await expect(page.getByRole('heading', { name: '공유받은 장학 안내' }).first()).toBeVisible();
    await expect(page.getByText('공유 본문입니다')).toBeVisible();
    await expect(page.getByText('외부 게시판', { exact: true })).toBeVisible();
    expect(new URL(page.url()).searchParams.has('push')).toBe(false);
    expect(await page.evaluate(() => {
      const app = document.querySelector('notice-app') as unknown as { loading: boolean; deepNotice: { notice: unknown }; kindOf(notice: unknown): string };
      return { loading: app.loading, kind: app.kindOf(app.deepNotice.notice) };
    })).toEqual({ loading: true, kind: 'intern' });
  } finally { release(); }
});

test('a missing push notice reports the result even when the feed never returns', async ({ page }) => {
  await mockAuth(page, 'a');
  let release = () => {};
  const blocked = new Promise<void>((resolve) => { release = resolve; });
  await page.route('**/sample/api/v1/notices.json', async (route) => {
    await blocked;
    await route.continue();
  });
  try {
    await open(page, '&notice=skku-notice01%2F999&push=1');
    await expect(page.getByRole('heading', { name: '공지를 찾을 수 없어요' })).toBeVisible();
    expect(new URL(page.url()).searchParams.has('notice')).toBe(false);
  } finally { release(); }
});

test('the service worker hands an open tab the notice without reloading the page', async ({ page, context }, testInfo) => {
  await mockAuth(page, 'a');
  await open(page, '');
  const workerReady = context.waitForEvent('serviceworker');
  await page.evaluate(() => navigator.serviceWorker.register('/push-handler.js').then(() => navigator.serviceWorker.ready).then(() => true));
  const worker = await workerReady;
  await page.reload();
  await page.locator('notice-rows-screen a.row').first().waitFor();
  if (testInfo.project.name === 'desktop') {
    await page.getByRole('button', { name: '설정', exact: true }).click();
    await expect(page.getByRole('heading', { name: '내 설정' })).toBeVisible();
  }
  expect(await page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  const before = await page.evaluate(() => performance.timeOrigin);
  const accepted = await worker.evaluate(async () => {
    const scope = globalThis as unknown as {
      clients: { matchAll(options: { type: string }): Promise<unknown[]> };
      openInApp(client: unknown, id: string): Promise<boolean>;
    };
    const [tab] = await scope.clients.matchAll({ type: 'window' });
    return scope.openInApp(tab, 'skku-notice01/777');
  });
  expect(accepted).toBe(true);
  await expect(page.getByRole('heading', { name: '공유받은 장학 안내' }).first()).toBeVisible();
  expect(await page.evaluate(() => performance.timeOrigin)).toBe(before);
  if (testInfo.project.name === 'mobile') {
    await page.getByRole('button', { name: '목록으로' }).click();
    await expect(page.locator('notice-rows-screen a.row').first()).toBeVisible();
  }
});

test('the final public body line can scroll into view without the signup area covering it', async ({ page }) => {
  await mockAuth(page, null, true);
  await open(page, '&notice=skku-notice01%2F777');
  const panel = page.getByRole('region', { name: '로그인 안내' });
  await expect(panel).toBeVisible();
  const last = page.getByText('마지막 줄이에요');
  await last.scrollIntoViewIfNeeded();
  const body = (await last.boundingBox())!;
  const signup = (await panel.boundingBox())!;
  if (page.viewportSize()!.width >= 720) {
    expect(body.x).toBeGreaterThanOrEqual(signup.x + signup.width);
    await expect(page.locator('.login-sheet')).toHaveCount(0);
  } else {
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    const final = (await last.boundingBox())!;
    expect(final.y + final.height).toBeLessThanOrEqual(signup.y);
  }
});

test('a brand-new account finishes first setup before the shared notice opens (nothing is opened or marked read meanwhile)', async ({ page }) => {
  await mockAuth(page, 'new', false, true);
  await open(page, '&notice=skku-notice01%2F141494');
  await expect(page.getByRole('heading', { name: '필요한 설정을 알려 주세요' }).or(page.locator('.onb').first())).toBeVisible({ timeout: 10000 });
  const state = () => page.evaluate(() => { const app = document.querySelector('notice-app') as unknown as Record<string, any>; return { deep: app.deepId, opened: app.openedId, selected: app.selectedId, detail: app.detailOpen, read: app.read ? [...app.read].length : 0 }; }); // eslint-disable-line @typescript-eslint/no-explicit-any
  const waiting = await state();
  expect(waiting.deep).toBe('skku-notice01/141494');   // 보존된다
  expect(waiting.opened).toBeNull();
  expect(waiting.selected === null || waiting.detail === false || waiting.selected !== 'skku-notice01/141494').toBeTruthy();
  expect(await page.evaluate(() => location.search)).toContain('notice=');
  // 첫 설정을 마친(건너뛴) 것으로 두면 그때 열린다
  await page.evaluate(() => { const app = document.querySelector('notice-app') as unknown as Record<string, any>; app.onboardingOpen = false; app.onboardingDismissed = true; app.profileStatus = 'unavailable'; }); // eslint-disable-line @typescript-eslint/no-explicit-any
  await expect.poll(async () => (await state()).deep).toBeNull();
  await expect(page.getByRole('heading', { name: /배워서 남 주는 프로젝트 성과공유회/ }).first()).toBeVisible();
});

test('a push link opens a notice the worker already prefetched, without waiting for the server', async ({ page }) => {
  await mockAuth(page, 'a');
  await open(page, '');
  await page.evaluate(() => new Promise<void>((resolve, reject) => {
    const request = indexedDB.open('keyval-store');
    request.onupgradeneeded = () => request.result.createObjectStore('keyval');
    request.onsuccess = () => {
      const tx = request.result.transaction('keyval', 'readwrite');
      tx.objectStore('keyval').put({ items: { 'skku-notice01/777': { at: Date.now(), row: {
        id: 'skku-notice01/777', source_id: 'skku-notice01', source_name: '성대 공지', external: false, title: '미리 받아 둔 공지', category: '장학',
        url: 'https://www.skku.edu/a', posted_on: '2026-11-18', deadline: null, body: '미리 받은 본문', body_html: '<p>미리 받은 본문</p>' } } } }, 'notice-prefetch:v1');
      tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error);
    };
  }));
  await open(page, '&notice=skku-notice01%2F777&push=1');
  await expect(page.getByRole('heading', { name: '미리 받아 둔 공지' }).first()).toBeVisible();
});
