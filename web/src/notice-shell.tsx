// 앱 화면. 상태와 동작은 AppController가 맡고, 이 파일은 구독해서 그리기만 한다.
// 그림자 DOM을 쓰지 않아 전역 토큰과 글꼴을 그대로 받는다. 학교 글자는 React가 자동으로 이스케이프한다.
import { Fragment, useEffect, useRef, useSyncExternalStore, type ReactNode } from 'react';
import { type IconName, type Notice, boardName, deadlineGroup, deadlinePassed, postedGroup, safeUrl, todayKst } from './data';
import { APP_NAME } from './brand';
import { authClient } from './auth';
import { keywordCounts } from './keyword-counts';
import { type AppController, STALE_MS, TABS, remember, settingsSubtitle, settingsTitle } from './app-controller';
import type { UserProfile } from './profile';
import { Onboarding } from './onboarding';
import './platform-settings';
import './notice-rows';
import './notice-detail';

const SHORTCUTS: { group: string; items: [string, string[]][] }[] = [
  { group: '목록', items: [['다음 공지', ['J']], ['이전 공지', ['K']], ['원문 열기', ['Enter']], ['저장하기', ['S']], ['상세 칸 닫기', ['Esc']]] },
  { group: '이동', items: [['성대 공지', ['1']], ['인턴 공고', ['2']], ['저장', ['3']], ['검색', ['/']]] },
  { group: '그 밖', items: [['공지 다시 가져오기', ['R']], ['설정 닫기', ['Esc']], ['단축키 보기', ['?']]] },
];

// 단축키 표시(Primer KeybindingHint 방식: 키 하나에 kbd 하나, 사방 1px 테두리). 화면 낭독기에는 aria-keyshortcuts로 알린다.
const Kbd = ({ keys }: { keys: string[] }) => <span className="kbd-group" aria-hidden="true">{keys.map((key) => <kbd className="kbd" key={key}>{key}</kbd>)}</span>;

