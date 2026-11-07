// 설정 화면. 구조와 문구는 원본(첫 쪽 → 하위 쪽)을 따르고, 계정·게시판·내 정보는 다중 사용자 구조에 맞췄다.
// 스위치는 바로 반영되는 설정에만 쓰고(role="switch"), 켜짐·꺼짐을 글자로도 알린다(색에만 의존하지 않는다).
import { createRoot, type Root } from 'react-dom/client';
import { useEffect, useMemo, useState, type MouseEvent, type ReactNode } from 'react';
import type { ByokStatus } from './byok';
import { ENROLLMENT, MILITARY, type UserProfile } from './profile';
import { programLabel } from './skku-programs';
import { BOARD_CATALOG, COLLEGE_BOARD, DEPARTMENT_BOARD } from './skku-boards';
import { SwitchRow } from './ui';

export interface SettingsModel {
  configured: boolean;
  userId: string | null;
  email: string | null;
  authBusy: boolean;
  authError: string;
  signIn: () => void;
  signOut: () => void;
  /** 설정의 하위 쪽: notifications, keywords, profile, keys. null이면 첫 쪽. */
  section: string | null;
  openSection: (section: string | null) => void;
  // 화면
  theme: 'auto' | 'light' | 'dark';
  setTheme: (theme: 'auto' | 'light' | 'dark') => void;
  canInstall: boolean;
  install: () => void;
  showShortcuts: () => void;
  // 게시판
  sources: { id: string; label: string }[];
  subscriptions: string[];
  subscriptionsOnly: boolean;
  setSubscriptionsOnly: (enabled: boolean) => void;
  loading: boolean;
  error: string;
  toggle: (id: string, enabled: boolean) => void;
  retry: () => void;
  // 키워드
  keywords: string[];
  keywordNote: string;
  addKeyword: (word: string) => void;
  removeKeyword: (word: string) => void;
  // 알림
  pushStatus: 'unsupported' | 'checking' | 'off' | 'on' | 'busy' | 'denied';
  pushError: string;
  pushRetry?: boolean;
  enablePush: () => void;
  disablePush: () => void;
  testNotification: () => void;
  // 내 정보
  profile: UserProfile;
  profileStatus: 'idle' | 'loading' | 'ready' | 'unavailable';
  profileMessage: string;
  profileError: string;
  saveProfile: (profile: UserProfile) => void;
  openOnboarding: () => void;
  byok?: {
    available: boolean;
    loading: boolean;
    busy: boolean;
    error: string;
    status: ByokStatus | null;
    register: (apiKey: string) => void;
    remove: () => void;
  };
}

type Theme = SettingsModel['theme'];
const THEMES: [Theme, string][] = [['auto', '자동'], ['light', '밝게'], ['dark', '어둡게']];
const YEARS = [1, 2, 3, 4, 5];
const SEMESTERS = [1, 2];

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return <section aria-labelledby={id}><h2 id={id} className="settings-head">{title}</h2><div className="box">{children}</div></section>;
}

function Setting({ name, help, children, className = '' }: { name: string; help?: ReactNode; children?: ReactNode; className?: string }) {
  return <div className={`setting ${className}`}>
    <div className="setting-text"><p className="setting-name">{name}</p>{help ? <p className="setting-help">{help}</p> : null}</div>
    {children ? <div className="setting-control">{children}</div> : null}
  </div>;
}

function Choice<T extends string | number>({ label, options, value, onPick, disabled }: {
  label: string; options: readonly (readonly [T, string])[]; value: T | null; onPick: (value: T) => void; disabled?: boolean;
}) {
  return <div className="segmented" role="radiogroup" aria-label={label}>
    {options.map(([option, text]) => <button type="button" role="radio" key={String(option)} aria-checked={value === option}
      disabled={disabled} onClick={() => onPick(option)}>{text}</button>)}
  </div>;
}

function SettingsLink({ model, label, help, section }: { model: SettingsModel; label: string; help: string; section: string }) {
  const href = section === 'keys' ? '?view=settings&keys=1' : `?view=settings&section=${section}`;
  // 일반 클릭은 앱 안에서 넘어가고, 새 탭 같은 동작은 브라우저에 맡긴다.
  const open = (event: MouseEvent) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    model.openSection(section);
  };
  return <a className="settings-link" href={href} onClick={open}>
    <span><span className="setting-name">{label}</span><span className="setting-help">{help}</span></span>
    <span className="settings-chevron" aria-hidden="true" />
  </a>;
}

