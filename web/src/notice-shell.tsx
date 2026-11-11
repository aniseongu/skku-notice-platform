// 앱 화면. 상태와 동작은 AppController가 맡고, 이 파일은 구독해서 그리기만 한다.
// 그림자 DOM을 쓰지 않아 전역 토큰과 글꼴을 그대로 받는다. 학교 글자는 React가 자동으로 이스케이프한다.
import { aiConnectModel } from './ai-connect';
import { visibleTracks } from './graduation-assessment';
import { Fragment, useEffect, useRef, useSyncExternalStore, type ReactNode } from 'react';
import { applyBoardOrder } from './board-order';
import { type IconName, type Notice, boardName, keywordMatches, deadlineGroup, deadlinePassed, postedGroup, safeUrl, todayKst } from './data';
import { APP_NAME } from './brand';
import { CHECKBOX, CHIP, CHIPS, CHIP_ADD } from './cls';
import { authClient } from './auth';
import { keywordCounts } from './keyword-counts';
import { type AppController, STALE_MS, TABS, remember, settingsTitle } from './app-controller';
import type { UserProfile } from './profile';
import { Avatar } from './ui';
import { Onboarding } from './onboarding';
import { LoginScreen, LoginStatus } from './login-screen';
import type { CanvasMode } from './devices';
import { bodyInterests, withMyDeadline } from './notice-view';
import './platform-settings';
import { ROW_LAYOUT } from './notice-rows';
import './notice-detail';

// 선택 모드의 단추: 터치 44px(넓은 화면 36px), 주 행동은 채운 단추, 보조는 옅은 면, 끝내기는 글자만.
const SELECT_BTN = 'inline-flex items-center justify-center gap-[6px] [&_.i]:size-[18px] min-h-[44px] rounded-[10px] px-[14px] text-[15px] whitespace-nowrap min-[720px]:min-h-[40px] min-[720px]:text-[14px]';

const SHORTCUTS: { group: string; items: [string, string[]][] }[] = [
  { group: '목록', items: [['다음 공지', ['J']], ['이전 공지', ['K']], ['원문 열기', ['Enter']], ['저장하기', ['S']], ['상세 칸 닫기', ['Esc']]] },
  { group: '이동', items: [['성대 공지', ['1']], ['인턴 공고', ['2']], ['저장', ['3']], ['검색', ['/']]] },
  { group: '그 밖', items: [['공지 다시 가져오기', ['R']], ['설정 닫기', ['Esc']], ['단축키 보기', ['?']]] },
];

// 단축키 표시(Primer KeybindingHint 방식: 키 하나에 kbd 하나, 사방 1px 테두리). 화면 낭독기에는 aria-keyshortcuts로 알린다.
// 마우스와 키보드가 있는 기기에서만 보인다(휴대폰에는 단축키가 없다). 그 조건은 base.css의 .kbd-group 한 줄이 맡는다.
const KBD = 'kbd inline-flex h-[20px] min-w-[20px] items-center justify-center rounded-[4px] border bg-transparent px-[5px] [font:500_11px/1_var(--font)] tracking-[0]';
const KBD_IDLE = 'border-line text-ink-3';
const KBD_ON_SOLID = 'border-[color-mix(in_oklch,var(--on-accent)_40%,transparent)] text-on-accent';
const Kbd = ({ keys, className = '', onSolid = false }: { keys: string[]; className?: string; onSolid?: boolean }) =>
  <span className={`kbd-group inline-flex gap-[4px] ${className}`} aria-hidden="true">{keys.map((key) => <kbd className={`${KBD} ${onSolid ? KBD_ON_SOLID : KBD_IDLE}`} key={key}>{key}</kbd>)}</span>;

const Icon = ({ name }: { name: IconName }) => <svg className="i size-[22px] flex-none fill-none stroke-current [stroke-width:1.75] [stroke-linecap:round] [stroke-linejoin:round]" aria-hidden="true"><use href={`icons/sprite.svg#${name}`} /></svg>;
const GearIcon = () => <svg className="i size-[22px] flex-none fill-none stroke-current [stroke-width:1.75] [stroke-linecap:round] [stroke-linejoin:round]" aria-hidden="true" viewBox="0 0 24 24"><circle cx="12" cy="12" r="3" />
  <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></svg>;

const Brand = ({ className = 'brand-mark' }: { className?: string }) => <svg className={className} aria-hidden="true"><use href="icons/sprite.svg#brand" /></svg>;

// 커스텀 엘리먼트 경계의 model은 속성으로 전달한다(React 19는 요소에 있는 속성은 property로 넣는다).
type ModelElement = { model?: unknown };
declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      'notice-rows-screen': ModelElement & React.HTMLAttributes<HTMLElement>;
      'notice-detail-screen': ModelElement & React.HTMLAttributes<HTMLElement>;
      'platform-settings-screen': ModelElement & React.HTMLAttributes<HTMLElement>;
    }
  }
}