const Icon = ({ name }: { name: IconName }) => <svg className="i" aria-hidden="true"><use href={`icons/sprite.svg#${name}`} /></svg>;
const GearIcon = () => <svg className="i" aria-hidden="true" viewBox="0 0 24 24"><circle cx="12" cy="12" r="3" />
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
    document.title = app.authReady && app.view === 'settings' ? `${settingsTitle()} - ${APP_NAME}` : APP_NAME;
  });

  if (!app.authReady) return <p role="status" className="platform-preview">로그인 상태를 확인하고 있어요.</p>;
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
  const classes = [settings ? 'is-settings' : '', app.isWide && (!app.detailOpen || !selected) ? 'no-detail' : '', reading ? 'is-reading' : ''].join(' ');

  return <>
    <div className="wco-bar" aria-hidden="true"><Brand />{APP_NAME}</div>
    <div className={`app ${classes}`} inert={onboarding}>
      <aside className="sidebar" aria-label="탐색">
        <div className="pane-head brand"><Brand />{APP_NAME}</div>
        <nav className="side-group" aria-label="보기">
          {TABS.map((t, index) => <SideItem key={t.id} label={t.label} count={counts[t.id]} active={app.view === t.id}
            onClick={() => app.setView(t.id)} shortcut={String(index + 1)} icon={t.icon} />)}
        </nav>
        <SideGroup app={app} id="keywords" title="관심 키워드" count={keywordTotals.total}>
          {app.keywords.map((word) => <SideItem key={word} label={word} count={keywordTotals.counts[word]}
            active={app.keyword === word && !settings} onClick={() => app.setKeyword(app.keyword === word ? null : word)}
            ariaLabel={`${word}, 공지 ${keywordTotals.counts[word]}개`} />)}
          <button type="button" className="side-item add" onClick={() => app.openSettings('keywords')}>{app.keywords.length ? '키워드 관리하기' : '키워드 추가하기'}</button>
        </SideGroup>
        <SideGroup app={app} id="boards" title={app.tab() === 'intern' ? '인턴 공고 사이트' : '게시판'} count={app.tabSources().length}>
          {boardChoices(app).map((b) => <SideItem key={b.id} label={b.label} count={null} active={app.activeBoard() === b.id && !settings}
            onClick={() => { app.setBoard(b.id); if (settings) app.leaveSettings(); }} />)}
        </SideGroup>
        <div className="side-foot">
          <SideItem label="설정" count={null} active={settings} onClick={() => app.setView('settings')} />
        </div>
      </aside>

      <main className="list-pane">
        <p className="platform-preview" role="status">미리보기예요. 공지는 30분마다 확인해요.</p>
        {reading ? <ReadingView app={app} notice={reading} /> : <>
          <div className="navigation-head">
            <header className={`pane-head topbar glass ${settings ? '' : 'feed-topbar'}`}>
              {settings ? <button type="button" className="icon-button narrow-only back" aria-label={app.settingsSection ? '설정으로 돌아가기' : '설정 닫기'} onClick={app.backSettings}><Icon name="back" /></button> : null}
              {settings ? null : <Brand className="brand-mark narrow-only" />}
              <div className="topbar-text">
                <h1>{title}</h1>
                {settings ? <p className="updated">{settingsSubtitle()}</p> : <UpdatedLine app={app} count={list.length} />}
              </div>
              {settings ? null : <>
                <label className="search wide-only"><Icon name="search" />
                  <input type="search" placeholder="공지 찾기" autoComplete="off" aria-label="공지 검색" aria-keyshortcuts="/" value={app.query}
                    onChange={(event) => { app.query = event.currentTarget.value; app.selectedId = null; app.selectedReads = []; }} />
                  {app.query ? null : <Kbd keys={['/']} />}</label>
                {app.detailOpen || !selected ? null : <button type="button" className="icon-button wide-only" aria-label="상세 칸 열기" title="상세 칸 열기"
                  onClick={() => app.setDetail(true)}><Icon name="panel" /></button>}
                <button type="button" className="icon-button" aria-label="공지 다시 가져오기" title="공지 다시 가져오기 (R)" aria-keyshortcuts="r"
                  disabled={app.loading} onClick={() => { void app.collectNow(); }}><Icon name="refresh" /></button>
              </>}
              {settings ? null : <button type="button" className="icon-button narrow-only" aria-label="설정" onClick={() => app.setView('settings')}><GearIcon /></button>}
              {settings ? <button type="button" className="icon-button wide-only" aria-label="설정 닫기" title="설정 닫기 (Esc)"
                aria-keyshortcuts="Escape" onClick={app.closeSettings}><Icon name="close" /></button> : null}
            </header>
          </div>

          {settings ? <platform-settings-screen model={settingsModel(app)} /> : <>
            <div className="tools narrow-only">
              <label className="search"><Icon name="search" />
                <input type="search" placeholder="제목, 분류, 판정 이유로 찾기" autoComplete="off" aria-label="공지 검색" value={app.query}
                  onChange={(event) => { app.query = event.currentTarget.value; app.selectedId = null; app.selectedReads = []; }} /></label>
              <div className="chips" role="group" aria-label="관심 키워드">
                {app.keywords.length ? <button type="button" className="chip" aria-pressed={!app.keyword} onClick={() => app.setKeyword(null)}>모두</button> : null}
                {app.keywords.map((word) => <button type="button" className="chip" key={word} aria-pressed={app.keyword === word}
                  aria-label={`${word}, 공지 ${keywordTotals.counts[word]}개`}
                  onClick={() => app.setKeyword(app.keyword === word ? null : word)}>{word} {keywordTotals.counts[word]}</button>)}
                <button type="button" className="chip-add" onClick={() => app.openSettings('keywords')}><Icon name="plus" />키워드 추가하기</button>
              </div>
            </div>
            <ViewFilters app={app} />
            <div className="list" aria-live="polite" aria-busy={app.loading}><ListBody app={app} list={list} /></div>
          </>}
        </>}
      </main>

      <aside className="detail-pane" aria-label="공지 상세">
        <div className="pane-head detail-head">
          {selected ? <button type="button" className="icon-button" aria-label="상세 칸 닫기" title="상세 칸 닫기 (Esc)" aria-keyshortcuts="Escape"
            onClick={() => app.setDetail(false)}><Icon name="close" /></button> : null}
          {selected ? <div className="detail-actions">
            <SaveButton app={app} notice={selected} />
            <button type="button" className="ghost-button" onClick={() => { void app.copyLink(selected); }}>링크 복사하기</button>
            <a className="solid-button" href={safeUrl(selected.url)} target="_blank" rel="noopener" aria-keyshortcuts="Enter">원문 열기<Kbd keys={['Enter']} /></a></div> : null}
        </div>
        {selected ? <Detail app={app} notice={selected} /> : <p className="detail-note detail-empty">공지를 고르면 여기에 보여요</p>}
      </aside>
    </div>

    <nav className="tabbar glass" aria-label="보기" hidden={settings || Boolean(reading)} inert={onboarding}>
      {TABS.map((t) => <button type="button" key={t.id} aria-current={app.view === t.id ? 'page' : 'false'}
        onClick={() => app.setView(t.id)}><Icon name={t.icon} /><span>{t.label}</span></button>)}
    </nav>
    <div className="toast" role="status" hidden={!app.toast}>{app.toast}{app.toastLink ? <div className="toast-actions">
      <a href={app.toastLink} target={app.toastLink.startsWith('?') ? '_self' : '_blank'} rel="noopener noreferrer">{app.toastLinkLabel}</a>
      <button type="button" onClick={() => { app.toast = ''; app.toastLink = null; }}>닫기</button></div> : null}</div>
    {app.shortcutsOpen ? <ShortcutsDialog app={app} /> : null}
    {onboarding ? <Onboarding app={app} /> : null}
  </>;
}