function Back({ model }: { model: SettingsModel }) {
  return <a className="settings-back" href="?view=settings" onClick={(event) => { event.preventDefault(); model.openSection(null); }}>설정으로</a>;
}

function LoginNote({ model, what }: { model: SettingsModel; what: string }) {
  return <Setting name="로그인이 필요해요" help={`${what}은 로그인하면 쓸 수 있어요`}>
    {model.configured
      ? <button type="button" className="solid-button" disabled={model.authBusy} onClick={model.signIn}>Google 계정으로 계속하기</button>
      : <p className="field-note">로그인 연결을 준비하고 있어요.</p>}
  </Setting>;
}

function profileSummary(profile: UserProfile): string {
  if (!profile.programs.length) return '전공과 학년을 알려 주세요';
  const [main, ...rest] = profile.programs;
  return `${programLabel(main)}${rest.length ? ` 외 ${rest.length}개` : ''}${profile.year ? ` · ${profile.year >= 5 ? '5학년 이상' : `${profile.year}학년`}` : ''}`;
}

function Overview({ model }: { model: SettingsModel }) {
  return <div className="settings settings-overview">
    <Section id="s-preferences" title="내 설정">
      <SettingsLink model={model} label="알림" help="받을 게시판과 이 기기 알림" section="notifications" />
      <SettingsLink model={model} label="관심 키워드" help={model.keywords.length ? `${model.keywords.length}개 키워드를 쓰고 있어요` : '관심 있는 공지를 골라 봐요'} section="keywords" />
      <SettingsLink model={model} label="내 정보" help={model.userId ? profileSummary(model.profile) : '전공과 학년을 저장해요'} section="profile" />
    </Section>
    <Section id="s-account" title="계정">
      <Setting name="계정" help={model.userId ? '이 기기에서 로그인한 계정이에요' : '로그인하면 구독과 저장이 계정에 남아요'}>
        {!model.configured ? <p className="field-note">로그인 연결을 준비하고 있어요.</p> : model.userId
          ? <><p className="field-note">{model.email ?? '로그인됨'}</p>
            <button type="button" className="ghost-button" disabled={model.authBusy} onClick={model.signOut}>이 기기에서 로그아웃</button></>
          : <button type="button" className="solid-button" disabled={model.authBusy} onClick={model.signIn}>Google 계정으로 계속하기</button>}
        {model.authError ? <p className="field-note error" role="alert">{model.authError}</p> : null}
      </Setting>
      {model.userId ? <SettingsLink model={model} label="연결 키" help="Gemini 키와 지원 자격 정보" section="keys" /> : null}
    </Section>
    <Section id="s-view" title="화면">
      <Setting name="화면 모드" help="자동은 휴대폰과 PC 설정을 따라요">
        <Choice label="화면 모드" options={THEMES} value={model.theme} onPick={model.setTheme} />
      </Setting>
      {model.canInstall ? <Setting name="앱 설치" help="바탕화면이나 홈 화면에서 바로 열어요">
        <button type="button" className="ghost-button" onClick={model.install}>앱으로 설치하기</button>
      </Setting> : null}
      <Setting name="단축키" help="키보드로 빠르게 이동해요" className="kbd-only">
        <button type="button" className="ghost-button" aria-keyshortcuts="?" onClick={model.showShortcuts}>단축키 보기</button>
      </Setting>
    </Section>
  </div>;
}

const permissionText = (status: SettingsModel['pushStatus']) =>
  status === 'unsupported' ? '지원하지 않음'
    : typeof Notification === 'undefined' ? '확인할 수 없음'
      : Notification.permission === 'granted' ? '허용' : Notification.permission === 'denied' ? '차단' : '아직 선택하지 않음';

