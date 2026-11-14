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
  // 그림에서 읽은 글은 화면에 보이지 않는다(판정에만 쓴다). 악성 글자가 들어 있어도 태그로 풀리지 않는다.
  await expect(page.locator('#xss-check [aria-labelledby="sec-ocr"]')).toHaveCount(0);
  await expect(page.locator('#xss-check')).not.toContainText('<script>악성 내용</script>');
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

// 앱 상태를 직접 바꿔 컨트롤러와 화면의 실제 연결을 확인한다. 서버 호출이 필요한 동작은 컨트롤러 메서드를 기록용으로 바꾼다.
type AppHandle = Record<string, unknown>;
const withApp = (page: import('@playwright/test').Page, patch: Record<string, unknown>) => page.evaluate((values) => {
  const app = document.querySelector('notice-app') as unknown as AppHandle;
  const w = window as unknown as { calls: unknown[][] };
  w.calls = [];
  if ('authUserId' in values && !('profileStatus' in values)) app.profileStatus = 'unavailable';   // 프로필을 읽는 중이면 불러오는 화면이 나오므로, 시험은 따로 정하지 않으면 읽지 못한 상태로 둔다
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
  // 뒤로 가기는 머리 줄의 단추 하나뿐이다(본문에 같은 일을 하는 밑줄 링크를 따로 두지 않는다).
  await expect(screen.getByRole('link', { name: '설정으로' })).toHaveCount(0);
  await page.getByRole('button', { name: '설정으로 돌아가기' }).first().click();
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
  await expect(screen.getByText('꺼져 있어요', { exact: false }).first()).toContainText('꺼져 있어요');
  await screen.getByRole('button', { name: '알림 받기' }).click();
  expect(await calls(page)).toEqual([['enable']]);
  await withApp(page, { pushStatus: 'on' });
  await expect(screen.getByText('켜져 있어요', { exact: false }).first()).toContainText('켜져 있어요');
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

test('board subscriptions: my boards are switches, and more boards are added college first like choosing a major', async ({ page }) => {
  await settingsAt(page, '&section=notifications');
  const screen = page.locator('platform-settings-screen');
  await withApp(page, { authUserId: 'account-a', subscriptions: ['skku-notice01'], toggleSubscription: 'fn:toggle' });
  const mine = screen.getByRole('switch', { checked: true }).filter({ hasNotText: '아이캠퍼스' });
  await expect(mine).toHaveCount(1);
  await expect(mine.first()).toHaveAttribute('aria-checked', 'true');
  await mine.first().click();
  // 접힌 줄을 누르면 전공 고르기와 같은 단과대 격자가 펼쳐진다(스위치 목록이 아니다).
  await expect(screen.getByRole('group', { name: '단과대와 기타 묶음 선택' })).toBeHidden();
  await screen.locator('details.board-more-list > summary').click();
  const colleges = screen.getByRole('group', { name: '단과대와 기타 묶음 선택' }).getByRole('button');
  await expect(colleges.first()).toBeVisible();
  expect(await colleges.count()).toBeGreaterThanOrEqual(1);   // 샘플 데이터는 묶음이 적다
  // 검색하면 단과대를 거치지 않고 이름이 맞는 게시판이 바로 나온다.
  const search = screen.getByRole('searchbox', { name: '게시판 검색' });
  await search.fill('없는게시판이름');
  await expect(screen.getByText("'없는게시판이름'에 맞는 게시판이 없어요")).toBeVisible();
  await search.fill('');
  // 단과대를 고르면 그 단과대의 게시판이 나오고, 맨 위의 "다른 단과대 고르기"로 같은 자리에서 돌아간다.
  const name = (await colleges.first().innerText()).trim();
  await colleges.first().click();
  await expect(screen.getByRole('group', { name: `${name} 게시판` })).toBeVisible();
  await screen.getByRole('button', { name: '다른 단과대 고르기' }).click();
  await expect(screen.getByRole('group', { name: '단과대와 기타 묶음 선택' })).toBeVisible();
  await colleges.first().click();
  await screen.getByRole('group', { name: `${name} 게시판` }).getByRole('button').first().click();
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
  await expect(screen.getByText('경영학과 (경영대학)', { exact: true })).toBeVisible();
  await expect(screen.getByRole('radio', { name: '3학년' })).toHaveAttribute('aria-checked', 'true');
  await screen.getByRole('radio', { name: '4학년' }).click();
  await screen.getByRole('radio', { name: '휴학' }).click();
  // 전공은 첫 설정으로 돌아가지 않고 이 자리에서 바꾼다: 바꾸기 → 단과대 → 학과를 누르면 바로 저장하고, 복수전공은 그대로 둔다.
  await expect(screen.getByRole('button', { name: '전공과 게시판 다시 고르기' })).toHaveCount(0);
  await screen.getByRole('button', { name: '바꾸기' }).click();
  await screen.getByRole('button', { name: '문과대학', exact: true }).click();
  await screen.getByRole('radio', { name: '철학과', exact: true }).click();
  const recorded = await calls(page);
  expect(recorded[0]).toEqual(['save', { ...profile, year: 4 }]);
  expect(recorded[1]).toEqual(['save', { ...profile, enrollmentStatus: '휴학' }]);
  expect(recorded[2]).toEqual(['save', { ...profile, programs: [{ college: '문과대학', department: '철학과' }, { college: '경영대학', department: '경영학과' }] }]);
});

test('connection keys page follows the original rows: Gemini key and iCampus token flows, no profile fields', async ({ page }) => {
  await settingsAt(page, '&keys=1');
  const screen = page.locator('platform-settings-screen');
  await withApp(page, { authUserId: 'account-a', byokOn: false, registerKey: 'fn:register', removeKey: 'fn:remove', registerCanvas: 'fn:registerCanvas', removeCanvas: 'fn:removeCanvas', profileStatus: 'ready', onboardingDismissed: true });
  // 서버 기능이 아직 없을 때도 줄은 보이고 이유를 알려 준다.
  await expect(screen.getByRole('heading', { name: 'AI 연결' })).toBeVisible();
  await expect(screen.getByText('지금은 키를 연결할 수 없어요')).toBeVisible();
  await expect(screen.getByText('아이캠퍼스')).toHaveCount(0);   // 아이캠퍼스는 알림 쪽에서 켠다
  await expect(screen.getByLabel('Gemini 키', { exact: true })).toHaveCount(0);
  // 학기·병역 같은 프로필은 프로필 설정에서 바꾼다. 연결 키 쪽에는 두지 않는다.
  await expect(screen.getByRole('radio', { name: '2학기' })).toHaveCount(0);
  await expect(screen.getByRole('radio', { name: '복무 전' })).toHaveCount(0);
  await withApp(page, { byokOn: true, byokLoading: false, byokStatus: null });
  await expect(screen.locator('.setting', { hasText: 'Gemini 키' }).getByRole('button', { name: 'Gemini 키 연결하기' })).toBeVisible();
  await expect(screen.getByText('연결 안 됨')).toHaveCount(0);
  await expect(screen.getByText('AI 분석', { exact: true })).toHaveCount(0);
  // 업체나 요금을 고르라는 질문은 없다. 연결이 하나도 없으면 켜기·끄기도 보이지 않는다.
  await expect(screen.getByRole('radiogroup', { name: 'AI 분석' })).toHaveCount(0);
  await expect(screen.getByText('요금')).toHaveCount(0);
  // 연결 전에는 입력칸이 처음부터 보이고, 받는 방법은 접혀 있다.
  const save = screen.getByRole('button', { name: 'Gemini 키 연결하기' });
  await expect(save).toBeDisabled();
  const key = `AIza${'D'.repeat(35)}`;
  const input = screen.getByLabel('Gemini 키', { exact: true });
  await expect(input).toHaveAttribute('type', 'password');
  await input.fill(key);
  const row = screen.locator('.setting', { hasText: 'Gemini 키' });
  await row.getByRole('button', { name: '보기' }).click();
  await expect(input).toHaveAttribute('type', 'text');
  await row.getByRole('button', { name: '숨기기' }).click();
  // 받는 방법은 키마다 두지 않고 맨 아래에 하나만 있다.
  await expect(screen.getByText('키는 어디서 받나요?')).toHaveCount(1);
  await expect(screen.getByRole('link', { name: 'Gemini', exact: true })).toBeHidden();
  await screen.getByText('키는 어디서 받나요?').click();
  await expect(screen.getByRole('link', { name: 'Gemini', exact: true })).toHaveAttribute('href', 'https://aistudio.google.com/apikey');
  await expect(screen.getByRole('link', { name: 'Groq', exact: true })).toHaveAttribute('href', 'https://console.groq.com/keys');
  await expect(screen.getByRole('link', { name: 'OpenRouter' })).toHaveCount(0);
  await save.click();
  expect(await calls(page)).toEqual([['register', key]]);
  await withApp(page, { byokStatus: { keyHint: 'DDDD', model: 'm', disabled: false, lastError: null, usedToday: 0 } });
  await expect(screen.getByText('연결됨 ····DDDD')).toBeVisible();
  expect(await screen.innerText()).not.toContain(key);
  await expect(screen.getByLabel('Gemini 키', { exact: true })).toHaveCount(0);
  await withApp(page, { byokStatus: { keyHint: 'DDDD', model: 'm', disabled: true, lastError: 'Gemini가 이 키를 받아 주지 않아요. 키를 다시 등록해 주세요.', usedToday: 0 } });
  await expect(screen.locator('[data-provider], .setting', { hasText: 'Gemini 키' }).first().getByText('키를 확인해 주세요')).toBeVisible();
  await screen.getByRole('button', { name: 'Gemini 키 연결 끊기', exact: true }).click();
  expect(await calls(page)).toEqual([]);  // 한 번 더 확인한다
  await screen.getByRole('button', { name: '취소' }).click();
  await screen.getByRole('button', { name: 'Gemini 키 연결 끊기', exact: true }).click();
  await screen.getByRole('button', { name: 'Gemini 키 연결 끊기 확인' }).click();
  expect(await calls(page)).toEqual([['remove']]);
});

test('connection keys page says how the AI works for 0, 1 and 2 connected keys', async ({ page }) => {
  await settingsAt(page, '&keys=1');
  const screen = page.locator('platform-settings-screen');
  const key = (provider: string) => ({ provider, keyHint: 'abcd', model: 'm', disabled: false, lastError: null, usedToday: 0 });
  const gemini = { keyHint: 'DDDD', model: 'm', disabled: false, lastError: null, usedToday: 0 };
  await withApp(page, { authUserId: 'account-a', profileStatus: 'ready', onboardingDismissed: true, byokOn: true, byokLoading: false });
  const states: [string, unknown, unknown[], RegExp][] = [
    ['아무것도 연결 안 함', null, [], /하나 이상 연결하면/],
    ['Groq 하나', null, [key('groq')], /그 한도까지만 확인해요/],
    ['Gemini 하나', gemini, [], /그 한도까지만 확인해요/],
    ['Gemini + Groq', gemini, [key('groq')], /번갈아 쓰고, 한 곳이 막히면/],
  ];
  for (const [label, byokStatus, aiKeys, text] of states) {
    await withApp(page, { byokStatus, aiKeys });
    await expect(screen.locator('.settings-lead').first(), label).toContainText(text);
  }
});

test('settings items live in the right place: list scope under display, profile fields together, shortcuts jump to the page', async ({ page }) => {
  await settingsAt(page);
  const screen = page.locator('platform-settings-screen');
  await expect(screen.getByRole('radiogroup', { name: '목록 보기' })).toHaveCount(0);
  await withApp(page, { authUserId: 'account-a', profileStatus: 'ready', onboardingDismissed: true });
  // 목록에 보일 게시판은 따로 설정하지 않는다(목록의 게시판 고르기가 이미 같은 일을 한다).
  await expect(screen.getByRole('radiogroup', { name: '목록 보기' })).toHaveCount(0);
  await screen.getByRole('link', { name: /알림/ }).first().click();
  await expect(screen.getByRole('radiogroup', { name: '목록 보기' })).toHaveCount(0);
  // 학년·학기·재학 상태·병역은 프로필 설정 한 곳에 있다.
  await page.getByRole('button', { name: '설정으로 돌아가기' }).first().click();
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
    app.finishOnboarding = (draft: unknown) => { w.calls.push(['finish', draft]); (app.applyOnboardingSaved as (profile: unknown) => void)({ ...(app.profile as object), onboardedAt: 'x' }); return Promise.resolve(true); };
    app.closeOnboarding = () => { w.calls.push(['close']); app.onboardingOpen = false; app.profile = { ...(app.profile as object), onboardedAt: 'x' }; };
    app.enablePush = () => { w.calls.push(['push']); return Promise.resolve(); };
    app.profile = { programs: [], year: null, semester: null, enrollmentStatus: null, militaryService: null, onboardedAt: null, admissionYear: null, university3pInternshipSelected: null, deptInternshipDone: null, university3pInternshipDone: null };
    app.profileStatus = 'ready';
    app.pushStatus = 'off';
    app.byokStatus = { keyHint: 'DDDD', model: 'm', disabled: false, lastError: null, usedToday: 0 }; app.authUserId = 'account-a';
  });
  const dialog = page.getByRole('dialog');
  await expect(page.locator('.app')).toHaveAttribute('inert', '');
  await expect(dialog.getByRole('heading', { name: '주전공이 어디예요?' })).toBeFocused();
  await expect(dialog.getByRole('heading', { name: '주전공이 어디예요?' })).toBeVisible();
  await expect(dialog.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '1');
  const barWidth1 = (await dialog.getByRole('progressbar').boundingBox())!.width;
  // 단과대 → 학과: 고른 단과대의 학과만 보인다.
  await dialog.getByRole('button', { name: '소프트웨어융합대학', exact: true }).click();
  // 질문 제목이 접히지 않고 보여야 한다(전역 h1 규칙이 제목 높이를 0으로 만들던 결함의 재발 방지).
  const title = dialog.getByRole('heading', { name: '주전공이 어디예요?' });
  expect((await title.boundingBox())!.height).toBeGreaterThan(20);
  await expect(dialog.getByRole('radio', { name: '소프트웨어학과', exact: true })).toBeVisible();
  await expect(dialog.getByRole('radio', { name: '국어국문학과', exact: true })).toHaveCount(0);
  await dialog.getByRole('button', { name: '다른 단과대 고르기' }).click();
  await dialog.getByRole('button', { name: '문과대학', exact: true }).click();
  await expect(dialog.getByRole('searchbox', { name: '학과 검색' })).toBeVisible();
  await dialog.getByRole('searchbox', { name: '학과 검색' }).fill('철학');
  await expect(dialog.getByRole('radio', { name: /^철학과/ })).toBeVisible();
  await expect(dialog.getByRole('radio', { name: '사학과', exact: true })).toHaveCount(0);
  await dialog.getByRole('searchbox', { name: '학과 검색' }).fill('');
  await dialog.getByRole('button', { name: '다른 단과대 고르기' }).click();
  // 검색 칸은 단과대를 고르기 전부터 보이고, 모든 단과대의 학과를 한 번에 찾는다(단과대 이름이 옆에 붙는다).
  await expect(dialog.getByRole('searchbox', { name: '학과 검색' })).toBeVisible();
  await dialog.getByRole('searchbox', { name: '학과 검색' }).fill('소프트웨어학과');
  await expect(dialog.getByRole('radio', { name: /^소프트웨어학과.*소프트웨어융합대학/ })).toBeVisible();
  await dialog.getByRole('searchbox', { name: '학과 검색' }).fill('');
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
  await expect(dialog.getByRole('progressbar')).toHaveAttribute('aria-valuetext', '7단계 중 2단계');
  expect(Math.abs((await dialog.getByRole('progressbar').boundingBox())!.width - barWidth1)).toBeLessThanOrEqual(0.5);
  await dialog.getByRole('radio', { name: '있어요', exact: true }).click();
  await dialog.getByRole('button', { name: '경영대학', exact: true }).click();
  await expect(dialog.getByRole('button', { name: '다음' })).toBeDisabled();
  await dialog.getByRole('radio', { name: '경영학과', exact: true }).click();
  await dialog.getByRole('button', { name: '다음' }).click();
  // 학교 정보: 재학이 미리 골라져 있고 학년을 골라야 넘어간다. 막힌 이유를 한 줄로 알려 준다.
  await expect(dialog.getByRole('heading', { name: '학교 정보를 알려 주세요' })).toBeFocused();
  await expect(dialog.getByRole('button', { name: '재학', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(dialog.getByRole('button', { name: '다음' })).toBeDisabled();
  await expect(dialog.getByText('학년을 골라 주세요')).toBeVisible();
  await dialog.getByRole('button', { name: '3학년' }).click();
  await dialog.getByRole('button', { name: '다음' }).click();
  // 인턴십: 소프트웨어학과 원전공은 입학 연도를 골라야 넘어간다.
  await expect(dialog.getByRole('heading', { name: '인턴십 진행 상황을 알려 주세요' })).toBeVisible();
  await expect(dialog.getByRole('button', { name: '다음' })).toBeDisabled();
  await expect(dialog.getByText('입학 연도를 골라 주세요')).toBeVisible();
  await dialog.getByRole('button', { name: '2022', exact: true }).click();
  await dialog.getByRole('group', { name: '3품 인턴십' }).getByRole('button', { name: '채웠어요' }).click();
  await dialog.getByRole('group', { name: '솦 인턴십' }).getByRole('button', { name: '마쳤어요' }).click();
  await dialog.getByRole('button', { name: '다음' }).click();
  // 게시판·키워드: 내 전공에 맞춰 추천이 켜져 있다.
  await expect(dialog.getByRole('heading', { name: '어떤 공지를 받을까요?' })).toBeFocused();
  await expect(dialog.getByText('추천', { exact: true })).toHaveCount(0);
  await expect(dialog.getByRole('switch', { name: /^성균관대 공지/ })).toHaveAttribute('aria-checked', 'true');
  await expect(dialog.getByRole('switch', { name: /^소프트웨어학과 공지/ })).toHaveAttribute('aria-checked', 'true');
  expect((await dialog.getByRole('button', { name: '장학' }).boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await dialog.getByRole('button', { name: '장학' }).click();
  // 기타 게시판도 같은 화면 아래에 있다. 부트캠프 게시판을 고를 수 있고, 건너뛰어도 된다.
  await expect(dialog.getByRole('group', { name: '기타 게시판' })).toBeVisible();
  // 행 전체가 눌리는 영역이다: 스위치가 아니라 이름 글자, 설명 글자, 행의 왼쪽 끝을 눌러도 켜지고 꺼진다. 높이는 44px 이상이다.
  const etc = dialog.getByRole('group', { name: '기타 게시판' });
  const fab = etc.getByRole('switch', { name: /^지능형팹테크융합전공 공지/ });
  await etc.scrollIntoViewIfNeeded();
  const row = fab.locator('xpath=ancestor::*[contains(@class,"setting") or contains(@class,"switch-row")][1]');
  const box = (await fab.boundingBox())!;
  expect(box.height).toBeGreaterThanOrEqual(44);
  await expect(fab).toHaveAttribute('aria-checked', 'false');
  await etc.getByText('지능형팹테크융합전공 공지', { exact: true }).click();
  await expect(fab).toHaveAttribute('aria-checked', 'true');
  await etc.getByText('반도체 공정과 팹 교육, 학위 안내', { exact: true }).click();
  await expect(fab).toHaveAttribute('aria-checked', 'false');
  await page.mouse.click(box.x + 4, box.y + box.height / 2);
  await expect(fab).toHaveAttribute('aria-checked', 'true');
  await fab.press('Space');   // 키보드로도 같은 스위치가 바뀐다
  await expect(fab).toHaveAttribute('aria-checked', 'false');
  void row;
  // 스크롤: 맨 아래까지 내렸을 때 마지막 키워드 칩이 "다음" 단추에 가려지지 않는다.
  const lastChip = dialog.getByRole('button', { name: '등록금' });
  await lastChip.scrollIntoViewIfNeeded();
  const chipBox = (await lastChip.boundingBox())!;
  const next = (await dialog.getByRole('button', { name: '다음' }).boundingBox())!;
  expect(chipBox.y + chipBox.height).toBeLessThanOrEqual(next.y);
  await expect(dialog.getByRole('group', { name: '사업단' }).getByRole('switch', { name: /^AI중심대학사업단 공지/ })).toHaveAttribute('aria-checked', 'true');   // 소프트웨어융합대학 전공 추천은 켜져 있다
  await expect(dialog.getByRole('group', { name: '융합·연계전공' }).getByRole('switch', { name: /^차세대반도체공학연계전공 공지/ })).toHaveAttribute('aria-checked', 'false');
  // 융합·연계전공은 차세대반도체가 팹테크보다 위에 있다(사용자 지시).
  expect((await dialog.getByRole('group', { name: '융합·연계전공' }).getByRole('switch').allInnerTexts()).map((t) => t.split('\n')[0])).toEqual(['차세대반도체공학연계전공 공지', '지능형팹테크융합전공 공지']);
  await expect(dialog.getByRole('switch', { name: /수강 모집과 행사 안내/ })).toHaveAttribute('aria-checked', 'false');
  await dialog.getByRole('switch', { name: /수강 모집과 행사 안내/ }).click();
  // 참여 여부는 묻지 않는다(사용자 지시 2026-11-12).
  await expect(dialog.getByRole('switch', { name: /참여 중이에요|하고 있어요/ })).toHaveCount(0);
  await dialog.getByRole('button', { name: '다음' }).click();
  const saved = (await calls(page)).find((call) => call[0] === 'finish')![1] as Record<string, unknown>;
  expect(saved).toMatchObject({
    programs: [{ college: '소프트웨어융합대학', department: '소프트웨어학과' }, { college: '경영대학', department: '경영학과' }],
    year: 3, enrollmentStatus: '재학', keywords: ['장학'],
  });
  expect(saved.boards).toEqual(expect.arrayContaining(['skku-notice01', 'cse-notice', 'futurecar-notice', 'aiuniv-notice']));
  expect(saved).not.toHaveProperty('joinedPrograms');
  // 알림은 나중에 해도 된다.
  await expect(dialog.getByRole('heading', { name: '알림을 켜 둘까요?' })).toBeFocused();
  await dialog.getByRole('button', { name: '나중에 할게요' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('.app')).not.toHaveAttribute('inert', '');
});

test('first-run setup requires one AI key at the end and records completion only then', async ({ page }) => {
  await page.goto('/?api=sample/api/v1');
  await page.locator('notice-rows-screen a.row').first().waitFor();
  await page.evaluate(() => {
    const app = document.querySelector('notice-app') as unknown as Record<string, unknown>;
    const w = window as unknown as { calls: unknown[][] };
    w.calls = [];
    app.profile = { programs: [], year: null, semester: null, enrollmentStatus: null, militaryService: null, onboardedAt: null, admissionYear: null, university3pInternshipSelected: null, deptInternshipDone: null, university3pInternshipDone: null };
    app.profileStatus = 'ready'; app.authUserId = 'account-a'; app.pushStatus = 'on'; app.byokOn = true; app.byokLoading = false; app.byokStatus = null; app.aiKeys = [];
    app.finishOnboarding = (draft: unknown, final: unknown) => { w.calls.push(['finish', final]); (app.applyOnboardingSaved as (p: unknown) => void)({ ...(app.profile as object) }); return Promise.resolve(true); };
    app.completeOnboarding = () => { w.calls.push(['complete']); app.profile = { ...(app.profile as object), onboardedAt: 'x' }; (app.closeOnboarding as () => void)(); return Promise.resolve(true); };
  });
  const dialog = page.getByRole('dialog');
  const next = () => dialog.getByRole('button', { name: '다음' }).click();
  await dialog.getByRole('button', { name: '경영대학', exact: true }).click();
  await dialog.getByRole('radio', { name: '경영학과', exact: true }).click();
  await next();
  await dialog.getByRole('radio', { name: '없어요', exact: true }).click();
  await dialog.getByRole('button', { name: '3학년' }).click();
  await next();
  await expect(dialog.getByRole('heading', { name: '3품 인턴십 영역을 채웠나요?' })).toBeVisible();   // 질문이 하나뿐이라 제목이 곧 질문이다
  await expect(dialog.getByRole('button', { name: '다음' })).toBeDisabled();
  await dialog.getByRole('button', { name: '채웠어요' }).click();
  await next();
  await next();     // 받을 공지: 저장. 키가 없으니 완료 표시는 미룬다.
  expect((await calls(page)).filter((c) => c[0] === 'finish')).toEqual([['finish', false]]);
  // 알림이 이미 켜져 있으면 건너뛰고 AI 키로 간다.
  await expect(dialog.getByRole('heading', { name: 'AI를 연결해 주세요' })).toBeVisible();
  await expect(dialog.getByRole('button', { name: '나중에 할게요' })).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: '끝내기' })).toBeDisabled();
  await expect(dialog.getByText('필수 선택이에요')).toBeVisible();
  await expect(dialog.getByText('키를 하나 연결해 주세요')).toBeVisible();
  await page.evaluate(() => { (document.querySelector('notice-app') as unknown as Record<string, unknown>).byokStatus = { keyHint: 'DDDD', model: 'm', disabled: false, lastError: null, usedToday: 0 }; });
  await expect(dialog.getByRole('button', { name: '끝내기' })).toBeEnabled();
  await dialog.getByRole('button', { name: '끝내기' }).click();
  expect((await calls(page)).filter((c) => c[0] === 'complete')).toHaveLength(1);
  await expect(dialog).toHaveCount(0);
});

test('pressable elements share one hover response: settings switch row and first-run tile and chip change color on mouse hover', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'mobile', '마우스 올림은 넓은 화면에서만 본다');
  const hoverChanges = async (target: import('@playwright/test').Locator) => {
    await target.waitFor();
    const bg = () => target.evaluate((el) => getComputedStyle(el).backgroundColor);
    await page.mouse.move(0, 0);
    await expect.poll(bg).toBe(await bg());
    const before = await bg();
    await target.hover();
    await expect.poll(bg).not.toBe(before);
  };
  await settingsAt(page, '&section=notifications');
  await withApp(page, { authUserId: 'account-a', subscriptions: ['skku-notice01'], toggleSubscription: 'fn:toggle' });
  await hoverChanges(page.locator('platform-settings-screen').getByRole('switch').first());
  await page.goto('/?api=sample/api/v1');
  await page.locator('notice-rows-screen a.row').first().waitFor();
  await page.evaluate(() => {
    const app = document.querySelector('notice-app') as unknown as Record<string, unknown>;
    app.profile = { programs: [], year: null, semester: null, enrollmentStatus: null, militaryService: null, onboardedAt: null, admissionYear: null, university3pInternshipSelected: null, deptInternshipDone: null, university3pInternshipDone: null };
    app.profileStatus = 'ready'; app.authUserId = 'account-a'; app.pushStatus = 'on'; app.byokOn = true; app.byokLoading = false; app.byokStatus = null; app.aiKeys = [];
  });
  const dialog = page.getByRole('dialog');
  await hoverChanges(dialog.getByRole('group', { name: '단과대 선택' }).getByRole('button').first());
  await dialog.getByRole('group', { name: '단과대 선택' }).getByRole('button', { name: '경영대학', exact: true }).click();
  await dialog.getByRole('radio', { name: '경영학과', exact: true }).click();
  await dialog.getByRole('button', { name: '다음' }).click();
  await dialog.getByRole('radio', { name: '없어요', exact: true }).click();
  await hoverChanges(dialog.getByRole('button', { name: '3학년' }));
});

test('college tiles in first-run setup change color on mouse hover like other choices', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'mobile', '마우스 올림은 넓은 화면에서만 본다');
  await page.goto('/?api=sample/api/v1');
  await page.locator('notice-rows-screen a.row').first().waitFor();
  await page.evaluate(() => {
    const app = document.querySelector('notice-app') as unknown as Record<string, unknown>;
    app.profile = { programs: [], year: null, semester: null, enrollmentStatus: null, militaryService: null, onboardedAt: null, admissionYear: null, university3pInternshipSelected: null, deptInternshipDone: null, university3pInternshipDone: null };
    app.profileStatus = 'ready'; app.authUserId = 'account-a'; app.pushStatus = 'on'; app.byokOn = true; app.byokLoading = false; app.byokStatus = null; app.aiKeys = [];
  });
  const tile = page.getByRole('dialog').getByRole('group', { name: '단과대 선택' }).getByRole('button').first();
  await tile.waitFor();
  const bg = () => tile.evaluate((el) => getComputedStyle(el).backgroundColor);
  const before = await bg();
  await tile.hover();
  await expect.poll(bg).not.toBe(before);
});

