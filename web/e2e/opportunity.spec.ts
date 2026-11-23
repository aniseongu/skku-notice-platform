import { test, expect, type Page } from '@playwright/test';

type App = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

// 서버 없이 컨트롤러와 화면의 실제 연결을 본다. 기록 변경은 메모리에서 처리한다.
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
      return true;
    };
    app.removeOpportunityFor = async (notice: { id: string }) => {
      const next = new Map(app.opportunities);
      next.delete(notice.id);
      app.opportunities = next;
    };
    for (const [key, value] of Object.entries(values)) app[key] = value;
  }, patch);
}
const saves = (page: Page) => page.evaluate(() => (window as unknown as { saves: Record<string, unknown>[] }).saves);

test('saved notice: one tap sets the status, the memo can be edited, and the menu clears the record', async ({ page }) => {
  await setup(page);
  const section = page.getByRole('region', { name: '내 진행 상태' });
  await expect(section).toHaveCount(0);                                    // 저장하기 전에는 없다
  await page.getByRole('button', { name: '저장하기' }).click();
  await expect(section).toBeVisible();
  expect(await saves(page)).toEqual([expect.objectContaining({ status: 'interested' })]);   // 저장하면 입력 없이 관심으로 기록된다
  await page.emulateMedia({ colorScheme: 'dark' });
  const interested = section.getByRole('radio', { name: '관심 있음' });
  await expect(interested).toHaveAttribute('aria-checked', 'true');
  await expect(interested).toHaveCSS('font-weight', '600');   // 선택 칸은 굵은 글자 + 트랙보다 밝은 면, 밝은 테두리는 없다
  expect(await interested.evaluate((el) => getComputedStyle(el).boxShadow)).not.toMatch(/inset/);
  expect(await interested.evaluate((el) => getComputedStyle(el).backgroundColor !== getComputedStyle(el.parentElement!).backgroundColor)).toBe(true);
  await expect(section.getByRole('textbox', { name: '메모' })).toHaveCount(0);   // 메모는 접혀 있다
  await expect(section.getByText('저장을 해제해도 상태와 메모는 남아요')).toHaveCount(0);
  const prepare = section.getByRole('radio', { name: '준비 중' });
  const box = await prepare.boundingBox();
  expect(box!.height).toBeGreaterThanOrEqual(44);
  await prepare.click();                                                    // 저장한 공지에서 상태 바꾸기: 1탭
  await expect(prepare).toHaveAttribute('aria-checked', 'true');
  expect((await saves(page)).map((s) => s.status)).toEqual(['interested', 'preparing']);
  const addMemo = section.getByRole('button', { name: '메모 남기기' });
  expect((await addMemo.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await addMemo.click();
  const memo = section.getByRole('textbox', { name: '메모' });
  await expect(memo).toBeFocused();
  await memo.fill('서류 준비\n마감 확인');
  await memo.press('Enter');
  const memoText = section.getByRole('button', { name: '메모 고치기: 서류 준비 마감 확인' });
  await expect(memoText).toBeVisible();
  await expect(memoText).toBeFocused();
  await expect(memoText).toHaveCSS('font-size', '15px');
  await expect(memoText).toHaveCSS('white-space', 'pre-wrap');
  await expect(memoText).toHaveCSS('text-decoration-line', 'underline');
  await expect(memo).toHaveCount(0);
  await memoText.click();
  await expect(memo).toBeFocused();
  await expect(memo).toHaveValue('서류 준비\n마감 확인');
  await memo.fill('제출 준비');

  const menu = section.getByRole('button', { name: '더 보기 메뉴' });
  expect(await menu.boundingBox()).toMatchObject({ width: 44, height: 44 });
  await menu.click();                                                       // 편집칸을 벗어나면 저장한다
  await expect(section.getByRole('button', { name: '메모 고치기: 제출 준비' })).toBeVisible();
  expect((await saves(page)).at(-1)).toMatchObject({ note: '제출 준비' });
  const remove = section.getByRole('button', { name: '기록 지우기' });
  await expect(remove).toBeFocused();
  await remove.press('Escape');
  await expect(menu).toBeFocused();
  await expect(remove).toHaveCount(0);
  await menu.click();
  await prepare.focus();
  await expect(remove).toHaveCount(0);
  await menu.click();
  await remove.click();
  await expect(section.getByText('진행 상태와 메모를 지울까요?')).toBeVisible();
  await section.getByRole('button', { name: '취소' }).click();
  await expect(menu).toBeFocused();
  await expect(prepare).toHaveAttribute('aria-checked', 'true');
  await menu.click();
  await remove.click();
  await section.getByRole('button', { name: '지우기', exact: true }).click();
  await expect(section.getByRole('radio', { name: '관심 있음' })).toHaveAttribute('aria-checked', 'true');
  await expect(menu).toHaveCount(0);
  await expect(addMemo).toBeVisible();
  await addMemo.click();
  await memo.press('Enter');                                               // 빈 메모는 접히고 저장되지 않는다
  await expect(addMemo).toBeFocused();
  expect((await saves(page)).map((save) => save.note)).toEqual([undefined, undefined, '서류 준비\n마감 확인', '제출 준비']);
  await expect(section).not.toContainText('합격');
  await expect(section).not.toContainText('인증');
});

test('a slow or failed memo save keeps the draft available for retry', async ({ page }) => {
  await setup(page);
  await page.getByRole('button', { name: '저장하기' }).click();
  await page.evaluate(() => {
    const app = document.querySelector('notice-app') as unknown as App;
    const save = app.saveOpportunityFor;
    app.saveOpportunityFor = (...args: unknown[]) => new Promise<boolean>((resolve) => {
      app.finishMemoSave = () => { app.saveOpportunityFor = save; resolve(false); };
    });
  });
  await page.getByRole('button', { name: '메모 남기기' }).click();
  const memo = page.getByRole('textbox', { name: '메모' });
  await memo.fill('저장할 메모');
  await memo.press('Enter');
  await expect(memo).toHaveValue('저장할 메모');
  await expect(memo).not.toBeEditable();
  await page.evaluate(() => (document.querySelector('notice-app') as unknown as App).finishMemoSave());
  await expect(memo).toBeEditable();
  await expect(memo).toHaveValue('저장할 메모');
  await memo.press('Enter');
  await expect(page.getByRole('button', { name: '메모 고치기: 저장할 메모' })).toBeFocused();
});

test('saved notice: keyboard navigation saves only on selection, and unsaving keeps the record', async ({ page }) => {
  await setup(page);
  await page.getByRole('button', { name: '저장하기' }).click();
  const section = page.getByRole('region', { name: '내 진행 상태' });
  await section.getByRole('radio', { name: '관심 있음' }).press('ArrowRight');
  expect(await saves(page)).toHaveLength(1);
  await page.keyboard.press('Space');
  await expect(section.getByRole('radio', { name: '준비 중' })).toHaveAttribute('aria-checked', 'true');
  // 저장을 지워도 기록은 남고 구역도 남는다.
  await page.getByRole('button', { name: '저장 지우기' }).click();
  await expect(section.getByRole('radio', { name: '준비 중' })).toHaveAttribute('aria-checked', 'true');
  await expect(section.getByRole('button', { name: '더 보기 메뉴' })).toBeVisible();
});

test('the four status segments fit on one line at 360px with any status selected', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await setup(page);
  await page.getByRole('button', { name: '저장하기' }).click();
  const group = page.getByRole('radiogroup', { name: '내 진행 상태' });
  const labels = ['관심 있음', '준비 중', '지원함', '결과 나옴'];
  await expect(group.getByRole('radio')).toHaveText(labels);
  await expect(group.locator('svg')).toHaveCount(0);
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
          return { top, width, height, lines: range.getClientRects().length,
            fits: text.left >= left && text.right <= right };
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

test('default statuses stay off saved rows but count in the filter menu', async ({ page }) => {
  await setup(page);
  await saveSome(page, 3, { 1: 'interested' });
  const rows = page.locator('notice-rows-screen a.row');
  await expect(rows).toHaveCount(3);
  await expect(rows.locator('.status-meta')).toHaveCount(0);                               // 기본값은 기록 유무와 관계없이 숨긴다
  await expect(page.locator('.status-trigger')).toHaveCount(0);                              // 거를 것이 한 종류뿐이면 거르기가 없다
  await expect(page.getByRole('group', { name: '진행 상태로 거르기' })).toHaveCount(0);        // 칩 줄은 없다
  await saveSome(page, 3, { 0: 'applied' });
  const trigger = page.getByRole('button', { name: /^진행 상태: 전체/ });
  await expect(trigger).toBeVisible();
  await trigger.click();
  const menu = page.getByRole('group', { name: '진행 상태 선택' });
  await expect(menu.getByRole('button')).toHaveText(['전체3', '관심 있음2', '지원함1']);     // 0건인 준비 중·결과 나옴은 없다
  await menu.getByRole('button', { name: /관심 있음/ }).click();
  await expect(rows).toHaveCount(2);
  await expect(rows.locator('.status-meta')).toHaveCount(0);
  await page.getByRole('button', { name: '진행 상태: 관심 있음' }).click();
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

test('saved and reorder row metadata fits on one line at 360px', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await setup(page);
  await saveSome(page, 5, { 1: 'interested', 2: 'preparing', 3: 'applied', 4: 'result' });
  const bar = page.locator('.saved-options');
  await expect(bar).toBeVisible();
  for (const selector of ['.select-trigger', '.status-trigger', '.sort-trigger']) {
    const box = await bar.locator(selector).boundingBox();
    expect(box, selector).not.toBeNull();
    expect(box!.height, selector).toBeGreaterThanOrEqual(44);
  }
  const fits = await bar.evaluate((el) => ({ row: el.scrollWidth <= el.clientWidth + 1, page: document.documentElement.scrollWidth <= window.innerWidth }));
  expect(fits).toEqual({ row: true, page: true });
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  const listMeta = 'notice-rows-screen a.row .meta';
  const labels = ['결과 나옴', '준비 중', '지원함'];
  const expectSingleLine = async (selector: string) => {
    const meta = page.locator(selector);
    await expect(meta).toHaveCount(5);
    await expect(meta.locator('.status-meta')).toHaveCount(3);
    expect((await meta.locator('.status-meta').allInnerTexts()).sort()).toEqual(labels);
    for (const line of await meta.all()) {
      const layout = await line.evaluate((element) => {
        const box = element.getBoundingClientRect();
        const status = element.querySelector('.status-meta')?.getBoundingClientRect();
        return {
          height: box.height,
          statusAtStart: !status || (status.left === box.left && status.right <= box.right),
          pageOverflow: document.documentElement.scrollWidth - window.innerWidth,
        };
      });
      expect(layout).toEqual({ height: 18, statusAtStart: true, pageOverflow: 0 });
    }
    const dots = await meta.locator('.status-meta > span').evaluateAll((elements) =>
      elements.map((dot) => getComputedStyle(dot).backgroundColor));
    expect(new Set(dots).size).toBe(1);
  };
  await expectSingleLine(listMeta);
  await page.getByRole('button', { name: /^정렬:/ }).click();
  await page.getByRole('button', { name: '순서 바꾸기' }).click();
  await expectSingleLine('.saved-reorder li > span > span:first-child');
});

test('the detail shows the default status for a saved notice without a record', async ({ page }) => {
  await setup(page);
  await saveSome(page, 2);
  await page.locator('notice-rows-screen a.row').first().click();
  const section = page.getByRole('region', { name: '내 진행 상태' });
  await expect(section.getByRole('radio', { name: '관심 있음' })).toHaveAttribute('aria-checked', 'true');
  await expect(section.getByRole('button', { name: '더 보기 메뉴' })).toHaveCount(0);          // 기록 행이 없으니 지울 것도 없다
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

test('status radio navigation stays in the detail and does not move or read the next notice', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'the global shortcut reads the next notice on desktop');
  await setup(page);
  await page.getByRole('button', { name: '저장하기' }).click();
  const section = page.getByRole('region', { name: '내 진행 상태' });
  const group = section.getByRole('radiogroup');
  const interested = group.getByRole('radio', { name: '관심 있음' });
  const preparing = group.getByRole('radio', { name: '준비 중' });
  const current = page.locator('notice-rows-screen a.row[aria-current="true"]');
  const id = await current.getAttribute('data-id');
  const readRows = () => page.locator('notice-rows-screen a.row.read').evaluateAll((rows) => rows.map((row) => row.getAttribute('data-id')));
  const before = await readRows();

  await section.getByRole('button', { name: '더 보기 메뉴' }).focus();
  await page.keyboard.press('Tab');
  await expect(interested).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(preparing).toBeFocused();
  await expect(current).toHaveAttribute('data-id', id!);
  expect(await readRows()).toEqual(before);
  await expect(interested).toBeChecked();

  await page.keyboard.press('Space');
  await expect(preparing).toBeChecked();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');
  await expect(group.getByRole('radio', { name: '지원함' })).toBeChecked();
  await page.keyboard.press('Tab');
  await expect(section.getByRole('button', { name: '메모 남기기' })).toBeFocused();
});

test('the saved rows keep the feed title alignment and a uniform mobile meta gap', async ({ page }, info) => {
  const mobile = info.project.name === 'mobile';
  if (mobile) await page.setViewportSize({ width: 360, height: 780 });
  await setup(page);
  const id = await page.evaluate(() => {
    const app = document.querySelector('notice-app') as unknown as App;
    const picked = app.visible().slice(0, 4).map((notice: { id: string }, index: number) => ({
      ...notice, category: '비교과', deadline: index % 2 ? '2099-12-31' : null,
    }));
    app.notices = app.notices.map((notice: { id: string }) => picked.find(({ id }: { id: string }) => id === notice.id) ?? notice);
    app.saved = picked.map((notice: { id: string }, index: number) => ({
      ...notice, saved_at: `2026-11-0${index + 1}T00:00:00Z`,
    }));
    app.opportunities = new Map([[picked[0].id, { status: 'preparing' }]]);
    app.openedId = null;
    app.detailOpen = false;
    return picked[0].id as string;
  });
  const rows = page.locator('notice-rows-screen a.row');
  const title = page.locator(`notice-rows-screen a.row[data-id="${id}"] .title`);
  const feedX = (await title.boundingBox())!.x;
  await page.getByRole('navigation', { name: '보기' }).getByRole('button', { name: /^저장(?:$|\s)/ }).click();
  await expect(rows).toHaveCount(4);
  expect((await title.boundingBox())!.x).toBeCloseTo(feedX);
  await expect(rows.locator('.dday')).toHaveCount(2);
  const { status, board, category } = await title.locator('..').evaluate((row) => {
    const rect = (selector: string) => row.querySelector(selector)!.getBoundingClientRect().toJSON() as DOMRect;
    return { status: rect('.status-meta'), board: rect('.board'), category: rect('.cat') };
  });
  if (mobile) {
    expect(status.right).toBeLessThan(board.left);
    expect(board.right).toBeLessThan(category.left);
    expect(status.top).toBe(category.top);
  } else {
    expect(status.top).toBeGreaterThanOrEqual(board.bottom);
    expect(status.top).toBe(category.top);
  }
  const checkMobile = async () => {
    expect(await rows.evaluateAll((elements) => elements.map((row) =>
      row.querySelector('.title')!.getBoundingClientRect().top - row.querySelector('.meta')!.getBoundingClientRect().bottom,
    ))).toEqual([2, 2, 2, 2]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
  };
  if (mobile) await checkMobile();
  await page.getByRole('button', { name: '선택', exact: true }).click();
  await expect(page.locator('.batch-row')).toHaveCount(4);
  if (mobile) await checkMobile();
  else expect((await title.boundingBox())!.x).toBeCloseTo(feedX);
});

// 저장 탭도 다른 탭과 같은 옵션 줄이다: 읽지 않은 공지만 거르기가 같은 자리에 있고, 진행 상태는 그 묶음 끝에 더해진다.
for (const [name, size] of [['pc', { width: 1440, height: 900 }], ['phone', { width: 412, height: 860 }]] as const) {
  test(`saved tab filters like other tabs (${name})`, async ({ page }) => {
    await page.setViewportSize(size);
    await setup(page);
    await saveSome(page, 4, { 0: 'applied', 1: 'preparing' });
    const rows = page.locator('notice-rows-screen a.row');
    await expect(rows).toHaveCount(4);
    // 같은 접근 이름 순서: 다른 탭의 거르기 묶음(읽지 않은 공지만)으로 시작하고 선택·정렬이 오른쪽이다.
    const names = async () => page.locator('.view-options').first().getByRole('button').evaluateAll((els) => els.map((el) => el.getAttribute('aria-label') ?? el.textContent?.trim()));
    const savedNames = await names();
    expect(savedNames[0]).toBe('읽지 않은 공지만');
    expect(savedNames.slice(1)).toEqual([expect.stringMatching(/^진행 상태/), '선택', expect.stringMatching(/^정렬:/)]);
    await page.evaluate(() => (document.querySelector('notice-app') as unknown as App).openTab('all'));
    const otherNames = await names();
    expect(otherNames[0]).toBe('읽지 않은 공지만');
    expect(otherNames.slice(1)).toEqual(['선택', expect.stringMatching(/^정렬:/)]);
    await saveSome(page, 4, { 0: 'applied', 1: 'preparing' });
    // 읽지 않은 공지만 → 읽은 저장 공지가 빠진다.
    await page.evaluate(() => {
      const app = document.querySelector('notice-app') as unknown as App;
      const ids = app.saved.map((n: { id: string }) => n.id);
      const read = new Set(ids.slice(0, 2));
      app.isRead = (n: { id: string }) => read.has(n.id);   // 읽음 저장소 대신 고정 값으로 둔다
      app.requestUpdate?.();
      app.listChanged();
    });
    const unreadBefore = await page.evaluate(() => { const app = document.querySelector('notice-app') as unknown as App; return app.visible().filter((n: unknown) => !app.isRead(n)).length; });
    await page.getByRole('button', { name: '읽지 않은 공지만' }).click();
    await expect(page.getByRole('button', { name: '읽지 않은 공지만' })).toHaveAttribute('aria-pressed', 'true');
    await expect(rows).toHaveCount(unreadBefore);
    // 진행 상태 묶음도 같은 줄에서 조합된다.
    await page.getByRole('button', { name: /^진행 상태: 전체/ }).click();
    await page.getByRole('group', { name: '진행 상태 선택' }).getByRole('button', { name: /지원함/ }).click();
    await expect(page.getByRole('button', { name: '진행 상태: 지원함' })).toBeVisible();
    // 해제하면 거르기만 풀린다(다른 탭과 같은 방식).
    await page.getByRole('button', { name: '읽지 않은 공지만' }).click();
    await expect(page.getByRole('button', { name: '읽지 않은 공지만' })).toHaveAttribute('aria-pressed', 'false');
    await page.getByRole('button', { name: '진행 상태: 지원함' }).click();
    await page.getByRole('group', { name: '진행 상태 선택' }).getByRole('button', { name: /^전체/ }).click();
    await expect(rows).toHaveCount(4);
    const fits = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
    expect(fits).toBe(true);
  });
}