function BoardGroups({ model }: { model: SettingsModel }) {
  const [query, setQuery] = useState('');
  const collegeOf = useMemo(() => {
    const map = new Map<string, string>();
    for (const [college, id] of Object.entries(COLLEGE_BOARD)) map.set(id, college);
    for (const [key, id] of Object.entries(DEPARTMENT_BOARD)) if (!map.has(id)) map.set(id, key.split('/')[0]);
    return map;
  }, []);
  const known = new Set(BOARD_CATALOG.map((board) => board.id));
  const mine = model.sources.filter((source) => model.subscriptions.includes(source.id));
  const needle = query.replace(/\s+/g, '').toLowerCase();
  const others = model.sources.filter((source) => !model.subscriptions.includes(source.id)
    && (!needle || source.label.replace(/\s+/g, '').toLowerCase().includes(needle)));
  const groups = new Map<string, typeof others>();
  for (const source of others) {
    const group = collegeOf.get(source.id) ?? (known.has(source.id) ? '기타' : '학교 공통');
    groups.set(group, [...(groups.get(group) ?? []), source]);
  }
  const busy = model.loading;
  return <>
    {mine.length ? mine.map((source) => <SwitchRow key={source.id} label={source.label} checked disabled={busy} onChange={() => model.toggle(source.id, false)} />)
      : <p className="field-note">아직 받는 게시판이 없어요. 아래에서 골라 주세요</p>}
    <details className="connection-manual" open={mine.length === 0}>
      <summary>게시판 더 보기 ({others.length}개)</summary>
      <input className="input" type="search" aria-label="게시판 검색" placeholder="학과나 단과대 이름으로 찾기" autoComplete="off" value={query}
        onChange={(event) => setQuery(event.currentTarget.value)} />
      {[...groups].map(([group, items]) => <div className="board-group" key={group} role="group" aria-label={group}>
        <p className="board-group-title">{group}</p>
        {items.map((source) => <SwitchRow key={source.id} label={source.label} checked={false} disabled={busy} onChange={() => model.toggle(source.id, true)} />)}
      </div>)}
      {others.length === 0 ? <p className="field-note" role="status">{query ? `'${query}'에 맞는 게시판이 없어요` : '모든 게시판을 받고 있어요'}</p> : null}
    </details>
  </>;
}

function Notifications({ model }: { model: SettingsModel }) {
  const on = model.pushStatus === 'on';
  return <div className="settings">
    <Back model={model} />
    <Section id="s-notify" title="알림 받을 곳">
      <Setting name="이 기기 알림" help="앱과 탭을 닫아도 브라우저가 켜져 있으면 휴대폰이나 PC 알림으로 받아요. 소리는 기기의 알림 설정을 따라요">
        {!model.userId ? <p className="field-note">로그인하면 이 기기로 알림을 받을 수 있어요</p> : <>
          <span className="setting-state">{on ? '켜짐' : '꺼짐'}</span>
          <p className="field-note">브라우저 알림 권한: {permissionText(model.pushStatus)}</p>
          <div className="inline">
            {on
              ? <><button type="button" className="ghost-button" onClick={model.disablePush}>알림 끄기</button>
                <button type="button" className="ghost-button" onClick={model.testNotification}>테스트 알림 띄우기</button></>
              : <button type="button" className="ghost-button" disabled={model.pushStatus !== 'off'} onClick={model.enablePush}>
                {model.pushStatus === 'busy' ? '연결 중' : model.pushStatus === 'checking' ? '확인하고 있어요' : model.pushRetry ? '다시 시도하기' : '알림 받기'}</button>}
          </div>
          {model.pushStatus === 'unsupported' ? <p className="field-note">최신 브라우저에서 알림을 연결해 주세요</p> : null}
          {model.pushStatus === 'denied' ? <p className="field-note">브라우저 설정에서 알림을 허용하면 다시 켤 수 있어요</p> : null}
          {model.pushError ? <p className="field-note error" role="alert">{model.pushError}</p> : null}
          {on && model.subscriptions.length === 0 ? <p className="field-note">받을 게시판을 고르면 새 공지를 알려드려요</p> : null}
          <p className="field-note">알림 수신은 이 기기에만 적용해요</p>
        </>}
      </Setting>
      <Setting name="받을 공지" help="알림을 보내는 기준이에요">
        <p className="field-note">받는 게시판의 새 공지를 알려요. 관심 키워드와 맞는 공지는 소리로, 나머지는 조용히 알려요. 학교가 고친 중요한 글은 한 번 더 알려요. 인턴 공고는 내 Gemini 키가 지원할 만하다고 판단한 공고만 알려요</p>
      </Setting>
    </Section>
    <Section id="s-boards" title="받을 게시판">
      {!model.userId ? <LoginNote model={model} what="게시판 구독" /> : <>
        <Setting name="게시판" help="알림을 받고 목록에 모아 볼 게시판이에요">
          {model.error ? <><p className="field-note error" role="alert">{model.error}</p>
            <button type="button" className="ghost-button" onClick={model.retry}>다시 불러오기</button></> : null}
          <BoardGroups model={model} />
        </Setting>
        <Setting name="목록 보기" help="성대 공지 탭에 보일 공지를 정해요">
          <Choice label="목록 보기" value={model.subscriptionsOnly ? 'mine' : 'all'} disabled={model.loading || !!model.error}
            options={[['all', '모든 게시판'], ['mine', '받는 게시판만']]} onPick={(value) => model.setSubscriptionsOnly(value === 'mine')} />
        </Setting>
      </>}
    </Section>
  </div>;
}

