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
    app.controller.exploreSavedStatus = 'ready';
    app.saved = [];
    app.opportunities = new Map(records.map((r) => [r.id, { notice_id: r.id, title: r.title, url: null, board: null, deadline: null, status: r.status, note: null, created_at: '', updated_at: '' }]));
    app.detailOpen = false; app.selectedId = null; app.openedId = null; app.setView('saved');
  }, records);
}
const entry = (page: Page) => page.getByRole('button', { name: /^탐험 지도/ });
const recordedAreas = (page: Page) => page.getByRole('list', { name: '영역별 기록' }).getByRole('listitem');
const emptyAreas = (page: Page) => page.getByRole('region', { name: '아직 기록이 없는 영역' }).getByRole('listitem');

test('saved screen shows the header button, one tap opens the map with counts, back returns to the saved screen', async ({ page }, info) => {
  await setup(page, [
    { id: 'x1', title: '하계 인턴 채용', status: 'interested' }, { id: 'x2', title: '신입 채용 공고', status: 'applied' },
    { id: 'x3', title: '국가장학금 신청', status: 'preparing' }, { id: 'x4', title: '도서관 이용 안내', status: 'result' },
  ]);
  await expect(entry(page)).toHaveText('탐험 지도');
  await expect(entry(page).locator('svg[aria-hidden=true]')).toHaveCount(1);
  await expect(entry(page)).toHaveAttribute('aria-label', /기록한 활동 4개/);
  const box = (await entry(page).boundingBox())!;
  expect(box.height).toBeGreaterThanOrEqual(44);
  const refresh = (await page.getByRole('button', { name: '공지 다시 가져오기' }).boundingBox())!;
  expect(Math.abs((box.y + box.height / 2) - (refresh.y + refresh.height / 2))).toBeLessThan(1);
  await entry(page).click();                                              // 진입: 1탭
  expect(page.url()).toContain('section=explore');
  await expect(page.getByRole('heading', { name: '탐험 지도', level: 1 })).toBeVisible();
  await expect(page.locator('.explore-total')).toHaveText('기록한 활동 4개');
  if (info.project.name === 'desktop') {
    const selected = page.locator('.sidebar [aria-current="page"]');
    await expect(selected).toHaveCount(1);
    await expect(selected).toContainText('저장');
  }
  await expect(recordedAreas(page)).toHaveCount(3);                        // 기록 영역 2개와 그 밖
  await expect(emptyAreas(page)).toHaveCount(4);
  const career = recordedAreas(page).filter({ hasText: '취업·인턴' });
  await expect(career.locator('.explore-count')).toHaveText('2개');
  await expect(career.locator('.explore-status')).toHaveText('관심 1 · 지원 1');
  await expect(recordedAreas(page).filter({ hasText: '장학금' }).locator('.explore-status')).toHaveText('준비 1');
  const locked = emptyAreas(page).filter({ hasText: '교환학생' });
  await expect(locked.locator('.setting-name')).toHaveText('교환학생');
  await expect(locked.locator('.setting-help')).toHaveText('교환학생 공지 게시판에서 찾아볼 수 있어요');
  await expect(page.getByText('아직 기록이 없는 영역')).toBeVisible();
  const other = recordedAreas(page).filter({ hasText: '그 밖' });
  await expect(other.locator('.explore-count')).toHaveText('1개');
  await expect(other.locator('.explore-status')).toHaveText('결과 1');
  await expect(page.locator('body')).not.toContainText('%');             // 퍼센트·점수는 없다
  await page.goBack();                                                     // 뒤로 가기로 저장 화면
  await expect(entry(page)).toBeVisible();
  await expect(recordedAreas(page)).toHaveCount(0);
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
  await expect(entry(page)).toHaveAttribute('aria-label', /기록한 활동 2개/);
});

test('the map page stays within the viewport and areas use non-interactive cards', async ({ page }, info) => {
  await setup(page, [{ id: 'x1', title: '교환학생 파견 안내', status: 'interested' }, { id: 'x2', title: '하계 인턴 채용', status: 'interested' }]);
  await entry(page).click();
  const rows = recordedAreas(page);
  await expect(rows).toHaveCount(2);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  const first = (await rows.first().boundingBox())!;
  const second = (await rows.last().boundingBox())!;
  if (info.project.name === 'mobile') { expect(second.x).toBe(first.x); expect(second.y).toBeGreaterThan(first.y); }
  else { expect(second.x).toBeGreaterThan(first.x); expect(second.y).toBe(first.y); }
  await expect(rows.locator('button, a, .settings-chevron')).toHaveCount(0);
  const title = (await rows.first().getByRole('heading').boundingBox())!;
  const status = (await rows.first().locator('.explore-status').boundingBox())!;
  const count = (await rows.first().locator('.explore-count').boundingBox())!;
  expect(status.y).toBeGreaterThan(title.y);
  expect(count.x).toBeGreaterThan(status.x);
});

test('empty areas sit below the areas with records, records first by count', async ({ page }) => {
  await setup(page, [
    { id: 'x1', title: '교환학생 파견 안내', status: 'interested' },
    { id: 'x2', title: '하계 인턴 채용', status: 'interested' }, { id: 'x3', title: '신입 채용 공고', status: 'applied' },
  ]);
  await entry(page).click();
  await expect(recordedAreas(page)).toHaveCount(2);
  await expect(emptyAreas(page)).toHaveCount(4);
  await expect(recordedAreas(page).first()).toContainText('취업·인턴');   // 기록 많은 순
  await expect(recordedAreas(page).last()).toContainText('교환학생');
  const lastRecord = (await recordedAreas(page).last().boundingBox())!;
  expect((await emptyAreas(page).first().boundingBox())!.y).toBeGreaterThan(lastRecord.y + lastRecord.height);
  await expect(emptyAreas(page).first().getByText('아직 기록이 없어요')).toHaveCount(0);
});