test('first-run "more boards" works like settings: search or pick a college, toggle in place, and the grid shows how many are on', async ({ page }) => {
  await page.goto('/?api=sample/api/v1');
  await page.locator('notice-rows-screen a.row').first().waitFor();
  await page.evaluate(() => {
    const app = document.querySelector('notice-app') as unknown as Record<string, unknown>;
    app.profile = { programs: [], year: null, semester: null, enrollmentStatus: null, militaryService: null, onboardedAt: null, admissionYear: null, university3pInternshipSelected: null, deptInternshipDone: null, university3pInternshipDone: null };
    app.profileStatus = 'ready'; app.authUserId = 'account-a'; app.pushStatus = 'on'; app.byokOn = true; app.byokLoading = false; app.byokStatus = null; app.aiKeys = [];
    app.sources = [
      { id: 'skku-notice01', name: '성균관대 공지' }, { id: 'biz-notice', name: '경영대학 공지' }, { id: 'bus-notice', name: '경영학과 공지' },
      { id: 'liberalarts-notice', name: '문과대학 공지' }, { id: 'korean-notice', name: '국어국문학과 공지' }, { id: 'english-notice', name: '영어영문학과 공지' },
      { id: 'french-notice', name: '프랑스어문학과 공지' }, { id: 'chinese-notice', name: '중어중문학과 공지' }, { id: 'german-notice', name: '독어독문학과 공지' },
      { id: 'russian-notice', name: '러시아어문학과 공지' }, { id: 'sscience-notice', name: '사회과학대학 공지' }, { id: 'ecostat-notice', name: '경제대학 공지' },
    ];
  });
  const dialog = page.getByRole('dialog');
  const next = () => dialog.getByRole('button', { name: '다음' }).click();
  await dialog.getByRole('button', { name: '경영대학', exact: true }).click();
  await dialog.getByRole('radio', { name: '경영학과', exact: true }).click();
  await next();
  await dialog.getByRole('radio', { name: '없어요', exact: true }).click();
  await dialog.getByRole('button', { name: '3학년' }).click();
  await next();
  await dialog.getByRole('button', { name: '채웠어요' }).click();
  await next();
  await expect(dialog.getByRole('heading', { name: '어떤 공지를 받을까요?' })).toBeVisible();
  await dialog.getByRole('button', { name: /게시판 [0-9]+개 더 보기/ }).click();
  // 한 줄씩 늘어놓은 목록이 아니라 검색 칸과 단과대 격자가 먼저 보인다.
  const grid = dialog.getByRole('group', { name: '단과대 선택' });
  await expect(dialog.getByRole('searchbox', { name: '게시판 검색' })).toBeVisible();
  await expect(grid.getByRole('button')).toHaveText(['문과대학', '사회과학대학', '경제대학']);   // 켜 둔 경영대학 게시판은 위 목록에 있고, 남은 것만 묶는다
  // 고른 전공의 단과대·학과 게시판은 켜진 채로 위 목록에 있다.
  for (const name of ['성균관대 공지', '경영대학 공지', '경영학과 공지']) await expect(dialog.getByRole('group', { name: '게시판', exact: true }).getByRole('switch', { name })).toBeChecked();
  await grid.getByRole('button', { name: '문과대학' }).click();
  await dialog.getByRole('switch', { name: '국어국문학과 공지' }).click();
  await expect(dialog.getByRole('switch', { name: '국어국문학과 공지' })).toBeChecked();
  await dialog.getByRole('button', { name: '다른 단과대 고르기' }).click();
  await expect(grid.getByRole('button', { name: /문과대학/ })).toContainText('1개 켜짐');   // 묶음을 닫아도 무엇을 켰는지 보인다
  // 검색하면 단과대를 거치지 않고 바로 켠다.
  await dialog.getByRole('searchbox', { name: '게시판 검색' }).fill('영어');
  await dialog.getByRole('switch', { name: '영어영문학과 공지' }).click();
  await dialog.getByRole('searchbox', { name: '게시판 검색' }).fill('');
  await expect(grid.getByRole('button', { name: /문과대학/ })).toContainText('2개 켜짐');
});