export function NoticeShell({ app }: { app: AppController }) {
  useSyncExternalStore(app.subscribe, app.getVersion);
  // 화면이 반영된 뒤에 포커스 이동 같은 후속 작업이 풀리게 알린다.
  useEffect(() => { app.commit(); });
  useEffect(() => {
    document.title = app.gated ? `로그인 - ${APP_NAME}` : app.authReady && app.view === 'settings' ? `${settingsTitle()} - ${APP_NAME}` : APP_NAME;
  });

  if (!app.authReady) return <LoginStatus text="로그인 상태를 확인하고 있어요." />;
  if (app.gated) return <LoginScreen app={app} />;
  const filtered = app.filtered();
  const counts = Object.fromEntries(TABS.map((t) => [t.id, t.id === 'saved'
    ? app.filtered(app.savedNotices()).length : app.byTab(filtered, t.id).length]));
  const list = app.visible();
  const settings = app.view === 'settings';
  const keywordScope = app.tab() === 'saved' ? app.savedNotices() : app.notices.filter((notice) =>
    app.isExternal(notice) === (app.tab() === 'intern') && (!notice.deadline || !deadlinePassed(notice.deadline)));
  const board = app.activeBoard();
  const keywordTotals = keywordCounts(keywordScope.filter((notice) => board === 'all' || notice.source_id === board),
    app.keywords, (notice) => app.interests(notice));
  const title = settings ? settingsTitle() : app.keyword ? app.keyword : TABS.find((t) => t.id === app.view)!.label;
  const selected = settings ? undefined : list.find((n) => n.id === app.selectedId) ?? (app.isWide ? list[0] : undefined);
  app.shownId = selected?.id ?? null;
  const reading = !app.isWide && !settings
    ? app.notices.find((n) => n.id === app.openedId) ?? list.find((n) => n.id === app.openedId) : undefined;
  // 첫 로그인 설정 창이 떠 있는 동안 뒤쪽 화면은 비활성으로 두어 Tab 키 포커스와 화면 낭독기가 새지 않게 한다.
  const onboarding = app.needsOnboarding();
  const noDetail = app.isWide && (!app.detailOpen || !selected);
  const classes = [settings ? 'is-settings' : '', noDetail ? 'no-detail' : '', reading ? 'is-reading' : ''].join(' ');
  // 1080px 이상에서는 목록·상세 두 칸, 설정이거나 상세를 닫았으면 한 칸이다.
  const oneColumn = settings || noDetail;

  return <>
    <div className="wco-bar" aria-hidden="true"><Brand />{APP_NAME}</div>
    <div className={`app min-[720px]:grid min-[720px]:h-[calc(100dvh-var(--wco-h))] min-[720px]:grid-cols-[248px_minmax(0,1fr)] ${oneColumn ? 'min-[1080px]:grid-cols-[248px_minmax(0,1fr)]' : 'min-[1080px]:grid-cols-[248px_minmax(0,680px)_minmax(400px,1fr)]'} ${classes}`} inert={onboarding}>
      <aside className="sidebar hidden border-r border-line bg-mica px-[12px] pt-0 pb-[12px] min-[720px]:flex min-[720px]:min-h-0 min-[720px]:flex-col min-[720px]:overflow-y-auto" aria-label="탐색">
        <div className="pane-head brand min-[720px]:-mx-[12px] min-[720px]:mt-0 min-[720px]:mb-[12px] min-[720px]:flex min-[720px]:h-[var(--head-h)] min-[720px]:flex-none min-[720px]:items-center min-[720px]:gap-[8px] min-[720px]:border-b min-[720px]:border-line min-[720px]:px-[24px] min-[720px]:text-[17px] min-[720px]:font-bold min-[720px]:tracking-[-0.02em] min-[720px]:[&_.brand-mark]:text-accent min-[720px]:[&_.brand-mark]:size-[32px]"><Brand />{APP_NAME}</div>
        <nav className="side-group flex flex-col gap-[1px]" aria-label="보기">
          {TABS.map((t, index) => <SideItem key={t.id} label={t.label} count={counts[t.id]} active={app.view === t.id}
            onClick={() => app.setView(t.id)} shortcut={String(index + 1)} icon={t.icon} />)}
        </nav>
        <SideGroup app={app} id="keywords" title="관심 키워드" count={keywordTotals.total}>
          {app.keywords.map((word) => <SideItem key={word} label={word} count={keywordTotals.counts[word]}
            active={app.keyword === word && !settings} onClick={() => app.setKeyword(app.keyword === word ? null : word)}
            ariaLabel={`${word}, 공지 ${keywordTotals.counts[word]}개`} />)}
          <button type="button" className={`side-item add ${SIDE_ITEM} text-ink-3 ${SIDE_ITEM_IDLE}`} onClick={() => app.openSettings('keywords')}>{app.keywords.length ? '키워드 관리하기' : '키워드 추가하기'}</button>
        </SideGroup>
        <SideGroup app={app} id="boards" title={app.tab() === 'intern' ? '인턴 공고 사이트' : '게시판'} count={app.tabSources().length}>
          {boardChoices(app).map((b) => <SideItem key={b.id} label={b.label} count={null} active={app.activeBoard() === b.id && !settings}
            onClick={() => { app.setBoard(b.id); if (settings) app.leaveSettings(); }} />)}
          {app.tab() === 'intern' ? null : <button type="button" className={`side-item add ${SIDE_ITEM} text-ink-3 ${SIDE_ITEM_IDLE}`} onClick={() => app.openSettings('notifications')}>게시판 더 고르기</button>}
        </SideGroup>
        <div className="side-foot mt-auto flex flex-col gap-[1px] pt-[12px]">
          <SideItem label="설정" count={null} active={settings} onClick={app.openSettingsHome} />
        </div>
      </aside>

      <main className={`list-pane min-[720px]:min-h-0 min-[720px]:overflow-y-auto min-[720px]:bg-surface min-[720px]:pb-[32px] ${app.selecting ? 'max-[719px]:pb-[calc(88px+env(safe-area-inset-bottom))]' : 'max-[719px]:pb-[calc(var(--tabbar-h)+24px+env(safe-area-inset-bottom))]'} ${noDetail ? '' : 'min-[1080px]:border-r min-[1080px]:border-line'}`}>
        {reading ? <ReadingView app={app} notice={reading} /> : <>
          <div className="navigation-head contents">
            <header className={`${TOPBAR} ${settings ? TOPBAR_SETTINGS : TOPBAR_FEED}`}>
              {settings ? <button type="button" className="icon-button grid place-items-center flex-none size-[44px] border-0 rounded-pill bg-transparent text-ink-2 active:bg-sunken disabled:text-ink-3 min-[720px]:size-[36px] min-[720px]:rounded-sm [@media(hover:hover)]:min-[720px]:[&:hover:not(:disabled)]:bg-hover-soft narrow-only back -ml-[12px] min-[720px]:hidden!" aria-label={app.settingsSection && !app.settingsLeavesDirectly ? '설정으로 돌아가기' : '설정 닫기'} onClick={app.backSettings}><Icon name="back" /></button> : null}
              {settings ? null : <Brand className="brand-mark narrow-only min-[720px]:hidden! mr-[8px] h-[36px] w-[36px] flex-none text-accent" />}
              <div className={TOPBAR_TEXT}>
                <h1 className={`${TOPBAR_H1} ${settings ? '' : 'max-[719px]:text-[21px] max-[719px]:leading-[28px] max-[719px]:font-extrabold'}`}>{title}</h1>
                {settings ? null : <UpdatedLine app={app} count={list.length} pending={app.tab() === 'saved' ? 0 : app.pendingCount(list)} />}
              </div>
              {settings ? null : <>
                <label className="search flex h-[44px] items-center gap-[8px] rounded-md bg-sunken px-[16px] text-ink-3 focus-within:outline-2 focus-within:outline-accent [&_.i]:size-[20px] [&_input]:h-full [&_input]:min-w-0 [&_input]:flex-1 [&_input]:border-0 [&_input]:bg-transparent [&_input]:text-ink [&_input]:[outline:0] [&_input]:placeholder:text-ink-3 wide-only max-[719px]:hidden min-[720px]:flex min-[720px]:h-[36px] min-[720px]:min-w-[120px] min-[720px]:w-[260px] min-[720px]:flex-[0_1_260px] min-[720px]:px-[12px] min-[720px]:py-0"><Icon name="search" />
                  <input type="search" placeholder="공지 찾기" autoComplete="off" aria-label="공지 검색" aria-keyshortcuts="/" value={app.query}
                    onChange={(event) => { app.query = event.currentTarget.value; app.selectedId = null; app.selectedReads = []; }} />
                  {app.query ? null : <Kbd keys={['/']} className="ml-auto" />}</label>
                {app.detailOpen || !selected ? null : <button type="button" className="icon-button grid place-items-center flex-none size-[44px] border-0 rounded-pill bg-transparent text-ink-2 active:bg-sunken disabled:text-ink-3 min-[720px]:size-[36px] min-[720px]:rounded-sm [@media(hover:hover)]:min-[720px]:[&:hover:not(:disabled)]:bg-hover-soft wide-only max-[719px]:hidden min-[720px]:flex" aria-label="상세 칸 열기" title="상세 칸 열기"
                  onClick={() => app.setDetail(true)}><Icon name="panel" /></button>}
                <button type="button" className="icon-button grid place-items-center flex-none size-[44px] border-0 rounded-pill bg-transparent text-ink-2 active:bg-sunken disabled:text-ink-3 min-[720px]:size-[36px] min-[720px]:rounded-sm [@media(hover:hover)]:min-[720px]:[&:hover:not(:disabled)]:bg-hover-soft" aria-label="공지 다시 가져오기" title="공지 다시 가져오기 (R)" aria-keyshortcuts="r"
                  disabled={app.loading} onClick={() => { void app.collectNow(); }}><Icon name="refresh" /></button>
              </>}
              {settings ? null : <button type="button" className="icon-button grid place-items-center flex-none size-[44px] border-0 rounded-pill bg-transparent text-ink-2 active:bg-sunken disabled:text-ink-3 min-[720px]:size-[36px] min-[720px]:rounded-sm [@media(hover:hover)]:min-[720px]:[&:hover:not(:disabled)]:bg-hover-soft narrow-only min-[720px]:hidden!" aria-label="설정" onClick={app.openSettingsHome}><GearIcon /></button>}
              {settings ? <button type="button" className="icon-button grid place-items-center flex-none size-[44px] border-0 rounded-pill bg-transparent text-ink-2 active:bg-sunken disabled:text-ink-3 min-[720px]:size-[36px] min-[720px]:rounded-sm [@media(hover:hover)]:min-[720px]:[&:hover:not(:disabled)]:bg-hover-soft wide-only max-[719px]:hidden min-[720px]:flex" aria-label={app.settingsSection && !app.settingsLeavesDirectly ? '설정으로 돌아가기' : '설정 닫기'} title={app.settingsSection && !app.settingsLeavesDirectly ? '설정으로 (Esc)' : '설정 닫기 (Esc)'}
                aria-keyshortcuts="Escape" onClick={app.backSettings}><Icon name="close" /></button> : null}
            </header>
          </div>

          {settings ? <platform-settings-screen model={settingsModel(app)} /> : <>
            <div className="tools narrow-only px-[var(--gutter)] pt-[4px] pb-0 min-[720px]:hidden!">
              <label className="search flex h-[44px] items-center gap-[8px] rounded-md bg-sunken px-[16px] text-ink-3 focus-within:outline-2 focus-within:outline-accent [&_.i]:size-[20px] [&_input]:h-full [&_input]:min-w-0 [&_input]:flex-1 [&_input]:border-0 [&_input]:bg-transparent [&_input]:text-ink [&_input]:[outline:0] [&_input]:placeholder:text-ink-3"><Icon name="search" />
                <input type="search" placeholder="공지 찾기" autoComplete="off" aria-label="공지 검색" value={app.query}
                  onChange={(event) => { app.query = event.currentTarget.value; app.selectedId = null; app.selectedReads = []; }} /></label>
              <div className={CHIPS} role="group" aria-label="관심 키워드">
                {app.keywords.length ? <button type="button" className={CHIP} aria-pressed={!app.keyword} onClick={() => app.setKeyword(null)}>모두</button> : null}
                {app.keywords.map((word) => <button type="button" className={CHIP} key={word} aria-pressed={app.keyword === word}
                  aria-label={`${word}, 공지 ${keywordTotals.counts[word]}개`}
                  onClick={() => app.setKeyword(app.keyword === word ? null : word)}>{word} {keywordTotals.counts[word]}</button>)}
                <button type="button" className={CHIP_ADD} onClick={() => app.openSettings('keywords')}><Icon name="plus" />키워드 추가하기</button>
              </div>
            </div>
            <ViewFilters app={app} />
            <div className="list" aria-live="polite" aria-busy={app.loading}><ListBody app={app} list={list} /></div>
          </>}
        </>}
      </main>

      <aside className={`detail-pane hidden min-[720px]:min-h-0 min-[720px]:overflow-y-auto min-[1080px]:bg-bg ${oneColumn ? '' : 'min-[1080px]:block'}`} aria-label="공지 상세">
        <div className="pane-head detail-head min-[720px]:flex min-[720px]:h-[var(--head-h)] min-[720px]:flex-none min-[720px]:items-center min-[720px]:gap-[8px] min-[720px]:border-b min-[720px]:border-line min-[1080px]:justify-between min-[1080px]:pr-[32px] min-[1080px]:pl-[20px] min-[1080px]:[&_.save-button]:size-[36px] min-[1080px]:[&_.save-button]:rounded-md min-[1080px]:[&_.solid-button]:min-h-[36px] min-[1080px]:[&_.solid-button]:px-[14px] min-[1080px]:[&_.solid-button]:text-[14px] min-[1080px]:[&_.ghost-button]:min-h-[36px] min-[1080px]:[&_.ghost-button]:px-[14px] min-[1080px]:[&_.ghost-button]:text-[14px]">
          {selected ? <button type="button" className="icon-button grid place-items-center flex-none size-[44px] border-0 rounded-pill bg-transparent text-ink-2 active:bg-sunken disabled:text-ink-3 min-[720px]:size-[36px] min-[720px]:rounded-sm [@media(hover:hover)]:min-[720px]:[&:hover:not(:disabled)]:bg-hover-soft" aria-label="상세 칸 닫기" title="상세 칸 닫기 (Esc)" aria-keyshortcuts="Escape"
            onClick={() => app.setDetail(false)}><Icon name="close" /></button> : null}
          {selected ? <div className="detail-actions min-[1080px]:flex min-[1080px]:gap-[8px]">
            <SaveButton app={app} notice={selected} />
            <button type="button" className="ghost-button inline-flex items-center justify-center min-h-[44px] px-[16px] py-0 rounded-md border border-line bg-surface text-ink text-[15px] font-semibold no-underline whitespace-nowrap select-none [-webkit-user-select:none] disabled:border-line disabled:bg-transparent disabled:text-ink-3 disabled:opacity-60" onClick={() => { void app.copyLink(selected); }}>링크 복사하기</button>
            <a className="solid-button inline-flex items-center justify-center min-h-[44px] px-[16px] py-0 rounded-md border-0 bg-accent text-on-accent text-[15px] font-semibold no-underline whitespace-nowrap select-none [-webkit-user-select:none] disabled:border disabled:border-line disabled:bg-transparent disabled:text-ink-3 disabled:opacity-60" href={safeUrl(selected.url)} target="_blank" rel="noopener" aria-keyshortcuts="Enter">원문 열기<Kbd keys={['Enter']} className="ml-[8px]" onSolid /></a></div> : null}
        </div>
        {selected ? <Detail app={app} notice={selected} /> : <p className="detail-note detail-empty m-0 grid min-h-[60%] place-items-center px-[32px] py-[24px] text-[14px] leading-[19px] text-ink-3">공지를 고르면 여기에 보여요</p>}
      </aside>
    </div>

    <nav className="tabbar glass fixed inset-x-0 bottom-0 z-[3] flex h-[calc(var(--tabbar-h)+env(safe-area-inset-bottom))] select-none border-t border-line pb-[env(safe-area-inset-bottom)] [-webkit-user-select:none] min-[720px]:hidden!" aria-label="보기" hidden={settings || Boolean(reading) || app.selecting} inert={onboarding}>
      {TABS.map((t) => <button type="button" key={t.id} className="flex min-h-[44px] min-w-[44px] flex-1 flex-col items-center justify-center gap-[2px] border-0 bg-transparent text-[13px] leading-[18px] font-medium text-ink-2 aria-[current=page]:font-bold aria-[current=page]:text-accent" aria-current={app.view === t.id ? 'page' : 'false'}
        onClick={() => app.setView(t.id)}><Icon name={t.icon} /><span>{t.label}</span></button>)}
    </nav>
    <div className="toast fixed bottom-[calc(var(--tabbar-h)+16px+env(safe-area-inset-bottom))] left-1/2 z-[4] w-max max-w-[calc(100%-32px)] [transform:translateX(-50%)] rounded-md bg-ink px-[16px] py-[12px] text-[14px] text-bg [box-shadow:var(--shadow-pop)]" role="status" hidden={!app.toast}>{app.toast}{app.toastLink ? <div className="toast-actions flex items-center justify-between gap-[12px]">
      <a className={`${TOAST_ACTION} underline`} href={app.toastLink} target={app.toastLink.startsWith('?') ? '_self' : '_blank'} rel="noopener noreferrer">{app.toastLinkLabel}</a>
      <button type="button" className={`${TOAST_ACTION} min-w-[44px] justify-center border-0 bg-transparent px-[4px] py-0`} onClick={() => { app.toast = ''; app.toastLink = null; }}>닫기</button></div> : null}</div>
    {app.shortcutsOpen ? <ShortcutsDialog app={app} /> : null}
    {onboarding ? <Onboarding app={app} /> : null}
  </>;
}

