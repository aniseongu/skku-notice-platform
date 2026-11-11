// 설정 화면. 구조와 문구는 원본(첫 쪽 → 하위 쪽)을 따르고, 계정·게시판·내 정보는 다중 사용자 구조에 맞췄다.
// 스위치는 바로 반영되는 설정에만 쓰고(role="switch"), 켜짐·꺼짐을 글자로도 알린다(색에만 의존하지 않는다).
import { createRoot, type Root } from 'react-dom/client';
import { useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import { isSoftwareOriginal, threePAnswer, threePFields, type ThreePAnswer } from './graduation-assessment';
import { AiRows, StepGuide } from './ai-connect';
import type { AiKeyStatus, AiPreferences, AiProvider } from './ai-providers';
import { type ByokStatus, type CanvasStatus } from './byok';
import { CANVAS_MODES, composeSummaryTime, displayDeviceName, summaryParts, validDeviceName, type CanvasMode, type Device } from './devices';
import { ADMISSION_YEARS, ENROLLMENT, MILITARY, OLD_ADMISSION_YEAR, PROFILE_TEXT_LIMIT, type ProfileTextField, type UserProfile } from './profile';
import { MAX_PROGRAMS, programKey, programLabel, type Program } from './skku-programs';
import { ProgramPicker } from './onboarding';
import { BOARD_CATALOG, COLLEGE_BOARD, DEPARTMENT_BOARD, OTHER_BOARDS } from './skku-boards';
// 순서 바꾸기는 dnd-kit(MIT)을 쓴다: 손잡이로 끌기(마우스·터치)와 키보드(Space로 집고 방향키로 옮기고 Space로 놓기), 낭독기 안내가 들어 있다.
import { DndContext, KeyboardSensor, PointerSensor, TouchSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { restrictToParentElement, restrictToVerticalAxis } from '@dnd-kit/modifiers';
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
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
  boardOrder: { boards: { id: string; label: string }[]; status: '' | 'saved' | 'failed'; move: (ids: string[]) => void };
  sources: { id: string; label: string }[];
  subscriptions: string[];
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
    backfill: number;
    register: (apiKey: string) => void;
    remove: () => void;
    ai?: {
      keys: AiKeyStatus[]; prefs: AiPreferences; busy: boolean; error: string; gemini: boolean;
      register: (provider: AiProvider, key: string, model?: string) => void; remove: (provider: AiProvider) => void; savePrefs: (prefs: AiPreferences) => void;
    };
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

function Section({ id, title, action, children }: { id: string; title: string; action?: ReactNode; children: ReactNode }) {
  return <section aria-labelledby={id}>
    {action ? <div className="settings-head-row"><h2 id={id} className="settings-head">{title}</h2>{action}</div> : <h2 id={id} className="settings-head">{title}</h2>}
    <div className="box">{children}</div></section>;
}

export function Setting({ name, help, children, className = '' }: { name: string; help?: ReactNode; children?: ReactNode; className?: string }) {
  return <div className={`setting ${className}`}>
    <div className="setting-text"><p className="setting-name">{name}</p>{help ? <p className="setting-help">{help}</p> : null}</div>
    {children ? <div className="setting-control">{children}</div> : null}
  </div>;
}

export function Choice<T extends string | number>({ label, options, value, onPick, disabled, grid }: {
  label: string; options: readonly (readonly [T, string])[]; value: T | null; onPick: (value: T) => void; disabled?: boolean; grid?: boolean;
}) {
  // 선택지가 많으면(입학 연도) 한 줄로 늘어놓지 않고 4열 격자로 칸 안에 담는다.
  return <div className={grid ? 'segmented grid grid-cols-4 w-full gap-[2px] [&_button]:px-0' : 'segmented'} role="radiogroup" aria-label={label}>
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

// 뒤로 가기는 머리 줄의 단추(휴대폰은 화살표, 넓은 화면은 X)가 맡는다. 본문에 같은 일을 하는 링크를 또 두지 않는다.
function Back(_props: { model: SettingsModel }) {
  return null;
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
        <SettingsLink model={model} label="연결 키" help="Gemini·Groq·OpenRouter 키와 아이캠퍼스 토큰" section="keys" />
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
      {model.canInstall ? <Setting name="앱 설치" help="바탕화면이나 홈 화면에서 바로 열어요">
        <button type="button" className="ghost-button" onClick={model.install}>앱으로 설치하기</button>
      </Setting> : null}
      <Setting name="단축키" help="키보드로 빠르게 이동해요" className="kbd-only">
        <button type="button" className="ghost-button" aria-keyshortcuts="?" onClick={model.showShortcuts}>단축키 보기</button>
      </Setting>
    </Section>
    <div className="box mt-[24px]">
        <a className="settings-link" href="privacy.html">
        <span><span className="setting-name">개인정보 처리방침</span>
          <span className="setting-help">어떤 정보를 어디에 쓰고 어떻게 지우는지 알려 드려요</span></span>
        <span className="settings-chevron" aria-hidden="true" />
      </a>
    </div>
    {/* 계정 삭제는 되돌릴 수 없어서 설정의 가장 아래에 따로 둔다. */}
    {model.userId ? <DeleteAccount model={model} /> : null}
  </div>;
}

const permissionText = (status: SettingsModel['pushStatus']) =>
  status === 'unsupported' ? '지원하지 않음'
    : typeof Notification === 'undefined' ? '확인할 수 없음'
      : Notification.permission === 'granted' ? '허용' : Notification.permission === 'denied' ? '차단' : '아직 선택하지 않음';

/** 받지 않는 게시판 고르기. 받는 게시판은 위의 순서 목록에서 끄고 옮긴다. */
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
  // 부트캠프처럼 전공과 상관없는 게시판은 단과대·학과 묶음 뒤에 둔다.
  const ordered = [...groups].sort(([a], [b]) => Number([...otherGroup.values()].includes(a)) - Number([...otherGroup.values()].includes(b)));
  const busy = model.loading;
  return <>
    {others.length === 0 && !query ? <p className="field-note">모든 게시판을 받고 있어요</p> : <details className="connection-manual group board-more-list" open={mine.length === 0}>
      <summary className={SUMMARY}>게시판 더 보기 ({others.length}개){chevron('M6 9l6 6 6-6', CHEVRON)}</summary>
      <input className="input" type="search" aria-label="게시판 검색" placeholder="학과나 단과대 이름으로 찾기" autoComplete="off" value={query}
        onChange={(event) => setQuery(event.currentTarget.value)} />
      {ordered.map(([group, items]) => <div className="board-group" key={group} role="group" aria-label={group}>
        <p className="board-group-title">{group}</p>
        {items.map((source) => <SwitchRow key={source.id} label={source.label} checked={false} disabled={busy} onChange={() => model.toggle(source.id, true)} />)}
      </div>)}
      {others.length === 0 ? <p className="field-note" role="status">{query ? `'${query}'에 맞는 게시판이 없어요` : '모든 게시판을 받고 있어요'}</p> : null}
    </details>}
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

/** 계정 삭제: 되돌릴 수 없어서 설정 맨 아래에 작게 따로 두고, 누르면 질문과 지워지는 것을 보여 준 뒤 한 번 더 확인한다.
 * 토스 확인창처럼 질문이 먼저, 안전한 "닫기"가 왼쪽, 실행이 오른쪽이다. 열면 "닫기"에 포커스를 둬서 Enter로 바로 지워지지 않게 한다. */
function DeleteAccount({ model }: { model: SettingsModel }) {
  const account = model.account;
  const [confirming, setConfirming] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const opened = useRef(false);
  useEffect(() => {
    if (confirming) { opened.current = true; closeRef.current?.focus(); closeRef.current?.closest('.delete-confirm')?.scrollIntoView({ block: 'nearest' }); }
    else if (opened.current) { opened.current = false; triggerRef.current?.focus(); }
  }, [confirming]);
  if (!account) return null;
  return <div className="delete-account">
    {confirming ? <div className="delete-confirm" role="group" aria-labelledby="delete-account-title" aria-describedby="delete-account-help" aria-busy={account.busy}>
      <p id="delete-account-title" className="delete-title">계정을 삭제할까요?</p>
      <p id="delete-account-help" className="setting-help">구독, 키워드, 저장한 공지까지 계정 정보가 모두 삭제돼요. 삭제한 뒤에는 되돌릴 수 없어요</p>
      <div className="inline-row">
        <button type="button" className="ghost-button" ref={closeRef} disabled={account.busy} onClick={() => setConfirming(false)}>닫기</button>
        <button type="button" className="solid-button danger" disabled={account.busy} onClick={account.remove}>{account.busy ? '삭제하고 있어요' : '삭제하기'}</button>
      </div>
    </div> : <button type="button" className="text-button" ref={triggerRef} onClick={() => setConfirming(true)}>계정 삭제</button>}
    {account.error ? <p className="field-note error" role="alert">{account.error}</p> : null}
  </div>;
}

/** 알림 기기 한 줄: 이름(모델이나 기기 종류), 등록일, 아캠 알림 모드. 이름은 바꿀 수 있고 이 기기가 아닌 기기는 지울 수 있다. */
function DeviceRow({ device, info }: { device: Device; info: NonNullable<SettingsModel['devicesInfo']> }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(device.name ?? '');
  const name = displayDeviceName(device, info.devices);
  const save = async () => { if (validDeviceName(draft) && await info.rename(device.id, draft)) setEditing(false); };
  return <li>
    {editing
      ? <div className="inline-row">
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
    <Section id="s-notify" title="이 기기">
      <Setting name="이 기기 알림" help="앱을 닫아도 브라우저가 켜져 있으면 알림으로 받아요. 이 기기에만 적용돼요">
        {!model.userId ? <p className="field-note">로그인하면 이 기기로 알림을 받을 수 있어요</p> : <>
          <div className="inline-row">
            {on
              ? <><button type="button" className="ghost-button" onClick={model.disablePush}>알림 끄기</button>
                <button type="button" className="ghost-button" onClick={model.testNotification}>테스트 알림 띄우기</button></>
              : <button type="button" className="ghost-button" disabled={model.pushStatus !== 'off'} onClick={model.enablePush}>
                {model.pushStatus === 'busy' ? '연결 중' : model.pushStatus === 'checking' ? '확인하고 있어요' : model.pushRetry ? '다시 시도하기' : '알림 받기'}</button>}
          </div>
          {/* 조작 먼저, 보조 안내는 그 아래(다른 행과 같은 순서). */}
          <span className="field-note">{on ? '켜져 있어요' : '꺼져 있어요'} · 브라우저 권한 {permissionText(model.pushStatus)}</span>
          {model.pushStatus === 'unsupported' ? <p className="field-note">이 브라우저는 알림을 지원하지 않아요. 최신 브라우저에서 열어 주세요</p> : null}
          {model.pushStatus === 'denied' ? <p className="field-note">브라우저 설정에서 알림을 허용하면 다시 켤 수 있어요</p> : null}
          {model.pushError ? <p className="field-note error" role="alert">{model.pushError}</p> : null}
          {on && model.subscriptions.length === 0 ? <p className="field-note">받을 게시판을 고르면 새 공지를 알려드려요</p> : null}
        </>}
      </Setting>
      {model.userId && info ? <>
        <Setting name="이 기기 아이캠퍼스 알림" help="아이캠퍼스의 하루 요약과 마감을 이 기기로 받을지 정해요">
          <Choice label="이 기기 아이캠퍼스 알림" value={on ? (thisDevice?.canvasMode ?? 'reminders') : null} options={CANVAS_MODES}
            disabled={!on || !thisDevice || !info.hasCanvasToken || info.busy} onPick={(mode: CanvasMode) => info.setMode(mode)} />
          <p className="field-note">{!on ? '먼저 이 기기 알림을 켜 주세요' : !info.hasCanvasToken ? '연결 키에서 아이캠퍼스 토큰을 저장해 주세요' : '요약과 마감을 고르면 하루 전과 3시간 전에도 알려요'}</p>
        </Setting>
        <Setting name="하루 요약 시간" help="모든 기기에 같은 시간을 적용해요. 할 일이 없어도 알려요">
          <p className="setting-name visually-hidden" id="summary-time-label">하루 요약 시간</p>
          <SummaryTime info={info} />
          {info.summaryTime === null ? <p className="field-note">아이캠퍼스를 연결하면 바꿀 수 있어요</p> : <p className="field-note">확인이 늦어지면 알림도 늦어져요</p>}
          {info.error ? <p className="field-note error" role="alert">{info.error}</p> : null}
        </Setting>
      </> : null}
      <Setting name="받을 공지" help="알림을 보내는 기준이에요">
        <ul className="rule-list">
          <li>받는 게시판의 새 공지를 알려요</li>
          <li>관심 키워드와 맞는 공지는 소리로, 나머지는 조용히 알려요</li>
          <li>학교가 고친 중요한 글은 한 번 더 알려요</li>
          <li>Gemini 키가 있으면 나와 맞는 공지도 소리로 알려요</li>
          <li>인턴 공고는 나와 맞는 것만 알려요</li>
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
    <BoardsSection model={model} />
  </div>;
}

function BoardsSection({ model }: { model: SettingsModel }) {
  // 받는 게시판 고르기와 순서 바꾸기를 한 목록에서 한다: 줄마다 켜고 끄는 스위치가 있고, 순서 바꾸기를 누르면 옮기는 손잡이가 나온다.
  const [editing, setEditing] = useState(false);
  const order = model.boardOrder;
  const canMove = order.boards.length >= 2;
  return <Section id="s-boards" title="받을 게시판"
    action={canMove ? <button type="button" className="head-action" onClick={() => setEditing(!editing)}>{editing ? '완료' : '순서 바꾸기'}</button> : undefined}>
    <p className="settings-lead">{editing ? '손잡이를 끌어 순서를 바꿔요. 바꾸면 바로 저장돼요' : '알림을 받고 목록에 모아 볼 게시판이에요. 이 순서로 보여요'}</p>
    {!model.userId ? <LoginNote model={model} what="게시판 구독" /> : <>
      {model.error ? <><p className="field-note error" role="alert">{model.error}</p>
        <button type="button" className="ghost-button" onClick={model.retry}>다시 불러오기</button></> : null}
      {order.boards.length ? <BoardOrderList order={order} editing={editing} onToggle={(id) => model.toggle(id, false)} busy={model.loading} />
        : <p className="field-note">아직 받는 게시판이 없어요. 아래에서 골라 주세요</p>}
      <BoardGroups model={model} />
    </>}
  </Section>;
}

// 펼치는 줄(details)은 브라우저 기본 삼각형 대신 다른 곳과 같은 쉐브론을 쓴다. 열리면 위를 향한다.
const SUMMARY = 'flex cursor-pointer list-none items-center justify-between [&::-webkit-details-marker]:hidden';
const CHEVRON = 'text-ink-3 transition-transform group-open:rotate-180';
function chevron(d: string, className?: string) {
  return <svg aria-hidden="true" viewBox="0 0 24 24" width="20" height="20" className={className}><path d={d} fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

/** 게시판 한 줄. 줄마다 테두리가 있는 따로 떨어진 칸이다. 오른쪽 끝에서 받기를 켜고 끄고(평소), 순서를 바꾸는 중에는 같은 자리의 손잡이로 끈다.
 *  손잡이를 스위치와 같은 오른쪽에 둔 이유: 마우스가 단추 근처에 있는 채로 바로 옮길 수 있게 하려는 것이다(.claude/rules/usability.md). */
function BoardRow({ board, editing, onToggle, busy }: { board: { id: string; label: string }; editing: boolean; onToggle?: (id: string) => void; busy: boolean }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: board.id, disabled: !editing });
  return <li ref={setNodeRef} data-board-id={board.id} style={{ transform: CSS.Transform.toString(transform), transition }}
    className={`flex min-h-[56px] items-center gap-[12px] rounded-md border bg-surface pr-[6px] pl-[16px] ${isDragging ? 'relative z-10 border-accent shadow-pop' : 'border-line'}`}>
    <span className="order-name min-w-0 flex-1 text-[15px] font-semibold [overflow-wrap:anywhere]">{board.label}</span>
    {editing ? <button type="button" ref={setActivatorNodeRef} {...attributes} {...listeners} aria-label={`${board.label} 순서 옮기기`}
      className="order-handle grid size-[44px] flex-none cursor-grab touch-none place-items-center rounded-md border-0 bg-transparent text-ink-3 hover:bg-sunken active:cursor-grabbing focus-visible:outline-2 focus-visible:outline-accent">
      <svg aria-hidden="true" viewBox="0 0 24 24" width="20" height="20" fill="currentColor">{[7, 12, 17].flatMap((y) => [9, 15].map((x) => <circle key={`${x}-${y}`} cx={x} cy={y} r="1.7" />))}</svg></button> : null}
    {onToggle && !editing ? <button type="button" role="switch" className="switch-row switch-only" aria-checked="true" aria-label={`${board.label} 받기`} disabled={busy}
      onClick={() => onToggle(board.id)}><span className="switch" aria-hidden="true" /></button> : null}
  </li>;
}

function BoardOrderList({ order, editing, onToggle, busy = false }: { order: SettingsModel['boardOrder']; editing: boolean; onToggle?: (id: string) => void; busy?: boolean }) {
  const latest = useRef(order);
  latest.current = order;
  const ids = order.boards.map((board) => board.id);
  const labelOf = (id: unknown) => order.boards.find((board) => board.id === id)?.label ?? '';
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 3 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 120, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const from = ids.indexOf(String(active.id)), to = ids.indexOf(String(over.id));
    if (from < 0 || to < 0) return;
    latest.current.move(arrayMove(ids, from, to));
  };
  const position = (id: unknown) => `${ids.indexOf(String(id)) + 1}번째`;
  return <div className="order-box">
    <DndContext sensors={sensors} collisionDetection={closestCenter} modifiers={[restrictToVerticalAxis, restrictToParentElement]} onDragEnd={onDragEnd}
      accessibility={{
        screenReaderInstructions: { draggable: '순서를 바꾸려면 Space를 눌러 집고, 위아래 방향키로 옮긴 뒤 Space로 놓으세요. 취소는 Esc예요.' },
        announcements: {
          onDragStart: ({ active }) => `${labelOf(active.id)}을 집었어요. 지금 ${position(active.id)}예요`,
          onDragOver: ({ active, over }) => (over ? `${labelOf(active.id)}이 ${position(over.id)} 자리 위에 있어요` : undefined),
          onDragEnd: ({ active, over }) => (over ? `${labelOf(active.id)}을 ${position(over.id)}로 옮겼어요` : `${labelOf(active.id)}을 제자리에 놓았어요`),
          onDragCancel: ({ active }) => `${labelOf(active.id)} 옮기기를 취소했어요`,
        },
      }}>
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        <ul className="order-list m-0 flex list-none flex-col gap-[8px] p-0">
          {order.boards.map((board) => <BoardRow key={board.id} board={board} editing={editing} onToggle={onToggle} busy={busy} />)}
        </ul>
      </SortableContext>
    </DndContext>
    {/* 아래에는 문제가 생겼을 때만 적는다. 저장 성공은 따로 알리지 않는다(바로 저장된다고 위에 이미 적었다). */}
    {editing && order.status === 'failed' ? <p className="field-note error m-0 mt-[8px]" role="alert">저장하지 못했어요. 다시 옮기면 또 저장해요</p> : null}
  </div>;
}

function Keywords({ model }: { model: SettingsModel }) {
  const [draft, setDraft] = useState('');
  const add = () => { if (!draft.trim()) return; model.addKeyword(draft); setDraft(''); };
  return <div className="settings">
    <Back model={model} />
    <Section id="s-keywords" title="관심 키워드">
      <div className="setting stacked">
        <p className="setting-help m-0">제목이나 본문에 이 글자가 그대로 들어간 공지를 "관심"으로 표시해요</p>
        <div className="inline-row">
          <input className="input" type="text" autoComplete="off" aria-label="새 키워드" placeholder="예: 겨울방학 인턴" value={draft}
            onChange={(event) => setDraft(event.currentTarget.value)}
            onKeyDown={(event) => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); add(); } }} />
          <button type="button" className="solid-button" disabled={!draft.trim()} onClick={add}>추가하기</button>
        </div>
        {model.keywordNote ? <p className="field-note m-0" role="status">{model.keywordNote}</p>
          : model.userId ? null : <p className="field-note m-0">로그인하면 다른 기기와 같은 키워드를 써요</p>}
      </div>
      <div className="setting stacked">
        <p className="setting-name m-0">내 키워드 {model.keywords.length}개</p>
        {model.keywords.length
          ? <ul className="keyword-list">{model.keywords.map((word) => <li key={word}><span>{word}</span>
            <button type="button" className="text-button" aria-label={`${word} 삭제`} onClick={() => model.removeKeyword(word)}>삭제</button></li>)}</ul>
          : <p className="field-note m-0">아직 키워드가 없어요. 위에 입력해서 추가해 보세요</p>}
      </div>
    </Section>
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
  return <div className="settings">
    <Back model={model} />
    <Section id="s-calendar" title="저장한 공지의 마감">
      <Setting name="구글 캘린더" help={'마감이 남은 저장 공지를 "성대 공지" 캘린더에 넣어요'}>
        {/* 상태와 단추를 따로 두지 않고 하나로 합친다: 연결 전에는 누르는 "연결하기", 연결되면 누를 수 없는 민트색 "연결됨"으로 바뀐다. */}
        {connected
          ? <span role="status" className="inline-flex min-h-[44px] items-center gap-[6px] rounded-md bg-accent px-[16px] text-[15px] font-semibold text-on-accent self-start min-[720px]:self-end">
            <svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>연결됨</span>
          : <button type="button" className="ghost-button" aria-label="구글 캘린더에 연결하기" disabled={calendar.busy} onClick={calendar.connect}>연결하기</button>}
        {connected ? <p className="field-note m-0">{auto.active ? '30분마다 자동으로 맞춰요' : '자동으로 맞추려면 다시 연결해 주세요'}{calendar.savedCount !== undefined ? ` · 저장한 공지 ${calendar.savedCount}개` : ''}{syncedAt ? ` · 마지막 맞춤 ${syncedAt}` : ''}</p> : null}
        {connected && !auto.active && auto.error ? <p className="field-note error m-0" role="alert">{auto.error}</p> : null}
        {connected ? <div className="inline-row">
          <button type="button" className="text-button" disabled={calendar.busy} onClick={calendar.disconnect}>연결 끊기</button>
          {!auto.active ? <button type="button" className="ghost-button" disabled={calendar.busy} onClick={calendar.connect}>다시 연결하기</button> : null}
          <button type="button" className="ghost-button" disabled={calendar.busy} onClick={calendar.sync}>{calendar.busy ? '맞추고 있어요' : '지금 맞추기'}</button>
        </div> : null}
        {calendar.message ? <p className="field-note ok m-0" role="status">{calendar.message}</p> : null}
        {calendar.error ? <p className="field-note error m-0" role="alert">{calendar.error}</p> : null}
      </Setting>
      <div className="setting stacked">
        <Guide bare label="연결하는 방법" steps={[
          '"구글 캘린더에 연결하기"를 눌러 구글 허용 화면으로 가요',
          '"확인되지 않은 앱"이라고 나오면 "고급"을 누른 뒤 "계속"을 눌러요',
          '허용하고 돌아오면 "성대 공지" 캘린더가 생기고 마감이 바로 들어가요',
        ]} />
      </div>
    </Section>
    <Section id="s-calendar-help" title="알아 두세요">
      <div className="setting stacked"><ul className="rule-list">
        <li>이 앱이 만든 "성대 공지" 캘린더만 다뤄요. 내 다른 캘린더는 읽지 못해요</li>
        <li>구글이 주는 열쇠는 암호화해 보관하고, 연결을 끊거나 계정을 지우면 지워요</li>
        <li>연결을 끊어도 "성대 공지" 캘린더는 남아요. 필요 없으면 구글 캘린더에서 지워 주세요</li>
      </ul></div>
    </Section>
  </div>;
}

