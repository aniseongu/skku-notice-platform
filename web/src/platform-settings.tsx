// 설정 화면. 구조와 문구는 원본(첫 쪽 → 하위 쪽)을 따르고, 계정·게시판·내 정보는 다중 사용자 구조에 맞췄다.
// 스위치는 바로 반영되는 설정에만 쓰고(role="switch"), 켜짐·꺼짐을 글자로도 알린다(색에만 의존하지 않는다).
import { createRoot, type Root } from 'react-dom/client';
import { useEffect, useMemo, useState, type MouseEvent, type ReactNode } from 'react';
import type { ByokStatus, CanvasStatus } from './byok';
import { CANVAS_MODES, composeSummaryTime, summaryParts, validDeviceName, type CanvasMode, type Device } from './devices';
import { ENROLLMENT, MILITARY, PROFILE_TEXT_LIMIT, type ProfileTextField, type UserProfile } from './profile';
import { programLabel } from './skku-programs';
import { BOARD_CATALOG, COLLEGE_BOARD, DEPARTMENT_BOARD, OTHER_BOARDS } from './skku-boards';
import { Avatar, SwitchRow } from './ui';

export interface SettingsModel {
  configured: boolean;
  userId: string | null;
  email: string | null;
  name: string | null;
  avatar: string | null;
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
  account?: { busy: boolean; error: string; remove: () => void };
  devicesInfo?: {
    devices: Device[];
    thisId: string | null;
    summaryTime: string | null;
    hasCanvasToken: boolean;
    busy: boolean;
    error: string;
    refresh: () => void;
    setMode: (mode: string) => void;
    remove: (id: string) => void;
    rename: (id: string, name: string) => Promise<boolean>;
    setSummaryTime: (period: 'am' | 'pm', hour: number, minute: number) => void;
  };
  calendar?: {
    auto: { active: boolean; error: string | null; lastRunAt: string | null };
    id: string | null;
    syncedAt: string | null;
    busy: boolean;
    message: string;
    error: string;
    savedCount: number;
    connect: () => void;
    sync: () => void;
    disconnect: () => void;
  };
  byok?: {
    available: boolean;
    loading: boolean;
    busy: boolean;
    error: string;
    status: ByokStatus | null;
    register: (apiKey: string) => void;
    remove: () => void;
    canvas: CanvasStatus | null;
    canvasBusy: boolean;
    canvasError: string;
    registerCanvas: (token: string) => void;
    removeCanvas: () => void;
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
      : <p className="field-note">지금은 로그인할 수 없어요. 잠시 뒤 다시 열어 주세요</p>}
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
      <SettingsLink model={model} label="구글 캘린더" help={model.calendar?.id ? '저장한 공지의 마감을 캘린더에 넣고 있어요' : '저장한 공지의 마감을 구글 캘린더에 넣어요'} section="calendar" />
      <SettingsLink model={model} label="관심 키워드" help={model.keywords.length ? `${model.keywords.length}개 키워드를 쓰고 있어요` : '관심 있는 공지를 골라 봐요'} section="keywords" />
    </Section>
    <Section id="s-account" title="계정">
      {model.userId ? <>
        <div className="account-row">
          <Avatar src={model.avatar} size={56} />
          <div><span className="setting-name">{model.name ?? model.email ?? '로그인됨'}</span>
            {model.name && model.email ? <span className="setting-help">{model.email}</span> : null}</div>
        </div>
        <SettingsLink model={model} label="프로필 설정" help={profileSummary(model.profile)} section="profile" />
        <SettingsLink model={model} label="연결 키" help="Gemini 키와 아이캠퍼스 토큰" section="keys" />
        <DeleteAccount model={model} />
        <Setting name="로그아웃" help="이 기기에서만 나가요. 구독과 저장은 계정에 남아요">
          <button type="button" className="ghost-button" disabled={model.authBusy} onClick={model.signOut}>이 기기에서 로그아웃</button>
          {model.authError ? <p className="field-note error" role="alert">{model.authError}</p> : null}
        </Setting>
      </> : <Setting name="계정" help="로그인하면 구독과 저장이 계정에 남아요">
        {!model.configured ? <p className="field-note">지금은 로그인할 수 없어요. 잠시 뒤 다시 열어 주세요</p>
          : <button type="button" className="solid-button" disabled={model.authBusy} onClick={model.signIn}>Google 계정으로 계속하기</button>}
        {model.authError ? <p className="field-note error" role="alert">{model.authError}</p> : null}
      </Setting>}
    </Section>
    <Section id="s-view" title="화면">
      <Setting name="화면 모드" help="자동은 휴대폰과 PC 설정을 따라요">
        <Choice label="화면 모드" options={THEMES} value={model.theme} onPick={model.setTheme} />
      </Setting>
      {model.userId ? <Setting name="목록 보기" help="성대 공지 탭에 보일 공지를 정해요">
        <Choice label="목록 보기" value={model.subscriptionsOnly ? 'mine' : 'all'} disabled={model.loading || !!model.error}
          options={[['all', '모든 게시판'], ['mine', '받는 게시판만']]} onPick={(value) => model.setSubscriptionsOnly(value === 'mine')} />
      </Setting> : null}
      <Setting name="개인정보 처리방침" help="어떤 정보를 어디에 쓰고 어떻게 지우는지 알려 드려요">
        <a className="settings-link inline-link" href="privacy.html" target="_blank" rel="noopener">처리방침 보기</a>
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
  const otherGroup = new Map(OTHER_BOARDS.map((board) => [board.id, board.group]));
  const mine = model.sources.filter((source) => model.subscriptions.includes(source.id));
  const needle = query.replace(/\s+/g, '').toLowerCase();
  const others = model.sources.filter((source) => !model.subscriptions.includes(source.id)
    && (!needle || source.label.replace(/\s+/g, '').toLowerCase().includes(needle)));
  const groups = new Map<string, typeof others>();
  for (const source of others) {
    const group = otherGroup.get(source.id) ?? collegeOf.get(source.id) ?? (known.has(source.id) ? '기타' : '학교 공통');
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

/** 하루 요약 시간: 원본처럼 오전·오후, 시, 분을 따로 고른다. 바꾸는 즉시 저장한다. */
function SummaryTime({ info }: { info: NonNullable<SettingsModel['devicesInfo']> }) {
  const saved = summaryParts(info.summaryTime ?? '21:00');
  const [period, setPeriod] = useState<'am' | 'pm'>(saved.period);
  const [hour, setHour] = useState(String(saved.hour));
  const [minute, setMinute] = useState(String(saved.minute).padStart(2, '0'));
  // 저장된 값이 바뀌면(불러왔을 때, 저장했을 때) 입력칸도 맞춘다. 누른 즉시는 입력칸이 먼저 바뀌어서 눌린 모양이 바로 보인다.
  useEffect(() => { const next = summaryParts(info.summaryTime ?? '21:00'); setPeriod(next.period); setHour(String(next.hour)); setMinute(String(next.minute).padStart(2, '0')); }, [info.summaryTime]);
  const disabled = info.summaryTime === null || info.busy;
  const commit = (period: 'am' | 'pm', h: string, m: string) => {
    if (composeSummaryTime(period, Number(h), Number(m)) === (info.summaryTime ?? '')) return;
    info.setSummaryTime(period, Number(h), Number(m));
  };
  return <div className="time-control" role="group" aria-labelledby="summary-time-label">
    <Choice label="오전 또는 오후" value={period} disabled={disabled} options={[['am', '오전'], ['pm', '오후']] as const}
      onPick={(next) => { setPeriod(next); commit(next, hour, minute); }} />
    <div className="time-numbers">
      <input className="input time-number" type="number" min={1} max={12} inputMode="numeric" aria-label="시" value={hour} disabled={disabled}
        onChange={(event) => setHour(event.currentTarget.value)} onBlur={() => commit(period, hour, minute)} /><span>시</span>
      <input className="input time-number" type="number" min={0} max={59} inputMode="numeric" aria-label="분" value={minute} disabled={disabled}
        onChange={(event) => setMinute(event.currentTarget.value)} onBlur={() => commit(period, hour, minute)} /><span>분</span>
    </div>
  </div>;
}

/** 계정 지우기: 되돌릴 수 없어서 한 번 더 확인한다. 버튼 이름으로 무엇이 지워지는지 먼저 알려 준다. */
function DeleteAccount({ model }: { model: SettingsModel }) {
  const account = model.account;
  const [confirming, setConfirming] = useState(false);
  if (!account) return null;
  return <Setting name="계정 지우기" help="계정과 구독, 키워드, 저장한 공지, 프로필, 연결한 키와 토큰을 모두 지워요. 되돌릴 수 없어요">
    {confirming ? <>
      <p className="field-note error" role="alert">정말 지울까요? 지운 정보는 다시 가져올 수 없어요</p>
      <div className="inline">
        <button type="button" className="solid-button danger" disabled={account.busy} onClick={account.remove}>{account.busy ? '지우고 있어요' : '네, 모두 지울게요'}</button>
        <button type="button" className="ghost-button" disabled={account.busy} onClick={() => setConfirming(false)}>그만둘게요</button>
      </div>
    </> : <button type="button" className="ghost-button" onClick={() => setConfirming(true)}>계정 지우기</button>}
    {account.error ? <p className="field-note error" role="alert">{account.error}</p> : null}
  </Setting>;
}

/** 알림 기기 한 줄: 이름(모델이나 기기 종류), 등록일, 아캠 알림 모드. 이름은 바꿀 수 있고 이 기기가 아닌 기기는 지울 수 있다. */
function DeviceRow({ device, info }: { device: Device; info: NonNullable<SettingsModel['devicesInfo']> }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(device.name ?? '');
  const name = device.name ?? '이름 없는 기기';
  const save = async () => { if (validDeviceName(draft) && await info.rename(device.id, draft)) setEditing(false); };
  return <li>
    {editing
      ? <div className="inline">
        <input className="input" aria-label={`${name} 이름`} value={draft} maxLength={40} autoFocus onChange={(event) => setDraft(event.currentTarget.value)}
          onKeyDown={(event) => { if (event.key === 'Enter') void save(); if (event.key === 'Escape') setEditing(false); }} />
        <button type="button" className="solid-button" disabled={info.busy || !validDeviceName(draft)} onClick={() => void save()}>저장하기</button>
        <button type="button" className="ghost-button" disabled={info.busy} onClick={() => setEditing(false)}>닫기</button>
      </div>
      : <span className="device-name">{name}{device.id === info.thisId ? <b className="badge">이 기기</b> : null}</span>}
    <span className="field-note">{device.createdAt ? `${new Date(device.createdAt).toLocaleDateString('ko-KR', { month: 'long', day: 'numeric' })}에 등록` : ''} · 아캠 알림 {CANVAS_MODES.find(([mode]) => mode === device.canvasMode)?.[1]}</span>
    {editing ? null : <span className="device-actions">
      <button type="button" className="text-button" disabled={info.busy} aria-label={`${name} 이름 바꾸기`} onClick={() => { setDraft(device.name ?? ''); setEditing(true); }}>이름 바꾸기</button>
      {device.id === info.thisId ? null
        : <button type="button" className="text-button" disabled={info.busy} aria-label={`${name} 지우기`} onClick={() => info.remove(device.id)}>지우기</button>}
    </span>}
  </li>;
}

function Notifications({ model }: { model: SettingsModel }) {
  const on = model.pushStatus === 'on';
  const info = model.devicesInfo;
  const refresh = info?.refresh;
  // 설정 쪽을 열 때와 이 기기 알림을 켜고 끌 때 기기 목록을 다시 읽는다.
  useEffect(() => { if (model.userId) refresh?.(); }, [model.userId, model.pushStatus]);
  const thisDevice = info?.devices.find((device) => device.id === info.thisId) ?? null;
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
          {model.pushStatus === 'unsupported' ? <p className="field-note">이 브라우저는 알림을 지원하지 않아요. 최신 브라우저에서 열어 주세요</p> : null}
          {model.pushStatus === 'denied' ? <p className="field-note">브라우저 설정에서 알림을 허용하면 다시 켤 수 있어요</p> : null}
          {model.pushError ? <p className="field-note error" role="alert">{model.pushError}</p> : null}
          {on && model.subscriptions.length === 0 ? <p className="field-note">받을 게시판을 고르면 새 공지를 알려드려요</p> : null}
          <p className="field-note">알림 수신은 이 기기에만 적용해요</p>
        </>}
      </Setting>
      {model.userId && info ? <>
        <Setting name="이 기기 아캠 알림" help="아이캠퍼스의 하루 요약과 마감을 이 기기로 받을지 정해요">
          <Choice label="이 기기 아캠 알림" value={on ? (thisDevice?.canvasMode ?? 'reminders') : null} options={CANVAS_MODES}
            disabled={!on || !thisDevice || !info.hasCanvasToken || info.busy} onPick={(mode: CanvasMode) => info.setMode(mode)} />
          <p className="field-note">{!on ? '먼저 이 기기 알림을 켜 주세요' : !info.hasCanvasToken ? '연결 키에서 아이캠퍼스 토큰을 저장해 주세요' : '요약과 마감을 고르면 하루 전과 3시간 전에도 알려요'}</p>
        </Setting>
        <Setting name="하루 요약 시간" help="모든 기기에 같은 시간을 적용해요. 할 일이 없어도 알려요">
          <p className="setting-name visually-hidden" id="summary-time-label">하루 요약 시간</p>
          <SummaryTime info={info} />
          {info.summaryTime === null ? <p className="field-note">연결 키에서 아이캠퍼스 토큰을 저장하면 바꿀 수 있어요</p> : <p className="field-note">확인이 늦어지면 알림도 늦어져요</p>}
          {info.error ? <p className="field-note error" role="alert">{info.error}</p> : null}
        </Setting>
      </> : null}
      <Setting name="받을 공지" help="알림을 보내는 기준이에요">
        <ul className="rule-list">
          <li>받는 게시판의 새 공지를 알려요</li>
          <li>관심 키워드와 맞는 공지는 소리로, 나머지는 조용히 알려요</li>
          <li>학교가 고친 중요한 글은 한 번 더 알려요</li>
          <li>Gemini 키를 넣으면 나에게 맞는 공지도 소리로 알려요. 인턴 공고는 맞는 것만 알려요</li>
        </ul>
      </Setting>
    </Section>
    {model.userId && info && info.devices.length > 0 ? <Section id="s-devices" title="알림 기기">
      <Setting name="등록된 기기" help="알림을 받도록 켜 둔 기기예요. 이 기기는 위에서 끄고, 다른 기기는 여기서 지워요">
        <ul className="device-list">
          {info.devices.map((device) => <DeviceRow key={device.id} device={device} info={info} />)}
        </ul>
      </Setting>
    </Section> : null}
    <Section id="s-boards" title="받을 게시판">
      {!model.userId ? <LoginNote model={model} what="게시판 구독" /> : <>
        <Setting name="게시판" help="알림을 받고 목록에 모아 볼 게시판이에요">
          {model.error ? <><p className="field-note error" role="alert">{model.error}</p>
            <button type="button" className="ghost-button" onClick={model.retry}>다시 불러오기</button></> : null}
          <BoardGroups model={model} />
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

const TEXT_FIELDS: { key: ProfileTextField; name: string; help: string; placeholder: string }[] = [
  { key: 'interests', name: '관심 분야', help: '어떤 일이나 주제에 관심이 있는지 적어요', placeholder: '예: 인공지능, 백엔드 개발, 데이터 분석' },
  { key: 'wants', name: '받고 싶은 공지', help: '꼭 알고 싶은 공지의 종류를 적어요', placeholder: '예: 학부생이 지원할 수 있는 인턴, 장학금, 해커톤' },
  { key: 'avoids', name: '받고 싶지 않은 공지', help: '알림이 오지 않았으면 하는 공지를 적어요', placeholder: '예: 대학원생 전용 모집, 졸업생 대상 채용' },
];

/** Gemini에게 알려 줄 주관식 3칸. 글자 수를 세어 보여 주고 한 번에 저장한다(쓰는 중에 저장하지 않는다). */
function AboutMe({ model }: { model: SettingsModel }) {
  const { profile } = model;
  // 주관식 컬럼이 아직 없는 데이터가 들어와도 깨지지 않게 빈 글로 본다.
  const saved: Record<ProfileTextField, string> = { interests: profile.interests ?? '', wants: profile.wants ?? '', avoids: profile.avoids ?? '' };
  const stored = JSON.stringify([saved.interests, saved.wants, saved.avoids]);
  const [drafts, setDrafts] = useState<Record<ProfileTextField, string>>(saved);
  useEffect(() => setDrafts(saved), [stored]);
  // 글자 수는 저장될 값(앞뒤 공백 제외) 기준으로 센다.
  const length = (value: string) => [...value.trim()].length;
  const over = TEXT_FIELDS.some(({ key }) => length(drafts[key]) > PROFILE_TEXT_LIMIT);
  const changed = JSON.stringify([drafts.interests.trim(), drafts.wants.trim(), drafts.avoids.trim()]) !== stored;
  const ready = model.profileStatus === 'ready';
  return <Section id="s-about" title="나를 소개해요 (선택)">
    <div className="setting">
      <div className="setting-text"><p className="setting-name">Gemini가 읽는 내용</p>
        <p className="setting-help">나에게 맞는 공지와 인턴 공고를 고를 때 참고해요. Google로 보내는 내용이라 이름, 학번, 연락처, 주소는 적지 마세요</p></div>
    </div>
    {TEXT_FIELDS.map(({ key, name, help, placeholder }) => {
      const count = length(drafts[key]);
      return <Setting key={key} name={name} help={help}>
        <textarea className="input" rows={3} aria-label={name} placeholder={placeholder} value={drafts[key]} disabled={!ready}
          aria-describedby={`count-${key}`} onChange={(event) => setDrafts({ ...drafts, [key]: event.currentTarget.value })} />
        <span id={`count-${key}`} className={`counter ${count > PROFILE_TEXT_LIMIT ? 'over' : ''}`} aria-live="polite">{count}/{PROFILE_TEXT_LIMIT}</span>
      </Setting>;
    })}
    <Setting name="저장">
      <button type="button" className="solid-button" disabled={!ready || !changed || over}
        onClick={() => model.saveProfile({ ...profile, interests: drafts.interests.trim(), wants: drafts.wants.trim(), avoids: drafts.avoids.trim() })}>저장하기</button>
      {over ? <p className="field-note error" role="alert">{PROFILE_TEXT_LIMIT}자 이하로 적어 주세요</p> : null}
    </Setting>
  </Section>;
}

function CalendarPage({ model }: { model: SettingsModel }) {
  const calendar = model.calendar;
  if (!model.userId) return <div className="settings"><Back model={model} /><Section id="s-calendar" title="구글 캘린더"><LoginNote model={model} what="구글 캘린더" /></Section></div>;
  if (!calendar) return null;
  const connected = !!calendar.id;
  const syncedAt = calendar.syncedAt ? new Date(calendar.syncedAt).toLocaleString('ko-KR', { month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : null;
  // 서버가 자동으로 맞추려면 연결할 때 받은 구글 장기 열쇠가 서버에 있어야 한다. 예전에 연결한 사람은 한 번 더 연결하면 된다.
  const auto = calendar.auto;
  const autoText = !connected ? '' : auto.active ? '자동으로 맞춰요' : auto.error ? '자동 맞춤이 멈췄어요' : '자동으로 맞추려면 다시 연결해 주세요';
  return <div className="settings">
    <Back model={model} />
    <Section id="s-calendar" title="구글 캘린더">
      <Setting name="저장한 공지의 마감" help={'저장한 공지 중 마감이 남은 것을 구글 캘린더의 "성대 공지"에 넣어요. 마감 30분 전부터 보여서 알림이 마감 전에 울려요'}>
        <div className="connection-summary"><span className="setting-state">{connected ? `연결됨${syncedAt ? ` · ${syncedAt}에 맞춤` : ''}` : '연결 안 됨'}</span></div>
        {connected ? <p className={`field-note ${auto.active ? 'ok' : ''}`} role="status">{autoText}{auto.active ? ' · 30분마다 서버가 저장한 공지를 확인해요' : ''}</p> : null}
        {connected && !auto.active && auto.error ? <p className="field-note error" role="alert">{auto.error}</p> : null}
        <div className="inline">
          {connected
            ? <button type="button" className="solid-button" disabled={calendar.busy} onClick={calendar.sync}>{calendar.busy ? '맞추고 있어요' : '지금 맞추기'}</button>
            : <button type="button" className="solid-button" disabled={calendar.busy} onClick={calendar.connect}>구글 캘린더에 연결하기</button>}
          {connected && !auto.active ? <button type="button" className="ghost-button" disabled={calendar.busy} onClick={calendar.connect}>다시 연결하기</button> : null}
          {connected ? <button type="button" className="ghost-button" disabled={calendar.busy} onClick={calendar.disconnect}>연결 끊기</button> : null}
        </div>
        {calendar.message ? <p className="field-note ok" role="status">{calendar.message}</p> : null}
        {calendar.error ? <p className="field-note error" role="alert">{calendar.error}</p> : null}
        <p className="field-note">현재 저장한 공지 {calendar.savedCount}개</p>
        <Guide label="연결하는 방법" steps={[
          '"구글 캘린더에 연결하기"를 누르면 구글 허용 화면으로 가요',
          '구글 계정을 고르고 "성공이 캘린더를 만들고 일정을 넣는 것"을 허용해요. "확인되지 않은 앱"이라고 나오면 "고급"을 누른 뒤 "계속"을 눌러요',
          '허용하고 돌아오면 구글 캘린더에 "성대 공지" 캘린더가 생기고 저장한 공지의 마감이 바로 들어가요',
          '그다음부터는 서버가 30분마다 알아서 맞춰요. 지금 바로 보고 싶을 때만 "지금 맞추기"를 눌러요',
        ]} />
      </Setting>
    </Section>
    <Section id="s-calendar-help" title="알아 두세요">
      <ul className="rule-list">
        <li>구글 로그인으로 허용한 권한은 이 앱이 만든 "성대 공지" 캘린더 안의 일정만 다뤄요. 내 다른 캘린더는 읽지도 쓰지도 못해요</li>
        <li>허용 화면이 "확인되지 않은 앱"이라고 나올 수 있어요. 이 앱이 아직 구글의 검증을 받지 않아서예요</li>
        <li>자동으로 맞추려고 구글이 주는 장기 열쇠를 암호화해서 서버에 보관해요. 연결을 끊거나 계정을 지우면 그 열쇠도 지워지고, 구글 계정의 연결된 앱에서 권한을 거두면 서버도 더는 쓰지 못해요</li>
        <li>연결을 끊어도 구글 캘린더의 "성대 공지"는 남아요. 필요 없으면 구글 캘린더에서 지워 주세요</li>
      </ul>
    </Section>
  </div>;
}

function Profile({ model }: { model: SettingsModel }) {
  const { profile } = model;
  const save = (patch: Partial<UserProfile>) => model.saveProfile({ ...profile, ...patch });
  const [main, ...doubles] = profile.programs;
  if (!model.userId) return <div className="settings"><Back model={model} /><Section id="s-profile" title="프로필 설정"><LoginNote model={model} what="프로필 설정" /></Section></div>;
  const ready = model.profileStatus === 'ready';
  return <div className="settings">
    <Back model={model} />
    <div className="profile-hero">
      <Avatar src={model.avatar} size={64} />
      <div><p className="setting-name">{model.name ?? model.email ?? '로그인됨'}</p>{model.name && model.email ? <p className="setting-help">{model.email}</p> : null}</div>
    </div>
    <Section id="s-major" title="전공">
      <Setting name="전공" help="공지를 받을 게시판을 고를 때 참고해요">
        <dl className="info-list">
          <div><dt>주전공</dt><dd>{main ? `${programLabel(main)}${main.department ? ` (${main.college})` : ''}` : '아직 없어요'}</dd></div>
          <div><dt>복수전공</dt><dd>{doubles.length ? doubles.map(programLabel).join(', ') : '없어요'}</dd></div>
        </dl>
        <button type="button" className="ghost-button" disabled={!ready} onClick={model.openOnboarding}>전공과 게시판 다시 고르기</button>
      </Setting>
    </Section>
    <Section id="s-school" title="학교 정보">
      <Setting name="학년"><Choice label="학년" value={profile.year} disabled={!ready}
        options={YEARS.map((year) => [year, year === 5 ? '5학년 이상' : `${year}학년`] as const)} onPick={(year) => save({ year })} /></Setting>
      <Setting name="재학 상태"><Choice label="재학 상태" value={profile.enrollmentStatus} disabled={!ready}
        options={ENROLLMENT.map((value) => [value, value] as const)} onPick={(enrollmentStatus) => save({ enrollmentStatus })} /></Setting>
      <Setting name="학기" help="인턴 공고의 지원 자격을 가릴 때만 써요. 이름이나 학번은 받지 않아요">
        <Choice label="학기" value={profile.semester} disabled={!ready}
          options={SEMESTERS.map((value) => [value, `${value}학기`] as const)} onPick={(semester) => save({ semester })} /></Setting>
      <Setting name="병역"><Choice label="병역" value={profile.militaryService} disabled={!ready}
        options={MILITARY.map((value) => [value, value] as const)} onPick={(militaryService) => save({ militaryService })} /></Setting>
    </Section>
    <AboutMe model={model} />
    {model.profileMessage ? <p className="field-note ok" role="status">{model.profileMessage}</p> : null}
    {model.profileError ? <p className="field-note error" role="alert">{model.profileError}</p> : null}
    {model.profileStatus === 'unavailable' ? <p className="field-note">지금은 프로필을 불러올 수 없어요. 잠시 뒤 다시 열어 주세요</p> : null}
  </div>;
}

function Guide({ label, steps }: { label: string; steps: ReactNode[] }) {
  return <details className="connection-manual"><summary>{label}</summary><ol className="steps">{steps.map((step, index) => <li key={index}>{step}</li>)}</ol></details>;
}

const ext = (href: string, text: string) => <a href={href} target="_blank" rel="noopener noreferrer">{text}</a>;

/** 키 한 줄: 저장 상태와 입력하기·수정하기, 눌러서 펼치는 입력칸, 받는 방법 안내(원본의 연결 키 줄과 같은 모양). */
function KeyRow({ name, help, state, children, guide }: { name: string; help: string; state: string; children?: ReactNode; guide?: ReactNode }) {
  return <Setting name={name} help={help}>
    <div className="connection-summary"><span className="setting-state">{state}</span>{children}</div>
    {guide}
  </Setting>;
}

/** 비밀 한 줄: 저장 상태, 입력하기·수정하기·지우기, 눌러서 펼치는 입력칸과 받는 방법(Gemini 키와 아이캠퍼스 토큰이 같이 쓴다). */
function SecretRow({ name, help, placeholder, status, loading, busy, error, onRegister, onRemove, guide, valid }: {
  name: string; help: string; placeholder: string;
  status: { keyHint: string; disabled: boolean; lastError: string | null } | null;
  loading: boolean; busy: boolean; error: string;
  onRegister: (value: string) => void; onRemove: () => void; guide: ReactNode; valid?: (value: string) => boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [shown, setShown] = useState(false);
  const [value, setValue] = useState('');
  // 저장이 끝나 상태가 바뀌면 입력칸을 닫고 비운다. 값은 이 입력칸 밖에 남기지 않는다.
  useEffect(() => { if (status) { setValue(''); setEditing(false); setShown(false); } }, [status?.keyHint]);
  const state = loading ? '확인 중' : status ? `저장됨 ····${status.keyHint}${status.disabled ? ' (사용 중지됨)' : ''}` : '미설정';
  return <Setting name={name} help={help}>
    {editing ? <>
      <div className="inline">
        <input className="input" type={shown ? 'text' : 'password'} autoComplete="off" spellCheck={false} aria-label={name}
          placeholder={placeholder} value={value} disabled={busy} onChange={(event) => setValue(event.currentTarget.value.trim())} />
        <button type="button" className="ghost-button" aria-pressed={shown} disabled={busy} onClick={() => setShown(!shown)}>{shown ? '숨기기' : '보기'}</button>
      </div>
      <div className="inline">
        <button type="button" className="solid-button" disabled={busy || !value || (valid ? !valid(value) : false)} onClick={() => onRegister(value)}>{busy ? '확인하고 있어요' : '저장하기'}</button>
        <button type="button" className="ghost-button" disabled={busy} onClick={() => { setEditing(false); setValue(''); setShown(false); }}>닫기</button>
      </div>
      {error ? <p className="field-note error" role="alert">{error}</p> : null}
      {guide}
    </> : <>
      <div className="connection-summary"><span className="setting-state">{state}</span>
        <button type="button" className="text-button key-action" aria-label={`${name} ${status ? '수정하기' : '입력하기'}`} disabled={loading} onClick={() => setEditing(true)}>{status ? '수정하기' : '입력하기'}</button>
        {status ? <button type="button" className="text-button key-action" aria-label={`${name} 지우기`} disabled={busy} onClick={onRemove}>지우기</button> : null}
      </div>
      {status?.lastError ? <p className="field-note error" role="alert">{status.lastError}</p> : null}
      {error ? <p className="field-note error" role="alert">{error}</p> : null}
    </>}
  </Setting>;
}

function GeminiRow({ model }: { model: SettingsModel }) {
  const { byok } = model;
  const guide = <Guide label="받는 방법" steps={[
    <>{ext('https://aistudio.google.com/apikey', 'Google AI Studio의 API 키 화면')}을 열고 Google 계정으로 로그인해요</>,
    '"API 키 만들기"를 누르고, 프로젝트를 고르라고 하면 새 프로젝트를 만들어요',
    '만들어진 키를 붙여 넣고 "저장하기"를 눌러요. 저장하면 Gemini에 확인한 뒤 암호화해 서버에만 보관해요',
    '무료 등급은 보낸 내용이 Google 제품 개선에 쓰일 수 있어요. 키는 나에게 맞는 공지와 인턴 공고를 고르는 데만 써요',
  ]} />;
  const help = '나에게 맞는 공지를 소리로 알리고, 공지 요약과 영어 공지 번역을 만드는 데 써요';
  if (!byok?.available) {
    return <KeyRow name="Gemini 키" help={help} state="준비 중" guide={null}>
      <span className="field-note">지금은 키를 저장할 수 없어요. 잠시 뒤 다시 열어 주세요</span>
    </KeyRow>;
  }
  return <SecretRow name="Gemini 키" help={help} placeholder="AIza 또는 AQ.로 시작하는 키" status={byok.status} loading={byok.loading} busy={byok.busy}
    error={byok.error} onRegister={byok.register} onRemove={byok.remove} guide={guide} />;
}

function CanvasRow({ model }: { model: SettingsModel }) {
  const { byok } = model;
  const help = '아이캠퍼스의 강의와 과제 마감을 알려드리는 데 써요';
  if (!byok?.available) {
    return <KeyRow name="아이캠퍼스 토큰" help={help} state="준비 중" guide={null}>
      <span className="field-note">지금은 토큰을 저장할 수 없어요. 잠시 뒤 다시 열어 주세요</span>
    </KeyRow>;
  }
  const guide = <Guide label="받는 방법" steps={[
    <>{ext('https://canvas.skku.edu/profile/settings', '아이캠퍼스 계정 설정')}을 열고 로그인해요</>,
    '"승인된 통합" 아래의 "새 액세스 토큰"을 눌러요',
    '목적에 "성공 알림" 같은 이름을 쓰고 만료일은 비워 두거나 학기 끝으로 정해요',
    '"토큰 생성"을 누르면 한 번만 보이는 긴 글자가 나와요. 복사해서 붙여 넣고 "저장하기"를 눌러요',
    '저장하면 아이캠퍼스에 확인한 뒤 암호화해 서버에만 보관해요. 읽기만 하고 아이캠퍼스 내용을 바꾸지 않아요',
  ]} />;
  return <SecretRow name="아이캠퍼스 토큰" help={help} placeholder="숫자~로 시작하는 토큰" status={byok.canvas} loading={byok.loading} busy={byok.canvasBusy}
    error={byok.canvasError} onRegister={byok.registerCanvas} onRemove={byok.removeCanvas} guide={guide}
    valid={(value) => /^[0-9A-Za-z~_-]{16,200}$/.test(value)} />;
}

function Keys({ model }: { model: SettingsModel }) {
  if (!model.userId) return <div className="settings"><Back model={model} /><Section id="s-keys" title="연결 키"><LoginNote model={model} what="연결 키" /></Section></div>;
  return <div className="settings">
    <Back model={model} />
    <Section id="s-keys" title="연결 키">
      <GeminiRow model={model} />
      <CanvasRow model={model} />
    </Section>
    <Section id="s-eligibility" title="내 프로필">
      <Setting name="지원 자격 정보" help="학년, 학기, 재학 상태, 병역, 관심 분야는 프로필 설정에서 바꿔요">
        <button type="button" className="ghost-button" onClick={() => model.openSection('profile')}>프로필 설정 열기</button>
      </Setting>
    </Section>
  </div>;
}

export function PlatformSettings({ model }: { model: SettingsModel }) {
  switch (model.section) {
    case 'notifications': return <Notifications model={model} />;
    case 'keywords': return <Keywords model={model} />;
    case 'calendar': return <CalendarPage model={model} />;
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