test('first-run boards: when only a few boards are left they sit in the list without a "more" fold', async ({ page }) => {
  await page.goto('/?api=sample/api/v1');
  await page.locator('notice-rows-screen a.row').first().waitFor();
  await page.evaluate(() => {
    const app = document.querySelector('notice-app') as unknown as Record<string, unknown>;
    app.profile = { programs: [], year: null, semester: null, enrollmentStatus: null, militaryService: null, onboardedAt: null, admissionYear: null, university3pInternshipSelected: null, deptInternshipDone: null, university3pInternshipDone: null };
    app.profileStatus = 'ready'; app.authUserId = 'account-a'; app.pushStatus = 'on'; app.byokOn = true; app.byokLoading = false; app.byokStatus = null; app.aiKeys = [];
    app.subscriptions = ['skku-notice01']; app.subscriptionsLoading = false;   // 이미 받는 게시판이 있는 계정도 전공 게시판이 켜진다
    app.sources = [{ id: 'skku-notice01', name: '성균관대 공지' }, { id: 'biz-notice', name: '경영대학 공지' }, { id: 'bus-notice', name: '경영학과 공지' }, { id: 'liberalarts-notice', name: '문과대학 공지' }];
  });
  const dialog = page.getByRole('dialog');
  const next = () => dialog.getByRole('button', { name: '다음' }).click();
  await dialog.getByRole('button', { name: '경영대학', exact: true }).click();
  await dialog.getByRole('radio', { name: '경영학과', exact: true }).click();
  await next();
  await dialog.getByRole('radio', { name: '없어요', exact: true }).click();
  await dialog.getByRole('button', { name: '3학년' }).click();
  await next();
  await dialog.getByRole('button', { name: '채웠어요' }).click();
  await next();
  const boards = dialog.getByRole('group', { name: '게시판', exact: true });
  for (const name of ['성균관대 공지', '경영대학 공지', '경영학과 공지']) await expect(boards.getByRole('switch', { name })).toBeChecked();
  await expect(boards.getByRole('switch', { name: '문과대학 공지' })).not.toBeChecked();   // 하나 남은 게시판은 접지 않고 바로 보인다
  await expect(dialog.getByRole('button', { name: /더 보기/ })).toHaveCount(0);
});

test('reopening a setup that was saved but left at the AI key step resumes at that step instead of asking everything again', async ({ page }) => {
  await page.goto('/?api=sample/api/v1');
  await page.locator('notice-rows-screen a.row').first().waitFor();
  // 게시판 단계에서 저장까지 했고(전공·학년·재학·3품) 키를 연결하기 전에 나갔다. 다시 열면 프로필을 읽은 뒤 첫 설정이 뜬다.
  await page.evaluate(() => {
    const app = document.querySelector('notice-app') as unknown as Record<string, unknown>;
    app.authUserId = 'account-a'; app.pushStatus = 'on'; app.byokOn = true; app.byokLoading = false; app.byokStatus = null; app.aiKeys = [];
    app.profile = { programs: [{ college: '경영대학', department: '경영학과' }], year: 3, semester: null, enrollmentStatus: '재학', militaryService: null, onboardedAt: null, admissionYear: null, university3pInternshipSelected: true, deptInternshipDone: null, university3pInternshipDone: false };
    app.profileStatus = 'ready';
  });
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: 'AI를 연결해 주세요' })).toBeVisible();   // 클릭 0번으로 남은 단계
  await expect(dialog.getByRole('button', { name: '끝내기' })).toBeDisabled();
  // 뒤로 가면 앞에서 한 답이 그대로 있다(복수전공 '없어요'를 다시 고르지 않아도 된다).
  await dialog.getByRole('button', { name: '이전 단계' }).click();
  await expect(dialog.getByRole('heading', { name: '어떤 공지를 받을까요?' })).toBeVisible();
});

test('first-run setup never finishes without a key, even when the key service is unreachable (no exception)', async ({ page }) => {
  await page.goto('/?api=sample/api/v1');
  await page.locator('notice-rows-screen a.row').first().waitFor();
  await page.evaluate(() => {
    const app = document.querySelector('notice-app') as unknown as Record<string, unknown>;
    const w = window as unknown as { calls: unknown[][] };
    w.calls = [];
    app.profile = { programs: [], year: null, semester: null, enrollmentStatus: null, militaryService: null, onboardedAt: null, admissionYear: null, university3pInternshipSelected: null, deptInternshipDone: null, university3pInternshipDone: null };
    app.profileStatus = 'ready'; app.authUserId = 'account-a'; app.pushStatus = 'on'; app.byokOn = false; app.byokLoading = false; app.byokStatus = null; app.aiKeys = []; app.recheckByok = () => Promise.resolve(false);
    app.finishOnboarding = (draft: unknown, final: unknown) => { w.calls.push(['finish', final]); (app.applyOnboardingSaved as (p: unknown) => void)({ ...(app.profile as object) }); return Promise.resolve(true); };
    app.completeOnboarding = () => { w.calls.push(['complete']); app.profile = { ...(app.profile as object), onboardedAt: 'x' }; (app.closeOnboarding as () => void)(); return Promise.resolve(true); };
  });
  const dialog = page.getByRole('dialog');
  const next = () => dialog.getByRole('button', { name: '다음' }).click();
  await dialog.getByRole('button', { name: '경영대학', exact: true }).click();
  await dialog.getByRole('radio', { name: '경영학과', exact: true }).click();
  await next();
  await dialog.getByRole('radio', { name: '없어요', exact: true }).click();
  await dialog.getByRole('button', { name: '3학년' }).click();
  await next();
  await expect(dialog.getByRole('heading', { name: '3품 인턴십 영역을 채웠나요?' })).toBeVisible();   // 질문이 하나뿐이라 제목이 곧 질문이다
  await expect(dialog.getByRole('button', { name: '다음' })).toBeDisabled();
  await dialog.getByRole('button', { name: '채웠어요' }).click();
  await next();
  await next();     // 받을 공지: 저장. 키가 없으니 완료 표시는 미룬다.
  expect((await calls(page)).filter((c) => c[0] === 'finish')).toEqual([['finish', false]]);
  // 알림이 이미 켜져 있으면 건너뛰고 AI 키로 간다.
  await expect(dialog.getByRole('heading', { name: 'AI를 연결해 주세요' })).toBeVisible();
  // 키 기능을 확인하지 못했어도 키 없이 끝낼 수 없다. 끝내기는 막혀 있고, 다시 확인할 수 있다.
  await expect(dialog.getByRole('button', { name: '나중에 할게요' })).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: '끝내기' })).toBeDisabled();
  await expect(dialog.getByRole('button', { name: '다시 확인하기' })).toBeVisible();
  expect((await calls(page)).filter((c) => c[0] === 'complete')).toHaveLength(0);
});

test('nothing chosen yet (an old skip): no boards and no notices, and no way to reopen the first-run setup from the list or settings', async ({ page }) => {
  await page.goto('/?api=sample/api/v1');
  await page.locator('notice-rows-screen a.row').first().waitFor();
  await page.evaluate(() => {
    const app = document.querySelector('notice-app') as unknown as Record<string, unknown>;
    app.profile = { programs: [], year: null, semester: null, enrollmentStatus: null, militaryService: null, onboardedAt: null, admissionYear: null, university3pInternshipSelected: null, deptInternshipDone: null, university3pInternshipDone: null };
    app.profileStatus = 'ready'; app.authUserId = 'account-a'; app.subscriptions = []; app.subscriptionsLoading = false; app.onboardingDismissed = true;   // 예전에 건너뛴 사람
  });
  const dialog = page.getByRole('dialog');
  await expect(dialog).toHaveCount(0);
  // 고른 게시판이 없으면 사이드바에도 게시판이 없고(소프트웨어학과 같은 대체 목록 없음) 공지도 없다.
  if (page.viewportSize()!.width >= 720) await expect(page.locator('.sidebar').getByRole('button', { name: /소프트웨어학과|경영대학|성균관대/ })).toHaveCount(0);
  await expect(page.locator('notice-rows-screen a.row')).toHaveCount(0);
  await expect(page.getByText('아직 설정을 안 했어요')).toBeVisible();
  // 첫 설정은 처음에만 열린다. 목록과 설정 어디에도 다시 여는 입구가 없다.
  await expect(page.getByRole('button', { name: '설정 시작하기' })).toHaveCount(0);
  await page.evaluate(() => (document.querySelector('notice-app') as unknown as { openSettings: (s: null) => void }).openSettings(null));
  const screen = page.locator('platform-settings-screen');
  await expect(screen.getByRole('heading', { name: '내 설정' })).toBeVisible();
  await expect(screen.getByRole('heading', { name: '첫 설정' })).toHaveCount(0);
  // 이미 마친 사람이 게시판을 모두 끄면 게시판 고르기로 이어 준다.
  await page.evaluate(() => { const app = document.querySelector('notice-app') as unknown as Record<string, unknown>; app.profile = { ...(app.profile as object), onboardedAt: 'x' }; (app.setView as (v: string) => void)('all'); });
  await expect(page.getByText('받을 게시판이 없어요')).toBeVisible();
  await expect(page.getByRole('button', { name: '게시판 고르기' })).toBeVisible();
});

test('first-run setup cannot be skipped: no skip button, Escape does nothing; settings edits the major in place', async ({ page }) => {
  await page.goto('/?api=sample/api/v1');
  await page.locator('notice-rows-screen a.row').first().waitFor();
  await page.evaluate(() => {
    const app = document.querySelector('notice-app') as unknown as Record<string, unknown>;
    app.profile = { programs: [], year: null, semester: null, enrollmentStatus: null, militaryService: null, onboardedAt: null };
    app.profileStatus = 'ready';
    app.authUserId = 'account-a';
  });
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: '나중에 하기' })).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: '닫기' })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: '다음' })).toBeDisabled();
  await expect(dialog.getByText('학과를 골라 주세요')).toBeVisible();
  await page.goto('/?view=settings&section=profile&api=sample/api/v1');
  await page.locator('platform-settings-screen').waitFor();
  await page.evaluate(() => {
    const app = document.querySelector('notice-app') as unknown as Record<string, unknown>;
    app.profileStatus = 'ready'; app.authUserId = 'account-a'; app.onboardingDismissed = true;
  });
  await page.getByRole('button', { name: /^(바꾸기|고르기)$/ }).first().click();
  await expect(page.getByText('주전공을 골라 주세요')).toBeVisible();   // 첫 설정 창이 아니라 설정 안에서 열린다
  await expect(dialog).toHaveCount(0);
  await page.getByRole('button', { name: '닫기' }).click();
  await expect(page.getByText('주전공을 골라 주세요')).toHaveCount(0);
});

