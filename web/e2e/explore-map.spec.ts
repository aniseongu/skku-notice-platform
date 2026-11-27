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

test('settings opens at home after visiting the explore map', async ({ page }, info) => {
  await setup(page, [{ id: 'x1', title: '하계 인턴 채용', status: 'interested' }]);
  await entry(page).click();
  await expect(page).toHaveURL(/section=explore$/);
  // 모바일 설정 화면에는 톱니가 없으므로 저장 목록의 머리 줄로 돌아간다.
  if (info.project.name === 'mobile') await page.getByRole('button', { name: '설정 닫기' }).click();
  await page.getByRole('button', { name: '설정', exact: true }).click();
  await expect(page).toHaveURL(/\?view=settings$/);
  await expect(page.getByRole('heading', { name: '내 설정' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '계정' })).toBeVisible();
  await page.getByRole('button', { name: '설정 닫기' }).click();
  await expect(page).toHaveURL(/\?tab=saved$/);
});

test('saved screen shows the header button, one tap opens the map with counts, back returns to the saved screen', async ({ page }, info) => {
  await setup(page, [
    { id: 'x1', title: '하계 인턴 채용', status: 'interested' }, { id: 'x2', title: '신입 채용 공고', status: 'applied' },
    { id: 'x3', title: '국가장학금 신청', status: 'preparing' }, { id: 'x4', title: '도서관 이용 안내', status: 'result' },
  ]);
  const tooltip = entry(page).getByText('탐험 지도', { exact: true });
  await expect(tooltip).toBeHidden();
  await expect(entry(page).locator('svg[aria-hidden=true]')).toHaveCount(1);
  await expect(entry(page)).toHaveAttribute('aria-label', /기록한 활동 4개/);
  const box = (await entry(page).boundingBox())!;
  const bell = (await page.getByRole('button', { name: /^알림함/ }).boundingBox())!;
  expect({ width: box.width, height: box.height }).toEqual({ width: bell.width, height: bell.height });
  if (info.project.name === 'mobile') expect(Math.min(box.width, box.height)).toBeGreaterThanOrEqual(44);
  const refresh = (await page.getByRole('button', { name: '공지 다시 가져오기' }).boundingBox())!;
  expect(Math.abs((box.y + box.height / 2) - (refresh.y + refresh.height / 2))).toBeLessThan(1);
  if (info.project.name === 'desktop') {
    await entry(page).focus();
    await expect(entry(page)).toBeFocused();
    await expect(tooltip).toBeVisible();
    await page.keyboard.press('Enter');
  } else {
    await entry(page).click();
  }
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

for (const [clockLabel, now] of [
  ['KST noon', '2026-11-27T03:00:00Z'],
  ['KST just after midnight', '2026-11-27T15:30:00Z'],
]) test(`saved list groups by saved date (today, yesterday) in latest order and has no date groups in custom order (${clockLabel})`, async ({ page }) => {
  await page.clock.setFixedTime(new Date(now));
  await setup(page, []);
  await page.evaluate(() => {
    const app = document.querySelector('notice-app') as unknown as App;
    const picked = app.notices.filter((n: { deadline: string | null }) => !n.deadline).slice(0, 2);
    const iso = (ms: number) => new Date(Date.now() - ms).toISOString();
    // KST has no DST: the same clock time 24 hours earlier is always yesterday.
    // 26 hours earlier becomes two calendar days ago between midnight and 02:00 KST.
    app.saved = picked.map((n: Record<string, unknown>, i: number) => { const { first_seen: _f, ...rest } = n; return { ...rest, saved_at: iso(i * 24 * 3600_000) }; });
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

const LONG_BOARD = '차세대 인공지능 융합전공 및 산학협력 교육프로그램 학생 모집 추가 안내 공지';
// 공유 게시판 이름이 길어도 저장 탭 도구 줄의 게시판 목록이 화면 밖으로 나가지 않는다. 화면 이름은 boardName이 끝의 '공지'를 뗀 값이다.
const LONG_BOARD_LABEL = LONG_BOARD.replace(/\s*공지$/, '');
for (const width of [360, 412]) {
  test(`phone saved tab puts the board picker on its own row like other tabs, the toolbar row keeps filter, status, select and sort, and a long board name wraps inside the popup (${width}px)`, async ({ page }) => {
    await page.setViewportSize({ width, height: 780 });
    await setup(page, []);
    const longName = LONG_BOARD_LABEL;
    await page.evaluate((longBoard) => {
      const app = document.querySelector('notice-app') as unknown as App;
      const bySource = new Map<string, Record<string, unknown>>();
      for (const n of app.notices) if (!n.deadline && !bySource.has(n.source_id)) bySource.set(n.source_id, n);
      const picked = [...bySource.values()].slice(0, 2);
      app.saved = picked.map((n) => { const { first_seen: _f, ...rest } = n; return { ...rest, saved_at: new Date().toISOString() }; });
      app.savedSort = 'latest'; app.savedOrder = [];
      // 첫 저장 공지의 게시판 이름을 긴 이름으로 바꾸고, 두 공지에 서로 다른 진행 상태를 줘서 진행 상태 줄까지 네 조작이 모두 나오게 한다.
      const targetId = picked[0].source_id as string;
      app.sources = app.sources.map((s: { id: string; name: string }) => (s.id === targetId ? { ...s, name: longBoard } : s));
      const statuses = ['interested', 'applied'];
      app.opportunities = new Map(picked.map((n, i) => [n.id as string, { notice_id: n.id, title: n.title, url: null, board: null, deadline: null, status: statuses[i], note: null, created_at: '', updated_at: '' }]));
    }, LONG_BOARD);
    const toolbar = page.locator('.saved-options');
    const picker = page.getByRole('button', { name: /^게시판: / });
    const select = toolbar.getByRole('button', { name: '선택' });
    const status = toolbar.getByRole('button', { name: /^진행 상태: / });
    const sort = toolbar.getByRole('button', { name: /^정렬: / });
    await expect(picker).toBeVisible();
    await expect(status).toBeVisible();                            // 네 조작이 모두 보인다
    await expect(page.locator('.board-picker')).toHaveCount(1);
    const [p, s, st, o] = await Promise.all([picker.boundingBox(), select.boundingBox(), status.boundingBox(), sort.boundingBox()]);
    expect(p!.y + p!.height).toBeLessThanOrEqual(s!.y + 1);        // 게시판은 다른 탭처럼 도구 줄 위 자기 줄
    expect(Math.abs(st!.y - s!.y)).toBeLessThan(2);
    expect(Math.abs(o!.y - s!.y)).toBeLessThan(2);
    expect(p!.height).toBeGreaterThanOrEqual(44);
    expect(o!.x + o!.width).toBeLessThanOrEqual(width);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await picker.click();                                          // 한 번에 열린다
    await expect(picker).toHaveAttribute('aria-expanded', 'true');
    const menuBox = page.locator('#board-options');
    await expect(menuBox).toBeVisible();
    const longOption = menuBox.getByRole('button', { name: longName });   // 낭독 이름은 줄바꿈과 상관없이 전체
    await expect(longOption).toBeVisible();
    const menu = await menuBox.boundingBox();
    expect(menu!.x).toBeGreaterThanOrEqual(0);
    expect(menu!.x + menu!.width).toBeLessThanOrEqual(width);      // 오른쪽 끝이 화면 안
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    const long = await longOption.boundingBox();
    expect(long!.height).toBeGreaterThan(44);                      // 한 줄로 늘어나지 않고 줄바꿈
    for (const option of await menuBox.locator('.board-option').all()) expect((await option.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    const sizes = await menuBox.locator('.board-option').evaluateAll((els) => els.map((el) => ({ scroll: el.scrollWidth, client: el.clientWidth })));
    for (const size of sizes) expect(size.scroll).toBeLessThanOrEqual(size.client + 1);   // 항목 안에서 글이 넘치지 않는다
    await expect(menuBox.locator('.board-option[aria-pressed="true"]')).toBeFocused();   // 열면 현재 선택 항목에 초점
    await longOption.click();
    await expect(page.locator('notice-rows-screen a.row')).toHaveCount(1);
    await expect(page.getByRole('button', { name: /^게시판: / })).toHaveAttribute('aria-label', `게시판: ${longName}`);
    await expect(picker).toBeFocused();                            // 닫히면 초점은 단추로
    await picker.click();                                          // 다시 열어 선택 표시를 확인
    await expect(menuBox.getByRole('button', { name: longName })).toHaveAttribute('aria-pressed', 'true');
    await expect(menuBox.locator('.board-option[aria-pressed="true"] .board-check')).toBeVisible();
    const reopened = await menuBox.boundingBox();
    expect(reopened!.x + reopened!.width).toBeLessThanOrEqual(width);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  });
}

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
