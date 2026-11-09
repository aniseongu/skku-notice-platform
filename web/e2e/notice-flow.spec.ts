import { test, expect } from '@playwright/test';

test('React notice list opens the detail and settings', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/?api=sample/api/v1');
  const rows = page.locator('notice-rows-screen a.row');
  await expect(rows.first()).toBeVisible();
  await rows.nth(1).click();
  const detail = testInfo.project.name === 'mobile' ? '.reading notice-detail-screen' : '.detail-pane notice-detail-screen';
  await expect(page.locator(`${detail} .detail-title`)).toBeVisible();
  await page.goto('/?view=settings&api=sample/api/v1');
  await expect(page.locator('platform-settings-screen').getByRole('heading', { name: '계정' })).toBeVisible();
  expect(errors).toEqual([]);
});

test('notice HTML is sanitized in React detail', async ({ page }) => {
  await page.goto('/?api=sample/api/v1');
  await page.waitForFunction(() => !!customElements.get('notice-detail-screen'));
  await page.evaluate(() => {
    const el = document.createElement('notice-detail-screen') as HTMLElement & { model: unknown };
    el.id = 'xss-check';
    document.body.append(el);
    el.model = { notice: { id: 'a/1', source_id: 'a', article_no: '1', title: 'test', category: null, url: 'https://example.com', posted_on: '2026-11-01', pinned: false, deadline: null, first_seen: null }, source: 'test', today: '2026-11-07', body: { version: 1, id: 'a/1', summary: null, body: null, body_html: '<p>안전</p><img src=x onerror="window.__xss=1"><a href="javascript:alert(1)">bad</a>', attachments: [], ocr_text: ['<script>악성 내용</script>'], fetched_at: '2026-11-01' }, interests: [], ai: null, rule: null, notified: false, retry() {} };
  });
  await expect(page.locator('#xss-check .rich')).toBeVisible();
  await expect(page.locator('#xss-check [onerror], #xss-check a[href^="javascript:"], #xss-check script')).toHaveCount(0);
  // 자동으로 읽은 글은 글자 그대로(태그가 아닌 글자로) 보인다.
  await expect(page.locator('#xss-check [aria-labelledby="sec-ocr"]')).toContainText('<script>악성 내용</script>');
});

test('detail shows my Gemini summary first in the plain original style and describes pictures by their text', async ({ page }) => {
  // 깨진 그림은 안내 글로 바뀐다(rich.ts). 이 테스트는 그림의 대체 글자를 보므로 그림 요청에 작은 PNG를 돌려준다.
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');
  await page.route('https://www.skku.edu/a.png', (route) => route.fulfill({ status: 200, contentType: 'image/png', body: png }));
  await page.goto('/?api=sample/api/v1');
  await page.waitForFunction(() => !!customElements.get('notice-detail-screen'));
  await page.evaluate(() => {
    const el = document.createElement('notice-detail-screen') as HTMLElement & { model: unknown };
    el.id = 'summary-check';
    document.body.append(el);
    el.model = { notice: { id: 'a/2', source_id: 'a', article_no: '2', title: '졸업요건 안내', category: null, url: 'https://www.skku.edu/x', posted_on: '2026-11-01', pinned: false, deadline: null, first_seen: null },
      source: '학교', today: '2026-11-08', interests: [], ai: null, rule: null, notified: false, retry: () => {},
      mySummary: '재학생이 졸업요건을 확인해요.\n12월 5일까지 제출해요.',
      body: { body: '본문', body_html: null, images: ['https://www.skku.edu/a.png'], ocr_text: ['졸업 요건 안내', '제출 기한 12월 5일'], attachments: [], fetched_at: 'x', body_from_image: false } };
  });
  const detail = page.locator('#summary-check');
  const summary = detail.getByRole('region', { name: '요약' });
  await expect(summary).not.toContainText('내 Gemini');                       // 별도 딱지 없이 원본처럼 글만 보인다
  const style = await summary.evaluate((el) => { const st = getComputedStyle(el); return { left: st.borderLeftWidth, radius: st.borderTopLeftRadius }; });
  expect(style.left).toBe('0px');                                              // 왼쪽 굵은 줄이 없다
  expect(style.radius).toBe('0px');
  await expect(summary).toContainText('12월 5일까지 제출해요.');
  // 요약이 본문보다 앞에 있다.
  const order = await detail.evaluate((root) => [...root.querySelectorAll('section')].map((n) => n.id || n.getAttribute('aria-labelledby') || n.className));
  expect(order[0]).toContain('summary');
  const alt = await detail.locator('img').getAttribute('alt');
  expect(alt).toContain('본문 그림 1');
  expect(alt).toContain('졸업 요건 안내');
});

test('subscription filter keeps only the selected school board', async ({ page }) => {
  await page.goto('/?api=sample/api/v1');
  const rows = page.locator('notice-rows-screen a.row');
  await expect(rows.first()).toBeVisible();
  // 목록이 점진적으로 그려지므로 행 수가 두 번 연속 같을 때까지 기다린 뒤 기준 목록을 잡는다.
  let previous = -1;
  await expect.poll(async () => { const count = await rows.count(); const same = count === previous; previous = count; return same; }, { intervals: [300] }).toBe(true);
  const ids = await rows.evaluateAll((elements) => elements.map((element) => element.getAttribute('data-id') ?? ''));
  const source = ids[0].split('/')[0];
  expect(ids.some((id) => !id.startsWith(`${source}/`))).toBeTruthy();
  await page.evaluate((id) => {
    const app = document.querySelector('notice-app') as HTMLElement & Record<string, unknown>;
    app.authUserId = 'account-a';
    app.subscriptions = [id];
    app.subscriptionsError = '';
    app.subscriptionsLoading = false;
    app.subscriptionsOnly = true;
  }, source);
  await expect.poll(async () => rows.evaluateAll((elements) => elements.map((element) => element.getAttribute('data-id') ?? '')))
    .toEqual(ids.filter((id) => id.startsWith(`${source}/`)));
});

// 앱 상태를 직접 바꿔 컨트롤러와 화면의 실제 연결을 확인한다. 서버 호출이 필요한 동작은 컨트롤러 메서드를 기록용으로 바꾼다.
type AppHandle = Record<string, unknown>;
const withApp = (page: import('@playwright/test').Page, patch: Record<string, unknown>) => page.evaluate((values) => {
  const app = document.querySelector('notice-app') as unknown as AppHandle;
  const w = window as unknown as { calls: unknown[][] };
  w.calls = [];
  for (const [key, value] of Object.entries(values)) {
    app[key] = typeof value === 'string' && value.startsWith('fn:')
      ? (...args: unknown[]) => { w.calls.push([value.slice(3), ...args]); return Promise.resolve(true); }
      : value;
  }
}, patch);
const calls = (page: import('@playwright/test').Page) => page.evaluate(() => (window as unknown as { calls: unknown[][] }).calls);
const settingsAt = async (page: import('@playwright/test').Page, query = '') => {
  await page.goto(`/?view=settings${query}&api=sample/api/v1`);
  await page.locator('platform-settings-screen').waitFor();
  // 앱이 시작할 때 서버 기능 유무를 네트워크로 확인한다. 그 응답이 늦게 와서 테스트가 넣은 상태를 덮어쓰지 않게 기다린다.
  await page.waitForLoadState('networkidle');
};

