import { BOTTOM_SHEET, BOTTOM_SHEET_MOTION, BOTTOM_SHEET_PADDING, SHEET_GHOST_BUTTON, SHEET_SOLID_BUTTON } from './cls';
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
  return <section className={`install-banner z-[4] ${BOTTOM_SHEET} ${BOTTOM_SHEET_PADDING} ${BOTTOM_SHEET_MOTION} min-[720px]:hidden`} aria-label="앱 설치">
    <div className="flex items-start gap-[12px]">
      <img src="icon-192.png" alt="" className="size-[48px] flex-none rounded-md border border-line" />
      <div className="min-w-0 flex-1 pt-[2px]">
        <p className="m-0 text-[18px] leading-[25px] font-bold text-ink break-keep">홈 화면에 성공 추가하기</p>
        <p className="m-0 mt-[4px] text-[15px] leading-[22px] text-ink-2 break-keep">앱처럼 바로 열어 공지와 알림을 확인해요</p>
      </div>
    </div>
    {hint ? <p className="install-hint m-0 mt-[16px] rounded-md bg-sunken px-[16px] py-[14px] text-[15px] leading-[22px] text-ink-2 break-keep">{hint.lead}<b className="font-semibold text-ink">{hint.action}</b>{hint.tail}</p> : null}
    {hint ? null : <button type="button" className={SHEET_SOLID_BUTTON} onClick={() => { void app.runInstall(); }}>홈 화면에 추가</button>}
    {/* 설치 단추가 있으면 닫기는 보조 행동이라 연한 채움(TDS weak), 안내만 있으면 하나뿐인 행동이라 진한 채움(TDS fill). 테두리 없는 글자 단추는 눌리는 자리가 안 보인다. */}
    <button type="button" className={hint ? SHEET_SOLID_BUTTON : SHEET_GHOST_BUTTON} onClick={close}>{hint ? '확인했어요' : '다음에 할게요'}</button>
  </section>;
}