test('a notice waiting for AI judgment is hidden from the list and counted in one line, until it is judged or AI is off', async ({ page }) => {
  await page.goto('/?api=sample/api/v1');
  const rows = page.locator('notice-rows-screen a.row');
  await rows.first().waitFor();
  await page.waitForLoadState('networkidle');
  const ids = await page.evaluate(() => (document.querySelector('notice-app') as unknown as { notices: { id: string }[] }).notices.slice(0, 3).map((n) => n.id));
  await page.evaluate((list) => {
    const app = document.querySelector('notice-app') as unknown as { notices: { id: string; first_seen: string | null }[] } & Record<string, unknown>;
    const hours = (h: number) => new Date(Date.now() - h * 3600 * 1000).toISOString();
    for (const notice of app.notices as unknown as Record<string, unknown>[]) {
      if (notice.id === list[0]) { notice.first_seen = hours(1); notice.deadline = null; }
      if (notice.id === list[1]) { notice.first_seen = hours(24 * 40); notice.deadline = null; }   // 30일이 지난 마감 없는 학교 공지: 대기 범위 밖
    }
    app.authUserId = 'account-a'; app.profileStatus = 'ready'; app.onboardingDismissed = true; app.subscriptions = ['skku-notice01']; app.subscriptionsLoading = false;
    app.byokStatus = null; app.aiKeys = []; app.generatedAt = new Date().toISOString();
    app.myJudgments = new Map([[list[2], { verdict: 'relevant', reason: '지원할 수 있어요', model: 'm', deadline: null, deadlineKind: null }]]);
    app.notices = [...app.notices];
  }, ids);
  const row = (id: string) => page.locator(`notice-rows-screen a.row[data-id="${id}"]`);
  const set = (patch: string) => page.evaluate((code) => { const app = document.querySelector('notice-app') as unknown as Record<string, unknown>; new Function('app', code)(app); }, patch);
  // 키가 없으면 판정을 기다리지 않으니 모두 보이고 안내 줄도 없다.
  await expect(row(ids[0])).toHaveCount(1);
  await expect(page.locator('p.waiting')).toHaveCount(0);
  // 키가 있으면 판정 전인 공지만 목록에서 빠지고 한 줄로 알린다. 범위 밖 공지와 판정된 공지는 그대로다.
  await set("app.byokStatus = { keyHint: 'DDDD', model: 'm', disabled: false, lastError: null, usedToday: 0 };");
  await expect(row(ids[0])).toHaveCount(0);
  await expect(row(ids[1])).toHaveCount(1);
  await expect(row(ids[2])).toHaveCount(1);
  await expect(page.locator('p.waiting')).toContainText(/AI 확인 전 \d+건/);
  // 판정이 생기면 보이고 안내 줄에서 빠진다.
  await set(`app.myJudgments = new Map([...app.myJudgments, ['${ids[0]}', { verdict: 'relevant', reason: '지원할 수 있어요', model: 'm', deadline: null, deadlineKind: null }]]);`);
  await expect(row(ids[0])).toHaveCount(1);
  await expect(row(ids[0]).locator('.reason')).not.toContainText('확인하고 있어요');
  // AI를 끄면 판정 전인 공지도 모두 보인다.
  await set(`app.myJudgments = new Map([['${ids[2]}', { verdict: 'relevant', reason: '지원할 수 있어요', model: 'm', deadline: null, deadlineKind: null }]]);`);
  await expect(row(ids[0])).toHaveCount(0);
  await set('app.aiPrefs = { aiEnabled: false };');
  await expect(row(ids[0])).toHaveCount(1);
  await expect(page.locator('p.waiting')).toHaveCount(0);
});

test('leaving settings returns to the list with the detail pane closed, whichever way you leave', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 800 });
  await page.goto('/?api=sample/api/v1');
  await page.locator('notice-rows-screen a.row').first().waitFor();
  await page.waitForLoadState('networkidle');
  const state = () => page.evaluate(() => { const a = document.querySelector('notice-app') as unknown as Record<string, unknown>; return { view: a.view, detailOpen: a.detailOpen, selectedId: a.selectedId }; });
  // 상세 칸을 열어 둔 사용자(저장된 설정)가 설정에 들어갔다 나온다.
  await page.evaluate(() => { const a = document.querySelector('notice-app') as unknown as Record<string, unknown> & { setDetail: (open: boolean) => void }; a.setDetail(true); });
  for (const how of ['X 버튼', '뒤로 가기']) {
    await page.getByRole('button', { name: '설정', exact: true }).click();
    await expect(page.locator('platform-settings-screen')).toBeVisible();
    if (how === 'X 버튼') await page.getByRole('button', { name: '설정 닫기' }).click(); else await page.goBack();
    await expect(page.locator('platform-settings-screen')).toHaveCount(0);
    expect(await state(), how).toMatchObject({ view: 'all', detailOpen: false, selectedId: null });
    await page.evaluate(() => { const a = document.querySelector('notice-app') as unknown as { setDetail: (open: boolean) => void }; a.setDetail(true); });
  }
});