test('settings hub opens each page in the app, back works and the theme can be changed', async ({ page }) => {
  await settingsAt(page);
  const screen = page.locator('platform-settings-screen');
  for (const name of ['내 설정', '계정', '화면']) await expect(screen.getByRole('heading', { name })).toBeVisible();
  await screen.getByRole('link', { name: /관심 키워드/ }).click();
  await expect(page).toHaveURL(/section=keywords/);
  await expect(screen.getByRole('heading', { name: '관심 키워드' })).toBeVisible();
  await page.goBack();
  await expect(page).not.toHaveURL(/section=/);
  await expect(screen.getByRole('heading', { name: '내 설정' })).toBeVisible();
  await screen.getByRole('radio', { name: '어둡게' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(screen.getByRole('radio', { name: '어둡게' })).toHaveAttribute('aria-checked', 'true');
  await screen.getByRole('radio', { name: '자동' }).click();
  await expect(page.locator('html')).not.toHaveAttribute('data-theme', /.+/);
  await screen.getByRole('link', { name: /알림/ }).first().click();
  await expect(screen.getByRole('link', { name: '설정으로' })).toBeVisible();
  await screen.getByRole('link', { name: '설정으로' }).click();
  await expect(screen.getByRole('heading', { name: '내 설정' })).toBeVisible();
});

test('keywords work like the original: Enter or the button adds, duplicates are ignored and delete is immediate', async ({ page }) => {
  await settingsAt(page, '&section=keywords');
  const screen = page.locator('platform-settings-screen');
  const input = screen.getByRole('textbox', { name: '새 키워드' });
  await input.fill('장학');
  await input.press('Enter');
  await expect(input).toHaveValue('');
  await input.fill('  겨울방학   인턴 ');
  await screen.getByRole('button', { name: '추가하기' }).click();
  await input.fill('장학');
  await input.press('Enter');
  const items = screen.locator('.keyword-list li');
  await expect(items).toHaveText(['장학삭제', '겨울방학 인턴삭제']);
  await expect(screen.getByText('로그인하면 다른 기기와 같은 키워드를 써요')).toBeVisible();
  await screen.getByRole('button', { name: '장학 삭제' }).click();
  await expect(items).toHaveText(['겨울방학 인턴삭제']);
  await page.reload();
  await expect(page.locator('platform-settings-screen .keyword-list li')).toHaveText(['겨울방학 인턴삭제']);
  await expect(page.locator('.sidebar')).toContainText('겨울방학 인턴');
});

test('notification settings show each device state and call the right actions', async ({ page }) => {
  await settingsAt(page, '&section=notifications');
  const screen = page.locator('platform-settings-screen');
  await expect(screen.getByText('로그인하면 이 기기로 알림을 받을 수 있어요')).toBeVisible();
  await withApp(page, { authUserId: 'account-a', pushStatus: 'off', subscriptions: [], enablePush: 'fn:enable', disablePush: 'fn:disable', testNotification: 'fn:test' });
  await expect(screen.locator('.setting-state')).toContainText('꺼져 있어요');
  await screen.getByRole('button', { name: '알림 받기' }).click();
  expect(await calls(page)).toEqual([['enable']]);
  await withApp(page, { pushStatus: 'on' });
  await expect(screen.locator('.setting-state')).toContainText('켜져 있어요');
  await expect(screen.getByText('받을 게시판을 고르면 새 공지를 알려드려요')).toBeVisible();
  await screen.getByRole('button', { name: '테스트 알림 띄우기' }).click();
  await screen.getByRole('button', { name: '알림 끄기' }).click();
  expect(await calls(page)).toEqual([['test'], ['disable']]);
  await withApp(page, { pushStatus: 'checking' });
  await expect(screen.getByRole('button', { name: '확인하고 있어요' })).toBeDisabled();
  await withApp(page, { pushStatus: 'denied' });
  await expect(screen.getByText('브라우저 설정에서 알림을 허용하면 다시 켤 수 있어요')).toBeVisible();
  await withApp(page, { pushStatus: 'off', pushRetry: true, pushError: '알림을 켜지 못했어요. 다시 시도하면 이어서 진행해요.' });
  await expect(screen.getByRole('alert')).toContainText('다시 시도');
  await screen.getByRole('button', { name: '다시 시도하기' }).click();
  expect(await calls(page)).toEqual([['enable']]);
});

test('board subscriptions are switches grouped by college with search', async ({ page }) => {
  await settingsAt(page, '&section=notifications');
  const screen = page.locator('platform-settings-screen');
  await withApp(page, { authUserId: 'account-a', subscriptions: ['skku-notice01'], toggleSubscription: 'fn:toggle' });
  const mine = screen.getByRole('switch', { checked: true });
  await expect(mine).toHaveCount(1);
  await expect(mine.first()).toContainText('켜짐');
  await mine.first().click();
  await screen.locator('details.connection-manual > summary').click();
  const more = screen.getByRole('switch', { checked: false });
  await expect(more.first()).toBeVisible();
  const search = screen.getByRole('searchbox', { name: '게시판 검색' });
  await search.fill('없는게시판이름');
  await expect(screen.getByText("'없는게시판이름'에 맞는 게시판이 없어요")).toBeVisible();
  await search.fill('');
  await more.first().click();
  const recorded = await calls(page);
  expect(recorded[0]).toEqual(['toggle', 'skku-notice01', false]);
  expect(recorded[1][0]).toBe('toggle');
  expect(recorded[1][2]).toBe(true);
});

test('profile page edits year and status in place and can reopen the first-run setup', async ({ page }) => {
  await settingsAt(page, '&section=profile');
  const screen = page.locator('platform-settings-screen');
  // CI에는 Supabase 환경 변수가 없다. 설정된 환경에서는 로그인 버튼, 없는 환경에서는 안내가 보인다.
  await expect(screen.getByRole('button', { name: 'Google 계정으로 계속하기' }).or(
    screen.getByText('지금은 로그인할 수 없어요. 잠시 뒤 다시 열어 주세요'))).toBeVisible();
  const profile = { programs: [{ college: '소프트웨어융합대학', department: '소프트웨어학과' }, { college: '경영대학', department: '경영학과' }],
    year: 3, semester: null, enrollmentStatus: '재학', militaryService: null, onboardedAt: '2026-11-07T00:00:00Z' };
  await withApp(page, { authUserId: 'account-a', profile, profileStatus: 'ready', saveProfile: 'fn:save', openOnboarding: 'fn:open' });
  await expect(screen.getByText('소프트웨어학과 (소프트웨어융합대학)')).toBeVisible();
  await withApp(page, { profileStatus: 'unavailable' });
  await expect(screen.getByRole('radio', { name: '4학년' })).toBeDisabled();
  await expect(screen.getByText('지금은 프로필을 불러올 수 없어요. 잠시 뒤 다시 열어 주세요')).toBeVisible();
  await withApp(page, { profileStatus: 'ready', profileError: '저장하지 못했어요. 잠시 뒤 다시 시도해 주세요.' });
  await expect(screen.getByRole('alert')).toContainText('다시 시도');
  await withApp(page, { profileError: '', saveProfile: 'fn:save', openOnboarding: 'fn:open' });
  await expect(screen.getByText('경영학과', { exact: true })).toBeVisible();
  await expect(screen.getByRole('radio', { name: '3학년' })).toHaveAttribute('aria-checked', 'true');
  await screen.getByRole('radio', { name: '4학년' }).click();
  await screen.getByRole('radio', { name: '휴학' }).click();
  await screen.getByRole('button', { name: '전공과 게시판 다시 고르기' }).click();
  const recorded = await calls(page);
  expect(recorded[0]).toEqual(['save', { ...profile, year: 4 }]);
  expect(recorded[1]).toEqual(['save', { ...profile, enrollmentStatus: '휴학' }]);
  expect(recorded[2]).toEqual(['open']);
});

test('connection keys page follows the original rows: Gemini key and iCampus token flows, no profile fields', async ({ page }) => {
  await settingsAt(page, '&keys=1');
  const screen = page.locator('platform-settings-screen');
  await withApp(page, { authUserId: 'account-a', byokOn: false, registerKey: 'fn:register', removeKey: 'fn:remove', registerCanvas: 'fn:registerCanvas', removeCanvas: 'fn:removeCanvas', profileStatus: 'ready', onboardingDismissed: true });
  // 서버 기능이 아직 없을 때도 줄은 보이고 이유를 알려 준다.
  await expect(screen.getByRole('heading', { name: '연결 키' })).toBeVisible();
  await expect(screen.locator('.setting', { hasText: 'Gemini 키' }).getByText('준비 중')).toBeVisible();
  await expect(screen.locator('.setting', { hasText: '아이캠퍼스 토큰' }).getByText('준비 중')).toBeVisible();
  await expect(screen.getByLabel('Gemini 키', { exact: true })).toHaveCount(0);
  // 학기·병역 같은 프로필은 프로필 설정에서 바꾼다. 연결 키 쪽에는 두지 않는다.
  await expect(screen.getByRole('radio', { name: '2학기' })).toHaveCount(0);
  await expect(screen.getByRole('radio', { name: '복무 전' })).toHaveCount(0);
  await withApp(page, { byokOn: true, byokLoading: false, byokStatus: null });
  await expect(screen.locator('.setting', { hasText: 'Gemini 키' }).getByText('미설정')).toBeVisible();
  await expect(screen.locator('.setting', { hasText: '아이캠퍼스 토큰' }).getByText('미설정')).toBeVisible();
  await screen.getByRole('button', { name: 'Gemini 키 입력하기' }).click();
  const save = screen.getByRole('button', { name: '저장하기' });
  await expect(save).toBeDisabled();
  const key = `AIza${'D'.repeat(35)}`;
  const input = screen.getByLabel('Gemini 키', { exact: true });
  await expect(input).toHaveAttribute('type', 'password');
  await input.fill(key);
  await screen.getByRole('button', { name: '보기' }).click();
  await expect(input).toHaveAttribute('type', 'text');
  await screen.getByRole('button', { name: '숨기기' }).click();
  await screen.getByText('받는 방법').click();
  await expect(screen.getByRole('link', { name: /Google AI Studio/ })).toHaveAttribute('href', 'https://aistudio.google.com/apikey');
  await save.click();
  expect(await calls(page)).toEqual([['register', key]]);
  await withApp(page, { byokStatus: { keyHint: 'DDDD', model: 'm', disabled: false, lastError: null, usedToday: 0 } });
  await expect(screen.getByText('저장됨 ····DDDD')).toBeVisible();
  expect(await screen.innerText()).not.toContain(key);
  await expect(screen.getByLabel('Gemini 키', { exact: true })).toHaveCount(0);
  await withApp(page, { byokStatus: { keyHint: 'DDDD', model: 'm', disabled: true, lastError: 'Gemini가 이 키를 받아 주지 않아요. 키를 다시 등록해 주세요.', usedToday: 0 } });
  await expect(screen.getByRole('alert')).toContainText('다시 등록');
  await screen.getByRole('button', { name: 'Gemini 키 지우기' }).click();
  expect(await calls(page)).toEqual([['remove']]);
  // 아이캠퍼스 토큰도 같은 흐름이다. 형식이 맞지 않으면 저장할 수 없다.
  await withApp(page, {});
  await screen.getByRole('button', { name: '아이캠퍼스 토큰 입력하기' }).click();
  const canvasInput = screen.getByLabel('아이캠퍼스 토큰', { exact: true });
  await expect(canvasInput).toHaveAttribute('type', 'password');
  await canvasInput.fill('짧음');
  await expect(screen.getByRole('button', { name: '저장하기' })).toBeDisabled();
  const token = `1234~${'Z'.repeat(40)}`;
  await canvasInput.fill(token);
  await screen.getByText('받는 방법').click();
  await expect(screen.getByRole('link', { name: /아이캠퍼스 계정 설정/ })).toHaveAttribute('href', 'https://canvas.skku.edu/profile/settings');
  await screen.getByRole('button', { name: '저장하기' }).click();
  expect(await calls(page)).toEqual([['registerCanvas', token]]);
  await withApp(page, { canvasStatus: { keyHint: 'ZZZZ', disabled: false, lastError: null, lastOkAt: null } });
  await expect(screen.getByText('저장됨 ····ZZZZ')).toBeVisible();
  expect(await screen.innerText()).not.toContain(token);
  await withApp(page, {});
  await screen.getByRole('button', { name: '아이캠퍼스 토큰 지우기' }).click();
  expect(await calls(page)).toEqual([['removeCanvas']]);
});

test('settings items live in the right place: list scope under display, profile fields together, shortcuts jump to the page', async ({ page }) => {
  await settingsAt(page);
  const screen = page.locator('platform-settings-screen');
  await expect(screen.getByRole('radiogroup', { name: '목록 보기' })).toHaveCount(0);
  await withApp(page, { authUserId: 'account-a', profileStatus: 'ready', onboardingDismissed: true, subscriptionsOnly: false });
  // 목록 보기는 알림이 아니라 화면 설정이다.
  const view = screen.locator('section', { has: page.getByRole('heading', { name: '화면' }) });
  await expect(view.getByRole('radiogroup', { name: '목록 보기' })).toBeVisible();
  await view.getByRole('radio', { name: '받는 게시판만' }).click();
  expect(await page.evaluate(() => (document.querySelector('notice-app') as unknown as { subscriptionsOnly: boolean }).subscriptionsOnly)).toBe(true);
  await screen.getByRole('link', { name: /알림/ }).first().click();
  await expect(screen.getByRole('radiogroup', { name: '목록 보기' })).toHaveCount(0);
  // 학년·학기·재학 상태·병역은 프로필 설정 한 곳에 있다.
  await screen.getByRole('link', { name: '설정으로' }).click();
  await screen.getByRole('link', { name: /프로필 설정/ }).click();
  for (const name of ['학년', '학기', '재학 상태', '병역']) await expect(screen.getByRole('radiogroup', { name })).toBeVisible();
  // 사이드바의 "키워드 추가하기"는 설정 첫 쪽이 아니라 키워드 쪽으로 바로 간다.
  await page.goto('/?api=sample/api/v1');
  await page.locator('notice-rows-screen a.row').first().waitFor();
  await page.locator('.sidebar .side-item.add:visible, .chip-add:visible').first().click();
  await expect(page).toHaveURL(/section=keywords/);
  await expect(page.locator('platform-settings-screen').getByRole('textbox', { name: '새 키워드' })).toBeVisible();
  await page.goBack();
  await expect(page).not.toHaveURL(/view=settings/);
});

test('first-run setup: choices only, department list follows the college, double major is optional and the draft is what gets saved', async ({ page }) => {
  await page.goto('/?api=sample/api/v1');
  await page.locator('notice-rows-screen a.row').first().waitFor();
  await page.evaluate(() => {
    const app = document.querySelector('notice-app') as unknown as Record<string, unknown>;
    const w = window as unknown as { calls: unknown[][] };
    w.calls = [];
    app.finishOnboarding = (draft: unknown) => { w.calls.push(['finish', draft]); return Promise.resolve(true); };
    app.closeOnboarding = () => { w.calls.push(['close']); app.onboardingOpen = false; app.profile = { ...(app.profile as object), onboardedAt: 'x' }; };
    app.enablePush = () => { w.calls.push(['push']); return Promise.resolve(); };
    app.profile = { programs: [], year: null, semester: null, enrollmentStatus: null, militaryService: null, onboardedAt: null };
    app.profileStatus = 'ready';
    app.pushStatus = 'off';
    app.authUserId = 'account-a';
  });
  const dialog = page.getByRole('dialog');
  await expect(page.locator('.app')).toHaveAttribute('inert', '');
  await expect(dialog.getByRole('heading', { name: '주전공이 어디예요?' })).toBeFocused();
  await expect(dialog.getByRole('heading', { name: '주전공이 어디예요?' })).toBeVisible();
  await expect(dialog.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '1');
  const barWidth1 = (await dialog.getByRole('progressbar').boundingBox())!.width;
  // 대학 → 학과: 고른 대학의 학과만 보인다.
  await dialog.getByRole('button', { name: '소프트웨어융합대학', exact: true }).click();
  // 질문 제목이 접히지 않고 보여야 한다(전역 h1 규칙이 제목 높이를 0으로 만들던 결함의 재발 방지).
  const title = dialog.getByRole('heading', { name: '주전공이 어디예요?' });
  expect((await title.boundingBox())!.height).toBeGreaterThan(20);
  await expect(dialog.getByRole('radio', { name: '소프트웨어학과', exact: true })).toBeVisible();
  await expect(dialog.getByRole('radio', { name: '국어국문학과', exact: true })).toHaveCount(0);
  await dialog.getByRole('button', { name: '다른 대학 고르기' }).click();
  await dialog.getByRole('button', { name: '문과대학', exact: true }).click();
  await expect(dialog.getByRole('searchbox', { name: '학과 검색' })).toBeVisible();
  await dialog.getByRole('searchbox', { name: '학과 검색' }).fill('철학');
  await expect(dialog.getByRole('radio', { name: '철학과', exact: true })).toBeVisible();
  await expect(dialog.getByRole('radio', { name: '사학과', exact: true })).toHaveCount(0);
  await dialog.getByRole('button', { name: '다른 대학 고르기' }).click();
  await dialog.getByRole('button', { name: '소프트웨어융합대학', exact: true }).click();
  // 학과는 고르기만 하고 아래 다음이 확정한다(자동으로 넘어가지 않는다).
  await expect(dialog.getByRole('button', { name: '다음' })).toBeDisabled();
  await dialog.getByRole('radio', { name: '소프트웨어학과', exact: true }).click();
  await expect(dialog.getByRole('heading', { name: '주전공이 어디예요?' })).toBeVisible();
  await expect(dialog.getByRole('radio', { name: '소프트웨어학과', exact: true })).toHaveAttribute('aria-checked', 'true');
  await dialog.getByRole('button', { name: '다음' }).click();
  // 복수전공은 선택이다.
  await expect(dialog.getByRole('heading', { name: '복수전공이 있나요?' })).toBeFocused();
  await expect(dialog.getByRole('radiogroup', { name: '복수전공 선택' }).getByRole('radio')).toHaveCount(2);
  await expect(dialog.getByRole('button', { name: '다음' })).toBeDisabled();
  await expect(dialog.getByRole('progressbar')).toHaveAttribute('aria-valuetext', '6단계 중 2단계');
  expect(Math.abs((await dialog.getByRole('progressbar').boundingBox())!.width - barWidth1)).toBeLessThanOrEqual(0.5);
  await dialog.getByRole('radio', { name: '있어요', exact: true }).click();
  await dialog.getByRole('button', { name: '경영대학', exact: true }).click();
  await expect(dialog.getByRole('button', { name: '다음' })).toBeDisabled();
  await dialog.getByRole('radio', { name: '경영학과', exact: true }).click();
  await dialog.getByRole('button', { name: '다음' }).click();
  // 학년·재학 상태: 재학이 미리 골라져 있고 학년을 골라야 넘어간다.
  await expect(dialog.getByRole('button', { name: '재학', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(dialog.getByRole('button', { name: '다음' })).toBeDisabled();
  await dialog.getByRole('button', { name: '3학년' }).click();
  await dialog.getByRole('button', { name: '다음' }).click();
  // 게시판·키워드: 내 전공에 맞춰 추천이 켜져 있다.
  await expect(dialog.getByRole('heading', { name: '어떤 공지를 받을까요?' })).toBeFocused();
  await expect(dialog.getByText('추천', { exact: true })).toHaveCount(0);
  await expect(dialog.getByRole('switch', { name: /^성균관대 공지/ })).toHaveAttribute('aria-checked', 'true');
  await expect(dialog.getByRole('switch', { name: /^소프트웨어학과 공지/ })).toHaveAttribute('aria-checked', 'true');
  expect((await dialog.getByRole('button', { name: '장학' }).boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await dialog.getByRole('button', { name: '장학' }).click();
  await dialog.getByRole('button', { name: '다음' }).click();
  // 기타 게시판은 전공 게시판 다음에 나온다. 부트캠프 게시판을 고를 수 있고, 건너뛰어도 된다.
  await expect(dialog.getByRole('heading', { name: '전공과 상관없는 게시판도 받을까요?' })).toBeVisible();
  await expect(dialog.getByRole('switch', { name: /수강 모집과 행사 안내/ })).toHaveAttribute('aria-checked', 'false');
  await dialog.getByRole('switch', { name: /수강 모집과 행사 안내/ }).click();
  await dialog.getByRole('button', { name: '다음' }).click();
  const saved = (await calls(page)).find((call) => call[0] === 'finish')![1] as Record<string, unknown>;
  expect(saved).toMatchObject({
    programs: [{ college: '소프트웨어융합대학', department: '소프트웨어학과' }, { college: '경영대학', department: '경영학과' }],
    year: 3, enrollmentStatus: '재학', keywords: ['장학'],
  });
  expect(saved.boards).toEqual(expect.arrayContaining(['skku-notice01', 'cse-notice', 'futurecar-notice']));
  // 알림은 나중에 해도 된다.
  await expect(dialog.getByRole('heading', { name: '알림을 켜 둘까요?' })).toBeFocused();
  await dialog.getByRole('button', { name: '나중에 할게요' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('.app')).not.toHaveAttribute('inert', '');
});

test('first-run setup can be skipped and then stays out of the way; it can be reopened from settings', async ({ page }) => {
  await page.goto('/?api=sample/api/v1');
  await page.locator('notice-rows-screen a.row').first().waitFor();
  await page.evaluate(() => {
    const app = document.querySelector('notice-app') as unknown as Record<string, unknown>;
    app.profile = { programs: [], year: null, semester: null, enrollmentStatus: null, militaryService: null, onboardedAt: null };
    app.profileStatus = 'ready';
    app.authUserId = 'account-a';
  });
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: '나중에 하기' }).click();
  await expect(dialog).toHaveCount(0);
  await page.evaluate(() => { (document.querySelector('notice-app') as unknown as { profileStatus: string }).profileStatus = 'ready'; });
  await expect(dialog).toHaveCount(0);
  await page.goto('/?view=settings&section=profile&api=sample/api/v1');
  await page.locator('platform-settings-screen').waitFor();
  await page.evaluate(() => {
    const app = document.querySelector('notice-app') as unknown as Record<string, unknown>;
    app.profileStatus = 'ready'; app.authUserId = 'account-a'; app.onboardingDismissed = true;
  });
  await page.getByRole('button', { name: '전공과 게시판 다시 고르기' }).click();
  await expect(dialog.getByRole('button', { name: '닫기' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
});

test('refresh button and R refetch the notice list, lock while loading, and keep the list with a message on failure', async ({ page }) => {
  let hits = 0;
  let mode: 'ok' | 'slow' | 'fail' = 'ok';
  await page.route('**/notices.json', async (route) => {
    hits++;
    if (mode === 'fail') { await route.fulfill({ status: 500, body: 'error' }); return; }
    const res = await route.fetch();
    const data = await res.json();
    if (hits >= 2 && mode === 'ok') data.notices[0].title = `[새로 가져옴] ${data.notices[0].title}`;
    if (mode === 'slow') await new Promise((resolve) => setTimeout(resolve, 800));
    await route.fulfill({ response: res, json: data });
  });
  await page.goto('/?api=sample/api/v1');
  const rows = page.locator('notice-rows-screen a.row');
  await rows.first().waitFor();
  const button = page.getByRole('button', { name: '공지 다시 가져오기' });
  const first = hits;
  await button.click();
  await expect.poll(() => hits).toBeGreaterThan(first);
  await expect(rows.first()).toContainText('[새로 가져옴]');           // 새로 받은 내용으로 바뀐다
  mode = 'slow';
  await button.click();
  await expect(button).toBeDisabled();                                // 받는 동안은 다시 누를 수 없다
  await expect(button).toBeEnabled();
  mode = 'ok';
  const beforeKey = hits;
  await page.locator('.list-pane').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('r');                                     // R 키도 같은 일을 한다
  await expect.poll(() => hits).toBeGreaterThan(beforeKey);
  mode = 'fail';
  const count = await rows.count();
  await button.click();
  await expect(page.getByText('새 목록을 받지 못했어요')).toBeVisible();
  expect(await rows.count()).toBe(count);                             // 실패해도 지금 목록은 그대로다
});

test('settings opened straight from the side menu shortcut closes with one X instead of showing the settings home', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'mobile', '왼쪽 메뉴는 넓은 화면에만 있다');
  const list = page.locator('notice-rows-screen a.row').first();
  await page.goto('/?api=sample/api/v1');
  await list.waitFor();
  await page.locator('.side-item.add').first().click();          // 키워드 관리하기(키워드가 없으면 추가하기)
  await expect(page).toHaveURL(/section=keywords/);
  await page.getByRole('button', { name: '설정 닫기' }).first().click();
  await expect(page).not.toHaveURL(/view=settings/);
  await expect(list).toBeVisible();
  await expect(page.locator('platform-settings-screen')).toHaveCount(0);
});

test('sidebar keyword shortcut opened from inside settings still closes back to the list with one X', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'mobile', '왼쪽 메뉴는 PC에만 있다');
  const list = page.locator('notice-rows-screen a.row').first();
  await page.goto('/?api=sample/api/v1');
  await list.waitFor();
  await page.locator('.side-foot .side-item').click();
  await page.locator('platform-settings-screen').getByRole('link', { name: /알림/ }).first().click();
  await page.getByRole('button', { name: /키워드 (관리|추가)하기/ }).first().click();
  await expect(page).toHaveURL(/section=keywords/);
  await page.getByRole('button', { name: '설정 닫기' }).first().click();
  await expect(page).not.toHaveURL(/view=settings/);
  await expect(list).toBeVisible();
});

test('settings X goes up one level and leaves settings only from the first page, every time settings is entered', async ({ page }, testInfo) => {
  const mobile = testInfo.project.name === 'mobile';
  const screen = page.locator('platform-settings-screen');
  const list = page.locator('notice-rows-screen a.row').first();
  const openSettings = () => (mobile ? page.getByRole('button', { name: '설정', exact: true }).click() : page.locator('.side-foot .side-item').click());
  // 데스크톱은 X, 모바일은 뒤로 가기 화살표가 같은 일을 한다(하위 쪽에서는 첫 쪽으로, 첫 쪽에서는 닫기).
  const up = () => (mobile ? page.getByRole('button', { name: '설정으로 돌아가기' }) : page.getByRole('button', { name: '설정으로 돌아가기' }).first());
  const close = () => page.getByRole('button', { name: '설정 닫기' }).first();
  const hub = () => expect(screen.getByRole('heading', { name: '내 설정' })).toBeVisible();
  await page.goto('/?api=sample/api/v1');
  await list.waitFor();
  for (let round = 1; round <= 2; round++) {          // 나갔다가 다시 들어와도 같게 동작한다
    await openSettings();
    await screen.getByRole('link', { name: /알림/ }).first().click();
    await expect(page).toHaveURL(/section=notifications/);
    await up().click();                                  // X: 하위 쪽 → 설정 첫 쪽
    await hub();
    await expect(page).toHaveURL(/view=settings/);
    await expect(page).not.toHaveURL(/section=/);
    await close().click();                               // X: 첫 쪽 → 나가기
    await expect(page).not.toHaveURL(/view=settings/);
    await expect(list).toBeVisible();
    await expect(screen).toHaveCount(0);
  }
  // 하위 쪽을 여러 번 거쳐도 X는 한 번에 한 단계씩이다(알림 → 설정으로 → 키워드 → X → X).
  await openSettings();
  await screen.getByRole('link', { name: /알림/ }).first().click();
  await screen.getByRole('link', { name: '설정으로' }).click();
  await screen.getByRole('link', { name: /관심 키워드/ }).click();
  await up().click();
  await hub();
  await close().click();
  await expect(page).not.toHaveURL(/view=settings/);
  await expect(list).toBeVisible();
  // 주소로 바로 들어와도 X 한 번은 첫 쪽, 두 번째가 나가기다.
  await page.goto('/?view=settings&section=keywords&api=sample/api/v1');
  await screen.waitFor();
  await up().click();
  await hub();
  await close().click();
  await expect(page).not.toHaveURL(/view=settings/);
  await expect(list).toBeVisible();
  // Esc도 같다.
  await openSettings();
  await screen.getByRole('link', { name: /알림/ }).first().click();
  await page.keyboard.press('Escape');
  await hub();
  await page.keyboard.press('Escape');
  await expect(page).not.toHaveURL(/view=settings/);
  await expect(list).toBeVisible();
});

test('first-run setup layout: header and body share one column, the close control stays inside it and the bar items are centered together', async ({ page }) => {
  await page.goto('/?api=sample/api/v1');
  await page.locator('notice-rows-screen a.row').first().waitFor();
  await page.waitForLoadState('networkidle');
  const open = (manual: boolean) => page.evaluate((isManual) => {
    const app = document.querySelector('notice-app') as unknown as Record<string, unknown>;
    app.profile = { programs: [], year: null, semester: null, enrollmentStatus: null, militaryService: null, onboardedAt: isManual ? 'x' : null };
    app.profileStatus = 'ready'; app.authUserId = 'account-a'; app.onboardingDismissed = false;
    if (isManual) (app.openOnboarding as () => void)();
  }, manual);
  const box = async (selector: string) => (await page.locator(selector).first().boundingBox())!;
  for (const manual of [false, true]) {
    await open(manual);
    const dialog = page.getByRole('dialog');
    await dialog.waitFor();
    await dialog.getByRole('button', { name: '문과대학', exact: true }).scrollIntoViewIfNeeded();   // 아래로 스크롤된 상태에서도 어긋나지 않아야 한다
    const top = await box('.onb-top-inner'), body = await box('.onb-body');
    expect(Math.abs(top.x - body.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(top.width - body.width)).toBeLessThanOrEqual(1);
    const close = manual ? dialog.getByRole('button', { name: '닫기' }) : dialog.getByRole('button', { name: '나중에 하기' });
    const closeBox = (await close.boundingBox())!;
    expect(closeBox.x + closeBox.width).toBeLessThanOrEqual(top.x + top.width + 0.5);
    expect(closeBox.height).toBeGreaterThanOrEqual(44);
    expect(await close.evaluate((el) => getComputedStyle(el).borderTopWidth)).toBe('1px');   // 글자만이 아니라 테두리 있는 버튼으로 보인다
    // 넓은 화면: 왼쪽에 앱 아이콘·이름과 단계 목록, 오른쪽에 선택 영역. 좁은 화면: 왼쪽 칸은 숨긴다.
    const wide = (page.viewportSize()?.width ?? 0) >= 900;
    if (wide) {
      const brand = await box('.onb-brand'), main = await box('.onb-main');
      expect(brand.x).toBeLessThan(main.x);
      expect(brand.x + brand.width).toBeLessThanOrEqual(main.x + 1);
      await expect(page.locator('.onb-brand-lockup')).toHaveText('성공');
      await expect(page.locator('.onb-brand-lockup svg')).toBeVisible();
      await expect(page.locator('.onb-steplist li[data-state="current"]')).toContainText('주전공');
    } else {
      await expect(page.locator('.onb-brand')).toBeHidden();
    }
    const bar = await box('.onb-progress');
    const centerY = (b: { y: number; height: number }) => b.y + b.height / 2;
    expect(Math.abs(centerY(closeBox) - centerY(bar))).toBeLessThanOrEqual(2);
    // 위 줄은 스크롤해도 붙어 있다.
    const before = (await box('.onb-top-inner')).y;
    await page.evaluate(() => document.querySelector('.onb-main')!.scrollTo({ top: 400 }));
    expect(Math.abs((await box('.onb-top-inner')).y - before)).toBeLessThanOrEqual(1);
    await close.click();
    await expect(dialog).toHaveCount(0);
  }
});

test('left board list shows only chosen boards, falls back to boards with notices, keeps the current one and links to more', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'mobile', '사이드바는 넓은 화면에서만 보인다');
  await page.goto('/?api=sample/api/v1');
  await page.locator('notice-rows-screen a.row').first().waitFor();
  await page.waitForLoadState('networkidle');
  const labels = () => page.locator('#side-boards .side-item').evaluateAll((items) => items.map((item) => (item as HTMLElement).innerText.replace(/\s+/g, ' ').trim()));
  await page.evaluate(() => {
    const app = document.querySelector('notice-app') as unknown as { sources: { id: string; name: string; url: string }[] };
    const extra = [['korean-notice', '국어국문학과 공지'], ['biz-notice', '경영대학 공지'], ['art-notice', '예술대학 공지'], ['enc-notice', '공과대학 공지']]
      .map(([id, name]) => ({ id, name, url: `https://${id}.skku.edu/` }));
    app.sources = [...app.sources, ...extra];
  });
  // 로그인 전: 등록된 학과 게시판이 수십 개여도 공지가 있는 기본 게시판만 나온다.
  let list = await labels();
  expect(list[0]).toBe('모든 게시판');
  expect(list.some((label) => label.includes('경영대학') || label.includes('공과대학'))).toBe(false);
  expect(list.length).toBeLessThanOrEqual(4);
  // 로그인해서 구독했으면 구독한 게시판만 나온다(처음 설정을 마쳤다면 전공에 맞춰 추천된 것).
  await page.evaluate(() => {
    const app = document.querySelector('notice-app') as unknown as Record<string, unknown>;
    app.authUserId = 'account-a'; app.subscriptions = ['korean-notice', 'biz-notice']; app.subscriptionsLoading = false;
  });
  list = await labels();
  expect(list).toEqual(['모든 게시판', '국어국문학과', '경영대학', '게시판 더 고르기']);
  // 지금 보고 있는 게시판은 구독이 아니어도 사라지지 않는다.
  await page.evaluate(() => { (document.querySelector('notice-app') as unknown as { board: string }).board = 'enc-notice'; });
  expect(await labels()).toContain('공과대학');
  // "게시판 더 고르기"는 설정의 알림 쪽으로 바로 간다.
  await page.locator('#side-boards').getByRole('button', { name: '게시판 더 고르기' }).click();
  await expect(page).toHaveURL(/section=notifications/);
  // 누르자마자 접힌 게시판 목록이 펼쳐지고 화면 안으로 스크롤된다.
  const more = page.locator('details.board-more-list');
  await expect(more).toHaveJSProperty('open', true);
  await expect(more.getByRole('searchbox', { name: '게시판 검색' })).toBeInViewport();
});

test('account shows an icon, name and email and leads to profile settings where free text for Gemini is written and saved', async ({ page }) => {
  await settingsAt(page);
  const screen = page.locator('platform-settings-screen');
  const onePixel = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
  const profile = { programs: [{ college: '경영대학', department: '경영학과' }], year: 2, semester: null, enrollmentStatus: '재학', militaryService: null,
    onboardedAt: 'x', interests: '', wants: '', avoids: '' };
  await withApp(page, { authUserId: 'account-a', authEmail: 'student@g.skku.edu', authName: '홍길동', authAvatar: null, profile, profileStatus: 'ready', onboardingDismissed: true, saveProfile: 'fn:save' });
  // 사진이 없으면 인스타그램처럼 기본 사람 모양이 보인다.
  const account = screen.locator('.account-row');
  await expect(account).toContainText('홍길동');
  await expect(account).toContainText('student@g.skku.edu');
  await expect(account.locator('.avatar svg')).toBeVisible();
  await expect(account.locator('.avatar img')).toHaveCount(0);
  // 사진이 실제로 불러와지면 사진으로 바뀐다. 불러오지 못하면 기본 모양을 유지한다.
  await withApp(page, { authAvatar: onePixel });
  await expect(account.locator('.avatar img')).toBeVisible();
  await withApp(page, { authAvatar: 'https://invalid.invalid/photo.png' });
  await expect(account.locator('.avatar svg')).toBeVisible();
  await expect(account.locator('.avatar img')).toHaveCount(0);
  // 계정 아래의 프로필 설정으로 들어간다.
  await screen.getByRole('link', { name: /프로필 설정/ }).click();
  await expect(page).toHaveURL(/section=profile/);
  await expect(page.getByRole('heading', { name: '프로필 설정', level: 1 })).toBeVisible();
  await expect(screen.locator('.profile-hero')).toContainText('홍길동');
  // Gemini에게 알려 줄 주관식: 글자 수를 세고, 바뀐 뒤에만 저장할 수 있으며, 300자를 넘으면 막는다.
  const interests = screen.getByRole('textbox', { name: '관심 분야' });
  const save = screen.getByRole('button', { name: '저장하기' });
  await expect(save).toBeDisabled();
  await expect(screen.getByText('이름, 학번, 연락처, 주소는 적지 마세요', { exact: false })).toBeVisible();
  await interests.fill('  인공지능, 백엔드 개발  ');
  await screen.getByRole('textbox', { name: '받고 싶은 공지' }).fill('학부생 인턴');
  await expect(screen.locator('#count-interests')).toHaveText('12/300');
  await expect(save).toBeEnabled();
  await save.click();
  expect((await calls(page)).at(-1)).toEqual(['save', { ...profile, interests: '인공지능, 백엔드 개발', wants: '학부생 인턴', avoids: '' }]);
  await screen.getByRole('textbox', { name: '받고 싶지 않은 공지' }).fill('가'.repeat(301));
  await expect(screen.locator('#count-avoids')).toHaveText('301/300');
  await expect(save).toBeDisabled();
  await expect(screen.getByRole('alert')).toContainText('300자 이하');
  // 프로필을 불러오기 전에는 입력을 막는다.
  await withApp(page, { profileStatus: 'unavailable' });
  await expect(interests).toBeDisabled();
});

test('the side menu has no profile entry; the profile lives inside settings, and the menu item always leads to the settings home', async ({ page }, testInfo) => {
  const mobile = testInfo.project.name === 'mobile';
  await page.goto('/?api=sample/api/v1');
  await page.locator('notice-rows-screen a.row').first().waitFor();
  await page.waitForLoadState('networkidle');
  // 왼쪽 메뉴와 모바일 상단에는 프로필 항목이 없다.
  await expect(page.locator('.side-profile, .avatar-button')).toHaveCount(0);
  await page.evaluate(() => {
    const app = document.querySelector('notice-app') as unknown as Record<string, unknown>;
    app.authUserId = 'account-a'; app.authName = '홍길동'; app.authEmail = 'a@skku.edu';
    app.profile = { programs: [], year: null, semester: null, enrollmentStatus: null, militaryService: null, onboardedAt: 'x', interests: '', wants: '', avoids: '' };
    app.profileStatus = 'ready'; app.onboardingDismissed = true;
  });
  const screen = page.locator('platform-settings-screen');
  const menu = () => (mobile ? page.getByRole('button', { name: '설정', exact: true }) : page.locator('.side-foot .side-item'));
  await menu().click();
  // 설정 안의 계정 줄에 아이콘과 이름, 프로필 설정이 있다.
  await expect(screen.locator('.account-row .avatar svg')).toBeVisible();
  await expect(screen.locator('.account-row')).toContainText('홍길동');
  await screen.getByRole('link', { name: /프로필 설정/ }).first().click();
  await expect(page).toHaveURL(/section=profile/);
  await expect(screen.getByRole('heading', { name: '학교 정보' })).toBeVisible();
  if (!mobile) {
    // 프로필 설정 쪽에서 왼쪽 "설정"을 누르면 설정 첫 쪽으로 돌아온다(예전에는 아무 일도 없었다).
    await menu().click();
    await expect(page).not.toHaveURL(/section=/);
    await expect(screen.getByRole('heading', { name: '내 설정' })).toBeVisible();
    // 첫 쪽에서 한 번 더 눌러도 그대로다.
    await menu().click();
    await expect(screen.getByRole('heading', { name: '내 설정' })).toBeVisible();
    // 여러 쪽을 거쳐도 한 번에 첫 쪽으로 온다.
    await screen.getByRole('link', { name: /알림/ }).first().click();
    await screen.getByRole('link', { name: '설정으로' }).click();
    await screen.getByRole('link', { name: /프로필 설정/ }).first().click();
    await menu().click();
    await expect(screen.getByRole('heading', { name: '내 설정' })).toBeVisible();
    await expect(page).not.toHaveURL(/section=/);
  }
});

test('core settings tasks finish within their click budget and in the expected order', async ({ page }) => {
  await settingsAt(page);
  const screen = page.locator('platform-settings-screen');
  await withApp(page, {
    authUserId: 'account-a', profileStatus: 'ready', onboardingDismissed: true, byokOn: true, byokLoading: false, byokStatus: null,
    subscriptions: ['skku-notice01'], keywords: [],
    registerKey: 'fn:registerKey', registerCanvas: 'fn:registerCanvas', toggleSubscription: 'fn:toggle',
    profile: { programs: [], year: 2, semester: 1, enrollmentStatus: '재학', militaryService: '해당 없음', onboardedAt: 'x', interests: '', wants: '', avoids: '' },
    saveProfile: 'fn:saveProfile',
  });
  const log: string[] = [];
  const click = async (label: string, locator: import('@playwright/test').Locator) => { await locator.click(); log.push(label); };
  const hub = () => expect(screen.getByRole('heading', { name: '내 설정' })).toBeVisible();

  // 1) Gemini 키: 연결 키 → 입력하기 → 저장하기 = 3클릭
  await click('연결 키', screen.getByRole('link', { name: /연결 키/ }));
  await click('Gemini 입력하기', screen.getByRole('button', { name: 'Gemini 키 입력하기' }));
  await screen.getByLabel('Gemini 키', { exact: true }).fill(`AQ.${'a'.repeat(50)}`);
  await click('Gemini 저장하기', screen.getByRole('button', { name: '저장하기' }));
  expect(log.length).toBe(3);
  expect((await calls(page))[0][0]).toBe('registerKey');
  // 2) 같은 쪽에서 아이캠퍼스 토큰: 입력하기 → 저장하기 = 추가 2클릭(쪽 이동 없음)
  await withApp(page, { byokStatus: { keyHint: 'aaaa', model: 'm', disabled: false, lastError: null, usedToday: 0 }, registerCanvas: 'fn:registerCanvas' });
  log.length = 0;
  await click('아이캠퍼스 입력하기', screen.getByRole('button', { name: '아이캠퍼스 토큰 입력하기' }));
  await screen.getByLabel('아이캠퍼스 토큰', { exact: true }).fill(`1234~${'b'.repeat(40)}`);
  await click('아이캠퍼스 저장하기', screen.getByRole('button', { name: '저장하기' }));
  expect(log.length).toBe(2);
  expect((await calls(page))[0][0]).toBe('registerCanvas');
  // 3) 쪽 이동은 X(데스크톱) 또는 뒤로 가기(모바일) 한 번에 첫 쪽으로 돌아온다.
  await page.goBack();
  await hub();
  // 4) 학년 바꾸기: 프로필 설정 → 학년 = 2클릭
  await withApp(page, {});
  log.length = 0;
  await click('프로필 설정', screen.getByRole('link', { name: /프로필 설정/ }).first());
  await click('3학년', screen.getByRole('radio', { name: '3학년' }));
  expect(log.length).toBe(2);
  expect((await calls(page))[0]).toEqual(['saveProfile', expect.objectContaining({ year: 3 })]);
  await page.goBack();
  await hub();
  // 5) 게시판 하나 더 받기: 알림 → 게시판 더 보기 → 스위치 = 3클릭
  await withApp(page, {});
  log.length = 0;
  await click('알림', screen.getByRole('link', { name: /알림/ }).first());
  await click('게시판 더 보기', screen.locator('details.connection-manual > summary'));
  await click('게시판 켜기', screen.getByRole('switch', { checked: false }).first());
  expect(log.length).toBe(3);
  expect((await calls(page)).some((call) => call[0] === 'toggle' && call[2] === true)).toBe(true);
});

test('google calendar page: connect first, then sync and disconnect, with plain explanations', async ({ page }) => {
  await settingsAt(page);
  const screen = page.locator('platform-settings-screen');
  await withApp(page, { authUserId: 'account-a', profileStatus: 'ready', onboardingDismissed: true, calendarId: null,
    connectCalendar: 'fn:connect', syncCalendarNow: 'fn:sync', disconnectCalendar: 'fn:disconnect' });
  await screen.getByRole('link', { name: /구글 캘린더/ }).click();
  await expect(page).toHaveURL(/section=calendar/);
  await expect(screen.getByRole('heading', { name: '저장한 공지의 마감' })).toBeVisible();
  await expect(screen.getByText('연결 안 됨')).toBeVisible();
  await expect(screen.getByText(/내 다른 캘린더는 읽지 못해요/)).toBeVisible();
  // 단계 안내: 누르면 무슨 일이 생기는지, "확인되지 않은 앱"이 나오면 어떻게 하는지 알려 준다.
  await screen.getByText('연결하는 방법').click();
  await expect(screen.getByText(/고급.*을 누른 뒤.*계속/)).toBeVisible();
  await expect(screen.getByText(/"성대 공지" 캘린더가 생기고/)).toBeVisible();
  await screen.getByRole('button', { name: '구글 캘린더에 연결하기' }).click();
  expect(await calls(page)).toEqual([['connect']]);
  await withApp(page, { calendarId: 'abc123@group.calendar.google.com', calendarSyncedAt: '2026-11-08T03:00:00Z', calendarAuto: { active: false, error: null, lastRunAt: null } });
  await expect(screen.getByText(/연결됨/)).toBeVisible();
  // 예전에 연결해서 서버에 열쇠가 없으면 자동으로 맞추려면 다시 연결하라고 알려 준다.
  await expect(screen.getByText('자동으로 맞추려면 다시 연결해 주세요')).toBeVisible();
  await expect(screen.getByRole('button', { name: '다시 연결하기' })).toBeVisible();
  // 서버에 열쇠가 있으면 자동으로 맞추고 있다고 말하고 다시 연결 단추는 없다.
  await withApp(page, { calendarAuto: { active: true, error: null, lastRunAt: '2026-11-08T03:00:00Z' } });
  await expect(screen.getByText(/30분마다 자동으로 맞춰요/)).toBeVisible();
  await expect(screen.getByRole('button', { name: '다시 연결하기' })).toHaveCount(0);
  // 멈췄으면 이유와 다음 행동(다시 연결)을 보여 준다.
  await withApp(page, { calendarAuto: { active: false, error: '구글 연결이 끊겼어요. 설정에서 구글 캘린더를 다시 연결해 주세요.', lastRunAt: null } });
  await expect(screen.getByRole('alert').first()).toContainText('다시 연결');
  await withApp(page, { calendarAuto: { active: true, error: null, lastRunAt: null }, connectCalendar: 'fn:connect', syncCalendarNow: 'fn:sync', disconnectCalendar: 'fn:disconnect' });
  await expect(screen.getByRole('button', { name: '구글 캘린더에 연결하기' })).toHaveCount(0);
  await screen.getByRole('button', { name: '지금 맞추기' }).click();
  await screen.getByRole('button', { name: '연결 끊기' }).click();
  expect(await calls(page)).toEqual([['sync'], ['disconnect']]);
  await withApp(page, { calendarError: '구글 연결이 만료됐어요. 다시 연결해 주세요' });
  await expect(screen.getByRole('alert')).toContainText('다시 연결');
});

test('google calendar page asks to sign in first when signed out', async ({ page }) => {
  await settingsAt(page, '&section=calendar');
  const screen = page.locator('platform-settings-screen');
  await expect(screen.getByRole('heading', { name: '로그인이 필요해요' }).or(screen.getByText(/로그인/).first())).toBeVisible();
  await expect(screen.getByRole('button', { name: '구글 캘린더에 연결하기' })).toHaveCount(0);
});

test('side menu scrollbar: absent when everything fits, thin when it overflows', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'mobile', '왼쪽 메뉴는 넓은 화면에만 있다');
  await page.setViewportSize({ width: 1280, height: 1400 });
  await page.goto('/?api=sample/api/v1');
  await page.locator('notice-rows-screen a.row').first().waitFor();
  const sidebar = page.locator('.sidebar');
  const measure = () => sidebar.evaluate((el) => {
    const style = getComputedStyle(el);
    return { overflowY: style.overflowY, thin: style.scrollbarWidth, bar: getComputedStyle(el, '::-webkit-scrollbar').width, gutter: el.offsetWidth - el.clientWidth - parseFloat(style.borderRightWidth), overflowing: el.scrollHeight > el.clientHeight };
  });
  const tall = await measure();
  expect(tall.overflowY).toBe('auto');
  expect(['thin', 'auto']).toContain(tall.thin);                // 크로미움은 ::-webkit-scrollbar, 파이어폭스는 thin
  if (tall.thin === 'auto') expect(tall.bar).toBe('8px');
  expect(tall.overflowing).toBe(false);
  expect(tall.gutter).toBeLessThanOrEqual(0.5);                 // 넘치지 않으면 막대 자리도 없다(헤드리스는 막대를 그리지 않아 이 값은 참고용이다)
  await page.setViewportSize({ width: 1280, height: 360 });
  const short = await measure();
  expect(short.overflowing).toBe(true);
  if (short.thin === 'auto') expect(short.bar).toBe('8px');     // 넘쳐도 막대는 8px 자리의 얇은 모양이다(실제 모양은 웨일에서 확인)
  // 평소에는 막대 색이 투명하고, 마우스를 올리면 색이 생긴다.
  await page.mouse.move(900, 200);                               // 포인터가 메뉴 위에 있으면 평소 모습을 잴 수 없다
  const rest = await sidebar.evaluate((el) => getComputedStyle(el).scrollbarColor);
  await sidebar.hover();
  const hover = await sidebar.evaluate((el) => getComputedStyle(el).scrollbarColor);
  const thumb = (state: string) => sidebar.evaluate((el, s) => getComputedStyle(el, '::-webkit-scrollbar-thumb').backgroundColor + s, state);
  await page.mouse.move(900, 200);
  const restThumb = await thumb('');
  await sidebar.hover();
  // 호버 때의 막대 색은 헤드리스 크롬이 계산값을 제때 갱신하지 않아 여기서 재지 않는다(웨일에서 확인한다).
  if (short.thin === 'auto') expect(restThumb).toBe('rgba(0, 0, 0, 0)');
  else { expect(rest).toContain('rgba(0, 0, 0, 0)'); expect(hover).not.toBe(rest); }
});

test('summary is made automatically: progress text, a retry button on failure, nothing without a key', async ({ page }) => {
  await page.goto('/?api=sample/api/v1');
  await page.waitForFunction(() => !!customElements.get('notice-detail-screen'));
  await page.evaluate(() => {
    const el = document.createElement('notice-detail-screen') as HTMLElement & { model: unknown };
    el.id = 'auto-summary';
    document.body.append(el);
    const w = window as unknown as { asked: number; setModel: (patch: object) => void };
    w.asked = 0;
    const base = { notice: { id: 'a/3', source_id: 'a', article_no: '3', title: '장학 안내', category: null, url: 'https://www.skku.edu/x', posted_on: '2026-11-01', pinned: false, deadline: null, first_seen: null },
      source: '학교', today: '2026-11-08', interests: [], ai: null, rule: null, notified: false, retry: () => {},
      body: { body: '본문', body_html: null, images: [], attachments: [], fetched_at: 'x', body_from_image: false },
      makeSummary: () => { w.asked += 1; } };
    w.setModel = (patch) => { el.model = { ...base, ...patch }; };
    w.setModel({});
  });
  const detail = page.locator('#auto-summary');
  const set = (patch: object) => page.evaluate((p) => (window as unknown as { setModel: (x: object) => void }).setModel(p), patch);
  await expect(detail.getByRole('region', { name: '요약' })).toHaveCount(0);   // 키가 없으면 요약 구역도 없다
  await expect(detail.getByRole('button', { name: /요약 만들기/ })).toHaveCount(0);
  await set({ summarizing: true });
  await expect(detail.getByRole('region', { name: '요약' })).toContainText('요약을 만들고 있어요');
  await set({ summaryError: '오늘 쓸 수 있는 요약을 모두 썼어요. 내일 다시 눌러 주세요.' });
  await expect(detail.getByRole('region', { name: '요약' })).toContainText('내일 다시');
  await detail.getByRole('button', { name: '다시 만들기' }).click();
  expect(await page.evaluate(() => (window as unknown as { asked: number }).asked)).toBe(1);
  await set({ mySummary: '재학생이 12월 5일까지 신청해요.' });
  await expect(detail.getByRole('button', { name: '다시 만들기' })).toHaveCount(0);
  await expect(detail.getByRole('region', { name: '요약' })).toContainText('12월 5일까지');
});

test('detail shows keywords found in the body like the original (the judgment reason and deadline are covered by unit tests)', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'mobile', '두 칸 화면에서 확인한다');
  await page.route(/\/notices\/[\w-]+\/\d+\.json/, (route) => route.fulfill({ contentType: 'application/json',
    body: JSON.stringify({ body: '장학금 신청 안내', body_html: null, images: [], attachments: [], fetched_at: 'x', body_from_image: false }) }));
  await page.goto('/?api=sample/api/v1');
  const first = page.locator('notice-rows-screen a.row').first();
  await first.waitFor();
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => {
    const app = document.querySelector('notice-app') as unknown as Record<string, unknown>;
    app.keywords = ['장학', '공모전'];
  });
  await first.click();
  const detail = page.locator('notice-detail-screen');
  await expect(detail.locator('.detail-reason')).toContainText('관심 장학');          // 본문에서 찾은 키워드
  await expect(detail.locator('.detail-reason')).not.toContainText('공모전');          // 본문에 없는 키워드는 붙지 않는다
});