const SKELETON_BAR = 'block h-[14px] rounded-sm bg-sunken';
const TOAST_ACTION = 'inline-flex min-h-[44px] items-center text-inherit [font:inherit]';
const boardChoices = (app: AppController) => [{ id: 'all', label: app.tab() === 'intern' ? '모든 사이트' : '모든 게시판' },
  ...app.tabSources().map((s) => ({ id: s.id, label: boardName(s, s.id) }))];

function settingsModel(app: AppController) {
  return {
    configured: !!authClient, userId: app.authUserId, email: app.authEmail, name: app.authName, avatar: app.authAvatar,
    authBusy: app.authBusy, authError: app.authError,
    signIn: () => { void app.signIn(); }, signOut: () => { void app.signOut(); },
    section: app.settingsSection, openSection: (section: string | null) => app.openSettingsSection(section),
    theme: app.theme, setTheme: (theme: 'auto' | 'light' | 'dark') => app.setTheme(theme),
    canInstall: !!app.install, install: () => { void app.runInstall(); }, showShortcuts: () => { app.shortcutsOpen = true; },
    sources: app.sources.filter((source) => !source.external).map((source) => ({ id: source.id, label: boardName(source, source.id) })),
    boardOrder: { boards: applyBoardOrder(app.schoolSources(), app.boardOrder).map((source) => ({ id: source.id, label: boardName(source, source.id) })),
      status: app.authUserId && app.boardOrderAccount ? app.boardOrderStatus : '' as const, move: (ids: string[]) => app.setBoardOrder(ids) },
    subscriptions: app.subscriptions, loading: app.subscriptionsLoading, error: app.subscriptionsError,
    toggle: (id: string, enabled: boolean) => { void app.toggleSubscription(id, enabled); },
    retry: () => {
      if (app.authUserId) { app.subscriptionsLoading = true; app.subscriptionsError = ''; void app.refreshSubscriptions(app.authUserId, app.subscriptionsEpoch); }
    },
    keywords: app.keywords, keywordNote: app.keywordNote,
    addKeyword: (word: string) => app.addKeyword(word), removeKeyword: (word: string) => app.removeKeyword(word),
    pushStatus: app.pushStatus, pushError: app.pushError, pushRetry: app.pushRetry,
    enablePush: () => { void app.enablePush(); }, disablePush: () => { void app.disablePush(); },
    testNotification: () => { void app.testNotification(); },
    profile: app.profile, profileStatus: app.profileStatus, profileMessage: app.profileMessage, profileError: app.profileError,
    saveProfile: (profile: UserProfile) => { void app.saveProfile(profile); },
    byok: aiConnectModel(app),
    account: { busy: app.accountBusy, error: app.accountError, remove: () => { void app.deleteAccount(); } },
    devicesInfo: { devices: app.devices, thisId: app.thisDeviceId, summaryTime: app.summaryTime, hasCanvasToken: !!app.canvasStatus, busy: app.devicesBusy, error: app.devicesError,
      refresh: () => { void app.refreshDevices(); }, setMode: (mode: string) => { void app.setCanvasMode(mode as CanvasMode); }, remove: (id: string) => { void app.removeDevice(id); }, rename: (id: string, name: string) => app.renameDevice(id, name),
      setSummaryTime: (period: 'am' | 'pm', hour: number, minute: number) => { void app.setSummaryTime(period, hour, minute); } },
    calendar: { auto: app.calendarAuto, id: app.calendarId, syncedAt: app.calendarSyncedAt, busy: app.calendarBusy, message: app.calendarMessage, error: app.calendarError, savedCount: app.saved.length,
      connect: () => { void app.connectCalendar(); }, sync: () => { void app.syncCalendarNow(); }, disconnect: () => { void app.disconnectCalendar(); } },
  };
}

