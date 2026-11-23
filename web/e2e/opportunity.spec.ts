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
  await expect(section.getByRole('radio', { name: '관심 있음' })).toHaveAttribute('aria-checked', 'true');
  await expect(section.getByRole('textbox', { name: '메모' })).toHaveCount(0);   // 메모는 접혀 있다
  const prepare = section.getByRole('radio', { name: '준비 중' });
  const box = await prepare.boundingBox();
  expect(box!.height).toBeGreaterThanOrEqual(44);
  await prepare.click();                                                    // 저장한 공지에서 상태 바꾸기: 1탭
  await expect(prepare).toHaveAttribute('aria-checked', 'true');
  expect((await saves(page)).map((s) => s.status)).toEqual(['interested', 'preparing']);
  await prepare.press('ArrowRight');
  expect((await saves(page)).length).toBe(2);                                // 방향키는 포커스만 옮긴다
  await page.keyboard.press('Space');
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
  await section.getByRole('button', { name: '상태와 메모 지우기' }).click();
  await expect(section.getByText('상태와 메모를 지울까요?')).toBeVisible();
});

test('the four status segments fit on one line at 360px with any status selected', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await setup(page);
  await page.getByRole('button', { name: '저장하기' }).click();
  const group = page.getByRole('radiogroup', { name: '내 진행 상태' });
  const labels = ['관심 있음', '준비 중', '지원함', '결과 나옴'];
  await expect(group.getByRole('radio')).toHaveText(labels);
  await page.evaluate(() => document.fonts.ready.then(() => undefined));

  for (const label of labels) {
    const option = group.getByRole('radio', { name: label });
    await option.click();
    await expect(option).toHaveAttribute('aria-checked', 'true');
    await expect(group.getByRole('radio', { checked: true })).toHaveCount(1);
    const { height, verticalPadding, buttons } = await group.evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        height: element.getBoundingClientRect().height,
        verticalPadding: parseFloat(style.paddingTop) + parseFloat(style.paddingBottom),
        buttons: [...element.querySelectorAll('button')].map((button) => {
          const { top, width, height, left, right } = button.getBoundingClientRect();
          const range = document.createRange();
          range.selectNode(button.lastChild!);
          const text = range.getBoundingClientRect();
          const check = button.querySelector('svg')?.getBoundingClientRect();
          return { top, width, height, lines: range.getClientRects().length,
            fits: text.left >= left && text.right <= right && (!check || (check.left >= left && check.right <= text.left)) };
        }),
      };
    });
    const [first] = buttons;
    expect(first.height).toBeGreaterThanOrEqual(44);
    expect(height).toBeCloseTo(first.height + verticalPadding, 1);
    for (const button of buttons) {
      expect(button.top).toBe(first.top);
      expect(button.height).toBe(first.height);
      expect(button.width).toBeCloseTo(first.width, 1);
      expect(button.lines).toBe(1);
      expect(button.fits).toBe(true);
    }
  }
});

test('the status section stays one even while the summary and body loading states come and go', async ({ page }) => {
  await setup(page);
  await page.getByRole('button', { name: '저장하기' }).click();
  const section = page.getByRole('region', { name: '내 진행 상태' });
  await expect(section).toHaveCount(1);
  // 요약 불러오는 중·본문 불러오는 중 표시가 같은 자리에 들어왔다 나가도 진행 상태 구역은 늘어나지 않는다(형제 key가 겹치던 버그).
  const bodyLoading = page.getByText('본문을 불러오고 있어요');
  const bodyLoaded = page.getByText('시험용 본문');
  for (let i = 0; i < 4; i++) {
    const loading = i % 2 === 0;
    await page.evaluate((loading) => {
      const { controller: app } = document.querySelector('notice-app') as unknown as { controller: App };
      const id = (app.openedId ?? app.selectedId) as string;
      app.summarizing = loading ? id : null;
      const bodies = new Map(app.bodies);
      bodies.set(id, loading ? 'loading' : { id, body: '시험용 본문', attachments: [] });
      app.bodies = bodies;
      app.requestUpdate();
    }, loading);
    await expect(loading ? bodyLoading : bodyLoaded).toBeVisible();
    await expect(section).toHaveCount(1);
  }
  await expect(page.getByRole('heading', { name: '내 진행 상태' })).toHaveCount(1);
});

