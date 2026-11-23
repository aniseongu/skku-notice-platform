import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { TABS, type AppController } from './app-controller';
import { APP_NAME } from './brand';
import { todayKst } from './data';
import { isInternshipNotice } from './graduation-assessment';
import { isInAppBrowser } from './install-hint';
import { LoginStatus } from './login-screen';
import { NoticeExample } from './notice-example';
import { BOTTOM_SHEET, BOTTOM_SHEET_MOTION, BOTTOM_SHEET_PADDING, HEADER_ICON_BUTTON, NOTE_TEXT, SETTINGS_ACTION, SHEET_GHOST_BUTTON, SHEET_SOLID_BUTTON } from './cls';
import { Brand, DESKTOP_GRID, DesktopDetail, Icon, NoticeSidebar, ReadingHeader, SaveButton, ShareButton, SharedNoticeEmpty, SHARED_COLUMNS, THREE_COLUMNS, TOPBAR } from './notice-layout';

const dismissKey = 'platform:shared-login-dismissed';
const benefits = '마감 3일 전과 하루 전에 알려 드리고, 관심 게시판의 새 공지도 바로 알려 드려요';
const reasons = {
  all: '로그인하면 내 게시판 공지를 모아 볼 수 있어요',
  intern: '로그인하면 인턴 공고를 한곳에서 볼 수 있어요',
  coop: '로그인하면 모집 중인 현장실습을 볼 수 있어요',
  saved: '로그인하면 저장한 공지를 모아 볼 수 있어요',
};

function signInDismissed(): boolean {
  try { return sessionStorage.getItem(dismissKey) === '1'; }
  catch { return false; }
}

function SignInAction({ app, focusTarget }: { app: AppController; focusTarget: React.RefObject<HTMLElement | null> }) {
  const [help, setHelp] = useState(false);
  const ua = navigator.userAgent;
  const inApp = isInAppBrowser(ua);
  const kakaoAndroid = inApp && /Android/i.test(ua) && /KAKAOTALK/i.test(ua);
  const actionClass = `${SHEET_SOLID_BUTTON} disabled:opacity-60`;
  if (kakaoAndroid) return <a ref={(node) => { focusTarget.current = node; }} className={`${actionClass} no-underline`}
    href={`kakaotalk://web/openExternal?url=${encodeURIComponent(location.href)}`}>브라우저에서 열기</a>;
  return <>
    <button ref={(node) => { focusTarget.current = node; }} type="button" className={actionClass} disabled={app.authBusy}
      aria-expanded={inApp ? help : undefined} aria-busy={app.authBusy}
      onClick={() => { if (inApp) setHelp((open) => !open); else void app.signIn(); }}>
      {inApp ? '브라우저에서 열기' : app.authBusy ? 'Google로 이동하고 있어요' : 'Google로 계속하기'}
    </button>
    {inApp && help ? <p className={`${NOTE_TEXT} mt-[8px]`} role="status">앱 메뉴에서 ‘다른 브라우저로 열기’를 눌러 주세요.</p> : null}
    {app.authError ? <p className="m-0 mt-[8px] text-[14px] text-danger" role="alert">{app.authError}</p> : null}
  </>;
}