// 상단 바. 휴대폰은 위에 붙는 한 줄(홈 목록은 바탕과 같은 면에 선 없음), 720px부터는 64px 머리 줄이다.
const TOPBAR = 'pane-head topbar glass sticky top-[var(--wco-h)] z-[2] flex items-center gap-[4px] border-b border-line pt-[calc(10px_+_env(safe-area-inset-top))] pr-[4px] pb-[10px] pl-[var(--gutter)] select-none [-webkit-user-select:none] min-[720px]:top-0 min-[720px]:h-[var(--head-h)] min-[720px]:flex-none min-[720px]:gap-[8px] min-[720px]:px-[24px] min-[720px]:py-0';
const TOPBAR_FEED = 'feed-topbar max-[719px]:relative max-[719px]:top-auto max-[719px]:gap-0 max-[719px]:border-b-0 max-[719px]:bg-bg max-[719px]:pt-[calc(8px_+_env(safe-area-inset-top))] max-[719px]:pr-[4px] max-[719px]:pb-[8px] max-[719px]:pl-[var(--gutter)] max-[719px]:[-webkit-backdrop-filter:none] max-[719px]:[backdrop-filter:none]';
// 설정은 전체 폭을 쓰므로 닫기 단추는 머리 줄의 오른쪽 끝(내용 오른쪽 끝선)에 둔다.
const TOPBAR_SETTINGS = '';
const TOPBAR_TEXT = 'topbar-text min-w-0 flex-1 min-[720px]:min-w-[88px]';
const TOPBAR_H1 = 'min-[720px]:text-[21px] min-[720px]:leading-[28px]';
const UPDATED = 'updated text-[13px] leading-[18px] tabular-nums min-[720px]:text-[12px] min-[720px]:leading-[16px]';

// 사이드바(PC 전용) 항목. 현재 항목은 aria-current=page로 표시한다.
const SIDE_ITEM = 'flex items-center justify-between gap-[8px] min-h-[40px] px-[12px] py-0 border-0 rounded-sm text-[15px] font-medium text-left select-none [-webkit-user-select:none] [@media(pointer:coarse)]:min-h-[44px]';
const SIDE_ITEM_IDLE = 'bg-transparent hover:bg-hover-soft';
const SIDE_ITEM_CURRENT = 'bg-sunken text-ink font-semibold [&_.i]:text-accent';

function SideItem({ label, count, active, onClick, shortcut, ariaLabel, icon }: {
  label: string; count: number | null; active: boolean; onClick: () => void; shortcut?: string; ariaLabel?: string; icon?: IconName;
}) {
  return <button type="button" className={`side-item ${SIDE_ITEM} ${active ? SIDE_ITEM_CURRENT : `text-ink-2 ${SIDE_ITEM_IDLE}`}`} aria-current={active ? 'page' : 'false'} onClick={onClick}
    aria-label={ariaLabel} aria-keyshortcuts={shortcut} title={shortcut ? `${label} (${shortcut})` : undefined}>
    <span className="side-label flex min-w-0 items-center gap-[10px] [&_.i]:h-[20px] [&_.i]:w-[20px]">{icon ? <Icon name={icon} /> : null}<span className="overflow-hidden text-ellipsis whitespace-nowrap">{label}</span></span>{count === null ? null : <span className="count text-[14px] text-ink-3 tabular-nums">{count}</span>}</button>;
}

