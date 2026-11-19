// 비로그인 공유 미리보기: ?notice=<id>로 들어온 사람이 그 공지 한 건만 본다. 목록·검색·다른 공지로 가는 길은 없다.
// 로그인 유도는 아래에서 올라오는 시트(설치·알림 패널과 같은 방식). 규칙은 스킬 share-deeplink-preview.
import { useEffect, useState } from 'react';
import type { AppController } from './app-controller';
import { APP_NAME } from './brand';
import { safeUrl, todayKst } from './data';
import { GoogleG, LoginStatus } from './login-screen';

const ICON_BUTTON = 'grid size-[44px] flex-none place-items-center rounded-md border border-line bg-surface text-ink active:bg-hover [@media(hover:hover)]:hover:bg-hover min-[720px]:size-[40px]';
const Glyph = ({ name }: { name: string }) => <svg className="size-[22px] flex-none fill-none stroke-current [stroke-width:1.75] [stroke-linecap:round] [stroke-linejoin:round]" aria-hidden="true"><use href={`icons/sprite.svg#${name}`} /></svg>;
// 시트와 닫은 뒤 줄은 화면 바닥에 붙는 전체 폭 바이고, 안의 내용만 본문 열(PC 680px, 1080px 이상은 상세의 안쪽 32px까지)에 맞춘다.
// 떠 있는 카드는 본문과 사이가 떠 어색해서 PC에서도 바닥에 붙인다.
const DOCK = 'fixed inset-x-0 bottom-0 z-[4] border-t border-ink-3 bg-surface shadow-lg max-[719px]:rounded-t-lg';
const DOCK_COLUMN = 'mx-auto w-full max-w-[680px] px-[20px] min-[720px]:px-[var(--gutter)] min-[1080px]:px-[calc(var(--gutter)+32px)]';
const SIGN_IN_SHEET = '로그인하면 공지를 저장하고 마감 알림을 받아요';
const SIGN_IN_BAR = '로그인하면 저장하고 알림 받아요';
const GOOGLE_BUTTON = 'inline-flex items-center justify-center gap-[10px] rounded-md border border-[light-dark(#747775,#8E918F)] bg-[light-dark(#FFFFFF,#131314)] px-[16px] text-[16px] font-semibold text-[light-dark(#1F1F1F,#E3E3E3)] [@media(hover:hover)]:[&:hover:not(:disabled)]:bg-[light-dark(#F2F2F2,#1E1F20)] [&:active:not(:disabled)]:bg-[light-dark(#F2F2F2,#1E1F20)] disabled:opacity-70';

/** 시트와 낮은 줄이 같이 쓰는 로그인 단추(모양과 이름이 같다). */
function SignInButton({ app, className }: { app: AppController; className: string }) {
  const busy = app.authBusy;
  return <button type="button" className={`${GOOGLE_BUTTON} ${className}`} disabled={busy} aria-busy={busy} onClick={() => { void app.signIn(); }}>
    {busy ? null : <GoogleG />}
    <span>{busy ? 'Google로 이동하고 있어요' : 'Google로 로그인'}</span>
  </button>;
}

function LoginSheet({ app, onClose }: { app: AppController; onClose: () => void }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return <section className={`login-sheet ${DOCK} [animation:install-rise_240ms_ease-out_both] motion-reduce:animate-none`} aria-label="로그인 안내">
    <div className={`${DOCK_COLUMN} pt-[12px] pb-[calc(16px+env(safe-area-inset-bottom))]`}>
      <div className="flex items-center gap-[8px]">
        <p className="m-0 min-w-0 flex-1 text-[17px] leading-[24px] font-bold text-ink break-keep text-pretty">{SIGN_IN_SHEET}</p>
        <button type="button" className="-mr-[12px] grid size-[44px] flex-none place-items-center rounded-pill border-0 bg-transparent text-ink-2 active:bg-hover [@media(hover:hover)]:hover:bg-hover" aria-label="닫기" onClick={onClose}><Glyph name="close" /></button>
      </div>
      <SignInButton app={app} className="mt-[4px] min-h-[48px] w-full" />
      {app.authError ? <p className="m-0 mt-[12px] text-center text-[14px] leading-[20px] text-danger" role="alert">{app.authError}</p> : null}
    </div>
  </section>;
}

export function NoticePreview({ app }: { app: AppController }) {
  const [sheet, setSheet] = useState(true);
  const state = app.preview;
  if (state.status === 'idle' || state.status === 'loading') return <LoginStatus />;
  if (state.status === 'error' || !state.data) return <div className="flex min-h-dvh flex-col items-center justify-center gap-[16px] bg-bg px-[24px] text-center">
    <p className="m-0 text-[15px] leading-[22px] text-ink-2" role="alert">공지를 불러오지 못했어요</p>
    <button type="button" className="inline-flex min-h-[48px] items-center justify-center rounded-md border-0 bg-accent px-[24px] text-[16px] font-semibold text-on-accent active:opacity-80" onClick={() => { void app.loadPreview(); }}>다시 불러오기</button>
  </div>;
  const { notice, source, body } = state.data;
  return <div className="notice-preview min-h-dvh bg-bg">
    <header className="glass sticky top-0 z-[2] flex items-center gap-[8px] border-b border-line pt-[calc(10px_+_env(safe-area-inset-top))] pr-[var(--gutter)] pb-[10px] pl-[var(--gutter)] min-[720px]:px-[24px]">
      <svg className="size-[32px] flex-none" aria-hidden="true"><use href="icons/sprite.svg#brand" /></svg>
      <span className="min-w-0 flex-1 truncate text-[17px] font-bold tracking-[-0.02em] text-ink">{APP_NAME}</span>
      <button type="button" className={ICON_BUTTON} aria-label="저장하기" title="저장하기" onClick={() => setSheet(true)}><Glyph name="bookmark" /></button>
      <button type="button" className={ICON_BUTTON} aria-label="공유하기" title="공유하기" onClick={() => { void app.share(notice); }}><Glyph name={app.linkCopied ? 'check' : 'share'} /></button>
    </header>
    <main className="mx-auto w-full max-w-[680px] px-[var(--gutter)] pt-[16px] pb-[calc(200px+env(safe-area-inset-bottom))] min-[720px]:pt-[24px]">
      <notice-detail-screen model={{ notice, source, today: todayKst(), body, interests: [], ai: null, rule: null, notified: false, retry: () => { void app.loadPreview(); } }} />
      <a className="mt-[20px] inline-flex min-h-[48px] w-full items-center justify-center rounded-md border border-line bg-surface px-[16px] text-[16px] font-semibold text-ink no-underline active:bg-hover [@media(hover:hover)]:hover:bg-hover min-[720px]:w-auto min-[1080px]:ml-[32px]" href={safeUrl(notice.url)} target="_blank" rel="noopener noreferrer">원문 열기</a>
    </main>
    {sheet ? <LoginSheet app={app} onClose={() => setSheet(false)} /> : <div className={`login-bar ${DOCK}`}>
      <div className={`${DOCK_COLUMN} flex items-center gap-[12px] pt-[8px] pb-[calc(8px+env(safe-area-inset-bottom))]`}>
        <p className="m-0 min-w-0 flex-1 text-[14px] leading-[20px] font-medium text-ink break-keep">{SIGN_IN_BAR}</p>
        <SignInButton app={app} className="min-h-[44px] flex-none" />
      </div></div>}
    </div>;
}