test('initial loading does not animate the refresh button', async ({ page }) => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.route('**/notices.json', async (route) => { await gate; await route.continue(); });
  await page.goto('/?api=sample/api/v1');
  const button = page.getByRole('button', { name: '공지 다시 가져오기' });
  await expect(page.getByText('공지를 불러오고 있어요')).toBeVisible();
  await expect(button).toBeDisabled();
  await expect(button.locator('.animate-spin')).toHaveCount(0);
  await expect(page.locator('.navigation-head .animate-spin')).toHaveCount(0);
  release();
  await expect(button).toBeEnabled();
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
  await expect(button.locator('.animate-spin')).toHaveCount(1);        // 직접 누른 자리에서만 진행 상태를 보여 준다
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

test('settings home puts the daily settings first and groups iCampus and Google Calendar under "기타" further down', async ({ page }) => {
  await settingsAt(page);
  const screen = page.locator('platform-settings-screen');
  await withApp(page, { authUserId: 'account-a', profileStatus: 'ready', onboardingDismissed: true, profile: { programs: [{ college: '경영대학', department: '경영학과' }], year: 2, semester: 1, enrollmentStatus: '재학', militaryService: '해당 없음', onboardedAt: 'x', interests: '', wants: '', avoids: '' } });
  const heads = await screen.locator('h2.settings-head').allInnerTexts();
  expect(heads).toEqual(['내 설정', '계정', '화면', '기타']);
  const mine = screen.getByRole('region', { name: '내 설정' }), etc = screen.getByRole('region', { name: '기타' });
  expect(await mine.getByRole('link').allInnerTexts().then((list) => list.map((text) => text.split('\n')[0]))).toEqual(['알림', '관심 키워드']);
  expect(await etc.getByRole('link').allInnerTexts().then((list) => list.map((text) => text.split('\n')[0]))).toEqual(['아이캠퍼스', '구글 캘린더']);
  const y = async (loc: import('@playwright/test').Locator) => (await loc.boundingBox())!.y;
  expect(await y(etc)).toBeGreaterThan(await y(mine));
  expect(await y(etc)).toBeGreaterThan(await y(screen.getByRole('region', { name: '계정' })));
  // 기타 안의 항목도 한 번 눌러 자기 페이지로 간다.
  await etc.getByRole('link', { name: /아이캠퍼스/ }).click();
  await expect(page).toHaveURL(/section=canvas/);
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
  await up().click();
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
  for (const manual of [false]) {   // 첫 설정은 처음에만 열린다(다시 여는 경로는 없다)
    await open(manual);
    const dialog = page.getByRole('dialog');
    await dialog.waitFor();
    await dialog.getByRole('button', { name: '문과대학', exact: true }).scrollIntoViewIfNeeded();   // 아래로 스크롤된 상태에서도 어긋나지 않아야 한다
    const top = await box('.onb-top-inner'), body = await box('.onb-body');
    expect(Math.abs(top.x - body.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(top.width - body.width)).toBeLessThanOrEqual(1);
    // 처음 설정에는 닫기·건너뛰기가 없다. 다시 연 경우에만 닫기가 있다.
    if (!manual) await expect(dialog.getByRole('button', { name: /나중에 하기|닫기/ })).toHaveCount(0);
    const close = dialog.getByRole('button', { name: '닫기' });
    const closeBox = manual ? (await close.boundingBox())! : { x: top.x, width: 0, height: 44 };
    expect(closeBox.x + closeBox.width).toBeLessThanOrEqual(top.x + top.width + 0.5);
    expect(closeBox.height).toBeGreaterThanOrEqual(44);
    if (manual) expect(await close.evaluate((el) => getComputedStyle(el).borderTopWidth)).toBe('1px');   // 글자만이 아니라 테두리 있는 버튼으로 보인다
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
    if (manual) expect(Math.abs(centerY(closeBox as { y: number; height: number }) - centerY(bar))).toBeLessThanOrEqual(2);
    // 위 줄은 스크롤해도 붙어 있다.
    const before = (await box('.onb-top-inner')).y;
    await page.evaluate(() => document.querySelector('.onb-main')!.scrollTo({ top: 400 }));
    expect(Math.abs((await box('.onb-top-inner')).y - before)).toBeLessThanOrEqual(1);
    if (manual) await close.click();
    else await page.evaluate(() => { const app = document.querySelector('notice-app') as unknown as { closeOnboarding: () => void; onboardingDismissed: boolean }; app.onboardingDismissed = true; app.closeOnboarding(); });
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
    app.authUserId = 'account-a'; app.profileStatus = 'unavailable'; app.subscriptions = ['korean-notice', 'biz-notice']; app.subscriptionsLoading = false;
  });
  list = await labels();
  expect(list).toEqual(['모든 게시판', '경영대학', '국어국문학과', '게시판 더 고르기']);
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
    await page.getByRole('button', { name: '설정으로 돌아가기' }).first().click();
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
  await screen.getByLabel('Gemini 키', { exact: true }).fill(`AQ.${'a'.repeat(50)}`);
  await click('Gemini 연결하기', screen.getByRole('button', { name: 'Gemini 키 연결하기' }));
  expect(log.length).toBe(2);
  expect((await calls(page))[0][0]).toBe('registerKey');
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
  // 5) 게시판 하나 더 받기: 알림 → 게시판 더 보기 → 단과대 → 게시판 = 4클릭(전공 고르기와 같은 흐름). 검색하면 단과대를 건너뛴다.
  await withApp(page, {});
  log.length = 0;
  await click('알림', screen.getByRole('link', { name: /알림/ }).first());
  await click('게시판 더 보기', screen.locator('details.board-more-list > summary'));
  await click('단과대', screen.getByRole('group', { name: '단과대와 기타 묶음 선택' }).getByRole('button').first());
  await click('게시판 추가', screen.locator('.choice-list[aria-label$=" 게시판"] button').first());
  expect(log.length).toBe(4);
  expect((await calls(page)).some((call) => call[0] === 'toggle' && call[2] === true)).toBe(true);
});

test('google calendar page: connect first, then sync and disconnect, with plain explanations', async ({ page }) => {
  await settingsAt(page);
  const screen = page.locator('platform-settings-screen');
  await withApp(page, { authUserId: 'account-a', profileStatus: 'ready', onboardingDismissed: true, calendarId: null,
    connectCalendar: 'fn:connect', syncCalendarNow: 'fn:sync', disconnectCalendar: 'fn:disconnect' });
  await screen.getByRole('link', { name: /구글 캘린더/ }).click();
  await expect(page).toHaveURL(/section=calendar/);
  await expect(screen.getByRole('heading', { name: '구글 캘린더' })).toBeVisible();
  await expect(screen.getByRole('button', { name: '구글 캘린더에 연결하기' })).toBeVisible();   // 연결 전에는 누르는 단추만 있고 연결됨 표시는 없다
  await expect(screen.getByText('연결됨')).toHaveCount(0);
  await expect(screen.getByText(/내 다른 캘린더는 읽지 않아요/)).toBeVisible();
  // 단계 안내: 누르면 무슨 일이 생기는지, "확인되지 않은 앱"이 나오면 어떻게 하는지 알려 준다.
  await screen.getByText('연결하는 방법').click();
  await expect(screen.getByText(/고급.*을 누른 뒤.*계속/)).toBeVisible();
  await expect(screen.getByText(/"성대 공지" 캘린더가 생기고/)).toBeVisible();
  await screen.getByRole('button', { name: '구글 캘린더에 연결하기' }).click();
  expect(await calls(page)).toEqual([['connect']]);
  await withApp(page, { calendarId: 'abc123@group.calendar.google.com', calendarSyncedAt: '2026-11-08T03:00:00Z', calendarAuto: { active: false, error: null, lastRunAt: null } });
  // 예전에 연결해서 서버에 열쇠가 없으면 끊겼다고 한 번만 말하고 다시 연결 단추를 준다(같은 말을 세 번 하지 않는다).
  await expect(screen.getByText('연결이 끊겼어요')).toBeVisible();
  await expect(screen.getByText('자동으로 반영하려면 다시 연결해 주세요')).toHaveCount(0);
  await expect(screen.getByRole('button', { name: '다시 연결하기' })).toBeVisible();
  // 서버에 열쇠가 있으면 자동으로 맞추고 있다고 말하고 다시 연결 단추는 없다.
  await withApp(page, { calendarAuto: { active: true, error: null, lastRunAt: '2026-11-08T03:00:00Z' } });
  await expect(screen.getByText(/30분마다 자동으로 반영해요/)).toBeVisible();
  await expect(screen.getByRole('button', { name: '다시 연결하기' })).toHaveCount(0);
  // 멈췄으면 이유와 다음 행동(다시 연결)을 보여 준다.
  await withApp(page, { calendarAuto: { active: false, error: '구글 연결이 끊겼어요. 설정에서 구글 캘린더를 다시 연결해 주세요.', lastRunAt: null } });
  await expect(screen.getByText('구글 연결이 끊겼어요. 설정에서 구글 캘린더를 다시 연결해 주세요.')).toBeVisible();
  await expect(screen.getByText('연결됨', { exact: true })).toHaveCount(0);
  await withApp(page, { calendarAuto: { active: true, error: null, lastRunAt: null }, connectCalendar: 'fn:connect', syncCalendarNow: 'fn:sync', disconnectCalendar: 'fn:disconnect' });
  await expect(screen.getByRole('button', { name: '구글 캘린더에 연결하기' })).toHaveCount(0);
  await screen.getByRole('button', { name: '지금 반영하기' }).click();
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
  expect(tall.gutter).toBeLessThanOrEqual(0.5);                 // 넘치지 않으면 막대 자리도 없다(스크롤바 자리를 미리 비우지 않고 화면을 최대한 쓴다. 헤드리스는 막대를 그리지 않아 이 값은 참고용이다)
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
  // 자동 요약이 실패해도 "다시 만들기" 단추는 없다(사용자 지시): 요약 칸을 보이지 않는다.
  await set({ summarizing: false });
  await expect(detail.getByRole('region', { name: '요약' })).toHaveCount(0);
  await expect(detail.getByRole('button', { name: '다시 만들기' })).toHaveCount(0);
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

test('notifications page: this device and the device list, like the original settings', async ({ page }) => {
  await settingsAt(page, '&section=notifications');
  const screen = page.locator('platform-settings-screen');
  const devices = [
    { id: 'd1', endpoint: 'https://fcm.googleapis.com/a', name: 'Windows · Whale', canvasMode: 'reminders', createdAt: '2026-11-07T10:00:00Z' },
    { id: 'd2', endpoint: 'https://fcm.googleapis.com/b', name: 'Android · Chrome', canvasMode: 'summary', createdAt: '2026-11-08T01:00:00Z' },
  ];
  await withApp(page, { authUserId: 'account-a', pushStatus: 'on', devices, thisDeviceId: 'd1', summaryTime: '21:05',
    canvasStatus: { keyHint: 'ZZZZ', disabled: false, lastError: null, lastOkAt: null },
    refreshDevices: 'fn:refresh', setCanvasMode: 'fn:mode', removeDevice: 'fn:remove', renameDevice: 'fn:rename', setSummaryTime: 'fn:time' });
  // 아이캠퍼스 알림은 이 쪽에 없다(설정 홈의 아이캠퍼스에서 켠다).
  await expect(screen.getByRole('switch', { name: /아이캠퍼스/ })).toHaveCount(0);
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
});

test('iCampus page: switch on → token → summary time, each in its own section, with the fewest clicks', async ({ page }) => {
  await settingsAt(page, '&section=canvas');
  const screen = page.locator('platform-settings-screen');
  const devices = [{ id: 'd1', endpoint: 'https://fcm.googleapis.com/a', name: 'Windows · Whale', canvasMode: 'off', createdAt: '2026-11-07T10:00:00Z' }];
  await withApp(page, { authUserId: 'account-a', profileStatus: 'ready', onboardingDismissed: true, byokOn: true, byokLoading: false, pushStatus: 'on', devices, thisDeviceId: 'd1',
    summaryTime: null, canvasStatus: null, refreshDevices: 'fn:refresh', setCanvasMode: 'fn:mode', registerCanvas: 'fn:registerCanvas', removeCanvas: 'fn:removeCanvas', setSummaryTime: 'fn:time' });
  const sw = screen.getByRole('switch', { name: /아이캠퍼스 알림/ });
  // 꺼져 있어도 토큰 입력칸은 있다(연결 키 쪽과 같은 입력 줄). 요약 시간은 켜야 나온다.
  await expect(sw).toHaveAttribute('aria-checked', 'false');
  await expect(screen.getByLabel('아이캠퍼스 토큰', { exact: true })).toBeVisible();
  await expect(screen.getByRole('group', { name: '하루 요약 시간' })).toHaveCount(0);
  expect(await screen.locator('h2.settings-head').allInnerTexts()).toEqual(['알림', '토큰']);
  let clicks = 0;
  // 1) 스위치 켜기: 요약 시간이 아래에 열리고, 토큰을 연결할 때까지 잠겨 있다.
  await sw.click(); clicks += 1;
  await expect(sw).toHaveAttribute('aria-checked', 'true');
  const input = screen.getByLabel('아이캠퍼스 토큰', { exact: true });
  await expect(input).toHaveAttribute('type', 'password');
  // 구역은 알림 → 토큰 → 하루 요약 순으로 따로 제목이 있다.
  const heads = await screen.locator('h2.settings-head').allInnerTexts();
  expect(heads).toEqual(['알림', '토큰', '하루 요약']);
  const order = await screen.evaluate((root) => ['아이캠퍼스 토큰', '하루 요약 시간'].map((text) => (root.textContent ?? '').indexOf(text)));
  expect(order[0]).toBeGreaterThan(-1);
  expect(order[0]).toBeLessThan(order[1]);                     // 키가 요약 시간보다 위
  const time = screen.getByRole('group', { name: '하루 요약 시간' });
  await expect(time.getByRole('radio', { name: '오전' })).toBeDisabled();
  await expect(screen.getByText('토큰을 연결하면 바꿀 수 있어요')).toBeVisible();
  // 2) 키 입력: 형식이 맞지 않으면 저장할 수 없다. 맞으면 저장 한 번.
  await input.fill('짧음');
  await expect(screen.getByRole('button', { name: '아이캠퍼스 토큰 연결하기' })).toBeDisabled();
  const token = `1234~${'Z'.repeat(40)}`;
  await input.fill(token);
  await screen.getByText('토큰은 어디서 받나요?').click();
  await expect(screen.getByRole('link', { name: '아이캠퍼스 설정' })).toHaveAttribute('href', 'https://canvas.skku.edu/profile/settings');
  await screen.getByRole('button', { name: '아이캠퍼스 토큰 연결하기' }).click(); clicks += 1;
  expect((await calls(page)).filter((c) => c[0] === 'registerCanvas')).toEqual([['registerCanvas', token]]);
  // 3) 연결되면 모드가 꺼짐이던 이 기기를 켜고, 요약 시간이 풀린다. 입력한 키는 화면에 남지 않는다.
  await withApp(page, { canvasStatus: { keyHint: 'ZZZZ', disabled: false, lastError: null, lastOkAt: null }, summaryTime: '21:00' });
  await expect(screen.getByText('연결됨 ····ZZZZ')).toBeVisible();
  expect(await screen.innerText()).not.toContain(token);
  // 넓은 화면에서는 토큰 줄의 조작이 스위치처럼 오른쪽 끝에 붙는다.
  if (test.info().project.name === 'desktop') {
    const right = async (loc: import('@playwright/test').Locator) => { const box = (await loc.boundingBox())!; return box.x + box.width; };
    const swRight = await right(sw);
    const lastAction = await right(screen.getByRole('button', { name: '아이캠퍼스 토큰 연결 끊기', exact: true }));
    expect(Math.abs(swRight - lastAction)).toBeLessThanOrEqual(4);
  }
  expect((await calls(page)).filter((c) => c[0] === 'mode')).toEqual([['mode', 'reminders']]);
  await expect(time.getByRole('radio', { name: '오전' })).toBeEnabled();
  await time.getByRole('radio', { name: '오전' }).click(); clicks += 1;
  expect((await calls(page)).filter((c) => c[0] === 'time').at(-1)).toEqual(['time', 'am', 9, 0]);
  expect(clicks).toBe(3);   // 켜기, 키 저장, 시간 고르기
  await expect(screen.getByRole('radiogroup', { name: '받을 아이캠퍼스 알림' }).getByRole('radio')).toHaveText(['하루 요약', '요약과 마감']);
  // 4) 키를 끊어도 입력칸은 그대로 열려 있어 바로 다시 넣을 수 있다.
  await screen.getByRole('button', { name: '아이캠퍼스 토큰 연결 끊기', exact: true }).click();
  await screen.getByRole('button', { name: '아이캠퍼스 토큰 연결 끊기 확인' }).click();
  expect((await calls(page)).filter((c) => c[0] === 'removeCanvas')).toEqual([['removeCanvas']]);
  await withApp(page, { canvasStatus: null, summaryTime: null });
  await expect(sw).toHaveAttribute('aria-checked', 'true');
  await expect(screen.getByLabel('아이캠퍼스 토큰', { exact: true })).toBeVisible();
  // 이 기기 알림이 꺼져 있어도 스위치는 눌리고 설정이 열린다. 같은 자리에서 이 기기 알림을 켜게 한다.
  await withApp(page, { pushStatus: 'off', enablePush: 'fn:enablePush', canvasStatus: { keyHint: 'ZZZZ', disabled: false, lastError: null, lastOkAt: null }, summaryTime: '21:00' });
  await expect(sw).toBeEnabled();
  await expect(sw).toHaveAttribute('aria-checked', 'true');
  await expect(screen.getByRole('group', { name: '하루 요약 시간' })).toBeVisible();
  await screen.getByRole('button', { name: '이 기기 알림 켜기' }).click();
  expect((await calls(page)).filter((c) => c[0] === 'enablePush')).toHaveLength(1);
  // 처음부터 꺼져 있던 기기에서도 스위치를 켜면 설정이 열린다.
  await settingsAt(page, '&section=canvas');
  await withApp(page, { authUserId: 'account-a', profileStatus: 'ready', onboardingDismissed: true, byokOn: true, byokLoading: false, pushStatus: 'off', devices: [], thisDeviceId: null,
    summaryTime: null, canvasStatus: null, refreshDevices: 'fn:refresh', setCanvasMode: 'fn:mode' });
  await expect(sw).toHaveAttribute('aria-checked', 'false');
  await expect(sw).toBeEnabled();
  await sw.click();
  await expect(sw).toHaveAttribute('aria-checked', 'true');
  await expect(screen.getByRole('group', { name: '하루 요약 시간' })).toBeVisible();
  await expect(screen.getByRole('button', { name: '이 기기 알림 켜기' })).toBeVisible();
  expect((await calls(page)).filter((c) => c[0] === 'mode')).toEqual([]);   // 기기가 없으면 모드를 저장하지 않는다
});

test('iCampus page: a device that already has alerts on shows them open, and the switch turns them off', async ({ page }) => {
  await settingsAt(page, '&section=canvas');
  const screen = page.locator('platform-settings-screen');
  const devices = [{ id: 'd1', endpoint: 'https://fcm.googleapis.com/a', name: 'Windows · Whale', canvasMode: 'reminders', createdAt: '2026-11-07T10:00:00Z' }];
  await withApp(page, { authUserId: 'account-a', profileStatus: 'ready', onboardingDismissed: true, pushStatus: 'on', devices, thisDeviceId: 'd1', summaryTime: '21:05',
    canvasStatus: { keyHint: 'ZZZZ', disabled: false, lastError: null, lastOkAt: null }, refreshDevices: 'fn:refresh', setCanvasMode: 'fn:mode', setSummaryTime: 'fn:time' });
  // 아이캠퍼스 알림: 스위치가 켜져 있고(이 기기 모드가 끔이 아님) 키·요약 시간·받을 알림이 펼쳐져 있다.
  const sw = screen.getByRole('switch', { name: /아이캠퍼스 알림/ });
  await expect(sw).toHaveAttribute('aria-checked', 'true');
  const mode = screen.getByRole('radiogroup', { name: '받을 아이캠퍼스 알림' });
  await expect(mode.getByRole('radio')).toHaveText(['하루 요약', '요약과 마감']);
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
  // 스위치를 끄면 이 기기 모드가 꺼지고 펼친 것이 접힌다.
  await sw.click();
  expect((await calls(page)).filter((c) => c[0] === 'mode').at(-1)).toEqual(['mode', 'off']);
  await expect(screen.getByRole('group', { name: '하루 요약 시간' })).toHaveCount(0);
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

test('on read rows the judgment labels keep their color but are lighter (not gray), with readable contrast', async ({ page }) => {
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
      const [lr, lg, lb] = await rgb(page, label);
      expect(Math.max(lr, lg, lb) - Math.min(lr, lg, lb), `${scheme} ${tone}: 읽은 글의 라벨도 색이 있다(회색이 아니다)`).toBeGreaterThan(20);
      expect(label, `${scheme} ${tone}: 이유 문장과 같은 회색이 아니다`).not.toBe(plain);
      expect(contrast(await rgb(page, label), await rgb(page, surface)), `${scheme} ${tone} 대비`).toBeGreaterThanOrEqual(3);
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

test('software original major is asked for the admission year and the internship status, and the detail shows the two tracks as one colored line each', async ({ page }) => {
  await page.goto('/?api=sample/api/v1');
  await page.locator('notice-rows-screen a.row').first().waitFor();
  await page.evaluate(() => {
    const app = document.querySelector('notice-app') as unknown as Record<string, unknown>;
    const w = window as unknown as { calls: unknown[][] };
    w.calls = [];
    app.finishOnboarding = (draft: unknown) => { w.calls.push(['finish', draft]); (app.applyOnboardingSaved as (profile: unknown) => void)({ ...(app.profile as object), onboardedAt: 'x' }); return Promise.resolve(true); };
    app.closeOnboarding = () => { app.onboardingOpen = false; app.profile = { ...(app.profile as object), onboardedAt: 'x' }; };
    app.profile = { programs: [], year: null, semester: null, enrollmentStatus: null, militaryService: null, onboardedAt: null, admissionYear: null, university3pInternshipSelected: null, deptInternshipDone: null, university3pInternshipDone: null };
    app.profileStatus = 'ready';
    app.pushStatus = 'on';
    app.byokStatus = { keyHint: 'DDDD', model: 'm', disabled: false, lastError: null, usedToday: 0 }; app.authUserId = 'account-a';
  });
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: '소프트웨어융합대학', exact: true }).click();
  await dialog.getByRole('radio', { name: '소프트웨어학과', exact: true }).click();
  await dialog.getByRole('button', { name: '다음' }).click();
  await dialog.getByRole('radio', { name: '없어요', exact: true }).click();   // 없어요를 누르면 바로 다음 단계로 간다
  await dialog.getByRole('button', { name: '3학년' }).click();
  await dialog.getByRole('button', { name: '다음' }).click();
  await expect(dialog.getByRole('group', { name: '입학 연도' })).toBeVisible();
  await expect(dialog.getByRole('button', { name: '다음' })).toBeDisabled();
  await dialog.getByRole('button', { name: '2022', exact: true }).click();
  await expect(dialog.getByRole('button', { name: '다음' })).toBeDisabled();   // 3품 인턴십과 솦 인턴십도 답해야 한다
  await expect(dialog.getByText('3품 인턴십을 골라 주세요')).toBeVisible();
  await dialog.getByRole('group', { name: '솦 인턴십' }).getByRole('button', { name: '아직이에요' }).click();
  await expect(dialog.getByText('3품 인턴십을 골라 주세요')).toBeVisible();
  await dialog.getByRole('group', { name: '3품 인턴십' }).getByRole('button', { name: '안 해요' }).click();
  await expect(dialog.getByRole('button', { name: '다음' })).toBeEnabled();
  await dialog.getByRole('button', { name: '다음' }).click();
  await dialog.getByRole('button', { name: '다음' }).click();
  const saved = await page.evaluate(() => (window as unknown as { calls: unknown[][] }).calls.find((call) => call[0] === 'finish')![1] as Record<string, unknown>);
  expect(saved.admissionYear).toBe(2022);
  expect(saved.university3pInternshipSelected).toBe(false);
  expect(saved.deptInternshipDone).toBe(false);
  expect(saved.university3pInternshipDone).toBe(false);

  // 상세: 학과와 학교 3품이 따로, 되면 초록·안 되면 빨강 글자로 한 줄, 기준은 눌러서 본다.
  await page.evaluate(() => {
    const app = document.querySelector('notice-app') as unknown as Record<string, unknown>;
    const track = (status: string, label: string, note: string, result: string) => ({ status, label, checks: [{ ruleId: 'X', result, note }], unknowns: [], afterCompletion: [], notes: [] });
    app.subscriptions = ['skku-notice01'];   // 받을 게시판을 고른 사람(안 고르면 목록이 비어 있다)
    app.aiPrefs = { aiEnabled: false };   // 판정을 기다리는 공지는 목록에서 빠지므로 이 시험은 AI를 꺼 둔다
    app.profile = { ...(app.profile as object), programs: [{ college: '소프트웨어융합대학', department: '소프트웨어학과' }], deptInternshipDone: false, university3pInternshipDone: false, university3pInternshipSelected: true };
    app.showsGraduation = () => true;
    app.graduationFor = () => ({ state: 'ready', aiStatus: 'no_key', department: track('NEEDS_REVIEW', '학과 확인 필요', '담당 업무가 SW와 맞는지 확인하지 못했어요', 'unknown'), university3p: track('NOT_ELIGIBLE', '3품 기준에 못 미쳐요', '최대 240시간이라 280시간에 못 미쳐요', 'fail'), facts: { organizationName: null, workMode: 'unknown', startDate: null, endDate: null, hours: null, taskCategory: 'unknown', missing: ['담당 업무'] } });
    app.requestUpdate();
  });
  await page.locator('notice-rows-screen a.row').nth(1).click();
  const section = page.getByRole('region', { name: '인턴십 요건 확인' });
  await expect(section).toBeVisible();
  // 안내문: 평소에는 면책 한 줄과 "판정 근거" 단추만 보이고, 누르면 읽은 내용과 기준이 펼쳐진다. 눌리는 영역은 44px 이상이다.
  const notes = page.getByLabel('인턴십 요건 안내');
  await expect(notes).toContainText('실제 인정 여부는 학교와 학과에 확인해 주세요');
  await expect(notes).not.toContainText('Gemini');   // 업체 이름이 아니라 AI 키라고 쓴다
  await expect(notes).toContainText('AI 키를 연결하면 담당 업무까지 확인해요');
  await expect(notes.getByText('3품은 근무 시간이 280시간 이상인지 확인해요')).toHaveCount(0);
  const criteria = notes.getByRole('button', { name: /판정 근거/ });
  expect((await criteria.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await criteria.click();
  await expect(criteria).toHaveAttribute('aria-expanded', 'true');
  await expect(notes.getByText('3품은 근무 시간이 280시간 이상인지 확인해요')).toBeVisible();
  await expect(notes.getByText('공고에 없어 확인하지 못한 내용: 담당 업무')).toBeVisible();   // 무엇을 못 읽었는지 보인다
  await expect(notes.getByText('솦은 소프트웨어 업무인지와 근무 기간·시간을 확인해요')).toBeVisible();
  await expect(section.getByText('솦 인턴십 확인 필요', { exact: true })).toBeVisible();
  const p3 = section.getByText('3품 인턴십 어려움', { exact: true });
  await expect(p3).toBeVisible();
  await expect(section.getByText('최대 240시간이라 280시간에 못 미쳐요')).toBeVisible();
  // 안 되는 쪽은 "해당 없음"처럼 굵지 않은 옅은 회색이다(빨강이나 배지가 아니다).
  expect(await p3.evaluate((el) => getComputedStyle(el).fontWeight)).toBe('400');
  expect(await p3.evaluate((el) => getComputedStyle(el).color)).toBe(await page.evaluate(() => { const probe = document.createElement('span'); probe.style.color = 'var(--text-3)'; document.body.append(probe); const c = getComputedStyle(probe).color; probe.remove(); return c; }));
  // 인정 기준은 적지 않는다. 판정 한 줄과 이유 한 문장만 보인다.
  await expect(section).not.toContainText('인정 기준');
  await expect(section.getByRole('button')).toHaveCount(0);  // 판정은 서버가 미리 해 두므로 누를 것이 없다
  await expect(section).not.toContainText(/인정 완료|합격|승인됨/);
});

test('selection mode click order: enter → tick → count → action → toast → leave, by mouse and by keyboard', async ({ page }) => {
  await page.goto('/?api=sample/api/v1');
  const rows = page.locator('notice-rows-screen a.row');
  await rows.first().waitFor();
  const bar = page.locator('.select-options');
  const trigger = page.locator('.select-trigger');
  const rowBoxes = page.locator('.batch-row input[type=checkbox]');
  const tabbar = page.locator('nav.tabbar');
  const narrow = (page.viewportSize()?.width ?? 1000) < 720;

  // 1. 평소에는 선택 막대도 체크 칸도 없다.
  await expect(bar).toHaveCount(0);
  await expect(rowBoxes).toHaveCount(0);

  // 2. 마우스: 선택을 누르면 막대와 체크 칸이 생기고, 아무것도 안 골랐을 때 안내와 비활성 단추가 보인다.
  await trigger.click();
  await expect(bar).toBeVisible();
  await expect(bar.getByText('전체 선택')).toBeVisible();
  // 행동 단추는 처음부터 같은 자리에 있고, 아무것도 안 골랐을 때는 둘 다 비활성이다(휴대폰은 고르기 전에 아래 막대를 숨긴다).
  if (!narrow) {
    await expect(bar.getByRole('button', { name: /으로 표시$/ })).toHaveCount(2);
    await expect(bar.getByRole('button', { name: /으로 표시$/ }).first()).toBeDisabled();
    await expect(bar.getByRole('button', { name: /으로 표시$/ }).last()).toBeDisabled();
  }
  if (narrow) await expect(tabbar).toBeHidden();                       // 휴대폰은 선택 중 아래 탭 바 대신 단추 막대

  // 3. 두 줄을 고르면 개수와 일부 선택 표시가 바뀐다. 하나를 풀면 1개.
  await rowBoxes.nth(0).check();
  await rowBoxes.nth(2).check();
  await expect(bar.getByText('2개')).toBeVisible();
  await expect(bar.getByText('선택됨')).toBeVisible();
  expect(await bar.locator('.select-all input').evaluate((el: HTMLInputElement) => el.indeterminate)).toBe(true);
  await rowBoxes.nth(2).uncheck();
  await expect(bar.getByText('1개')).toBeVisible();

  // 4. 전체 선택은 보이는 줄을 모두 고르고, 한 번 더 누르면 모두 푼다.
  const total = await rowBoxes.count();
  await bar.locator('.select-all input').check();
  await expect(bar.getByText(`${total}개`)).toBeVisible();
  await bar.locator('.select-all input').uncheck();

  // 5. 선택 끝내기: 막대가 사라지고 포커스가 선택 단추로 돌아온다. 휴대폰은 탭 바도 돌아온다.
  await bar.getByRole('button', { name: '선택 끝내기' }).click();
  await expect(bar).toHaveCount(0);
  await expect(trigger).toBeFocused();
  if (narrow) await expect(tabbar).toBeVisible();

  // 6. 키보드: 선택 단추에서 Enter, 체크 칸에서 Space, 단추에서 Enter. 적용되면 토스트가 뜨고 모드가 끝난다.
  await trigger.focus();
  await page.keyboard.press('Enter');
  await expect(bar).toBeVisible();
  await rowBoxes.nth(0).focus();
  await page.keyboard.press('Space');
  await expect(bar.getByText('1개')).toBeVisible();
  const action = bar.locator('button:enabled', { hasText: '으로 표시' }).first();
  await expect(action).toBeEnabled();
  await action.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByText(/1개를 (읽음|읽지 않음)으로 표시했어요/)).toBeVisible();
  await expect(bar).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

test('board order: edit mode shows drag handles only, the keyboard can lift, move and drop a board, and the new order is kept', async ({ page }) => {
  await page.goto('/?api=sample/api/v1');
  await page.locator('notice-rows-screen a.row').first().waitFor();
  await page.evaluate(() => {
    const app = document.querySelector('notice-app') as unknown as Record<string, any>;
    app.authUserId = 'account-a'; app.profileStatus = 'ready'; app.profile = { ...app.profile, onboardedAt: 'x' };
    app.subscriptions = app.sources.filter((s: { external?: boolean }) => !s.external).slice(0, 3).map((s: { id: string }) => s.id);
    app.openSettings('notifications');
  });
  const screen = page.locator('platform-settings-screen');
  const names = () => screen.locator('.order-list li .order-name').allInnerTexts();
  await expect(screen.locator('.order-handle')).toHaveCount(0);                   // 평소에는 손잡이가 없고 스위치만 있다
  const before = await names();
  expect(before.length).toBeGreaterThanOrEqual(2);
  await screen.getByRole('button', { name: '순서 바꾸기' }).click();
  await expect(screen.locator('.order-handle')).toHaveCount(before.length);
  await expect(screen.getByRole('switch').filter({ hasNotText: '아이캠퍼스' })).toHaveCount(0);   // 순서를 바꾸는 중에는 받기 스위치를 숨긴다
  const first = screen.locator('.order-handle').first();
  await first.focus();
  await page.keyboard.press('Space');
  await page.waitForTimeout(200);                                                 // 집는 동작이 자리를 계산할 시간
  await page.keyboard.press('ArrowDown');
  await page.waitForTimeout(250);
  await page.keyboard.press('Space');
  await expect.poll(async () => (await names())[1]).toBe(before[0]);              // 첫 줄이 둘째 줄로 내려갔다
  await screen.getByRole('button', { name: '완료' }).click();
  expect((await names())[1]).toBe(before[0]);                                     // 끝낸 뒤에도 순서가 남는다
});

test('first-run setup keeps answers when going back and forward, and a stored "no double major" shows as chosen', async ({ page }) => {
  await page.goto('/?api=sample/api/v1');
  await page.locator('notice-rows-screen a.row').first().waitFor();
  await page.evaluate(() => {
    const app = document.querySelector('notice-app') as unknown as Record<string, unknown>;
    app.profile = { programs: [], year: null, semester: null, enrollmentStatus: null, militaryService: null, onboardedAt: null, admissionYear: null, university3pInternshipSelected: null, deptInternshipDone: null, university3pInternshipDone: null };
    app.profileStatus = 'ready'; app.authUserId = 'account-a';
  });
  const dialog = page.getByRole('dialog');
  const next = () => dialog.getByRole('button', { name: '다음' }).click();
  const back = () => dialog.getByRole('button', { name: '이전 단계' }).click();
  await dialog.getByRole('button', { name: '소프트웨어융합대학', exact: true }).click();
  await dialog.getByRole('radio', { name: '소프트웨어학과', exact: true }).click();
  await next();
  await dialog.getByRole('radio', { name: '없어요', exact: true }).click();                         // 없어요를 누르면 바로 학교 정보로 간다
  await dialog.getByRole('button', { name: '3학년' }).click();
  await next();
  await expect(dialog.getByRole('heading', { name: '입학 연도가 언제예요?' })).toBeVisible();   // 질문이 곧 제목이다
  await dialog.getByRole('button', { name: '2022', exact: true }).click();
  await back();                                                                                  // 학교 정보: 고른 학년이 남아 있다
  await expect(dialog.getByRole('button', { name: '3학년' })).toHaveAttribute('aria-pressed', 'true');
  await back();                                                                                  // 복수전공 단계: 없어요가 남아 있다
  await expect(dialog.getByRole('radio', { name: '없어요', exact: true })).toHaveAttribute('aria-checked', 'true');
  await next();
  await next();                                                                                  // 인턴십: 입학 연도가 남아 있다
  await expect(dialog.getByRole('button', { name: '2022', exact: true })).toHaveAttribute('aria-pressed', 'true');
});

test('switching the tab shows only the list (detail pane closed, no notice opened or marked read); a row click opens the detail again', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 800 });
  await page.goto('/?api=sample/api/v1');
  const rows = page.locator('notice-rows-screen a.row');
  await rows.first().waitFor();
  const pane = page.locator('.app');
  await page.getByRole('button', { name: /인턴 공고/ }).first().click();
  await expect(pane).toHaveClass(/no-detail/);                                   // 인턴 공고: 목록만
  await page.getByRole('button', { name: /성대 공지/ }).first().click();
  await expect(pane).toHaveClass(/no-detail/);                                   // 성대 공지: 목록만
  await expect(page.locator('notice-rows-screen a.row[aria-current="true"]')).toHaveCount(0);
  await rows.first().click();
  await expect(pane).not.toHaveClass(/no-detail/);                               // 행을 누르면 상세가 열린다
});

test('the unread filter checkbox starts at the same left edge as the date headings', async ({ page }) => {
  await page.goto('/?api=sample/api/v1');
  await expect(page.locator('notice-rows-screen a.row').first()).toBeVisible();
  const left = async (selector: string) => (await page.locator(selector).first().boundingBox())!.x;
  const title = await left('main h2');
  const check = await left('.view-toggle .filter-check');
  expect(Math.abs(check - title)).toBeLessThanOrEqual(1);
});

test('selection mode keeps the select-all and row checkboxes on the date headings left edge', async ({ page }) => {
  await page.goto('/?api=sample/api/v1');
  await expect(page.locator('notice-rows-screen a.row').first()).toBeVisible();
  const heading = (await page.locator('main h2').first().boundingBox())!.x;
  await page.locator('button.select-trigger').click();
  const all = (await page.locator('.select-all input').boundingBox())!.x;
  const row = (await page.locator('.selection-check input').first().boundingBox())!.x;
  expect(Math.abs(all - heading)).toBeLessThanOrEqual(1);
  expect(Math.abs(row - heading)).toBeLessThanOrEqual(1);
});

test('changing a list condition (filter check, sort) closes the open detail pane', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'mobile', '상세 칸은 넓은 화면에서만 옆에 열려 있다');
  await page.goto('/?api=sample/api/v1');
  const rows = page.locator('notice-rows-screen a.row');
  const title = page.locator('.detail-pane notice-detail-screen .detail-title');
  const open = async () => { await rows.nth(1).click(); await expect(title).toBeVisible(); };
  await open();
  await page.getByRole('button', { name: /정렬:/ }).click();
  await page.locator('.sort-option').nth(1).click();
  await expect(title).toBeHidden();
  await open();
  const unread = page.getByRole('button', { name: /^읽지 않은 공지만$/ });
  await unread.click();
  await expect(title).toBeHidden();
  await unread.click();   // 끄기
  await expect(title).toBeHidden();
  await open();
  await rows.nth(1).click();   // 같은 행을 다시 누르면 닫히는 기존 동작은 그대로
  await expect(title).toBeHidden();
});

test('reloading after the pane was closed by a list change does not open the first notice by itself', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'mobile', '상세 칸은 넓은 화면에서만 옆에 열려 있다');
  await page.goto('/?api=sample/api/v1');
  const rows = page.locator('notice-rows-screen a.row');
  const title = page.locator('.detail-pane notice-detail-screen .detail-title');
  await rows.nth(1).click();
  await expect(title).toBeVisible();
  await page.getByRole('button', { name: /정렬:/ }).click();
  await page.locator('.sort-option').nth(1).click();
  await expect(title).toBeHidden();
  await page.reload();
  await expect(rows.first()).toBeVisible();
  await expect(title).toBeHidden();
  await rows.nth(1).click();   // 직접 누르면 열린다
  await expect(title).toBeVisible();
  await page.reload();   // 보던 공지가 있으면 새로고침해도 그대로 열려 있다
  await expect(title).toBeVisible();
});

test('selection mode survives a reload with the same ticks, and the detail pane stays closed', async ({ page }) => {
  await page.goto('/?api=sample/api/v1');
  await expect(page.locator('notice-rows-screen a.row').first()).toBeVisible();
  await page.locator('button.select-trigger').click();
  await page.locator('.selection-check input').first().check();
  await page.reload();
  await expect(page.locator('.select-all')).toBeVisible();
  await expect(page.locator('.select-all')).toContainText('1개 선택됨');
  await expect(page.locator('.selection-check input').first()).toBeChecked();
  await expect(page.locator('.detail-pane notice-detail-screen .detail-title')).toBeHidden();
  await page.getByRole('button', { name: '선택 끝내기' }).click();
  await page.reload();
  await expect(page.locator('.select-all')).toHaveCount(0);
});

test('contact page: in-app form sends kind, body and optional reply mail, explains limits and failures; the open-source row leaves the app', async ({ page }) => {
  await page.goto('/?api=sample/api/v1');
  await page.locator('notice-rows-screen a.row').first().waitFor();
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => {
    const app = document.querySelector('notice-app') as unknown as Record<string, unknown>;
    const w = window as unknown as { sent: unknown[][]; next: string };
    w.sent = []; w.next = 'ok';
    app.authUserId = 'account-a'; app.profileStatus = 'ready'; app.onboardingDismissed = true;
    app.sendFeedback = (kind: string, body: string, email: string) => { w.sent.push([kind, body, email]); return Promise.resolve(w.next); };
  });
  await page.goto('/?view=settings&api=sample/api/v1');
  const screen = page.locator('platform-settings-screen');
  await screen.waitFor();
  await page.evaluate(() => {
    const app = document.querySelector('notice-app') as unknown as Record<string, unknown>;
    const w = window as unknown as { sent: unknown[][]; next: string };
    w.sent = []; w.next = 'ok';
    app.authUserId = 'account-a'; app.profileStatus = 'ready'; app.onboardingDismissed = true;
    app.sendFeedback = (kind: string, body: string, email: string) => { w.sent.push([kind, body, email]); return Promise.resolve(w.next); };
  });
  // 설정 홈: 문의하기는 앱 안 이동, 오픈소스는 새 창으로 나가는 줄이다.
  const open = screen.getByRole('link', { name: /오픈소스/ });
  await expect(open).toHaveAttribute('target', '_blank');
  await expect(open).toContainText('새 창으로 열려요');
  await expect(screen.getByRole('link', { name: /문의하기/ })).not.toHaveAttribute('target', '_blank');
  await screen.getByRole('link', { name: /문의하기/ }).click();
  await expect(screen.getByRole('button', { name: '보내기' })).toBeDisabled();            // 내용이 없으면 막혀 있고, 이유를 적는다
  await expect(screen.getByText('내용을 적으면 보낼 수 있어요')).toBeVisible();
  await screen.getByRole('textbox', { name: '내용' }).fill('로그인이 안 돼요');
  await expect(screen.getByRole('button', { name: '보내기' })).toBeEnabled();
  await screen.getByRole('radio', { name: '버그' }).click();
  await screen.getByRole('textbox', { name: '답장받을 메일' }).fill('not-an-email');
  await screen.getByRole('textbox', { name: '답장받을 메일' }).blur();                 // 입력 중에는 오류를 띄우지 않고 칸을 벗어난 뒤에 보여 준다
  await expect(screen.getByText('메일 주소 형식이 맞는지 확인해 주세요')).toBeVisible();
  await expect(screen.getByText('메일 주소를 고치면 보낼 수 있어요')).toBeVisible();
  await expect(screen.getByRole('button', { name: '보내기' })).toBeDisabled();
  await screen.getByRole('textbox', { name: '답장받을 메일' }).fill('me@example.com');
  await screen.getByRole('button', { name: '보내기' }).click();
  await expect(screen.getByText('보냈어요. 남겨 주셔서 고마워요')).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { sent: unknown[][] }).sent)).toEqual([['bug', '로그인이 안 돼요', 'me@example.com']]);
  await expect(screen.getByRole('textbox', { name: '내용' })).toHaveValue('');           // 보낸 뒤에는 비운다
  await page.evaluate(() => { (window as unknown as { next: string }).next = 'error'; });
  await screen.getByRole('textbox', { name: '내용' }).fill('또 보내요');
  await screen.getByRole('button', { name: '보내기' }).click();
  await expect(screen.getByText('보내지 못했어요. 잠시 뒤 다시 시도해 주세요')).toBeVisible();
  await expect(screen.getByRole('textbox', { name: '내용' })).toHaveValue('또 보내요');   // 실패하면 쓴 글을 지우지 않는다
  await page.evaluate(() => { (window as unknown as { next: string }).next = 'limit'; });
  await screen.getByRole('button', { name: '보내기' }).click();
  await expect(screen.getByText('오늘은 5번까지 보낼 수 있어요. 내일 다시 보내 주세요')).toBeVisible();
  await expect(screen.getByRole('button', { name: '보내기' })).toBeDisabled();            // 한도에 걸리면 단추를 막고 이유를 적는다
});

