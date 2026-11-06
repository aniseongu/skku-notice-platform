// 실제 GitHub와 카메라에 접근하지 않고 기기 연결과 설정 탐색을 검증한다.
async (page) => {
  const origin = 'https://aniseongu.github.io/skku-notice-alert/';
  const results = [], contexts = [];
  const assert = (ok, message) => { if (!ok) throw new Error(message); };
  async function check(name, fn) {
    try { await fn(); results.push({ name, pass: true }); }
    catch (error) { results.push({ name, pass: false, error: error.message.split('\n').slice(0, 6).join('\n') }); }
  }
  async function client(width) {
    const context = await page.context().browser().newContext({ serviceWorkers: 'block', viewport: { width, height: 891 } });
    contexts.push(context);
    let calls = 0;
    await context.route('https://api.github.com/**', async route => {
      calls++;
      const path = new URL(route.request().url()).pathname;
      if (path.endsWith('/actions/secrets')) await route.fulfill({json: {secrets:[{name:'GEMINI_API_KEY',updated_at:'2026-11-04'},{name:'CANVAS_TOKEN',updated_at:'2026-11-04'}]}});
      else await route.fulfill({status:404,json:{message:'fixture missing'}});
    });
    await context.addInitScript(() => {
      Object.defineProperty(navigator, 'mediaDevices', {configurable:true,value:{getUserMedia:async()=>{throw new DOMException('fixture denied','NotAllowedError');}}});
    });
    const p = await context.newPage(); p.setDefaultTimeout(7000);
    return {p,calls:()=>calls};
  }
  try {
    const desktop=await client(1280), d=desktop.p;
    await d.goto(origin+'?view=settings');
    await check('설정 개요는 다섯 항목과 화면 모드만 표시', async()=>{
      assert(await d.locator('.settings-link').count()===5,'개요 항목 수');
      assert(await d.getByLabel('GitHub 토큰',{exact:true}).count()===0,'개요 토큰 노출');
      assert(await d.getByLabel('Gemini 키',{exact:true}).count()===0,'개요 API키 노출');
      assert(await d.getByRole('link',{name:/^캘린더/}).count()===1,'캘린더 중복');
      assert(await d.getByRole('link',{name:'구글 캘린더에 추가하기',exact:true}).count()===0,'중복 구독 UI');
    });
    await check('처음 연결하기는 접혀 있고 노트북 QR을 먼저 안내', async()=>{
      await d.getByRole('link',{name:/^기기 연결/}).click();
      await d.getByRole('button',{name:'노트북 QR로 연결하기',exact:true}).waitFor();
      assert(!await d.getByLabel('GitHub 토큰',{exact:true}).isVisible(),'수동 입력 기본 펼침');
      await d.getByText('처음 연결하기',{exact:true}).click();
      await d.getByLabel('저장소',{exact:true}).fill('aniseongu/skku-notice-alert');
      await d.getByLabel('GitHub 토큰',{exact:true}).fill('github_pat_fixture_only');
      await d.getByRole('button',{name:'연결하기',exact:true}).click();
      await d.getByText('연결됨',{exact:true}).waitFor();
    });
    await check('노트북에서 휴대폰 QR 표시와 닫기',async()=>{
      await d.getByRole('button',{name:'휴대폰 연결 QR 띄우기',exact:true}).click();
      await d.getByRole('img',{name:'다른 기기 연결 QR',exact:true}).waitFor();
      await d.getByRole('button',{name:'QR 닫기',exact:true}).click();
      assert(await d.locator('.qr').count()===0,'QR 닫기 실패');
    });
    const phone=await client(412), m=phone.p;
    await check('휴대폰 QR는 확인 전에 연결하지 않고 주소에서 열쇠 제거',async()=>{
      await m.goto(origin+'?view=settings&section=connection#repo=aniseongu%2Fskku-notice-alert&token=github_pat_fixture_only');
      await m.getByText('QR로 이 기기를 aniseongu/skku-notice-alert에 연결할까요?',{exact:true}).waitFor();
      assert(new URL(m.url()).hash==='','주소에 연결 열쇠 남음');
      assert(phone.calls()===0,'확인 전 인증 API 요청');
      await m.getByRole('button',{name:'연결하기',exact:true}).click();
      await m.getByText('연결됨',{exact:true}).waitFor();
      assert(!await m.getByLabel('GitHub 토큰',{exact:true}).isVisible(),'휴대폰 토큰 재입력');
    });
    await check('휴대폰 재시작과 공용 키 상태 복원',async()=>{
      await m.reload();
      await m.getByText('연결됨',{exact:true}).waitFor();
      await m.goto(origin+'?view=settings&keys=1');
      await m.getByText('연결 키',{exact:true}).first().waitFor();
      await m.locator('settings-view').evaluate(e=>e.updateComplete);
      await m.getByText('저장됨',{exact:true}).first().waitFor();
      assert(await m.getByLabel('아이캠퍼스 토큰',{exact:true}).count()===0,'공용 토큰을 다시 입력하게 함');
    });
    await check('연결 안 된 알림 상태를 꺼짐으로 표시하지 않음',async()=>{
      const other=await client(412); await other.p.goto(origin+'?view=settings&section=notifications');
      const radios=other.p.getByRole('radiogroup',{name:'이 기기 아캠 알림',exact:true}).getByRole('radio');
      assert(await radios.count()===3,'기기별 알림 선택');
      for(const radio of await radios.all()) {assert(await radio.isDisabled(),'연결 전 변경 허용');assert(await radio.getAttribute('aria-checked')==='false','미확인을 꺼짐으로 표시');}
    });
    await check('다른 저장소의 QR 거절',async()=>{
      const other=await client(412); await other.p.goto(origin+'?view=settings&section=connection#repo=untrusted%2Frepo&token=github_pat_fixture_only');
      await other.p.getByText('이 사이트의 저장소가 아닌 QR이라 연결하지 않았어요',{exact:true}).waitFor();
      assert(other.calls()===0,'다른 저장소 인증 API 요청');
    });
    await check('카메라 거부 뒤 대체 연결 안내와 카메라 닫힘',async()=>{
      const other=await client(412);await other.p.goto(origin+'?view=settings&section=connection');
      await other.p.getByRole('button',{name:'노트북 QR로 연결하기',exact:true}).click();
      await other.p.getByText('카메라를 허용하거나 휴대폰 카메라 앱으로 노트북 QR을 찍어 주세요',{exact:true}).waitFor();
      assert(await other.p.locator('video').count()===0,'닫히지 않은 카메라');
    });
  } finally {for(const context of contexts)await context.close();}
  return {passed:results.filter(r=>r.pass).length,failed:results.filter(r=>!r.pass).length,mockedGitHub:true,actualInstalledDeviceVerified:false,results};
}
