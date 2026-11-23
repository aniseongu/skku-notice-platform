import { loadSaveCounts } from './save-counts';
import { showTestNotification } from './test-notification';
// 앱의 상태와 동작. 화면은 notice-shell.tsx가 이 컨트롤러를 구독해 그린다(그림자 DOM 없이 전역 토큰과 글꼴을 그대로 받는다).
// 규칙은 docs/DESIGN.md, docs/design/ux-rules.md, docs/design/platforms.md.
import {
  type IconName, type Judgement, type MatchedFile, type Notice, type NoticeBody, type NoticesFile, type Source,
  boardName, cleanTitle, deadlineGroup, deadlinePassed, fetchBody, fetchJson, isExpired, keywordMatches, noticeKind, postedGroup, safeUrl, todayKst,
} from './data';
import { type SavedNotice, type SavedSort, SAVED_ORDER_LIMIT, loadSaved, orderSaved, parseSavedOrder, savedOrderToStore, storeSaved, toggleSaved } from './saved-notices';
import { initialReadState, isNoticeRead, loadReadState, mergeReadStates, parseReadState, readIds, setReadState, storeReadState } from './read-notices';
import { keywordCounts } from './keyword-counts';
import type { Theme } from './theme';
import { authClient } from './auth';
import { deadlineIso, isLimitReached, isMissingTable, loadOpportunities, removeOpportunity, saveOpportunity, OPPORTUNITY_LABELS, TITLE_MAX, URL_MAX, type Opportunity, type OpportunityStatus } from './opportunities';
import { AccountChanged, createTeamApi, isTeamNotice, isTeamUnavailable, teamErrorCode, teamErrorMessage, type TeamApi, type TeamApplicant, type TeamDraft, type TeamPost } from './team';
import type { TeamModel } from './team-section';
import { EMPTY_EXPERIENCES, createQuestionsApi, isQeUnavailable, qeErrorMessage, type ExperienceInput, type Experiences, type Question, type QuestionsApi, type QuestionsSessionGuard } from './questions';
import type { QuestionsModel, ReviewDraft } from './questions-section';
import { loadSubscriptions, setSubscription } from './source-subscriptions';
import { loadBoardOrderPreference, loadKeywordsPreference, loadSavedOrderPreference, parseKeywords, saveBoardOrderPreference, saveKeywordsPreference, saveSavedOrderPreference } from './preferences';
import { applyBoardOrder, BOARD_ORDER_LIMIT, parseBoardOrder } from './board-order';
import { loadNoticeStates, planStateSync, pushRead, pushSaved, sessionIs, type StatePlan } from './notice-state-sync';
import { connectionChain } from './connection-chain';
import { composeSummaryTime, deleteDevice, loadDevices, loadSummaryTime, saveCanvasMode, saveDeviceAlertAll, saveDeviceName, saveSummaryTime, suggestDeviceName, type CanvasMode, type Device } from './devices';
import { asJudgement, loadMyInterests, loadMyJudgments, type MyJudgment } from './my-notices';
import { CALENDAR_SCOPE, GoogleError, desiredEvents, ensureCalendar, googleReturnDenied, hasCalendarPending, markCalendarPending, syncCalendar, takeCalendarPending } from './google-calendar';
import { AI_PROVIDERS, DEFAULT_AI_PREFERENCES, loadAiKeyStatuses, loadAiPreferences, registerAiKey, removeAiKey, saveAiPreferences, type AiKeyStatus, type AiPreferences, type AiProvider } from './ai-providers';
import { sendFeedback, type FeedbackKind, type FeedbackResult } from './feedback';
import { listBoardRequests, submitBoardRequest } from './shared-board-requests';
import { checkByokAvailability, loadByokStatus, loadByokBackfillCount, loadCanvasStatus, deleteMyAccount, linkGoogleCalendar, loadGoogleAutoStatus, type GoogleAutoStatus, loadMyNoticeInfo, loadMyDeadlines, loadMyTranslations, loadMyTranslation, requestNoticeSummary, type MyNoticeInfo, type MyTranslation, type MyTranslationTitle, registerByokKey, registerCanvasToken, removeByokKey, removeCanvasToken, type ByokStatus, type CanvasStatus } from './byok';
import { withMyDeadline } from './notice-view';
import { keywordMatchesNotice } from './keyword-match';
import { loadGraduation, loadGraduationStatuses, badgeOf, gradParts, requestGraduation, isInternshipNotice, type GradPart, type GraduationBadge, type GraduationStatuses, isSoftwareOriginal, visibleTracks, type GraduationAssessment } from './graduation-assessment';
import { EMPTY_PROFILE, loadProfile, saveProfile as storeProfile, type UserProfile } from './profile';
import { initialDraft, missingRequired, savedDoubleAnswer, type Draft, type Step } from './onboarding-flow';
import { note as pushNote, pushReport } from './push-diagnostics';
import { createEnableChain, deviceEndpoint, disableDevicePush, inspectDevicePush, releaseDevicePush } from './platform-browser-push';
import { localKey, setLocalOwner } from './local-scope.ts';
import { isRememberedOnboarded, rememberOnboarded } from './onboarded-flag.ts';
import type { Subscription } from '@supabase/supabase-js';
import { dropDuplicates, groupMates } from './dup-notices';
import type { ExploreItem } from './explore-map';
import { orderNotices, type Sort } from './notice-order';
import { Reactive, defineReactive } from './reactive';
import { isNoticeId, loadPublicNotice, noticeIdFromSearch, noticeLink, withoutNotice, type PublicNotice } from './deeplink';
import { clearSettingsCache, loadSettingsCache, saveSettingsCache, type SettingsData, type SettingsPush } from './settings-cache';
import { clearListCache, loadListCache, saveListCache } from './list-cache';
import { clearDetailCache, loadDetailCache, saveDetailField, type DetailFields } from './detail-cache';
import { loadPublicBody, loadSavedNoticeDetails } from './platform-data';
import { changeInbox, clearInbox, listenInboxChanged, loadInbox, noticeIdOfItem, pruneStoredInbox, releaseInbox, safeInboxUrl, setInboxOwner, unreadCount, type InboxChange, type InboxItem } from './inbox';

const COOP_KIND_ORDER = ['대기업', '중견기업', '중소기업', '스타트업', '기업', '공공기관', '연구기관', '협회/기타', '기타 기관'];
/** 기관 구분이 비어 있는 현장실습은 '기타 기관'으로 묶는다. */
const coopKindOf = (notice: { category: string | null }) => notice.category || '기타 기관';
export type Tab = 'all' | 'intern' | 'coop' | 'saved';
export type View = Tab | 'settings';
export const TABS: { id: Tab; label: string; icon: IconName }[] = [
  { id: 'all', label: '성대 공지', icon: 'list' },
  // 전체는 성균관대 공지만, 인턴 공고는 링커리어와 자소설닷컴(사용자 결정 2026-11-03, D-026).
  { id: 'intern', label: '인턴 공고', icon: 'briefcase' },
  // 톨게이트 현장실습(학교 로그인이 필요해 서버 가져오기로 채운다). 인턴 공고 탭에는 섞이지 않는다.
  { id: 'coop', label: '현장실습', icon: 'user-check' },
  { id: 'saved', label: '저장', icon: 'bookmark' },
];
const GENERIC_INTERN = /^(인턴|인턴십|인턴쉽|intern|internship)$/i;
export const STALE_MS = 2 * 3600_000;
// 화면을 켜 둔 채로 있어도 1시간 주기의 새 공지와 D-day가 바뀌도록 5분마다 다시 받는다.
/** 로그인 뒤 같은 자리로 돌아오게 현재 주소를 쓴다. 로그인 결과가 남긴 code, error, 해시만 뺀다(딥링크와 ?view=settings는 유지). */
function cleanReturnUrl(): string {
  const url = new URL(location.href);
  for (const key of ['code', 'error', 'error_code', 'error_description']) url.searchParams.delete(key);
  url.hash = '';
  return url.href;
}

const REFRESH_MS = 5 * 60_000;
const isTab = (value: string | null): value is Tab => TABS.some((t) => t.id === value);
const normalizeTab = (value: string | null) => value === 'mine' || value === 'deadline' ? 'all' : value;
const INTERACTIVE = 'a, button, input, textarea, select, [contenteditable]';
const wide = matchMedia('(min-width: 1080px)');
const shareWide = matchMedia('(min-width: 720px)');
const browserTab = matchMedia('(display-mode: browser)');

/** Google 로그인이 주는 프로필 사진 주소만 쓴다(그 밖의 주소는 사진으로 불러오지 않는다). */
export function safeAvatarUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    return url.protocol === 'https:' && !url.username && !url.password && (host === 'googleusercontent.com' || host.endsWith('.googleusercontent.com')) ? url.href : null;
  } catch { return null; }
}

export function settingsSectionFromUrl(): string | null {
  const params = new URLSearchParams(location.search);
  if (params.get('keys') === '1') return 'keys';
  const section = params.get('section');
  return section && ['notifications', 'canvas', 'keywords', 'calendar', 'profile', 'feedback', 'inbox', 'explore', 'blocks'].includes(section) ? section : null;
}

/** 설정 머리의 부제. 쪽마다 그 쪽에서 하는 일을 말한다. */
export function settingsSubtitle(): string {
  switch (settingsSectionFromUrl()) {
    case 'notifications': return '받을 게시판과 이 기기 알림을 정해요';
    case 'canvas': return '과제 마감과 하루 요약을 알려 드려요';
    case 'keywords': return '관심 있는 공지를 골라 봐요';
    case 'calendar': return '저장한 공지의 마감을 구글 캘린더에 넣어요';
    case 'profile': return '내 정보와 AI에게 알려 줄 내용을 적어요';
    case 'keys': return 'AI 키를 관리해요';
    case 'feedback': return '궁금한 점이나 바라는 점을 남겨 주세요';
    case 'inbox': return '이 기기가 받은 알림을 다시 봐요';
    case 'explore': return '기록한 활동이 어느 영역에 있는지 봐요';
    case 'blocks': return '차단한 작성자를 관리해요';
    default: return '알림과 연결을 정해요';
  }
}

export function settingsTitle(): string {
  const params = new URLSearchParams(location.search);
  if (params.get('keys') === '1') return 'AI 연결';
  return ({ notifications: '알림', canvas: '아이캠퍼스', keywords: '관심 키워드', calendar: '구글 캘린더', profile: '프로필 설정', feedback: '문의하기', inbox: '알림함', explore: '탐험 지도', blocks: '차단 관리' } as Record<string, string>)[params.get('section') ?? ''] ?? '설정';
}

export interface InstallPrompt extends Event { prompt(): Promise<void> }
declare global { interface Window { __skkuInstallPrompt: InstallPrompt | null } }

// 선택 모드와 고른 공지도 이 탭에만 기억한다. 새로고침해도 선택하던 그대로 두고, 계정이 바뀌면 지운다.
interface SavedSelection { user: string; ids: string[] }
function savedSelection(): SavedSelection | null {
  try {
    const value = JSON.parse(sessionStorage.getItem('selection') ?? 'null') as Partial<SavedSelection> | null;
    return value && typeof value.user === 'string' && Array.isArray(value.ids) ? { user: value.user, ids: value.ids.filter((id) => typeof id === 'string') } : null;
  } catch { return null; }
}
function storeSelection(value: SavedSelection | null) {
  try { if (value) sessionStorage.setItem('selection', JSON.stringify(value)); else sessionStorage.removeItem('selection'); } catch { /* 저장소를 못 쓰면 기억하지 않는다 */ }
}

// 고른 공지는 이 탭에만 기억한다. 새로고침하면 보던 공지로 돌아오고, 새 탭은 맨 위에서 시작한다.
function rememberSelected(id?: string | null): string | null {
  try {
    if (id === undefined) return sessionStorage.getItem('selected');
    if (id) sessionStorage.setItem('selected', id);
    else sessionStorage.removeItem('selected');
  } catch { /* 저장소를 못 쓰면 기억하지 않는다 */ }
  return id ?? null;
}

export function remember(key: string, value?: string): string | null {
  try {
    const storageKey = ['keywords', 'board', 'board-order', 'saved-order', 'view-unread', 'onboarding-dismissed'].includes(key) ? localKey(key) : key;
    if (value === undefined) return localStorage.getItem(storageKey);
    localStorage.setItem(storageKey, value);
  } catch { /* 사생활 보호 모드에서는 기억하지 않는다 */ }
  return value ?? null;
}

function loadSort(tab: 'all' | 'intern' | 'coop'): Sort {
  const params = new URLSearchParams(location.search);
  if (tab === 'all' && params.get('tab') === 'deadline') return 'deadline';
  const requested = params.get('sort');
  if (normalizeTab(params.get('tab') ?? remember('tab')) === tab && (requested === 'latest' || requested === 'deadline')) return requested;
  const saved = remember(tab === 'intern' ? 'intern-sort' : tab === 'coop' ? 'coop-sort' : 'notice-sort');
  // 현장실습은 접수마감이 빠른 순이 기본이다(신청 기간이 있는 공고라서).
  return saved === 'latest' || saved === 'deadline' ? saved : tab === 'coop' ? 'deadline' : 'latest';
}

function loadBoardOrder(): string[] {
  try { return parseBoardOrder(JSON.parse(remember('board-order') ?? '[]')); } catch { return []; }
}

function loadSavedOrder(): string[] {
  try { return parseSavedOrder(JSON.parse(remember('saved-order') ?? '[]')); } catch { return []; }
}

function loadKeywords(): string[] {
  try {
    const parsed = JSON.parse(remember('keywords') ?? '[]');
    return Array.isArray(parsed) ? parsed.filter((w): w is string => typeof w === 'string') : [];
  } catch { return []; }
}