test('click budget: saved tab -> map is 1 click, back is 1 click and lands on the saved tab at the top', async ({ page }) => {
  await setup(page, [{ id: 'x1', title: '하계 인턴 채용', status: 'interested' }]);
  await entry(page).click();                                   // 1번
  await expect(page.locator('.explore-total')).toBeVisible();
  await page.goBack();                                         // 1번
  await expect(entry(page)).toBeVisible();
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
});

test('saved list groups by saved date (today, yesterday) in latest order and has no date groups in custom order', async ({ page }) => {
  await setup(page, []);
  await page.evaluate(() => {
    const app = document.querySelector('notice-app') as unknown as App;
    const picked = app.notices.filter((n: { deadline: string | null }) => !n.deadline).slice(0, 2);
    const iso = (ms: number) => new Date(Date.now() - ms).toISOString();
    app.saved = picked.map((n: Record<string, unknown>, i: number) => { const { first_seen: _f, ...rest } = n; return { ...rest, saved_at: iso(i * 26 * 3600_000) }; });
    app.savedSort = 'latest'; app.savedOrder = [];
  });
  await expect(page.locator('section.group[aria-label="오늘"]')).toHaveCount(1);
  await expect(page.locator('section.group[aria-label="어제"]')).toHaveCount(1);
  await page.evaluate(() => {
    const app = document.querySelector('notice-app') as unknown as App;
    app.savedOrder = app.saved.map((n: { id: string }) => n.id); app.savedSort = 'custom';
  });
  await expect(page.locator('section.group[aria-label="저장한 공지"]')).toHaveCount(1);
  await expect(page.locator('section.group[aria-label="오늘"]')).toHaveCount(0);
});

test('cross-posts share the saved representative and its status on the map', async ({ page }) => {
  await setup(page, []);
  const savedRepresentative = await page.evaluate(() => {
    const controller = (document.querySelector('notice-app') as unknown as App).controller;
    const base = controller.notices[0];
    const sourceIds = controller.sources.slice(0, 2).map((source: { id: string }) => source.id);
    const representative = { ...base, id: 'cross-post-a', title: '하계 인턴 채용', source_id: sourceIds[0], first_seen: '2026-11-19T00:00:00Z', deadline: null, dup_key: 'cross-post', dup_text_key: null };
    const copy = { ...representative, id: 'cross-post-b', source_id: sourceIds[1], first_seen: '2026-11-20T00:00:00Z' };
    const opportunityOnly = { ...copy, id: 'cross-post-c', first_seen: '2026-11-18T00:00:00Z' };
    controller.notices = [representative, copy, opportunityOnly];
    controller.saved = [representative, copy].map((notice) => ({ ...notice, saved_at: '2026-11-21T00:00:00Z' }));
    controller.opportunities = new Map([representative, copy, opportunityOnly].map((notice, index) => [notice.id, {
      notice_id: notice.id, title: notice.title, board: null, status: ['applied', 'preparing', 'result'][index],
    }]));
    return controller.visible().map((notice: { id: string }) => notice.id);
  });
  expect(savedRepresentative).toEqual(['cross-post-a']);
  await expect(entry(page)).toHaveAttribute('aria-label', /기록한 활동 1개/);
  await entry(page).click();
  await expect(page.locator('.explore-total')).toHaveText('기록한 활동 1개');
  await expect(recordedAreas(page).locator('.explore-status')).toHaveText('지원 1');
});

test('direct map entry waits for both reads and retries failed reads before showing counts', async ({ page }) => {
  await page.goto('/?api=sample/api/v1&view=settings&section=explore');
  await page.evaluate(() => {
    const controller = (document.querySelector('notice-app') as unknown as App).controller;
    controller.authUserId = 'account-a';
    controller.profileStatus = 'unavailable';
    controller.onboardingDismissed = true;
    controller.accountDataLoaded = false;
    controller.settingsCapped = false;
  });
  await expect(page.getByRole('heading', { name: '탐험 지도', level: 1 })).toBeVisible();
  await expect(page.getByText('활동 기록을 불러오고 있어요')).toBeVisible();
  await expect(page.locator('.explore-total')).toHaveCount(0);
  await page.evaluate(() => {
    const controller = (document.querySelector('notice-app') as unknown as App).controller;
    controller.liveFeedReady = true;
    controller.opportunitiesStatus = 'ready';
  });
  await expect(page.getByText('활동 기록을 불러오고 있어요')).toBeVisible();
  await page.evaluate(() => {
    const controller = (document.querySelector('notice-app') as unknown as App).controller;
    controller.exploreSavedStatus = 'failed';
    controller.opportunitiesStatus = 'failed';
    controller.syncStates = async () => { controller.exploreSavedStatus = 'ready'; };
    controller.refreshOpportunities = async () => {
      controller.opportunities = new Map([['x1', { notice_id: 'x1', title: '하계 인턴 채용', board: null, status: 'applied' }]]);
      controller.opportunitiesStatus = 'ready';
    };
  });
  await expect(page.getByRole('alert')).toHaveText('활동 기록을 불러오지 못했어요');
  await expect(page.locator('.explore-total')).toHaveCount(0);
  await page.getByRole('button', { name: '다시 불러오기' }).click();
  await expect(page.locator('.explore-total')).toHaveText('기록한 활동 1개');
});