// 사이드바 묶음은 머리를 눌러 접고 편다. 접은 묶음은 기억한다(사용자 요청 2026-11-03).
function SideGroup({ app, id, title, count, children }: { app: AppController; id: string; title: string; count?: number; children: ReactNode }) {
  const open = !app.collapsed.includes(id);
  return <>
    <button type="button" className="side-head mx-[12px] mt-[20px] mb-[4px] flex w-[calc(100%_-_24px)] cursor-pointer items-center justify-between border-0 bg-transparent px-0 py-[4px] text-left text-[13px] leading-[18px] font-semibold text-ink-2 [&:hover]:text-ink" aria-expanded={open} aria-controls={`side-${id}`} onClick={() => {
      app.collapsed = open ? [...app.collapsed, id] : app.collapsed.filter((x) => x !== id);
      remember('side-collapsed', JSON.stringify(app.collapsed));
    }}><span>{title}{!open && count ? <span className="side-count ml-[6px] font-medium text-ink-3">{count}</span> : null}</span><span className={`side-chevron h-[8px] w-[8px] border-r-[1.5px] border-b-[1.5px] border-current ${open ? '[transform:rotate(45deg)_translateY(-2px)]' : '[transform:rotate(-45deg)]'}`} aria-hidden="true" /></button>
    <div className="side-group flex flex-col gap-[1px]" id={`side-${id}`} hidden={!open}>{children}</div>
  </>;
}

function UpdatedLine({ app, count, pending = 0 }: { app: AppController; count?: number; pending?: number }) {
  if (app.loading && !app.generatedAt) return <p className={`${UPDATED} text-ink-3`}>공지를 불러오고 있어요</p>;
  if (!app.generatedAt) return <p className={`${UPDATED} text-ink-3`}>받은 시각을 알 수 없어요</p>;
  const stale = Date.now() - Date.parse(app.generatedAt) > STALE_MS;
  const time = new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date(app.generatedAt));
  const total = count === undefined ? '' : `${count}건, `;
  // "확인 필요"(판정)와 겹치지 않게 수집 지연은 다른 말로 쓴다.
  return <p className={`${UPDATED} ${stale ? 'stale text-ink-2' : 'text-ink-3'}`}>{stale ? `${time} 이후 새 공지를 못 가져왔어요` : `${total}${time} 기준${pending ? ` · AI 확인 중 ${pending}건` : ''}`}</p>;
}

const Empty = ({ title, body, action, onAction }: { title: string; body: string; action?: string; onAction?: () => void }) =>
  <div className="empty flex flex-col items-center gap-[4px] px-[24px] py-[64px] text-center text-ink-3 [&_.i]:mb-[8px] [&_.i]:size-[36px] [&_.i]:[stroke-width:1.5]"><Icon name="ginkgo" /><strong className="text-[16px] leading-[23px] text-ink-2">{title}</strong><p className="m-0 mb-[12px] text-[14px]">{body}</p>
    {action ? <button type="button" className="ghost-button inline-flex items-center justify-center min-h-[44px] px-[16px] py-0 rounded-md border border-line bg-surface text-ink text-[15px] font-semibold no-underline whitespace-nowrap select-none [-webkit-user-select:none] disabled:border-line disabled:bg-transparent disabled:text-ink-3 disabled:opacity-60" onClick={onAction}>{action}</button> : null}</div>;

function ListBody({ app, list }: { app: AppController; list: Notice[] }) {
  if (app.loading && !app.notices.length) {
    return <ol className="rows m-0 list-none overflow-hidden bg-surface p-0 min-[720px]:rounded-none min-[720px]:bg-transparent">{Array.from({ length: 6 }, (_, i) =>
      <li className={`row skeleton ${ROW_LAYOUT} min-[720px]:[grid-template-areas:"meta_title_dday"_"meta_reason_dday"]`} aria-hidden="true" key={i}><span className={`${SKELETON_BAR} [grid-area:meta] h-[12px] w-[30%]`}></span><span className={`${SKELETON_BAR} [grid-area:title]`}></span><span className={`${SKELETON_BAR} [grid-area:reason] w-[70%]`}></span></li>)}</ol>;
  }
  if (app.failed && !app.notices.length) {
    return <Empty title="목록을 불러오지 못했어요" body="공지 데이터를 연결하는 중이에요. 잠시 뒤 다시 확인해 주세요" action="다시 불러오기" onAction={() => { void app.refresh(); }} />;
  }
  if (!list.length) {
    const picker = app.tab() === 'all' && app.noBoards() ? null : <div className="group-head empty-head mx-[var(--gutter)] mt-[4px] mb-0 flex min-h-[44px] items-center justify-end min-[720px]:m-0 min-[720px]:min-h-0 min-[720px]:px-[24px] min-[720px]:py-[6px]"><span></span><BoardSelect app={app} /></div>;
    const note = (() => {
      // 받을 게시판을 아직 안 골랐으면 첫 설정으로, 이미 마친 사람은 게시판 고르기로 이어 준다.
      if (app.tab() === 'all' && app.noBoards()) {
        return app.profile.onboardedAt
          ? <Empty title="받을 게시판이 없어요" body="게시판을 고르면 새 공지가 여기에 보여요" action="게시판 고르기" onAction={() => app.openSettings('notifications')} />
          : <Empty title="아직 설정을 안 했어요" body="첫 설정을 마치면 맞는 게시판을 켜 드려요" />;
      }
      if (app.query) return <Empty title={`'${app.query}'에 맞는 공지가 없어요`} body="다른 단어로 찾아보세요" action="검색어 지우기" onAction={() => { app.query = ''; }} />;
      if (app.keyword && app.view !== 'saved' && app.unreadOnly) return <Empty title={`'${app.keyword}'에 맞는 읽지 않은 공지가 없어요`} body="읽지 않은 공지만 보기를 끄면 모든 공지를 볼 수 있어요" />;
      if (app.keyword) return <Empty title={`'${app.keyword}'에 맞는 공지가 아직 없어요`} body="새 글이 오면 여기에 모여요" />;
      if (app.view !== 'saved' && app.graduationOnly && app.gradEnabled()) return <Empty title="인턴십 요건에 맞는 공고가 아직 없어요" body="인턴십 충족만 보기를 끄면 모든 공고를 볼 수 있어요" />;
      if (app.view !== 'saved' && app.unreadOnly) return <Empty title="읽지 않은 공지가 없어요" body="읽지 않은 공지만 보기를 끄면 모든 공지를 볼 수 있어요" />;
      const [heading, body] = {
        all: ['이 게시판에 공지가 없어요', '다른 게시판을 골라 보세요'],
        intern: ['이 사이트에 공고가 없어요', '다른 사이트를 골라 보세요'],
        saved: ['저장한 공지가 없어요', '공지를 열어 저장하면 여기에 모여요'],
      }[app.tab()];
      return <Empty title={heading} body={body} />;
    })();
    return <>{picker}{note}</>;
  }
  const today = todayKst();
  const groups = new Map<string, Notice[]>();
  for (const notice of list) {
    const key = app.sortFor(app.tab()) === 'deadline'
      ? !notice.deadline ? '마감일 미정' : deadlinePassed(notice.deadline) ? '마감 지난 글' : deadlineGroup(notice.deadline, today)
      : app.view === 'saved' ? '저장한 공지' : postedGroup(notice.posted_on, today);
    groups.set(key, [...(groups.get(key) ?? []), notice]);
  }
  return <>{[...groups].map(([heading, items], index) => <section className={`group ${index > 0 ? 'mt-[20px] min-[720px]:mt-[8px]' : ''}`} aria-label={heading} key={heading}>
    <div className="group-head mx-[var(--gutter)] mt-[4px] mb-0 flex min-h-[44px] items-center justify-between min-[720px]:m-0 min-[720px]:min-h-0 min-[720px]:px-[24px] min-[720px]:py-[6px]"><h2 className="text-[13px] leading-[18px] font-semibold text-ink-3 min-[720px]:text-[12px] min-[720px]:leading-[16px]">{heading}</h2>{index === 0 && !app.selecting ? <BoardSelect app={app} /> : null}</div>
    <notice-rows-screen model={{
      rows: items.map((notice) => {
        const ai = app.judgement(notice)?.ai ?? null;
        const grad = app.gradPartsFor(notice, ai?.verdict);
        const interests = app.shownInterests(notice, grad.length > 0);
        const cached = app.summaries.get(notice.id);
        const rowNotice = withMyDeadline(notice, cached && cached !== 'loading' ? cached : null);
        return { notice: rowNotice, source: boardName(app.sources.find((source) => source.id === notice.source_id), notice.source_id),
          read: app.isRead(notice), saved: app.isSaved(notice), current: app.isWide && app.detailOpen && app.shownId === notice.id,
          selected: app.selectedReads.includes(notice.id), dim: ai?.verdict === 'not_relevant' && !interests.length,
          interests, ai, rule: app.judgement(notice)?.rule_name ?? null, grad, pending: !ai && !interests.length && !grad.length && app.judgePending(notice) };
      }),
      today, selecting: app.selecting, savedView: app.view === 'saved',
      open: (event: MouseEvent, notice: Notice) => app.onRow(event, notice),
      toggleSelection: (id: string) => app.toggleReadSelection(id),
    }} />
  </section>)}</>;
}

