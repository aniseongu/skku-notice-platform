// Playwright browser_run_code_unsafe에서 예제 데이터로 실행한다.
async (page) => {
  const browser = page.context().browser();
  const results = [];
  for (const colorScheme of ['light', 'dark']) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, colorScheme, serviceWorkers: 'block' });
    try {
      const p = await context.newPage();
      await p.goto('http://127.0.0.1:5173/?api=sample/api/v1');
      const rows = p.locator('.row');
      await rows.first().waitFor();
      const pane = p.locator('.detail-pane');
      if (!await pane.isVisible()) throw Error('기본 상세가 표시되지 않음');
      await rows.first().click();
      if (await pane.isVisible()) throw Error('열린 첫 행을 눌렀을 때 닫히지 않음');
      if (await rows.first().getAttribute('aria-current') !== 'false') throw Error('닫힌 상세가 선택된 것으로 표시됨');
      await p.screenshot({path: `docs/design/captures/2026-11-06/detail-toggle-${colorScheme}-closed.png`});
      await rows.first().click();
      if (!await pane.isVisible()) throw Error('닫힌 행을 눌렀을 때 열리지 않음');
      await rows.nth(1).click();
      if (!await pane.isVisible() || await rows.nth(1).getAttribute('aria-current') !== 'true') throw Error('다른 행으로 전환되지 않음');
      await p.screenshot({path: `docs/design/captures/2026-11-06/detail-toggle-${colorScheme}-open.png`});
      await rows.nth(1).focus();
      await p.keyboard.press('Enter');
      if (await pane.isVisible()) throw Error('키보드로 같은 행을 눌렀을 때 닫히지 않음');
      await rows.nth(1).press('Enter');
      if (!await pane.isVisible()) throw Error('키보드로 다시 열리지 않음');
      await p.keyboard.press('Escape');
      if (await pane.isVisible()) throw Error('Escape로 닫히지 않음');
      await p.reload();
      await rows.first().waitFor();
      if (await pane.isVisible()) throw Error('닫힌 설정이 유지되지 않음');
      results.push({colorScheme, desktop: 'passed'});
    } finally { await context.close(); }
  }
  const context = await browser.newContext({ viewport: {width: 390, height: 844}, serviceWorkers: 'block' });
  try {
    const p = await context.newPage();
    await p.goto('http://127.0.0.1:5173/?api=sample/api/v1');
    await p.locator('.row').first().click();
    if (!(await p.locator('notice-app').evaluate(e => e.openedId))) throw Error('모바일 상세가 열리지 않음');
    await p.goBack();
    if (await p.locator('notice-app').evaluate(e => e.openedId)) throw Error('모바일 뒤로 가기 실패');
    results.push({mobile: 'passed'});
  } finally { await context.close(); }
  return results;
}
