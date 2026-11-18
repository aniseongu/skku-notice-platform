import { test, expect, type Page } from '@playwright/test';

type App = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

// 서버 없이 컨트롤러와 화면의 실제 연결을 본다. 저장 호출만 기록용으로 바꾼다.
async function setup(page: Page, patch: Record<string, unknown> = {}) {
  await page.goto('/?api=sample/api/v1');
  await page.locator('notice-rows-screen a.row').first().waitFor();
  await page.waitForLoadState('networkidle');
  await page.locator('notice-rows-screen a.row').nth(1).click();
  await page.evaluate((values) => {
    const app = document.querySelector('notice-app') as unknown as App;
    const w = window as unknown as { saves: unknown[] };
    w.saves = [];
    app.profileStatus = 'unavailable'; app.authUserId = 'account-a'; app.onboardingDismissed = true;
    app.opportunitiesStatus = 'ready'; app.subscriptions = app.sources.map((s: { id: string }) => s.id); app.subscriptionsLoading = false;
    app.saveOpportunityFor = async (notice: { id: string }, source: string, p: Record<string, unknown>) => {
      w.saves.push({ id: notice.id, source, ...p });
      const old = app.opportunities.get(notice.id);
      app.opportunities = new Map(app.opportunities).set(notice.id, { notice_id: notice.id, title: 't', url: null, board: null, deadline: null, status: 'interested', note: null, created_at: '', updated_at: '', ...old, ...p });
    };
    for (const [key, value] of Object.entries(values)) app[key] = value;
  }, patch);
}
const saves = (page: Page) => page.evaluate(() => (window as unknown as { saves: Record<string, unknown>[] }).saves);

test('saved notice: one tap sets the status, keys move it, the memo saves on blur', async ({ page }) => {
  await setup(page);
  const section = page.getByRole('region', { name: '내 진행 상태' });
  await expect(section).toHaveCount(0);                                    // 저장하기 전에는 없다
  await page.getByRole('button', { name: '저장하기' }).click();
  await expect(section).toBeVisible();
  expect(await saves(page)).toEqual([expect.objectContaining({ status: 'interested' })]);   // 저장하면 입력 없이 관심으로 기록된다
  await expect(section.getByRole('radio', { name: '관심' })).toHaveAttribute('aria-checked', 'true');
  await expect(section.getByRole('textbox', { name: '메모' })).toHaveCount(0);   // 메모는 접혀 있다
  const prepare = section.getByRole('radio', { name: '준비 중' });
  const box = await prepare.boundingBox();
  expect(box!.height).toBeGreaterThanOrEqual(44);
  await prepare.click();                                                    // 저장한 공지에서 상태 바꾸기: 1탭
  await expect(prepare).toHaveAttribute('aria-checked', 'true');
  expect((await saves(page)).map((s) => s.status)).toEqual(['interested', 'preparing']);
  await prepare.press('ArrowRight');
  await expect(section.getByRole('radio', { name: '지원함' })).toHaveAttribute('aria-checked', 'true');
  await section.getByRole('button', { name: '메모 추가' }).click();
  const memo = section.getByRole('textbox', { name: '메모' });
  await expect(memo).toBeFocused();
  await memo.fill('서류 준비');
  await memo.press('Enter');
  expect((await saves(page)).at(-1)).toMatchObject({ note: '서류 준비' });
  await expect(section).not.toContainText('합격');
  await expect(section).not.toContainText('인증');
  // 저장을 지워도 기록은 남고 구역도 남는다.
  await page.getByRole('button', { name: '저장 지우기' }).click();
  await expect(section).toBeVisible();
  await section.getByRole('button', { name: '기록 지우기' }).click();
  await expect(section.getByText('기록을 지울까요?')).toBeVisible();
});

test('saved view filters by status and shows it in the row; unavailable table hides everything', async ({ page }) => {
  await setup(page);
  await page.getByRole('button', { name: '저장하기' }).click();
  await page.getByRole('radio', { name: '지원함' }).click();
  await page.evaluate(() => { const app = document.querySelector('notice-app') as unknown as App; app.detailOpen = false; app.selectedId = null; app.openedId = null; app.setView('saved'); });
  const filter = page.getByRole('group', { name: '진행 상태로 거르기' });
  await expect(filter).toBeVisible();
  await expect(page.locator('notice-rows-screen a.row')).toHaveCount(1);
  await expect(page.locator('notice-rows-screen a.row .cat')).toContainText('지원함');
  await filter.getByRole('button', { name: '준비 중' }).click();
  await expect(page.locator('notice-rows-screen a.row')).toHaveCount(0);
  await expect(page.getByText('이 상태의 공지가 없어요')).toBeVisible();
  await page.getByRole('button', { name: '전체 보기' }).click();
  await expect(page.locator('notice-rows-screen a.row')).toHaveCount(1);
  await page.evaluate(() => { (document.querySelector('notice-app') as unknown as App).opportunitiesStatus = 'unavailable'; });
  await expect(filter).toHaveCount(0);
  await page.locator('notice-rows-screen a.row').first().click();
  await expect(page.getByRole('region', { name: '내 진행 상태' })).toHaveCount(0);
});
