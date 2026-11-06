// Playwright browser_run_code_unsafe에서 예제 데이터와 모의 설치 이벤트로 실행한다.
async (page) => {
  const browser = page.context().browser();
  const results = [];
  for (const width of [390, 1280]) for (const colorScheme of ['light', 'dark']) {
    const context = await browser.newContext({ viewport: { width, height: 891 }, colorScheme, serviceWorkers: 'block' });
    try {
      const p = await context.newPage();
      await p.goto('http://127.0.0.1:5173/?api=sample/api/v1');
      await p.locator('.row .title').first().waitFor();
      await p.evaluate(() => {
        window.installPromptCalls = 0;
        const event = new Event('beforeinstallprompt', { cancelable: true });
        event.prompt = async () => { window.installPromptCalls++; };
        window.dispatchEvent(event);
      });
      if (await p.getByRole('button', { name: '앱으로 설치하기' }).count()) throw Error('기본 화면에 설치 버튼이 표시됨');
      if (await p.locator('.install-bar').count()) throw Error('기본 화면에 설치 안내가 표시됨');
      if (width < 720) await p.getByRole('button', { name: '설정', exact: true }).click();
      else await p.locator('.side-foot').getByRole('button', { name: '설정', exact: true }).click();
      const install = p.getByRole('button', { name: '앱으로 설치하기' });
      if (!await install.isVisible()) throw Error('설정에 설치 버튼이 없음');
      await install.click();
      if (await p.evaluate(() => window.installPromptCalls) !== 1) throw Error('설치 요청이 전달되지 않음');
      if (await install.count()) throw Error('사용한 설치 요청이 남아 있음');
      results.push({ width, colorScheme, passed: true });
    } finally { await context.close(); }
  }
  const installed = await browser.newContext({ viewport: { width: 1280, height: 891 }, serviceWorkers: 'block' });
  try {
    await installed.addInitScript(() => {
      const match = window.matchMedia.bind(window);
      window.matchMedia = (query) => query === '(display-mode: browser)'
        ? { ...match(query), matches: false, media: query, addEventListener() {}, removeEventListener() {} }
        : match(query);
    });
    const p = await installed.newPage();
    await p.goto('http://127.0.0.1:5173/?api=sample/api/v1');
    await p.locator('.row .title').first().waitFor();
    await p.evaluate(() => window.dispatchEvent(new Event('beforeinstallprompt', { cancelable: true })));
    await p.locator('.side-foot').getByRole('button', { name: '설정', exact: true }).click();
    if (await p.getByRole('button', { name: '앱으로 설치하기' }).count()) throw Error('설치된 앱에 설치 버튼이 표시됨');
    results.push({ displayMode: 'installed', passed: true });
  } finally { await installed.close(); }
  return results;
}