function ViewFilters({ app }: { app: AppController }) {
  const list = app.visible();
  const allBox = useRef<HTMLInputElement>(null);
  const selected = new Set(app.selectedReads);
  const selectedVisible = list.filter((notice) => selected.has(notice.id));
  const everyone = list.length > 0 && selectedVisible.length === list.length;
  const some = selectedVisible.length > 0 && selectedVisible.length < list.length;
  // indeterminate는 속성이 아니라 프로퍼티라 반영 뒤에 직접 넣는다.
  useEffect(() => { if (allBox.current) allBox.current.indeterminate = some; });
  if (app.selecting) {
    const selectedUnread = selectedVisible.filter((notice) => !app.isRead(notice)).length;
    const selectedRead = selectedVisible.length - selectedUnread;
    const count = selectedVisible.length;
    return <div className="view-options select-options flex items-center justify-between gap-x-[4px] px-[var(--gutter)] min-[720px]:px-[24px] min-[720px]:bg-surface min-[720px]:sticky min-[720px]:top-[var(--head-h)] min-[720px]:z-[2] flex-wrap gap-y-[8px] min-h-[48px] py-[4px] max-[719px]:min-h-[44px] max-[719px]:py-0 min-[720px]:pt-[4px] min-[720px]:pb-0" role="group" aria-label="공지 선택">
      <label className={`select-all order-1 inline-flex min-h-[44px] cursor-pointer items-center gap-[8px] text-[14px] font-medium ${count ? 'text-ink' : 'text-ink-2'} ${app.gradEnabled() ? 'max-[719px]:w-full' : ''}`}><input className={CHECKBOX} type="checkbox" ref={allBox} checked={everyone} disabled={!list.length}
        onChange={(event) => { app.selectedReads = event.currentTarget.checked ? list.map((notice) => notice.id) : []; }} />
        <span aria-live="polite">{count ? `${count}개 선택됨` : '전체 선택'}</span>
</label>
      <button type="button" className={`${SELECT_BTN} order-2 ml-auto min-[720px]:ml-0 border-0 bg-transparent px-[4px]! font-medium text-ink-2 min-[720px]:order-3 min-[720px]:ml-[4px] min-[720px]:min-h-[44px]!`} onClick={() => app.closeSelection()}><Icon name="close" />선택 끝내기</button>
      <div className={`order-3 flex gap-[8px] min-[720px]:gap-[4px] min-[720px]:order-2 min-[720px]:ml-auto ${count ? '' : 'max-[719px]:hidden'} max-[719px]:fixed max-[719px]:inset-x-0 max-[719px]:bottom-0 max-[719px]:pb-[calc(16px+env(safe-area-inset-bottom))] max-[719px]:z-[3] max-[719px]:bg-[var(--glass)] max-[719px]:backdrop-blur-[20px] max-[719px]:backdrop-saturate-[1.6] max-[719px]:border-t max-[719px]:border-line max-[719px]:px-[var(--gutter)] max-[719px]:pt-[8px] min-[720px]:order-2 min-[720px]:ml-auto`}>
        <button type="button" className={`${SELECT_BTN} solid-button border-0 bg-accent py-0 font-semibold text-on-accent no-underline select-none [-webkit-user-select:none] disabled:border disabled:border-line disabled:bg-transparent disabled:text-ink-3 min-[720px]:disabled:border-0 min-[720px]:min-h-[44px] min-[720px]:min-w-[44px] min-[720px]:rounded-[var(--r-md)] min-[720px]:border-0 min-[720px]:bg-transparent min-[720px]:px-[8px] min-[720px]:text-[14px] min-[720px]:font-medium min-[720px]:text-ink-2 min-[720px]:disabled:text-ink-3 disabled:opacity-80 max-[719px]:flex-1`} disabled={!selectedUnread}
          aria-label={`선택한 읽지 않은 공지 ${selectedUnread}개 읽음으로 표시`}
          onClick={() => app.markSelectedRead(true)}><Icon name="mail-open" />읽음으로 표시</button>
        <button type="button" className={`${SELECT_BTN} ghost-button border border-line bg-surface py-0 font-semibold text-ink no-underline select-none [-webkit-user-select:none] disabled:border-line disabled:bg-transparent disabled:text-ink-3 min-[720px]:min-h-[44px] min-[720px]:min-w-[44px] min-[720px]:rounded-[var(--r-md)] min-[720px]:border-0 min-[720px]:bg-transparent min-[720px]:px-[8px] min-[720px]:text-[14px] min-[720px]:font-medium min-[720px]:text-ink-2 min-[720px]:disabled:text-ink-3 disabled:opacity-80 max-[719px]:flex-1`} disabled={!selectedRead}
          aria-label={`선택한 읽은 공지 ${selectedRead}개 읽지 않음으로 표시`}
          onClick={() => app.markSelectedRead(false)}><Icon name="mail" />읽지 않음으로 표시</button>
      </div>
      <div className="order-4"><SortSelect app={app} /></div>
    </div>;
  }
  const select = <button type="button" className="read-all select-trigger inline-flex min-h-[44px] min-w-[44px] items-center gap-[6px] border-0 bg-transparent px-[4px] py-0 text-[14px] font-medium whitespace-nowrap text-ink-2 disabled:text-ink-3 [&_.i]:size-[18px]" disabled={!list.length}
    onClick={(event) => {
      app.selecting = true; app.selectedReads = [];
      if (event.detail === 0) void app.updateComplete.then(() => document.querySelector<HTMLInputElement>('.select-all input')?.focus({ preventScroll: true }));
    }}><Icon name="select-list" />선택</button>;
  if (app.view === 'saved') return <div className={`view-options saved-options ${VIEW_ROW} justify-end`}><div className={VIEW_ACTIONS}>{select}<SortSelect app={app} /></div></div>;
  return <div className={`view-options ${VIEW_ROW} justify-between`} role="group" aria-label="공지 보기 조건">
    <div className="view-filters flex min-w-0 flex-wrap items-center gap-x-[12px] gap-y-0">
      <button type="button" className={VIEW_TOGGLE} aria-pressed={app.unreadOnly} onClick={() => {
        app.unreadOnly = !app.unreadOnly;
        app.listChanged();
        remember('view-unread', app.unreadOnly ? '1' : '0');
      }}><span className={FILTER_CHECK} aria-hidden="true"></span>읽지 않은 공지만</button>
      {app.gradEnabled() ? <button type="button" className={VIEW_TOGGLE} aria-pressed={app.graduationOnly} onClick={() => {
        app.graduationOnly = !app.graduationOnly;
        app.listChanged();
        remember('view-grad', app.graduationOnly ? '1' : '0');
      }}><span className={FILTER_CHECK} aria-hidden="true"></span>인턴십 충족만</button> : null}
    </div>
    <div className={VIEW_ACTIONS}>{select}<SortSelect app={app} /></div>
  </div>;
}