const boardChoices = (app: AppController) => [{ id: 'all', label: app.tab() === 'intern' ? '모든 사이트' : '모든 게시판' },
  ...app.tabSources().map((s) => ({ id: s.id, label: boardName(s, s.id) }))];

function settingsModel(app: AppController) {
  return {
    configured: !!authClient, userId: app.authUserId, email: app.authEmail,
    authBusy: app.authBusy, authError: app.authError,
    signIn: () => { void app.signIn(); }, signOut: () => { void app.signOut(); },
    section: app.settingsSection, openSection: (section: string | null) => app.openSettingsSection(section),
    theme: app.theme, setTheme: (theme: 'auto' | 'light' | 'dark') => app.setTheme(theme),
    canInstall: !!app.install, install: () => { void app.runInstall(); }, showShortcuts: () => { app.shortcutsOpen = true; },
    sources: app.sources.filter((source) => !source.external).map((source) => ({ id: source.id, label: boardName(source, source.id) })),
    subscriptions: app.subscriptions, loading: app.subscriptionsLoading, error: app.subscriptionsError,
    subscriptionsOnly: app.subscriptionsOnly,
    setSubscriptionsOnly: (enabled: boolean) => { app.subscriptionsOnly = enabled; app.selectedId = null; app.selectedReads = []; remember('subscriptions-only', enabled ? '1' : '0'); },
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
    openOnboarding: () => app.openOnboarding(),
    byok: { available: app.byokOn, loading: app.byokLoading, busy: app.byokBusy, error: app.byokError, status: app.byokStatus,
      register: (apiKey: string) => { void app.registerKey(apiKey); }, remove: () => { void app.removeKey(); } },
  };
}

function SideItem({ label, count, active, onClick, shortcut, ariaLabel, icon }: {
  label: string; count: number | null; active: boolean; onClick: () => void; shortcut?: string; ariaLabel?: string; icon?: IconName;
}) {
  return <button type="button" className="side-item" aria-current={active ? 'page' : 'false'} onClick={onClick}
    aria-label={ariaLabel} aria-keyshortcuts={shortcut} title={shortcut ? `${label} (${shortcut})` : undefined}>
    <span className="side-label">{icon ? <Icon name={icon} /> : null}<span>{label}</span></span>{count === null ? null : <span className="count">{count}</span>}</button>;
}

// 사이드바 묶음은 머리를 눌러 접고 편다. 접은 묶음은 기억한다(사용자 요청 2026-11-03).
function SideGroup({ app, id, title, count, children }: { app: AppController; id: string; title: string; count?: number; children: ReactNode }) {
  const open = !app.collapsed.includes(id);
  return <>
    <button type="button" className="side-head" aria-expanded={open} aria-controls={`side-${id}`} onClick={() => {
      app.collapsed = open ? [...app.collapsed, id] : app.collapsed.filter((x) => x !== id);
      remember('side-collapsed', JSON.stringify(app.collapsed));
    }}><span>{title}{!open && count ? <span className="side-count">{count}</span> : null}</span><span className="side-chevron" aria-hidden="true" /></button>
    <div className="side-group" id={`side-${id}`} hidden={!open}>{children}</div>
  </>;
}