test('a personal body deadline appears beside the notice like a title deadline', async ({ page }) => {
  await page.goto('/?api=sample/api/v1');
  const row = page.locator('notice-rows-screen a.row').first();
  await row.waitFor();
  const id = await row.getAttribute('data-id');
  await page.evaluate((noticeId) => {
    const app = (document.querySelector('notice-app') as any).controller;
    const original = app.notices.find((n: { id: string }) => n.id === noticeId);
    original.deadline = null;
    app.myDeadlines = new Map([[noticeId, { deadline: '2099-12-31T14:59:00Z', deadlineKind: '마감' }]]);
    app.requestUpdate();
  }, id);
  await expect(page.locator(`notice-rows-screen a.row[data-id="${id}"] .dday`)).toBeVisible();
});

test('personal English translation is shown automatically with the original body', async ({ page }) => {
  await page.goto('/?api=sample/api/v1');
  const row = page.locator('notice-rows-screen a.row').nth(1);
  await row.waitFor();
  const id = await row.getAttribute('data-id');
  await page.evaluate((noticeId) => {
    const app = (document.querySelector('notice-app') as any).controller;
    app.myTranslations = new Map([[noticeId, { title: '번역된 공지 제목', body: '번역된 본문입니다.', model: 'm' }]]);
    app.requestUpdate();
  }, id);
  await expect(page.locator(`notice-rows-screen a.row[data-id="${id}"] .title`)).toHaveText('번역된 공지 제목');
  await page.locator(`notice-rows-screen a.row[data-id="${id}"]`).click();
  const detail = page.locator('notice-detail-screen').filter({ visible: true });
  await expect(detail.getByRole('region', { name: '한국어로 옮긴 본문' })).toContainText('번역된 본문입니다.');
  await expect(detail.getByRole('region', { name: '영어 원문' })).toBeVisible();
});