export function NoticePreview({ app }: { app: AppController }) {
  const [sheet, setSheet] = useState(() => !signInDismissed());
  const [pickedTab, setPickedTab] = useState<(typeof TABS)[number]['id'] | null>(null);
  const primary = useRef<HTMLElement>(null);
  const reopen = useRef<HTMLButtonElement>(null);
  const moveFocus = useRef(false);
  const desktop = app.shareWide;
  const close = () => {
    moveFocus.current = true;
    try { sessionStorage.setItem(dismissKey, '1'); } catch { /* 저장할 수 없어도 이번 화면은 닫는다. */ }
    setSheet(false);
  };
  const askSignIn = () => {
    if (desktop || sheet) { primary.current?.focus({ preventScroll: false }); return; }
    moveFocus.current = true;
    setSheet(true);
  };
  useLayoutEffect(() => {
    if (!moveFocus.current || desktop) return;
    moveFocus.current = false;
    (sheet ? primary : reopen).current?.focus({ preventScroll: true });
  }, [sheet, desktop]);
  useEffect(() => {
    if (desktop || !sheet) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') close(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [desktop, sheet]);

  const state = app.preview;
  if (state.status === 'idle' || state.status === 'loading') return <LoginStatus />;
  const data = state.data;
  const tab = pickedTab ?? (data?.coop ? 'coop' : data?.external ? 'intern' : 'all');
  const actions = data ? <><SaveButton app={app} notice={data.notice} onSave={askSignIn} /><ShareButton app={app} notice={data.notice} /></> : null;
  const detail = data ? <notice-detail-screen model={{
    notice: data.notice, source: data.source, body: data.body, today: todayKst(), interests: [], ai: null, rule: null, notified: false, coop: data.coop,
    retry: () => { void app.loadPreview(); },
    guest: { onSignIn: askSignIn, graduation: isInternshipNotice(data.notice, data.external || data.coop) },
  }} /> : <SharedNoticeEmpty guest failed={state.status === 'error'} onAction={state.status === 'error' ? () => { void app.loadPreview(); } : app.leavePreview} />;

  if (desktop) return <div className={`app notice-preview ${DESKTOP_GRID} ${THREE_COLUMNS} ${SHARED_COLUMNS}`}>
    <NoticeSidebar tabs={TABS} active={tab} onPick={setPickedTab} />
    <main className="list-pane min-h-0 overflow-y-auto border-r border-line bg-surface">
      <header className={TOPBAR}><h1 className="text-[21px] leading-[28px]">{TABS.find((item) => item.id === tab)?.label}</h1></header>
      <section aria-label="로그인 안내" className="mx-auto w-full max-w-[440px] p-[24px] min-[1080px]:pt-[40px]">
        <NoticeExample idPrefix="shared-login" />
        <p className="m-0 mt-[20px] text-[16px] leading-[24px] font-medium text-ink break-keep" aria-live="polite">{pickedTab ? reasons[tab] : benefits}</p>
        <SignInAction app={app} focusTarget={primary} />
      </section>
    </main>
    <DesktopDetail shown shared header={<>
      <button className={HEADER_ICON_BUTTON} type="button" aria-label="상세 칸 닫기" onClick={app.leavePreview}><Icon name="close" /></button>
      <div className="detail-actions flex gap-[8px]">{actions}</div>
    </>}>{detail}</DesktopDetail>
  </div>;

  return <div className="notice-preview min-h-dvh bg-bg">
    <ReadingHeader onBack={app.leavePreview} backLabel="뒤로 가기" actions={actions ?? <Brand className="size-[28px] text-accent" />} />
    <main className={`reading px-[var(--gutter)] pt-[16px] ${sheet ? 'pb-[calc(310px+env(safe-area-inset-bottom))]' : 'pb-[calc(68px+env(safe-area-inset-bottom))]'}`}>{detail}</main>
    {sheet ? <section className={`login-sheet z-[4] ${BOTTOM_SHEET} ${BOTTOM_SHEET_PADDING} ${BOTTOM_SHEET_MOTION}`} aria-label="로그인 안내">
      <div className="flex items-start gap-[12px]">
        <img src="icon-192.png" alt="" className="size-[48px] flex-none rounded-md border border-line" />
        <div className="min-w-0 flex-1 pt-[2px]">
          <p className="m-0 text-[18px] leading-[25px] font-bold text-ink">{data ? '로그인하고 이 공지를 저장해요' : '로그인하고 다른 공지를 봐요'}</p>
          <p className="m-0 mt-[4px] text-[15px] leading-[22px] text-ink-2 break-keep">{benefits}</p>
        </div>
      </div>
      <SignInAction app={app} focusTarget={primary} />
      <button type="button" className={SHEET_GHOST_BUTTON} onClick={close}>다음에 할게요</button>
    </section> : <div className={`login-bar z-[4] ${BOTTOM_SHEET} flex items-center justify-end px-[20px] pb-[env(safe-area-inset-bottom)]`}>
      <button ref={reopen} type="button" className={`${SETTINGS_ACTION} underline underline-offset-4`} onClick={askSignIn}>로그인</button>
    </div>}
  </div>;
}
