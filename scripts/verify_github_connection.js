// 격리된 모바일 브라우저와 모의 GitHub 응답으로 연결 표시와 복구를 검사한다.
async (page) => {
  const context = await page.context().browser().newContext({ viewport: { width: 412, height: 891 }, serviceWorkers: 'block' });
  const p = await context.newPage(); p.setDefaultTimeout(10000);
  let response = 200, hold = false, release;
  const methods = [], results = [];
  const assert = (ok, text) => { if (!ok) throw new Error(text); };
  const origin = 'https://aniseongu.github.io/skku-notice-alert/';
  const status = p.locator('[aria-label="GitHub 연결 상태"]');
  await context.route('https://api.github.com/**', async route => {
    methods.push(route.request().method());
    if (new URL(route.request().url()).pathname.endsWith('/actions/secrets')) {
      if (hold) await new Promise(resolve => { release = resolve; });
      if (response === 0) await route.abort('failed');
      else await route.fulfill({status:response,json:response === 200 ? {secrets:[]} : {message:'fixture'}});
    } else await route.fulfill({status:404,json:{message:'fixture'}});
  });
  const waitStatus = async text => {
    await p.waitForFunction(text => document.querySelector('[aria-label="GitHub 연결 상태"]')?.textContent.includes(text), text);
  };
  try {
    await p.goto(origin+'?view=settings');
    await p.getByRole('link',{name:/^기기 연결/}).filter({hasText:'이 기기에 GitHub를 연결해 주세요'}).waitFor();
    results.push('설정 개요에서 미연결 표시');
    await p.getByRole('link',{name:/^기기 연결/}).click();
    await p.getByText('처음 연결하기',{exact:true}).click();
    await p.getByLabel('저장소',{exact:true}).fill('aniseongu/skku-notice-alert');
    await p.getByLabel('GitHub 토큰',{exact:true}).fill('github_pat_fixture_connection_only');
    hold = true;
    await p.getByRole('button',{name:'연결하기',exact:true}).click();
    for(let wait=0; !release && wait<50; wait++) await p.waitForTimeout(20);
    assert(await p.getByLabel('GitHub 토큰',{exact:true}).isDisabled(),'확인 중 토큰 편집 허용');
    assert(await p.getByLabel('저장소',{exact:true}).isDisabled(),'확인 중 저장소 편집 허용');
    hold = false; release();
    results.push('확인 중 연결 정보 변경 방지');
    await waitStatus('연결됨');
    assert(await p.getByRole('button',{name:'연결 확인하기',exact:true}).isVisible(),'연결 확인 단추가 접혀 있음');
    assert(await p.getByLabel('GitHub 토큰',{exact:true}).count() === 0,'연결 뒤 토큰 입력 노출');
    assert(!await p.locator('body').innerText().then(text=>text.includes('github_pat_fixture_connection_only')),'토큰 노출');
    await p.screenshot({path:'/home/anseongu/projects/skku-notice-alert/docs/design/captures/2026-11-04/github-status-mobile.jpg',type:'jpeg',quality:80,fullPage:true});
    await p.getByRole('link',{name:'설정으로',exact:true}).click();
    await p.getByRole('link',{name:/^기기 연결/}).filter({hasText:'이 기기가 GitHub에 연결돼 있어요'}).waitFor();
    await p.screenshot({path:'/home/anseongu/projects/skku-notice-alert/docs/design/captures/2026-11-04/github-overview-mobile.jpg',type:'jpeg',quality:80,fullPage:true});
    results.push('재시작 뒤 설정 개요에서 실제 연결 확인');
    await p.getByRole('link',{name:/^기기 연결/}).click(); await waitStatus('연결됨');
    response = 503;
    await p.getByRole('button',{name:'연결 확인하기',exact:true}).click(); await waitStatus('연결 확인 필요');
    await p.reload(); await waitStatus('연결 확인 필요');
    assert(await p.getByRole('button',{name:'노트북 QR로 연결하기',exact:true}).count()===0,'일시 오류에 재연결을 요구함');
    response = 200;
    await p.getByRole('button',{name:'연결 확인하기',exact:true}).click(); await waitStatus('연결됨');
    results.push('서버 오류 뒤 토큰 보존과 재입력 없는 복구');
    response = 0;
    await p.getByRole('button',{name:'연결 확인하기',exact:true}).click(); await waitStatus('연결 확인 필요');
    response = 200;
    await p.getByRole('button',{name:'연결 확인하기',exact:true}).click(); await waitStatus('연결됨');
    results.push('네트워크 오류와 연결 상태 구분');
    response = 401;
    await p.getByRole('button',{name:'연결 확인하기',exact:true}).click(); await waitStatus('다시 연결 필요');
    response = 200;
    await p.reload(); await waitStatus('연결 안 됨');
    results.push('거절된 토큰은 재연결 표시와 저장 해제');
    assert(methods.every(method=>method==='GET'),'연결 확인이 원격 설정을 변경함');
    assert(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'가로 넘침');
    return {passed:results.length,failed:0,results,remoteWrites:0,mockedGitHub:true,actualInstalledDeviceVerified:false};
  } finally { await context.close(); }
}