test('share button in the open detail: opens the device share sheet, stays quiet when closed, and copies the link when there is no sheet', async ({ page }, testInfo) => {
  await page.addInitScript(() => {
    (window as unknown as { shared: unknown[] }).shared = [];
    const mode = new URLSearchParams(location.search).get('share');
    if (mode === 'none') Object.defineProperty(navigator, 'share', { value: undefined, configurable: true });
    else Object.defineProperty(navigator, 'share', { configurable: true, value: async (data: unknown) => {
      (window as unknown as { shared: unknown[] }).shared.push(data);
      if (mode === 'abort') throw new DOMException('closed', 'AbortError');
    } });
    Object.defineProperty(navigator, 'canShare', { value: undefined, configurable: true });
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: async (text: string) => { (window as unknown as { copied: string }).copied = text; } }, configurable: true });
  });
  const open = async (share: string) => {
    await page.goto(`/?api=sample/api/v1&share=${share}`);
    const button = page.locator(testInfo.project.name === 'mobile' ? '.read-actions' : '.detail-head').getByRole('button', { name: '공유하기' });
    await expect(page.locator('notice-rows-screen a.row').nth(1)).toBeVisible();
    if (!(await button.isVisible())) await page.locator('notice-rows-screen a.row').nth(1).click();
    return button;
  };
  await (await open('ok')).click();
  const shared = await page.evaluate(() => (window as unknown as { shared: { title: string; url: string }[] }).shared);
  expect(shared).toHaveLength(1);
  expect(shared[0].url).toMatch(/^https?:\/\//);
  await expect(page.locator('.toast')).not.toContainText('복사');
  await (await open('abort')).click();
  await expect(page.locator('.toast')).not.toContainText('복사');
  await (await open('none')).click();
  await expect(page.locator('.toast')).toContainText('링크를 복사했어요');
  await expect(page.getByRole('button', { name: '공유하기' }).locator('use')).toHaveAttribute('href', /#check$/);   // 누른 자리에서도 결과가 보인다
  expect(await page.evaluate(() => (window as unknown as { copied: string }).copied)).toMatch(/^https?:\/\//);
});

test('opening settings keeps the left menu as it was (tab, pressed keyword, board list), with settings highlighted too', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 800 });
  await page.goto('/?api=sample/api/v1');
  await page.locator('notice-rows-screen a.row').first().waitFor();
  await page.evaluate(() => { (document.querySelector('notice-app') as unknown as { keywords: string[] }).keywords = ['장학', '인턴']; });
  const side = page.locator('.sidebar');
  await side.getByRole('button', { name: /^인턴 공고\s*\d*$/ }).click();
  await side.getByRole('button', { name: /^장학, 공지/ }).click();
  await expect(side.getByText('인턴 공고 사이트')).toBeVisible();
  await side.getByRole('button', { name: '설정' }).click();
  await expect(page.locator('platform-settings-screen')).toBeVisible();
  // 설정 안에서도 쓰던 상태가 그대로 보인다: 인턴 공고 탭, 눌러 둔 키워드, 인턴용 사이트 목록.
  await expect(side.getByText('인턴 공고 사이트')).toBeVisible();
  await expect(side.getByRole('button', { name: /^인턴 공고\s*\d*$/ })).toHaveClass(/bg-sunken/);
  await expect(side.getByRole('button', { name: /^장학, 공지/ })).toHaveClass(/bg-sunken/);
  await expect(side.getByRole('button', { name: '설정' })).toHaveClass(/bg-sunken/);
  await expect(side.getByRole('button', { name: /^성대 공지\s*\d*$/ })).not.toHaveClass(/bg-sunken/);
});