/** 전공 바꾸기: 첫 설정으로 돌아가지 않고 이 자리에서 바로 고른다. 학과를 누르면 바로 저장하고, 게시판은 건드리지 않는다(게시판은 알림 설정에서 고른다). */
function ProgramEditor({ programs, ready, onChange }: { programs: Program[]; ready: boolean; onChange: (next: Program[]) => void }) {
  const [editing, setEditing] = useState<'main' | 'double' | null>(null);
  const [main, ...doubles] = programs;
  const name = (program: Program) => `${programLabel(program)}${program.department ? ` (${program.college})` : ''}`;
  const pick = (picked: Program) => {
    const others = doubles.filter((p) => programKey(p) !== programKey(picked));
    onChange(editing === 'main' ? [picked, ...others] : [main, ...others, picked].slice(0, MAX_PROGRAMS));
    setEditing(null);
  };
  return <>
    <Setting name="주전공" help={main ? name(main) : '아직 없어요'}>
      <button type="button" className="ghost-button" disabled={!ready} onClick={() => setEditing(editing === 'main' ? null : 'main')}>{main ? '바꾸기' : '고르기'}</button>
    </Setting>
    <Setting name="복수전공" help={doubles.length ? doubles.map(name).join(', ') : '없어요'}>
      <div className="inline-row">
        {doubles.map((program) => <button key={programKey(program)} type="button" className="ghost-button" disabled={!ready} aria-label={`${programLabel(program)} 빼기`}
          onClick={() => onChange(programs.filter((p) => programKey(p) !== programKey(program)))}>{programLabel(program)} 빼기</button>)}
        {main && programs.length < MAX_PROGRAMS ? <button type="button" className="ghost-button" disabled={!ready} onClick={() => setEditing(editing === 'double' ? null : 'double')}>추가하기</button> : null}
      </div>
    </Setting>
    {editing ? <div className="setting stacked">
      <p className="setting-name m-0">{editing === 'main' ? '주전공을 골라 주세요' : '복수전공을 골라 주세요'}</p>
      <ProgramPicker current={editing === 'main' ? main : null} onPick={pick} />
      <button type="button" className="text-button self-start" onClick={() => setEditing(null)}>닫기</button>
    </div> : null}
  </>;
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
      <ProgramEditor programs={profile.programs} ready={ready} onChange={(programs) => save({ programs })} />
    </Section>
    <Section id="s-school" title="학교 정보">
      <Setting name="학년 및 학기" help="인턴 공고의 지원 자격을 가릴 때만 써요">
        <div className="flex flex-col gap-[8px] min-[720px]:items-end">
          <Choice label="학년" value={profile.year} disabled={!ready}
            options={YEARS.map((year) => [year, year === 5 ? '5학년 이상' : `${year}학년`] as const)} onPick={(year) => save({ year })} />
          <Choice label="학기" value={profile.semester} disabled={!ready}
            options={SEMESTERS.map((value) => [value, `${value}학기`] as const)} onPick={(semester) => save({ semester })} />
        </div></Setting>
      <Setting name="재학 상태"><Choice label="재학 상태" value={profile.enrollmentStatus} disabled={!ready}
        options={ENROLLMENT.map((value) => [value, value] as const)} onPick={(enrollmentStatus) => save({ enrollmentStatus })} /></Setting>
      <Setting name="병역"><Choice label="병역" value={profile.militaryService} disabled={!ready}
        options={MILITARY.map((value) => [value, value] as const)} onPick={(militaryService) => save({ militaryService })} /></Setting>
    </Section>
    <Section id="s-internship" title="인턴십 졸업요건">
      {isSoftwareOriginal(profile) ? <>
        <Setting name="입학 연도" help="입학 연도마다 졸업요건이 달라요. 학번 전체는 받지 않아요">
          <Choice label="입학 연도" grid value={profile.admissionYear} disabled={!ready}
            options={[...ADMISSION_YEARS, OLD_ADMISSION_YEAR].map((value) => [value, value === OLD_ADMISSION_YEAR ? '2016 이전' : `${value}`] as const)}
            onPick={(admissionYear) => save({ admissionYear })} /></Setting>
      </> : null}
      <Setting name="3품 인턴십" help="인턴십 영역을 채웠다면 인턴 공고에서 이 요건을 빼 드려요">
        <Choice label="3품 인턴십" value={threePAnswer(profile)} disabled={!ready}
          options={[['done', '채웠어요'], ['todo', '아직이에요'], ['no', '안 해요']] as const}
          onPick={(value) => save(threePFields(value as ThreePAnswer))} /></Setting>
      {isSoftwareOriginal(profile) ? <>
        <Setting name="솦 인턴십" help="마쳤다면 인턴 공고에서 이 요건을 빼 드려요">
          <Choice label="솦 인턴십" value={profile.deptInternshipDone === null ? null : profile.deptInternshipDone ? 'yes' : 'no'} disabled={!ready}
            options={[['yes', '마쳤어요'], ['no', '아직이에요']] as const}
            onPick={(value) => save({ deptInternshipDone: value === 'yes' })} /></Setting>
      </> : null}
    </Section>
    <AboutMe model={model} />
    {model.profileMessage ? <p className="field-note ok" role="status">{model.profileMessage}</p> : null}
    {model.profileError ? <p className="field-note error" role="alert">{model.profileError}</p> : null}
    {model.profileStatus === 'unavailable' ? <p className="field-note">지금은 프로필을 불러올 수 없어요. 잠시 뒤 다시 열어 주세요</p> : null}
  </div>;
}