function Keywords({ model }: { model: SettingsModel }) {
  const [draft, setDraft] = useState('');
  const add = () => { model.addKeyword(draft); setDraft(''); };
  return <div className="settings">
    <Back model={model} />
    <section aria-labelledby="s-keywords">
      <h2 id="s-keywords" className="settings-head">관심 키워드</h2>
      <div className="box">
        <Setting name="키워드" help={'제목이나 본문에 이 글자가 그대로 들어간 공지를 "관심"으로 표시해요'}>
          <div className="inline">
            <input className="input" type="text" autoComplete="off" aria-label="새 키워드" placeholder="예: 겨울방학 인턴" value={draft}
              onChange={(event) => setDraft(event.currentTarget.value)}
              onKeyDown={(event) => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); add(); } }} />
            <button type="button" className="ghost-button" onClick={add}>추가하기</button>
          </div>
          {model.keywords.length ? <ul className="keyword-list">{model.keywords.map((word) => <li key={word}><span>{word}</span>
            <button type="button" className="text-button" aria-label={`${word} 삭제`} onClick={() => model.removeKeyword(word)}>삭제</button></li>)}</ul> : null}
          {model.keywordNote ? <p className="field-note" role="status">{model.keywordNote}</p>
            : model.userId ? null : <p className="field-note">로그인하면 다른 기기와 같은 키워드를 써요</p>}
        </Setting>
      </div>
    </section>
  </div>;
}

function Profile({ model }: { model: SettingsModel }) {
  const { profile } = model;
  const save = (patch: Partial<UserProfile>) => model.saveProfile({ ...profile, ...patch });
  const [main, ...doubles] = profile.programs;
  return <div className="settings">
    <Back model={model} />
    <Section id="s-profile" title="내 정보">
      {!model.userId ? <LoginNote model={model} what="내 정보" /> : <>
        <Setting name="전공" help="공지를 받을 게시판을 고를 때 참고해요">
          <dl className="info-list">
            <div><dt>주전공</dt><dd>{main ? `${programLabel(main)}${main.department ? ` (${main.college})` : ''}` : '아직 없어요'}</dd></div>
            <div><dt>복수전공</dt><dd>{doubles.length ? doubles.map(programLabel).join(', ') : '없어요'}</dd></div>
          </dl>
          <button type="button" className="ghost-button" onClick={model.openOnboarding}>전공과 게시판 다시 고르기</button>
        </Setting>
        <Setting name="학년"><Choice label="학년" value={profile.year} disabled={model.profileStatus !== 'ready'}
          options={YEARS.map((year) => [year, year === 5 ? '5학년 이상' : `${year}학년`] as const)} onPick={(year) => save({ year })} /></Setting>
        <Setting name="재학 상태"><Choice label="재학 상태" value={profile.enrollmentStatus} disabled={model.profileStatus !== 'ready'}
          options={ENROLLMENT.map((value) => [value, value] as const)} onPick={(enrollmentStatus) => save({ enrollmentStatus })} /></Setting>
        {model.profileMessage ? <p className="field-note ok" role="status">{model.profileMessage}</p> : null}
        {model.profileError ? <p className="field-note error" role="alert">{model.profileError}</p> : null}
        {model.profileStatus === 'unavailable' ? <p className="field-note">지금은 내 정보를 불러올 수 없어요. 잠시 뒤 다시 열어 주세요</p> : null}
      </>}
    </Section>
  </div>;
}

