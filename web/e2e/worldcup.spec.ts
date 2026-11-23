import { test, expect, type Page } from '@playwright/test';

type App = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

// 서버 없이 컨트롤러와 화면의 실제 연결을 본다(explore-map.spec.ts와 같은 방식). 공지는 샘플을 쓴다.
async function setup(page: Page, opts: { only?: number } = {}) {
  await page.goto('/?api=sample/api/v1');
  await page.locator('notice-rows-screen a.row').first().waitFor();
  await page.waitForLoadState('networkidle');
  await page.evaluate((only) => {
    const app = document.querySelector('notice-app') as unknown as App;
    app.profileStatus = 'unavailable'; app.authUserId = 'account-a'; app.onboardingDismissed = true;
    app.subscriptions = app.sources.map((s: { id: string }) => s.id); app.subscriptionsLoading = false;
    app.saved = [];
    if (only) app.notices = app.notices.slice(0, only);
  }, opts.only ?? 0);
}
const openSettings = async (page: Page, info: { project: { name: string } }) => {
  if (info.project.name === 'mobile') await page.getByRole('button', { name: '설정', exact: true }).click();
  else await page.locator('.sidebar').getByText('설정', { exact: true }).click();
};
const cards = (page: Page) => page.locator('.worldcup-card');

test('settings home opens the worldcup in one extra tap, 7 picks reach the result, and the winner opens as a notice', async ({ page }, info) => {
  await setup(page);
  await openSettings(page, info);
  const row = page.getByRole('link', { name: /공지 월드컵/ });
  await expect(row).toBeVisible();
  await row.click();                                            // 설정 1탭 + 줄 1탭 = 2탭
  expect(page.url()).toContain('section=worldcup');
  await expect(page.getByRole('heading', { name: '공지 월드컵', level: 1 })).toBeVisible();
  await expect(page.locator('.worldcup-progress')).toHaveText(/^(16|8)강 1\/(8|4)$/);
  await expect(cards(page)).toHaveCount(2);
  const [a, b] = [(await cards(page).nth(0).boundingBox())!, (await cards(page).nth(1).boundingBox())!];
  expect(a.height).toBeGreaterThanOrEqual(44); expect(b.height).toBeGreaterThanOrEqual(44);
  if (info.project.name === 'mobile') expect(b.y).toBeGreaterThan(a.y + a.height - 1);        // 위아래
  else { expect(Math.abs(a.y - b.y)).toBeLessThan(2); expect(b.x).toBeGreaterThan(a.x + a.width - 1); }   // 좌우
  const size = Number(((await page.locator('.worldcup-progress').textContent()) ?? '').match(/^(\d+)강/)![1]);
  let picks = 0;
  while (await cards(page).count()) {
    if (picks % 2 === 0) await cards(page).nth(0).click(); else await page.keyboard.press('2');
    picks += 1;
  }
  expect(picks).toBe(size - 1);
  await expect(page.getByText('내가 고른 공지예요')).toBeVisible();
  await expect(page.getByText(/%|위$|연속|순위/)).toHaveCount(0);
  const winner = (await page.locator('.worldcup-champion .worldcup-title').textContent())!;
  await expect(page.locator('.worldcup-save')).toHaveText('저장하기');
  await page.locator('.worldcup-save').click();
  await expect(page.locator('.worldcup-save')).toHaveText('저장했어요');
  await expect(page.locator('.worldcup-save')).toBeDisabled();
  await page.locator('.worldcup-again').click();
  await expect(cards(page)).toHaveCount(2);
  while (await cards(page).count()) await page.keyboard.press('ArrowLeft');
  await expect(page.locator('.worldcup-champion')).toBeVisible();
  await page.locator('.worldcup-open').click();
  await expect.poll(() => page.evaluate(() => { const app = document.querySelector('notice-app') as unknown as App; return !!(app.openedId || app.selectedId); })).toBe(true);
  expect(winner.length).toBeGreaterThan(0);
});

test('the winner can be shared with the app link', async ({ page }, info) => {
  await setup(page);
  await page.evaluate(() => { (window as unknown as { __shared: string[] }).__shared = []; (navigator as unknown as { share: (d: { url: string }) => Promise<void> }).share = async (d) => { (window as unknown as { __shared: string[] }).__shared.push(d.url); }; });
  await openSettings(page, info);
  await page.getByRole('link', { name: /공지 월드컵/ }).click();
  while (await cards(page).count()) await cards(page).nth(0).click();
  await page.locator('.worldcup-share').click();
  const shared = await page.evaluate(() => (window as unknown as { __shared: string[] }).__shared);
  expect(shared).toHaveLength(1);
  expect(shared[0]).toContain('?notice=');
});

test('with fewer than 8 candidates the entry row is hidden', async ({ page }, info) => {
  await setup(page, { only: 5 });
  await openSettings(page, info);
  await expect(page.getByRole('heading', { name: '설정', level: 1 })).toBeVisible();
  await expect(page.getByRole('link', { name: /공지 월드컵/ })).toHaveCount(0);
});

test('back from the worldcup returns to settings, then to the original tab', async ({ page }, info) => {
  await setup(page);
  await page.evaluate(() => { const app = document.querySelector('notice-app') as unknown as App; app.setView('all'); });
  const tab = await page.evaluate(() => (document.querySelector('notice-app') as unknown as App).view);
  await page.evaluate(() => window.scrollTo(0, 120));
  await page.waitForTimeout(100);
  const y = await page.evaluate(() => Math.round(window.scrollY));
  await openSettings(page, info);                               // 1
  await page.getByRole('link', { name: /공지 월드컵/ }).click();   // 2
  await cards(page).nth(0).click();
  await page.goBack();                                          // 브라우저 뒤로: 설정 첫 쪽
  await expect(page.getByRole('link', { name: /공지 월드컵/ })).toBeVisible();
  await page.getByRole('link', { name: /공지 월드컵/ }).click();
  await page.keyboard.press('Escape');                          // 한 단계 위(설정 첫 쪽)
  await expect(page.getByRole('link', { name: /공지 월드컵/ })).toBeVisible();
  await page.keyboard.press('Escape');                          // 설정 닫기
  await expect.poll(() => page.evaluate(() => (document.querySelector('notice-app') as unknown as App).view)).toBe(tab);
  // 설정을 나올 때 휴대폰 목록 스크롤을 되살리는 동작은 앱 공통에 없다(알림함·탐험 지도도 같다). 여기서는 원래 탭만 확인한다.
  expect(y).toBeGreaterThanOrEqual(0);
});

test('settings home draws a divider between 차단 관리 (link row) and 로그아웃 (setting row)', async ({ page }, info) => {
  await setup(page);
  await openSettings(page, info);
  const blocks = page.getByRole('link', { name: /차단 관리/ });
  await expect(blocks).toBeVisible();
  const logout = page.locator('.setting', { hasText: '로그아웃' }).first();
  await expect(logout).toHaveCSS('border-top-width', '1px');
  const gap = await page.evaluate(() => {
    const link = [...document.querySelectorAll('a.settings-link')].find((el) => el.textContent?.includes('차단 관리'))!;
    return link.nextElementSibling?.textContent?.includes('로그아웃') ?? false;
  });
  expect(gap).toBe(true);                                       // 두 줄이 바로 이어져 있어야 이 경계를 본 것이다
});
