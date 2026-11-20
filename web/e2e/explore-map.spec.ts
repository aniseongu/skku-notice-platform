import { test, expect, type Page } from '@playwright/test';

type App = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

// 서버 없이 컨트롤러와 화면의 실제 연결을 본다(opportunity.spec.ts와 같은 방식). 기록은 모의 상태로 넣는다.
async function setup(page: Page, records: { id: string; title: string; status: string }[]) {
  await page.goto('/?api=sample/api/v1');
  await page.locator('notice-rows-screen a.row').first().waitFor();
  await page.waitForLoadState('networkidle');
  await page.evaluate((records) => {
    const app = document.querySelector('notice-app') as unknown as App;
    app.profileStatus = 'unavailable'; app.authUserId = 'account-a'; app.onboardingDismissed = true;
    app.opportunitiesStatus = 'ready'; app.subscriptions = app.sources.map((s: { id: string }) => s.id); app.subscriptionsLoading = false;
    app.saved = [];
    app.opportunities = new Map(records.map((r) => [r.id, { notice_id: r.id, title: r.title, url: null, board: null, deadline: null, status: r.status, note: null, created_at: '', updated_at: '' }]));
    app.detailOpen = false; app.selectedId = null; app.openedId = null; app.setView('saved');
  }, records);
}
const entry = (page: Page) => page.getByRole('button', { name: /^기록한 활동 \d+개/ });

test('saved screen shows the entry line, one tap opens the map with counts, back returns to the saved screen', async ({ page }) => {
  await setup(page, [
    { id: 'x1', title: '하계 인턴 채용', status: 'interested' }, { id: 'x2', title: '신입 채용 공고', status: 'applied' },
    { id: 'x3', title: '국가장학금 신청', status: 'preparing' }, { id: 'x4', title: '도서관 이용 안내', status: 'result' },
  ]);
  await expect(entry(page)).toBeVisible();
  await expect(entry(page)).toContainText('기록한 활동 4개');
  expect((await entry(page).boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await entry(page).click();                                              // 진입: 1탭
  expect(page.url()).toContain('section=explore');
  await expect(page.getByRole('heading', { name: '탐험 지도', level: 1 })).toBeVisible();
  await expect(page.locator('.explore-total')).toHaveText('기록한 활동 4개');
  const cards = page.locator('.explore-card');
  await expect(cards).toHaveCount(6);                                      // 영역은 항상 여섯 개
  const career = cards.filter({ hasText: '취업·인턴' });
  await expect(career.locator('.explore-count')).toHaveText('2개');
  await expect(career.locator('.explore-status')).toHaveText('관심 1 · 지원 1');
  await expect(cards.filter({ hasText: '장학금' }).locator('.explore-status')).toHaveText('준비 1');
  const locked = cards.filter({ hasText: '교환학생' });                   // 기록 없는 영역은 잠긴 모양과 찾는 방법
  await expect(locked).toHaveAttribute('data-open', 'false');
  await expect(locked).toContainText('아직 기록이 없어요');
  await expect(locked).toContainText('교환학생 공지 게시판에서 찾아볼 수 있어요');
  await expect(page.locator('.explore-other')).toHaveText('그 밖 1개 · 결과 1');
  await expect(page.locator('body')).not.toContainText('%');             // 퍼센트·점수는 없다
  await page.goBack();                                                     // 뒤로 가기로 저장 화면
  await expect(entry(page)).toBeVisible();
  await expect(page.locator('.explore-card')).toHaveCount(0);
});

test('with no records the entry line is not shown', async ({ page }) => {
  await setup(page, []);
  await expect(entry(page)).toHaveCount(0);
  await expect(page.getByText('탐험 지도')).toHaveCount(0);
});

test('saved notices without a record count as "관심" and the same notice is counted once', async ({ page }) => {
  await setup(page, []);
  await page.evaluate(() => {
    const app = document.querySelector('notice-app') as unknown as App;
    const picked = app.notices.filter((n: { deadline: string | null }) => !n.deadline).slice(0, 2);
    app.saved = picked.map((n: Record<string, unknown>, i: number) => { const { first_seen: _f, ...rest } = n; return { ...rest, saved_at: `2026-11-0${i + 1}T00:00:00.000Z` }; });
    app.opportunities = new Map([[picked[0].id, { notice_id: picked[0].id, title: picked[0].title, url: null, board: null, deadline: null, status: 'applied', note: null, created_at: '', updated_at: '' }]]);
  });
  await expect(entry(page)).toContainText('기록한 활동 2개');
});

test('the map page stays within the viewport and cards are a grid on desktop', async ({ page }, info) => {
  await setup(page, [{ id: 'x1', title: '교환학생 파견 안내', status: 'interested' }]);
  await entry(page).click();
  await expect(page.locator('.explore-card')).toHaveCount(6);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  const boxes = await page.locator('.explore-card').evaluateAll((els) => els.map((el) => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, h: r.height }; }));
  expect(boxes[0].h).toBeGreaterThanOrEqual(88);
  if (info.project.name === 'desktop') expect(boxes[1].y).toBe(boxes[0].y); else expect(boxes[1].y).toBeGreaterThan(boxes[0].y);
});
