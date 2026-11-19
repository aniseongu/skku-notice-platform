import { test, expect, type Page } from '@playwright/test';

// 로그인 모의: test-user가 localStorage에 있으면 로그인 상태, 없으면 비로그인. get_public_notice는 skku-notice01/777만 돌려준다.
async function mockAuth(page: Page, user: string | null, long = false, fresh = false) {
  await page.route('**/src/auth.ts*', (route) => route.fulfill({ contentType: 'application/javascript', body: `
    const session = () => localStorage.getItem('test-user') ? { user: { id: localStorage.getItem('test-user'), user_metadata: {} } } : null;
    const query = (table) => {
      const result = () => table === 'user_profiles' ? {data: null, error: ${fresh} ? null : {message: 'unavailable'}} : table === 'user_source_subscriptions' ? {data: [{source_id: 'skku-notice01'}], error: null} : {data: [], error: null};
      const q = new Proxy({}, { get(_, prop) { if (prop === 'then') return (resolve) => resolve(result()); if (prop === 'maybeSingle' || prop === 'single') return () => Promise.resolve(result()); return () => q; } });
      return q;
    };
    const row = { id: 'skku-notice01/777', source_id: 'skku-notice01', source_name: '성대 공지', external: false, title: '공유받은 장학 안내', category: '장학', url: 'https://www.skku.edu/a', posted_on: '2026-11-18', deadline: null, body: '공유 본문입니다', body_html: '<p>공유 본문입니다</p>' };
    if (${long}) row.body_html = Array.from({ length: 40 }, (_, i) => '<p>긴 본문 ' + i + '번째 줄이에요</p>').join('') + '<p>마지막 줄이에요</p>';
    window.__rpc = []; window.__oauth = [];
    export const authClient = { auth: {
      onAuthStateChange(cb) { setTimeout(() => cb('INITIAL_SESSION', session()), 0); return {data: {subscription: {unsubscribe() {}}}}; },
      getSession: async () => ({data: {session: session()}}),
      signInWithOAuth: async (args) => { window.__oauth.push(args); return {error: null}; },
      signOut: async () => ({error: null}) },
      from: query, rpc: async (name, args) => { window.__rpc.push([name, args]); return {data: args.p_id === row.id ? [row] : [], error: null}; }, functions: {invoke: async () => ({data: null, error: null})} };
  ` }));
  await page.addInitScript((f) => { (window as unknown as { __fresh: boolean }).__fresh = f; }, fresh);
  await page.addInitScript((u) => {
    if (u) { localStorage.setItem('test-user', u); if (!window.__fresh) localStorage.setItem(`platform:onboarded:${u}`, '1'); } else localStorage.removeItem('test-user');
  }, user);
}
const open = (page: Page, search: string) => page.goto(`/?api=sample/api/v1${search}`);
const login = (page: Page) => page.getByRole('button', { name: 'Google로 계속하기' });
const signIn = (page: Page) => page.getByRole('button', { name: 'Google로 로그인' });

test('without ?notice= a signed-out visitor sees the login screen and the preview code never runs', async ({ page }) => {
  await mockAuth(page, null);
  await open(page, '');
  await expect(login(page)).toBeVisible();
  await expect(page.getByRole('region', { name: '로그인 안내' })).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as { __rpc: unknown[] }).__rpc)).toEqual([]);
});

test('with ?notice= a signed-out visitor sees only that notice and the login sheet, with no way to the list', async ({ page }) => {
  await mockAuth(page, null);
  await open(page, '&notice=skku-notice01%2F777');
  const sheet = page.getByRole('region', { name: '로그인 안내' });
  await expect(page.getByRole('heading', { name: '공유받은 장학 안내' })).toBeVisible();
  await expect(page.getByText('공유 본문입니다')).toBeVisible();
  await expect(sheet).toBeVisible();
  await expect(sheet).toContainText('공지를 저장하고 마감 알림을 받아요');
  expect(await page.evaluate(() => (window as unknown as { __rpc: unknown[] }).__rpc)).toEqual([['get_public_notice', { p_id: 'skku-notice01/777' }]]);
  // 목록·탭·설정으로 가는 길이 없다
  await expect(page.locator('notice-rows-screen')).toHaveCount(0);
  await expect(page.getByRole('navigation')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /설정/ })).toHaveCount(0);
  // 시트를 닫아도 그 공지만 보인다. 낮은 로그인 줄이 남고, 저장을 누르면 다시 올라온다.
  await sheet.getByRole('button', { name: '닫기' }).click();
  await expect(sheet).toHaveCount(0);
  await expect(page.getByRole('heading', { name: '공유받은 장학 안내' })).toBeVisible();
  await expect(page.locator('.login-bar').getByRole('button', { name: 'Google로 로그인' })).toBeVisible();
  await page.getByRole('button', { name: '저장하기' }).click();
  await expect(sheet).toBeVisible();
  // 큰 단추 하나로 로그인하고, 복귀 주소에 notice가 남는다
  await expect(signIn(page)).toHaveCount(1);
  await signIn(page).click();
  const oauth = await page.evaluate(() => (window as unknown as { __oauth: { options: { redirectTo: string } }[] }).__oauth);
  expect(new URL(oauth[0].options.redirectTo).searchParams.get('notice')).toBe('skku-notice01/777');
});

test('a malformed id falls back to the plain login screen without any request', async ({ page }) => {
  await mockAuth(page, null);
  await open(page, '&notice=not-an-id');
  await expect(login(page)).toBeVisible();
  await expect(page.getByRole('region', { name: '로그인 안내' })).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as { __rpc: unknown[] }).__rpc)).toEqual([]);
});

test('a well-formed id that does not exist shows the login screen with a one-line note', async ({ page }) => {
  await mockAuth(page, null);
  await open(page, '&notice=skku-notice01%2F999');
  await expect(login(page)).toBeVisible();
  await expect(page.getByText('공유받은 공지를 찾지 못했어요')).toBeVisible();
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
  await expect(page.locator('notice-rows-screen a.row').first()).toBeVisible();
  await expect(page.locator('.toast')).toContainText('공지를 찾지 못했어요');
});

test('the sheet never covers the last line of a long notice, and on a wide screen it lines up with the text column', async ({ page }) => {
  await mockAuth(page, null, true);
  await open(page, '&notice=skku-notice01%2F777');
  const sheet = page.getByRole('region', { name: '로그인 안내' });
  await expect(sheet).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  const last = await page.getByText('마지막 줄이에요').boundingBox();
  const card = await sheet.boundingBox();
  expect(last!.y + last!.height).toBeLessThanOrEqual(card!.y);
  if (page.viewportSize()!.width >= 1080) {
    const text = await page.getByText('긴 본문 0번째 줄이에요').boundingBox();
    const open = await page.getByRole('link', { name: '원문 열기' }).boundingBox();
    expect(Math.abs(open!.x - text!.x)).toBeLessThanOrEqual(1);
    const button = await sheet.getByRole('button', { name: 'Google로 로그인' }).boundingBox();
    expect(Math.abs(button!.x - text!.x)).toBeLessThanOrEqual(1);   // 바 안의 내용이 본문 왼쪽 선과 맞는다
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