// bare: 이미 위에 구분선이 있는 묶음 안에서는 자기 윗선과 여백을 없애 선이 두 줄로 겹치지 않게 한다.
export function Guide({ label, steps, bare = false, open = false, compact = false }: { label: string; steps: ReactNode[]; bare?: boolean; open?: boolean; compact?: boolean }) {
  if (compact) {
    return <details open={open} className="group"><summary className="flex min-h-[36px] cursor-pointer list-none items-center gap-1 text-[13px] text-ink-3 [&::-webkit-details-marker]:hidden">{label}{chevron('M6 9l6 6 6-6', 'h-4 w-4 text-ink-3 transition-transform group-open:rotate-180')}</summary><ol className="m-0 mb-1 mt-1 flex list-decimal flex-col gap-1 pl-5 text-[13px] text-ink-2">{steps.map((step, index) => <li key={index}>{step}</li>)}</ol></details>;
  }
  return <details open={open} className={`connection-manual group ${bare ? 'mt-0 border-t-0' : ''}`}><summary className={SUMMARY}>{label}{chevron('M6 9l6 6 6-6', CHEVRON)}</summary><ol className="steps">{steps.map((step, index) => <li key={index}>{step}</li>)}</ol></details>;
}

export const ext = (href: string, text: string) => <a href={href} target="_blank" rel="noopener noreferrer">{text}</a>;

