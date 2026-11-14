import { useEffect, useState } from 'react';
// 로그인 전용 화면. 로그인하기 전에는 앱의 어떤 부분도 보이지 않고 이 화면만 뜬다.
import { APP_NAME } from './brand';
import type { AppController } from './app-controller';
import { InstallBanner } from './install-banner';

// 출처: https://developers.google.com/identity/branding-guidelines
const GoogleG = () => <svg className="flex-none w-[20px] h-[20px]" width="18" height="18" viewBox="0 0 48 48" aria-hidden="true" focusable="false">
  <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
  <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
  <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
  <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
</svg>;

/** 기다리는 화면. 로그인 확인과 내 정보 불러오기가 같은 문구, 같은 자리라 이어서 기다려도 화면이 한 번만 보인다.
 * 0.3초 안에 끝나는 기다림은 문구를 그리지 않는다(잠깐 번쩍이지 않게, 토스 기준). */
export function LoginStatus({ text = '불러오고 있어요' }: { text?: string }) {
  const [shown, setShown] = useState(false);
  useEffect(() => { const timer = window.setTimeout(() => setShown(true), 300); return () => window.clearTimeout(timer); }, []);
  return <div className="flex min-h-dvh items-center justify-center bg-bg px-[24px]"><div role="status" className={`text-center ${shown ? '' : 'invisible'}`}><p className="m-0 text-[15px] leading-[22px] text-ink-2">{text}</p></div></div>;
}

export function LoginScreen({ app }: { app: AppController }) {
  const busy = app.authBusy;
  // 가운데 알림 예시는 실제 알림(src/skku_notice/push_collection.py)과 같은 모양이다: 제목은 공지 제목, 본문 첫 줄은 AI 판정 문구, 둘째 줄은 관심 키워드와 마감(키워드가 없으면 마감만), 마지막 줄은 게시판. 알림은 AI 판정이 끝난 뒤에 간다.
  // 토스 첫 화면 구성(TDS Top: 위 그림, 28px 제목, 17px 설명, 아래 고정 단추 하나)을 따른다. 가운데에는 이 앱이 하는 일을 알림 예시 하나로 보여 준다.
  return <div className="flex flex-col min-h-dvh bg-bg">
    <div className="flex flex-1 flex-col w-full px-[20px] py-0 min-[720px]:my-auto min-[720px]:flex-none min-[720px]:max-w-[420px] min-[720px]:self-center min-[720px]:px-0 min-[720px]:py-[48px]">
      <div className="flex flex-1 flex-col pt-[calc(48px_+_env(safe-area-inset-top))] min-[720px]:flex-none min-[720px]:pt-0">
        {/* 맨 위에 앱 아이콘과 이름(사용자 요청: 아이콘은 보여야 한다), 그 아래 TDS Top의 그림 자리에 알림 예시를 둔다. */}
        <div className="flex items-center gap-[10px] mb-[28px] text-[22px] leading-[30px] font-bold text-ink"><svg className="w-[48px] h-[48px] flex-none" aria-hidden="true"><use href="icons/sprite.svg#brand" /></svg><span>{APP_NAME}</span></div>
        <div className="pointer-events-none">
          <p className="m-0 mb-[8px] text-[13px] leading-[18px] font-semibold text-ink-2" id="login-preview-label">알림 예시</p>
          <div className="w-full px-[16px] py-[14px] border border-line rounded-lg bg-surface" role="img" aria-labelledby="login-preview-label" aria-describedby="login-note-text">
            <div className="flex items-center gap-[6px] text-[13px] leading-[18px] text-ink-2">
              <svg className="w-[18px] h-[18px] flex-none" aria-hidden="true"><use href="icons/sprite.svg#brand" /></svg>
              <span className="font-semibold text-ink">{APP_NAME}</span>
              <span className="ml-auto text-ink-2">지금</span>
            </div>
            <div id="login-note-text"><p className="m-0 mt-[8px] text-[15px] leading-[22px] font-semibold text-ink">[소프트웨어학과] 겨울방학 소프트웨어 인턴 모집 안내</p>
            <p className="m-0 mt-[2px] text-[14px] leading-[20px] font-medium text-ink break-keep">소프트웨어학과 학생이 지원할 수 있는 개발 인턴이에요</p>
            <p className="m-0 text-[14px] leading-[20px] text-ink-2">관심 키워드 인턴, <span className="whitespace-nowrap">12월 5일(토) 마감이에요</span></p></div>
          </div>
        </div>
        <div className="pt-[32px]">
          <h1 className="m-0 text-[28px] leading-[38px] font-bold tracking-[-0.02em] overflow-visible text-clip whitespace-normal break-keep min-[720px]:text-[30px] min-[720px]:leading-[40px]">필요한 성균관대 공지만<br />알려 줘요</h1>
          <p className="m-0 mt-[8px] text-[17px] leading-[26px] font-medium text-ink-2 break-keep text-balance">AI가 내 학과에 맞는지 확인하고 이유와 마감일을 함께 알려 줘요</p>
        </div>
      </div>
      <div className="pt-[24px] pb-[calc(20px_+_env(safe-area-inset-bottom))] min-[720px]:mt-0 min-[720px]:pb-0">
        <button type="button" className="flex items-center justify-center gap-[10px] w-full h-[56px] border border-[light-dark(#747775,#8E918F)] rounded-md bg-[light-dark(#FFFFFF,#131314)] text-[light-dark(#1F1F1F,#E3E3E3)] text-[17px] font-semibold [@media(hover:hover)]:[&:hover:not(:disabled)]:bg-[light-dark(#F2F2F2,#1E1F20)] [&:active:not(:disabled)]:bg-[light-dark(#F2F2F2,#1E1F20)] disabled:opacity-70 focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2" disabled={busy} aria-busy={busy} onClick={() => { void app.signIn(); }}>
          {busy ? null : <GoogleG />}
          <span>{busy ? 'Google로 이동하고 있어요' : 'Google로 계속하기'}</span>
        </button>
        <div aria-live="polite" className="mt-[12px] empty:hidden">
          {app.authError ? <p className="m-0 text-[14px] leading-[20px] text-center text-danger" role="alert">{app.authError}</p> : null}
        </div>
        <p className="m-0 mt-[14px] text-[13px] leading-[20px] text-center text-ink-2 min-[720px]:text-[14px]">계속하면 <a className="inline-block px-[4px] py-[12px] -mx-[4px] -my-[12px] text-ink" href="./privacy.html">개인정보처리방침</a>에 동의하는 거예요</p>
      </div>
    </div>
    <InstallBanner app={app} />
  {/* 서비스 정보는 화면 맨 아래에 둔다. PC에서는 창 바닥에 붙어 로그인 묶음과 떨어져 있고, 휴대폰에서는 로그인 묶음 바로 아래 바닥이다. 개인 연락처는 처리방침에만 적는다. */}
    <footer className="px-[20px] pt-[8px] pb-[calc(20px_+_env(safe-area-inset-bottom))] text-center text-[12px] leading-[18px] text-ink-3"><a className="inline-block px-[6px] py-[13px] -my-[13px] text-ink-3 underline underline-offset-2" href="https://github.com/aniseongu/skku-notice-platform/issues" target="_blank" rel="noopener noreferrer">문의하기</a> · <a className="inline-block px-[6px] py-[13px] -my-[13px] text-ink-3 underline underline-offset-2" href="https://github.com/aniseongu/skku-notice-platform" target="_blank" rel="noopener noreferrer">오픈소스</a></footer>
  </div>;
}