// 저장한 공지를 화면 기본값 그대로(기록 없이) 몇 개 만든다. 서버 행을 만들지 않는 것이 결정 A다.
async function saveSome(page: Page, count: number, records: Record<number, string> = {}) {
  await page.evaluate(({ count, records }) => {
    const app = document.querySelector('notice-app') as unknown as App;
    const picked = app.notices.filter((n: { deadline: string | null }) => !n.deadline).slice(0, count);
    app.saved = picked.map((n: Record<string, unknown>, i: number) => { const { first_seen: _f, ...rest } = n; return { ...rest, saved_at: `2026-11-0${i + 1}T00:00:00.000Z` }; });
    app.opportunities = new Map(Object.entries(records).map(([i, status]) => [picked[Number(i)].id, { notice_id: picked[Number(i)].id, title: 't', url: null, board: null, deadline: null, status, note: null, created_at: '', updated_at: '' }]));
    app.detailOpen = false; app.selectedId = null; app.openedId = null; app.setView('saved');
  }, { count, records });
}
const rowStatuses = (page: Page) => page.locator('notice-rows-screen a.row .status-meta').allInnerTexts();

test('a saved notice without a record shows the default status "관심 있음"; the filter menu appears only with two kinds and hides empty ones', async ({ page }) => {
  await setup(page);
  await saveSome(page, 3);
  expect(await rowStatuses(page)).toEqual(['관심 있음', '관심 있음', '관심 있음']);          // 기록이 없어도 모두 같은 모양
  const dots = await page.locator('notice-rows-screen a.row .status-meta > span').evaluateAll((els) => els.map((el) => getComputedStyle(el).backgroundColor));
  expect(new Set(dots).size).toBe(1);                                                           // 점 색은 하나다
  await expect(page.locator('.status-trigger')).toHaveCount(0);                              // 거를 것이 한 종류뿐이면 거르기가 없다
  await expect(page.getByRole('group', { name: '진행 상태로 거르기' })).toHaveCount(0);        // 칩 줄은 없다
  await saveSome(page, 3, { 0: 'applied' });
  const trigger = page.getByRole('button', { name: /^진행 상태: 전체/ });
  await expect(trigger).toBeVisible();
  await trigger.click();
  const menu = page.getByRole('group', { name: '진행 상태 선택' });
  await expect(menu.getByRole('button')).toHaveText(['전체3', '관심 있음2', '지원함1']);     // 0건인 준비 중·결과 나옴은 없다
  await menu.getByRole('button', { name: /지원함/ }).click();
  await expect(page.locator('notice-rows-screen a.row')).toHaveCount(1);
  await expect(page.getByRole('button', { name: '진행 상태: 지원함' })).toHaveClass(/text-accent/);   // 거르는 중에는 글자만 강조색
  expect(await rowStatuses(page)).toEqual(['지원함']);
  // 그 공지가 관심으로 돌아가 0건이 돼도 트리거는 남아 전체로 돌아갈 수 있다.
  await page.evaluate(() => { const app = document.querySelector('notice-app') as unknown as App; app.opportunities = new Map(); });
  await expect(page.getByText('이 상태의 공지가 없어요')).toBeVisible();
  await page.getByRole('button', { name: '전체 보기' }).click();
  await expect(page.locator('notice-rows-screen a.row')).toHaveCount(3);
  await expect(page.getByRole('button', { name: '진행 상태: 전체' })).toHaveCount(0);        // 다시 한 종류뿐이라 거르기가 사라진다
  // 기록 표를 쓸 수 없으면 상태는 어디에도 나오지 않는다.
  await page.evaluate(() => { (document.querySelector('notice-app') as unknown as App).opportunitiesStatus = 'unavailable'; });
  await expect(page.locator('notice-rows-screen a.row .status-meta')).toHaveCount(0);
  await page.locator('notice-rows-screen a.row').first().click();
  await expect(page.getByRole('region', { name: '내 진행 상태' })).toHaveCount(0);
});