test('list rows show "관심 …" or my judgment label with its reason, like the original list', async ({ page }) => {
  await page.goto('/?api=sample/api/v1');
  const rows = page.locator('notice-rows-screen a.row');
  await rows.first().waitFor();
  await page.waitForLoadState('networkidle');
  const ids = await page.evaluate(() => (document.querySelector('notice-app') as unknown as { notices: { id: string }[] }).notices.slice(0, 3).map((n) => n.id));
  await page.evaluate((list) => {
    const app = document.querySelector('notice-app') as unknown as Record<string, unknown>;
    app.keywords = ['장학'];
    app.myJudgments = new Map([
      [list[0], { verdict: 'not_relevant', reason: '대학원생을 대상으로 하는 공고예요', model: 'm', deadline: null, deadlineKind: null }],
      [list[1], { verdict: 'maybe', reason: '자격을 확인해야 해요', model: 'm', deadline: null, deadlineKind: null }],
    ]);
    app.myInterests = new Map([[list[2], ['장학']]]);
  }, ids);
  const reason = (id: string) => page.locator(`notice-rows-screen a.row[data-id="${id}"] .reason`);
  await expect(reason(ids[0])).toContainText('해당 없음');
  await expect(reason(ids[0])).toContainText('대학원생을 대상으로 하는 공고예요');
  await expect(reason(ids[1])).toContainText('확인 필요');
  await expect(reason(ids[2])).toContainText('관심 장학');          // 본문에서 서버가 찾은 키워드
});