const VIEW_ROW = 'flex flex-wrap items-center gap-[8px] px-[var(--gutter)] min-[720px]:px-[24px] min-[720px]:pt-[4px] min-[720px]:pb-0';
const VIEW_ACTIONS = 'view-actions ml-auto flex items-center gap-[4px] max-[359px]:gap-0';
const VIEW_TOGGLE = 'view-toggle group inline-flex min-h-[44px] items-center gap-[8px] border-0 bg-transparent py-0 pr-[8px] pl-0 text-[14px] font-medium text-ink-2 aria-pressed:font-semibold aria-pressed:text-ink';
// 체크 표시(::after의 마스크)는 base.css의 .check-mark가 맡는다.
const FILTER_CHECK = 'filter-check check-mark relative size-[18px] flex-none rounded-sm border-[1.5px] border-ink-3 group-aria-pressed:border-ink group-aria-pressed:bg-ink';
const MENU_TRIGGER = 'board-trigger group inline-flex min-h-[44px] items-center justify-end gap-[7px] border-0 bg-transparent py-0 pr-0 pl-[12px] text-[14px] whitespace-nowrap text-ink-2';
const MENU_CHEVRON = 'board-chevron size-[7px] border-r-[1.5px] border-b-[1.5px] border-current [transform:translateY(-2px)_rotate(45deg)] group-aria-expanded:[transform:translateY(2px)_rotate(225deg)]';
const MENU_OPTIONS = 'board-options absolute top-[calc(100%+4px)] right-0 z-[4] rounded-md border border-line bg-surface p-[4px] [box-shadow:var(--shadow-pop)]';
const MENU_OPTION = 'board-option flex min-h-[44px] w-full items-center justify-between gap-[12px] rounded-sm border-0 bg-transparent px-[12px] py-0 text-left text-[14px] font-medium whitespace-nowrap text-ink-2 [&:hover]:bg-sunken focus-visible:bg-sunken aria-pressed:bg-sunken aria-pressed:font-semibold aria-pressed:text-ink';
const MENU_CHECK = 'board-check mr-[3px] h-[12px] w-[7px] border-r-[1.5px] border-b-[1.5px] border-current [transform:rotate(45deg)]';

// 위아래·Home·End로 메뉴 항목 사이를 옮긴다.
function moveFocus(event: React.KeyboardEvent, selector: string) {
  const buttons = [...document.querySelectorAll<HTMLButtonElement>(selector)];
  const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
  const next = event.key === 'ArrowDown' ? (index + 1) % buttons.length
    : event.key === 'ArrowUp' ? (index + buttons.length - 1) % buttons.length
      : event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : -1;
  if (next >= 0) { event.preventDefault(); buttons[next]?.focus(); }
}

function SortSelect({ app }: { app: AppController }) {
  const sort = app.sortFor(app.tab());
  const options = [{ id: 'latest', label: app.view === 'saved' ? '저장한 순' : '최신순' }, { id: 'deadline', label: '마감순' }] as const;
  const label = options.find((option) => option.id === sort)!.label;
  return <div className="sort-picker relative flex-none">
    <button type="button" className={`sort-trigger ${MENU_TRIGGER} font-medium`} aria-label={`정렬: ${label}`}
      aria-expanded={app.sortMenuOpen} aria-controls="sort-options" onClick={() => {
        app.sortMenuOpen = !app.sortMenuOpen;
        if (app.sortMenuOpen) void app.updateComplete.then(() => document.querySelector<HTMLButtonElement>('.sort-option[aria-pressed="true"]')?.focus());
      }}>{label}<span className={MENU_CHEVRON} aria-hidden="true" /></button>
    {app.sortMenuOpen ? <div id="sort-options" className={`sort-options ${MENU_OPTIONS} min-w-[140px]`} role="group" aria-label="정렬 선택"
      onKeyDown={(event) => moveFocus(event, '.sort-option')}
      onBlur={(event) => { if (!event.currentTarget.parentElement?.contains(event.relatedTarget as Node | null)) app.sortMenuOpen = false; }}>
      {options.map((option) => <button type="button" className={`sort-option ${MENU_OPTION}`} key={option.id} aria-pressed={sort === option.id}
        onClick={() => {
          if (app.view === 'saved') app.savedSort = option.id;
          else if (app.view === 'intern') app.internSort = option.id;
          else app.sort = option.id;
          remember(app.view === 'saved' ? 'saved-sort' : app.view === 'intern' ? 'intern-sort' : 'notice-sort', option.id);
          app.listChanged();
          app.sortMenuOpen = false;
          history.replaceState(null, '', `${location.pathname}?tab=${app.tab()}&sort=${option.id}`);
          void app.updateComplete.then(() => document.querySelector<HTMLButtonElement>('.sort-trigger')?.focus());
        }}><span>{option.label}</span>{sort === option.id ? <span className={MENU_CHECK} aria-hidden="true" /> : null}</button>)}
    </div> : null}
  </div>;
}

function BoardSelect({ app }: { app: AppController }) {
  const boards = boardChoices(app);
  const current = boards.find((b) => b.id === app.activeBoard())?.label ?? boards[0].label;
  return <div className="board-picker narrow-only relative flex-none min-[720px]:hidden!" onBlur={(event) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) app.boardMenuOpen = false;
  }}>
    <button type="button" className={`${MENU_TRIGGER} font-semibold`} aria-label={`게시판: ${current}`} aria-expanded={app.boardMenuOpen}
      aria-controls="board-options" onClick={() => {
        app.boardMenuOpen = !app.boardMenuOpen;
        if (app.boardMenuOpen) void app.updateComplete.then(() => document.querySelector<HTMLButtonElement>('.board-option[aria-pressed="true"]')?.focus());
      }}>
      {current}<span className={MENU_CHEVRON} aria-hidden="true" />
    </button>
    {app.boardMenuOpen ? <div id="board-options" className={`${MENU_OPTIONS} min-w-[max(100%,180px)]`} role="group" aria-label="게시판 선택"
      onKeyDown={(event) => moveFocus(event, '.board-option')}>
      {boards.map((b) => <button type="button" className={`board-option ${MENU_OPTION}`} key={b.id} aria-pressed={app.activeBoard() === b.id}
        onClick={() => { app.setBoard(b.id); void app.updateComplete.then(() => document.querySelector<HTMLButtonElement>('.board-picker .board-trigger')?.focus()); }}>
        <span>{b.label}</span>{app.activeBoard() === b.id ? <span className={MENU_CHECK} aria-hidden="true" /> : null}</button>)}
      {app.tab() === 'intern' ? null : <button type="button" className={`board-more ${MENU_OPTION}`} onClick={() => app.openSettings('notifications')}><span>게시판 더 고르기</span></button>}
    </div> : null}
  </div>;
}