/** 키 한 줄: 저장 상태와 입력하기·수정하기, 눌러서 펼치는 입력칸, 받는 방법 안내(원본의 연결 키 줄과 같은 모양). */
function KeyRow({ name, help, state, children, guide }: { name: string; help: string; state: string; children?: ReactNode; guide?: ReactNode }) {
  return <Setting name={name} help={help}>
    <div className="connection-summary"><span className="setting-state">{state}</span>{children}</div>
    {guide}
  </Setting>;
}

const SECRET_LABELS = { empty: '미설정', saved: '저장됨', disabled: ' (사용 중지됨)', broken: '', retry: '', close: '닫기', add: '입력하기', edit: '수정하기', remove: '지우기', save: '저장하기' };

/** 비밀 한 줄: 저장 상태, 입력하기·수정하기·지우기, 눌러서 펼치는 입력칸과 받는 방법(Gemini 키와 아이캠퍼스 토큰이 같이 쓴다). */
export function SecretRow({ name, help, placeholder, status, loading, busy, error, onRegister, onRemove, guide, valid, note, labels = SECRET_LABELS, extra, guideFirst = false }: {
  note?: string | null; labels?: typeof SECRET_LABELS; extra?: ReactNode; guideFirst?: boolean;
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
  const state = loading ? '확인 중' : status ? (status.disabled && labels.broken ? labels.broken : `${labels.saved} ····${status.keyHint}${status.disabled ? labels.disabled : ''}`) : labels.empty;
  const retry = status?.disabled && labels.retry ? labels.retry : labels.edit;
  const form = !status && !loading || editing;
  // 연결 전에는 입력칸이 처음부터 보이고, 받는 방법은 아래에 접어 둔다. 연결하면 키 끝자리를 칩 안에 보여 준다.
  return <Setting name={name} help={help}>
    {form ? <>
      <div className="flex items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <input className="input w-full pr-11" type={shown ? 'text' : 'password'} autoComplete="off" spellCheck={false} aria-label={name}
            placeholder={placeholder} value={value} disabled={busy} onChange={(event) => setValue(event.currentTarget.value.trim())} />
          <button type="button" className="absolute right-0 top-0 grid h-full w-11 place-items-center border-0 bg-transparent p-0 text-ink-3" aria-label={shown ? '숨기기' : '보기'} aria-pressed={shown} disabled={busy} onClick={() => setShown(!shown)}>
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              {shown ? <><path d="M17.94 17.94A10.4 10.4 0 0 1 12 20C5 20 1 12 1 12a18.5 18.5 0 0 1 5.06-5.94M9.9 4.24A9.1 9.1 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19M14.12 14.12a3 3 0 1 1-4.24-4.24"/><path d="M1 1l22 22"/></> : <><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></>}
            </svg>
          </button>
        </div>
        <button type="button" className="solid-button min-h-[44px] shrink-0 px-4" aria-label={`${name} ${labels.save}`} disabled={busy || !value || (valid ? !valid(value) : false)} onClick={() => onRegister(value)}>{busy ? '확인 중' : labels.save}</button>
      </div>
      {extra}
      {error ? <p className="field-note error" role="alert">{error}</p> : null}
      {status ? <button type="button" className="text-button self-start" disabled={busy} onClick={() => { setEditing(false); setValue(''); setShown(false); }}>{labels.close}</button> : null}
      {guide}
    </> : <>
      <div className="flex items-center gap-2">
        <span className={`inline-flex min-h-[32px] min-w-[128px] items-center justify-center rounded-pill bg-sunken px-3 text-[14px] font-medium ${status?.disabled ? 'text-danger' : 'text-accent'}`}>{state}</span>
        <span className="flex shrink-0 gap-2"><button type="button" className="ghost-button key-action min-h-[44px] px-3 py-0" aria-label={`${name} ${retry}`} disabled={loading} onClick={() => setEditing(true)}>{retry}</button>
        {status ? <button type="button" className="ghost-button key-action min-h-[44px] px-3 py-0 text-danger" aria-label={`${name} ${labels.remove}`} disabled={busy} onClick={onRemove}>{labels.remove}</button> : null}</span>
      </div>
      {status?.lastError && !labels.broken ? <p className="field-note error" role="alert">{status.lastError}</p> : null}
      {note ? <p className="field-note" role="status">{note}</p> : null}
      {error ? <p className="field-note error" role="alert">{error}</p> : null}
    </>}
  </Setting>;
}

function CanvasRow({ model }: { model: SettingsModel }) {
  const { byok } = model;
  const help = '아이캠퍼스의 강의와 과제 마감을 알려드리는 데 써요';
  if (!byok?.available) {
    return <KeyRow name="아이캠퍼스 토큰" help={help} state="준비 중" guide={null}>
      <span className="field-note">지금은 토큰을 저장할 수 없어요. 잠시 뒤 다시 열어 주세요</span>
    </KeyRow>;
  }
  return <><SecretRow name="아이캠퍼스 토큰" help={help} placeholder="토큰을 붙여 넣어 주세요" status={byok.canvas} loading={byok.loading} busy={byok.canvasBusy}
    labels={{ empty: '연결 안 됨', saved: '연결됨', disabled: ' (사용 중지됨)', broken: '', retry: '', close: '닫기', add: '연결하기', edit: '바꾸기', remove: '연결 끊기', save: '연결하기' }}
    error={byok.canvasError} onRegister={byok.registerCanvas} onRemove={byok.removeCanvas} guide={null}
    valid={(value) => /^[0-9A-Za-z~_-]{16,200}$/.test(value)} />
    <StepGuide label="토큰은 어디서 받나요?" links={[{ href: 'https://canvas.skku.edu/profile/settings', text: '아이캠퍼스 설정 열기' }]}
      steps={['위 버튼으로 아이캠퍼스를 열고 로그인해요', '"승인된 통합" 아래의 "새 액세스 토큰"을 눌러요', '목적에 "성공 알림" 같은 이름을 쓰고 만료일은 비워 두거나 학기 끝으로 정해요', '"토큰 생성"을 누르고 나오는 긴 글자를 복사해요. 한 번만 보여요', '위 입력칸에 붙여 넣고 "연결하기"를 눌러요']}
      note="아이캠퍼스에 확인한 뒤 암호화해 서버에만 보관해요. 읽기만 하고 내용을 바꾸지 않아요" /></>;
}

function Keys({ model }: { model: SettingsModel }) {
  if (!model.userId) return <div className="settings"><Back model={model} /><Section id="s-keys" title="연결 키"><LoginNote model={model} what="연결 키" /></Section></div>;
  return <div className="settings">
    <Back model={model} />
    <Section id="s-ai" title="AI 연결">
      <AiRows byok={model.byok} />
    </Section>
    <Section id="s-keys" title="아이캠퍼스 연결">
      <CanvasRow model={model} />
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