test('typing in search closes the open detail pane instead of opening another notice', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 800 });
  await page.goto('/?api=sample/api/v1');
  await page.locator('notice-rows-screen a.row').first().waitFor();
  await page.waitForLoadState('networkidle');
  const state = () => page.evaluate(() => { const a = document.querySelector('notice-app') as unknown as Record<string, unknown>; return { detailOpen: a.detailOpen, selectedId: a.selectedId }; });
  await page.locator('notice-rows-screen a.row').nth(1).click();
  expect(await state()).toMatchObject({ detailOpen: true });
  const search = page.getByRole('searchbox', { name: '공지 검색' }).first();
  await search.fill('인턴');
  expect(await state()).toMatchObject({ detailOpen: false, selectedId: null });
  await search.fill('인턴십');
  expect(await state()).toMatchObject({ detailOpen: false, selectedId: null });
});

test('a new version while in use only shows a bar; nothing changes until the user presses it', async ({ page }) => {
  await page.goto('/?api=sample/api/v1');
  await expect(page.locator('notice-rows-screen a.row').first()).toBeVisible();
  await page.evaluate(() => { (window as unknown as { __kept: number }).__kept = 1; });
  // 새 배포로 예전 조각 파일을 못 받으면 앱이 이 이벤트를 받는다. 화면은 그대로이고 알림 줄만 나온다.
  await page.evaluate(() => window.dispatchEvent(new Event('vite:preloadError', { cancelable: true })));
  const bar = page.locator('.update-bar');
  await expect(bar).toBeVisible();
  await expect(bar.getByRole('button', { name: '업데이트' })).toBeVisible();
  expect((await bar.getByRole('button', { name: '나중에' }).boundingBox())!.height).toBeGreaterThanOrEqual(44);
  expect(await page.evaluate(() => (window as unknown as { __kept?: number }).__kept)).toBe(1);   // 다시 열리지 않았다
  await bar.getByRole('button', { name: '나중에' }).click();
  await expect(bar).toBeHidden();
  expect(await page.evaluate(() => (window as unknown as { __kept?: number }).__kept)).toBe(1);
});

test('an account that has not finished first-run setup goes straight to setup without showing the list', async ({ page }) => {
  await page.goto('/?api=sample/api/v1');
  await page.locator('notice-rows-screen a.row').first().waitFor();
  await page.evaluate(() => {
    const app = document.querySelector('notice-app') as unknown as Record<string, unknown>;
    app.authUserId = 'account-a'; app.profileStatus = 'loading';
  });
  await expect(page.getByText('불러오고 있어요', { exact: true })).toBeVisible();
  await expect(page.locator('notice-rows-screen a.row')).toHaveCount(0);
  await page.evaluate(() => {
    const app = document.querySelector('notice-app') as unknown as Record<string, unknown>;
    app.profile = { programs: [], year: null, semester: null, enrollmentStatus: null, militaryService: null, onboardedAt: null, admissionYear: null, university3pInternshipSelected: null, deptInternshipDone: null, university3pInternshipDone: null };
    app.profileStatus = 'ready';
  });
  await expect(page.getByRole('heading', { name: '주전공이 어디예요?' })).toBeVisible();
});

test('an account remembered as finished keeps the list visible while the profile loads', async ({ page }) => {
  await page.goto('/?api=sample/api/v1');
  await page.locator('notice-rows-screen a.row').first().waitFor();
  await page.evaluate(() => {
    localStorage.setItem('platform:onboarded:account-a', '1');
    const app = document.querySelector('notice-app') as unknown as Record<string, unknown>;
    app.authUserId = 'account-a'; app.profileStatus = 'loading';
  });
  await expect(page.getByText('성대 공지').first()).toBeAttached();   // 구독이 없는 계정은 행이 없으므로 목록 화면의 탭이 남는지 본다
  await expect(page.getByText('불러오고 있어요', { exact: true })).toHaveCount(0);
  // 다른 계정의 표시는 이 계정의 것이 아니다.
  await page.evaluate(() => { (document.querySelector('notice-app') as unknown as Record<string, unknown>).authUserId = 'account-b'; });
  await expect(page.getByText('불러오고 있어요', { exact: true })).toBeVisible();
});