function SaveButton({ app, notice }: { app: AppController; notice: Notice }) {
  const saved = app.isSaved(notice);
  return <button type="button" className="icon-button save-button grid place-items-center flex-none size-[44px] rounded-md border border-line bg-surface text-ink active:bg-sunken aria-pressed:bg-transparent aria-pressed:text-accent disabled:text-ink-3 min-[720px]:size-[36px] min-[720px]:rounded-sm [@media(hover:hover)]:min-[720px]:[&:hover:not(:disabled)]:bg-hover-soft" aria-pressed={saved}
    aria-label={saved ? '저장 지우기' : '저장하기'} title={saved ? '저장 지우기 (S)' : '저장하기 (S)'} aria-keyshortcuts="s"
    onClick={() => app.toggleSave(notice)}><Icon name={saved ? 'bookmark-on' : 'bookmark'} /></button>;
}

function Detail({ app, notice }: { app: AppController; notice: Notice }) {
  const judgement = app.judgement(notice);
  app.autoSummary(notice);
  const mine = app.myInfo(notice);
  const body = app.body(notice);
  const translation = app.myTranslations.get(notice.id);
  const shownBody = body && body !== 'loading' && translation ? { ...body, translation } : body;
  const gradDetail = app.gradPartsFor(notice, (judgement?.ai ?? mine?.ai)?.verdict);
  const hasGrad = gradDetail.length > 0;
  const interests = [...new Set([...app.shownInterests(notice, hasGrad), ...bodyInterests(app.keywords, body, keywordMatches).filter((word) => app.shownInterests(notice, hasGrad).includes(word) || !app.isExternal(notice) || !/^(인턴|인턴십|인턴쉽|intern|internship)$/i.test(word))])];
  const shown = withMyDeadline(notice, mine);
  return <notice-detail-screen model={{
    notice: shown, source: boardName(app.sources.find((source) => source.id === notice.source_id), notice.source_id),
    today: todayKst(), body: shownBody, mySummary: mine?.summary ?? null, summarizing: app.summarizing === notice.id, summaryError: app.summaryErrorId === notice.id && !app.summarizing ? app.summaryError : '', makeSummary: () => { void app.makeSummary(notice); }, interests,
    ai: judgement?.ai ?? mine?.ai ?? null, rule: judgement?.rule_name ?? null, notified: !!judgement?.notified,
    retry: () => { app.bodies.delete(notice.id); app.requestUpdate(); },
    grad: gradDetail,
    graduation: app.showsGraduation(notice) ? { aiKeys: (app.byokStatus && !app.byokStatus.disabled ? 1 : 0) + app.aiKeys.filter((key) => !key.disabled).length, tracks: visibleTracks(app.profile), assessment: app.graduationFor(notice), error: app.graduationError } : undefined,
  }} />;
}

/** 휴대폰 앱 안 상세 화면: 뒤로 가기, 상세, 바닥의 원문 열기 */
function ReadingView({ app, notice }: { app: AppController; notice: Notice }) {
  return <Fragment>
    <header className={TOPBAR}>
      <button type="button" className="icon-button grid place-items-center flex-none size-[44px] border-0 rounded-pill bg-transparent text-ink-2 active:bg-sunken disabled:text-ink-3 min-[720px]:size-[36px] min-[720px]:rounded-sm [@media(hover:hover)]:min-[720px]:[&:hover:not(:disabled)]:bg-hover-soft back -ml-[12px]" aria-label="목록으로" onClick={() => history.back()}><Icon name="back" /></button>
      <div className={TOPBAR_TEXT}><h1 className={TOPBAR_H1}>공지</h1></div>
    </header>
    <div className="reading px-[var(--gutter)] pt-[16px] pb-[calc(96px+env(safe-area-inset-bottom))]"><Detail app={app} notice={notice} /></div>
    <div className="read-actions glass fixed inset-x-0 bottom-0 z-[3] flex gap-[8px] border-t border-line px-[var(--gutter)] pt-[12px] pb-[calc(12px+env(safe-area-inset-bottom))] [&>*]:flex-1 [&>.save-button]:flex-none">
      <SaveButton app={app} notice={notice} />
      {'share' in navigator
        ? <button type="button" className="ghost-button inline-flex items-center justify-center min-h-[44px] px-[16px] py-0 rounded-md border border-line bg-surface text-ink text-[15px] font-semibold no-underline whitespace-nowrap select-none [-webkit-user-select:none] disabled:border-line disabled:bg-transparent disabled:text-ink-3 disabled:opacity-60" onClick={() => { void app.share(notice); }}>공유하기</button>
        : <button type="button" className="ghost-button inline-flex items-center justify-center min-h-[44px] px-[16px] py-0 rounded-md border border-line bg-surface text-ink text-[15px] font-semibold no-underline whitespace-nowrap select-none [-webkit-user-select:none] disabled:border-line disabled:bg-transparent disabled:text-ink-3 disabled:opacity-60" onClick={() => { void app.copyLink(notice); }}>링크 복사하기</button>}
      <a className="solid-button inline-flex items-center justify-center min-h-[44px] px-[16px] py-0 rounded-md border-0 bg-accent text-on-accent text-[15px] font-semibold no-underline whitespace-nowrap select-none [-webkit-user-select:none] disabled:border disabled:border-line disabled:bg-transparent disabled:text-ink-3 disabled:opacity-60" href={safeUrl(notice.url)} target="_blank" rel="noopener">원문 열기</a>
    </div>
  </Fragment>;
}

// 단축키 창은 네이티브 dialog로 연다(포커스 가두기와 Esc 닫기를 브라우저가 맡는다).
function ShortcutsDialog({ app }: { app: AppController }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { const dialog = ref.current; if (dialog && !dialog.open) dialog.showModal(); }, []);
  return <dialog ref={ref} className="shortcuts w-[min(440px,calc(100vw-32px))] rounded-lg border border-line bg-surface px-[24px] pt-0 pb-[20px] text-ink shadow-pop backdrop:bg-[oklch(0.15_0.01_var(--h)/0.4)]" aria-labelledby="shortcuts-title" onClose={() => { app.shortcutsOpen = false; }}
    onClick={(event) => { if (event.target === event.currentTarget) event.currentTarget.close(); }}>
    <div className="dialog-head -mr-[8px] flex h-[56px] items-center justify-between">
      <h2 id="shortcuts-title" className="text-[17px] font-bold">단축키</h2>
      <button type="button" className="icon-button grid place-items-center flex-none size-[44px] border-0 rounded-pill bg-transparent text-ink-2 active:bg-sunken disabled:text-ink-3 min-[720px]:size-[36px] min-[720px]:rounded-sm [@media(hover:hover)]:min-[720px]:[&:hover:not(:disabled)]:bg-hover-soft" aria-label="닫기" onClick={(event) => event.currentTarget.closest('dialog')?.close()}><Icon name="close" /></button>
    </div>
    {SHORTCUTS.map((section) => <section className="shortcut-group" key={section.group}>
      <h3 className="mx-0 mt-[12px] mb-[4px] text-[12px] leading-[16px] font-semibold text-ink-3">{section.group}</h3>
      <dl className="m-0">{section.items.map(([label, keys]) => <div className="flex min-h-[36px] items-center justify-between border-t border-line text-[14px]" key={label}><dt>{label}</dt><dd className="m-0"><Kbd keys={keys} /></dd></div>)}</dl>
    </section>)}
    <p className="dialog-foot mt-[12px] text-[12px] text-ink-3">위아래 화살표로도 공지를 옮길 수 있어요</p>
  </dialog>;
}
