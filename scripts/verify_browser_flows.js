// Playwright browser_run_code_unsafe의 filename으로 실행하는 정식 사이트 회귀 확인.
// 계정 연결과 발송 없이 격리된 브라우저 저장소에서 확인한다.
async (page) => {
  const origin = 'https://aniseongu.github.io/skku-notice-alert/';
  const results = [];
  const contexts = [];
  const assert = (condition, message) => { if (!condition) throw new Error(message); };
  async function check(name, fn) {
    try { await fn(); results.push({ name, pass: true }); }
    catch (error) { results.push({ name, pass: false, error: error.message.split('\n').slice(0, 12).join('\n') }); }
  }
  async function open(width, tab = 'all') {
    const context = await page.context().browser().newContext({
      serviceWorkers: 'block', viewport: { width, height: 900 },
    });
    contexts.push(context);
    const p = await context.newPage();
    p.on('pageerror', error => results.push({ name: '페이지 예외', pass: false, error: error.message }));
    p.setDefaultTimeout(6000);
    await p.goto(`${origin}?tab=${tab}`);
    await p.locator('.row').first().waitFor();
    return p;
  }
  try {
    const d = await open(1280);
    const sideTab = label => d.locator('.sidebar nav').getByRole('button', { name: new RegExp(`^${label}`) });
    await check('PC 탭 세 개 연속 이동', async () => {
      for (const [label, id] of [['인턴 공고', 'intern'], ['저장', 'saved'], ['성대 공지', 'all']]) {
        await sideTab(label).click();
        assert(await d.locator('notice-app').evaluate(e => e.view) === id, id);
      }
    });
    await sideTab('성대 공지').click();
    await check('PC 선택한 글을 검색에서 제외', async () => {
      await d.locator('.row').nth(1).click();
      await d.locator('.search input').filter({ visible: true }).fill('일치하지않는검색어xyz');
      await d.getByText('다른 단어로 찾아보세요', { exact: true }).waitFor();
      assert(await d.locator('.detail-pane .detail-title').count() === 0, '이전 상세가 남음');
    });
    await check('검색어 지우고 목록 복구', async () => {
      await d.getByRole('button', { name: '검색어 지우기', exact: true }).click();
      await d.locator('.row').first().waitFor();
    });
    await check('제목 검색으로 실제 공지 찾기', async () => {
      const row = d.locator('.row').first();
      const id = await row.getAttribute('data-id');
      const title = await row.locator('.title').innerText();
      const word = title.split(/\s+/).find(w => w.length >= 3);
      await d.locator('.search input').filter({ visible: true }).fill(word);
      await d.locator(`[data-id="${id}"]`).waitFor();
      await d.locator(`[data-id="${id}"]`).click();
      await d.locator('.detail-pane .detail-title').waitFor();
      await d.locator('.search input').filter({ visible: true }).fill('');
    });
    await check('정렬 선택 뒤 새로고침 유지', async () => {
      await d.locator('.sort-trigger').click();
      await d.getByRole('button', { name: '마감순', exact: true }).click();
      await d.reload();
      await d.locator('.sort-trigger').waitFor();
      assert((await d.locator('.sort-trigger').innerText()).trim() === '마감순', '정렬 유실');
    });
    await check('최신순으로 복귀', async () => {
      await d.locator('.sort-trigger').click();
      await d.getByRole('button', { name: '최신순', exact: true }).click();
      assert((await d.locator('.sort-trigger').innerText()).trim() === '최신순', '정렬 불일치');
    });
    await check('정렬 메뉴 방향키와 Esc 포커스 복귀', async () => {
      await d.locator('.sort-trigger').click();
      await d.keyboard.press('ArrowDown');
      await d.keyboard.press('Escape');
      assert(await d.locator('.sort-trigger').evaluate(e => e === document.activeElement), '포커스 유실');
      assert(await d.locator('#sort-options').count() === 0, '메뉴가 남음');
    });
    await check('사이드바 접기 뒤 새로고침 유지', async () => {
      const head = d.locator('[aria-controls="side-boards"]');
      await head.click(); await d.reload(); await head.waitFor();
      assert(await head.getAttribute('aria-expanded') === 'false', '접기 유실');
      await head.click();
    });
    await check('단축키 도움말 열고 Esc 닫기', async () => {
      await d.locator('h1').click(); await d.keyboard.press('?');
      await d.getByRole('dialog').waitFor(); await d.keyboard.press('Escape');
      await d.getByRole('dialog').waitFor({ state: 'hidden' });
    });
    await check('검색 중 숫자 키는 탭을 바꾸지 않음', async () => {
      await d.locator('h1').click(); await d.keyboard.press('/');
      assert(await d.locator('.search input').filter({ visible: true }).evaluate(e => e === document.activeElement), '검색 포커스');
      await d.keyboard.type('3');
      assert(await d.locator('notice-app').evaluate(e => e.view) === 'all', '탭 오작동');
      await d.locator('.search input').filter({ visible: true }).fill('');
      await d.keyboard.press('Escape');
    });
    await check('상세 칸 닫고 다시 열기', async () => {
      await d.getByRole('button', { name: '상세 칸 닫기', exact: true }).click();
      await d.getByRole('button', { name: '상세 칸 열기', exact: true }).click();
      await d.locator('.detail-pane .detail-title').waitFor();
    });
    await check('PC 설정 열고 닫기', async () => {
      await d.locator('.side-foot').getByRole('button', { name: '설정', exact: true }).click();
      await d.getByRole('button', { name: '설정 닫기', exact: true }).filter({ visible: true }).click();
      await d.waitForFunction(() => document.querySelector('notice-app').view === 'all');
    });

    const m = await open(412, 'intern');
    const mobileTab = label => m.locator('.tabbar').getByRole('button', { name: label, exact: true });
    await check('휴대폰 검색 뒤 공지와 목록 왕복', async () => {
      const row = m.locator('.row').first();
      const id = await row.getAttribute('data-id');
      const title = await row.locator('.title').innerText();
      const word = title.split(/\s+/).find(w => w.length >= 3);
      const input = m.locator('.search input').filter({ visible: true });
      await input.fill(word);
      await m.locator(`[data-id="${id}"]`).click();
      await m.locator('.reading').waitFor();
      await m.getByRole('button', { name: '목록으로', exact: true }).click();
      assert(await input.inputValue() === word, '검색어 유실');
      await input.fill('');
    });
    await check('휴대폰 공지 열고 목록으로', async () => {
      await m.locator('.row').first().click();
      await m.getByRole('button', { name: '목록으로', exact: true }).click();
      await m.locator('.tabbar').waitFor({ state: 'visible' });
    });
    await check('앞으로 가기로 상세 복원', async () => {
      await m.goForward(); await m.locator('.reading').waitFor();
      await m.getByRole('button', { name: '목록으로', exact: true }).click();
    });
    await check('저장하고 목록으로 돌아오기', async () => {
      await m.locator('.row').first().click();
      await m.locator('.read-actions').getByRole('button', { name: '저장하기', exact: true }).click();
      await m.getByRole('button', { name: '목록으로', exact: true }).click();
      await mobileTab('저장').click(); await m.locator('.row').first().waitFor();
    });
    await check('저장 목록 새로고침 유지', async () => {
      await m.reload(); await m.locator('.row').first().waitFor();
      assert(await m.locator('notice-app').evaluate(e => e.view) === 'saved', '저장 탭 유실');
    });
    await check('저장 해제 후 빈 목록', async () => {
      await m.locator('.row').first().click();
      await m.locator('.read-actions').getByRole('button', { name: '저장 지우기', exact: true }).click();
      await m.getByRole('button', { name: '목록으로', exact: true }).click();
      await m.getByText('저장한 공지가 없어요', { exact: true }).waitFor();
    });
    await mobileTab('성대 공지').click();
    await check('게시판 필터와 인턴 탭 교차 이동', async () => {
      await m.locator('.board-trigger:not(.sort-trigger)').click();
      await m.locator('.board-option:not(.sort-option)').nth(1).click();
      const ids = await m.locator('.row').evaluateAll(es => es.map(e => e.dataset.id.split('/')[0]));
      assert(ids.length > 0 && new Set(ids).size === 1, '게시판 필터 불일치');
      await mobileTab('인턴 공고').click(); await m.locator('.row').first().waitFor();
      await mobileTab('성대 공지').click();
    });
    await check('게시판 Esc와 선택 후 포커스 복귀', async () => {
      const trigger = m.locator('.board-picker .board-trigger');
      await trigger.click(); await m.keyboard.press('Escape');
      assert(await trigger.evaluate(e => e === document.activeElement), 'Esc 포커스가 다른 메뉴로 감');
      await trigger.click(); await m.locator('.board-option:not(.sort-option)').first().click();
      assert(await trigger.evaluate(e => e === document.activeElement), '선택 후 포커스가 다른 메뉴로 감');
    });
    await check('게시판 메뉴 Tab 이탈 시 닫기', async () => {
      await m.locator('.board-trigger:not(.sort-trigger)').click();
      await m.locator('.board-option:not(.sort-option)').last().focus();
      await m.keyboard.press('Tab');
      await m.locator('#board-options').waitFor({ state: 'detached' });
    });
    await check('메뉴 바깥 클릭으로 닫기', async () => {
      await m.locator('.board-trigger:not(.sort-trigger)').click();
      await m.locator('h1').click();
      await m.locator('#board-options').waitFor({ state: 'detached' });
    });
    await check('미입력 연결에서 안내 표시', async () => {
      await m.getByRole('button', { name: '설정', exact: true }).filter({ visible: true }).click();
      await m.getByRole('link', { name: /^기기 연결/ }).click();
      await m.getByText('처음 연결하기', { exact: true }).click();
      await m.getByRole('button', { name: '연결하기', exact: true }).click();
      await m.getByText('저장소는 아이디/저장소 이름으로, 토큰은 github_pat_로 시작하는 값을 넣어 주세요', { exact: true }).waitFor();
    });
    await check('화면 모드 변경과 설정 닫기', async () => {
      await m.getByRole('link', { name: '설정으로', exact: true }).click();
      await m.getByRole('radio', { name: '어둡게', exact: true }).click();
      await m.getByRole('button', { name: '설정 닫기', exact: true }).filter({ visible: true }).click();
      assert(await m.evaluate(() => document.documentElement.dataset.theme === 'dark'), '화면 모드 미반영');
      await m.reload(); await m.locator('.row').first().waitFor();
      assert(await m.evaluate(() => document.documentElement.dataset.theme === 'dark'), '화면 모드 유실');
    });
    await check('320px로 축소해도 가로 넘침 없음', async () => {
      await m.setViewportSize({ width: 320, height: 891 });
      assert(!await m.evaluate(() => document.documentElement.scrollWidth > innerWidth), '가로 넘침');
      await m.setViewportSize({ width: 412, height: 891 });
    });
    await check('원문 열기는 별도 탭의 유효한 주소', async () => {
      await m.locator('.row').first().click();
      const link = m.locator('.read-actions').getByRole('link', { name: '원문 열기', exact: true });
      assert(/^https:\/\//.test(await link.getAttribute('href')), '잘못된 원문 주소');
      assert(await link.getAttribute('target') === '_blank', '새 탭 아님');
      const target = await link.getAttribute('href');
      await m.context().route(target, route => route.fulfill({ status: 200, body: '원문 이동 확인' }));
      const popupPromise = m.waitForEvent('popup'); await link.click();
      const popup = await popupPromise; await popup.waitForLoadState();
      assert(popup.url() === target, '원문 주소 불일치'); await popup.close();
    });

    await m.goto(`${origin}?tab=all`);
    await check('관심 키워드 추가와 중복 입력, 필터 선택', async () => {
      await m.getByRole('button', { name: '설정', exact: true }).filter({ visible: true }).click();
      await m.getByRole('link', { name: /^관심 키워드/ }).click();
      const input = m.getByRole('textbox', { name: '새 키워드', exact: true });
      await input.fill('검증용관심조건xyz'); await input.press('Enter');
      await input.fill('검증용관심조건xyz'); await input.press('Enter');
      assert(await m.locator('.keyword-list li').count() === 1, '중복 키워드');
      await m.getByRole('button', { name: '설정 닫기', exact: true }).filter({ visible: true }).click();
      await m.getByRole('link', { name: /^관심 키워드/ }).waitFor();
      await m.getByRole('button', { name: '설정 닫기', exact: true }).filter({ visible: true }).click();
      await m.locator('.tools .chips').getByRole('button', { name: '검증용관심조건xyz', exact: true }).click();
      await m.locator('.empty strong').filter({ hasText: '검증용관심조건xyz' }).waitFor();
    });
    await check('선택된 관심 키워드 삭제 뒤 목록 복구', async () => {
      await m.getByRole('button', { name: '설정', exact: true }).filter({ visible: true }).click();
      await m.getByRole('link', { name: /^관심 키워드/ }).click();
      await m.getByRole('button', { name: '검증용관심조건xyz 삭제', exact: true }).click();
      await m.getByRole('button', { name: '설정 닫기', exact: true }).filter({ visible: true }).click();
      await m.getByRole('link', { name: /^관심 키워드/ }).waitFor();
      await m.getByRole('button', { name: '설정 닫기', exact: true }).filter({ visible: true }).click();
      await m.locator('.row').first().waitFor();
      assert(await m.locator('.tools .chips').getByRole('button', { name: '검증용관심조건xyz', exact: true }).count() === 0,
        '지운 키워드가 남음');
    });
    await check('목록 요청 실패 안내 뒤 재시도로 복구', async () => {
      const context = await page.context().browser().newContext({
        serviceWorkers: 'block', viewport: { width: 412, height: 891 },
      });
      contexts.push(context);
      const p = await context.newPage();
      p.setDefaultTimeout(6000);
      let fail = true;
      await p.route('**/api/v1/notices.json', route => fail
        ? route.fulfill({ status: 500, body: 'test failure' }) : route.continue());
      await p.goto(`${origin}?tab=all`);
      await p.getByText('목록을 불러오지 못했어요', { exact: true }).waitFor();
      fail = false;
      await p.getByRole('button', { name: '다시 불러오기', exact: true }).click();
      await p.locator('.row').first().waitFor();
    });

    const f = await open(412);
    await check('내 공지 탭이 없고 세 탭만 표시', async () => {
      assert(await f.locator('.tabbar button').count() === 3, '탭 개수');
      assert(await f.getByRole('button', { name: /내 공지/ }).count() === 0, '내 공지가 남음');
    });
    await check('기존 내 공지 주소는 성대 공지로 열림', async () => {
      await f.goto(`${origin}?tab=mine`);
      await f.locator('.row').first().waitFor();
      assert(await f.locator('notice-app').evaluate(e => e.view) === 'all', '기존 주소 호환');
    });
    await check('기존 마감 임박 주소는 성대 공지 마감순', async () => {
      await f.goto(`${origin}?tab=deadline`);
      await f.locator('.sort-trigger').waitFor();
      assert((await f.locator('.sort-trigger').innerText()).trim() === '마감순', '기존 마감 주소');
      await f.locator('.sort-trigger').click();
      await f.getByRole('button', { name: '최신순', exact: true }).click();
    });
    await check('PWA 바로가기에서 내 공지 제거', async () => {
      const manifest = await (await f.request.get(`${origin}manifest.webmanifest`)).json();
      assert(!manifest.shortcuts.some(s => s.name === '내 공지'), '이전 바로가기');
      assert(manifest.shortcuts.some(s => s.name === '성대 공지'), '학교 바로가기 없음');
    });
    await check('새 단축키 1, 2, 3으로 세 탭 이동', async () => {
      for (const [key, expected] of [['2', 'intern'], ['3', 'saved'], ['1', 'all']]) {
        await f.locator('h1').click(); await f.keyboard.press(key);
        assert(await f.locator('notice-app').evaluate(e => e.view) === expected, '단축키 불일치');
      }
    });
    await check('읽지 않은 공지만 보기와 새로고침 유지', async () => {
      const toggle = f.getByRole('button', { name: '읽지 않은 공지만', exact: true });
      await toggle.click();
      await f.getByText('읽지 않은 공지가 없어요', { exact: true }).waitFor();
      await f.reload(); await toggle.waitFor();
      assert(await toggle.getAttribute('aria-pressed') === 'true', '읽음 보기 유실');
      await toggle.click(); await f.locator('.row').first().waitFor();
    });
    await check('고정 공지는 한 번만 표시하고 별도 숨기기 단추 없음', async () => {
      assert(await f.getByRole('button', { name: '고정 공지 숨기기', exact: true }).count() === 0, '불필요한 단추');
      const ids = await f.locator('.row').evaluateAll(es => es.map(e => e.dataset.id));
      assert(ids.length > 0 && new Set(ids).size === ids.length, '같은 공지 중복');
    });
    await check('보기 조건과 정렬을 같은 행에 맞춤', async () => {
      for (const width of [320, 412]) {
        await f.setViewportSize({ width, height: 891 });
        const positions = await f.locator('.view-options').evaluate(el => {
          const a = el.querySelector('.view-toggle').getBoundingClientRect();
          const b = el.querySelector('.sort-trigger').getBoundingClientRect();
          return { a: a.y + a.height / 2, b: b.y + b.height / 2, minHeight: Math.min(a.height, b.height),
            overflow: document.documentElement.scrollWidth > innerWidth };
        });
        assert(Math.abs(positions.a - positions.b) < 1 && positions.minHeight >= 44 && !positions.overflow, '조작 행 정렬 또는 크기');
      }
      await f.locator('.tabbar').getByRole('button', { name: '인턴 공고', exact: true }).click();
      assert(await f.getByRole('button', { name: '고정 공지 숨기기', exact: true }).count() === 0, '다른 탭에 단추가 남음');
    });
    await check('읽지 않은 글을 열고 돌아오면 목록에서 빠짐', async () => {
      const context = await page.context().browser().newContext({
        serviceWorkers: 'block', viewport: { width: 412, height: 891 },
      });
      contexts.push(context);
      await context.addInitScript(() => localStorage.setItem('read-notices', '[]'));
      const p = await context.newPage(); p.setDefaultTimeout(6000);
      await p.goto(`${origin}?tab=all`); await p.locator('.row').first().waitFor();
      await p.getByRole('button', { name: '읽지 않은 공지만', exact: true }).click();
      const id = await p.locator('.row').first().getAttribute('data-id');
      await p.locator('.row').first().click(); await p.locator('.reading').waitFor();
      await p.locator('.read-actions').getByRole('button', { name: '저장하기', exact: true }).click();
      await p.getByRole('button', { name: '목록으로', exact: true }).click();
      await p.locator('.tabbar').waitFor({ state: 'visible' });
      assert(await p.locator(`[data-id="${id}"]`).count() === 0, '읽은 글이 남음');
      await p.locator('.tabbar').getByRole('button', { name: '저장', exact: true }).click();
      await p.locator(`[data-id="${id}"]`).waitFor();
      assert(await p.locator('.view-options').count() === 0, '저장 목록에 보기 조건이 적용됨');
    });

    await check('PC 읽지 않은 글 선택과 상세 닫기', async () => {
      const context = await page.context().browser().newContext({
        serviceWorkers: 'block', viewport: { width: 1280, height: 900 },
      });
      contexts.push(context);
      await context.addInitScript(() => localStorage.setItem('read-notices', '[]'));
      const p = await context.newPage(); p.setDefaultTimeout(6000);
      await p.goto(`${origin}?tab=all`); await p.locator('.row').first().waitFor();
      await p.getByRole('button', { name: '읽지 않은 공지만', exact: true }).click();
      const row = p.locator('.row').nth(1);
      const id = await row.getAttribute('data-id');
      await row.click();
      assert(await p.locator('notice-app').evaluate(e => e.selectedId) === id, '선택 불일치');
      await p.locator('.detail-pane .detail-title').waitFor();
      await p.getByRole('button', { name: '상세 칸 닫기', exact: true }).click();
      assert(await p.locator(`[data-id="${id}"]`).count() === 0, '닫은 뒤 읽은 글이 남음');
    });

    await check('앱 이름과 마감 표현이 설치 정보에 일치', async () => {
      const manifest = await (await f.request.get(`${origin}manifest.webmanifest`)).json();
      assert(manifest.name === '성공' && manifest.short_name === '성공', '앱 이름 불일치');
      assert(!manifest.shortcuts.some(s => /마감\s*임박/.test(s.name)), '이전 마감 표현이 남음');
      assert(manifest.shortcuts.some(s => s.name === '마감순 보기'), '마감순 바로가기 없음');
      assert((await f.title()).includes('성공'), '창 이름 불일치');
    });
    await check('학교와 인턴에서 각각 최신순과 마감순 기억', async () => {
      await f.goto(`${origin}?tab=all&sort=deadline`);
      await f.locator('.sort-trigger').waitFor();
      await f.locator('.tabbar').getByRole('button', { name: '인턴 공고', exact: true }).click();
      await f.locator('.sort-trigger').click();
      await f.getByRole('button', { name: '최신순', exact: true }).click();
      await f.reload(); await f.locator('.sort-trigger').waitFor();
      assert((await f.locator('.sort-trigger').innerText()).trim() === '최신순', '인턴 정렬 유실');
      await f.locator('.tabbar').getByRole('button', { name: '성대 공지', exact: true }).click();
      assert((await f.locator('.sort-trigger').innerText()).trim() === '마감순', '학교 정렬이 덮어써짐');
      await f.locator('.tabbar').getByRole('button', { name: '인턴 공고', exact: true }).click();
      assert((await f.locator('.sort-trigger').innerText()).trim() === '최신순', '인턴 정렬이 덮어써짐');
    });
    await check('인턴 마감순과 최신순 실제 정렬', async () => {
      await f.locator('.sort-trigger').click();
      await f.getByRole('button', { name: '마감순', exact: true }).click();
      const deadlines = await f.locator('notice-app').evaluate(e => [...e.querySelectorAll('.row')]
        .map(row => e.notices.find(n => n.id === row.dataset.id).deadline));
      const now = Date.now();
      const buckets = deadlines.map(d => !d ? 1 : Date.parse(d) >= now ? 0 : 2);
      assert(deadlines.length > 0 && buckets.every((b, i) => i === 0 || buckets[i - 1] <= b), '마감 구간 순서 불일치');
      assert(deadlines.every((d, i) => i === 0 || buckets[i - 1] !== buckets[i] || buckets[i] === 1
        || (buckets[i] === 0 ? Date.parse(deadlines[i - 1]) <= Date.parse(d) : Date.parse(deadlines[i - 1]) >= Date.parse(d))), '마감순 불일치');
      await f.locator('.sort-trigger').click();
      await f.getByRole('button', { name: '최신순', exact: true }).click();
      const dates = await f.locator('notice-app').evaluate(e => [...e.querySelectorAll('.row')]
        .map(row => e.notices.find(n => n.id === row.dataset.id).posted_on));
      assert(dates.every((d, i) => i === 0 || dates[i - 1] >= d), '최신순 불일치');
    });

    // 서버 상태별 문구는 실제 계정이나 공개 데이터를 바꾸지 않고 응답만 제어한다.
    const s = await open(412, 'intern');
    let status = 'pending';
    await s.route('**/api/v1/notices/*/*.json', route => route.fulfill({
      status: 200, contentType: 'application/json', body: JSON.stringify({
        body_status: status, body: status === 'ready' ? '검증용 본문' : null,
        body_html: null, images: [], attachments: [], fetched_at: null,
      }),
    }));
    for (const [value, expected] of [
      ['pending', '본문을 준비하고 있어요. 먼저 원문을 볼 수 있어요'],
      ['retrying', '본문을 다시 가져올 예정이에요. 먼저 원문을 볼 수 있어요'],
      ['unavailable', '본문을 가져오지 못했어요. 원문에서 확인해 주세요'],
      ['ready', '검증용 본문'],
    ]) {
      await check(`본문 상태 ${value}`, async () => {
        status = value; await s.reload(); await s.locator('.row').first().click();
        await s.getByText(expected, { exact: true }).waitFor();
      });
    }
    await check('인턴 본문도 한국어 번역과 영어 원문 함께 표시', async () => {
      await s.unroute('**/api/v1/notices/*/*.json');
      await s.route('**/api/v1/notices/*/*.json', route => route.fulfill({
        status: 200, contentType: 'application/json', body: JSON.stringify({
          body_status: 'ready', body: 'Original internship content',
          body_html: '<p>Original internship content</p>', images: [], attachments: [],
          translation: { body: '한국어로 옮긴 인턴 공고 본문' },
        }),
      }));
      await s.reload(); await s.locator('.row').first().click();
      await s.getByRole('heading', { name: '본문 (한국어로 옮긴 글)', exact: true }).waitFor();
      await s.locator('.original-body').getByText('Original internship content', { exact: true }).waitFor();
    });
  } finally {
    for (const context of contexts) await context.close();
  }
  return { passed: results.filter(r => r.pass).length, failed: results.filter(r => !r.pass).length, results };
}