function UpdatedLine({ app, count }: { app: AppController; count?: number }) {
  if (app.loading && !app.generatedAt) return <p className="updated">불러오는 중</p>;
  if (!app.generatedAt) return <p className="updated">받은 시각을 알 수 없어요</p>;
  const stale = Date.now() - Date.parse(app.generatedAt) > STALE_MS;
  const time = new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date(app.generatedAt));
  const total = count === undefined ? '' : `${count}건, `;
  // "확인 필요"(판정)와 겹치지 않게 수집 지연은 다른 말로 쓴다.
  return <p className={`updated ${stale ? 'stale' : ''}`}>{stale ? `${time} 수집 지연` : `${total}${time} 기준`}</p>;
}

const Empty = ({ title, body, action, onAction }: { title: string; body: string; action?: string; onAction?: () => void }) =>
  <div className="empty"><Icon name="ginkgo" /><strong>{title}</strong><p>{body}</p>
    {action ? <button type="button" className="ghost-button" onClick={onAction}>{action}</button> : null}</div>;

function ListBody({ app, list }: { app: AppController; list: Notice[] }) {
  if (app.loading && !app.notices.length) {
    return <ol className="rows">{Array.from({ length: 6 }, (_, i) =>
      <li className="row skeleton" aria-hidden="true" key={i}><span></span><span></span><span></span></li>)}</ol>;
  }
  if (app.failed && !app.notices.length) {
    return <Empty title="목록을 불러오지 못했어요" body="공지 데이터를 연결하는 중이에요. 잠시 뒤 다시 확인해 주세요" action="다시 불러오기" onAction={() => { void app.refresh(); }} />;
  }
  if (!list.length) {
    const subscribed = app.tab() === 'all' && app.authUserId && app.subscriptionsOnly;
    if (subscribed && app.subscriptionsLoading) return <p className="detail-note" role="status">구독한 게시판을 불러오고 있어요.</p>;
    if (subscribed && app.subscriptionsError) return <Empty title="구독을 불러오지 못했어요" body="설정에서 다시 불러와 주세요" action="설정 열기" onAction={() => app.openSettings('notifications')} />;
    if (subscribed && !app.subscriptions.length) return <Empty title="구독한 게시판이 없어요" body="설정에서 게시판을 선택해 주세요" action="설정 열기" onAction={() => app.openSettings('notifications')} />;
    const picker = <div className="group-head empty-head"><span></span><BoardSelect app={app} /></div>;
    const note = (() => {
      if (app.query) return <Empty title={`'${app.query}'에 맞는 공지가 없어요`} body="다른 단어로 찾아보세요" action="검색어 지우기" onAction={() => { app.query = ''; }} />;
      if (app.keyword && app.view !== 'saved' && app.unreadOnly) return <Empty title={`'${app.keyword}'에 맞는 읽지 않은 공지가 없어요`} body="읽지 않은 공지만 보기를 끄면 모든 공지를 볼 수 있어요" />;
      if (app.keyword) return <Empty title={`'${app.keyword}'에 맞는 공지가 아직 없어요`} body="새 글이 오면 여기에 모여요" />;
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
  return <>{[...groups].map(([heading, items], index) => <section className="group" aria-label={heading} key={heading}>
    <div className="group-head"><h2>{heading}</h2>{index === 0 ? <BoardSelect app={app} /> : null}</div>
    <notice-rows-screen model={{
      rows: items.map((notice) => {
        const ai = app.judgement(notice)?.ai ?? null;
        const interests = app.interests(notice);
        return { notice, source: boardName(app.sources.find((source) => source.id === notice.source_id), notice.source_id),
          read: app.isRead(notice), saved: app.isSaved(notice), current: app.isWide && app.detailOpen && app.shownId === notice.id,
          selected: app.selectedReads.includes(notice.id), dim: ai?.verdict === 'not_relevant' && !interests.length,
          interests, ai, rule: app.judgement(notice)?.rule_name ?? null };
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
    return <div className="view-options select-options" role="group" aria-label="공지 선택">
      <label className="select-all"><input type="checkbox" ref={allBox} checked={everyone} disabled={!list.length}
        onChange={(event) => { app.selectedReads = event.currentTarget.checked ? list.map((notice) => notice.id) : []; }} />전체 선택</label>
      <div className="view-actions"><button type="button" className="read-all" disabled={!selectedUnread}
        aria-label={`선택한 읽지 않은 공지 ${selectedUnread}개 읽음으로 표시`}
        onClick={() => app.markSelectedRead(true)}>읽음 표시</button>
        <button type="button" className="read-all" disabled={!selectedRead}
          aria-label={`선택한 읽은 공지 ${selectedRead}개 읽지 않음으로 표시`}
          onClick={() => app.markSelectedRead(false)}>안 읽음 표시</button>
        <button type="button" className="read-all" onClick={() => app.closeSelection()}>닫기</button></div>
    </div>;
  }
  const select = <button type="button" className="read-all select-trigger" disabled={!list.length}
    onClick={(event) => {
      app.selecting = true; app.selectedReads = [];
      if (event.detail === 0) void app.updateComplete.then(() => document.querySelector<HTMLInputElement>('.select-all input')?.focus({ preventScroll: true }));
    }}><Icon name="select-list" />선택</button>;
  if (app.view === 'saved') return <div className="view-options saved-options"><div className="view-actions">{select}<SortSelect app={app} /></div></div>;
  return <div className="view-options" role="group" aria-label="공지 보기 조건">
    <button type="button" className="view-toggle" aria-pressed={app.unreadOnly} onClick={() => {
      app.unreadOnly = !app.unreadOnly;
      app.selectedId = null;
      remember('view-unread', app.unreadOnly ? '1' : '0');
    }}><span className="filter-check" aria-hidden="true"></span>읽지 않은 공지만</button>
    <div className="view-actions">{select}<SortSelect app={app} /></div>
  </div>;
}

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
  return <div className="sort-picker">
    <button type="button" className="board-trigger sort-trigger" aria-label={`정렬: ${label}`}
      aria-expanded={app.sortMenuOpen} aria-controls="sort-options" onClick={() => {
        app.sortMenuOpen = !app.sortMenuOpen;
        if (app.sortMenuOpen) void app.updateComplete.then(() => document.querySelector<HTMLButtonElement>('.sort-option[aria-pressed="true"]')?.focus());
      }}>{label}<span className="board-chevron" aria-hidden="true" /></button>
    {app.sortMenuOpen ? <div id="sort-options" className="board-options sort-options" role="group" aria-label="정렬 선택"
      onKeyDown={(event) => moveFocus(event, '.sort-option')}
      onBlur={(event) => { if (!event.currentTarget.parentElement?.contains(event.relatedTarget as Node | null)) app.sortMenuOpen = false; }}>
      {options.map((option) => <button type="button" className="board-option sort-option" key={option.id} aria-pressed={sort === option.id}
        onClick={() => {
          if (app.view === 'saved') app.savedSort = option.id;
          else if (app.view === 'intern') app.internSort = option.id;
          else app.sort = option.id;
          remember(app.view === 'saved' ? 'saved-sort' : app.view === 'intern' ? 'intern-sort' : 'notice-sort', option.id);
          app.selectedId = null;
          app.sortMenuOpen = false;
          history.replaceState(null, '', `${location.pathname}?tab=${app.tab()}&sort=${option.id}`);
          void app.updateComplete.then(() => document.querySelector<HTMLButtonElement>('.sort-trigger')?.focus());
        }}><span>{option.label}</span>{sort === option.id ? <span className="board-check" aria-hidden="true" /> : null}</button>)}
    </div> : null}
  </div>;
}

function BoardSelect({ app }: { app: AppController }) {
  const boards = boardChoices(app);
  const current = boards.find((b) => b.id === app.activeBoard())?.label ?? boards[0].label;
  return <div className="board-picker narrow-only" onBlur={(event) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) app.boardMenuOpen = false;
  }}>
    <button type="button" className="board-trigger" aria-label={`게시판: ${current}`} aria-expanded={app.boardMenuOpen}
      aria-controls="board-options" onClick={() => {
        app.boardMenuOpen = !app.boardMenuOpen;
        if (app.boardMenuOpen) void app.updateComplete.then(() => document.querySelector<HTMLButtonElement>('.board-option[aria-pressed="true"]')?.focus());
      }}>
      {current}<span className="board-chevron" aria-hidden="true" />
    </button>
    {app.boardMenuOpen ? <div id="board-options" className="board-options" role="group" aria-label="게시판 선택"
      onKeyDown={(event) => moveFocus(event, '.board-option')}>
      {boards.map((b) => <button type="button" className="board-option" key={b.id} aria-pressed={app.activeBoard() === b.id}
        onClick={() => { app.setBoard(b.id); void app.updateComplete.then(() => document.querySelector<HTMLButtonElement>('.board-picker .board-trigger')?.focus()); }}>
        <span>{b.label}</span>{app.activeBoard() === b.id ? <span className="board-check" aria-hidden="true" /> : null}</button>)}
    </div> : null}
  </div>;
}

function SaveButton({ app, notice }: { app: AppController; notice: Notice }) {
  const saved = app.isSaved(notice);
  return <button type="button" className="icon-button save-button" aria-pressed={saved}
    aria-label={saved ? '저장 지우기' : '저장하기'} title={saved ? '저장 지우기 (S)' : '저장하기 (S)'} aria-keyshortcuts="s"
    onClick={() => app.toggleSave(notice)}><Icon name={saved ? 'bookmark-on' : 'bookmark'} /></button>;
}

function Detail({ app, notice }: { app: AppController; notice: Notice }) {
  const judgement = app.judgement(notice);
  return <notice-detail-screen model={{
    notice, source: boardName(app.sources.find((source) => source.id === notice.source_id), notice.source_id),
    today: todayKst(), body: app.body(notice), interests: app.interests(notice),
    ai: judgement?.ai ?? null, rule: judgement?.rule_name ?? null, notified: !!judgement?.notified,
    retry: () => { app.bodies.delete(notice.id); app.requestUpdate(); },
  }} />;
}

/** 휴대폰 앱 안 상세 화면: 뒤로 가기, 상세, 바닥의 원문 열기 */
function ReadingView({ app, notice }: { app: AppController; notice: Notice }) {
  return <Fragment>
    <header className="pane-head topbar glass">
      <button type="button" className="icon-button back" aria-label="목록으로" onClick={() => history.back()}><Icon name="back" /></button>
      <div className="topbar-text"><h1>공지</h1></div>
    </header>
    <div className="reading"><Detail app={app} notice={notice} /></div>
    <div className="read-actions glass">
      <SaveButton app={app} notice={notice} />
      {'share' in navigator
        ? <button type="button" className="ghost-button" onClick={() => { void app.share(notice); }}>공유하기</button>
        : <button type="button" className="ghost-button" onClick={() => { void app.copyLink(notice); }}>링크 복사하기</button>}
      <a className="solid-button" href={safeUrl(notice.url)} target="_blank" rel="noopener">원문 열기</a>
    </div>
  </Fragment>;
}

// 단축키 창은 네이티브 dialog로 연다(포커스 가두기와 Esc 닫기를 브라우저가 맡는다).
function ShortcutsDialog({ app }: { app: AppController }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { const dialog = ref.current; if (dialog && !dialog.open) dialog.showModal(); }, []);
  return <dialog ref={ref} className="shortcuts" aria-labelledby="shortcuts-title" onClose={() => { app.shortcutsOpen = false; }}
    onClick={(event) => { if (event.target === event.currentTarget) event.currentTarget.close(); }}>
    <div className="dialog-head">
      <h2 id="shortcuts-title">단축키</h2>
      <button type="button" className="icon-button" aria-label="닫기" onClick={(event) => event.currentTarget.closest('dialog')?.close()}><Icon name="close" /></button>
    </div>
    {SHORTCUTS.map((section) => <section className="shortcut-group" key={section.group}>
      <h3>{section.group}</h3>
      <dl>{section.items.map(([label, keys]) => <div key={label}><dt>{label}</dt><dd><Kbd keys={keys} /></dd></div>)}</dl>
    </section>)}
    <p className="dialog-foot">위아래 화살표로도 공지를 옮길 수 있어요</p>
  </dialog>;
}