function Keys({ model }: { model: SettingsModel }) {
  const { profile, byok } = model;
  const [apiKey, setApiKey] = useState('');
  useEffect(() => { if (byok?.status) setApiKey(''); }, [byok?.status?.keyHint]);
  const save = (patch: Partial<UserProfile>) => model.saveProfile({ ...profile, ...patch });
  if (!model.userId) return <div className="settings"><Back model={model} /><Section id="s-keys" title="연결 키"><LoginNote model={model} what="연결 키" /></Section></div>;
  return <div className="settings">
    <Back model={model} />
    {byok?.available ? <Section id="s-gemini" title="Gemini 키">
      <Setting name="인턴 공고 알림 (선택)" help="링커리어와 자소설닷컴의 인턴 공고를 내 Gemini 키로 살펴보고, 나에게 맞는 공고만 알려드려요. 키가 없어도 다른 알림은 그대로예요">
        {byok.loading ? <p className="field-note" role="status">불러오고 있어요.</p> : byok.status
          ? <><p className="field-note">등록된 키 ····{byok.status.keyHint}{byok.status.disabled ? ' (사용 중지됨)' : ''}</p>
            {byok.status.lastError ? <p className="field-note error" role="alert">{byok.status.lastError}</p> : null}
            <button type="button" className="ghost-button" disabled={byok.busy} onClick={() => byok.remove()}>키 지우기</button></>
          : <><input className="input" type="password" autoComplete="off" spellCheck={false} aria-label="Gemini API 키" value={apiKey}
            disabled={byok.busy} onChange={(event) => setApiKey(event.currentTarget.value.trim())} />
            <p className="field-note">키는 암호화해 서버에만 저장하고, 나에게 맞는 공고를 고르는 데만 써요</p>
            <button type="button" className="solid-button" disabled={byok.busy || !apiKey} onClick={() => byok.register(apiKey)}>
              {byok.busy ? '확인하고 있어요' : '키 등록하기'}</button></>}
        {byok.error ? <p className="field-note error" role="alert">{byok.error}</p> : null}
      </Setting>
    </Section> : null}
    <Section id="s-eligibility" title="지원 자격 확인용 정보">
      <Setting name="학기" help="공고의 지원 자격을 가릴 때만 써요. 이름이나 학번은 받지 않아요">
        <Choice label="학기" value={profile.semester} disabled={model.profileStatus !== 'ready'} options={SEMESTERS.map((value) => [value, `${value}학기`] as const)} onPick={(semester) => save({ semester })} />
      </Setting>
      <Setting name="병역">
        <Choice label="병역" value={profile.militaryService} disabled={model.profileStatus !== 'ready'} options={MILITARY.map((value) => [value, value] as const)} onPick={(militaryService) => save({ militaryService })} />
      </Setting>
      {model.profileMessage ? <p className="field-note ok" role="status">{model.profileMessage}</p> : null}
      {model.profileError ? <p className="field-note error" role="alert">{model.profileError}</p> : null}
      {model.profileStatus === 'unavailable' ? <p className="field-note">지금은 내 정보를 불러올 수 없어요. 잠시 뒤 다시 열어 주세요</p> : null}
    </Section>
  </div>;
}

export function PlatformSettings({ model }: { model: SettingsModel }) {
  switch (model.section) {
    case 'notifications': return <Notifications model={model} />;
    case 'keywords': return <Keywords model={model} />;
    case 'profile': return <Profile model={model} />;
    case 'keys': return <Keys model={model} />;
    default: return <Overview model={model} />;
  }
}

// 앱 셸이 설정 쪽을 정하고, 개별 화면은 React로 그린다(테스트가 model을 직접 넣을 수 있게 요소 경계를 둔다).
class PlatformSettingsElement extends HTMLElement {
  private root: Root | null = null;
  private current: SettingsModel | null = null;
  set model(value: SettingsModel) { this.current = value; this.renderReact(); }
  connectedCallback() { this.root = createRoot(this); this.renderReact(); }
  disconnectedCallback() { this.root?.unmount(); this.root = null; }
  private renderReact() { if (this.root && this.current) this.root.render(<PlatformSettings key={this.current.userId ?? 'guest'} model={this.current} />); }
}
customElements.define('platform-settings-screen', PlatformSettingsElement);