test('saved toolbar triggers are at least 44px tall and the row does not overflow at 360px', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await setup(page);
  await saveSome(page, 3, { 0: 'applied' });
  const bar = page.locator('.saved-options');
  await expect(bar).toBeVisible();
  for (const selector of ['.select-trigger', '.status-trigger', '.sort-trigger']) {
    const box = await bar.locator(selector).boundingBox();
    expect(box, selector).not.toBeNull();
    expect(box!.height, selector).toBeGreaterThanOrEqual(44);
  }
  const fits = await bar.evaluate((el) => ({ row: el.scrollWidth <= el.clientWidth + 1, page: document.documentElement.scrollWidth <= window.innerWidth }));
  expect(fits).toEqual({ row: true, page: true });
});

test('the detail shows the same default status as the list for a saved notice without a record', async ({ page }) => {
  await setup(page);
  await saveSome(page, 2);
  await page.locator('notice-rows-screen a.row').first().click();
  const section = page.getByRole('region', { name: '내 진행 상태' });
  await expect(section.getByRole('radio', { name: '관심 있음' })).toHaveAttribute('aria-checked', 'true');
  await expect(section.getByRole('button', { name: '상태와 메모 지우기' })).toHaveCount(0);   // 기록 행이 없으니 지울 것도 없다
  expect(await saves(page)).toEqual([]);                                                     // 보기만 해서는 서버에 쓰지 않는다
});

test('detail sections keep the order reason → summary → graduation → my status → team → body, and the status section is one and always open', async ({ page }) => {
  await setup(page);
  await page.getByRole('button', { name: '저장하기' }).click();
  await page.evaluate(() => {
    const app = document.querySelector('notice-app') as unknown as App;
    app.myInfo = () => ({ summary: '첫 줄\n둘째 줄\n셋째 줄', deadline: null, deadlineKind: null, ai: null });
    app.teamShown = () => true;
    app.teamModel = () => ({ status: 'ready', posts: [], busy: false, canCreate: true, load: () => {}, create: async () => true, apply: async () => true, withdraw: async () => true, setClosed: async () => true, remove: async () => true, applicants: async () => [], decide: async () => 'ok', contact: async () => null, report: async () => true, blockOwner: async () => true, blockApplicant: async () => true });
    app.requestUpdate();
  });
  const detail = page.locator('notice-detail-screen:visible').first();
  await expect(detail.getByRole('region', { name: '내 진행 상태' })).toHaveCount(1);
  await expect(detail.locator('#sec-opportunity')).toHaveCount(1);
  const order = await detail.evaluate((root) => {
    const marks: [string, string][] = [['.detail-reason, .detail-deadline', 'reason'], ['section.summary', 'summary'], ['section.opportunity', 'opportunity'], ['section.team', 'team'], ['section.body-text', 'body']];
    const found = marks.map(([selector, name]) => { const el = root.querySelector(selector); return el ? { name, top: el.getBoundingClientRect().top + window.scrollY, pos: [...root.querySelectorAll('*')].indexOf(el) } : null; }).filter((x): x is { name: string; top: number; pos: number } => !!x);
    return found.sort((a, b) => a.pos - b.pos).map((x) => x.name);
  });
  expect(order.filter((name) => name !== 'reason')).toEqual(['summary', 'opportunity', 'team', 'body'].filter((name) => order.includes(name)));
  expect(order).toContain('summary'); expect(order).toContain('opportunity'); expect(order).toContain('team');
  // 진행 상태는 항상 펼쳐 있어 칩이 바로 보인다(1탭).
  await expect(detail.getByRole('radio', { name: '준비 중' })).toBeVisible();
});

