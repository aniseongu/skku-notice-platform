// Playwright browser_run_code_unsafe에서 예제 데이터로 실행한다.
async (page) => {
  const browser = page.context().browser();
  const results = [];
  for (const colorScheme of ['light', 'dark']) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 891 }, colorScheme, serviceWorkers: 'block' });
    try {
      const p = await context.newPage();
      await p.goto('http://127.0.0.1:5173/?api=sample/api/v1');
      await p.locator('.row .title').first().waitFor();
      if (await p.locator('.sidebar').getByText('단축키', { exact: true }).count()) throw Error('사이드바에 단축키가 남음');
      await p.keyboard.press('?');
      if (!await p.getByRole('dialog', { name: '단축키' }).isVisible()) throw Error('? 키로 단축키 창을 열지 못함');
      await p.getByRole('dialog', { name: '단축키' }).getByRole('button', { name: '닫기' }).click();
      await p.locator('.side-foot').getByRole('button', { name: '설정', exact: true }).click();
      const open = p.getByRole('button', { name: '단축키 보기' });
      await open.click();
      if (!await p.getByRole('dialog', { name: '단축키' }).isVisible()) throw Error('설정에서 단축키 창을 열지 못함');
      await p.keyboard.press('Escape');
      if (await p.getByRole('dialog', { name: '단축키' }).isVisible()) throw Error('Escape로 단축키 창을 닫지 못함');
      if (!await open.evaluate((button) => button === document.activeElement)) throw Error('단축키 버튼으로 포커스가 돌아오지 않음');
      if (await p.getByRole('heading', { name: '설정', exact: true }).count() !== 1) throw Error('단축키 창을 닫으며 설정이 닫힘');
      results.push({ colorScheme, passed: true });
    } finally { await context.close(); }
  }
  return results;
}