test('현장실습 tab shows only field-practice notices, hides expired ones, and opens a sectioned detail', async ({ page }, testInfo) => {
  await page.goto('/?api=sample/api/v1');
  const rows = page.locator('notice-rows-screen a.row');
  await rows.first().waitFor();
  const mobile = testInfo.project.name === 'mobile';
  // 성대 공지 탭에는 현장실습이 섞이지 않는다.
  await expect(page.locator('notice-rows-screen a.row', { hasText: '가상기업' })).toHaveCount(0);
  await page.getByRole('button', { name: /^현장실습/ }).first().click();
  await expect(page).toHaveURL(/tab=coop/);
  // 마감이 지난 것과 expires_at이 지난 것은 보이지 않는다.
  await expect(rows).toHaveCount(2);
  await expect(rows.filter({ hasText: '지난기업' })).toHaveCount(0);
  await expect(rows.filter({ hasText: '만료기업' })).toHaveCount(0);
  await expect(rows.filter({ hasText: '가상기업' })).toContainText('대기업');
  await expect(rows.first()).toContainText('예시재단');   // 접수마감이 빠른 순이 기본
  await expect(page.locator('notice-rows-screen a.row', { hasText: '소프트웨어 공지' })).toHaveCount(0);
  // 출처가 하나뿐이라 게시판 목록을 두지 않는다.
  if (!mobile) await expect(page.locator('.sidebar').getByText('게시판', { exact: true })).toHaveCount(0);
  await rows.filter({ hasText: '가상기업' }).click();
  const detail = mobile ? '.reading notice-detail-screen' : '.detail-pane notice-detail-screen';
  await expect(page.locator(`${detail} .detail-title`)).toContainText('가상기업');
  await expect(page.locator(`${detail} h3`, { hasText: '하는 일' })).toBeVisible();
  await expect(page.locator(`${detail} h3`, { hasText: '지원 자격' })).toBeVisible();
  await expect(page.getByRole('link', { name: '톨게이트에서 신청하기' }).first()).toBeVisible();
  await expect(page.getByText('학교 계정으로 로그인한 뒤').first()).toBeVisible();
  // 같은 공지 탭의 다른 공지를 학교 공지와 섞지 않는다: 성대 공지로 돌아가면 현장실습은 없다.
  if (mobile) await page.getByRole('button', { name: '목록으로' }).first().click().catch(() => page.goBack());
});

test('현장실습 tab filters by 기관 구분 like a board picker and keeps the choice', async ({ page }, testInfo) => {
  await page.goto('/?api=sample/api/v1&tab=coop');
  const rows = page.locator('notice-rows-screen a.row');
  await expect(rows).toHaveCount(2);
  const mobile = testInfo.project.name === 'mobile';
  if (mobile) {
    await page.getByRole('button', { name: /^기관 구분: / }).click();
    await page.getByRole('button', { name: '대기업', exact: true }).click();
  } else {
    await page.locator('.sidebar').getByRole('button', { name: '대기업', exact: true }).click();
  }
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('가상기업');
  // 왼쪽 메뉴: 보고 있는 현장실습은 지금 목록 개수(1), 보고 있지 않은 성대 공지는 전체 개수라서 기관 구분을 눌러도 그대로다.
  if (!mobile) {
    const menu = page.locator('.sidebar nav[aria-label="보기"]');
    await expect(menu.locator('button', { hasText: '현장실습' })).toContainText('1');
    const other = (await menu.locator('button', { hasText: '성대 공지' }).innerText()).replace(/\D/g, '');
    await page.locator('.sidebar').getByRole('button', { name: '모든 기관', exact: true }).click();
    await expect(menu.locator('button', { hasText: '현장실습' })).toContainText('2');
    await expect(menu.locator('button', { hasText: '성대 공지' })).toContainText(other);
    await page.locator('.sidebar').getByRole('button', { name: '대기업', exact: true }).click();
  }
  await page.reload();
  await expect(rows).toHaveCount(1);
  if (mobile) await page.getByRole('button', { name: /^기관 구분: / }).click();
  await page.getByRole('button', { name: '모든 기관', exact: true }).first().click();
  await expect(rows).toHaveCount(2);
});

test('choosing a tab clears list filters, including when choosing the current tab again', async ({ page }, testInfo) => {
  await page.goto('/?api=sample/api/v1');
  await page.locator('notice-rows-screen a.row').first().waitFor();
  const nav = page.locator(testInfo.project.name === 'mobile' ? '.tabbar' : '.sidebar nav[aria-label="보기"]');
  for (const [label, tab] of [['인턴 공고', 'intern'], ['현장실습', 'coop'], ['성대 공지', 'all'], ['성대 공지', 'all'], ['저장', 'saved']] as const) {
    await page.evaluate(() => {
      const app = document.querySelector('notice-app') as unknown as Record<string, unknown>;
      Object.assign(app, { query: '없는 검색어', keyword: '장학', board: 'selected-board', coopKind: '대기업', unreadOnly: true, graduationOnly: true });
    });
    await nav.getByRole('button', { name: new RegExp(`^${label}`) }).click();
    await expect.poll(() => page.evaluate(() => {
      const app = document.querySelector('notice-app') as unknown as Record<string, unknown>;
      return [app.view, app.query, app.keyword, app.board, app.coopKind, app.unreadOnly, app.graduationOnly];
    })).toEqual([tab, '', null, 'all', 'all', false, false]);
    if (tab === 'coop') await expect(page.locator('notice-rows-screen a.row')).toHaveCount(2);
  }
  await page.reload();
  await expect.poll(() => page.evaluate(() => {
    const app = document.querySelector('notice-app') as unknown as Record<string, unknown>;
    return [app.board, app.coopKind, app.unreadOnly, app.graduationOnly];
  })).toEqual(['all', 'all', false, false]);
});

test('switching to or from the 현장실습 tab closes an open detail, and key 3 opens the tab', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'mobile', '상세 칸 열림은 넓은 화면의 동작이다');
  await page.goto('/?api=sample/api/v1');
  const rows = page.locator('notice-rows-screen a.row');
  await rows.first().waitFor();
  const pane = page.locator('.app');
  await rows.first().click();
  await expect(pane).not.toHaveClass(/no-detail/);
  await page.keyboard.press('3');
  await expect(page).toHaveURL(/tab=coop/);
  await expect(pane).toHaveClass(/no-detail/);
  await expect(rows.first()).toContainText('예시재단');
  await rows.first().click();
  await expect(pane).not.toHaveClass(/no-detail/);
  await page.keyboard.press('4');
  await expect(pane).toHaveClass(/no-detail/);
  await page.keyboard.press('1');
  await expect(page.locator('notice-rows-screen a.row', { hasText: '가상기업' })).toHaveCount(0);
  // 새로고침해도 마지막 보기(현장실습)를 기억한다.
  await page.keyboard.press('3');
  await page.goto('/?api=sample/api/v1');
  await expect(page.locator('notice-rows-screen a.row').first()).toContainText('예시재단');
});

test('when every 현장실습 posting has closed, the menu hides it and a remembered coop view falls back to 성대 공지', async ({ page }) => {
  await page.route('**/notices.json', async (route) => {
    const res = await route.fetch();
    const data = await res.json();
    data.notices = data.notices.filter((n: { source_id: string }) => n.source_id !== 'skku-coop');
    await route.fulfill({ response: res, json: data });
  });
  await page.goto('/?api=sample/api/v1&tab=coop');
  await page.locator('notice-rows-screen a.row').first().waitFor();
  await expect(page).toHaveURL(/tab=all/);
  await expect(page.getByRole('button', { name: /^현장실습/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^인턴 공고/ }).first()).toBeVisible();
  // 단축키 3은 숨은 메뉴로 가지 않는다.
  await page.keyboard.press('3');
  await expect(page).toHaveURL(/tab=all/);
});

test('install banner: one tap installs on phones, closing keeps it away, PC never shows it', async ({ page }) => {
  const inject = async () => {
    await withApp(page, { authUserId: 'account-a', profileStatus: 'ready', onboardingDismissed: true });
    await page.evaluate(() => { ((document.querySelector('notice-app') as unknown) as AppHandle).install = { prompt: () => Promise.resolve() }; });
  };
  await page.setViewportSize({ width: 412, height: 891 });
  await page.goto('/?api=sample/api/v1');
  await expect(page.getByRole('button', { name: /^인턴 공고/ }).first()).toBeVisible();
  await inject();
  const banner = page.getByRole('region', { name: '앱 설치' });
  await expect(banner).toBeVisible();
  expect(await banner.evaluate((el) => getComputedStyle(el).animationName)).toBe('install-rise');
  const movement = await banner.evaluate((el) => {
    const animation = el.getAnimations()[0];
    animation.pause();
    animation.currentTime = 0;
    const start = el.getBoundingClientRect().top;
    animation.finish();
    return start - el.getBoundingClientRect().top;
  });
  expect(movement).toBeGreaterThan(50);
  // 설치 단추와 닫기 단추는 모두 44px 이상이다.
  for (const name of ['홈 화면에 추가', '닫기']) {
    const box = await banner.getByRole('button', { name }).boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(44);
    expect(box!.width).toBeGreaterThanOrEqual(44);
  }
  // 닫으면 사라지고 새로 열어도 다시 뜨지 않는다.
  await banner.getByRole('button', { name: '닫기' }).click();
  await expect(banner).toHaveCount(0);
  await page.getByRole('button', { name: /^인턴 공고/ }).first().click();
  await expect(page.getByRole('heading', { name: '인턴 공고' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: /^인턴 공고/ }).first()).toBeVisible();
  await inject();
  await expect(banner).toHaveCount(0);
  // PC 폭에서는 기록과 상관없이 보이지 않는다.
  await page.evaluate(() => localStorage.removeItem('install-banner'));
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.reload();
  await expect(page.getByRole('button', { name: /^인턴 공고/ }).first()).toBeVisible();
  await inject();
  await expect(banner).toBeHidden();
});

test('install banner keeps the last notice and temporary messages accessible', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile', 'install banner only appears on phones');
  await page.setViewportSize({ width: 360, height: 780 });
  await page.goto('/?api=sample/api/v1');
  await page.locator('notice-rows-screen a.row').first().waitFor();
  await withApp(page, { authUserId: 'account-a', profileStatus: 'ready', onboardingDismissed: true, subscriptions: ['skku-notice01'], subscriptionsLoading: false });
  await page.evaluate(() => { (document.querySelector('notice-app') as unknown as AppHandle).install = { prompt: () => Promise.resolve() }; });
  const banner = page.getByRole('region', { name: '앱 설치' });
  await expect(banner).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  const last = await page.locator('notice-rows-screen a.row').last().boundingBox();
  const box = await banner.boundingBox();
  expect(last!.y + last!.height).toBeLessThanOrEqual(box!.y);
  // 고정 배너 아래를 지나가는 공지도 스크롤하면 읽고 누를 수 있다.
  const rows = page.locator('notice-rows-screen a.row');
  for (let i = 0; i < await rows.count(); i++) {
    const row = rows.nth(i);
    await row.evaluate((el) => el.scrollIntoView({ block: 'center' }));
    expect(await row.evaluate((el) => { const r = el.getBoundingClientRect(); const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return !!hit && el.contains(hit); })).toBe(true);
  }
  await withApp(page, { toast: '알림을 저장했어요' });
  await expect(page.getByRole('status').filter({ hasText: '알림을 저장했어요' })).toBeVisible();
  await expect(banner).toHaveCount(0);
  await withApp(page, { toast: '' });
  await expect(banner).toBeVisible();
  await banner.getByRole('button', { name: '닫기' }).focus();
  await expect(banner.getByRole('button', { name: '닫기' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(banner).toHaveCount(0);
});

test('install panel is available before login and can be dismissed to sign in', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile', 'install banner only appears on phones');
  await page.setViewportSize({ width: 360, height: 780 });
  await page.goto('/?api=sample/api/v1');
  await page.locator('notice-rows-screen a.row').first().waitFor();
  await page.evaluate(() => {
    const app = document.querySelector('notice-app') as unknown as AppHandle;
    Object.defineProperty(app.controller as object, 'gated', { configurable: true, value: true });
    app.install = { prompt: () => Promise.resolve() };
    app.authReady = true;
  });
  const banner = page.getByRole('region', { name: '앱 설치' });
  const login = page.getByRole('button', { name: 'Google로 계속하기' });
  await expect(banner).toBeVisible();
  await expect(login).toBeVisible();
  await banner.getByRole('button', { name: '다음에 할게요' }).click();
  await expect(banner).toHaveCount(0);
  await expect(login).toBeVisible();
});

test('install signal received before the app loads is retained and used once', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile', 'install panel only appears on phones');
  let resume: () => void = () => {};
  const blocked = new Promise<void>((resolve) => { resume = resolve; });
  await page.route('**/src/main.ts', async (route) => { await blocked; await route.continue(); });
  await page.goto('/?api=sample/api/v1', { waitUntil: 'commit' });
  await page.waitForFunction(() => '__skkuInstallPrompt' in window);
  await page.evaluate(() => {
    const event = new Event('beforeinstallprompt', { cancelable: true });
    Object.assign(event, { prompt: async () => { (window as unknown as { installCalls: number }).installCalls++; } });
    (window as unknown as { installCalls: number }).installCalls = 0;
    window.dispatchEvent(event);
  });
  resume();
  await page.locator('notice-rows-screen a.row').first().waitFor();
  await withApp(page, { authUserId: 'account-a', profileStatus: 'ready', onboardingDismissed: true });
  const banner = page.getByRole('region', { name: '앱 설치' });
  await banner.getByRole('button', { name: '홈 화면에 추가' }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { installCalls: number }).installCalls)).toBe(1);
  await expect(banner).toHaveCount(0);
  expect(await page.evaluate(() => window.__skkuInstallPrompt)).toBeNull();
});

test('iOS Safari shows manual installation in the panel and honors reduced motion', async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile', 'install panel only appears on phones');
  const context = await browser.newContext({
    baseURL: 'http://127.0.0.1:5173', viewport: { width: 375, height: 812 }, reducedMotion: 'reduce',
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  });
  const page = await context.newPage();
  await page.goto('/?api=sample/api/v1');
  await page.locator('notice-rows-screen a.row').first().waitFor();
  await page.evaluate(() => {
    const app = document.querySelector('notice-app') as unknown as AppHandle;
    Object.defineProperty(app.controller as object, 'gated', { configurable: true, value: true });
    (app.requestUpdate as () => void)();
  });
  const banner = page.getByRole('region', { name: '앱 설치' });
  await expect(banner).toContainText('공유 버튼');
  await expect(banner).toContainText('홈 화면에 추가');
  expect(await banner.evaluate((el) => getComputedStyle(el).animationName)).toBe('none');
  await banner.getByRole('button', { name: '확인했어요' }).click();
  await expect(banner).toHaveCount(0);
  await context.close();
});
