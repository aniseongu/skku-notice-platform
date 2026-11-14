import { useState, useSyncExternalStore } from 'react';
import type { AppController } from './app-controller';
import { remember } from './app-controller';
import { subscribeUpdate, updateAvailable } from './app-update';
import { installBannerDismissed, installBannerDue, installMode, isStandalone, MANUAL_INSTALL_HINT } from './install-hint';

const KEY = 'install-banner';

/** 홈 화면에 추가하지 않은 휴대폰 브라우저에서 화면 아래에 얇게 뜨는 설치 제안. 닫을 수 있고, 닫으면 한동안 다시 묻지 않는다. PC(720px 이상)에서는 가린다. */
export function InstallBanner({ app }: { app: AppController }) {
  const [closed, setClosed] = useState(false);
  const update = useSyncExternalStore(subscribeUpdate, updateAvailable, () => false);
  const mode = installMode(navigator.userAgent, isStandalone(), !!app.install);
  if (closed || app.toast || update || mode === 'none' || !installBannerDue(remember(KEY), Date.now())) return null;
  const close = () => { remember(KEY, installBannerDismissed(remember(KEY), Date.now())); setClosed(true); };
  const hint = mode === 'prompt' ? null : MANUAL_INSTALL_HINT[mode];
  // 설치 창이 있으면 한 줄 제안과 [설치] 단추 하나, 없으면 방법을 처음부터 보여 준다(누를 곳 없이 읽고 닫기만 하면 된다).
  return <section className="install-banner fixed inset-x-[12px] bottom-[calc(var(--tabbar-h)+8px+env(safe-area-inset-bottom))] z-[4] rounded-lg border border-line bg-surface py-[4px] pl-[16px] pr-[4px] shadow-lg min-[720px]:hidden" aria-label="앱 설치">
    <div className="flex items-center gap-[8px]">
      {hint
        ? <p className="install-hint m-0 flex-1 py-[8px] text-[14px] leading-[21px] text-ink-2 break-keep">{hint.lead}<b className="font-semibold text-ink whitespace-nowrap">{hint.action}</b>{hint.tail}</p>
        : <p className="m-0 flex-1 py-[8px] text-[15px] leading-[22px] font-semibold text-ink break-keep">홈 화면에 추가하면 알림을 받을 수 있어요</p>}
      {hint ? null : <button type="button" className="inline-flex min-h-[44px] flex-none items-center justify-center rounded-md bg-accent px-[16px] text-[15px] font-semibold text-on-accent active:opacity-80" onClick={() => { void app.runInstall(); }}>설치</button>}
      <button type="button" className="inline-flex min-h-[44px] min-w-[44px] flex-none items-center justify-center rounded-md border-0 bg-transparent text-ink-2 [@media(hover:hover)]:hover:bg-hover active:bg-hover" aria-label="닫기" onClick={close}>
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
      </button>
    </div>
  </section>;
}