test('reorder mode: keyboard pick-move-drop saves once, a mouse drag saves once, the row does not open, filters block it with a reason', async ({ page }) => {
  await setup(page);
  await saveSome(page, 3, { 0: 'applied' });
  await page.evaluate(() => {
    const app = document.querySelector('notice-app') as unknown as App;
    const w = window as unknown as { orderSaves: string[][] };
    w.orderSaves = [];
    app.savedOrderAccount = true;
    app.persistSavedOrder = async (_u: string, order: string[]) => { w.orderSaves.push(order); };
    app.authUserId = 'account-a';
  });
  const orderSaves = () => page.evaluate(() => (window as unknown as { orderSaves: string[][] }).orderSaves);
  const titles = () => page.locator('.saved-reorder .reorder-title').allInnerTexts();
  const before = (await page.locator('notice-rows-screen a.row .title').allInnerTexts()).map((t) => t.trim());
  // 필터가 걸려 있으면 막히고 이유가 보인다.
  await page.getByRole('button', { name: /^진행 상태: 전체/ }).click();
  await page.getByRole('group', { name: '진행 상태 선택' }).getByRole('button', { name: /지원함/ }).click();
  await expect(page.getByText('전체 보기에서 순서를 바꿀 수 있어요')).toBeVisible();
  await page.getByRole('button', { name: /^정렬:/ }).click();
  await expect(page.getByRole('button', { name: '순서 바꾸기' })).toBeDisabled();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '진행 상태: 지원함' }).click();
  await page.getByRole('group', { name: '진행 상태 선택' }).getByRole('button', { name: /^전체/ }).click();
  await page.getByRole('button', { name: /^정렬:/ }).click();
  await expect(page.getByRole('button', { name: '순서 바꾸기' })).toBeEnabled();
  // 진입(정렬 메뉴 안) 1번, 이동, 완료 1번.
  await page.getByRole('button', { name: '순서 바꾸기' }).click();
  await expect(page.getByRole('button', { name: '완료' })).toBeVisible();
  await expect(page.locator('notice-rows-screen a.row')).toHaveCount(0);        // 모드 중에는 눌러 열리는 줄이 없다
  expect(await titles()).toEqual(before);
  const handles = page.getByRole('button', { name: /순서 옮기기$/ });
  expect((await handles.first().boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await handles.first().focus();
  await page.keyboard.press('Space');
  await page.keyboard.press('ArrowDown');
  expect((await orderSaves()).length).toBe(0);                                   // 옮기는 동안은 저장하지 않는다
  await page.keyboard.press('Space');
  await expect.poll(async () => (await orderSaves()).length).toBe(1);            // 놓으면 한 번 저장
  expect(await titles()).toEqual([before[1], before[0], before[2]]);
  // 마우스로 끌기
  const first = page.locator('.saved-reorder li').nth(0), last = page.locator('.saved-reorder li').nth(2);
  const a = (await first.getByRole('button').boundingBox())!, b = (await last.boundingBox())!;
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2 + 10, { steps: 3 });
  await page.mouse.move(a.x + a.width / 2, b.y + b.height - 4, { steps: 8 });
  await page.mouse.up();
  await expect.poll(async () => (await orderSaves()).length).toBe(2);
  expect((await orderSaves())[1].length).toBe(3);
  await page.waitForTimeout(150);   // 끌기 직후의 클릭 막이가 풀릴 때까지
  await page.getByRole('button', { name: '완료' }).click();
  await expect(page.locator('.saved-reorder')).toHaveCount(0);
  // 정렬에 '내가 정한 순'이 생기고 그 순서로 보인다.
  await expect(page.getByRole('button', { name: '정렬: 내가 정한 순' })).toBeVisible();
  const after = (await page.locator('notice-rows-screen a.row .title').allInnerTexts()).map((t) => t.trim());
  expect(after.sort()).toEqual([...before].sort());
  // 새로 저장한 공지는 맨 위에 들어간다.
  await page.evaluate(() => {
    const app = document.querySelector('notice-app') as unknown as App;
    const extra = app.notices.filter((n: { deadline: string | null }) => !n.deadline)[3];
    const { first_seen: _f, ...rest } = extra;
    app.saved = [{ ...rest, saved_at: '2026-12-01T00:00:00.000Z' }, ...app.saved];
  });
  await expect(page.locator('notice-rows-screen a.row')).toHaveCount(4);
  const top = await page.evaluate(() => { const app = document.querySelector('notice-app') as unknown as App; return app.visible()[0].id === app.saved[0].id; });
  expect(top).toBe(true);
});