test('notifications page: this device iCampus mode, daily summary time and the device list, like the original settings', async ({ page }) => {
  await settingsAt(page, '&section=notifications');
  const screen = page.locator('platform-settings-screen');
  const devices = [
    { id: 'd1', endpoint: 'https://fcm.googleapis.com/a', name: 'Windows · Whale', canvasMode: 'reminders', createdAt: '2026-11-07T10:00:00Z' },
    { id: 'd2', endpoint: 'https://fcm.googleapis.com/b', name: 'Android · Chrome', canvasMode: 'summary', createdAt: '2026-11-08T01:00:00Z' },
  ];
  await withApp(page, { authUserId: 'account-a', pushStatus: 'on', devices, thisDeviceId: 'd1', summaryTime: '21:05',
    canvasStatus: { keyHint: 'ZZZZ', disabled: false, lastError: null, lastOkAt: null },
    refreshDevices: 'fn:refresh', setCanvasMode: 'fn:mode', removeDevice: 'fn:remove', renameDevice: 'fn:rename', setSummaryTime: 'fn:time' });
  // 이 기기 아캠 알림: 원본과 같은 세 가지, 지금 값이 골라져 있다.
  const mode = screen.getByRole('radiogroup', { name: '이 기기 아캠 알림' });
  await expect(mode.getByRole('radio')).toHaveText(['끄기', '하루 요약', '요약과 마감']);
  await expect(mode.getByRole('radio', { name: '요약과 마감' })).toHaveAttribute('aria-checked', 'true');
  await mode.getByRole('radio', { name: '하루 요약' }).click();
  expect((await calls(page)).filter((c) => c[0] === 'mode')).toEqual([['mode', 'summary']]);
  // 하루 요약 시간: 오전·오후, 시, 분. 21:05는 오후 9시 05분.
  const time = screen.getByRole('group', { name: '하루 요약 시간' });
  await expect(time.getByRole('radio', { name: '오후' })).toHaveAttribute('aria-checked', 'true');
  await expect(time.getByLabel('시')).toHaveValue('9');
  await expect(time.getByLabel('분')).toHaveValue('05');
  await time.getByRole('radio', { name: '오전' }).click();
  await time.getByLabel('시').fill('7'); await time.getByLabel('분').fill('30'); await time.getByLabel('분').blur();
  const timeCalls = (await calls(page)).filter((c) => c[0] === 'time');
  expect(timeCalls.at(-1)).toEqual(['time', 'am', 7, 30]);
  // 알림 기기 목록: 이 기기에는 지우기가 없고 다른 기기는 지울 수 있다.
  const list = screen.getByRole('region', { name: '알림 기기' });
  await expect(list).toContainText('Windows · Whale');
  await expect(list.locator('li', { hasText: 'Windows · Whale' })).toContainText('이 기기');
  await expect(list.locator('li', { hasText: 'Windows · Whale' }).getByRole('button', { name: /지우기/ })).toHaveCount(0);   // 이 기기는 위에서 끈다
  // 이름 바꾸기: 눌러서 고치고 저장하면 줄이 닫힌다(저장은 앱에 맡기고 여기서는 호출을 확인한다).
  await list.getByRole('button', { name: 'Windows · Whale 이름 바꾸기' }).click();
  await list.getByLabel('Windows · Whale 이름').fill('내 노트북');
  await list.getByRole('button', { name: '저장하기' }).click();
  expect((await calls(page)).filter((c) => c[0] === 'rename')).toEqual([['rename', 'd1', '내 노트북']]);
  await list.getByRole('button', { name: 'Android · Chrome 지우기' }).click();
  expect((await calls(page)).filter((c) => c[0] === 'remove')).toEqual([['remove', 'd2']]);
  // 아이캠퍼스 토큰이 없으면 모드와 요약 시간을 바꿀 수 없고 이유를 알려 준다.
  await withApp(page, { canvasStatus: null, summaryTime: null });
  await expect(mode.getByRole('radio', { name: '하루 요약' })).toBeDisabled();
  await expect(screen.getByText('연결 키에서 아이캠퍼스 토큰을 저장해 주세요').first()).toBeVisible();
});

