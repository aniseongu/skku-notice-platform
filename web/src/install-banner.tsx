import { useState, useSyncExternalStore } from 'react';
import type { AppController } from './app-controller';
import { remember } from './app-controller';
import { subscribeUpdate, updateAvailable } from './app-update';
import { installBannerDismissed, installBannerDue, installMode, isStandalone, MANUAL_INSTALL_HINT } from './install-hint';

const KEY = 'install-banner';

/** 휴대폰 브라우저에서 홈 화면 설치 방법을 화면 아래에 보여 준다. */
export function InstallBanner({ app }: { app: AppController }) {
  const [closed, setClosed] = useState(false);
  const update = useSyncExternalStore(subscribeUpdate, updateAvailable, () => false);
  const mode = installMode(navigator.userAgent, isStandalone(), !!app.install);
  if (closed || app.toast || update || mode === 'none' || !installBannerDue(remember(KEY), Date.now())) return null;
  const close = () => { remember(KEY, installBannerDismissed(remember(KEY), Date.now())); setClosed(true); };
  const hint = mode === 'prompt' ? null : MANUAL_INSTALL_HINT[mode];
  return <section className="install-banner fixed inset-x-0 bottom-0 z-[4] max-h-[75dvh] overflow-y-auto rounded-t-lg border border-line bg-surface px-[20px] pt-[20px] pb-[calc(20px+env(safe-area-inset-bottom))] shadow-lg min-[720px]:hidden" aria-label="앱 설치">
    <div className="flex items-start gap-[12px]">
      <img src="icon-192.png" alt="" className="size-[48px] flex-none rounded-md border border-line" />
      <div className="min-w-0 flex-1 pt-[2px]">
        <p className="m-0 text-[18px] leading-[25px] font-bold text-ink break-keep">홈 화면에 성공 추가하기</p>
        <p className="m-0 mt-[4px] text-[15px] leading-[22px] text-ink-2 break-keep">앱처럼 바로 열어 공지와 알림을 확인해요</p>
      </div>
      <button type="button" className="-mt-[8px] -mr-[8px] inline-flex min-h-[44px] min-w-[44px] flex-none items-center justify-center rounded-md border-0 bg-transparent text-ink-2 [@media(hover:hover)]:hover:bg-hover active:bg-hover" aria-label="닫기" onClick={close}>
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
      </button>
    </div>
    {hint ? <p className="install-hint m-0 mt-[16px] rounded-md bg-sunken px-[16px] py-[14px] text-[15px] leading-[22px] text-ink-2 break-keep">{hint.lead}<b className="font-semibold text-ink">{hint.action}</b>{hint.tail}</p> : null}
    {hint ? null : <button type="button" className="mt-[16px] inline-flex min-h-[48px] w-full items-center justify-center rounded-md border-0 bg-accent px-[16px] text-[16px] font-semibold text-on-accent active:opacity-80" onClick={() => { void app.runInstall(); }}>홈 화면에 추가</button>}
    <button type="button" className="mt-[8px] inline-flex min-h-[44px] w-full items-center justify-center rounded-md border-0 bg-transparent text-[15px] font-semibold text-ink-2 [@media(hover:hover)]:hover:bg-hover active:bg-hover" onClick={close}>{hint ? '확인했어요' : '다음에 할게요'}</button>
  </section>;
}