// 설치한 앱의 상태바와 제목 표시줄 색(theme-color)도 실제 바탕색에 맞춘다.
// 기본 meta는 기기 설정(prefers-color-scheme)만 따르므로, 화면 모드를 직접 고르면 어긋났다.
function syncThemeColor() {
  // oklch 같은 새 색 표기를 모르는 브라우저도 있어 #rrggbb로 바꿔 넣는다.
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 1;
  const context = canvas.getContext('2d');
  if (!context) return;
  context.fillStyle = getComputedStyle(document.body).backgroundColor;
  context.fillRect(0, 0, 1, 1);
  const [r, g, b] = context.getImageData(0, 0, 1, 1).data;
  const color = `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
  for (const meta of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) meta.content = color;
}

function applyTheme(theme: Theme) {
  if (theme === 'auto') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
  requestAnimationFrame(syncThemeColor);
}

// 자동 모드에서 기기 설정이 바뀌어도 맞춘다.
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => requestAnimationFrame(syncThemeColor));


// 앱 루트 안의 요소를 찾는다. 화면은 한 문서에 하나뿐이다.
const qs = <T extends Element>(selector: string) => document.querySelector<T>(selector);
const qsel = (selector: string) => document.querySelector(selector);

export class AppController extends Reactive {
  static properties = {
    saveCounts: { state: true },
    notices: { state: true }, sources: { state: true }, matched: { state: true }, generatedAt: { state: true },
    view: { state: true }, board: { state: true }, keyword: { state: true }, keywords: { state: true }, query: { state: true },
    loading: { state: true }, devicesLoaded: { state: true }, accountDataLoaded: { state: true }, aiStateLoaded: { state: true }, settingsCapped: { state: true }, failed: { state: true }, selectedId: { state: true }, install: { state: true },
    inboxItems: { state: true },
    inboxDialogOwner: { state: true },
    teamState: { state: true }, teamBusy: { state: true }, teamUnavailable: { state: true },
    qeState: { state: true }, qeBusy: { state: true }, qeUnavailable: { state: true },
    opportunities: { state: true }, opportunitiesStatus: { state: true }, opportunitiesLoading: { state: true }, opportunityFilter: { state: true },
    exploreSavedStatus: { state: true },
    toast: { state: true }, linkCopied: { state: true }, toastLink: { state: true }, toastLinkLabel: { state: true }, isWide: { state: true }, theme: { state: true },
    detailOpen: { state: true }, openedId: { state: true }, shortcutsOpen: { state: true }, boardMenuOpen: { state: true }, sortMenuOpen: { state: true },
    saved: { state: true }, read: { state: true }, collapsed: { state: true }, sort: { state: true }, internSort: { state: true }, coopSort: { state: true }, coopKind: { state: true }, savedSort: { state: true },
    authReady: { state: true }, authUserId: { state: true }, authEmail: { state: true }, authError: { state: true }, authBusy: { state: true }, authName: { state: true }, authAvatar: { state: true }, pushStatus: { state: true }, pushError: { state: true }, pushRetry: { state: true },
    aiKeys: { state: true }, aiPrefs: { state: true }, aiBusy: { state: true }, aiError: { state: true },
    byokOn: { state: true }, byokBackfill: { state: true }, byokStatus: { state: true }, byokLoading: { state: true }, byokBusy: { state: true }, byokError: { state: true }, canvasStatus: { state: true }, canvasBusy: { state: true }, canvasError: { state: true },
    calendarId: { state: true }, calendarBusy: { state: true }, calendarMessage: { state: true }, calendarError: { state: true }, calendarSyncedAt: { state: true },
    myJudgments: { state: true }, myInterests: { state: true }, graduationStatuses: { state: true }, graduationOnly: { state: true }, graduationBusy: { state: true }, graduationError: { state: true },
    devices: { state: true }, thisDeviceId: { state: true }, devicesBusy: { state: true }, devicesError: { state: true }, devicesLoadFailed: { state: true }, summaryTime: { state: true },
    calendarAuto: { state: true },
    accountBusy: { state: true }, accountError: { state: true },
    sharedDetail: { state: true }, shareWide: { state: true },
    aiHintTick: { state: true }, deepId: { state: true }, preview: { state: true }, deepNotice: { state: true },
    summarizing: { state: true }, summaryError: { state: true }, summaryErrorId: { state: true },
    profile: { state: true }, profileStatus: { state: true }, profileMessage: { state: true }, profileError: { state: true }, settingsSection: { state: true },
    onboardingOpen: { state: true }, onboardingDismissed: { state: true }, onboardingBusy: { state: true }, onboardingError: { state: true },
    keywordNote: { state: true },
    subscriptions: { state: true }, subscriptionsLoading: { state: true }, subscriptionsError: { state: true },
    boardOrder: { state: true }, boardOrderStatus: { state: true }, savedOrder: { state: true }, savedOrderStatus: { state: true }, savedOrderAccount: { state: true }, reordering: { state: true }, statusMenuOpen: { state: true },
    preferencesLoading: { state: true }, preferencesError: { state: true }, preferencesUnavailable: { state: true },
    unreadOnly: { state: true }, selecting: { state: true }, selectedReads: { state: true },
  };

  preferencesLoading = false;
  boardOrder: string[] = loadBoardOrder();
  /** 계정에 저장한 결과. 열이 없으면(아직 적용 전) 아무것도 보이지 않는다. */
  boardOrderStatus: '' | 'saved' | 'failed' = '';
  boardOrderAccount = false;
  boardOrderChain: Promise<void> = Promise.resolve();
  /** 저장 목록을 사용자가 직접 정한 순서(공지 id). 계정에 저장하고, 열이 없으면 이 기기에만 둔다. */
  savedOrder: string[] = loadSavedOrder();
  savedOrderStatus: '' | 'failed' = '';
  savedOrderAccount = false;
  /** 응답을 기다리는 사이 이 기기에서 순서를 바꿨는지(바꿨으면 응답으로 덮지 않는다) */
  savedOrderTouched = false;
  savedOrderChain: Promise<void> = Promise.resolve();
  /** 저장 목록의 순서 바꾸기 모드 */
  reordering = false;
  statusMenuOpen = false;
  preferencesError = '';
  preferencesUnavailable = false;
  subscriptions: string[] = [];
  subscriptionsLoading = false;
  subscriptionsError = '';
  subscriptionsEpoch = 0;
  private cacheReady = false;
  private liveFeedReady = false;
  private liveAccountReady = false;
  private savedTouched = new Set<string>();
  private liveListFields = new Set<'deadlines' | 'judgments' | 'interests' | 'translations' | 'graduation'>();
  seenAddedBoardRequests = new Set<string>();
  pushStatus: 'unsupported' | 'checking' | 'off' | 'on' | 'busy' | 'denied' = 'checking';
  pushError = '';
  // 클릭 안에서 권한 요청을 바로 부르려면 등록과 공개키를 미리 받아 둔다.
  pushRegistration: ServiceWorkerRegistration | null = null;
  pushVapidKey: string | null = null;
  stateSyncedEpoch = -1;
  stateChain: { run: () => Promise<boolean>; epoch: number } | null = null;
  // 실패한 켜기 작업을 이어서 실행하기 위해 사용자와 epoch마다 하나만 보관한다.
  pushChain: { chain: ReturnType<typeof createEnableChain>; userId: string; epoch: number } | null = null;
  pushRetry = false;
  byokOn = false;
  /** 키 기능이 켜졌는지 서버에 한 번이라도 물어봤는지. 모르는 동안은 AI 키 상태를 기다린다. */
  private byokChecked = false;
  private byokUnavailable = false;
  aiKeys: AiKeyStatus[] = [];
  aiPrefs: AiPreferences = DEFAULT_AI_PREFERENCES;
  aiBusy = false;
  aiError = '';
  byokStatus: ByokStatus | null = null;
  byokBackfill = 0;
  private byokPoll: ReturnType<typeof setTimeout> | null = null;
  byokLoading = false;
  byokBusy = false;
  byokError = '';
  canvasStatus: CanvasStatus | null = null;
  canvasBusy = false;
  canvasError = '';
  /** 구글 캘린더: 앱이 만든 "성대 공지" 캘린더 id와 마지막으로 맞춘 시각 */
  calendarId: string | null = null;
  calendarBusy = false;
  calendarMessage = '';
  calendarError = '';
  calendarSyncedAt: string | null = null;
  /** 요약을 만드는 중인 공지 id와 마지막 오류 */
  /** 내 Gemini 키로 매긴 판정과 서버가 찾아 준 관심 키워드(원본의 matched.json 자리) */
  myJudgments = new Map<string, MyJudgment>();
  myInterests = new Map<string, string[]>();
  /** 기기 목록을 이 계정에서 한 번이라도 받았는지. 받기 전에는 알림 설정의 기기 구역 아래를 그리지 않는다(나중에 끼어들어 아래가 밀리지 않게). */
  devicesLoaded = false;
  /** 내 알림 기기 목록, 이 기기의 번호, 하루 요약 시간(HH:MM, 아이캠퍼스 토큰이 없으면 null) */
  devices: Device[] = [];
  thisDeviceId: string | null = null;
  devicesBusy = false;
  devicesError = '';
  /** 기기 목록을 받지 못했다(다시 받기를 눌러 이어 간다). */
  devicesLoadFailed = false;
  summaryTime: string | null = null;
  summarizing: string | null = null;
  /** AI 연결 안내를 닫은 횟수 표시(바뀌면 화면이 다시 그려진다). */
  aiHintTick = 0;
  private aiHintSession = new Set<string>();
  accountBusy = false;
  /** 서버가 캘린더를 자동으로 맞추는 상태(연결할 때 맡긴 구글 열쇠가 있는지, 마지막으로 맞춘 시각, 오류) */
  calendarAuto: GoogleAutoStatus = { active: false, error: null, lastRunAt: null };
  accountError = '';
  summaryError = '';
  summaryErrorId: string | null = null;
  profile: UserProfile = EMPTY_PROFILE;
  profileStatus: 'idle' | 'loading' | 'ready' | 'unavailable' = 'idle';
  profileMessage = '';
  profileError = '';
  // 설정 화면의 하위 쪽(원본과 같은 ?view=settings&section=... 주소). keys=1은 연결 키 쪽이다.
  settingsSection: string | null = settingsSectionFromUrl();
  private returningToSettingsHome = false;
  private closingSettings = false;
  onboardingOpen = false;
  onboardingDismissed = false;
  onboardingBusy = false;
  onboardingError = '';
  private onboardingChain: { key: string; run: () => Promise<void> } | null = null;
  keywordNote = '';
  // 알림함(이 기기가 받은 푸시, 서버에는 없다). 계정이 바뀌면 비우고 새 계정 것만 다시 읽는다.
  inboxItems: InboxItem[] = [];
  private inboxDialogOwner: string | null = null;
  private inboxOpenId: string | null = null;
  private inboxSeq = 0;
  // 내 기회함(상태·메모). 계정이 바뀌면 비운다. 표가 없거나 못 불러오면 'unavailable'로 두고 화면에서 숨긴다.
  opportunities = new Map<string, Opportunity>();
  opportunitiesStatus: 'idle' | 'ready' | 'unavailable' | 'failed' = 'idle';   // unavailable: 표 없음, failed: 일시적 오류(다음 새로고침에 다시 시도)
  private opportunityQueue = new Map<string, Promise<unknown>>();
  private opportunitiesLoading = false;
  private exploreSavedStatus: 'idle' | 'ready' | 'failed' = 'idle';
  opportunityFilter: 'all' | OpportunityStatus = 'all';
  // 공고별 팀원 모집(공고 한 건의 목록만 들고 있는다). 계정이 바뀌면 비운다. 함수가 운영에 없으면 구역을 숨긴다.
  teamState: { noticeId: string | null; status: 'loading' | 'ready' | 'failed'; posts: TeamPost[] } = { noticeId: null, status: 'loading', posts: [] };
  teamBusy = false;
  qeState: { noticeId: string | null; status: 'loading' | 'ready' | 'failed'; questions: Question[]; experiences: Experiences } = { noticeId: null, status: 'loading', questions: [], experiences: EMPTY_EXPERIENCES };
  qeBusy = false;
  private qeBusyCount = 0;
  private qeWrites = new AbortController();
  private qeUnblockPending: Promise<boolean> | null = null;
  qeUnavailable = false;
  /** 시험에서 서버 대신 메모리 가짜를 끼운다. */
  qeApiOverride: QuestionsApi | null = null;
  private qeSeq = 0;
  private teamBusyCount = 0;
  teamUnavailable = false;
  /** 시험에서 서버 대신 쓰는 가짜. 비어 있으면 로그인한 계정의 Supabase를 쓴다. */
  teamApiOverride: TeamApi | null = null;
  private teamSeq = 0;
  private opportunityWrites = new Map<string, number>();
  private keywordWrite: Promise<void> = Promise.resolve();
  /** 주소의 ?notice=<id>. 한 번 열면 비운다(미리보기와 로그인 사용자의 상세 열기가 이 값을 쓴다). 형식이 틀리면 처음부터 null. */
  deepId: string | null = noticeIdFromSearch(location.search);
  /** 비로그인 공유 화면의 단건 조회 상태. */
  preview: { status: 'idle' | 'loading' | 'ready' | 'missing' | 'error'; data?: PublicNotice } = { status: 'idle' };
  /** 딥링크로 열었는데 목록에 없는 공지 한 건. 목록·캐시에는 섞지 않는다. */
  deepNotice: PublicNotice | null = null;
  sharedDetail: string | null = null;
  private subscribedShareId: string | null = null;
  shareWide = shareWide.matches;
  get usesDetailPane(): boolean { return this.isWide || (this.shareWide && this.sharedDetail !== null); }
  get sharedFailure(): boolean { return this.sharedDetail === 'missing' || this.sharedDetail === 'error'; }
  private deepLookup: { id: string; result?: PublicNotice | null; failed?: boolean; feedWaitEnded?: boolean } | null = null;
  private previewRequest = 0;
  authReady = !authClient;
  authEmail: string | null = null;
  authName: string | null = null;
  authAvatar: string | null = null;
  authError = '';
  authBusy = false;
  authUserId: string | null = null;
  authSubscription: Subscription | null = null;
  saveCounts = new Map<string, number>();
  private saveCountRevision = 0;
  // 수를 불러오는 동안 저장을 바꾼 글. 불러온 값 대신 화면에서 바꾼 값을 지킨다.
  private saveCountTouched = new Set<string>();
  notices: Notice[] = [];
  sources: Source[] = [];
  matched: MatchedFile | null = null;
  generatedAt: string | null = null;
  view: View = new URLSearchParams(location.search).get('view') === 'settings'
    ? 'settings' : [normalizeTab(new URLSearchParams(location.search).get('tab')), normalizeTab(remember('tab'))].find(isTab) ?? 'all';
  /** 설정에 들어가기 전에 보던 목록 보기. 설정 안에서도 왼쪽 메뉴가 쓰던 상태(탭, 게시판 목록) 그대로 보이게 한다. */
  listTab: Tab = [normalizeTab(new URLSearchParams(location.search).get('tab')), normalizeTab(remember('tab'))].find(isTab) ?? 'all';
  sort: Sort = loadSort('all');
  internSort: Sort = loadSort('intern');
  coopSort: Sort = loadSort('coop');
  /** 현장실습 기관 구분(대기업, 중소기업, 스타트업 등). 'all'이면 모두. */
  coopKind = remember('coop-kind') ?? 'all';
  savedSort: SavedSort = ((v) => v === 'deadline' || v === 'custom' ? v : 'latest')(remember('saved-sort'));
  unreadOnly = remember('view-unread') === '1';
  selecting = savedSelection() !== null;
  selectedReads: string[] = savedSelection()?.ids ?? [];
  private selectionReady = !authClient;   // 로그인 확인이 없는 환경은 처음부터, 있는 환경은 계정을 확인한 뒤부터 기억한다
  board = remember('board') ?? 'all';
  keyword: string | null = null;
  keywords = loadKeywords();
  saved: SavedNotice[] = loadSaved();
  collapsed: string[] = (() => { try { const v = JSON.parse(remember('side-collapsed') ?? '[]'); return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []; } catch { return []; } })();
  // 읽은 글 id(최근 것만). null이면 이 기기에서 처음 연 것이라 지금 글을 모두 읽은 것으로 둔다.
  readState = loadReadState();
  needsReadBaseline = this.readState === null;
  read: string[] | null = this.readState ? readIds(this.readState) : null;
  query = '';
  /** 화면 반영 뒤: 고른 공지를 이 탭에 기억한다. */
  commit(): void {
    super.commit();
    if (this.selectedId !== this.lastSelected) {
      this.lastSelected = this.selectedId;
      rememberSelected(this.selectedId);
    }
  }

  loading = true;
  /** 개인 표지와 AI 대기 건수를 처음 계산할 수 있는지. 목록 자체는 피드와 구독 범위가 오면 먼저 그린다. */
  accountDataLoaded = true;
  aiStateLoaded = true;
  /** 설정 화면이 기다리는 상한(FIRST_LOAD_LIMIT_MS)이 지났다. 응답이 없는 항목이 있어도 그때는 그린다. */
  settingsCapped = true;
  private storedSettings: Partial<SettingsData> | null = null;
  private liveSettings = new Set<keyof SettingsData>();

  cachedSetting<K extends keyof SettingsData>(field: K): SettingsData[K] | undefined {
    return this.liveSettings.has(field) ? undefined : this.storedSettings?.[field];
  }

  private async restoreSettings(userId: string, epoch: number) {
    const stored = await loadSettingsCache(userId);
    if (stored && this.isCurrentAccount(userId, epoch)) {
      this.storedSettings = stored;
      this.requestUpdate();
    }
  }

  private recordSetting<K extends keyof SettingsData>(userId: string, epoch: number, field: K, value: SettingsData[K]) {
    if (!this.isCurrentAccount(userId, epoch)) return;
    const previous = this.storedSettings?.[field];
    const first = !this.liveSettings.has(field);
    this.liveSettings.add(field);
    if (first && previous !== undefined) {
      this.requestUpdate();
      if (JSON.stringify(previous) === JSON.stringify(value)) return;
    }
    void saveSettingsCache(userId, { [field]: value });
  }

  private recordAiSettings(userId: string, epoch: number) {
    const status = this.byokStatus;
    this.recordSetting(userId, epoch, 'ai', {
      available: this.byokOn,
      status: status && { keyHint: status.keyHint, model: status.model, disabled: status.disabled, usedToday: status.usedToday, lastError: null },
      keys: this.aiKeys.map(({ provider, keyHint, model, disabled, usedToday }) => ({ provider, keyHint, model, disabled, usedToday, lastError: null })),
      prefs: { aiEnabled: this.aiPrefs.aiEnabled }, backfill: this.byokBackfill,
    });
  }

  private recordCanvasSettings(userId: string, epoch: number) {
    const status = this.canvasStatus;
    this.recordSetting(userId, epoch, 'canvas', status && {
      keyHint: status.keyHint, disabled: status.disabled, lastOkAt: status.lastOkAt, lastError: null,
    });
  }

  private recordDevices(userId: string, epoch: number) {
    this.recordSetting(userId, epoch, 'devices', {
      items: this.devices.map(({ id, name, canvasMode, createdAt, alertAllNew }) => ({ id, name, canvasMode, createdAt, alertAllNew })),
      thisId: this.thisDeviceId, summaryTime: this.summaryTime,
    });
  }

  private recordCalendar(userId: string, epoch: number) {
    this.recordSetting(userId, epoch, 'calendar', {
      connected: !!this.calendarId, syncedAt: this.calendarSyncedAt,
      auto: { active: this.calendarAuto.active, lastRunAt: this.calendarAuto.lastRunAt, error: null },
    });
  }

  private setCheckedPush(userId: string, epoch: number, status: SettingsPush) {
    if (!this.isCurrentAccount(userId, epoch)) return;
    this.pushStatus = status;
    this.recordSetting(userId, epoch, 'push', status);
  }
  /** 첫 목록을 무작정 기다리지 않게 하는 상한. 이 시간이 지나면 받은 것만으로 그린다. */
  static readonly FIRST_LOAD_LIMIT_MS = 5000;
  /** 마지막 refresh가 시작한 내 판정 읽기. 직접 새로고침의 결과를 셀 때 기다린다. */
  private mineSync: Promise<void> | null = null;
  failed = false;
  selectedId: string | null = rememberSelected();
  private lastSelected: string | null | undefined = undefined;
  install: InstallPrompt | null = null;
  toast = '';
  toastLink: string | null = null;
  toastLinkLabel = '';
  isWide = wide.matches;
  theme: Theme = (['light', 'dark'].includes(remember('theme') ?? '') ? remember('theme') : 'auto') as Theme;
  // 넓은 화면의 오른쪽 상세 칸을 열어 둘지(닫으면 목록이 넓어진다). 기억한다.
  // 새로고침 때는 보던 공지가 있을 때만 상세 칸을 연다. 목록 조건을 바꿔 닫은 상태는 저장하지 않으므로(listChanged), 보던 공지가 없는데
  // 저장된 "열어 둠"만 보고 열면 첫 공지가 저절로 열려 읽은 글처럼 보인다. 선택하던 중(선택 모드)이어도 열지 않는다.
  detailOpen = remember('detail') !== '0' && savedSelection() === null && this.selectedId !== null;
  // 휴대폰에서 앱 안 상세 화면으로 연 글. 뒤로 가기(history)로 닫는다.
  openedId: string | null = null;
  shortcutsOpen = false;
  boardMenuOpen = false;
  sortMenuOpen = false;
  // 글별 본문(D-013). 'loading'이면 받는 중, null이면 아직 서버가 받지 않은 글.
  bodies = new Map<string, NoticeBody | null | 'loading'>();
  /** 본문 요청마다 하나. 시간 초과·다시 불러오기·계정 전환·새로고침 때 끊는다. */
  private bodyAborts = new Map<string, AbortController>();
  /** 내 Gemini 요약. 공유 본문 캐시와 따로 두어 계정이 바뀌면 비운다. */
  summaries = new Map<string, MyNoticeInfo | null | 'loading'>();
  myDeadlines = new Map<string, Pick<MyNoticeInfo, 'deadline' | 'deadlineKind'>>();
  private deadlineRequest = 0;
  private summaryDeadlineWrites = new Map<string, { request: number; deadline: Pick<MyNoticeInfo, 'deadline' | 'deadlineKind'> }>();
  myTranslations = new Map<string, MyTranslationTitle>();
  /** 'failed'는 서버 조회 실패(늦게 오는 기기 캐시가 채울 수 있다), null은 서버가 확인한 '번역 없음'이다. */
  private detailTranslations = new Map<string, MyTranslation | null | 'loading' | 'failed'>();
  private translationRequest = 0;
  toastTimer = 0;
  /** 링크를 복사한 직후 잠깐 true: 공유 단추가 체크로 바뀌어 누른 자리에서 결과를 보여 준다 */
  linkCopied = false;
  copiedTimer = 0;
  // 상세 칸에 실제로 보이는 글(고른 글이 없으면 첫 글). 목록 행 표시와 맞춘다.
  shownId: string | null = null;

  /** 키 연결 기능이 켜져 있는지 서버에 다시 묻는다. 첫 설정의 AI 키 단계에서 "다시 확인하기"도 이걸 쓴다. */
  async recheckByok(): Promise<boolean> {
    const result = await checkByokAvailability(import.meta.env.VITE_SUPABASE_URL);
    const available = result === true;
    this.byokOn = available;
    this.byokUnavailable = result === false;
    this.byokChecked = true;
    if (!available) this.aiStateLoaded = true;   // 키 기능이 없으면 기다릴 AI 상태가 없다
    if (this.authUserId) {
      this.byokLoading = available;
      void this.refreshByok(this.authUserId, this.subscriptionsEpoch);
    }
    return available;
  }

  /** 화면에 붙을 때 한 번 부른다. 이벤트 구독과 첫 데이터 읽기를 시작한다. */
  start() {
    this.install = window.__skkuInstallPrompt ?? null;
    this.subscribe(() => { if (this.selectionReady) storeSelection(this.selecting ? { user: this.authUserId ?? 'guest', ids: this.selectedReads } : null); });
    // 새 문서는 목록에서 시작한다. 이전 문서의 상세 history 상태가 설정 닫기에서 되살아나지 않게 맞춘다.
    if (history.state?.notice) history.replaceState(null, '');
    remember('notice-sort', this.sort);
    remember('intern-sort', this.internSort);
    remember('coop-sort', this.coopSort);
    applyTheme(this.theme);
    // 구글 화면에서 취소하고 돌아오면 주소에 오류가 붙는다. 조용히 지운다(오류 문구 없음).
    if (authClient && /[?&#](error|error_description)=/.test(location.search + location.hash)) history.replaceState(history.state, '', cleanReturnUrl());
    if (authClient) {
      this.checkCalendarReturn();
      this.authSubscription = authClient.auth.onAuthStateChange((_event, session) => {
        const userId = session?.user.id ?? null;
        const loggedIn = !!userId && userId !== this.authUserId && this.authReady;
        if (!this.authReady || userId !== this.authUserId) {
          const previousUserId = this.authUserId;
          if (previousUserId) {
            this.deepId = noticeIdFromSearch(location.search);
            this.inboxOpenId = null;
            this.selectedId = null; this.openedId = null;
            void clearDetailCache(previousUserId);
          }
          if (previousUserId && !userId) {
            void clearListCache(previousUserId);
            void clearSettingsCache(previousUserId);
          }
          this.storedSettings = null;
          this.liveSettings.clear();
          this.cacheReady = false; this.liveFeedReady = false; this.liveAccountReady = false;
          this.liveListFields.clear(); this.savedTouched.clear();
          this.detailRestores = new Map(); this.missingSummaries = new Set();
          this.opportunityWrites = new Map();
          this.saveCounts = new Map(); ++this.saveCountRevision;
          this.notices = []; this.sources = []; this.generatedAt = null; this.abortBodies(); this.bodies.clear();
          this.deepNotice = null; this.sharedDetail = null; this.subscribedShareId = null; this.deepLookup = null; ++this.previewRequest;
          this.preview = { status: 'idle' };
          const kept = savedSelection(); this.selectionReady = false;   // 아래에서 계정을 바꾸는 동안 저장된 선택을 덮어쓰지 않는다
          this.authUserId = userId;
          const epoch = this.advanceAccountEpoch();
          this.syncInboxOwner(userId, previousUserId);
          this.myDeadlines = new Map(); this.summaryDeadlineWrites.clear(); ++this.deadlineRequest; this.myTranslations = new Map(); this.detailTranslations = new Map(); ++this.translationRequest;
          this.pushStatus = userId ? 'checking' : 'off'; this.pushError = ''; this.pushRetry = false;
          this.resetGraduations(); this.summaries = new Map(); this.liveInfo = new Set(); this.autoSummaries = new Set(); this.myJudgments = new Map(); this.myInterests = new Map(); this.graduationStatuses = new Map(); this.devices = []; this.devicesLoaded = false; this.thisDeviceId = null; this.devicesBusy = false; this.devicesError = ''; this.devicesLoadFailed = false; this.summaryTime = null; this.summarizing = null; this.summaryError = ''; this.summaryErrorId = null; this.byokStatus = null; this.aiKeys = []; this.aiPrefs = DEFAULT_AI_PREFERENCES; this.aiBusy = false; this.aiError = ''; this.byokBackfill = 0; if (this.byokPoll) { clearTimeout(this.byokPoll); this.byokPoll = null; } this.byokError = ''; this.byokBusy = false; this.canvasStatus = null; this.canvasError = ''; this.canvasBusy = false; this.calendarId = null; this.calendarSyncedAt = null; this.calendarAuto = { active: false, error: null, lastRunAt: null }; this.calendarBusy = false; this.calendarMessage = ''; this.calendarError = ''; if (!userId) this.forgetGoogleToken(); this.profile = EMPTY_PROFILE; this.profileMessage = ''; this.profileError = ''; this.keywordNote = '';
          this.opportunities = new Map(); this.opportunitiesStatus = 'idle'; this.opportunityFilter = 'all'; this.statusMenuOpen = false; this.reordering = false; this.opportunityQueue = new Map();
          this.teamState = { noticeId: null, status: 'loading', posts: [] }; this.teamBusy = false; this.teamBusyCount = 0; this.teamUnavailable = false; ++this.teamSeq;
          this.profileStatus = userId ? 'loading' : 'idle'; this.onboardingOpen = false; this.onboardingBusy = false; this.onboardingError = ''; this.onboardingChain = null;
          this.byokLoading = !!userId && this.byokOn;
          this.pushChain = null;
          if (previousUserId) setTimeout(() => {
            void this.releasePush(previousUserId, () => this.isCurrentAccount(userId, epoch));
          }, 0);
          this.subscriptions = [];
          this.subscriptionsError = '';
          this.subscriptionsLoading = !!userId;
          this.preferencesLoading = !!userId;
          this.preferencesError = '';
          this.preferencesUnavailable = false;
          this.accountDataLoaded = !userId; this.aiStateLoaded = !userId; this.settingsCapped = !userId;
          if (userId) setTimeout(() => {
            if (!this.isCurrentAccount(userId, epoch)) return;
            this.resumeDeepLink();
            void this.restoreSettings(userId, epoch);
            const restoring = this.restoreList(userId, epoch);
            const first = [this.refreshMyDeadlines(userId, epoch), this.refreshMyTranslations(userId, epoch), this.refreshMine(userId, epoch),
              this.refreshSubscriptions(userId, epoch), this.refreshPreferences(userId, epoch), this.refreshBoardOrder(userId, epoch)];
            void Promise.allSettled(first).then(() => {
              if (!this.isCurrentAccount(userId, epoch)) return;
              this.accountDataLoaded = true;
              void restoring.then(() => {
                if (!this.isCurrentAccount(userId, epoch)) return;
                this.liveAccountReady = true;
                this.saveCurrentListCache(userId, epoch);
              });
            });
            setTimeout(() => { if (this.isCurrentAccount(userId, epoch)) { this.accountDataLoaded = true; this.aiStateLoaded = true; this.settingsCapped = true; } }, AppController.FIRST_LOAD_LIMIT_MS);
            if (this.byokChecked) void this.refreshByok(userId, epoch);
            else void this.recheckByok();
            void this.refreshPush(userId, epoch); void this.refreshCalendar(userId, epoch); void this.syncStates(); void this.refreshProfile(userId, epoch);
            void this.refreshOpportunities(userId, epoch); void this.refreshSavedOrder(userId, epoch);
            void this.refreshDevices();
          }, 0);
          setLocalOwner(userId);
          this.saved = loadSaved();
          this.keywords = loadKeywords();
          this.boardOrder = loadBoardOrder();
          this.boardOrderStatus = '';
          this.boardOrderAccount = false;
          this.savedOrder = loadSavedOrder(); this.savedOrderStatus = ''; this.savedOrderAccount = false; this.savedOrderTouched = false;
          const startRead = initialReadState(loadReadState(), !!userId);
          this.readState = startRead.state;
          this.needsReadBaseline = startRead.needsBaseline;
          this.read = this.readState ? readIds(this.readState) : null;
          this.keyword = null;
          this.query = '';
          this.board = remember('board') ?? 'all';
          this.unreadOnly = remember('view-unread') === '1';
          if (!(kept && kept.user === (userId ?? 'guest'))) { this.selecting = false; this.selectedReads = []; }
          this.selectionReady = true;
        }
        this.authEmail = session?.user.email ?? null;
        // 구글 로그인 직후에만 접근 토큰이 온다. 캘린더 연결을 누르고 돌아온 경우에만 받아 두고 곧바로 일정을 맞춘다.
        if (this.calendarDenied && userId) { this.calendarDenied = false; this.calendarError = '구글에서 허용하지 않아 연결하지 못했어요. 다시 연결해 허용해 주세요'; }
        const providerToken = (session as { provider_token?: string | null } | null)?.provider_token;
        const providerRefresh = (session as { provider_refresh_token?: string | null } | null)?.provider_refresh_token;
        if (providerToken && userId && this.takeCalendarPending()) {
          this.rememberGoogleToken(providerToken);
          // 구글이 준 장기 열쇠는 서버에 맡겨 암호화해 보관한다. 그러면 서버가 30분마다 알아서 맞춘다.
          if (providerRefresh) void this.linkGoogleCalendar(providerRefresh);
          else this.calendarError = '구글이 자동 연결에 쓸 열쇠를 주지 않았어요. 다시 연결해 주세요';
          setTimeout(() => { void this.syncCalendarNow(); }, 0);
        }
        const meta = (session?.user.user_metadata ?? {}) as Record<string, unknown>;
        const name = meta.full_name ?? meta.name;
        this.authName = typeof name === 'string' && name.trim() ? name.trim().slice(0, 60) : null;
        this.authAvatar = safeAvatarUrl(meta.avatar_url ?? meta.picture);
        if (!userId && this.deepId && (!this.authReady || this.preview.status === 'idle')) void this.loadPreview();
        if (!this.authReady) { this.authReady = true; void this.refresh(true); }
        else if (loggedIn) void this.refresh(true);
      }).data.subscription;
    } else { void this.refresh(); }
    wide.addEventListener('change', () => { this.isWide = wide.matches; });
    shareWide.addEventListener('change', () => { this.shareWide = shareWide.matches; });
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { this.refresh(); void this.refreshInbox(); } });
    listenInboxChanged(() => { void this.refreshInbox(); });   // 다른 탭에서 읽음·삭제한 것
    try { navigator.serviceWorker?.addEventListener('message', this.onWorkerMessage); } catch { /* 서비스 워커가 없으면 창이 다시 보일 때만 읽는다 */ }
    window.setInterval(() => { if (document.visibilityState === 'visible') this.refresh(); }, REFRESH_MS);
    window.addEventListener('keydown', (event) => this.onKey(event));
    document.addEventListener('pointerdown', this.closeBoardMenuOutside);
    window.addEventListener('popstate', this.onPopState);
    window.addEventListener('beforeinstallprompt', (event) => { event.preventDefault(); this.install = event as InstallPrompt; });
    window.addEventListener('appinstalled', () => { this.install = null; });
  }

  stop() {
    this.authSubscription?.unsubscribe();
    this.authSubscription = null;
    document.removeEventListener('pointerdown', this.closeBoardMenuOutside);
    try { navigator.serviceWorker?.removeEventListener('message', this.onWorkerMessage); } catch { /* 서비스 워커 사용 불가 */ }
  }

  private onWorkerMessage = (event: MessageEvent) => {
    const message = event.data as { type?: unknown; noticeId?: unknown } | null;
    if (message?.type === 'inbox-changed') { void this.refreshInbox(); return; }
    if (message?.type !== 'open-notice' || !isNoticeId(message.noticeId) || !this.authReady
      || !event.source || event.source !== navigator.serviceWorker.controller || !event.ports[0]) return;
    const id = message.noticeId;
    this.deepLookup = null;
    this.closeInbox();   // 알림함 창이 떠 있으면 항목을 눌렀을 때와 같이 닫고 그 공지를 연다
    if (this.gated) {
      const url = noticeLink(id, location.href);
      if (url !== location.href) history.pushState(null, '', url);
      this.deepId = id;
      void this.loadPreview();
    } else if (this.view === 'settings') {
      this.inboxOpenId = id;
      this.closeSettings();
      this.handoffInboxOpen();
    } else {
      this.deepId = id;
      this.resumeDeepLink();
    }
    event.ports[0].postMessage(true);
    event.ports[0].close();
  };

  closeBoardMenuOutside = (event: PointerEvent) => {
    if (this.boardMenuOpen && !(event.target as Element).closest('.board-picker')) this.boardMenuOpen = false;
    if (this.sortMenuOpen && !(event.target as Element).closest('.sort-picker')) this.sortMenuOpen = false;
    if (this.statusMenuOpen && !(event.target as Element).closest('.status-picker')) this.statusMenuOpen = false;
  };

  /** 로그인 전에는 앱 어느 데이터도 받지 않는다. 로그인 화면만 보인다. */
  get gated() { return !!authClient && this.authReady && !this.authUserId; }

  async refresh(initial = false) {
    if (this.authReady === false || this.gated) return;
    const userId = this.authUserId, epoch = this.subscriptionsEpoch;
    this.loading = true;
    try {
      const notices = await fetchJson<NoticesFile>('notices.json');
      if (epoch !== this.subscriptionsEpoch || userId !== this.authUserId) return;
      // 뒤늦게 채운 본문도 새 수집 결과와 함께 다시 받는다.
      if (this.generatedAt !== notices!.generated_at) {
        if (this.liveFeedReady && this.deepNotice) {
          const { body, ...notice } = this.deepNotice;
          this.deepNotice = { ...notice, body: { ...body, body: null, body_html: null } };
        }
        this.generatedAt = notices!.generated_at;
        this.abortBodies();
        this.bodies = new Map();
      }
      // 기한이 지난 공지는 어느 목록에도 두지 않는다(저장·검색 포함). 서버가 나중에 지운다. 숨기는 곳은 여기 한 곳이다.
      const bySource = new Map(notices!.sources.map((source) => [source.id, source]));
      this.notices = notices!.notices.filter((notice) => !isExpired(notice, bySource.get(notice.source_id)));
      this.sources = notices!.sources;
      if (userId) void this.refreshSaveCounts(userId, epoch);
      this.liveFeedReady = true;
      if (userId) this.saveCurrentListCache(userId, epoch);
      if (this.sharedDetail && !this.sharedFailure) {
        const shared = this.deepShown(this.sharedDetail);
        if (shared) this.selectSharedTab(shared);
      }
      remember('has-coop', this.hasCoop() ? '1' : '0');
      if (userId && !initial) {
        void this.refreshMyDeadlines(userId, epoch);
        this.mineSync = this.refreshMine(userId, epoch);
        void this.refreshMyTranslations(userId, epoch);
      }
      // 개인용 서비스의 판정 결과는 플랫폼에서 읽지 않는다.
      this.matched = null;
      this.failed = false;
      // 로그인하지 않고 처음 열면 이미 있던 글이 모두 굵게 보이지 않게 읽은 것으로 시작한다. 계정은 안 읽음으로 시작한다.
      if (this.needsReadBaseline) {
        const baseline = parseReadState(JSON.stringify(this.notices.map((n) => n.id)));
        this.readState = mergeReadStates(baseline, this.readState ?? parseReadState(null));
        this.read = readIds(this.readState);
        storeReadState(this.readState);
        this.needsReadBaseline = false;
      }
      if (this.board !== 'all' && !this.sources.some((s) => s.id === this.board)) this.board = 'all';
      void this.syncStates();
    } catch (error) {
      if (epoch !== this.subscriptionsEpoch || userId !== this.authUserId) return;
      console.error(error);
      this.failed = true;
      if (this.notices.length) this.showToast('새 목록을 받지 못했어요. 잠시 뒤 새로고침해 주세요');
    } finally {
      if (epoch === this.subscriptionsEpoch && userId === this.authUserId) this.loading = false;
    }
    // 현장실습이 모두 마감돼 메뉴에서 사라졌는데 그 보기에 있으면 성대 공지로 옮긴다.
    if (!this.failed && this.tab() === 'coop' && !this.hasCoop() && !this.sharedDetail && !this.openedId && !(this.detailOpen && this.selectedId)) {
      if (this.view === 'settings') this.listTab = 'all'; else this.setView('all');
    }
  }

  /** 비로그인 미리보기: get_public_notice 한 건만 읽는다. */
  async loadPreview() {
    if (!authClient || !this.deepId) return;
    const id = this.deepId, request = ++this.previewRequest;
    this.preview = { status: 'loading' };
    try {
      const data = await loadPublicNotice(authClient, id);
      if (request !== this.previewRequest) return;
      this.preview = data ? { status: 'ready', data } : { status: 'missing' };
    } catch {
      if (request === this.previewRequest) this.preview = { status: 'error' };
    }
  }

  /** 캐시·목록에 있는 공지는 바로 연다. 단건 조회와 목록 중 먼저 찾은 쪽으로 상세를 그린다. */
  resumeDeepLink() {
    const id = this.deepId;
    if (!id || !this.authReady || this.gated || this.view === 'settings') return;
    this.loadDetailInfo(id);
    const cached = this.notices.find((notice) => notice.id === id);
    if (!cached && authClient && this.deepLookup?.id !== id) {
      const userId = this.authUserId, epoch = this.subscriptionsEpoch;
      const lookup: NonNullable<AppController['deepLookup']> = { id };
      this.deepLookup = lookup;
      void withTimeout(loadPublicNotice(authClient, id), 8_000).then(
        (notice) => { lookup.result = notice; },
        () => { lookup.result = null; lookup.failed = true; },
      ).then(() => {
        if (this.deepLookup !== lookup || !this.isCurrentAccount(userId, epoch)) return;
        if (this.deepId === id) this.resumeDeepLink();
        else {
          this.deepLookup = null;
          if (lookup.result) this.deepNotice = lookup.result;
          this.requestUpdate();
        }
        if (this.deepLookup === lookup && !lookup.result) setTimeout(() => {
          if (this.deepLookup !== lookup) return;
          lookup.feedWaitEnded = true;
          this.resumeDeepLink();
        }, 2_000);
      });
    }
    if (this.awaitingProfile() || this.needsOnboarding()) return;
    const found = this.deepLookup?.id === id ? this.deepLookup.result : undefined;
    const notice = cached ?? found?.notice;
    if (!notice && ((this.loading && !this.liveFeedReady && !this.deepLookup?.feedWaitEnded) || (authClient && found === undefined))) return;
    const failed = this.deepLookup?.failed ?? (!authClient && this.failed);
    const pendingLookup = notice && found === undefined ? this.deepLookup : null;
    this.clearDeepLink();
    this.deepLookup = pendingLookup;
    if (found) this.deepNotice = found;
    if (notice) {
      this.selectSharedTab(notice);
      this.markRead(notice);
    }
    this.subscribedShareId = null;
    this.sharedDetail = notice ? id : failed ? 'error' : 'missing';
    this.selectedId = notice ? id : null;
    this.detailOpen = true;
    this.openedId = !this.usesDetailPane && notice ? id : null;
    if (!this.usesDetailPane || history.state?.notice) {
      const state = { notice: notice ? id : null, sharedDetail: this.sharedDetail };
      if (history.state?.notice || history.state?.sharedDetail) history.replaceState(state, '');
      else history.pushState(state, '');
      window.scrollTo({ top: 0 });
    }
  }

  private selectSharedTab(notice: Notice): void {
    const kind = this.kindOf(notice);
    const tab = kind === 'coop' && !this.hasCoop() ? (this.tab() === 'coop' ? 'all' : this.tab()) : kind;
    if (this.view === 'settings' || this.view === tab) return;
    this.view = this.listTab = tab;
    this.selecting = false; this.selectedReads = [];
    this.replaceShareTab(tab);
    remember('tab', tab);
  }

  private replaceShareTab(tab: Tab): void {
    const url = new URL(location.href);
    if (url.searchParams.has('sort') || url.searchParams.get('tab') === 'deadline') url.searchParams.set('sort', this.sortFor(tab));
    url.searchParams.set('tab', tab);
    history.replaceState(history.state, '', url);
  }

  closeSharedDetail = () => {
    if (history.state?.sharedDetail) { history.back(); return; }
    this.sharedDetail = null;
    this.openedId = null;
    this.listChanged();
  };

  leavePreview = () => {
    this.clearDeepLink();
    ++this.previewRequest;
    this.preview = { status: 'idle' };
    this.authError = '';
  };

  private clearDeepLink() {
    if (!this.deepId) return;
    this.deepId = null;
    this.deepLookup = null;
    if (noticeIdFromSearch(location.search)) history.replaceState(history.state, '', withoutNotice(location.href));
  }

  /** 딥링크로 연 공지(목록에 없어도 상세에 보이게). */
  deepShown(id: string | null): Notice | undefined {
    if (!id) return undefined;
    return this.notices.find((n) => n.id === id) ?? (this.deepNotice?.notice.id === id ? this.deepNotice.notice : undefined);
  }

  sourceName(notice: Notice): string {
    const fallback = this.deepNotice?.notice.id === notice.id ? this.deepNotice.source : notice.source_id;
    return boardName(this.sources.find((source) => source.id === notice.source_id), fallback);
  }

  async signIn() {
    if (!authClient || this.authBusy) return;
    this.authBusy = true; this.authError = '';
    try {
      // 매번 Google 계정 고르기를 띄운다. 이미 로그인된 계정으로 바로 넘어가지 않게(다른 계정으로 새로 가입할 수 있게).
      const { error } = await authClient.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: cleanReturnUrl(), queryParams: { prompt: 'select_account' } } });
      if (error) throw error;
    } catch (error) {
      // 영어 오류나 제공자 코드는 보이지 않는다. 연결 문제인지만 나눠 알린다.
      const offline = !navigator.onLine || error instanceof TypeError || (error as { name?: string } | null)?.name === 'AuthRetryableFetchError';
      this.authError = offline ? '인터넷 연결을 확인하고 다시 눌러 주세요' : '로그인하지 못했어요. 다시 눌러 주세요';
      this.authBusy = false;
    }
  }

  async signOut() {
    if (!authClient || this.authBusy) return;
    const userId = this.authUserId, epoch = this.subscriptionsEpoch;
    const isCurrent = () => this.isCurrentAccount(userId, epoch);
    this.authBusy = true; this.authError = '';
    try {
      // 세션이 살아 있을 때 이 기기의 알림을 먼저 끈다. 실패해도 로그아웃은 막지 않는다.
      if (userId && this.pushStatus === 'on' && this.pushRegistration) {
        await disableDevicePush(authClient, userId, this.pushRegistration, localStorage, isCurrent).catch(() => false);
      }
      if (!isCurrent()) return;
      const { error } = await authClient.auth.signOut({ scope: 'local' });
      if (error) throw error;
      // 다시 로그인하면 설정이 아니라 공지 목록에서 시작하게 주소를 첫 화면으로 돌려놓는다.
      history.replaceState(null, '', location.pathname);
      this.deepId = null; this.deepNotice = null; this.preview = { status: 'idle' };
    } catch {
      this.authError = '로그아웃을 완료하지 못했어요. 다시 확인해 주세요.';
    } finally { this.authBusy = false; }
  }

  private async restoreList(userId: string, epoch: number): Promise<void> {
    const keywords = this.keywords, boardOrder = this.boardOrder;
    const cached = await loadListCache(userId);
    if (!cached || !this.isCurrentAccount(userId, epoch)) return;
    if (!this.liveFeedReady) {
      const bySource = new Map(cached.sources.map((source) => [source.id, source]));
      this.sources = cached.sources;
      this.notices = cached.notices.filter((notice) => !isExpired(notice, bySource.get(notice.source_id)));
      this.generatedAt = cached.generatedAt;
    }
    if (!this.liveSettings.has('subscriptions')) this.subscriptions = cached.subscriptions;
    if (!this.liveSettings.has('keywords') && this.keywords === keywords) this.keywords = cached.keywords;
    if (!this.liveSettings.has('boardOrder') && this.boardOrder === boardOrder) this.boardOrder = cached.boardOrder;
    if (!this.liveListFields.has('deadlines')) this.myDeadlines = new Map([...cached.deadlines, ...this.myDeadlines]);
    if (!this.liveListFields.has('judgments')) this.myJudgments = cached.judgments;
    if (!this.liveListFields.has('interests')) this.myInterests = cached.interests;
    if (!this.liveListFields.has('translations')) this.myTranslations = cached.translations;
    if (!this.liveListFields.has('graduation')) this.graduationStatuses = cached.graduation;
    this.cacheReady = true;
    if (this.sharedDetail && !this.sharedFailure) {
      const shared = this.deepShown(this.sharedDetail);
      if (shared) this.selectSharedTab(shared);
    }
    this.requestUpdate();
  }

  private saveCurrentListCache(userId: string, epoch: number): void {
    if (epoch !== this.subscriptionsEpoch || userId !== this.authUserId || !this.liveFeedReady || !this.liveAccountReady || !this.generatedAt) return;
    void saveListCache(userId, { generatedAt: this.generatedAt, sources: this.sources, notices: this.notices,
      subscriptions: this.subscriptions, keywords: this.keywords, boardOrder: this.boardOrder, deadlines: this.myDeadlines,
      judgments: this.myJudgments, interests: this.myInterests, translations: this.myTranslations, graduation: this.graduationStatuses });
  }

  /** 직접 누른 새로고침은 따로 진행 표시를 두지 않는다(받는 동안 단추만 흐려진다). 목록이 그대로여도 끝났는지 알 수 있게 결과를 토스트로 알린다(실패 안내는 refresh가 한다).
   * 지금 보는 목록에 새로 나타난 공지 수를 센다. 내 판정을 다 받은 뒤 세야 AI 확인 중인 공지와 보이는 공지가 맞는다. */
  async collectNow() {
    if (this.loading || this.gated) return;
    const before = new Set(this.notices.map((n) => n.id));
    this.mineSync = null;
    await this.refresh();
    if (this.failed) return;
    await (this.mineSync as Promise<void> | null)?.catch(() => undefined);   // refresh 안에서 정해져 타입이 좁혀지지 않게 한다
    const added = (n: Notice) => !before.has(n.id);
    const shown = this.visible().filter(added).length;
    const tab = this.tab();
    const waiting = tab === 'saved' ? 0 : this.scopeTab(this.filtered(this.decorated(this.notices.filter(added))), tab).filter((n) => this.isWaiting(n)).length;
    this.showToast(shown ? `새 공지 ${shown}개를 가져왔어요` : waiting ? `새 공지 ${waiting}개는 AI가 확인하고 있어요` : '새 공지가 없어요');
  }

  updateRead(ids: string[], read: boolean) {
    const selected = new Set(ids);
    const latestChange = read ? Math.max(0, ...this.notices.filter((notice) => selected.has(notice.id))
      .map((notice) => Date.parse(notice.changed_at ?? '') || 0)) : 0;
    this.readState = setReadState(this.readState ?? parseReadState(null), ids, read, Math.max(Date.now(), latestChange));
    this.read = readIds(this.readState);
    storeReadState(this.readState);
    const syncable = ids.filter((id) => this.isSyncable(id));
    if (syncable.length) this.uploadStates((guard) => pushRead(authClient!, syncable.map((id) => ({ id, read })), guard));
  }

  /** 같은 공지로 묶인 다른 글들(읽음과 저장을 묶음 전체에 맞춘다). 목록을 새로 받았을 때만 다시 만든다. */
  private matesCache: { source: Notice[]; map: Map<string, Notice[]> } | null = null;
  mates(id: string): Notice[] {
    if (this.matesCache?.source !== this.notices) this.matesCache = { source: this.notices, map: groupMates(this.notices) };
    return this.matesCache.map.get(id) ?? [];
  }

  markRead(notice: Notice) {
    if (this.isRead(notice)) return;
    this.updateRead([notice.id, ...this.mates(notice.id).map((mate) => mate.id)], true);   // 같은 공지의 다른 게시판 글도 읽음으로
  }

  toggleReadSelection(id: string) {
    this.selectedReads = this.selectedReads.includes(id)
      ? this.selectedReads.filter((selected) => selected !== id) : [...this.selectedReads, id];
  }

  markSelectedRead(read: boolean) {
    const selected = new Set(this.selectedReads);
    const changed = this.visible().filter((notice) => selected.has(notice.id) && this.isRead(notice) !== read);
    if (!changed.length) return;
    this.updateRead(changed.flatMap((notice) => [notice.id, ...this.mates(notice.id).map((mate) => mate.id)]), read);
    this.closeSelection();
    this.showToast(`${changed.length}개를 ${read ? '읽음' : '읽지 않음'}으로 표시했어요`);
  }

  closeSelection() {
    this.selecting = false;
    this.selectedReads = [];
    this.updateComplete.then(() => qs<HTMLButtonElement>('.select-trigger')?.focus({ preventScroll: true }));
  }

  /** 같은 공지로 묶인 글 중 하나라도 읽었으면 읽은 공지다(다른 게시판 사본이 다시 읽지 않음으로 보이지 않게). */
  isRead(notice: Notice): boolean {
    const state = this.readState;
    if (state === null || isNoticeRead(state, notice.id, notice.changed_at)) return true;
    return this.mates(notice.id).some((mate) => isNoticeRead(state, mate.id, mate.changed_at));
  }

  /** 같은 공지로 묶인 글 중 하나라도 저장했으면 저장한 공지다. */
  isSaved(notice: Notice): boolean {
    return this.saved.some((item) => item.id === notice.id) || this.mates(notice.id).some((mate) => this.saved.some((item) => item.id === mate.id));
  }

  async refreshSaveCounts(userId: string, epoch: number): Promise<void> {
    if (!authClient) return;
    const revision = ++this.saveCountRevision;
    this.saveCountTouched = new Set();
    const counts = await loadSaveCounts(authClient, this.notices.map((notice) => notice.id)).catch(() => null);
    if (!counts || epoch !== this.subscriptionsEpoch || userId !== this.authUserId || revision !== this.saveCountRevision) return;
    for (const id of this.saveCountTouched) if (this.saveCounts.has(id)) counts.set(id, this.saveCounts.get(id)!);
    this.saveCounts = counts;
  }

  toggleSave(notice: Notice) {
    // 저장은 공지 하나로 센다. 묶음 중 저장된 글이 있으면 모두 지우고, 없으면 지금 보이는 글을 저장한다.
    const savedMembers = [notice, ...this.mates(notice.id)].filter((member) => this.saved.some((item) => item.id === member.id));
    let next: typeof this.saved | null = this.saved;
    if (savedMembers.length) for (const member of savedMembers) next = toggleSaved(next ?? this.saved, member);
    else next = toggleSaved(this.saved, notice);
    if (!next) { this.showToast('저장할 수 있는 공지가 가득 찼어요. 안 쓰는 저장을 지워 주세요'); return; }
    const added = !savedMembers.length;
    const counts = new Map(this.saveCounts);
    for (const id of added ? [notice.id] : savedMembers.map((member) => member.id)) {
      this.saveCountTouched.add(id);
      this.savedTouched.add(id);
      if (counts.has(id)) counts.set(id, Math.max(0, counts.get(id)! + (added ? 1 : -1)));
    }
    this.saveCounts = counts;
    this.saved = next;
    storeSaved(next);
    this.showToast(added ? '저장했어요' : '저장을 지웠어요');
    // 다시 저장한 공지는 옛 자리가 아니라 맨 위로 온다(순서에서 뺀다).
    if (added && this.savedOrder.includes(notice.id)) this.setSavedOrder(this.savedOrder.filter((id) => id !== notice.id));
    // 저장하면 기회함에 '관심'으로 자동 기록한다(입력 없음). 이미 기록이 있으면 상태를 덮지 않는다.
    if (added && this.authUserId && this.opportunitiesStatus !== 'unavailable') {
      void this.saveOpportunityFor(notice, this.sourceName(notice), { status: 'interested' }, false, true);
    }
    const changes = added ? [{ id: notice.id, saved: true }] : savedMembers.map((member) => ({ id: member.id, saved: false }));
    this.uploadStates((guard) => pushSaved(authClient!, changes, guard));
  }

  async refreshOpportunities(userId: string, epoch: number): Promise<void> {
    if (!authClient || this.opportunitiesLoading) return;
    this.opportunitiesLoading = true;
    const same = () => this.isCurrentAccount(userId, epoch);
    const writes = new Map(this.opportunityWrites);
    const fetchedAt = Date.now();   // 이 조회가 시작된 시각: 서버 값이 없다는 관측은 이 시점 기준이다
    try {
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const items = await loadOpportunities(authClient, userId, same);
          if (!same()) return;
          const refreshed = new Map(items.map((item) => [item.notice_id, item]));
          for (const [id, revision] of this.opportunityWrites) {
            if (writes.get(id) === revision) continue;
            const current = this.opportunities.get(id);
            if (current) refreshed.set(id, current);
            else refreshed.delete(id);
          }
          this.opportunities = refreshed;
          this.opportunitiesStatus = 'ready';
          for (const id of this.detailRestores.keys()) this.cacheDetail(id, 'opportunity', refreshed.get(id) ?? null, this.opportunityVersion(refreshed.get(id), fetchedAt));
          this.opportunitiesFetchedAt = fetchedAt;
          return;
        } catch (error) {
          if (!same()) return;
          // 표가 없으면(운영 적용 전) 이 영역만 숨긴다. 일시적 오류에는 캐시를 유지한다.
          if (isMissingTable(error)) { this.opportunities = new Map(); this.opportunitiesStatus = 'unavailable'; return; }
          this.opportunitiesStatus = 'failed';
          if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 2000));
          if (!same()) return;
        }
      }
    } finally { if (same()) this.opportunitiesLoading = false; }
  }


  /** 상세에 팀원 모집 구역을 보일지: 로그인했고, 팀을 꾸릴 만한 공고이고, 서버에 기능이 있을 때. */
  teamShown(notice: Notice): boolean {
    return !!this.authUserId && !this.teamUnavailable && this.kindOf(notice) !== 'coop' && isTeamNotice(notice);
  }

  private teamApi(): TeamApi | null { return this.teamApiOverride ?? (authClient ? createTeamApi(authClient) : null); }

  loadTeam(noticeId: string): void {
    const api = this.teamApi(), userId = this.authUserId;
    if (!api || !userId) return;
    const seq = ++this.teamSeq, epoch = this.subscriptionsEpoch;
    if (this.teamState.noticeId !== noticeId) this.teamState = { noticeId, status: 'loading', posts: [] };
    else if (this.teamState.status === 'failed') this.teamState = { ...this.teamState, status: 'loading' };
    const guard = () => epoch === this.subscriptionsEpoch && this.authUserId === userId && seq === this.teamSeq;
    void api.list(noticeId, guard).then((posts) => {
      if (guard()) this.teamState = { noticeId, status: 'ready', posts };
    }, (error: unknown) => {
      if (error instanceof AccountChanged || !guard()) return;
      if (isTeamUnavailable(error)) { this.teamUnavailable = true; return; }
      this.teamState = { noticeId, status: 'failed', posts: [] };
    });
  }

  /** 쓰기 동작 하나를 실행한다. 계정이 바뀌면 조용히 버리고, 실패하면 해요체 한 줄을 토스트로 알린다. */
  private async teamRun<T>(noticeId: string, work: (api: TeamApi, guard: () => Promise<boolean>) => Promise<T>, done: string | null, reload = true): Promise<{ ok: true; value: T } | { ok: false; code: string | null }> {
    const api = this.teamApi(), userId = this.authUserId, epoch = this.subscriptionsEpoch;
    if (!api || !userId) return { ok: false, code: null };
    const guard = async () => epoch === this.subscriptionsEpoch && this.authUserId === userId && (this.teamApiOverride ? true : !authClient || await sessionIs(authClient, userId));
    this.teamBusyCount++; this.teamBusy = true;
    try {
      const value = await work(api, guard);
      if (epoch !== this.subscriptionsEpoch || this.authUserId !== userId) return { ok: false, code: null };
      if (done) this.showToast(done);
      if (reload && this.teamState.noticeId === noticeId) this.loadTeam(noticeId);
      return { ok: true, value };
    } catch (error) {
      if (error instanceof AccountChanged || epoch !== this.subscriptionsEpoch || this.authUserId !== userId) return { ok: false, code: null };
      const code = teamErrorCode(error);
      if (code !== 'team_contact_required') this.showToast(teamErrorMessage(error));
      if (reload && this.teamState.noticeId === noticeId && code && code !== 'team_rate_limited') this.loadTeam(noticeId);   // 상태가 어긋났을 수 있으니 다시 읽는다
      return { ok: false, code };
    } finally { if (epoch === this.subscriptionsEpoch && this.authUserId === userId) { this.teamBusyCount = Math.max(0, this.teamBusyCount - 1); this.teamBusy = this.teamBusyCount > 0; } }
  }

  teamModel(notice: Notice): TeamModel {
    const id = notice.id;
    const mine = this.teamState.noticeId === id;
    const run = async <T,>(work: (api: TeamApi, guard: () => Promise<boolean>) => Promise<T>, done: string | null, reload = true) => (await this.teamRun(id, work, done, reload)).ok;
    return {
      status: mine ? this.teamState.status : 'loading', posts: mine ? this.teamState.posts : [], busy: this.teamBusy,
      canCreate: !notice.deadline || !deadlinePassed(notice.deadline),
      load: () => this.loadTeam(id),
      create: (draft: TeamDraft) => run((api, guard) => api.create(id, draft, guard), '모집을 올렸어요'),
      apply: (post, message) => run((api, guard) => api.apply(post.id, message, guard), '신청했어요'),
      withdraw: (post) => run((api, guard) => api.withdraw(post.id, guard), '신청을 취소했어요'),
      setClosed: (post, closed) => run((api, guard) => api.setStatus(post.id, closed ? 'closed' : 'open', guard), closed ? '모집을 마감했어요' : '모집을 다시 열었어요'),
      remove: (post) => run((api, guard) => api.remove(post.id, guard), '모집을 지웠어요'),
      applicants: async (post) => { const result = await this.teamRun<TeamApplicant[]>(id, (api, guard) => api.applicants(post.id, guard), null, false); return result.ok ? result.value : null; },
      decide: async (post, applicant, decision, contact) => {
        const result = await this.teamRun(id, async (api, guard) => {
          if (contact) await api.setContact(post.id, contact, guard);
          await api.decide(applicant.id, decision, guard);
        }, decision === 'approved' ? '승인했어요' : '거절했어요');
        return result.ok ? 'ok' : result.code === 'team_contact_required' ? 'contact' : 'error';
      },
      contact: async (post) => { const result = await this.teamRun<string | null>(id, (api, guard) => api.contact(post.id, guard), null, false); return result.ok ? result.value : undefined; },
      report: (post) => run((api, guard) => api.report(post.id, guard), '신고했어요. 확인할게요'),
      blockOwner: (post) => run((api, guard) => api.blockOwner(post.id, guard), '이 모집자를 차단했어요'),
      blockApplicant: (applicant) => run((api, guard) => api.blockApplicant(applicant.id, guard), '이 신청자를 차단했어요'),
    };
  }

  /** 상세에 질문·경험 구역을 보일지: 로그인했고, 서버에 기능이 있고, 부를 수 있는 연결이 있을 때. */
  qeShown(notice: Notice): boolean {
    return !!this.authUserId && !this.qeUnavailable && this.kindOf(notice) !== 'coop' && !!this.qeApi();
  }

  private qeApi(): QuestionsApi | null { return this.qeApiOverride ?? (authClient ? createQuestionsApi(authClient) : null); }

  private advanceAccountEpoch(): number {
    const epoch = ++this.subscriptionsEpoch;
    this.qeWrites.abort();
    this.qeWrites = new AbortController();
    this.qeUnblockPending = null;
    ++this.qeSeq;
    this.qeState = { noticeId: null, status: 'loading', questions: [], experiences: EMPTY_EXPERIENCES };
    this.qeBusyCount = 0;
    this.qeBusy = false;
    this.qeUnavailable = false;
    this.opportunitiesLoading = false;
    this.exploreSavedStatus = 'idle';
    return epoch;
  }

  loadQuestions(noticeId: string): Promise<void> {
    const api = this.qeApi(), userId = this.authUserId;
    if (!api || !userId) return Promise.resolve();
    const seq = ++this.qeSeq, epoch = this.subscriptionsEpoch;
    if (this.qeState.noticeId !== noticeId) this.qeState = { noticeId, status: 'loading', questions: [], experiences: EMPTY_EXPERIENCES };
    else if (this.qeState.status === 'failed') this.qeState = { ...this.qeState, status: 'loading' };
    const guard = () => epoch === this.subscriptionsEpoch && this.authUserId === userId && seq === this.qeSeq;
    const reviews = api.listExperiences(noticeId, guard).then((experiences) => {
      if (guard() && experiences.posts.some((post) => post.mine)) this.writeQeDraft(this.qeDraftKey(noticeId), null);
      return experiences;
    });
    return Promise.all([api.listQuestions(noticeId, guard), reviews]).then(([questions, experiences]) => {
      if (guard()) this.qeState = { noticeId, status: 'ready', questions, experiences };
    }, (error: unknown) => {
      if (error instanceof AccountChanged || !guard()) return;
      if (isQeUnavailable(error)) { this.qeUnavailable = true; return; }
      this.qeState = { noticeId, status: 'failed', questions: [], experiences: EMPTY_EXPERIENCES };
    });
  }

  private qeSessionGuard(userId: string, epoch: number): QuestionsSessionGuard {
    return {
      signal: this.qeWrites.signal,
      accessToken: async () => {
        if (!authClient || !this.isCurrentAccount(userId, epoch)) return null;
        const { data: { session }, error } = await authClient.auth.getSession();
        return !error && session?.user.id === userId && this.isCurrentAccount(userId, epoch) ? session.access_token : null;
      },
    };
  }

  private async qeRun<T>(noticeId: string, work: (api: QuestionsApi, guard: QuestionsSessionGuard) => Promise<T>, done: string | null, reloadOnError = true, followCurrent = false): Promise<{ ok: true; value: T } | { ok: false }> {
    const api = this.qeApi(), userId = this.authUserId, epoch = this.subscriptionsEpoch;
    if (!api || !userId) return { ok: false };
    const guard = this.qeSessionGuard(userId, epoch);
    this.qeBusyCount++; this.qeBusy = true;
    try {
      const value = await work(api, guard);
      if (epoch !== this.subscriptionsEpoch || this.authUserId !== userId) return { ok: false };
      if (done) this.showToast(done);
      // 다시 불러오기가 끝날 때까지 busy를 유지한다(옛 값으로 수정 폼이 다시 열리지 않게).
      const target = followCurrent ? this.qeState.noticeId : noticeId;   // 해제처럼 오래 걸리는 일은 끝난 시점에 보는 공지를 다시 불러온다
      if (target && this.qeState.noticeId === target) {
        // 다시 불러오기가 멈춰도 busy가 영구히 남지 않게 시간을 둔다. 넘으면 질문 구역을 다시 불러오기 단추 상태로 둔다.
        await withTimeout(this.loadQuestions(target), 15_000).catch(() => {
          if (epoch !== this.subscriptionsEpoch || this.authUserId !== userId) return;
          ++this.qeSeq;
          if (this.qeState.noticeId === target) this.qeState = { noticeId: target, status: 'failed', questions: [], experiences: EMPTY_EXPERIENCES };
        });
      }
      return { ok: true, value };
    } catch (error) {
      if (error instanceof AccountChanged || epoch !== this.subscriptionsEpoch || this.authUserId !== userId) return { ok: false };
      this.showToast(qeErrorMessage(error));
      if (reloadOnError && this.qeState.noticeId === noticeId) this.loadQuestions(noticeId);
      return { ok: false };
    } finally { if (epoch === this.subscriptionsEpoch && this.authUserId === userId) { this.qeBusyCount = Math.max(0, this.qeBusyCount - 1); this.qeBusy = this.qeBusyCount > 0; } }
  }

  /** 후기 초안은 이 기기에 계정·공고별로만 둔다(끝나면 지운다). */
  private qeDraftKey(noticeId: string): string | null { return this.authUserId ? `qe-draft:${this.authUserId}:${noticeId}` : null; }

  private writeQeDraft(key: string | null, value: ReviewDraft | null): void {
    try {
      if (!key) return;
      if (value) localStorage.setItem(key, JSON.stringify(value));
      else localStorage.removeItem(key);
    } catch { /* 저장소를 못 써도 화면은 그대로 쓴다 */ }
  }

  questionsModel(notice: Notice): QuestionsModel {
    const id = notice.id;
    const userId = this.authUserId, epoch = this.subscriptionsEpoch;
    const current = () => this.isCurrentAccount(userId, epoch);
    const mine = this.qeState.noticeId === id;
    const run = async <T,>(work: (api: QuestionsApi, guard: QuestionsSessionGuard) => Promise<T>, done: string | null, reloadOnError = true) => current() && (await this.qeRun(id, work, done, reloadOnError)).ok;
    const key = this.qeDraftKey(id);
    return {
      key: `qe-${userId}-${epoch}-${id}`,
      status: mine ? this.qeState.status : 'loading', questions: mine ? this.qeState.questions : [], experiences: mine ? this.qeState.experiences : EMPTY_EXPERIENCES, busy: this.qeBusy,
      load: () => { if (current()) this.loadQuestions(id); },
      ask: (body: string, parentId?: string) => run((api, guard) => api.createQuestion(id, body, parentId, guard), parentId ? '답을 남겼어요' : '질문을 남겼어요'),
      review: (input: ExperienceInput) => run(async (api, guard) => { await api.createExperience(id, input, guard); }, '후기를 남겼어요'),
      editQuestion: (postId, body) => this.qeBusyCount > 0 ? Promise.resolve(false) : run((api, guard) => api.editQuestion(postId, body, guard), '수정했어요', false),
      editReview: (postId, input) => this.qeBusyCount > 0 ? Promise.resolve(false) : run((api, guard) => api.editExperience(postId, input, guard), '수정했어요', false),
      remove: (postId) => run((api, guard) => api.deletePost(postId, guard), '지웠어요'),
      report: (postId) => run((api, guard) => api.report(postId, guard), '신고했어요. 확인할게요'),
      block: (postId) => run(async (api, guard) => { await api.blockAuthor(postId, guard); }, '이 작성자를 차단했어요'),
      draft: {
        get: (): ReviewDraft | null => { try { const raw = key && current() ? localStorage.getItem(key) : null; return raw ? JSON.parse(raw) as ReviewDraft : null; } catch { return null; } },
        set: (value: ReviewDraft | null) => {
          if (!current()) return;
          if (value && this.qeState.noticeId === id && this.qeState.experiences.posts.some((post) => post.mine)) return;
          this.writeQeDraft(key, value);
        },
      },
    };
  }

  questionBlocksModel() {
    const userId = this.authUserId, epoch = this.subscriptionsEpoch;
    const current = () => !!userId && this.isCurrentAccount(userId, epoch);
    return {
      key: `${userId}-${epoch}`,
      load: async () => {
        if (this.qeUnblockPending) await this.qeUnblockPending;
        const api = this.qeApi();
        if (!api || !userId || !current()) throw new AccountChanged();
        return api.listBlocks(this.qeSessionGuard(userId, epoch));
      },
      unblock: async (blockId: string) => {
        if (!current() || this.qeUnblockPending) return false;
        const pending = this.qeRun(this.qeState.noticeId ?? '', (api, guard) => api.unblock(blockId, guard), '차단을 해제했어요', true, true).then(({ ok }) => ok);
        this.qeUnblockPending = pending;
        try {
          return await pending;
        } finally {
          if (this.qeUnblockPending === pending) this.qeUnblockPending = null;
        }
      },
    };
  }

  /** 같은 공지의 저장·삭제는 줄을 세워 앞 요청이 끝난 뒤 보낸다(늦게 커밋돼 상태가 어긋나거나 삭제한 행이 되살아나지 않게). */
  private enqueueOpportunity<T>(id: string, work: () => Promise<T>): Promise<T> {
    const next = (this.opportunityQueue.get(id) ?? Promise.resolve()).then(work, work);
    this.opportunityQueue.set(id, next);
    void next.then(() => { if (this.opportunityQueue.get(id) === next) this.opportunityQueue.delete(id); });
    return next;
  }

  /** 키가 없는 사용자에게 공지 상세에서 AI 연결을 한 줄로 권할지(첫 설정에서 AI 키를 빼서 이 자리에서 권한다, 2026-11-18).
   * 키 상태를 다 불러와 "없다"고 확인됐고, 이 계정이 안내를 닫은 적이 없을 때만 true다. 닫기는 이 기기에 계정별로 기억한다(다른 계정의 닫기는 보지 않는다). */
  aiHintShown(): boolean {
    const userId = this.authUserId;
    if (!userId || this.hasUsableAiKey() !== false) return false;
    if (!this.aiPrefs.aiEnabled) return false;   // 요약·판정을 꺼 둔 사용자에게는 연결을 권하지 않는다
    if (this.aiHintSession.has(userId)) return false;
    try { return localStorage.getItem(`platform:ai-hint-dismissed:${userId}`) !== '1'; } catch { return true; }
  }

  dismissAiHint(): void {
    const userId = this.authUserId;
    if (!userId) return;
    this.aiHintSession.add(userId);
    try { localStorage.setItem(`platform:ai-hint-dismissed:${userId}`, '1'); } catch { /* 저장하지 못하면 이번 방문 동안만 닫는다 */ }
    this.aiHintTick += 1;
  }

  /** 상세에 "내 진행 상태"를 보일지: 기록을 불러왔고, 저장했거나 이미 기록이 있을 때. */
  opportunityShown(notice: Notice): boolean {
    if (!this.authUserId || this.opportunitiesStatus === 'unavailable') return false;
    return this.opportunities.has(notice.id) || (this.opportunitiesStatus === 'ready' && this.isSaved(notice));
  }

  /** 상태·메모를 저장한다. 처음이면 제목·링크·게시판·마감 사본과 함께 만든다. 응답을 받은 뒤에 화면에 반영한다.
   *  ifAbsent: 서버에 이미 행이 있으면 덮지 않는다(저장할 때 자동으로 남기는 '관심'용). */
  saveOpportunityFor(notice: Notice, source: string, patch: { status?: OpportunityStatus; note?: string | null }, announce = false, ifAbsent = false): Promise<boolean> {
    if (!authClient || !this.authUserId) return Promise.resolve(false);
    const client = authClient, userId = this.authUserId, epoch = this.subscriptionsEpoch;
    return this.enqueueOpportunity(notice.id, async () => {
      const same = async () => epoch === this.subscriptionsEpoch && this.authUserId === userId && await sessionIs(client, userId);
      try {
        const url = /^https?:\/\//i.test(notice.url) && notice.url.length <= URL_MAX ? notice.url : null;
        const saved = await saveOpportunity(client, userId, {
          notice_id: notice.id, title: cleanTitle(notice.title_ko || notice.title).slice(0, TITLE_MAX), url,
          board: source ? source.slice(0, 100) : null, deadline: deadlineIso(notice.deadline), ...patch,
        }, same, { ifAbsent });
        if (!this.isCurrentAccount(userId, epoch)) return false;
        this.opportunityWrites.set(notice.id, (this.opportunityWrites.get(notice.id) ?? 0) + 1);
        this.opportunities = new Map(this.opportunities).set(notice.id, saved);
        this.cacheDetail(notice.id, 'opportunity', saved, Date.now());   // 내 쓰기는 쓴 시각으로 남겨 앞선 삭제 표시를 이긴다
        if (announce && patch.status) this.showToast(`${OPPORTUNITY_LABELS[patch.status]}으로 기록했어요`);
        return true;
      } catch (error) {
        if (!this.isCurrentAccount(userId, epoch)) return false;
        this.showToast(isLimitReached(error) ? '기록이 너무 많아요. 안 쓰는 기록을 지워 주세요' : '기록을 저장하지 못했어요. 다시 눌러 주세요');
        this.requestUpdate();
        return false;
      }
    });
  }

  removeOpportunityFor(notice: Notice): Promise<void> {
    if (!authClient || !this.authUserId) return Promise.resolve();
    const client = authClient, userId = this.authUserId, epoch = this.subscriptionsEpoch;
    return this.enqueueOpportunity(notice.id, async () => {
      const same = async () => epoch === this.subscriptionsEpoch && this.authUserId === userId && await sessionIs(client, userId);
      try {
        await removeOpportunity(client, userId, notice.id, same);
        if (epoch !== this.subscriptionsEpoch || this.authUserId !== userId) return;
        this.opportunityWrites.set(notice.id, (this.opportunityWrites.get(notice.id) ?? 0) + 1);
        const next = new Map(this.opportunities); next.delete(notice.id); this.opportunities = next;
        this.cacheDetail(notice.id, 'opportunity', null, Date.now());   // 삭제 표시를 남겨 다른 탭의 늦은 옛 조회가 되살리지 못하게 한다
        this.showToast('기록을 지웠어요');
      } catch {
        if (epoch === this.subscriptionsEpoch && this.authUserId === userId) this.showToast('기록을 지우지 못했어요. 다시 눌러 주세요');
      }
    });
  }

  /** 저장한 글. 지금 목록에 있으면 최신 정보로, 밀려났으면 저장할 때 정보로 보여 준다. */
  savedNotices(): Notice[] {
    // 저장해 둔 사본도 기한이 지났으면 보이지 않는다(서버가 지운 현장실습 포함).
    const sources = new Map(this.sources.map((source) => [source.id, source]));
    return orderSaved(this.saved, this.notices, this.sortFor('saved'), this.savedOrder).filter((notice) => !isExpired(notice, sources.get(notice.source_id)));
  }

  judgement(notice: Notice): Judgement | undefined {
    const mine = this.myJudgments.get(notice.id);
    return this.matched?.items[notice.id] ?? (mine ? asJudgement(mine) : undefined);
  }

  /** AI 키가 있는 사용자의 공지가 판정 차례를 기다리는 중인지. 서버가 키를 쓰는 대기 범위와 같다:
   * 외부 인턴 공고는 처음 본 지 14일 안이고 마감 전, 학교 공지는 마감이 남았거나 마감이 없고 30일 안.
   * 이런 공지는 판정이 끝날 때까지 목록(성대 공지·인턴 탭)에서 빼고, 목록 위에 몇 개를 확인하는 중인지 한 줄로 알린다(waitingCount).
   * AI를 꺼 두었거나 키가 없으면, 범위 밖(오래됐거나 마감된 공지)이면 거짓이라 모두 그대로 보인다. */
  judgePending(notice: Notice): boolean {
    if (!this.userDataReady() || !this.aiPrefs.aiEnabled) return false;
    if (!this.authUserId || !(this.byokStatus && !this.byokStatus.disabled) && !this.aiKeys.some((key) => !key.disabled)) return false;
    if (this.judgement(notice) || !notice.first_seen) return false;
    const now = Date.now(), day = 24 * 3600 * 1000;
    const age = now - new Date(notice.first_seen).getTime();
    const open = !notice.deadline || new Date(notice.deadline).getTime() >= now;
    if (this.isExternal(notice)) return age >= 0 && age < 14 * day && open;
    return notice.deadline ? open : age >= 0 && age < 30 * day;
  }

  /** 지금 보는 탭에서 판정을 기다리느라 목록에서 뺀 공지 수. 열어 둔 글은 목록에 남으므로 세지 않는다. */
  waitingCount(): number {
    const tab = this.tab();
    if (tab === 'saved') return 0;
    return this.scopeTab(this.filtered(this.decorated(this.notices)), tab).filter((n) => this.isWaiting(n)).length;
  }

  // 현장실습은 신청 기간마다 수백 건이 한꺼번에 들어와 판정이 하루쯤 걸리므로 기다리는 동안에도 목록에 둔다(줄에 "AI가 확인하고 있어요").
  private keepReading(id: string): boolean {
    return id !== this.sharedDetail && (id === this.selectedId || id === this.openedId);
  }

  private isWaiting(n: Notice): boolean {
    const justSubscribed = this.sharedDetail === n.id && this.subscribedShareId === n.id;
    return !justSubscribed && !this.keepReading(n.id) && this.kindOf(n) !== 'coop' && this.judgePending(n);
  }


  /** 내 판정과 관심 키워드를 다시 읽는다. 로그인할 때와 공지를 새로 불러올 때 부른다. */
  async refreshMine(userId: string, epoch: number): Promise<void> {
    if (!authClient) return;
    if (this.opportunitiesStatus === 'failed') void this.refreshOpportunities(userId, epoch);
    const [judgments, interests, statuses] = await Promise.all([loadMyJudgments(authClient, userId).catch(() => null), loadMyInterests(authClient).catch(() => null), loadGraduationStatuses(authClient, userId).catch(() => null)]);
    if (epoch !== this.subscriptionsEpoch || userId !== this.authUserId) return;
    if (judgments) { this.liveListFields.add('judgments'); this.myJudgments = judgments; }
    if (interests) { this.liveListFields.add('interests'); this.myInterests = interests; }
    if (statuses) { this.liveListFields.add('graduation'); this.graduationStatuses = statuses; }
  }

  /** 내 졸업요건 판정 요약(공지 번호별). 목록 표지와 "인턴십 충족만"에 쓴다. */
  graduationStatuses = new Map<string, GraduationStatuses>();
  graduationOnly = remember('view-grad') === '1';
  /** 목록에 졸업요건 표지를 보여 줄 수 있는 사용자인지: 로그인했고 아직 채우지 않은 요건이 있다. */
  /** 첫 목록을 그려도 되는지. 로그인하지 않았으면 기다릴 계정 정보가 없다. */
  listReady(): boolean { return !this.authUserId || this.hasKnownSubscriptions() || !this.subscriptionsLoading || this.settingsCapped; }
  userDataReady(): boolean { return !this.authUserId || this.cacheReady || (this.accountDataLoaded && this.aiStateLoaded); }
  /** 설정 화면은 이 기기 알림 상태, 기기 목록, 프로필까지 받은 뒤 한 번에 그린다. 먼저 그리면 새로고침 때 "확인하고 있어요"→"켜져 있어요",
   * "아직 받는 게시판이 없어요"→목록처럼 문구가 차례로 바뀌며 아래가 밀린다. */
  settingsReady(): boolean {
    if (!this.authUserId) return true;
    const cached = this.storedSettings;
    if (cached?.profile && cached.ai && cached.keywords) {
      if (this.settingsSection === 'notifications') {
        if (cached.push && cached.devices && cached.subscriptions && cached.boardOrder) return true;
      } else if (this.settingsSection !== 'canvas' || (cached.push && cached.devices && cached.canvas !== undefined)) {
        return true;
      }
    }
    if (!this.userDataReady()) return false;
    return this.settingsCapped || (this.pushStatus !== 'checking' && this.devicesLoaded && this.profileStatus !== 'idle' && this.profileStatus !== 'loading');
  }
  gradEnabled(): boolean { const v = visibleTracks(this.profile); return !!authClient && !!this.authUserId && (v.dept || v.p3); }
  /** 목록·상세에 적을 졸업요건 결과(영역별). 키워드 인턴과 겹치지 않게 shownInterests가 이 값을 보고 인턴 키워드를 뺀다. */
  gradPartsFor(notice: Notice, verdict?: string | null): GradPart[] {
    return this.showsGraduation(notice) ? gradParts(this.graduationStatuses.get(notice.id), visibleTracks(this.profile), verdict) : [];
  }
  gradBadge(notice: Notice): GraduationBadge | null {
    return this.showsGraduation(notice) ? badgeOf(this.graduationStatuses.get(notice.id), visibleTracks(this.profile)) : null;
  }

  /** 이 글에 맞는 관심 키워드: 이 기기의 글자 매칭 + 서버의 글자 매칭 + Gemini가 뜻으로 맞춘 것 */
  interests(notice: Notice): string[] {
    // 제목과 분류(이 기기에서) + 서버가 본문과 그림 글자에서 찾은 것. 판정 이유 문장은 보지 않는다(D-024).
    const judgement = this.judgement(notice);
    const text = `${notice.title} ${notice.title_ko ?? ''} ${notice.category ?? ''}`;
    // 방학 키워드는 공고에서 뽑은 근무 기간(약 2개월, 그 방학 기간)이어도 맞는다. 판정이 아직 없으면 글자와 같은 뜻의 말로만 본다.
    const period = this.graduationStatuses.get(notice.id)?.period;
    const found = new Set(this.keywords.filter((word) => keywordMatchesNotice(word, text, period)));
    for (const word of judgement?.interests ?? []) {
      if (this.keywords.includes(word)) found.add(word);
    }
    for (const word of this.myInterests.get(notice.id) ?? []) {
      if (this.keywords.includes(word)) found.add(word);
    }
    return [...found];
  }

  /** 화면에 "관심 ○○"로 보여 줄 키워드. 외부 인턴 공고는 전부 인턴이라 키워드 인턴은 알려 주는 게 없어서 뺀다(키워드로 거르는 데는 그대로 쓴다). */
  shownInterests(notice: Notice, hasGrad = false): string[] {
    const all = this.interests(notice);
    // 외부 인턴 공고, 그리고 졸업요건 결과를 적는 글에서는 키워드 인턴이 같은 말을 되풀이하므로 뺀다.
    return this.isExternal(notice) || hasGrad ? all.filter((word) => !GENERIC_INTERN.test(word)) : all;
  }

  /** allBoards가 true이면 고른 게시판과 키워드는 무시하고 검색어만 적용한다(왼쪽 메뉴의 탭 숫자용). */
  filtered(notices = this.notices, allBoards = false): Notice[] {
    const query = this.query.trim().toLowerCase();
    const board = this.activeBoard();
    return notices.filter((n) => {
      if (!allBoards && board !== 'all' && n.source_id !== board) return false;
      if (!allBoards && this.keyword && !this.interests(n).includes(this.keyword)) return false;
      if (!query) return true;
      return `${n.title} ${n.title_ko ?? ''} ${n.category ?? ''} ${this.judgement(n)?.ai?.reason ?? ''}`.toLowerCase().includes(query);
    });
  }

  // 지금 탭에 맞는 게시판들. 인턴 공고 탭은 외부 게시판, 그 밖은 학교 게시판.
  async refreshBoardOrder(userId: string, epoch: number): Promise<void> {
    if (!authClient) return;
    try {
      const { available, order } = await loadBoardOrderPreference(authClient, userId);
      if (epoch !== this.subscriptionsEpoch) return;
      this.boardOrderAccount = available;
      if (!available) return;
      if (order.length) { this.boardOrder = order; remember('board-order', JSON.stringify(order)); }
      else if (this.boardOrder.length) void this.saveBoardOrderToAccount(this.boardOrder, false);
      this.recordSetting(userId, epoch, 'boardOrder', this.boardOrder);
    } catch { /* 계정에 못 읽으면 이 기기의 순서를 그대로 쓴다 */ }
  }

  setBoardOrder(ids: string[]) {
    const order = parseBoardOrder(ids).slice(0, BOARD_ORDER_LIMIT);
    this.boardOrder = order;
    remember('board-order', JSON.stringify(order));
    if (this.authUserId && this.boardOrderAccount) void this.saveBoardOrderToAccount(order, true);
  }

  private saveBoardOrderToAccount(order: string[], report: boolean): Promise<void> {
    const userId = this.authUserId;
    const epoch = this.subscriptionsEpoch;
    if (!authClient || !userId) return Promise.resolve();
    const client = authClient;
    this.boardOrderChain = this.boardOrderChain.then(async () => {
      // 더 새 순서가 이미 있으면 이 저장은 건너뛴다.
      if (report && this.boardOrder !== order) return;
      try {
        await saveBoardOrderPreference(client, userId, order);
        this.recordSetting(userId, epoch, 'boardOrder', order);
        if (report && epoch === this.subscriptionsEpoch && this.boardOrder === order) this.boardOrderStatus = 'saved';
      } catch {
        if (report && epoch === this.subscriptionsEpoch && this.boardOrder === order) this.boardOrderStatus = 'failed';
      }
    });
    if (report) this.boardOrderStatus = '';
    return this.boardOrderChain;
  }

  async refreshSavedOrder(userId: string, epoch: number): Promise<void> {
    if (!authClient) return;
    try {
      const { available, order } = await loadSavedOrderPreference(authClient, userId);
      if (epoch !== this.subscriptionsEpoch) return;
      this.savedOrderAccount = available;
      if (!available) return;
      if (this.savedOrderTouched) void this.saveSavedOrderToAccount(this.savedOrder, true);   // 응답을 기다리는 사이 이 기기에서 바꾼 순서가 먼저다
      else if (order.length) { this.savedOrder = order; remember('saved-order', JSON.stringify(order)); }
      else if (this.savedOrder.length) void this.saveSavedOrderToAccount(this.savedOrder, false);
    } catch { /* 계정에서 못 읽으면 이 기기의 순서를 그대로 쓴다 */ }
  }

  /** 저장 목록의 순서를 바꾼다. 놓을 때마다 한 번 저장한다(배열 통째 교체). */
  setSavedOrder(ids: string[]) {
    const order = parseSavedOrder(ids).slice(0, SAVED_ORDER_LIMIT);
    this.savedOrder = order; this.savedOrderTouched = true;
    remember('saved-order', JSON.stringify(order));
    if (this.authUserId && this.savedOrderAccount) void this.saveSavedOrderToAccount(order, true);
  }

  /** 계정에 저장하는 호출 하나. 시험에서 바꿔 끼운다. */
  persistSavedOrder(userId: string, order: string[]): Promise<void> {
    if (!authClient) return Promise.reject(new Error('no client'));
    return saveSavedOrderPreference(authClient, userId, order);
  }

  private saveSavedOrderToAccount(order: string[], report: boolean): Promise<void> {
    const userId = this.authUserId;
    const epoch = this.subscriptionsEpoch;
    if (!userId) return Promise.resolve();
    this.savedOrderChain = this.savedOrderChain.then(async () => {
      if (report && this.savedOrder !== order) return;   // 더 새 순서가 이미 있으면 이 저장은 건너뛴다
      try {
        await this.persistSavedOrder(userId, order);
        if (report && epoch === this.subscriptionsEpoch && this.savedOrder === order) this.savedOrderStatus = '';
      } catch {
        if (report && epoch === this.subscriptionsEpoch && this.savedOrder === order) this.savedOrderStatus = 'failed';
      }
    });
    if (report) this.savedOrderStatus = '';
    return this.savedOrderChain;
  }

  /** 순서 바꾸기는 저장한 공지 전체를 볼 때만 한다(일부만 보이면 전체 순서가 모호하다). */
  /** 저장 목록에 보기 조건(상태·검색·키워드·게시판)이 걸려 일부만 보이는지 */
  savedFilterOn(): boolean { return !this.canReorderSaved(); }

  canReorderSaved(): boolean {
    if (this.opportunityFilter !== 'all' || this.query || this.keyword || this.unreadOnly || (this.graduationOnly && this.gradEnabled())) return false;
    return this.visible().length === dropDuplicates(this.decorated(this.savedNotices())).length;
  }

  startReordering() {
    if (!this.canReorderSaved()) return;
    this.selecting = false; this.selectedReads = [];
    this.statusMenuOpen = false; this.sortMenuOpen = false;
    this.savedSort = 'custom'; remember('saved-sort', 'custom');
    this.reordering = true;
    this.listChanged();
  }

  /** 순서를 놓은 직후 저장할 배열: 화면에 보이던 순서 + 보이지 않던 저장 공지. */
  commitSavedOrder(moved: string[]) {
    this.setSavedOrder(savedOrderToStore(moved, this.savedNotices().map((notice) => notice.id)));
  }

  /** 저장한 공지의 진행 상태. 기록이 없으면 화면 기본값 '관심 있음'(서버에는 행을 만들지 않는다). 기록 표를 쓸 수 없으면 없다. */
  statusOf(notice: Notice): OpportunityStatus | undefined {
    return this.opportunities.get(notice.id)?.status
      ?? (this.opportunitiesStatus === 'ready' && this.isSaved(notice) ? 'interested' : undefined);
  }

  exploreStatus(): 'loading' | 'failed' | 'ready' {
    if (this.opportunitiesLoading || (!this.liveFeedReady && this.loading)) return 'loading';
    if (this.opportunitiesStatus === 'failed' || this.opportunitiesStatus === 'unavailable'
      || this.exploreSavedStatus === 'failed' || (!this.liveFeedReady && this.failed)) return 'failed';
    return this.opportunitiesStatus === 'ready' && this.exploreSavedStatus === 'ready' ? 'ready' : 'loading';
  }

  retryExplore = () => {
    const userId = this.authUserId;
    if (!userId) return;
    if (this.opportunitiesStatus !== 'ready') void this.refreshOpportunities(userId, this.subscriptionsEpoch);
    if (this.exploreSavedStatus !== 'ready') {
      if (this.liveFeedReady) void this.syncStates();
      else void this.refresh();
    }
  };

  /** 저장 목록의 대표를 먼저 쓰고, 저장하지 않은 기회함 기록도 같은 공지끼리 묶는다. */
  exploreItems(): ExploreItem[] {
    if (this.exploreStatus() !== 'ready') return [];
    const saved = this.decorated(this.savedNotices());
    const savedIds = new Set(saved.map((notice) => notice.id));
    const known = this.notices.filter((notice) => !savedIds.has(notice.id) && this.opportunities.has(notice.id));
    const mates = groupMates([...saved, ...known]);
    const knownIds = new Set(known.map((notice) => notice.id));
    const boardNames = new Map(this.sources.map((source) => [source.id, boardName(source, source.id)]));
    const items: ExploreItem[] = [];
    for (const notice of dropDuplicates(saved)) {
      const status = this.statusOf(notice);
      if (status) items.push({ id: notice.id, title: notice.title, board: boardNames.get(notice.source_id) ?? boardName(undefined, notice.source_id), category: notice.category, status });
    }
    const append = (record: Opportunity) => items.push({ id: record.notice_id, title: record.title, board: record.board, status: record.status });
    for (const notice of dropDuplicates(known.filter((notice) => !mates.get(notice.id)?.some((mate) => savedIds.has(mate.id))))) {
      append(this.opportunities.get(notice.id)!);
    }
    for (const record of this.opportunities.values()) {
      if (!savedIds.has(record.notice_id) && !knownIds.has(record.notice_id)) append(record);
    }
    return items;
  }

  /** 저장한 공지의 상태별 개수(상태 거르기 메뉴용). */
  savedStatusCounts(): Map<OpportunityStatus, number> {
    const counts = new Map<OpportunityStatus, number>();
    for (const notice of dropDuplicates(this.decorated(this.savedNotices()))) {
      const status = this.statusOf(notice);
      if (status) counts.set(status, (counts.get(status) ?? 0) + 1);
    }
    return counts;
  }

  async refreshPreferences(userId: string, epoch: number): Promise<void> {
    if (!authClient) return;
    try {
      const keywords = await loadKeywordsPreference(authClient, userId);
      if (epoch === this.subscriptionsEpoch) {
        this.preferencesUnavailable = false;
        if (keywords !== null) {
          this.keywords = keywords;
          remember('keywords', JSON.stringify(keywords));
        }
        this.recordSetting(userId, epoch, 'keywords', this.keywords);
      }
    } catch {
      if (epoch === this.subscriptionsEpoch) { this.preferencesUnavailable = true; this.preferencesError = '키워드를 불러오지 못했어요. 다시 시도해 주세요.'; }
    } finally {
      if (epoch === this.subscriptionsEpoch) this.preferencesLoading = false;
    }
  }

  // 외부 인턴 공고는 서버 공지 테이블에 없어 계정에 올리지 않는다.
  isSyncable(id: string): boolean {
    const notice = this.notices.find((item) => item.id === id);
    return !!notice && !this.sources.find((source) => source.id === notice.source_id)?.external;
  }

  uploadStates(run: (guard: () => Promise<boolean>) => Promise<boolean>): void {
    if (!authClient || !this.authUserId) return;
    const client = authClient, userId = this.authUserId, epoch = this.subscriptionsEpoch;
    const guard = async () => epoch === this.subscriptionsEpoch && this.authUserId === userId && await sessionIs(client, userId);
    void run(guard).catch(() => true).then((ok) => { if (!ok && epoch === this.subscriptionsEpoch) this.showToast('이 기기에는 저장했지만 계정에 올리지 못했어요. 다음에 다시 맞출게요'); });
  }

  // 로그인 사용자의 저장·읽음을 서버와 맞춘다. 피드에 없는 저장 공지는 글 정보만 별도로 읽는다.
  // 병합 → 저장 업로드 → 읽음 업로드 순서의 체인이며, 업로드가 일부 실패하면 다음 새로고침에서 실패한 단계부터 이어 간다.
  async syncStates(): Promise<void> {
    const userId = this.authUserId, epoch = this.subscriptionsEpoch;
    // 저장해 둔 목록(캐시)에는 서버에서 이미 지운 공지가 남아 있을 수 있어, 새로 받은 목록이 온 뒤에만 맞춘다.
    if (!authClient || !userId || !this.liveFeedReady || this.stateSyncedEpoch === epoch) return;
    if (!this.notices.length && this.exploreSavedStatus === 'ready' && !this.stateChain) return;
    if (!this.stateChain || this.stateChain.epoch !== epoch) {
      const client = authClient;
      let plan: StatePlan | null = null;
      let mergedWithNotices = false;
      const syncable = (id: string) => this.isSyncable(id);
      // 단계 사이와 청크 사이마다 앱의 계정 상태와 실제 세션이 모두 같은 사용자인지 확인한다.
      const same = async () => epoch === this.subscriptionsEpoch && this.authUserId === userId && await sessionIs(client, userId);
      const chain = connectionChain([
        async () => {
          this.exploreSavedStatus = 'idle';
          const remote = await loadNoticeStates(client, userId).catch((error: unknown) => {
            if (this.isCurrentAccount(userId, epoch)) this.exploreSavedStatus = 'failed';
            throw error;
          });
          if (!this.isCurrentAccount(userId, epoch)) throw new Error('계정이 바뀌었어요');
          const known = new Set([...this.notices.map((notice) => notice.id), ...this.saved.map((notice) => notice.id)]);
          const missing = [...remote.savedIds].filter((id) => !known.has(id) && !this.savedTouched.has(id));
          const outsideFeed = missing.length ? await loadSavedNoticeDetails(client, missing, () => this.isCurrentAccount(userId, epoch)).catch(() => null) : [];
          if (!this.isCurrentAccount(userId, epoch)) throw new Error('계정이 바뀌었어요');
          mergedWithNotices = this.notices.length > 0 && outsideFeed !== null;
          const currentSaved = new Set(this.saved.map((notice) => notice.id));
          const savedIds = new Set([...remote.savedIds].filter((id) => !this.savedTouched.has(id) || currentSaved.has(id)));
          plan = planStateSync({ ...remote, savedIds }, this.saved, this.readState ?? parseReadState(null), [...(outsideFeed ?? []), ...this.notices]);
          this.saved = plan.saved; storeSaved(plan.saved);
          this.readState = plan.read; this.read = readIds(plan.read); storeReadState(plan.read);
          this.exploreSavedStatus = 'ready';
        },
        async () => { if (!await pushSaved(client, plan!.uploadSaved.filter((item) => syncable(item.id)), same)) throw new Error('저장을 올리지 못했어요'); },
        async () => { if (!await pushRead(client, plan!.uploadRead.filter((item) => syncable(item.id)), same)) throw new Error('읽음을 올리지 못했어요'); },
      ]);
      this.stateChain = { run: async () => { await chain.run(); return mergedWithNotices; }, epoch };
    }
    const current = this.stateChain;
    try {
      const mergedWithNotices = await current.run();
      if (!this.isCurrentAccount(userId, epoch)) return;
      if (mergedWithNotices) this.stateSyncedEpoch = epoch;
      else this.stateChain = null;   // 빈 피드로는 서버에만 저장된 공지의 내용을 찾지 못한다
    } catch {
      // 사용자가 할 일이 없는 뒤쪽 동기화라 토스트로 알리지 않는다(토스 규칙: 행동할 수 없는 오류는 띄우지 않는다). 다음 새로고침에서 실패한 단계부터 잇는다.
      if (epoch !== this.subscriptionsEpoch && this.stateChain === current) this.stateChain = null;
    }
  }

  async refreshProfile(userId: string, epoch: number): Promise<void> {
    if (!authClient) return;
    try {
      const row = await loadProfile(authClient, userId);
      if (epoch !== this.subscriptionsEpoch) return;
      this.profile = row ?? EMPTY_PROFILE;
      rememberOnboarded(userId, !!this.profile.onboardedAt);   // 완료로 기억했는데 서버가 아니라고 하면 지운다
      this.profileStatus = 'ready';
      this.recordSetting(userId, epoch, 'profile', this.profile);
    } catch {
      // 테이블이 아직 없거나 읽지 못하면 온보딩을 띄우지 않는다(설정에서는 그대로 쓸 수 있다).
      if (epoch === this.subscriptionsEpoch) this.profileStatus = 'unavailable';
    }
  }

  /** 첫 로그인 설정을 보여 줄지. 한 번 끝냈거나 건너뛴 사람에게는 다시 띄우지 않는다. */
  needsOnboarding(): boolean {
    if (!this.authUserId) return false;
    if (this.onboardingOpen) return true;
    if (this.profileStatus !== 'ready') return false;
    if (!this.profile.onboardedAt) return !this.onboardingDismissed;
    return this.missingRequiredSteps().length > 0;
  }

  /** 연결해 둔 AI 키 중 쓸 수 있는 것이 있는지. 아직 모르면(기능이 꺼졌거나, 불러오는 중이거나, 불러오지 못함) null이라 잠그지 않는다. */
  hasUsableAiKey(): boolean | null {
    if (!this.authUserId || !this.byokOn || this.byokLoading || this.byokError) return null;
    return (!!this.byokStatus && !this.byokStatus.disabled) || this.aiKeys.some((key) => !key.disabled);
  }

  /** 첫 설정을 끝낸 계정에서 비어 있는 필수 항목(REQUIRED_ITEMS 순서). 끝내지 않은 계정은 전체 첫 설정을 거치므로 비워 둔다. */
  missingRequiredSteps(): Step[] {
    if (!this.authUserId || this.profileStatus !== 'ready' || !this.profile.onboardedAt) return [];
    const draft = initialDraft(this.profile, [], []);
    return missingRequired(draft, savedDoubleAnswer(draft), { usable: this.hasUsableAiKey() });
  }

  /** 비어 있는 항목을 채우는 화면은 채우는 동안(키를 연결한 순간에도) 닫히지 않게 붙들어 둔다. 끝내기나 저장이 끝나면 closeOnboarding이 닫는다. */
  holdOnboarding() { this.onboardingOpen = true; }

  /** 비어 있던 프로필 항목만 저장한다(게시판·키워드는 건드리지 않는다). 계정이 바뀌면 결과를 버린다. */
  async saveMissingProfile(draft: Draft, close: boolean): Promise<boolean> {
    const userId = this.authUserId, epoch = this.subscriptionsEpoch, client = authClient;
    if (!client || !userId || this.onboardingBusy) return false;
    const software = isSoftwareOriginal({ programs: draft.programs });
    const next: UserProfile = {
      ...this.profile, programs: draft.programs, year: draft.year, enrollmentStatus: draft.enrollmentStatus, militaryService: draft.militaryService,
      admissionYear: software ? draft.admissionYear : this.profile.admissionYear,
      university3pInternshipSelected: draft.university3pInternshipSelected, university3pInternshipDone: draft.university3pInternshipDone,
      deptInternshipDone: software ? draft.deptInternshipDone : this.profile.deptInternshipDone,
    };
    this.onboardingBusy = true; this.onboardingError = '';
    try {
      if (epoch !== this.subscriptionsEpoch || !(await sessionIs(client, userId))) throw new Error('계정이 바뀌었어요');
      await storeProfile(client, userId, next);
      if (epoch !== this.subscriptionsEpoch) return false;
      this.profile = next;
      this.recordSetting(userId, epoch, 'profile', next);
      if (close) this.closeOnboarding();
      return true;
    } catch {
      if (epoch === this.subscriptionsEpoch) this.onboardingError = '저장하지 못했어요. 다시 시도해 주세요.';
      return false;
    } finally {
      if (epoch === this.subscriptionsEpoch) this.onboardingBusy = false;
    }
  }

  /** 로그인했지만 프로필을 아직 모르고 첫 설정을 마친 계정으로도 기억하지 않으면, 목록 대신 불러오는 화면을 보인다. */
  awaitingProfile(): boolean {
    return !!this.authUserId && (this.profileStatus === 'idle' || this.profileStatus === 'loading') && !isRememberedOnboarded(this.authUserId);
  }

  closeOnboarding() { this.onboardingOpen = false; this.onboardingError = ''; }

  /**
   * 프로필 저장 → 게시판 구독 반영 → 키워드 저장 순서로 끝낸다. 중간에 실패하면 같은 내용으로 다시 부를 때
   * 끝낸 단계는 건너뛰고 실패한 단계부터 이어서 저장한다. 계정이 바뀌면 단계마다 멈춘다.
   */
  /** 저장이 끝나도 남은 단계(AI 키, 알림)를 마칠 때까지 첫 설정 화면을 둔다. 프로필에 완료 시각이 생기면 needsOnboarding이 꺼져 화면이 바로 사라지기 때문이다. */
  applyOnboardingSaved(profile: UserProfile) {
    this.profile = profile;
    if (this.authUserId) this.recordSetting(this.authUserId, this.subscriptionsEpoch, 'profile', profile);
    this.onboardingOpen = true;
  }

  /** AI 키를 연결해야 설정이 끝난다. 키가 없으면 완료 시각을 남기지 않아서, 중간에 나갔다 다시 들어와도 첫 설정이 이어진다. */
  async completeOnboarding(): Promise<boolean> {
    const userId = this.authUserId, epoch = this.subscriptionsEpoch, client = authClient;
    if (!client || !userId || this.onboardingBusy) return false;
    const next: UserProfile = { ...this.profile, onboardedAt: this.profile.onboardedAt ?? new Date().toISOString() };
    this.onboardingBusy = true; this.onboardingError = '';
    try {
      if (epoch !== this.subscriptionsEpoch || !(await sessionIs(client, userId))) throw new Error('계정이 바뀌었어요');
      await storeProfile(client, userId, next);
      if (epoch !== this.subscriptionsEpoch) return false;
      this.profile = next;
      this.recordSetting(userId, epoch, 'profile', next);
      rememberOnboarded(userId, true); this.closeOnboarding();
      return true;
    } catch {
      if (epoch === this.subscriptionsEpoch) this.onboardingError = '저장하지 못했어요. 다시 시도해 주세요.';
      return false;
    } finally {
      if (epoch === this.subscriptionsEpoch) this.onboardingBusy = false;
    }
  }

  async finishOnboarding(draft: Draft, final = true): Promise<boolean> {
    const userId = this.authUserId, epoch = this.subscriptionsEpoch, client = authClient;
    if (!client || !userId || this.onboardingBusy) return false;
    let words: string[];
    try { words = parseKeywords(draft.keywords.join('\n')); }
    catch (error) { this.onboardingError = error instanceof Error ? error.message : '키워드를 확인해 주세요.'; return false; }
    const key = JSON.stringify([userId, epoch, draft, final]);
    const nextProfile: UserProfile = {
      ...this.profile, programs: draft.programs, year: draft.year, enrollmentStatus: draft.enrollmentStatus, militaryService: draft.militaryService,
      admissionYear: isSoftwareOriginal({ programs: draft.programs }) ? draft.admissionYear : this.profile.admissionYear,
      university3pInternshipSelected: draft.university3pInternshipSelected,
      university3pInternshipDone: draft.university3pInternshipDone,
      deptInternshipDone: isSoftwareOriginal({ programs: draft.programs }) ? draft.deptInternshipDone : this.profile.deptInternshipDone,
      onboardedAt: this.profile.onboardedAt ?? (final ? new Date().toISOString() : null),
    };
    const boards = draft.boards.filter((id) => this.sources.some((source) => source.id === id && !source.external));
    if (!this.onboardingChain || this.onboardingChain.key !== key) {
      const same = async () => {
        if (epoch !== this.subscriptionsEpoch || this.authUserId !== userId || !(await sessionIs(client, userId))) throw new Error('계정이 바뀌었어요');
      };
      const chain = connectionChain([
        async () => { await same(); await storeProfile(client, userId, nextProfile); },
        async () => {
          const current = new Set(this.subscriptions);
          for (const id of boards) if (!current.has(id)) { await same(); await setSubscription(client, userId, id, true); }
          for (const id of current) if (!boards.includes(id)) { await same(); await setSubscription(client, userId, id, false); }
        },
        async () => { await same(); await saveKeywordsPreference(client, userId, words); },
      ]);
      this.onboardingChain = { key, run: () => chain.run() };
    }
    const current = this.onboardingChain;
    this.onboardingBusy = true; this.onboardingError = '';
    try {
      await current.run();
      if (!this.isCurrentAccount(userId, epoch)) return false;
      this.applyOnboardingSaved(nextProfile); this.subscriptions = boards; this.setKeywords(words);
      this.recordSetting(userId, epoch, 'subscriptions', boards);
      this.recordSetting(userId, epoch, 'keywords', words);
      this.onboardingChain = null;
      this.showToast('설정을 저장했어요');
      return true;
    } catch {
      if (epoch === this.subscriptionsEpoch) this.onboardingError = '저장하지 못했어요. 다시 시도하면 이어서 저장해요.';
      return false;
    } finally {
      if (epoch === this.subscriptionsEpoch) this.onboardingBusy = false;
    }
  }

  /** 이 기기에서 알림이 뜨는지 확인하는 테스트 알림(원본의 "테스트 알림 띄우기"). */
  async testNotification(): Promise<void> {
    try {
      const registration = this.pushRegistration ?? await navigator.serviceWorker?.getRegistration() ?? null;
      if (!registration || Notification.permission !== 'granted') { this.showToast('알림을 먼저 켜 주세요'); return; }
      this.showToast(await showTestNotification(registration, navigator.userAgent), null, '', 10000);
    } catch {
      this.showToast('테스트 알림을 띄우지 못했어요');
    }
  }

  async refreshByok(userId: string, epoch: number): Promise<void> {
    if (!authClient || !this.byokOn) {
      if (this.isCurrentAccount(userId, epoch)) {
        this.byokLoading = false;
        if (!authClient || this.byokChecked) this.aiStateLoaded = true;
        if (authClient && this.byokUnavailable) {
          this.recordSetting(userId, epoch, 'ai', { available: false, status: null, keys: [], prefs: DEFAULT_AI_PREFERENCES, backfill: 0 });
          this.recordSetting(userId, epoch, 'canvas', null);
        }
      }
      return;
    }
    try {
      const [status, canvas, aiKeys, aiPrefs] = await Promise.all([loadByokStatus(authClient, userId), loadCanvasStatus(authClient, userId).catch(() => undefined), loadAiKeyStatuses(authClient, userId, true), loadAiPreferences(authClient, userId, true)]);
      if (epoch !== this.subscriptionsEpoch) return;
      this.byokStatus = status; this.byokError = '';
      if (canvas !== undefined) {
        this.canvasStatus = canvas;
        this.recordCanvasSettings(userId, epoch);
      }
      this.aiKeys = aiKeys; this.aiPrefs = aiPrefs;
      this.aiStateLoaded = true;   // 판정 대기(judgePending)는 키와 AI 설정만 보면 정해진다. 채우기 작업은 기다리지 않는다
      this.byokLoading = false;
      this.recordAiSettings(userId, epoch);
      await this.refreshByokBackfill(userId, epoch);
    } catch {
      if (epoch === this.subscriptionsEpoch) this.byokError = '키 정보를 불러오지 못했어요. 잠시 뒤 다시 시도해 주세요.';
    } finally {
      if (epoch === this.subscriptionsEpoch) { this.byokLoading = false; this.aiStateLoaded = true; }
    }
  }

  // 키를 등록한 뒤 워커가 이미 모인 공지를 채우는 동안 남은 수를 1분마다 다시 읽는다. 0이 되거나 계정이 바뀌면 멈춘다.
  async refreshByokBackfill(userId: string, epoch: number): Promise<void> {
    if (this.byokPoll) { clearTimeout(this.byokPoll); this.byokPoll = null; }
    if (!authClient || !this.byokStatus || this.byokStatus.disabled) { this.byokBackfill = 0; return; }
    const count = await loadByokBackfillCount(authClient);
    if (epoch !== this.subscriptionsEpoch || this.authUserId !== userId) return;
    this.byokBackfill = count;
    this.recordAiSettings(userId, epoch);
    if (count > 0) {
      this.byokPoll = setTimeout(() => {
        this.byokPoll = null;
        if (epoch === this.subscriptionsEpoch && this.authUserId === userId) {
          void this.refreshByokBackfill(userId, epoch).then(() => this.refreshMine(userId, epoch));
        }
      }, 60_000);
    }
  }

  // 키는 요청 한 번에만 쓰고 앱 상태에는 두지 않는다. 계정이 바뀌면 결과를 버린다.
  async registerKey(apiKey: string): Promise<void> {
    const userId = this.authUserId, epoch = this.subscriptionsEpoch;
    if (!authClient || !userId || this.byokBusy) return;
    this.byokBusy = true; this.byokError = '';
    try {
      await registerByokKey(authClient, apiKey);
      const status = await loadByokStatus(authClient, userId);
      if (this.isCurrentAccount(userId, epoch)) {
        this.byokStatus = status;
        this.recordAiSettings(userId, epoch);
      }
      await this.refreshByokBackfill(userId, epoch);
    } catch (error) {
      if (epoch === this.subscriptionsEpoch) this.byokError = error instanceof Error ? error.message : '키를 저장하지 못했어요.';
    } finally {
      if (epoch === this.subscriptionsEpoch) this.byokBusy = false;
    }
  }

  async registerCanvas(token: string): Promise<void> {
    const userId = this.authUserId, epoch = this.subscriptionsEpoch;
    if (!authClient || !userId || this.canvasBusy) return;
    this.canvasBusy = true; this.canvasError = '';
    try {
      await registerCanvasToken(authClient, token);
      const status = await loadCanvasStatus(authClient, userId);
      if (this.isCurrentAccount(userId, epoch)) {
        this.canvasStatus = status;
        this.recordCanvasSettings(userId, epoch);
      }
    } catch (error) {
      if (epoch === this.subscriptionsEpoch) this.canvasError = error instanceof Error ? error.message : '토큰을 저장하지 못했어요.';
    } finally {
      if (epoch === this.subscriptionsEpoch) this.canvasBusy = false;
    }
  }

  async removeCanvas(): Promise<void> {
    const userId = this.authUserId, epoch = this.subscriptionsEpoch;
    if (!authClient || !userId || this.canvasBusy) return;
    this.canvasBusy = true; this.canvasError = '';
    try {
      await removeCanvasToken(authClient);
      if (this.isCurrentAccount(userId, epoch)) {
        this.canvasStatus = null;
        this.recordCanvasSettings(userId, epoch);
      }
    } catch (error) {
      if (epoch === this.subscriptionsEpoch) this.canvasError = error instanceof Error ? error.message : '토큰을 지우지 못했어요.';
    } finally {
      if (epoch === this.subscriptionsEpoch) this.canvasBusy = false;
    }
  }

  // ----- 알림 기기와 아이캠퍼스 알림 설정(원본의 이 기기 아캠 알림, 알림 기기, 하루 요약 시간) -----
  async refreshDevices(): Promise<void> {
    const userId = this.authUserId, epoch = this.subscriptionsEpoch;
    if (!authClient || !userId) { this.devicesLoaded = true; return; }   // 받을 기기 목록이 없으면 기다리지 않는다
    try {
      const [devices, time] = await Promise.all([loadDevices(authClient, userId), loadSummaryTime(authClient, userId).catch(() => undefined)]);
      let endpoint = '';
      // 서비스 워커나 구독 조회가 답하지 않는 브라우저(삼성 인터넷)에서 기기 목록이 끝없이 기다리지 않게 한다.
      const registration = this.pushRegistration ?? await Promise.race([
        navigator.serviceWorker ? navigator.serviceWorker.ready : Promise.resolve(null),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 5000)),
      ]).catch(() => null);
      if (registration) endpoint = await deviceEndpoint(registration);
      if (epoch !== this.subscriptionsEpoch || userId !== this.authUserId) return;
      this.devices = devices;
      if (time !== undefined) this.summaryTime = time;
      else this.summaryTime ??= this.cachedSetting('devices')?.summaryTime ?? null;
      this.devicesLoadFailed = false;
      this.thisDeviceId = devices.find((device) => device.endpoint === endpoint)?.id ?? null;
      // 이름이 없는 이 기기는 브라우저가 알려 주는 모델이나 기기 종류로 이름을 자동으로 저장한다(원본과 같다).
      const mine = devices.find((device) => device.id === this.thisDeviceId);
      if (mine && !mine.name) {
        const suggestion = await suggestDeviceName();
        if (!this.isCurrentAccount(userId, epoch)) return;
        await saveDeviceName(authClient, userId, mine.id, suggestion).catch(() => undefined);
        if (epoch === this.subscriptionsEpoch && userId === this.authUserId) this.devices = this.devices.map((device) => (device.id === mine.id ? { ...device, name: suggestion } : device));
      }
      this.recordDevices(userId, epoch);
    } catch { if (epoch === this.subscriptionsEpoch && userId === this.authUserId) this.devicesLoadFailed = true; } finally {
      if (epoch === this.subscriptionsEpoch && userId === this.authUserId) this.devicesLoaded = true;
    }
  }

  async setCanvasMode(mode: CanvasMode): Promise<void> {
    const userId = this.authUserId, epoch = this.subscriptionsEpoch, id = this.thisDeviceId;
    if (!authClient || !userId || !id || this.devicesBusy) return;
    this.devicesBusy = true; this.devicesError = '';
    try {
      await saveCanvasMode(authClient, userId, id, mode);
      if (this.isCurrentAccount(userId, epoch)) {
        this.devices = this.devices.map((device) => (device.id === id ? { ...device, canvasMode: mode } : device));
        this.recordDevices(userId, epoch);
      }
    } catch {
      if (epoch === this.subscriptionsEpoch) this.devicesError = '아이캠퍼스 알림을 바꾸지 못했어요. 잠시 뒤 다시 눌러 주세요';
    } finally {
      if (epoch === this.subscriptionsEpoch) this.devicesBusy = false;
    }
  }

  /** 이 기기에서 모든 새 공지를 소리와 함께 알릴지(기기별). */
  async setDeviceAlertAll(enabled: boolean): Promise<void> {
    const userId = this.authUserId, epoch = this.subscriptionsEpoch, id = this.thisDeviceId;
    if (!authClient || !userId || !id || this.devicesBusy) return;
    this.devicesBusy = true; this.devicesError = '';
    try {
      await saveDeviceAlertAll(authClient, userId, id, enabled);
      if (this.isCurrentAccount(userId, epoch)) {
        this.devices = this.devices.map((device) => (device.id === id ? { ...device, alertAllNew: enabled } : device));
        this.recordDevices(userId, epoch);
      }
    } catch {
      if (epoch === this.subscriptionsEpoch) this.devicesError = '설정을 저장하지 못했어요. 잠시 뒤 다시 눌러 주세요';
    } finally {
      if (epoch === this.subscriptionsEpoch) this.devicesBusy = false;
    }
  }

  async renameDevice(id: string, name: string): Promise<boolean> {
    const userId = this.authUserId, epoch = this.subscriptionsEpoch;
    if (!authClient || !userId || this.devicesBusy) return false;
    this.devicesBusy = true; this.devicesError = '';
    try {
      await saveDeviceName(authClient, userId, id, name);
      if (this.isCurrentAccount(userId, epoch)) {
        this.devices = this.devices.map((device) => (device.id === id ? { ...device, name: name.trim() } : device));
        this.recordDevices(userId, epoch);
      }
      return true;
    } catch (error) {
      if (epoch === this.subscriptionsEpoch) this.devicesError = error instanceof Error && /[가-힣]/.test(error.message) ? error.message : '기기 이름을 바꾸지 못했어요. 잠시 뒤 다시 눌러 주세요';
      return false;
    } finally {
      if (epoch === this.subscriptionsEpoch) this.devicesBusy = false;
    }
  }

  async removeDevice(id: string): Promise<void> {
    const userId = this.authUserId, epoch = this.subscriptionsEpoch;
    if (!authClient || !userId || id === this.thisDeviceId || this.devicesBusy) return;   // 이 기기는 "알림 끄기"로 해제한다
    this.devicesBusy = true; this.devicesError = '';
    try {
      await deleteDevice(authClient, userId, id);
      if (this.isCurrentAccount(userId, epoch)) {
        this.devices = this.devices.filter((device) => device.id !== id);
        this.recordDevices(userId, epoch);
      }
    } catch {
      if (epoch === this.subscriptionsEpoch) this.devicesError = '기기를 지우지 못했어요. 잠시 뒤 다시 눌러 주세요';
    } finally {
      if (epoch === this.subscriptionsEpoch) this.devicesBusy = false;
    }
  }

  /** 오전·오후와 시, 분 중 바뀐 것을 받아 하루 요약 시간을 저장한다. */
  async setSummaryTime(period: 'am' | 'pm', hour: number, minute: number): Promise<void> {
    const userId = this.authUserId, epoch = this.subscriptionsEpoch;
    const time = composeSummaryTime(period, hour, minute);
    if (!authClient || !userId || this.devicesBusy) return;
    if (!time) { this.devicesError = '시는 1~12, 분은 0~59로 적어 주세요'; return; }
    this.devicesBusy = true; this.devicesError = '';
    try {
      await saveSummaryTime(authClient, userId, time);
      if (this.isCurrentAccount(userId, epoch)) {
        this.summaryTime = time;
        this.recordDevices(userId, epoch);
      }
    } catch (error) {
      if (epoch === this.subscriptionsEpoch) this.devicesError = error instanceof Error && /[가-힣]/.test(error.message) ? error.message : '요약 시간을 바꾸지 못했어요. 잠시 뒤 다시 눌러 주세요';
    } finally {
      if (epoch === this.subscriptionsEpoch) this.devicesBusy = false;
    }
  }

  // ----- 구글 캘린더 -----
  private calendarDenied = false;
  private googleTokenMemo: { value: string; at: number } | null = null;

  private takeCalendarPending(): boolean {
    return takeCalendarPending(this.pendingStores());
  }

  /** 휴대폰은 구글에서 돌아올 때 탭이 달라 sessionStorage가 비므로 localStorage에도 시각과 함께 둔다. */
  private pendingStores(): Storage[] {
    const stores: Storage[] = [];
    try { stores.push(sessionStorage); } catch { /* 못 쓰는 환경 */ }
    try { stores.push(localStorage); } catch { /* 못 쓰는 환경 */ }
    return stores;
  }

  /** 구글에서 허용하지 않고 돌아왔으면 그 사실을 알려 준다(조용히 끝나지 않게). */
  private checkCalendarReturn(): void {
    if (!hasCalendarPending(this.pendingStores()) || !googleReturnDenied(location.href)) return;
    takeCalendarPending(this.pendingStores());
    this.calendarDenied = true;
  }

  private rememberGoogleToken(value: string): void {
    this.googleTokenMemo = { value, at: Date.now() };   // 저장소를 못 써도 이 탭에서는 바로 맞출 수 있게 메모리에도 둔다
    try { sessionStorage.setItem('google-calendar-token', JSON.stringify({ value, at: Date.now() })); } catch { /* 이 탭의 메모리에는 없으므로 다시 허용을 받는다 */ }
  }

  private forgetGoogleToken(): void {
    this.googleTokenMemo = null;
    try { sessionStorage.removeItem('google-calendar-token'); } catch { /* 없어도 된다 */ }
    takeCalendarPending(this.pendingStores());
  }

  /** 구글 접근 토큰은 1시간 안에 만료돼서 50분까지만 쓴다. 서버에는 보내지 않고 이 탭에만 둔다. */
  private googleToken(): string | null {
    const memo = this.googleTokenMemo;
    if (memo && Date.now() - memo.at < 50 * 60 * 1000) return memo.value;
    try {
      const raw = sessionStorage.getItem('google-calendar-token');
      if (!raw) return null;
      const parsed = JSON.parse(raw) as { value?: unknown; at?: unknown };
      return typeof parsed.value === 'string' && typeof parsed.at === 'number' && Date.now() - parsed.at < 50 * 60 * 1000 ? parsed.value : null;
    } catch { return null; }
  }

  async refreshCalendar(userId: string, epoch: number): Promise<void> {
    if (!authClient) return;
    try {
      const { data, error } = await authClient.from('user_calendar').select('calendar_id,synced_at').eq('user_id', userId).maybeSingle();
      if (error) throw error;
      if (epoch !== this.subscriptionsEpoch) return;
      this.calendarId = typeof data?.calendar_id === 'string' ? data.calendar_id : null;
      this.calendarSyncedAt = typeof data?.synced_at === 'string' ? data.synced_at : null;
      const auto = await loadGoogleAutoStatus(authClient, userId).catch(() => null);
      if (!this.isCurrentAccount(userId, epoch)) return;
      if (auto) this.calendarAuto = auto;
      else this.calendarAuto = this.cachedSetting('calendar')?.auto ?? this.calendarAuto;
      this.recordCalendar(userId, epoch);
    } catch { /* 표가 아직 없으면 연결 전으로 보인다 */ }
  }

  /** 연결할 때 받은 구글 장기 열쇠를 서버에 맡긴다. 실패해도 지금 맞추기는 그대로 된다. */
  async linkGoogleCalendar(refreshToken: string): Promise<void> {
    const userId = this.authUserId, epoch = this.subscriptionsEpoch;
    if (!authClient || !userId) return;
    try {
      await linkGoogleCalendar(authClient, refreshToken);
      const auto = await loadGoogleAutoStatus(authClient, userId).catch(() => null);
      if (!this.isCurrentAccount(userId, epoch)) return;
      if (auto) this.calendarAuto = auto;
      this.recordCalendar(userId, epoch);
    } catch (error) {
      if (epoch === this.subscriptionsEpoch) this.calendarError = error instanceof Error && /[가-힣]/.test(error.message) ? error.message : '자동으로 반영하는 설정을 저장하지 못했어요. 잠시 뒤 다시 연결해 주세요.';
    }
  }

  /** 구글에서 캘린더 권한을 허용받는다. 허용하면 이 화면으로 돌아와 곧바로 일정을 맞춘다. */
  async connectCalendar(): Promise<void> {
    if (!authClient || !this.authUserId || this.calendarBusy) return;
    this.calendarError = '';
    try {
      markCalendarPending(this.pendingStores());
      const { error } = await authClient.auth.signInWithOAuth({
        provider: 'google',
        options: { scopes: CALENDAR_SCOPE, redirectTo: new URL('./?view=settings&section=calendar', location.href).href, queryParams: { include_granted_scopes: 'true', access_type: 'offline', prompt: 'consent' } },
      });
      if (error) throw error;
    } catch {
      takeCalendarPending(this.pendingStores());
      this.calendarError = '구글 연결을 시작하지 못했어요. 잠시 뒤 다시 눌러 주세요';
    }
  }

  /** 저장한 공지의 마감을 캘린더에 맞춘다. 토큰이 없거나 만료됐으면 구글에서 다시 허용받는다. */
  async syncCalendarNow(): Promise<void> {
    const userId = this.authUserId, epoch = this.subscriptionsEpoch;
    if (!authClient || !userId || this.calendarBusy) return;
    const token = this.googleToken();
    if (!token) { this.calendarMessage = '구글에서 다시 허용하면 바로 반영해요'; await this.connectCalendar(); return; }
    this.calendarBusy = true; this.calendarError = ''; this.calendarMessage = '';
    try {
      const notRelevant = new Set(this.saved.filter((item) => this.judgement(item as unknown as Notice)?.ai?.verdict === 'not_relevant').map((item) => item.id));
      const events = await desiredEvents(this.saved, new Date(), notRelevant);
      const calendar = await ensureCalendar(token, this.calendarId);
      await syncCalendar(token, calendar, events);
      const syncedAt = new Date().toISOString();
      const { error } = await authClient.from('user_calendar').upsert({ user_id: userId, calendar_id: calendar, synced_at: syncedAt }, { onConflict: 'user_id' });
      if (error) throw error;
      if (epoch !== this.subscriptionsEpoch) return;
      this.calendarId = calendar; this.calendarSyncedAt = syncedAt;
      this.recordCalendar(userId, epoch);
      this.calendarMessage = events.size ? `마감 ${events.size}개를 캘린더에 반영했어요` : '마감이 남은 저장 공지가 없어요';
    } catch (error) {
      if (epoch === this.subscriptionsEpoch) {
        this.calendarError = error instanceof GoogleError ? error.message : '캘린더에 반영하지 못했어요. 잠시 뒤 다시 눌러 주세요';
        if (error instanceof GoogleError && /만료|허용/.test(error.message)) this.forgetGoogleToken();
      }
    } finally {
      if (epoch === this.subscriptionsEpoch) this.calendarBusy = false;
    }
  }

  /** 연결만 끊는다. 구글에 만든 캘린더와 일정은 사용자가 구글 캘린더에서 직접 지운다. */
  async disconnectCalendar(): Promise<void> {
    const userId = this.authUserId, epoch = this.subscriptionsEpoch;
    if (!authClient || !userId || this.calendarBusy) return;
    this.calendarBusy = true; this.calendarError = ''; this.calendarMessage = '';
    try {
      // 서버에 맡긴 구글 열쇠도 함께 지운다. 그러면 서버는 더 이상 이 캘린더를 건드리지 않는다.
      const stopped = await authClient.from('user_google_tokens').delete().eq('user_id', userId);
      if (stopped.error) throw stopped.error;
      const { error } = await authClient.from('user_calendar').delete().eq('user_id', userId);
      if (error) throw error;
      this.forgetGoogleToken();
      if (epoch === this.subscriptionsEpoch) { this.calendarId = null; this.calendarSyncedAt = null; this.calendarAuto = { active: false, error: null, lastRunAt: null }; this.recordCalendar(userId, epoch); this.calendarMessage = '연결을 끊었어요. 구글 캘린더의 "성대 공지"는 직접 지워 주세요'; }
    } catch {
      if (epoch === this.subscriptionsEpoch) this.calendarError = '연결을 끊지 못했어요. 잠시 뒤 다시 눌러 주세요';
    } finally {
      if (epoch === this.subscriptionsEpoch) this.calendarBusy = false;
    }
  }

  /** 계정과 모든 정보를 지우고 이 기기에서도 로그아웃한다. 화면에서 두 번 확인한 뒤에만 부른다. */
  /** 앱 안 문의를 보낸다. 화면(설정의 문의하기)이 결과를 문구로 바꿔 보여 준다. */
  sendFeedback(kind: FeedbackKind, body: string, email: string): Promise<FeedbackResult> { return sendFeedback(authClient, kind, body, email); }
  async listBoardRequests(userId: string) {
    const epoch = this.subscriptionsEpoch;
    const rows = await listBoardRequests(authClient, userId);
    if (epoch !== this.subscriptionsEpoch || userId !== this.authUserId) return null;
    const unseen = rows?.filter((row) => row.status === 'added' && row.source_id && !this.seenAddedBoardRequests.has(`${userId}:${row.id}`)) ?? [];
    if (unseen.length) {
      const feed = await fetchJson<NoticesFile>('notices.json');
      if (epoch !== this.subscriptionsEpoch || userId !== this.authUserId) return null;
      if (feed) this.sources = feed.sources;
      await this.refreshSubscriptions(userId, epoch);
      if (epoch !== this.subscriptionsEpoch || userId !== this.authUserId) return null;
      unseen.forEach((row) => this.seenAddedBoardRequests.add(`${userId}:${row.id}`));
    }
    return rows;
  }
  submitBoardRequest(userId: string, name: string, url: string) { return submitBoardRequest(authClient, userId, name, url); }

  async deleteAccount(): Promise<void> {
    const userId = this.authUserId, requestedEpoch = this.subscriptionsEpoch;
    if (!authClient || !userId || this.accountBusy) return;
    this.accountBusy = true; this.accountError = '';
    try {
      await deleteMyAccount(authClient);
      if (!this.isCurrentAccount(userId, requestedEpoch)) return;
      const epoch = this.advanceAccountEpoch();
      const isCurrent = () => this.isCurrentAccount(userId, epoch);
      await Promise.all([clearListCache(userId), clearSettingsCache(userId), clearDetailCache(userId)]);
      await releaseInbox(userId, { isCurrent });
      await this.releasePush(userId, isCurrent);
      if (!isCurrent()) return;
      await authClient.auth.signOut({ scope: 'local' }).catch(() => undefined);
      this.showToast('계정과 저장된 정보를 모두 지웠어요');
    } catch (error) {
      this.accountError = error instanceof Error && /[가-힣]/.test(error.message) ? error.message : '계정을 지우지 못했어요. 잠시 뒤 다시 눌러 주세요.';
    } finally {
      this.accountBusy = false;
    }
  }

  async registerAi(provider: AiProvider, apiKey: string, model?: string): Promise<void> {
    const userId = this.authUserId, epoch = this.subscriptionsEpoch;
    if (!authClient || !userId || this.aiBusy || !AI_PROVIDERS.includes(provider)) return;
    this.aiBusy = true; this.aiError = '';
    try {
      await registerAiKey(authClient, provider, apiKey, model);
      const keys = await loadAiKeyStatuses(authClient, userId, true);
      if (this.isCurrentAccount(userId, epoch)) {
        this.aiKeys = keys;
        this.recordAiSettings(userId, epoch);
      }
    } catch (error) {
      if (epoch === this.subscriptionsEpoch) this.aiError = error instanceof Error ? error.message : '키를 저장하지 못했어요.';
    } finally {
      if (epoch === this.subscriptionsEpoch) this.aiBusy = false;
    }
  }

  async removeAi(provider: AiProvider): Promise<void> {
    const userId = this.authUserId, epoch = this.subscriptionsEpoch;
    if (!authClient || !userId || this.aiBusy) return;
    this.aiBusy = true; this.aiError = '';
    try {
      await removeAiKey(authClient, provider);
      if (this.isCurrentAccount(userId, epoch)) {
        this.aiKeys = this.aiKeys.filter((key) => key.provider !== provider);
        this.recordAiSettings(userId, epoch);
      }
    } catch (error) {
      if (epoch === this.subscriptionsEpoch) this.aiError = error instanceof Error ? error.message : '키를 지우지 못했어요.';
    } finally {
      if (epoch === this.subscriptionsEpoch) this.aiBusy = false;
    }
  }

  async updateAiPrefs(next: AiPreferences): Promise<void> {
    const userId = this.authUserId, epoch = this.subscriptionsEpoch;
    if (!authClient || !userId || this.aiBusy) return;
    this.aiBusy = true; this.aiError = '';
    try {
      await saveAiPreferences(authClient, userId, next);
      if (this.isCurrentAccount(userId, epoch)) {
        this.aiPrefs = next;
        this.recordAiSettings(userId, epoch);
      }
    } catch (error) {
      if (epoch === this.subscriptionsEpoch) this.aiError = error instanceof Error ? error.message : 'AI 설정을 저장하지 못했어요.';
    } finally {
      if (epoch === this.subscriptionsEpoch) this.aiBusy = false;
    }
  }

  async removeKey(): Promise<void> {
    const userId = this.authUserId, epoch = this.subscriptionsEpoch;
    if (!authClient || !userId || this.byokBusy) return;
    this.byokBusy = true; this.byokError = '';
    try {
      await removeByokKey(authClient);
      if (epoch === this.subscriptionsEpoch) { this.byokStatus = null; this.byokBackfill = 0; this.recordAiSettings(userId, epoch); }
      if (this.byokPoll) { clearTimeout(this.byokPoll); this.byokPoll = null; }
    } catch (error) {
      if (epoch === this.subscriptionsEpoch) this.byokError = error instanceof Error ? error.message : '키를 지우지 못했어요.';
    } finally {
      if (epoch === this.subscriptionsEpoch) this.byokBusy = false;
    }
  }

  async saveProfile(profile: UserProfile): Promise<void> {
    const userId = this.authUserId, epoch = this.subscriptionsEpoch;
    if (!authClient || !userId || this.byokBusy) return;
    this.byokBusy = true; this.byokError = ''; this.profileMessage = ''; this.profileError = '';
    try {
      await storeProfile(authClient, userId, profile);
      if (epoch === this.subscriptionsEpoch) { this.profile = profile; this.recordSetting(userId, epoch, 'profile', profile); this.profileMessage = '저장했어요.'; }
    } catch (error) {
      if (epoch === this.subscriptionsEpoch) this.profileError = error instanceof Error && /[가-힣]/.test(error.message) ? error.message : '저장하지 못했어요. 잠시 뒤 다시 시도해 주세요.';
    } finally {
      if (epoch === this.subscriptionsEpoch) this.byokBusy = false;
    }
  }

  private isCurrentAccount(userId: string | null, epoch: number): boolean {
    return this.authUserId === userId && this.subscriptionsEpoch === epoch;
  }

  async releasePush(userId: string, isCurrent: () => boolean): Promise<void> {
    try {
      if (!isCurrent()) return;
      const registration = this.pushRegistration ?? await navigator.serviceWorker?.getRegistration() ?? null;
      if (registration) await releaseDevicePush(userId, registration, localStorage, isCurrent);
    } catch { /* 다음 로그인에서 소유자 표시로 다시 정리한다 */ }
  }

  async refreshPush(userId: string, epoch: number): Promise<void> {
    if (!authClient) return;
    const isCurrent = () => this.isCurrentAccount(userId, epoch);
    const supported = isSecureContext && 'Notification' in window && 'serviceWorker' in navigator && 'PushManager' in window;
    if (!supported) { this.setCheckedPush(userId, epoch, 'unsupported'); return; }
    try {
      // 서비스 워커가 끝내 준비되지 않으면(바꿔 끼우는 중 등) "확인하고 있어요"에 멈추지 않게 끊는다.
      const ready = new Promise<ServiceWorkerRegistration>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('timeout')), 10_000);
        void navigator.serviceWorker.ready.then((value) => { clearTimeout(timer); resolve(value); });
      });
      const [registration, config] = await Promise.all([
        ready,
        withTimeout(fetch(new URL('push-config.json', document.baseURI), { cache: 'no-store' }).then((r) => r.ok ? r.json() as Promise<{ vapidPublicKey?: string }> : null), PUSH_CHECK_MS).catch(() => null),
      ]);
      if (!isCurrent()) return;
      this.pushRegistration = registration;
      this.pushVapidKey = config?.vapidPublicKey ?? null;
      // 켜 둔 기기인데 앱 업데이트 등으로 브라우저가 구독을 잃었으면 여기서 조용히 다시 등록한다.
      // 서버 조회가 응답하지 않아도 "확인하고 있어요"에 멈추지 않게 끊는다(첫 설정 알림 단계가 이 상태를 기다린다).
      const on = await withTimeout(inspectDevicePush(authClient, userId, registration, localStorage,
        { vapidKey: this.pushVapidKey, permission: Notification.permission }, isCurrent), PUSH_CHECK_MS);
      if (!isCurrent()) return;
      this.setCheckedPush(userId, epoch, on ? 'on' : Notification.permission === 'denied' ? 'denied' : 'off');
    } catch (error) {
      if (isCurrent()) {
        this.pushStatus = Notification.permission === 'denied' ? 'denied' : 'off';
        this.pushError = error instanceof Error && /[가-힣]/.test(error.message) ? error.message : '알림 상태를 확인하지 못했어요. 잠시 뒤 다시 시도해 주세요.';
      }
    }
  }

  // 클릭 핸들러에서 직접 불린다. 첫 await가 권한 요청이어야 브라우저가 사용자 동작으로 인정한다.
  // 실패하면 체인을 남겨 두어 "다시 시도"가 끝난 단계는 건너뛰고 실패한 단계부터 이어 가게 한다.
  async enablePush(): Promise<void> {
    const userId = this.authUserId, epoch = this.subscriptionsEpoch, registration = this.pushRegistration;
    if (!authClient || !userId || this.pushStatus !== 'off') return;
    if (!registration || !this.pushVapidKey) { this.pushError = '알림 설정을 아직 불러오지 못했어요. 잠시 뒤 다시 시도해 주세요.'; return; }
    const isCurrent = () => this.isCurrentAccount(userId, epoch);
    if (!this.pushChain || this.pushChain.userId !== userId || this.pushChain.epoch !== epoch) {
      this.pushChain = { chain: createEnableChain(authClient, userId, registration, localStorage, this.pushVapidKey,
        // 이미 허용했으면 묻지 않는다. 일부 브라우저는 허용된 상태에서 다시 물으면 답하지 않는다.
        () => Notification.permission === 'granted' ? Promise.resolve('granted' as NotificationPermission) : Notification.requestPermission(),
        undefined, isCurrent), userId, epoch };
    }
    const current = this.pushChain;
    this.pushStatus = 'busy'; this.pushError = '';
    try {
      await current.chain.run();
      if (isCurrent()) { this.setCheckedPush(userId, epoch, 'on'); this.pushRetry = false; }
      if (this.pushChain === current) this.pushChain = null;
    } catch (error) {
      if (isCurrent()) {
        const denied = Notification.permission === 'denied';
        this.pushStatus = denied ? 'denied' : 'off';
        this.pushRetry = !denied;
        if (denied && this.pushChain === current) { this.pushChain = null; void current.chain.discard(); }
        this.pushError = error instanceof Error && /[가-힣]/.test(error.message) ? error.message : '알림을 켜지 못했어요';
        if (!denied) this.watchPermission(userId, epoch);
        pushNote(`failed ${error instanceof Error ? `${error.name}:${error.message.slice(0, 40)}` : String(error)}`);
      }
    }
  }

  /** 브라우저 설정에서 허용한 뒤 다시 확인한다. 허용돼 있으면 이어서 켠다. */
  async recheckPush(): Promise<void> {
    const userId = this.authUserId;
    if (!userId || typeof Notification === 'undefined') return;
    if (Notification.permission === 'denied') { this.pushError = '아직 허용되지 않았어요. 브라우저 설정에서 알림을 허용해 주세요.'; return; }
    this.pushError = '';
    const epoch = this.subscriptionsEpoch;
    await this.refreshPush(userId, epoch);
    // 기다리는 사이 계정이 바뀌었으면 이전 계정의 누름을 새 계정에 적용하지 않는다.
    if (this.authUserId !== userId || epoch !== this.subscriptionsEpoch) return;
    if (this.pushStatus === 'off') await this.enablePush();
  }

  /** 알림 켜기 실패 진단을 문의(버그)로 보낸다. 사용자가 단추를 누를 때만 보낸다. */
  async sendPushReport(): Promise<void> {
    const registration = this.pushRegistration ?? await navigator.serviceWorker?.getRegistration().catch(() => undefined) ?? null;
    const body = await pushReport(registration, __APP_VERSION__);
    const result = await sendFeedback(authClient, 'bug', body, '');
    this.showToast(result === 'ok' ? '진단 정보를 보냈어요' : result === 'limit' ? '오늘은 더 보낼 수 없어요' : '보내지 못했어요. 잠시 뒤 다시 눌러 주세요');
  }

  // 허용 창을 늦게 누르거나(조용한 요청), 브라우저 사이트 설정에서 허용하면 권한이 나중에 바뀐다. 그때 누르기를 다시 요구하지 않고 이어서 켠다.
  // 크롬 개발자 블로그(안드로이드 알림 요청)가 권하는 방식: permissions.query의 change에서 granted면 구독한다.
  private permissionWatch: PermissionStatus | null = null;
  watchPermission(userId: string, epoch: number): void {
    if (this.permissionWatch || !navigator.permissions?.query) return;
    void navigator.permissions.query({ name: 'notifications' }).then((status) => {
      this.permissionWatch = status;
      status.onchange = () => {
        if (status.state !== 'granted') return;
        status.onchange = null; this.permissionWatch = null;
        if (epoch === this.subscriptionsEpoch && this.authUserId === userId && this.pushStatus === 'off' && this.pushChain) void this.enablePush();
      };
    }).catch(() => { /* 권한 상태를 볼 수 없는 브라우저는 다시 누르기로 이어 간다 */ });
  }

  async disablePush(): Promise<void> {
    const userId = this.authUserId, epoch = this.subscriptionsEpoch, registration = this.pushRegistration;
    if (!authClient || !userId || !registration || this.pushStatus !== 'on') return;
    this.pushStatus = 'busy'; this.pushError = '';
    try {
      const cleaned = await disableDevicePush(authClient, userId, registration, localStorage, () => this.isCurrentAccount(userId, epoch));
      if (epoch === this.subscriptionsEpoch) {
        this.setCheckedPush(userId, epoch, 'off');
        if (!cleaned) this.pushError = '이 기기의 알림은 껐지만 서버 정리는 끝나지 않았어요. 다시 확인해 주세요.';
      }
    } catch (error) {
      if (epoch === this.subscriptionsEpoch) {
        this.pushStatus = 'on';
        this.pushError = error instanceof Error && /[가-힣]/.test(error.message) ? error.message : '알림을 끄지 못했어요. 잠시 뒤 다시 시도해 주세요.';
      }
    }
  }

  /** 원본처럼 추가와 삭제가 바로 적용된다. 계정에는 순서대로 저장하고, 실패하면 다시 바꿀 때 또 저장한다. */
  addKeyword(input: string) {
    const word = input.trim().replace(/\s+/g, ' ');
    if (!word || this.keywords.includes(word)) return;
    this.updateKeywords([...this.keywords, word]);
  }

  removeKeyword(word: string) { this.updateKeywords(this.keywords.filter((item) => item !== word)); }

  updateKeywords(next: string[]) {
    let words: string[];
    try { words = parseKeywords(next.join('\n')); }
    catch (error) { this.keywordNote = error instanceof Error ? error.message : '키워드를 확인해 주세요.'; return; }
    this.setKeywords(words);
    const userId = this.authUserId, epoch = this.subscriptionsEpoch;
    if (!authClient || !userId) { this.keywordNote = ''; return; }
    const client = authClient;
    this.keywordNote = '저장하고 있어요';
    this.keywordWrite = this.keywordWrite.then(async () => {
      if (epoch !== this.subscriptionsEpoch || this.authUserId !== userId || !(await sessionIs(client, userId))) return;
      try {
        // 연달아 바꿨다면 가장 최근 목록 하나만 저장한다.
        const words = this.keywords;
        await saveKeywordsPreference(client, userId, words);
        if (this.isCurrentAccount(userId, epoch)) {
          this.keywordNote = '계정에 저장했어요';
          this.recordSetting(userId, epoch, 'keywords', words);
        }
      } catch {
        if (epoch === this.subscriptionsEpoch) this.keywordNote = '저장하지 못했어요. 다시 바꾸면 또 저장해요';
      }
    });
  }

  async saveKeywords(input: string): Promise<void> {
    const userId = this.authUserId;
    const epoch = this.subscriptionsEpoch;
    if (!authClient || !userId || this.preferencesLoading || this.preferencesUnavailable) return;
    let keywords: string[];
    try { keywords = parseKeywords(input); }
    catch (error) { this.preferencesError = error instanceof Error ? error.message : '키워드를 확인해 주세요.'; return; }
    this.preferencesLoading = true;
    this.preferencesError = '';
    try {
      await saveKeywordsPreference(authClient, userId, keywords);
      if (epoch === this.subscriptionsEpoch) {
        this.keywords = keywords;
        remember('keywords', JSON.stringify(keywords));
        if (this.keyword && !keywords.includes(this.keyword)) this.keyword = null;
        this.recordSetting(userId, epoch, 'keywords', keywords);
        this.showToast('키워드를 저장했어요');
      }
    } catch {
      if (epoch === this.subscriptionsEpoch) this.preferencesError = '키워드를 저장하지 못했어요. 다시 시도해 주세요.';
    } finally {
      if (epoch === this.subscriptionsEpoch) this.preferencesLoading = false;
    }
  }

  async refreshSubscriptions(userId: string, epoch: number): Promise<void> {
    if (!authClient) return;
    try {
      const sources = await loadSubscriptions(authClient, userId);
      if (this.isCurrentAccount(userId, epoch)) {
        this.subscriptions = sources;
        this.recordSetting(userId, epoch, 'subscriptions', sources);
      }
    } catch {
      if (epoch === this.subscriptionsEpoch) this.subscriptionsError = '구독을 불러오지 못했어요. 다시 시도해 주세요.';
    } finally {
      if (epoch === this.subscriptionsEpoch) this.subscriptionsLoading = false;
    }
  }

  async toggleSubscription(sourceId: string, enabled: boolean): Promise<boolean> {
    const userId = this.authUserId;
    const epoch = this.subscriptionsEpoch;
    if (!authClient || !userId || this.subscriptionsLoading) return false;
    this.subscriptionsLoading = true;
    this.subscriptionsError = '';
    try {
      await setSubscription(authClient, userId, sourceId, enabled);
      if (!this.isCurrentAccount(userId, epoch)) return false;
      this.subscriptions = enabled ? [...new Set([...this.subscriptions, sourceId])] : this.subscriptions.filter((id) => id !== sourceId);
      this.recordSetting(userId, epoch, 'subscriptions', this.subscriptions);
      return true;
    } catch {
      if (this.isCurrentAccount(userId, epoch)) this.subscriptionsError = '구독을 저장하지 못했어요. 다시 시도해 주세요.';
      return false;
    } finally {
      if (this.isCurrentAccount(userId, epoch)) this.subscriptionsLoading = false;
    }
  }

  showsShareSubscription(notice: Notice): boolean {
    return !!this.authUserId && this.sharedDetail === notice.id && this.kindOf(notice) === 'all'
      && this.hasKnownSubscriptions() && !this.subscriptions.includes(notice.source_id);
  }

  async subscribeFromShare(notice: Notice): Promise<void> {
    const userId = this.authUserId, epoch = this.subscriptionsEpoch;
    if (!authClient || !userId || this.subscriptionsLoading || !this.showsShareSubscription(notice)) return;
    const current = () => this.isCurrentAccount(userId, epoch);
    const saved = await this.toggleSubscription(notice.source_id, true);
    if (!current()) return;
    if (!saved) {
      this.showToast(this.subscriptionsError);
      return;
    }

    if (this.sharedDetail === notice.id) this.subscribedShareId = notice.id;
    await this.refresh();
    if (!current() || !this.subscriptions.includes(notice.source_id) || this.notices.some((item) => item.id === notice.id)) return;
    const rows = await loadSavedNoticeDetails(authClient, [notice.id], current).catch(() => []);
    if (!current() || !this.subscriptions.includes(notice.source_id) || this.notices.some((item) => item.id === notice.id)) return;
    const row = rows.find((item) => item.id === notice.id && !isExpired(item, this.sources.find((source) => source.id === item.source_id)));
    if (row) this.notices = [...this.notices, row];
  }

  /**
   * 사이드바와 게시판 선택에 보일 게시판. 학교 공지 탭에서는 로그인한 사람이 구독한 게시판(처음 설정을 마쳤다면 전공에 맞춰 추천된 것)만 보이고,
   * 구독이 없거나 로그인 전이면 지금 공지가 있는 기본 게시판만 보인다. 전체 게시판 목록의 수십 개 학과 게시판이 한꺼번에 나열되지 않게 한다.
   */
  tabSources(): Source[] {
    const tab = this.tab();
    if (tab === 'saved') {
      const savedSources = new Set(this.savedNotices().map((notice) => notice.source_id));
      return applyBoardOrder(this.sources.filter((source) => savedSources.has(source.id)), this.boardOrder);
    }
    if (tab === 'coop') return this.sources.filter((s) => s.coop === true);
    if (tab === 'intern') return this.sources.filter((s) => s.external === true && !s.coop);
    return applyBoardOrder(this.schoolSources(), this.boardOrder);
  }

  private hasKnownSubscriptions(): boolean {
    return this.cacheReady || this.liveSettings.has('subscriptions') || (!this.subscriptionsLoading && !this.subscriptionsError);
  }

  /** 로그인했고 받을 게시판을 아직 하나도 고르지 않았는지(불러오는 중이거나 불러오지 못한 때는 아니다). 첫 설정을 건너뛴 사람이 여기에 해당한다. */
  noBoards(): boolean {
    return !!this.authUserId && this.hasKnownSubscriptions() && this.subscriptions.length === 0;
  }

  /** 학교 게시판 중 사이드바에 보일 것(순서 적용 전, 서버 목록 순서). */
  schoolSources(cachedSubscriptions?: string[]): Source[] {
    const all = this.sources.filter((s) => !s.external);
    // 로그인했고 받을 게시판을 하나도 안 골랐으면 게시판 목록은 비어 있다(공지가 있다고 대신 보여 주지 않는다).
    if (cachedSubscriptions ? cachedSubscriptions.length === 0 : this.noBoards()) return [];
    const subscriptions = cachedSubscriptions ?? this.subscriptions;
    const subscribed = this.authUserId && (cachedSubscriptions || this.hasKnownSubscriptions()) && subscriptions.length > 0;
    const withNotices = new Set(this.notices.map((n) => n.source_id));
    const chosen = all.filter((s) => (subscribed ? subscriptions.includes(s.id) : withNotices.has(s.id)));
    // 지금 보고 있는 게시판은 목록에서 사라지지 않게 한다.
    const current = all.filter((s) => s.id === this.board && !chosen.includes(s));
    return [...chosen, ...current];
  }

  // 고른 게시판이 지금 탭에 없으면 모든 게시판으로 본다(탭을 오가도 빈 목록이 되지 않게).
  activeBoard(): string { return this.tabSources().some((s) => s.id === this.board) ? this.board : 'all'; }

  /** 로그인해 받을 게시판을 고른 사람은 고른 게시판의 학교 공지만 목록에 나온다(전체 보기에서도 고르지 않은 게시판 공지가 섞이지 않게). */
  inChosenBoards(notice: Notice): boolean {
    if (!this.authUserId || !this.hasKnownSubscriptions() || this.subscriptions.length === 0) return true;
    return this.subscriptions.includes(notice.source_id);
  }

  isExternal(notice: Notice): boolean {
    return this.sources.find((s) => s.id === notice.source_id)?.external ?? (this.deepNotice?.notice.id === notice.id && this.deepNotice.external);
  }
  /** 공지가 속한 보기: 성대 공지(all), 인턴 공고(intern), 현장실습(coop). */
  kindOf(notice: Notice): 'all' | 'intern' | 'coop' {
    return noticeKind(this.sources.find((s) => s.id === notice.source_id)
      ?? (this.deepNotice?.notice.source_id === notice.source_id ? { external: this.deepNotice.external, coop: this.deepNotice.coop } : undefined));
  }

  byTab(list: Notice[], tab: Tab, allKinds = false): Notice[] {
    if (tab === 'saved') return list;
    // AI 판정을 기다리는 공지는 끝날 때까지 목록에 두지 않는다(열어 둔 글은 남긴다).
    return this.scopeTab(list, tab, allKinds).filter((n) => !this.isWaiting(n));
  }

  /** 왼쪽 메뉴의 탭 숫자. 지금 보고 있는 탭은 고른 게시판·키워드·기관 구분이 걸린 지금 목록의 개수(눈에 보이는 개수),
   *  보고 있지 않은 탭은 그 탭의 전체(모든 게시판, 현장실습은 모든 기관) 개수다. */
  tabCount(tab: Tab): number {
    const current = tab === this.tab();
    if (tab === 'saved') return this.savedConditions(this.filtered(this.savedNotices(), !current), !current).length;
    return this.byTab(this.filtered(this.notices, !current), tab, !current).length;
  }

  /** 다른 탭과 같은 거르기(읽지 않은 공지만, 인턴십 충족만)를 저장 목록에도 건다. 읽고 있는 글은 남긴다. */
  private savedConditions(list: Notice[], ignore = false): Notice[] {
    if (ignore) return list;
    return list
      .filter((n) => !this.unreadOnly || !this.isRead(n) || this.keepReading(n.id))
      .filter((n) => !this.graduationOnly || !this.gradEnabled() || this.gradPartsFor(n, this.judgement(n)?.ai?.verdict).some((part) => part.met) || this.keepReading(n.id));
  }

  private scopeTab(list: Notice[], tab: Tab, allKinds = false): Notice[] {
    const external = tab !== 'all';
    // 출처: https://freshrss.github.io/FreshRSS/en/users/10_filter.html (읽음 상태 필터)
    // 읽고 있는 글은 상세를 닫거나 다른 글로 옮길 때까지 남긴다.
    const scoped = list.filter((n) => !n.deadline || !deadlinePassed(n.deadline))
      .filter((n) => this.kindOf(n) === tab)
      .filter((n) => allKinds || tab !== 'coop' || this.activeCoopKind() === 'all' || coopKindOf(n) === this.activeCoopKind())
      .filter(() => external || !this.noBoards())
      .filter((n) => external || this.inChosenBoards(n) || this.keepReading(n.id));
    // 같은 공지가 여러 게시판에 올라오면 가장 먼저 감지된 글만 보여 준다. 읽고 있는 글은 남긴다.
    const firstSeen = new Set(dropDuplicates(scoped).map((n) => n.id));
    const unique = scoped.filter((n) => firstSeen.has(n.id) || this.keepReading(n.id));
    const shown = unique
      .filter((n) => !this.unreadOnly || !this.isRead(n) || this.keepReading(n.id))
      .filter((n) => !this.graduationOnly || !this.gradEnabled() || this.gradPartsFor(n, this.judgement(n)?.ai?.verdict).some((part) => part.met) || this.keepReading(n.id));
    return orderNotices(shown, this.sortFor(tab) as Sort);
  }

  sortFor(tab: Tab): SavedSort { return tab === 'saved' ? (this.savedSort === 'custom' && !this.savedOrder.length ? 'latest' : this.savedSort) : tab === 'intern' ? this.internSort : tab === 'coop' ? this.coopSort : this.sort; }

  private decorated(items: Notice[]): Notice[] {
    return items.map((notice) => {
      const translated = this.myTranslations.get(notice.id);
      return withMyDeadline(translated ? { ...notice, title_ko: translated.title } : notice, this.myDeadlines.get(notice.id) ?? null);
    });
  }

  tab(): Tab { return this.view === 'settings' ? this.listTab : this.view; }

  /** 접수 중인 현장실습이 하나라도 있는지. 기한이 지난 공지는 refresh()에서 이미 빠져 있다. */
  hasCoop(): boolean { return this.notices.some((notice) => this.kindOf(notice) === 'coop'); }

  /** 메뉴에 보일 탭. 현장실습은 모두 마감되면 메뉴에서 숨긴다(사용자 결정 2026-11-13). 단축키 번호는 TABS 순서 그대로다. */
  shownTabs(): typeof TABS {
    // 공지를 받기 전에는 마지막으로 본 상태(이 기기에 기억)로 그린다. 받은 뒤에 탭이 생기거나 사라지면 메뉴 아래가 밀린다.
    const coop = this.notices.length || !this.loading ? this.hasCoop() : remember('has-coop') !== '0';
    return TABS.filter((t) => t.id !== 'coop' || coop);
  }
  visible(): Notice[] {
    const decorate = (items: Notice[]) => this.decorated(items);
    if (this.tab() === 'saved') {
      // 같은 공지의 사본을 따로 저장해 두었어도 한 번만 보여 준다(저장한 목록 안에서만 거르므로 하나만 저장한 공지는 그대로다)
      const saved = this.savedConditions(this.filtered(decorate(this.savedNotices())));
      const firstSeen = new Set(dropDuplicates(saved).map((n) => n.id));
      const unique = saved.filter((n) => firstSeen.has(n.id) || this.keepReading(n.id));
      return this.opportunityFilter === 'all' || this.opportunitiesStatus !== 'ready' ? unique : unique.filter((n) => this.statusOf(n) === this.opportunityFilter);
    }
    return this.byTab(this.filtered(decorate(this.notices)), this.tab());
  }

  setView(view: View) {
    this.closeInbox();
    const entering = view === 'settings' && this.view !== 'settings';
    this.selecting = false; this.selectedReads = [];
    this.sharedDetail = null;
    this.view = view;
    if (entering || view !== 'settings') this.settingsSection = null;
    if (view !== 'settings') this.listTab = view;
    this.openedId = null;
    this.boardMenuOpen = false;
    this.sortMenuOpen = false;
    this.statusMenuOpen = false;
    this.reordering = false;
    if (view !== 'settings') remember('tab', view);
    // 주소도 보기와 맞춘다. 설정은 기록에 쌓아 뒤로 가기로 닫히고, 탭은 바꿔 써서 새로고침해도 같은 보기가 열린다.
    if (entering) history.pushState({ view: 'settings', depth: 1 }, '', this.settingsUrl(null));
    else if (view !== 'settings') history.replaceState(null, '', `${location.pathname}?tab=${view}`);
    this.selectedId = null;
    // 탭을 옮기면 상세 칸은 닫고 목록만 보여 준다(첫 공지가 저절로 열려 읽은 글로 오해되지 않게). 사용자가 정해 둔 열림 설정은 그대로 두고 이번만 닫는다.
    if (view !== 'settings') this.detailOpen = false;
    window.scrollTo({ top: 0 });
    qsel('.list-pane')?.scrollTo({ top: 0 });
  }

  /** 보기 탭을 직접 고르면 이전 목록 조건을 지우고 해당 보기의 전체를 보여 준다. */
  openTab(tab: Tab) {
    this.clearDeepLink();
    this.query = ''; this.keyword = null;
    this.board = 'all'; this.coopKind = 'all';
    this.unreadOnly = false; this.graduationOnly = false;
    remember('board', 'all'); remember('coop-kind', 'all');
    remember('view-unread', '0'); remember('view-grad', '0');
    this.setView(tab);
  }

  /** 설정 첫 쪽을 거치지 않고 하위 쪽으로 바로 들어왔는지. 이때 X는 설정을 닫는다. */
  get settingsLeavesDirectly(): boolean {
    return history.state?.direct === true;
  }

  /** 설정 쪽 이동으로 쌓은 기록의 칸 수. 설정을 한 번에 닫을 때 그만큼 되돌린다. 바로 설정 주소로 들어왔으면 0이다. */
  private settingsDepth(): number {
    return history.state?.view === 'settings' ? Number(history.state.depth) || 1 : 0;
  }

  private settingsUrl(section: string | null): string {
    const query = section === 'keys' ? '?view=settings&keys=1' : section ? `?view=settings&section=${section}` : '?view=settings';
    return `${location.pathname}${query}`;
  }

  /** 설정의 하위 쪽을 연다. 주소도 원본과 같게 바꿔서 뒤로 가기와 새로고침이 그대로 동작한다. null이면 한 단계 위(첫 쪽)로 간다. */
  openSettingsSection(section: string | null) {
    if (section === null) { this.backSettings(); return; }
    history.pushState({ view: 'settings', depth: this.settingsDepth() + 1 }, '', this.settingsUrl(section));
    this.settingsSection = section;
    window.scrollTo({ top: 0 });
  }

  /** 사이드바의 "설정": 다른 화면이면 설정 첫 쪽을 열고, 설정의 하위 쪽이면 첫 쪽으로 돌아온다. 첫 쪽이면 그대로 둔다. */
  openSettingsHome = () => {
    if (this.view !== 'settings') { this.setView('settings'); return; }
    if (!this.settingsSection || this.returningToSettingsHome) return;
    const depth = this.settingsDepth();
    if (depth > 1) {
      this.returningToSettingsHome = true;
      history.go(1 - depth);
      return;
    }
    this.replaceWithSettingsHome();
  };

  private replaceWithSettingsHome() {
    // 주소로 바로 들어온 경우 X는 이전 브라우저 기록 대신 공지 목록을 연다.
    const state = this.settingsDepth() > 0 ? { view: 'settings', depth: 1 } : null;
    history.replaceState(state, '', this.settingsUrl(null));
    this.settingsSection = null;
    window.scrollTo({ top: 0 });
    qsel('.list-pane')?.scrollTo({ top: 0 });
  }

  /** 어느 화면에서든 설정의 해당 쪽으로 바로 간다(키워드 관리하기, 게시판 고르기 같은 단축). */
  openSettings(section: string | null) {
    if (section === 'inbox') void this.refreshInbox();
    if (this.view === 'settings') {
      if (!section) { this.openSettingsSection(section); return; }
      // 설정 안에서 왼쪽 바로가기를 눌러도 X 한 번에 설정에 들어오기 전 화면으로 나간다(사용자 요청 2026-11-09).
      history.pushState({ view: 'settings', depth: this.settingsDepth() + 1, direct: true }, '', this.settingsUrl(section));
      this.settingsSection = section;
      window.scrollTo({ top: 0 });
      this.revealBoards(section);
      return;
    }
    this.setView('settings');
    if (section) {
      // direct: 설정 첫 쪽을 거치지 않고 바로 들어왔다. 이때 X와 뒤로 가기는 첫 쪽이 아니라 원래 보던 곳으로 나간다.
      history.replaceState({ view: 'settings', depth: 1, direct: true }, '', this.settingsUrl(section));
      this.settingsSection = section;
      this.revealBoards(section);
    }
  }

  /** "게시판 더 고르기"를 누르면 접힌 게시판 목록을 펼치고 그 자리로 스크롤한다. 화면이 그려질 때까지 잠깐 기다린다. */
  private revealBoards(section: string | null) {
    if (section !== 'notifications') return;
    let tries = 0;
    const run = () => {
      const details = document.querySelector<HTMLDetailsElement>('details.board-more-list');
      if (details) { details.open = true; details.scrollIntoView({ block: 'start' }); return; }
      if (++tries < 30) requestAnimationFrame(run);
    };
    requestAnimationFrame(run);
  }

  /** 뒤로 가기 화살표와 "설정으로": 하위 쪽에서는 첫 쪽으로 한 단계, 첫 쪽에서는 설정을 닫는다. */
  backSettings = () => {
    if (!this.settingsSection) { this.closeSettings(); return; }
    if (history.state?.direct) { this.closeSettings(); return; }
    if (this.settingsDepth() > 1) { history.back(); return; }
    this.replaceWithSettingsHome();
  };

  // 알림함. 소유자를 적고(남의 항목은 같은 트랜잭션에서 지운다) 읽는다. 로그아웃이면 이전 계정의 보관분만 지운다.
  // 소유자의 푸시 주소(endpoint)는 이 계정으로 기기를 서버에 등록한 직후 platform-browser-push가 따로 적는다. 그 전에는 워커가 저장하지 않는다.
  private syncInboxOwner(userId: string | null, previousUserId: string | null) {
    this.closeInbox();
    this.inboxItems = []; ++this.inboxSeq;
    const epoch = this.subscriptionsEpoch;
    const isCurrent = () => this.isCurrentAccount(userId, epoch);
    void (async () => {
      if (userId) await setInboxOwner(userId, undefined, { isCurrent });
      else if (previousUserId) await releaseInbox(previousUserId, { isCurrent });
      else await clearInbox({ isCurrent });
      if (isCurrent()) await this.refreshInbox();
    })();
  }

  async refreshInbox(): Promise<void> {
    const userId = this.authUserId, seq = ++this.inboxSeq;
    await pruneStoredInbox();   // 앱을 켜 둔 채 30일이 지난 항목도 실제로 비운다
    const items = await loadInbox(userId);
    if (seq !== this.inboxSeq || userId !== this.authUserId) return;   // 그 사이 계정이 바뀌었거나 더 새 읽기가 있다
    this.inboxItems = items;
  }

  get inboxUnread(): number { return unreadCount(this.inboxItems); }

  openExploreMap = () => { this.openSettings('explore'); };

  get inboxOpen(): boolean { return !!this.authUserId && this.inboxDialogOwner === this.authUserId; }

  openInbox = () => {
    if (!this.authUserId) return;
    this.inboxDialogOwner = this.authUserId;
    void this.refreshInbox();
  };

  closeInbox = () => { this.inboxDialogOwner = null; };

  async changeInbox(change: InboxChange): Promise<void> {
    const userId = this.authUserId;
    if (!userId) return;
    if (!(await changeInbox(userId, change))) { this.showToast('알림함을 바꾸지 못했어요. 다시 눌러 주세요'); return; }
    await this.refreshInbox();
  }

  /** 항목을 누르면 읽음으로 바꾸고 공지는 앱 안의 그 공지로 연다. 그 밖의 알림은 받을 때 검사한 주소로 간다. */
  openInboxItem(item: InboxItem) {
    void this.changeInbox({ kind: 'read', ids: [item.id] });
    const noticeId = noticeIdOfItem(item);
    if (noticeId) {
      this.inboxOpenId = noticeId;
      this.closeInbox();
      if (this.view === 'settings') this.closeSettings();
      this.handoffInboxOpen();
      return;
    }
    // 받을 때 검사한 주소라도 저장소 값을 그대로 믿지 않고 같은 규칙으로 다시 확인한다.
    const safe = safeInboxUrl(item.url, location.origin);
    if (!safe) { this.showToast('이 알림의 주소를 열 수 없어요'); return; }
    if (new URL(safe).origin === location.origin) {
      this.closeInbox();
      if (this.view === 'settings') this.closeSettings();
    } else window.open(safe, '_blank', 'noopener');
  }

  /** 목록에서 알림함에서 고른 공지를 딥링크로 연다. 설정에서 고르면 먼저 목록으로 돌아온다. */
  private handoffInboxOpen() {
    if (!this.inboxOpenId || this.view === 'settings') return;
    this.deepId = this.inboxOpenId; this.inboxOpenId = null;
  }

  /** 설정을 한 번에 닫고 들어오기 전에 보던 보기로 돌아간다. 첫 쪽의 X와 Esc가 쓴다. */
  closeSettings = () => {
    if (this.closingSettings) return;
    const depth = this.settingsDepth();
    if (depth > 0) { this.closingSettings = true; history.go(-depth); return; }   // 이동이 끝나면 onPopState가 이어서 알림함의 공지를 연다
    const last = normalizeTab(remember('tab'));
    this.setView(isTab(last) ? last : 'all');
  };

  /** X와 Esc: 하위 쪽에서는 한 단계 앞(설정 첫 쪽)으로, 첫 쪽에서는 설정을 나간다. 다시 들어오면 첫 쪽부터 시작한다. */
  leaveSettings = this.backSettings;

  onPopState = () => {
    this.closeInbox();
    this.openedId = typeof history.state?.notice === 'string' ? history.state.notice : null;
    this.boardMenuOpen = false;
    this.sortMenuOpen = false;
    this.statusMenuOpen = false;
    this.settingsSection = settingsSectionFromUrl();
    if (this.returningToSettingsHome) {
      this.returningToSettingsHome = false;
      // 설정 버튼으로 돌아온 첫 기록이 바로가기 하위 쪽이면 홈으로 바꾼다.
      if (this.settingsDepth() === 1 && this.settingsSection) this.replaceWithSettingsHome();
    }
    const shared = typeof history.state?.sharedDetail === 'string' ? history.state.sharedDetail : null;
    if (this.sharedDetail && !shared) {
      this.replaceShareTab(this.tab());
      this.detailOpen = false;
      this.selectedId = null;
    }
    this.sharedDetail = shared;
    const params = new URLSearchParams(location.search);
    if (this.gated) {
      const id = noticeIdFromSearch(location.search);
      if (id !== this.deepId) {
        this.deepId = id; ++this.previewRequest;
        this.preview = { status: 'idle' };
        if (id) void this.loadPreview();
      }
    }
    if (this.closingSettings) {
      this.closingSettings = false;
      if (params.get('view') === 'settings' && this.settingsDepth() === 0) {
        this.closeSettings();
        this.handoffInboxOpen();
        return;
      }
    }
    const view: View = params.get('view') === 'settings' ? 'settings'
      : [normalizeTab(params.get('tab')), normalizeTab(remember('tab'))].find(isTab) ?? 'all';
    const requested = params.get('sort');
    if (params.get('tab') === 'deadline') this.sort = 'deadline';
    else if (requested === 'latest' || requested === 'deadline') {
      if (view === 'intern') this.internSort = requested;
      else if (view === 'coop') this.coopSort = requested;
      else if (view === 'all') this.sort = requested;
    }
    remember('notice-sort', this.sort);
    remember('intern-sort', this.internSort);
    remember('coop-sort', this.coopSort);
    if (view !== this.view) {
      this.view = view; this.selectedId = null; this.selecting = false; this.selectedReads = [];
      if (view !== 'settings') this.listTab = view;
      // 설정에서 나오거나 탭이 바뀌어 돌아올 때도 상세 칸은 닫힌 채로 연다(setView와 같다). 열어 둔 설정은 그대로 두고 이번만 닫는다.
      if (view !== 'settings') this.detailOpen = false;
    }
    if (shared) { this.detailOpen = true; this.selectedId = isNoticeId(shared) ? shared : null; }
    this.handoffInboxOpen();
  };

  /** 목록 조건(보기, 게시판, 키워드, 필터, 정렬)이 바뀌면 상세 칸은 닫힌 채로 새 목록을 보여 준다.
   *  첫 공지가 저절로 열려 읽은 글로 오해되지 않게 하며, 사용자가 정해 둔 열림 설정(remember)은 건드리지 않고 이번만 닫는다. */
  listChanged() {
    this.sharedDetail = null;
    this.selectedId = null;
    this.detailOpen = false;
  }

  /** 지금 접수 중인 현장실습에 있는 기관 구분을 큰 기관부터 차례로. */
  coopKinds(): string[] {
    const present = new Set(this.notices.filter((n) => this.kindOf(n) === 'coop' && (!n.deadline || !deadlinePassed(n.deadline))).map((n) => coopKindOf(n)));
    const order = COOP_KIND_ORDER.filter((kind) => present.has(kind));
    return [...order, ...[...present].filter((kind) => !order.includes(kind)).sort()];
  }
  activeCoopKind(): string { return this.coopKinds().includes(this.coopKind) ? this.coopKind : 'all'; }
  setCoopKind(kind: string) {
    this.coopKind = kind; this.boardMenuOpen = false; this.selectedReads = []; remember('coop-kind', kind);
    this.listChanged();
  }

  setBoard(board: string) {
    this.board = board; this.boardMenuOpen = false; this.selectedReads = []; remember('board', board);
    this.listChanged();
  }
  setKeyword(word: string | null) {
    this.keyword = word;
    this.selectedReads = [];
    this.listChanged();
    if (this.view === 'settings') this.setView('all');
  }

  setKeywords(words: string[]) {
    this.keywords = words;
    remember('keywords', JSON.stringify(words));
    if (this.keyword && !words.includes(this.keyword)) this.keyword = null;
  }

  setTheme(theme: Theme) {
    this.theme = theme;
    remember('theme', theme);
    applyTheme(theme);
  }

  /** 공유·복사하는 주소는 앱 안의 이 공지(원문은 상세의 '원문 열기'). */
  async copyLink(notice: Notice) {
    const url = noticeLink(notice.id, location.href);
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      // 권한이나 보안 연결 문제로 막히면 선택 복사로 한 번 더 시도한다.
      const box = document.createElement('textarea');
      box.value = url; box.setAttribute('readonly', ''); box.style.cssText = 'position:fixed;opacity:0';
      document.body.append(box); box.select();
      const ok = document.execCommand('copy');
      box.remove();
      if (!ok) { this.showToast('복사하지 못했어요. 주소창의 주소를 직접 복사해 주세요'); return; }
    }
    this.linkCopied = true;
    clearTimeout(this.copiedTimer);
    this.copiedTimer = window.setTimeout(() => { this.linkCopied = false; }, 2000);
    this.showToast('링크를 복사했어요');
  }

  // 기기의 공유 창(카카오톡, 메시지, 에어드롭 등)이 있으면 그것으로 보낸다. 없거나 쓸 수 없으면 링크를 복사한다.
  async share(notice: Notice) {
    const data = { title: cleanTitle(notice.title_ko || notice.title), url: noticeLink(notice.id, location.href) };
    if (typeof navigator.share !== 'function' || (navigator.canShare && !navigator.canShare(data))) { await this.copyLink(notice); return; }
    try {
      await navigator.share(data);
    } catch (error) {
      if ((error as DOMException)?.name === 'AbortError') return; // 사용자가 공유 창을 닫은 것
      await this.copyLink(notice);
    }
  }

  showToast(text: string, link: string | null = null, linkLabel = '', duration = 3500) {
    this.toast = text;
    this.toastLink = link;
    this.toastLinkLabel = linkLabel;
    clearTimeout(this.toastTimer);
    if (!link) this.toastTimer = window.setTimeout(() => { this.toast = ''; }, duration);
  }

  async runInstall() {
    if (!this.install) return;
    const prompt = this.install;
    this.install = null;
    window.__skkuInstallPrompt = null;
    await prompt.prompt();
  }

  onKey(event: KeyboardEvent) {
    if (!this.authReady || this.gated || this.inboxOpen) return;
    const target = event.target as Element | null;
    // 첫 로그인 설정 창이 떠 있으면 Esc는 그 창이 처리한다(뒤쪽 화면이 같이 닫히지 않게).
    if (this.needsOnboarding()) return;
    if (event.key === 'Escape' && this.sortMenuOpen) {
      event.preventDefault();
      this.sortMenuOpen = false;
      this.updateComplete.then(() => qs<HTMLButtonElement>('.sort-trigger')?.focus());
      return;
    }
    if (event.key === 'Escape' && this.statusMenuOpen) {
      event.preventDefault();
      this.statusMenuOpen = false;
      this.updateComplete.then(() => qs<HTMLButtonElement>('.status-trigger')?.focus());
      return;
    }
    if (event.key === 'Escape' && this.boardMenuOpen) {
      event.preventDefault();
      this.boardMenuOpen = false;
      this.updateComplete.then(() => qs<HTMLButtonElement>('.board-picker .board-trigger')?.focus());
      return;
    }
    if (this.selecting && event.key === 'Escape' && !(target instanceof HTMLInputElement && target.type === 'search')) {
      event.preventDefault(); this.closeSelection(); return;
    }
    if (event.key === 'Escape' && target instanceof HTMLInputElement) { target.blur(); return; }
    if (this.selecting) return;
    if (target?.closest('input, textarea, select, .board-picker, .sort-picker') || event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.key === '?') { event.preventDefault(); this.shortcutsOpen = true; return; }
    if (this.view === 'settings' && event.key === 'Escape' && !this.shortcutsOpen) { event.preventDefault(); this.leaveSettings(); return; }
    if (this.view === 'settings' || this.shortcutsOpen) return;
    if (event.key === 'Escape' && this.sharedDetail) { this.closeSharedDetail(); return; }
    if (event.key === 'Escape' && this.isWide && this.detailOpen && this.shownId) { this.setDetail(false); return; }
    // 단추나 링크에 포커스가 있으면 Enter는 그 요소의 기본 동작에 맡긴다.
    if (event.key === 'Enter' && target?.closest(INTERACTIVE)) return;
    const list = this.visible();
    const index = list.findIndex((n) => n.id === (this.selectedId ?? this.shownId));
    const move = (step: number) => {
      const next = list[Math.max(0, Math.min(list.length - 1, index + step))];
      if (!next) return;
      this.clearDeepLink();
      this.sharedDetail = null;
      this.selectedId = next.id;
      if (this.isWide) { this.setDetail(true); this.markRead(next); }
      this.updateComplete.then(() => qsel(`[data-id="${CSS.escape(next.id)}"]`)?.scrollIntoView({ block: 'nearest' }));
    };
    const actions: Record<string, () => void> = {
      '/': () => qs<HTMLInputElement>('.search input')?.focus(),
      j: () => move(1), ArrowDown: () => move(1), k: () => move(-1), ArrowUp: () => move(-1),
      Enter: () => { const notice = list[index]; if (notice) { this.markRead(notice); window.open(safeUrl(notice.url), '_blank', 'noopener'); } },
      r: () => this.collectNow(), 1: () => this.openTab('all'), 2: () => this.openTab('intern'), 3: () => { if (this.hasCoop()) this.openTab('coop'); }, 4: () => this.openTab('saved'),
      s: () => {
        const id = this.openedId ?? (this.detailOpen ? this.shownId : null);
        const notice = this.deepShown(id) ?? list.find((item) => item.id === id) ?? list[index];
        if (notice) this.toggleSave(notice);
      },
    };
    const action = actions[event.key];
    if (action) { event.preventDefault(); action(); }
  }

  onRow(event: MouseEvent, notice: Notice) {
    if (this.selecting) { event.preventDefault(); this.toggleReadSelection(notice.id); return; }
    // 행을 누르면 앱 안 상세를 먼저 보여 주고, 원문은 "원문 열기"로 연다(D-013, ux-rules 1절).
    // Ctrl이나 Cmd를 누르고 누르면 브라우저 기본대로 원문을 새 탭에 연다.
    this.markRead(notice);
    if (event.ctrlKey || event.metaKey || event.shiftKey) return;
    event.preventDefault();
    this.clearDeepLink();
    if (this.sharedDetail && this.shownId === notice.id) { this.closeSharedDetail(); return; }
    this.sharedDetail = null;
    if (this.isWide) {
      if (this.detailOpen && this.shownId === notice.id) { this.setDetail(false); return; }
      this.selectedId = notice.id; this.setDetail(true); return;
    }
    this.openedId = notice.id;
    history.pushState({ notice: notice.id }, '');
    window.scrollTo({ top: 0 });
  }

  setDetail(open: boolean) {
    this.detailOpen = open;
    if (!open && this.unreadOnly) this.selectedId = null;
    remember('detail', open ? '1' : '0');
  }

  /** 로그인한 사용자 본인의 요약. 키를 등록하지 않았거나 아직 판정 전이면 null이다. */
  async refreshMyDeadlines(userId: string, epoch: number): Promise<void> {
    if (!authClient) return;
    const request = ++this.deadlineRequest;
    try {
      const deadlines = await loadMyDeadlines(authClient, userId);
      if (epoch !== this.subscriptionsEpoch || userId !== this.authUserId || request !== this.deadlineRequest) return;
      for (const [id, write] of this.summaryDeadlineWrites) {
        if (write.request === request) deadlines.set(id, write.deadline);
        else this.summaryDeadlineWrites.delete(id);
      }
      this.liveListFields.add('deadlines');
      this.myDeadlines = deadlines;
      this.requestUpdate();
    } catch { /* 날짜 열이 아직 없다면 공용 마감일을 계속 쓴다. */ }
  }

  async refreshMyTranslations(userId: string, epoch: number): Promise<void> {
    if (!authClient) return;
    const request = ++this.translationRequest;
    try {
      const translations = await loadMyTranslations(authClient, userId);
      if (epoch !== this.subscriptionsEpoch || userId !== this.authUserId || request !== this.translationRequest) return;
      this.liveListFields.add('translations');
      this.myTranslations = translations;
      this.requestUpdate();
    } catch { /* 번역을 읽지 못하면 원문을 그대로 표시한다. */ }
  }

  /** 소프트웨어학과 인턴십 졸업요건 확인: 공지마다 내 판정을 불러오고, 기다리는 중이면 워커가 끝낼 때까지 가끔 다시 읽는다. */
  graduations = new Map<string, GraduationAssessment | null | 'loading'>();
  graduationBusy: string | null = null;
  graduationError = '';
  private graduationPolls = new Map<string, ReturnType<typeof setTimeout>>();
  resetGraduations(): void {
    this.graduations = new Map(); this.graduationBusy = null; this.graduationError = ''; this.autoGraduations = new Set();
    for (const timer of this.graduationPolls.values()) clearTimeout(timer);
    this.graduationPolls = new Map();
  }
  /** 이 공지에 졸업요건 확인을 보여 줄지: 인턴 공고이고 아직 채우지 않은 요건이 있을 때만. */
  showsGraduation(notice: Notice): boolean {
    return !!authClient && !!this.authUserId && isInternshipNotice(notice, this.isExternal(notice) || this.kindOf(notice) === 'coop') && (() => { const v = visibleTracks(this.profile); return v.dept || v.p3; })();
  }
  private autoGraduations = new Set<string>();
  graduationFor(notice: Notice): GraduationAssessment | null {
    const userId = this.authUserId;
    if (!authClient || !userId || !this.showsGraduation(notice)) return null;
    const cached = this.graduations.get(notice.id);
    if (cached !== undefined) {
      if (cached === null && this.profileStatus === 'ready' && this.detailIsOpen(notice.id)
        && !this.autoGraduations.has(notice.id) && !this.graduationBusy) {
        this.autoGraduations.add(notice.id);
        const epoch = this.subscriptionsEpoch;
        setTimeout(() => {
          if (!this.isCurrentAccount(userId, epoch)) return;
          if (!this.detailIsOpen(notice.id) || !this.showsGraduation(notice) || this.graduationBusy) {
            this.autoGraduations.delete(notice.id);
            return;
          }
          void this.requestGraduation(notice, true);
        }, 0);
      }
      return cached === 'loading' ? null : cached;
    }
    this.graduations.set(notice.id, 'loading');
    const epoch = this.subscriptionsEpoch, assessments = this.graduations;
    void this.restoreDetail(notice.id, userId, epoch).then(({ graduation }) => {
      if (graduation && this.isCurrentAccount(userId, epoch) && this.graduations === assessments && assessments.get(notice.id) === 'loading') {
        assessments.set(notice.id, graduation);
        this.requestUpdate();
      }
    });
    void this.reloadGraduation(notice.id, userId, epoch, 0);
    return null;
  }
  private async reloadGraduation(noticeId: string, userId: string, epoch: number, attempt: number): Promise<void> {
    if (!authClient || !this.isCurrentAccount(userId, epoch)) return;
    const assessments = this.graduations;
    const current = () => this.isCurrentAccount(userId, epoch) && this.graduations === assessments;
    let row: GraduationAssessment | null;
    try { row = await loadGraduation(authClient, userId, noticeId); }
    catch {
      if (!current()) return;
      this.graduationError = '졸업요건 결과를 불러오지 못했어요. 잠시 뒤 다시 열어 주세요.';
      this.requestUpdate();
      return;
    }
    if (!current()) return;
    assessments.set(noticeId, row);
    this.cacheDetail(noticeId, 'graduation', row);
    this.requestUpdate();
    if (row?.state === 'pending' && attempt < 40) {
      this.graduationPolls.set(noticeId, setTimeout(() => { void this.reloadGraduation(noticeId, userId, epoch, attempt + 1); }, 20000));
    }
  }
  async requestGraduation(notice: Notice, auto = false): Promise<void> {
    const userId = this.authUserId, epoch = this.subscriptionsEpoch;
    if (!authClient || !userId || this.graduationBusy) return;
    this.graduationBusy = notice.id; this.graduationError = '';
    try {
      if (!await sessionIs(authClient, userId) || !this.isCurrentAccount(userId, epoch) || !this.detailIsOpen(notice.id)) return;
      const created = await requestGraduation(authClient, userId, notice.id, { ifAbsent: auto });
      if (!this.isCurrentAccount(userId, epoch)) return;
      if (!created) { void this.reloadGraduation(notice.id, userId, epoch, 0); return; }   // 이미 행이 있다: 덮지 않고 있는 그대로 읽는다
      const before = this.graduations.get(notice.id);
      const pending = { ...(typeof before === 'object' && before ? before : { aiStatus: null, department: null, university3p: null, facts: null }), state: 'pending' as const };
      this.graduations.set(notice.id, pending);
      this.cacheDetail(notice.id, 'graduation', pending);
      clearTimeout(this.graduationPolls.get(notice.id));
      this.graduationPolls.set(notice.id, setTimeout(() => { void this.reloadGraduation(notice.id, userId, epoch, 1); }, 20000));
    } catch {
      if (epoch === this.subscriptionsEpoch) this.graduationError = '확인을 요청하지 못했어요. 잠시 뒤 다시 열어 주세요.';
    } finally {
      if (epoch === this.subscriptionsEpoch) this.graduationBusy = null;
    }
  }

  private detailRestores = new Map<string, ReturnType<typeof loadDetailCache>>();
  private opportunitiesFetchedAt = 0;
  /** 상세 캐시에 적을 기록의 버전: 값이 있으면 서버의 갱신 시각, 없다는 관측이면 조회를 시작한 시각. */
  private opportunityVersion(row: Opportunity | undefined, fetchedAt: number): number {
    return (row ? Date.parse(row.updated_at) : NaN) || fetchedAt;
  }
  private missingSummaries = new Set<string>();
  /** 서버에서 이 계정의 상세 조회가 성공한 공지. 이때는 늦게 도착한 기기 목록 캐시의 옛 판정보다 이 결과(빈 결과 포함)를 쓴다. */
  private liveInfo = new Set<string>();

  private restoreDetail(id: string, userId: string, epoch: number) {
    const pending = this.detailRestores.get(id);
    if (pending) return pending;
    const restore = loadDetailCache(userId, id).then((entry) => {
      if (!this.isCurrentAccount(userId, epoch)) return {};
      if (entry.opportunity && this.opportunitiesStatus !== 'ready' && this.opportunitiesStatus !== 'unavailable'
        && !this.opportunityWrites.has(id) && !this.opportunities.has(id)) {
        this.opportunities = new Map(this.opportunities).set(id, entry.opportunity);
      }
      return entry;
    });
    this.detailRestores.set(id, restore);
    if (this.opportunitiesStatus === 'ready') { const row = this.opportunities.get(id); this.cacheDetail(id, 'opportunity', row ?? null, this.opportunityVersion(row, this.opportunitiesFetchedAt)); }
    return restore;
  }

  private cacheDetail<K extends keyof DetailFields>(
    id: string, field: K, value: DetailFields[K] | null, version?: number,
  ): void {
    const userId = this.authUserId, epoch = this.subscriptionsEpoch;
    if (userId) void saveDetailField(userId, id, field, value, () => this.isCurrentAccount(userId, epoch), version);
  }

  private detailIsOpen(id: string): boolean {
    // 첫 설정이나 알림함 창이 앞에 있으면 뒤쪽 상세는 보이는 상세가 아니다(요약·졸업요건을 요청하지 않는다).
    if (this.needsOnboarding() || this.inboxOpen) return false;
    if (this.sharedDetail === id) return this.view !== 'settings';
    return this.view !== 'settings' && (this.isWide ? this.detailOpen && this.shownId === id : this.openedId === id);
  }

  private loadDetailInfo(id: string) {
    const userId = this.authUserId, epoch = this.subscriptionsEpoch;
    if (!authClient || !userId || this.summaries.has(id)) return;
    this.summaries.set(id, 'loading');
    void this.restoreDetail(id, userId, epoch).then(({ info }) => {
      if (info && this.isCurrentAccount(userId, epoch) && this.summaries.get(id) === 'loading') {
        this.summaries.set(id, info);
        this.requestUpdate();
      }
    });
    void loadMyNoticeInfo(authClient, userId, id).then((info) => {
      if (!this.isCurrentAccount(userId, epoch)) return;
      if (!info?.summary) this.missingSummaries.add(id);
      this.liveInfo.add(id);
      this.summaries.set(id, info);
      this.cacheDetail(id, 'info', info);
      this.requestUpdate();
    }, () => {
      // 서버 읽기가 실패하면 캐시는 그대로 둔다. 행이 없다고 확인하기 전에는 요약을 생성하지 않는다.
    });
  }

  /** 상세에 보일 AI 판정: 상세 조회가 성공했으면 그 결과(없으면 없음)를, 아니면 목록의 판정을 쓰고 없으면 기기 캐시의 상세 값을 쓴다. */
  detailAi(notice: Notice): Judgement['ai'] | null {
    const info = this.summaries.get(notice.id);
    if (this.liveInfo.has(notice.id) && info !== 'loading') return (info ? info.ai : null) ?? null;
    return this.judgement(notice)?.ai ?? this.myInfo(notice)?.ai ?? null;
  }

  myInfo(notice: Notice): MyNoticeInfo | null {
    this.loadDetailInfo(notice.id);
    const info = this.summaries.get(notice.id);
    return info && info !== 'loading' ? info : null;
  }

  /** 열어 본 공지에 요약이 없으면 내 AI 키로 자동으로 만든다. 공지마다 한 번만 시도하고, 실패하면 요약 칸을 보이지 않는다("다시 만들기" 단추는 없앴다, 사용자 지시 2026-11-13). */
  private autoSummaries = new Set<string>();
  autoSummary(notice: Notice): void {
    if (!this.missingSummaries.has(notice.id) || this.autoSummaries.has(notice.id) || !this.detailIsOpen(notice.id)) return;
    // 예전 Gemini 키나 업체별 키(Gemini·Groq) 중 하나라도 켜져 있으면 만든다(Groq 키만 있는 계정도 요약, 2026-11-13).
    const hasKey = (!!this.byokStatus && !this.byokStatus.disabled) || this.aiKeys.some((key) => !key.disabled);
    if (!this.authUserId || !hasKey || this.summarizing) return;
    const userId = this.authUserId, epoch = this.subscriptionsEpoch;
    this.autoSummaries.add(notice.id);
    setTimeout(() => {
      if (!this.isCurrentAccount(userId, epoch)) return;
      if (this.summarizing || !this.detailIsOpen(notice.id)) { this.autoSummaries.delete(notice.id); return; }
      void this.makeSummary(notice);
    }, 0);
  }

  /** 상세 화면의 "요약 만들기". 내 Gemini 키가 있어야 하고, 만든 요약은 저장돼서 다시 만들지 않는다. */
  async makeSummary(notice: Notice): Promise<void> {
    const userId = this.authUserId, epoch = this.subscriptionsEpoch;
    if (!authClient || !userId || this.summarizing) return;
    this.summarizing = notice.id; this.summaryError = ''; this.summaryErrorId = null;
    try {
      if (!await sessionIs(authClient, userId) || !this.isCurrentAccount(userId, epoch) || !this.detailIsOpen(notice.id)) return;
      // 같은 계정의 다른 탭이 같은 공지의 요약을 만드는 중이면 건너뛴다(Web Locks). 잠금을 얻은 뒤에도 서버에 이미 요약이 생겼으면 다시 호출하지 않는다.
      const client = authClient;
      const create = async () => {
        const row = await loadMyNoticeInfo(client, userId, notice.id).catch(() => null);
        return row?.summary ? { summary: row.summary, deadline: row.deadline, deadlineKind: row.deadlineKind } : await requestNoticeSummary(client, notice.id);
      };
      const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
      const made = locks
        ? await locks.request(`notice-summary:${userId}:${notice.id}`, { ifAvailable: true }, (lock) => (lock ? create() : null))
        : await create();
      if (!made) return;
      if (!this.isCurrentAccount(userId, epoch)) return;
      const before = this.summaries.get(notice.id);
      const info = { ai: typeof before === 'object' && before ? before.ai : null, ...made };
      this.summaries.set(notice.id, info);
      this.missingSummaries.delete(notice.id);
      this.cacheDetail(notice.id, 'info', info);
      if (made.deadline) {
        const deadline = { deadline: made.deadline, deadlineKind: made.deadlineKind };
        this.myDeadlines = new Map(this.myDeadlines).set(notice.id, deadline);
        this.summaryDeadlineWrites.set(notice.id, { request: this.deadlineRequest, deadline });
      }
    } catch (error) {
      if (epoch === this.subscriptionsEpoch) { this.summaryErrorId = notice.id; this.summaryError = error instanceof Error && /[가-힣]/.test(error.message) ? error.message : '요약을 만들지 못했어요. 잠시 뒤 다시 눌러 주세요.'; }
    } finally {
      if (epoch === this.subscriptionsEpoch) this.summarizing = null;
    }
  }

  detailTranslation(notice: Notice, body: NoticeBody | null | 'loading'): MyTranslation | null {
    const userId = this.authUserId;
    if (!authClient || !userId) return null;
    const cached = this.detailTranslations.get(notice.id);
    if (cached !== undefined) return cached === 'loading' || cached === 'failed' ? null : cached;
    const epoch = this.subscriptionsEpoch;
    const original = `${notice.title}
${body && body !== 'loading' ? body.body?.slice(0, 2000) ?? '' : ''}`;
    const latin = original.match(/[a-z]/gi)?.length ?? 0;
    const hangul = original.match(/[가-힣]/g)?.length ?? 0;
    const known = this.myTranslations.has(notice.id) || !!notice.title_ko || (latin >= 20 && hangul < latin * 0.15);
    void this.restoreDetail(notice.id, userId, epoch).then(({ translation }) => {
      if (!this.isCurrentAccount(userId, epoch)) return;
      const value = this.detailTranslations.get(notice.id);
      if (translation && (value === undefined || value === 'loading' || value === 'failed')) {
        this.detailTranslations.set(notice.id, translation);
        this.requestUpdate();
        if (!known && value === undefined) this.refreshDetailTranslation(notice.id, userId, epoch);
      }
    });
    if (known) this.refreshDetailTranslation(notice.id, userId, epoch);
    return null;
  }

  private refreshDetailTranslation(id: string, userId: string, epoch: number): void {
    if (!authClient) return;
    if (!this.detailTranslations.has(id)) this.detailTranslations.set(id, 'loading');
    void loadMyTranslation(authClient, userId, id).then((translation) => {
      if (!this.isCurrentAccount(userId, epoch)) return;
      this.detailTranslations.set(id, translation);
      this.cacheDetail(id, 'translation', translation);
      this.requestUpdate();
    }, () => {
      if (this.isCurrentAccount(userId, epoch) && this.detailTranslations.get(id) === 'loading') this.detailTranslations.set(id, 'failed');
    });
  }

  body(notice: Notice): NoticeBody | null | 'loading' {
    const { bodies, generatedAt: generation, subscriptionsEpoch: epoch } = this;
    const cached = bodies.get(notice.id);
    const fallback = this.deepNotice?.notice.id === notice.id ? this.deepNotice.body : null;
    if (cached && cached !== 'loading') return cached;
    const reusable = fallback?.body || fallback?.body_html ? fallback : null;
    if (cached !== undefined) return reusable ?? cached;
    if (this.deepLookup?.id === notice.id && this.deepLookup.result === undefined) return 'loading';
    bodies.set(notice.id, 'loading');
    const controller = new AbortController();
    this.bodyAborts.set(notice.id, controller);
    const reading = reusable && authClient
      ? loadPublicBody(authClient, notice.source_id, notice.article_no, controller.signal, reusable)
      : fetchBody(notice, controller.signal);
    withTimeout(reading, 20_000, () => controller.abort()).catch(() => null).then((body) => {
      if (this.bodyAborts.get(notice.id) !== controller) return;
      this.bodyAborts.delete(notice.id);
      if (bodies !== this.bodies || bodies.get(notice.id) !== 'loading') return;
      // 계정이 바뀌었거나(epoch) 목록 세대가 바뀌었으면 결과를 버리고 'loading'을 지워 다음 그림에서 다시 요청한다.
      if (epoch !== this.subscriptionsEpoch || generation !== this.generatedAt) bodies.delete(notice.id);
      else bodies.set(notice.id, body);
      this.requestUpdate();
    });
    return reusable ?? 'loading';
  }

  /** 진행 중인 본문 요청을 모두 끊는다(계정 전환·새 수집 결과). */
  abortBodies(): void {
    for (const controller of this.bodyAborts.values()) controller.abort();
    this.bodyAborts.clear();
  }

  /** '본문 다시 불러오기': 멈춘 옛 요청을 끊고 새로 한 번만 요청한다. */
  retryBody(notice: Notice): void {
    this.bodyAborts.get(notice.id)?.abort();
    this.bodyAborts.delete(notice.id);
    this.bodies.delete(notice.id);
    this.requestUpdate();
  }
}

defineReactive(AppController, Object.keys(AppController.properties));

/** 알림 상태 확인 단계 하나가 이 시간 안에 끝나지 않으면 실패로 본다. */
const PUSH_CHECK_MS = 10_000;
function withTimeout<T>(promise: Promise<T>, ms: number, onTimeout?: () => void): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => { onTimeout?.(); reject(new Error('timeout')); }, ms);
    promise.then((value) => { clearTimeout(timer); resolve(value); }, (error: unknown) => { clearTimeout(timer); reject(error); });
  });
}
