import { useState, useSyncExternalStore } from 'react';
import type { AppController } from './app-controller';
import { remember } from './app-controller';
import { subscribeUpdate, updateAvailable } from './app-update';
import { installBannerDismissed, installBannerDue, installMode, isStandalone, MANUAL_INSTALL_HINT } from './install-hint';

const KEY = 'install-banner';

/** 휴대폰 브라우저에서 앱 설치를 제안한다. 로그인 화면은 본문 안에 두어 로그인 버튼을 가리지 않는다. */
export function InstallBanner({ app, placement = 'feed' }: { app: AppController; placement?: 'feed' | 'login' }) {
  const [closed, setClosed] = useState(false);
  const update = useSyncExternalStore(subscribeUpdate, updateAvailable, () => false);
  const mode = installMode(navigator.userAgent, isStandalone(), !!app.install);
  if (closed || app.toast || update || mode === 'none' || !installBannerDue(remember(KEY), Date.now())) return null;
  const close = () => { remember(KEY, installBannerDismissed(remember(KEY), Date.now())); setClosed(true); };
  const hint = mode === 'prompt' ? null : MANUAL_INSTALL_HINT[mode];
  return <section className={`install-banner ${placement === 'feed' ? 'fixed inset-x-[12px] bottom-[calc(var(--tabbar-h)+8px+env(safe-area-inset-bottom))] z-[4] shadow-lg' : 'relative mx-[20px] mb-[16px]'} rounded-lg border border-line bg-surface py-[16px] pl-[16px] pr-[8px] min-[720px]:hidden`} aria-label="앱 설치">
    <div className="flex items-center gap-[8px]">
      <div className="min-w-0 flex-1">
        <p className="m-0 text-[17px] leading-[24px] font-bold text-ink">홈 화면에 추가해 보세요</p>
        {hint
          ? <p className="install-hint m-0 mt-[6px] text-[15px] leading-[22px] text-ink-2 break-keep">{hint.lead}<b className="font-semibold text-ink">{hint.action}</b>{hint.tail}</p>
          : <p className="m-0 mt-[6px] text-[15px] leading-[22px] text-ink-2">앱을 더 빠르게 열 수 있어요</p>}
      </div>
      {hint ? null : <button type="button" className={`inline-flex min-h-[44px] flex-none items-center justify-center rounded-md px-[16px] text-[15px] font-semibold ${placement === 'login' ? 'border border-line bg-surface text-accent [@media(hover:hover)]:hover:bg-hover active:bg-hover' : 'border-0 bg-accent text-on-accent active:opacity-80'}`} onClick={() => { void app.runInstall(); }}>설치</button>}
      <button type="button" className="inline-flex min-h-[44px] min-w-[44px] flex-none items-center justify-center rounded-md border-0 bg-transparent text-ink-2 [@media(hover:hover)]:hover:bg-hover active:bg-hover" aria-label="닫기" onClick={close}>
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
      </button>
    </div>
  </section>;
}
