// 비로그인 공유 미리보기: ?notice=<id>로 들어온 사람이 그 공지 한 건만 본다. 목록·검색·다른 공지로 가는 길은 없다.
// 로그인 유도는 아래에서 올라오는 시트(설치·알림 패널과 같은 방식). 규칙은 스킬 share-deeplink-preview.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { AppController } from './app-controller';
import { APP_NAME } from './brand';
import { safeUrl, todayKst } from './data';
import { LoginStatus } from './login-screen';
import { BOTTOM_SHEET_CARD, BOTTOM_SHEET_MOTION, BOTTOM_SHEET_PADDING, HEADER_ICON_BUTTON, SHEET_GHOST_BUTTON, SHEET_SOLID_BUTTON, SOLID_BUTTON, SETTINGS_ACTION } from './cls';

const Glyph = ({ name }: { name: string }) => <svg className="size-[22px] flex-none fill-none stroke-current [stroke-width:1.75] [stroke-linecap:round] [stroke-linejoin:round]" aria-hidden="true"><use href={`icons/sprite.svg#${name}`} /></svg>;

export function NoticePreview({ app }: { app: AppController }) {
  const [sheet, setSheet] = useState(true);
  const primary = useRef<HTMLButtonElement>(null);
  const reopen = useRef<HTMLButtonElement>(null);
  const moveFocus = useRef(false);
  const changeSheet = (open: boolean) => { moveFocus.current = true; setSheet(open); };
  useLayoutEffect(() => {
    if (!moveFocus.current) return;
    moveFocus.current = false;
    (sheet ? primary : reopen).current?.focus({ preventScroll: true });
  }, [sheet]);
  useEffect(() => {
    if (!sheet || app.preview.status !== 'ready') return;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') changeSheet(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [sheet, app.preview.status]);
  const state = app.preview;
  if (state.status === 'idle' || state.status === 'loading') return <LoginStatus />;
  if (state.status === 'error' || !state.data) return <div className="flex min-h-dvh flex-col items-center justify-center gap-[16px] bg-bg px-[24px] text-center">
    <p className="m-0 text-[15px] leading-[22px] text-ink-2" role="alert">공지를 불러오지 못했어요</p>
    <button type="button" className={SOLID_BUTTON} onClick={() => { void app.loadPreview(); }}>다시 불러오기</button>
  </div>;
  const { notice, source, body } = state.data;
  return <div className="notice-preview min-h-dvh bg-bg">
    <header className="glass sticky top-0 z-[2] flex items-center gap-[8px] border-b border-line pt-[calc(10px_+_env(safe-area-inset-top))] pr-[var(--gutter)] pb-[10px] pl-[var(--gutter)] min-[720px]:px-[24px]">
      <svg className="size-[32px] flex-none" aria-hidden="true"><use href="icons/sprite.svg#brand" /></svg>
      <span className="min-w-0 flex-1 truncate text-[17px] font-bold tracking-[-0.02em] text-ink">{APP_NAME}</span>
      <button type="button" className={HEADER_ICON_BUTTON} aria-label="저장하기" title="저장하기" onClick={() => { if (sheet) primary.current?.focus({ preventScroll: true }); else changeSheet(true); }}><Glyph name="bookmark" /></button>
      <button type="button" className={HEADER_ICON_BUTTON} aria-label="공유하기" title="공유하기" onClick={() => { void app.share(notice); }}><Glyph name={app.linkCopied ? 'check' : 'share'} /></button>
    </header>
    <main className={`mx-auto w-full max-w-[680px] px-[var(--gutter)] pt-[16px] min-[720px]:pt-[24px] ${sheet ? 'pb-[calc(240px+env(safe-area-inset-bottom))]' : 'pb-[calc(72px+env(safe-area-inset-bottom))]'}`}>
      <notice-detail-screen model={{ notice, source, today: todayKst(), body, interests: [], ai: null, rule: null, notified: false, retry: () => { void app.loadPreview(); } }} />
      <a className="mt-[12px] inline-flex min-h-[44px] items-center rounded-md px-0 text-[15px] font-medium text-ink-2 underline underline-offset-4 active:bg-hover [@media(hover:hover)]:hover:bg-hover min-[1080px]:ml-[32px]" href={safeUrl(notice.url)} target="_blank" rel="noopener noreferrer">원문 열기</a>
    </main>
    {sheet ? <section className={`login-sheet ${BOTTOM_SHEET_CARD} ${BOTTOM_SHEET_PADDING} ${BOTTOM_SHEET_MOTION} min-[720px]:pb-[20px]`} aria-label="로그인 안내">
      <div className="flex items-start gap-[12px]">
        <img src="icon-192.png" alt="" className="size-[48px] flex-none rounded-md border border-line" />
        <div className="min-w-0 flex-1 pt-[2px]">
          <p className="m-0 text-[18px] leading-[25px] font-bold text-ink">로그인하고 공지를 저장해요</p>
          <p className="m-0 mt-[4px] text-[15px] leading-[22px] text-ink-2 break-keep">저장한 공지의 마감 알림도 받을 수 있어요</p>
          {app.authError ? <p className="m-0 mt-[8px] text-[14px] leading-[21px] text-danger" role="alert">{app.authError}</p> : null}
        </div>
      </div>
      <button ref={primary} type="button" className={`${SHEET_SOLID_BUTTON} disabled:opacity-60`} disabled={app.authBusy} aria-busy={app.authBusy} onClick={() => { void app.signIn(); }}>
        {app.authBusy ? 'Google로 이동하고 있어요' : 'Google로 로그인'}
      </button>
      <button type="button" className={SHEET_GHOST_BUTTON} onClick={() => changeSheet(false)}>다음에 할게요</button>
    </section> : <div className={`login-bar ${BOTTOM_SHEET_CARD} flex items-center justify-between gap-[12px] px-[20px] pt-[4px] pb-[calc(4px+env(safe-area-inset-bottom))] min-[720px]:pb-[4px]`}>
      <p className="m-0 text-[14px] font-medium text-ink">저장한 공지의 마감 알림도 받아요</p>
      <button ref={reopen} type="button" className={`${SETTINGS_ACTION} flex-none underline underline-offset-4`} onClick={() => changeSheet(true)}>로그인</button>
    </div>}
  </div>;
}