test('a deadline that is close stays red even when the notice is already read, in both themes', async ({ page }) => {
  await page.goto('/?api=sample/api/v1');
  const first = page.locator('notice-rows-screen a.row').first();
  await first.waitFor();
  await page.waitForLoadState('networkidle');
  const id = await page.evaluate(() => {
    const app = document.querySelector('notice-app') as unknown as Record<string, any>;
    const notice = app.notices[0];
    notice.deadline = new Date(Date.now() + 36 * 3600 * 1000).toISOString();     // 내일: 임박
    app.read = new Set([notice.id]);                                              // 이미 읽은 글
    app.requestUpdate();
    return notice.id;
  });
  const dday = page.locator(`notice-rows-screen a.row[data-id="${id}"] .dday`);
  await expect(page.locator(`notice-rows-screen a.row[data-id="${id}"]`)).toHaveClass(/read/);
  await expect(dday).toHaveClass(/urgent/);
  const danger = () => page.evaluate(() => { const probe = document.createElement('span'); probe.style.color = 'var(--danger)'; document.body.append(probe); const c = getComputedStyle(probe).color; probe.remove(); return c; });
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    expect(await dday.evaluate((el) => getComputedStyle(el).color)).toBe(await danger());
  }
});

test('on read rows the judgment labels keep their hue, softer in dark mode, with readable contrast', async ({ page }) => {
  await page.goto('/?api=sample/api/v1');
  const rows = page.locator('notice-rows-screen a.row');
  await rows.first().waitFor();
  await page.waitForLoadState('networkidle');
  const ids = await page.evaluate(() => {
    const app = document.querySelector('notice-app') as unknown as Record<string, any>;
    const list = app.notices.slice(0, 2).map((n: { id: string }) => n.id);
    app.myJudgments = new Map([
      [list[0], { verdict: 'relevant', reason: '대상이에요', model: 'm', deadline: null, deadlineKind: null }],
      [list[1], { verdict: 'maybe', reason: '확인이 필요해요', model: 'm', deadline: null, deadlineKind: null }],
    ]);
    app.read = new Set(list);                          // 두 글 모두 읽은 상태
    app.requestUpdate();
    return list;
  });
  // 색 문자열을 화면에 그려 실제 RGB로 바꾼 뒤 WCAG 대비를 계산한다.
  const rgb = (page_: typeof page, css: string) => page_.evaluate((value) => {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
    const ctx = canvas.getContext('2d')!; ctx.fillStyle = '#000'; ctx.fillStyle = value; ctx.fillRect(0, 0, 1, 1);
    const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data; return [r, g, b];
  }, css);
  const luminance = ([r, g, b]: number[]) => { const f = (c: number) => { const v = c / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const contrast = (a: number[], b: number[]) => { const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    for (const [id, tone] of [[ids[0], 'relevant'], [ids[1], 'maybe']] as const) {
      const row = page.locator(`notice-rows-screen a.row[data-id="${id}"]`);
      await expect(row).toHaveClass(/read/);
      const label = await row.locator('.reason b').evaluate((el) => getComputedStyle(el).color);
      const plain = await row.locator('.sub').evaluate((el) => getComputedStyle(el).color);   // 이유 문장(회색)
      // 라벨 뒤에 실제로 보이는 배경: 조상 중 투명하지 않은 첫 배경색.
      const surface = await row.locator('.reason b').evaluate((el) => {
        for (let node: Element | null = el; node; node = node.parentElement) {
          const c = getComputedStyle(node).backgroundColor;
          if (c && c !== 'rgba(0, 0, 0, 0)' && c !== 'transparent') return c;
        }
        return getComputedStyle(document.documentElement).backgroundColor;
      });
      expect(label, `${scheme} ${tone}: 라벨은 이유 문장과 다른 색(색 계열 유지)`).not.toBe(plain);
      expect(contrast(await rgb(page, label), await rgb(page, surface)), `${scheme} ${tone} 대비`).toBeGreaterThanOrEqual(4.5);
    }
  }
});

test('delete account needs two steps, says what goes away, and shows a failure with the next action', async ({ page }) => {
  await settingsAt(page);
  const screen = page.locator('platform-settings-screen');
  await withApp(page, { authUserId: 'account-a', profileStatus: 'ready', onboardingDismissed: true, deleteAccount: 'fn:delete' });
  const row = screen.locator('.delete-account');
  await expect(row).not.toContainText('되돌릴 수 없어요');                            // 평소에는 작은 글자 버튼 하나만 보인다
  await row.getByRole('button', { name: '계정 삭제' }).click();                      // 1단계: 결과 설명과 확인 문구가 나온다
  expect(await calls(page)).toEqual([]);
  const confirm = row.getByRole('group', { name: '계정을 삭제할까요?' });              // 질문이 제목이고 지워지는 것을 알려 준다
  await expect(confirm).toContainText('계정 정보가 모두 삭제돼요');
  await expect(confirm).toContainText('되돌릴 수 없어요');
  await expect(row.getByRole('alert')).toHaveCount(0);                               // 오류가 아니므로 경고로 읽히지 않는다
  await expect(row.getByRole('button', { name: '닫기' })).toBeFocused();              // Enter로 바로 지워지지 않게 안전한 단추에 포커스
  const order = await confirm.getByRole('button').allTextContents();
  expect(order).toEqual(['닫기', '삭제하기']);                                        // 안전한 단추가 왼쪽, 실행이 오른쪽
  await row.getByRole('button', { name: '닫기' }).click();                            // 닫으면 아무 일도 없고 포커스가 돌아온다
  await expect(row.getByRole('button', { name: '계정 삭제' })).toBeFocused();
  expect(await calls(page)).toEqual([]);
  await row.getByRole('button', { name: '계정 삭제' }).click();
  await row.getByRole('button', { name: '삭제하기' }).click();                      // 2단계: 실제로 지운다
  expect(await calls(page)).toEqual([['delete']]);
  await withApp(page, { accountError: '계정을 지우지 못했어요. 잠시 뒤 다시 눌러 주세요.' });
  await expect(row.getByRole('alert').last()).toContainText('다시 눌러 주세요');
});
