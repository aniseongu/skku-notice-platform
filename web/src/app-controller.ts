// 앱의 상태와 동작. 화면은 notice-shell.tsx가 이 컨트롤러를 구독해 그린다(그림자 DOM 없이 전역 토큰과 글꼴을 그대로 받는다).
// 규칙은 docs/DESIGN.md, docs/design/ux-rules.md, docs/design/platforms.md.
import {
  type IconName, type Judgement, type MatchedFile, type Notice, type NoticeBody, type NoticesFile, type Source,
  boardName, cleanTitle, deadlineGroup, deadlinePassed, fetchBody, fetchJson, keywordMatches, postedGroup, safeUrl, todayKst,
} from './data';
import { type SavedNotice, loadSaved, orderSaved, storeSaved, toggleSaved } from './saved-notices';
import { isNoticeRead, loadReadState, mergeReadStates, parseReadState, readIds, setReadState, storeReadState } from './read-notices';
import { keywordCounts } from './keyword-counts';
import type { Theme } from './theme';
import { APP_NAME } from './brand';
import { authClient } from './auth';
import { loadSubscriptions, setSubscription } from './source-subscriptions';
import { loadKeywordsPreference, parseKeywords, saveKeywordsPreference } from './preferences';
import { loadNoticeStates, planStateSync, pushRead, pushSaved, sessionIs, type StatePlan } from './notice-state-sync';
import { connectionChain } from './connection-chain';
import { CALENDAR_SCOPE, GoogleError, desiredEvents, ensureCalendar, syncCalendar } from './google-calendar';
import { byokAvailable, loadByokStatus, loadCanvasStatus, loadNoticeSummary, requestNoticeSummary, registerByokKey, registerCanvasToken, removeByokKey, removeCanvasToken, type ByokStatus, type CanvasStatus } from './byok';
import { EMPTY_PROFILE, loadProfile, saveProfile as storeProfile, type UserProfile } from './profile';
import type { Draft } from './onboarding-flow';
import { createEnableChain, disableDevicePush, inspectDevicePush, releaseDevicePush } from './platform-browser-push';
import { localKey, setLocalOwner } from './local-scope.ts';
import type { Subscription } from '@supabase/supabase-js';
import { orderNotices, type Sort } from './notice-order';
import { Reactive, defineReactive } from './reactive';

export type Tab = 'all' | 'intern' | 'saved';
export type View = Tab | 'settings';
export const TABS: { id: Tab; label: string; icon: IconName }[] = [
  { id: 'all', label: '성대 공지', icon: 'list' },
  // 전체는 성균관대 공지만, 인턴 공고는 링커리어와 자소설닷컴(사용자 결정 2026-11-03, D-026).
  { id: 'intern', label: '인턴 공고', icon: 'briefcase' },
  { id: 'saved', label: '저장', icon: 'bookmark' },
];
export const STALE_MS = 2 * 3600_000;
// 화면을 켜 둔 채로 있어도 1시간 주기의 새 공지와 D-day가 바뀌도록 5분마다 다시 받는다.
const REFRESH_MS = 5 * 60_000;
const isTab = (value: string | null): value is Tab => TABS.some((t) => t.id === value);
const normalizeTab = (value: string | null) => value === 'mine' || value === 'deadline' ? 'all' : value;
const INTERACTIVE = 'a, button, input, textarea, select, [contenteditable]';
const wide = matchMedia('(min-width: 1080px)');
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
  return section && ['notifications', 'keywords', 'calendar', 'profile'].includes(section) ? section : null;
}

/** 설정 머리의 부제. 쪽마다 그 쪽에서 하는 일을 말한다. */
export function settingsSubtitle(): string {
  switch (settingsSectionFromUrl()) {
    case 'notifications': return '받을 게시판과 이 기기 알림을 정해요';
    case 'keywords': return '관심 있는 공지를 골라 봐요';
    case 'calendar': return '저장한 공지의 마감을 구글 캘린더에 넣어요';
    case 'profile': return '내 정보와 Gemini에 알려줄 내용을 적어요';
    case 'keys': return '키와 지원 자격 정보를 관리해요';
    default: return '알림과 연결을 정해요';
  }
}

export function settingsTitle(): string {
  const params = new URLSearchParams(location.search);
  if (params.get('keys') === '1') return '연결 키';
  return ({ notifications: '알림', keywords: '관심 키워드', calendar: '구글 캘린더', profile: '프로필 설정' } as Record<string, string>)[params.get('section') ?? ''] ?? '설정';
}

export interface InstallPrompt extends Event { prompt(): Promise<void> }

export function remember(key: string, value?: string): string | null {
  try {
    const storageKey = ['keywords', 'board', 'view-unread', 'subscriptions-only', 'onboarding-dismissed'].includes(key) ? localKey(key) : key;
    if (value === undefined) return localStorage.getItem(storageKey);
    localStorage.setItem(storageKey, value);
  } catch { /* 사생활 보호 모드에서는 기억하지 않는다 */ }
  return value ?? null;
}

function loadSort(tab: 'all' | 'intern'): Sort {
  const params = new URLSearchParams(location.search);
  if (tab === 'all' && params.get('tab') === 'deadline') return 'deadline';
  const requested = params.get('sort');
  if (normalizeTab(params.get('tab') ?? remember('tab')) === tab && (requested === 'latest' || requested === 'deadline')) return requested;
  const saved = remember(tab === 'intern' ? 'intern-sort' : 'notice-sort');
  return saved === 'latest' || saved === 'deadline' ? saved : 'latest';
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
    notices: { state: true }, sources: { state: true }, matched: { state: true }, generatedAt: { state: true },
    view: { state: true }, board: { state: true }, keyword: { state: true }, keywords: { state: true }, query: { state: true },
    loading: { state: true }, failed: { state: true }, selectedId: { state: true }, install: { state: true },
    toast: { state: true }, toastLink: { state: true }, toastLinkLabel: { state: true }, isWide: { state: true }, theme: { state: true },
    detailOpen: { state: true }, openedId: { state: true }, shortcutsOpen: { state: true }, boardMenuOpen: { state: true }, sortMenuOpen: { state: true },
    saved: { state: true }, read: { state: true }, collapsed: { state: true }, sort: { state: true }, internSort: { state: true }, savedSort: { state: true },
    authReady: { state: true }, authUserId: { state: true }, authEmail: { state: true }, authError: { state: true }, authBusy: { state: true }, authName: { state: true }, authAvatar: { state: true }, pushStatus: { state: true }, pushError: { state: true }, pushRetry: { state: true },
    byokOn: { state: true }, byokStatus: { state: true }, byokLoading: { state: true }, byokBusy: { state: true }, byokError: { state: true }, canvasStatus: { state: true }, canvasBusy: { state: true }, canvasError: { state: true },
    calendarId: { state: true }, calendarBusy: { state: true }, calendarMessage: { state: true }, calendarError: { state: true }, calendarSyncedAt: { state: true },
    summarizing: { state: true }, summaryError: { state: true },
    profile: { state: true }, profileStatus: { state: true }, profileMessage: { state: true }, profileError: { state: true }, settingsSection: { state: true },
    onboardingOpen: { state: true }, onboardingManual: { state: true }, onboardingDismissed: { state: true }, onboardingBusy: { state: true }, onboardingError: { state: true },
    keywordNote: { state: true },
    subscriptions: { state: true }, subscriptionsLoading: { state: true }, subscriptionsError: { state: true }, subscriptionsOnly: { state: true },
    preferencesLoading: { state: true }, preferencesError: { state: true }, preferencesUnavailable: { state: true },
    unreadOnly: { state: true }, selecting: { state: true }, selectedReads: { state: true },
  };

  preferencesLoading = false;
  preferencesError = '';
  preferencesUnavailable = false;
  subscriptionsOnly = remember('subscriptions-only') === '1';
  subscriptions: string[] = [];
  subscriptionsLoading = false;
  subscriptionsError = '';
  subscriptionsEpoch = 0;
  pushStatus: 'unsupported' | 'checking' | 'off' | 'on' | 'busy' | 'denied' = 'checking';
  pushError = '';
  // 클릭 안에서 권한 요청을 바로 부르려면 등록과 공개키를 미리 받아 둔다.
  pushRegistration: ServiceWorkerRegistration | null = null;
  pushVapidKey: string | null = null;
  stateSyncedEpoch = -1;
  stateChain: { run: () => Promise<void>; epoch: number } | null = null;
  // 실패한 켜기 작업을 이어서 실행하기 위해 사용자와 epoch마다 하나만 보관한다.
  pushChain: { chain: ReturnType<typeof createEnableChain>; userId: string; epoch: number } | null = null;
  pushRetry = false;
  byokOn = false;
  byokStatus: ByokStatus | null = null;
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
  summarizing: string | null = null;
  summaryError = '';
  profile: UserProfile = EMPTY_PROFILE;
  profileStatus: 'idle' | 'loading' | 'ready' | 'unavailable' = 'idle';
  profileMessage = '';
  profileError = '';
  // 설정 화면의 하위 쪽(원본과 같은 ?view=settings&section=... 주소). keys=1은 연결 키 쪽이다.
  settingsSection: string | null = settingsSectionFromUrl();
  onboardingOpen = false;
  onboardingManual = false;
  onboardingDismissed = false;
  onboardingBusy = false;
  onboardingError = '';
  private onboardingChain: { key: string; run: () => Promise<void> } | null = null;
  keywordNote = '';
  private keywordWrite: Promise<void> = Promise.resolve();
  authReady = !authClient;
  authEmail: string | null = null;
  authName: string | null = null;
  authAvatar: string | null = null;
  authError = '';
  authBusy = false;
  authUserId: string | null = null;
  authSubscription: Subscription | null = null;
  notices: Notice[] = [];
  sources: Source[] = [];
  matched: MatchedFile | null = null;
  generatedAt: string | null = null;
  view: View = new URLSearchParams(location.search).get('view') === 'settings'
    ? 'settings' : [normalizeTab(new URLSearchParams(location.search).get('tab')), normalizeTab(remember('tab'))].find(isTab) ?? 'all';
  sort: Sort = loadSort('all');
  internSort: Sort = loadSort('intern');
  savedSort: Sort = remember('saved-sort') === 'deadline' ? 'deadline' : 'latest';
  unreadOnly = remember('view-unread') === '1';
  selecting = false;
  selectedReads: string[] = [];
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
  loading = true;
  failed = false;
  selectedId: string | null = null;
  install: InstallPrompt | null = null;
  toast = '';
  toastLink: string | null = null;
  toastLinkLabel = '';
  isWide = wide.matches;
  theme: Theme = (['light', 'dark'].includes(remember('theme') ?? '') ? remember('theme') : 'auto') as Theme;
  // 넓은 화면의 오른쪽 상세 칸을 열어 둘지(닫으면 목록이 넓어진다). 기억한다.
  detailOpen = remember('detail') !== '0';
  // 휴대폰에서 앱 안 상세 화면으로 연 글. 뒤로 가기(history)로 닫는다.
  openedId: string | null = null;
  shortcutsOpen = false;
  boardMenuOpen = false;
  sortMenuOpen = false;
  // 글별 본문(D-013). 'loading'이면 받는 중, null이면 아직 서버가 받지 않은 글.
  bodies = new Map<string, NoticeBody | null | 'loading'>();
  /** 내 Gemini 요약. 공유 본문 캐시와 따로 두어 계정이 바뀌면 비운다. */
  summaries = new Map<string, string | null | 'loading'>();
  toastTimer = 0;
  // 상세 칸에 실제로 보이는 글(고른 글이 없으면 첫 글). 목록 행 표시와 맞춘다.
  shownId: string | null = null;

  /** 화면에 붙을 때 한 번 부른다. 이벤트 구독과 첫 데이터 읽기를 시작한다. */
  start() {
    // 새 문서는 목록에서 시작한다. 이전 문서의 상세 history 상태가 설정 닫기에서 되살아나지 않게 맞춘다.
    if (history.state?.notice) history.replaceState(null, '');
    remember('notice-sort', this.sort);
    remember('intern-sort', this.internSort);
    applyTheme(this.theme);
    void byokAvailable(import.meta.env.VITE_SUPABASE_URL).then((available) => {
      this.byokOn = available;
      if (available && this.authUserId) { this.byokLoading = true; void this.refreshByok(this.authUserId, this.subscriptionsEpoch); }
    });
    if (authClient) {
      this.authSubscription = authClient.auth.onAuthStateChange((_event, session) => {
        const userId = session?.user.id ?? null;
        if (!this.authReady || userId !== this.authUserId) {
          const previousUserId = this.authUserId;
          this.authUserId = userId;
          this.pushStatus = userId ? 'checking' : 'off'; this.pushError = ''; this.pushRetry = false;
          this.summaries = new Map(); this.summarizing = null; this.summaryError = ''; this.byokStatus = null; this.byokError = ''; this.byokBusy = false; this.canvasStatus = null; this.canvasError = ''; this.canvasBusy = false; this.calendarId = null; this.calendarSyncedAt = null; this.calendarBusy = false; this.calendarMessage = ''; this.calendarError = ''; if (!userId) this.forgetGoogleToken(); this.profile = EMPTY_PROFILE; this.profileMessage = ''; this.profileError = ''; this.keywordNote = '';
          this.profileStatus = userId ? 'loading' : 'idle'; this.onboardingOpen = false; this.onboardingManual = false; this.onboardingBusy = false; this.onboardingError = ''; this.onboardingChain = null;
          this.byokLoading = !!userId && this.byokOn;
          const staleChain = this.pushChain; this.pushChain = null;
          if (staleChain) void staleChain.chain.discard();
          if (previousUserId) setTimeout(() => { void this.releasePush(previousUserId); }, 0);
          const epoch = ++this.subscriptionsEpoch;
          this.subscriptions = [];
          this.subscriptionsError = '';
          this.subscriptionsLoading = !!userId;
          this.preferencesLoading = !!userId;
          this.preferencesError = '';
          this.preferencesUnavailable = false;
          if (userId) setTimeout(() => { void this.refreshSubscriptions(userId, epoch); void this.refreshPreferences(userId, epoch); void this.refreshPush(userId, epoch); void this.refreshCalendar(userId, epoch); void this.syncStates(); void this.refreshByok(userId, epoch); void this.refreshProfile(userId, epoch); }, 0);
          setLocalOwner(userId);
          this.onboardingDismissed = !!userId && remember('onboarding-dismissed') === '1';
          this.saved = loadSaved();
          this.keywords = loadKeywords();
          this.readState = loadReadState();
          this.needsReadBaseline = this.readState === null;
          this.read = this.readState ? readIds(this.readState) : null;
          this.keyword = null;
          this.query = '';
          this.board = remember('board') ?? 'all';
          this.subscriptionsOnly = remember('subscriptions-only') === '1';
          this.unreadOnly = remember('view-unread') === '1';
          this.selecting = false; this.selectedReads = [];
        }
        this.authEmail = session?.user.email ?? null;
        // 구글 로그인 직후에만 접근 토큰이 온다. 캘린더 연결을 누르고 돌아온 경우에만 받아 두고 곧바로 일정을 맞춘다.
        const providerToken = (session as { provider_token?: string | null } | null)?.provider_token;
        if (providerToken && userId && this.takeCalendarPending()) {
          this.rememberGoogleToken(providerToken);
          setTimeout(() => { void this.syncCalendarNow(); }, 0);
        }
        const meta = (session?.user.user_metadata ?? {}) as Record<string, unknown>;
        const name = meta.full_name ?? meta.name;
        this.authName = typeof name === 'string' && name.trim() ? name.trim().slice(0, 60) : null;
        this.authAvatar = safeAvatarUrl(meta.avatar_url ?? meta.picture);
        if (!this.authReady) { this.authReady = true; void this.refresh(); }
      }).data.subscription;
    } else { void this.refresh(); }
    wide.addEventListener('change', () => { this.isWide = wide.matches; });
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') this.refresh(); });
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
  }

  closeBoardMenuOutside = (event: PointerEvent) => {
    if (this.boardMenuOpen && !(event.target as Element).closest('.board-picker')) this.boardMenuOpen = false;
    if (this.sortMenuOpen && !(event.target as Element).closest('.sort-picker')) this.sortMenuOpen = false;
  };

  async refresh() {
    this.loading = true;
    try {
      const notices = await fetchJson<NoticesFile>('notices.json');
      // 뒤늦게 채운 본문도 새 수집 결과와 함께 다시 받는다.
      if (this.generatedAt !== notices!.generated_at) this.bodies.clear();
      this.notices = notices!.notices;
      this.sources = notices!.sources;
      this.generatedAt = notices!.generated_at;
      // 개인용 서비스의 판정 결과는 플랫폼에서 읽지 않는다.
      this.matched = null;
      this.failed = false;
      // 처음 열면 이미 있던 글이 모두 굵게 보이지 않게, 그때 있던 글은 읽은 것으로 시작한다.
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
      console.error(error);
      this.failed = true;
      if (this.notices.length) this.showToast('새 목록을 받지 못했어요. 잠시 뒤 새로고침해 주세요');
    } finally {
      this.loading = false;
    }
  }

  async signIn() {
    if (!authClient || this.authBusy) return;
    this.authBusy = true; this.authError = '';
    try {
      const { error } = await authClient.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: new URL('./', location.href).href } });
      if (error) throw error;
    } catch {
      this.authError = '로그인을 시작하지 못했어요. 잠시 뒤 다시 시도해 주세요.';
      this.authBusy = false;
    }
  }

  async signOut() {
    if (!authClient || this.authBusy) return;
    this.authBusy = true; this.authError = '';
    try {
      // 세션이 살아 있을 때 이 기기의 알림을 먼저 끈다. 실패해도 로그아웃은 막지 않는다.
      if (this.authUserId && this.pushStatus === 'on' && this.pushRegistration) {
        await disableDevicePush(authClient, this.authUserId, this.pushRegistration, localStorage).catch(() => false);
      }
      const { error } = await authClient.auth.signOut({ scope: 'local' });
      if (error) throw error;
    } catch {
      this.authError = '로그아웃을 완료하지 못했어요. 다시 확인해 주세요.';
    } finally { this.authBusy = false; }
  }

  async collectNow() {
    await this.refresh();
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

  markRead(notice: Notice) {
    if (this.isRead(notice)) return;
    this.updateRead([notice.id], true);
  }

  toggleReadSelection(id: string) {
    this.selectedReads = this.selectedReads.includes(id)
      ? this.selectedReads.filter((selected) => selected !== id) : [...this.selectedReads, id];
  }

  markSelectedRead(read: boolean) {
    const selected = new Set(this.selectedReads);
    const changed = this.visible().filter((notice) => selected.has(notice.id) && this.isRead(notice) !== read);
    if (!changed.length) return;
    this.updateRead(changed.map((notice) => notice.id), read);
    this.closeSelection();
    this.showToast(`${changed.length}개를 ${read ? '읽음' : '읽지 않음'}으로 표시했어요`);
  }

  closeSelection() {
    this.selecting = false;
    this.selectedReads = [];
    this.updateComplete.then(() => qs<HTMLButtonElement>('.select-trigger')?.focus({ preventScroll: true }));
  }

  isRead(notice: Notice): boolean { return this.readState === null || isNoticeRead(this.readState, notice.id, notice.changed_at); }

  isSaved(notice: Notice): boolean { return this.saved.some((item) => item.id === notice.id); }

  toggleSave(notice: Notice) {
    const next = toggleSaved(this.saved, notice);
    if (!next) { this.showToast('저장할 수 있는 공지가 가득 찼어요. 안 쓰는 저장을 지워 주세요'); return; }
    const added = next.length > this.saved.length;
    this.saved = next;
    storeSaved(next);
    this.showToast(added ? '저장했어요' : '저장을 지웠어요');
    this.uploadStates((guard) => pushSaved(authClient!, [{ id: notice.id, saved: added }], guard));
  }

  /** 저장한 글. 지금 목록에 있으면 최신 정보로, 밀려났으면 저장할 때 정보로 보여 준다. */
  savedNotices(): Notice[] {
    return orderSaved(this.saved, this.notices, this.savedSort);
  }

  judgement(notice: Notice): Judgement | undefined { return this.matched?.items[notice.id]; }

  /** 이 글에 맞는 관심 키워드: 이 기기의 글자 매칭 + 서버의 글자 매칭 + Gemini가 뜻으로 맞춘 것 */
  interests(notice: Notice): string[] {
    // 제목과 분류(이 기기에서) + 서버가 본문과 그림 글자에서 찾은 것. 판정 이유 문장은 보지 않는다(D-024).
    const judgement = this.judgement(notice);
    const text = `${notice.title} ${notice.title_ko ?? ''} ${notice.category ?? ''}`;
    const found = new Set(this.keywords.filter((word) => keywordMatches(word, text)));
    for (const word of judgement?.interests ?? []) {
      if (this.keywords.includes(word)) found.add(word);
    }
    return [...found];
  }

  filtered(notices = this.notices): Notice[] {
    const query = this.query.trim().toLowerCase();
    return notices.filter((n) => {
      const board = this.activeBoard();
      if (board !== 'all' && n.source_id !== board) return false;
      if (this.keyword && !this.interests(n).includes(this.keyword)) return false;
      if (!query) return true;
      return `${n.title} ${n.title_ko ?? ''} ${n.category ?? ''} ${this.judgement(n)?.ai?.reason ?? ''}`.toLowerCase().includes(query);
    });
  }

  // 지금 탭에 맞는 게시판들. 인턴 공고 탭은 외부 게시판, 그 밖은 학교 게시판.
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

  // 로그인 사용자의 저장·읽음을 서버와 맞춘다. 공지 목록이 있어야 서버에만 있는 저장의 글 정보를 찾을 수 있다.
  // 병합 → 저장 업로드 → 읽음 업로드 순서의 체인이며, 업로드가 일부 실패하면 다음 새로고침에서 실패한 단계부터 이어 간다.
  async syncStates(): Promise<void> {
    const userId = this.authUserId, epoch = this.subscriptionsEpoch;
    if (!authClient || !userId || !this.notices.length || this.stateSyncedEpoch === epoch) return;
    if (!this.stateChain || this.stateChain.epoch !== epoch) {
      const client = authClient;
      let plan: StatePlan | null = null;
      const syncable = (id: string) => this.isSyncable(id);
      // 단계 사이와 청크 사이마다 앱의 계정 상태와 실제 세션이 모두 같은 사용자인지 확인한다.
      const same = async () => epoch === this.subscriptionsEpoch && this.authUserId === userId && await sessionIs(client, userId);
      const chain = connectionChain([
        async () => {
          const remote = await loadNoticeStates(client, userId);
          if (epoch !== this.subscriptionsEpoch) throw new Error('계정이 바뀌었어요');
          plan = planStateSync(remote, this.saved, this.readState ?? parseReadState(null), this.notices);
          this.saved = plan.saved; storeSaved(plan.saved);
          this.readState = plan.read; this.read = readIds(plan.read); storeReadState(plan.read);
        },
        async () => { if (!await pushSaved(client, plan!.uploadSaved.filter((item) => syncable(item.id)), same)) throw new Error('저장을 올리지 못했어요'); },
        async () => { if (!await pushRead(client, plan!.uploadRead.filter((item) => syncable(item.id)), same)) throw new Error('읽음을 올리지 못했어요'); },
      ]);
      this.stateChain = { run: () => chain.run(), epoch };
    }
    const current = this.stateChain;
    try {
      await current.run();
      if (epoch === this.subscriptionsEpoch) this.stateSyncedEpoch = epoch;
    } catch {
      if (epoch === this.subscriptionsEpoch) this.showToast('저장과 읽음을 계정과 맞추지 못했어요. 잠시 뒤 이어서 시도할게요');
      else if (this.stateChain === current) this.stateChain = null;
    }
  }

  async refreshProfile(userId: string, epoch: number): Promise<void> {
    if (!authClient) return;
    try {
      const row = await loadProfile(authClient, userId);
      if (epoch !== this.subscriptionsEpoch) return;
      this.profile = row ?? EMPTY_PROFILE;
      this.profileStatus = 'ready';
    } catch {
      // 테이블이 아직 없거나 읽지 못하면 온보딩을 띄우지 않는다(설정에서는 그대로 쓸 수 있다).
      if (epoch === this.subscriptionsEpoch) this.profileStatus = 'unavailable';
    }
  }

  /** 첫 로그인 설정을 보여 줄지. 한 번 끝냈거나 건너뛴 사람에게는 다시 띄우지 않는다. */
  needsOnboarding(): boolean {
    if (!this.authUserId) return false;
    if (this.onboardingOpen) return true;
    return this.profileStatus === 'ready' && !this.profile.onboardedAt && !this.onboardingDismissed;
  }

  openOnboarding() { this.onboardingManual = true; this.onboardingError = ''; this.onboardingOpen = true; }

  closeOnboarding() { this.onboardingOpen = false; this.onboardingManual = false; this.onboardingError = ''; }

  /** 나중에 하기. 직접 연 경우는 닫기만 하고, 처음이면 이 계정에서는 다시 묻지 않는다. */
  dismissOnboarding() {
    if (!this.onboardingManual) { remember('onboarding-dismissed', '1'); this.onboardingDismissed = true; }
    this.closeOnboarding();
  }

  /**
   * 프로필 저장 → 게시판 구독 반영 → 키워드 저장 순서로 끝낸다. 중간에 실패하면 같은 내용으로 다시 부를 때
   * 끝낸 단계는 건너뛰고 실패한 단계부터 이어서 저장한다. 계정이 바뀌면 단계마다 멈춘다.
   */
  async finishOnboarding(draft: Draft): Promise<boolean> {
    const userId = this.authUserId, epoch = this.subscriptionsEpoch, client = authClient;
    if (!client || !userId || this.onboardingBusy) return false;
    let words: string[];
    try { words = parseKeywords(draft.keywords.join('\n')); }
    catch (error) { this.onboardingError = error instanceof Error ? error.message : '키워드를 확인해 주세요.'; return false; }
    const key = JSON.stringify([userId, epoch, draft]);
    const nextProfile: UserProfile = {
      ...this.profile, programs: draft.programs, year: draft.year, enrollmentStatus: draft.enrollmentStatus,
      onboardedAt: this.profile.onboardedAt ?? new Date().toISOString(),
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
      if (epoch !== this.subscriptionsEpoch) return false;
      this.profile = nextProfile; this.subscriptions = boards; this.setKeywords(words);
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
      await registration.showNotification(APP_NAME, { body: '이렇게 알림이 와요', icon: new URL('icon-192.png', registration.scope).href, tag: 'skku-notice-test' });
    } catch {
      this.showToast('테스트 알림을 띄우지 못했어요');
    }
  }

  async refreshByok(userId: string, epoch: number): Promise<void> {
    if (!authClient || !this.byokOn) { if (epoch === this.subscriptionsEpoch) this.byokLoading = false; return; }
    try {
      const [status, canvas] = await Promise.all([loadByokStatus(authClient, userId), loadCanvasStatus(authClient, userId).catch(() => null)]);
      if (epoch !== this.subscriptionsEpoch) return;
      this.byokStatus = status; this.canvasStatus = canvas; this.byokError = '';
    } catch {
      if (epoch === this.subscriptionsEpoch) this.byokError = '키 정보를 불러오지 못했어요. 잠시 뒤 다시 시도해 주세요.';
    } finally {
      if (epoch === this.subscriptionsEpoch) this.byokLoading = false;
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
      if (epoch === this.subscriptionsEpoch) this.byokStatus = status;
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
      if (epoch === this.subscriptionsEpoch) this.canvasStatus = status;
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
      if (epoch === this.subscriptionsEpoch) this.canvasStatus = null;
    } catch (error) {
      if (epoch === this.subscriptionsEpoch) this.canvasError = error instanceof Error ? error.message : '토큰을 지우지 못했어요.';
    } finally {
      if (epoch === this.subscriptionsEpoch) this.canvasBusy = false;
    }
  }

  // ----- 구글 캘린더 -----
  private takeCalendarPending(): boolean {
    try { const on = sessionStorage.getItem('google-calendar-pending') === '1'; sessionStorage.removeItem('google-calendar-pending'); return on; } catch { return false; }
  }

  private rememberGoogleToken(value: string): void {
    try { sessionStorage.setItem('google-calendar-token', JSON.stringify({ value, at: Date.now() })); } catch { /* 이 탭의 메모리에는 없으므로 다시 허용을 받는다 */ }
  }

  private forgetGoogleToken(): void {
    try { sessionStorage.removeItem('google-calendar-token'); sessionStorage.removeItem('google-calendar-pending'); } catch { /* 없어도 된다 */ }
  }

  /** 구글 접근 토큰은 1시간 안에 만료돼서 50분까지만 쓴다. 서버에는 보내지 않고 이 탭에만 둔다. */
  private googleToken(): string | null {
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
    } catch { /* 표가 아직 없으면 연결 전으로 보인다 */ }
  }

  /** 구글에서 캘린더 권한을 허용받는다. 허용하면 이 화면으로 돌아와 곧바로 일정을 맞춘다. */
  async connectCalendar(): Promise<void> {
    if (!authClient || !this.authUserId || this.calendarBusy) return;
    this.calendarError = '';
    try {
      sessionStorage.setItem('google-calendar-pending', '1');
      const { error } = await authClient.auth.signInWithOAuth({
        provider: 'google',
        options: { scopes: CALENDAR_SCOPE, redirectTo: new URL('./?view=settings&section=calendar', location.href).href, queryParams: { include_granted_scopes: 'true' } },
      });
      if (error) throw error;
    } catch {
      this.calendarError = '구글 연결을 시작하지 못했어요. 잠시 뒤 다시 눌러 주세요';
    }
  }

  /** 저장한 공지의 마감을 캘린더에 맞춘다. 토큰이 없거나 만료됐으면 구글에서 다시 허용받는다. */
  async syncCalendarNow(): Promise<void> {
    const userId = this.authUserId, epoch = this.subscriptionsEpoch;
    if (!authClient || !userId || this.calendarBusy) return;
    const token = this.googleToken();
    if (!token) { this.calendarMessage = '구글에서 다시 허용하면 바로 맞춰요'; await this.connectCalendar(); return; }
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
      this.calendarMessage = events.size ? `저장한 공지의 마감 ${events.size}개를 캘린더에 맞췄어요` : '마감이 남은 저장 공지가 없어서 넣을 일정이 없어요';
    } catch (error) {
      if (epoch === this.subscriptionsEpoch) {
        this.calendarError = error instanceof GoogleError ? error.message : '캘린더에 맞추지 못했어요. 잠시 뒤 다시 눌러 주세요';
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
      const { error } = await authClient.from('user_calendar').delete().eq('user_id', userId);
      if (error) throw error;
      this.forgetGoogleToken();
      if (epoch === this.subscriptionsEpoch) { this.calendarId = null; this.calendarSyncedAt = null; this.calendarMessage = '연결을 끊었어요. 구글 캘린더의 "성대 공지"는 직접 지워 주세요'; }
    } catch {
      if (epoch === this.subscriptionsEpoch) this.calendarError = '연결을 끊지 못했어요. 잠시 뒤 다시 눌러 주세요';
    } finally {
      if (epoch === this.subscriptionsEpoch) this.calendarBusy = false;
    }
  }

  async removeKey(): Promise<void> {
    const userId = this.authUserId, epoch = this.subscriptionsEpoch;
    if (!authClient || !userId || this.byokBusy) return;
    this.byokBusy = true; this.byokError = '';
    try {
      await removeByokKey(authClient);
      if (epoch === this.subscriptionsEpoch) this.byokStatus = null;
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
      if (epoch === this.subscriptionsEpoch) { this.profile = profile; this.profileMessage = '저장했어요.'; }
    } catch (error) {
      if (epoch === this.subscriptionsEpoch) this.profileError = error instanceof Error && /[가-힣]/.test(error.message) ? error.message : '저장하지 못했어요. 잠시 뒤 다시 시도해 주세요.';
    } finally {
      if (epoch === this.subscriptionsEpoch) this.byokBusy = false;
    }
  }

  async releasePush(userId: string): Promise<void> {
    try {
      const registration = this.pushRegistration ?? await navigator.serviceWorker?.getRegistration() ?? null;
      if (registration) await releaseDevicePush(userId, registration, localStorage);
    } catch { /* 다음 로그인에서 소유자 표시로 다시 정리한다 */ }
  }

  async refreshPush(userId: string, epoch: number): Promise<void> {
    if (!authClient) return;
    const supported = isSecureContext && 'Notification' in window && 'serviceWorker' in navigator && 'PushManager' in window;
    if (!supported) { if (epoch === this.subscriptionsEpoch) this.pushStatus = 'unsupported'; return; }
    try {
      const [registration, config] = await Promise.all([
        navigator.serviceWorker.ready,
        fetch(new URL('push-config.json', document.baseURI), { cache: 'no-store' }).then((r) => r.ok ? r.json() as Promise<{ vapidPublicKey?: string }> : null).catch(() => null),
      ]);
      if (epoch !== this.subscriptionsEpoch) return;
      this.pushRegistration = registration;
      this.pushVapidKey = config?.vapidPublicKey ?? null;
      const on = await inspectDevicePush(authClient, userId, registration, localStorage);
      if (epoch !== this.subscriptionsEpoch) return;
      this.pushStatus = on ? 'on' : Notification.permission === 'denied' ? 'denied' : 'off';
    } catch {
      if (epoch === this.subscriptionsEpoch) { this.pushStatus = 'off'; this.pushError = '알림 상태를 확인하지 못했어요. 잠시 뒤 다시 시도해 주세요.'; }
    }
  }

  // 클릭 핸들러에서 직접 불린다. 첫 await가 권한 요청이어야 브라우저가 사용자 동작으로 인정한다.
  // 실패하면 체인을 남겨 두어 "다시 시도"가 끝난 단계는 건너뛰고 실패한 단계부터 이어 가게 한다.
  async enablePush(): Promise<void> {
    const userId = this.authUserId, epoch = this.subscriptionsEpoch, registration = this.pushRegistration;
    if (!authClient || !userId || this.pushStatus !== 'off') return;
    if (!registration || !this.pushVapidKey) { this.pushError = '알림 설정을 아직 불러오지 못했어요. 잠시 뒤 다시 시도해 주세요.'; return; }
    if (!this.pushChain || this.pushChain.userId !== userId || this.pushChain.epoch !== epoch) {
      this.pushChain = { chain: createEnableChain(authClient, userId, registration, localStorage, this.pushVapidKey, () => Notification.requestPermission()), userId, epoch };
    }
    const current = this.pushChain;
    this.pushStatus = 'busy'; this.pushError = '';
    try {
      await current.chain.run();
      if (epoch === this.subscriptionsEpoch) { this.pushStatus = 'on'; this.pushRetry = false; }
      if (this.pushChain === current) this.pushChain = null;
    } catch (error) {
      if (epoch === this.subscriptionsEpoch) {
        const denied = Notification.permission === 'denied';
        this.pushStatus = denied ? 'denied' : 'off';
        this.pushRetry = !denied;
        if (denied && this.pushChain === current) { this.pushChain = null; void current.chain.discard(); }
        this.pushError = error instanceof Error && /[가-힣]/.test(error.message) ? error.message : '알림을 켜지 못했어요. 다시 시도하면 이어서 진행해요.';
      } else {
        // 기다리는 동안 계정이 바뀌었다면 서버에 못 올린 구독을 이 기기에서 끊는다.
        if (this.pushChain === current) this.pushChain = null;
        void current.chain.discard();
      }
    } finally {
      // 성공했어도 그 사이 계정이 바뀌었다면 이전 사용자 소유로 남은 구독을 이 기기에서 끊는다.
      if (epoch !== this.subscriptionsEpoch) void this.releasePush(userId);
    }
  }

  async disablePush(): Promise<void> {
    const userId = this.authUserId, epoch = this.subscriptionsEpoch, registration = this.pushRegistration;
    if (!authClient || !userId || !registration || this.pushStatus !== 'on') return;
    this.pushStatus = 'busy'; this.pushError = '';
    try {
      const cleaned = await disableDevicePush(authClient, userId, registration, localStorage);
      if (epoch === this.subscriptionsEpoch) {
        this.pushStatus = 'off';
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
        await saveKeywordsPreference(client, userId, this.keywords);
        if (epoch === this.subscriptionsEpoch) this.keywordNote = '계정에 저장했어요';
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
      if (epoch === this.subscriptionsEpoch) this.subscriptions = sources;
    } catch {
      if (epoch === this.subscriptionsEpoch) this.subscriptionsError = '구독을 불러오지 못했어요. 다시 시도해 주세요.';
    } finally {
      if (epoch === this.subscriptionsEpoch) this.subscriptionsLoading = false;
    }
  }

  async toggleSubscription(sourceId: string, enabled: boolean): Promise<void> {
    const userId = this.authUserId;
    const epoch = this.subscriptionsEpoch;
    if (!authClient || !userId || this.subscriptionsLoading) return;
    this.subscriptionsLoading = true;
    this.subscriptionsError = '';
    try {
      await setSubscription(authClient, userId, sourceId, enabled);
      if (epoch === this.subscriptionsEpoch) {
        this.subscriptions = enabled ? [...this.subscriptions, sourceId] : this.subscriptions.filter((id) => id !== sourceId);
      }
    } catch {
      if (epoch === this.subscriptionsEpoch) this.subscriptionsError = '구독을 저장하지 못했어요. 다시 시도해 주세요.';
    } finally {
      if (epoch === this.subscriptionsEpoch) this.subscriptionsLoading = false;
    }
  }

  /**
   * 사이드바와 게시판 선택에 보일 게시판. 학교 공지 탭에서는 로그인한 사람이 구독한 게시판(처음 설정을 마쳤다면 전공에 맞춰 추천된 것)만 보이고,
   * 구독이 없거나 로그인 전이면 지금 공지가 있는 기본 게시판만 보인다. 전체 게시판 목록의 수십 개 학과 게시판이 한꺼번에 나열되지 않게 한다.
   */
  tabSources(): Source[] {
    const external = this.tab() === 'intern';
    const all = this.sources.filter((s) => Boolean(s.external) === external);
    if (external) return all;
    const subscribed = this.authUserId && !this.subscriptionsLoading && this.subscriptions.length > 0;
    const withNotices = new Set(this.notices.map((n) => n.source_id));
    const chosen = all.filter((s) => (subscribed ? this.subscriptions.includes(s.id) : withNotices.has(s.id)));
    // 지금 보고 있는 게시판은 목록에서 사라지지 않게 한다.
    const current = all.filter((s) => s.id === this.board && !chosen.includes(s));
    return [...chosen, ...current];
  }

  // 고른 게시판이 지금 탭에 없으면 모든 게시판으로 본다(탭을 오가도 빈 목록이 되지 않게).
  activeBoard(): string { return this.tabSources().some((s) => s.id === this.board) ? this.board : 'all'; }

  isExternal(notice: Notice): boolean { return Boolean(this.sources.find((s) => s.id === notice.source_id)?.external); }

  byTab(list: Notice[], tab: Tab): Notice[] {
    if (tab === 'saved') return list;
    const external = tab === 'intern';
    // 출처: https://freshrss.github.io/FreshRSS/en/users/10_filter.html (읽음 상태 필터)
    // 읽고 있는 글은 상세를 닫거나 다른 글로 옮길 때까지 남긴다.
    const scoped = list.filter((n) => !n.deadline || !deadlinePassed(n.deadline))
      .filter((n) => this.isExternal(n) === external)
      .filter((n) => tab !== 'all' || !this.authUserId || !this.subscriptionsOnly
        || (!this.subscriptionsLoading && !this.subscriptionsError && this.subscriptions.includes(n.source_id)))
      .filter((n) => !this.unreadOnly || !this.isRead(n) || n.id === this.selectedId || n.id === this.openedId);
    return orderNotices(scoped, this.sortFor(tab));
  }

  sortFor(tab: Tab): Sort { return tab === 'saved' ? this.savedSort : tab === 'intern' ? this.internSort : this.sort; }

  tab(): Tab { return this.view === 'settings' ? 'all' : this.view; }
  visible(): Notice[] {
    return this.tab() === 'saved' ? this.filtered(this.savedNotices()) : this.byTab(this.filtered(), this.tab());
  }

  setView(view: View) {
    const entering = view === 'settings' && this.view !== 'settings';
    this.selecting = false; this.selectedReads = [];
    this.view = view;
    this.openedId = null;
    this.boardMenuOpen = false;
    this.sortMenuOpen = false;
    if (view !== 'settings') remember('tab', view);
    // 주소도 보기와 맞춘다. 설정은 기록에 쌓아 뒤로 가기로 닫히고, 탭은 바꿔 써서 새로고침해도 같은 보기가 열린다.
    if (entering) history.pushState({ view: 'settings', depth: 1 }, '', `${location.pathname}?view=settings`);
    else if (view !== 'settings') history.replaceState(null, '', `${location.pathname}?tab=${view}`);
    this.selectedId = null;
    window.scrollTo({ top: 0 });
    qsel('.list-pane')?.scrollTo({ top: 0 });
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
    if (!this.settingsSection) return;
    const depth = this.settingsDepth();
    if (depth > 1) { history.go(-(depth - 1)); return; }
    history.replaceState({ view: 'settings', depth: 1 }, '', this.settingsUrl(null));
    this.settingsSection = null;
    window.scrollTo({ top: 0 });
  };

  /** 어느 화면에서든 설정의 해당 쪽으로 바로 간다(키워드 관리하기, 게시판 고르기 같은 단축). */
  openSettings(section: string | null) {
    if (this.view === 'settings') { this.openSettingsSection(section); return; }
    this.setView('settings');
    if (section) {
      history.replaceState({ view: 'settings', depth: 1 }, '', this.settingsUrl(section));
      this.settingsSection = section;
    }
  }

  /** 뒤로 가기 화살표와 "설정으로": 하위 쪽에서는 첫 쪽으로 한 단계, 첫 쪽에서는 설정을 닫는다. */
  backSettings = () => {
    if (!this.settingsSection) { this.closeSettings(); return; }
    if (this.settingsDepth() > 1) { history.back(); return; }
    history.replaceState({ view: 'settings', depth: 1 }, '', this.settingsUrl(null));
    this.settingsSection = null;
    window.scrollTo({ top: 0 });
  };

  /** 설정을 한 번에 닫고 들어오기 전에 보던 보기로 돌아간다. 첫 쪽의 X와 Esc가 쓴다. */
  closeSettings = () => {
    const depth = this.settingsDepth();
    if (depth > 0) { history.go(-depth); return; }
    const last = normalizeTab(remember('tab'));
    this.settingsSection = null;
    this.setView(isTab(last) ? last : 'all');
  };

  /** X와 Esc: 하위 쪽에서는 한 단계 앞(설정 첫 쪽)으로, 첫 쪽에서는 설정을 나간다. 다시 들어오면 첫 쪽부터 시작한다. */
  leaveSettings = this.backSettings;

  onPopState = () => {
    this.openedId = typeof history.state?.notice === 'string' ? history.state.notice : null;
    this.boardMenuOpen = false;
    this.sortMenuOpen = false;
    this.settingsSection = settingsSectionFromUrl();
    const params = new URLSearchParams(location.search);
    const view: View = params.get('view') === 'settings' ? 'settings'
      : [normalizeTab(params.get('tab')), normalizeTab(remember('tab'))].find(isTab) ?? 'all';
    const requested = params.get('sort');
    if (params.get('tab') === 'deadline') this.sort = 'deadline';
    else if (requested === 'latest' || requested === 'deadline') {
      if (view === 'intern') this.internSort = requested;
      else if (view === 'all') this.sort = requested;
    }
    remember('notice-sort', this.sort);
    remember('intern-sort', this.internSort);
    if (view !== this.view) { this.view = view; this.selectedId = null; this.selecting = false; this.selectedReads = []; }
  };

  setBoard(board: string) {
    this.board = board; this.boardMenuOpen = false; this.selectedId = null; this.selectedReads = []; remember('board', board);
  }
  setKeyword(word: string | null) {
    this.keyword = word;
    this.selectedReads = [];
    this.selectedId = null;
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

  async copyLink(notice: Notice) {
    try {
      await navigator.clipboard.writeText(safeUrl(notice.url));
      this.showToast('원문 링크를 복사했어요');
    } catch {
      this.showToast('복사하지 못했어요');
    }
  }

  // 휴대폰은 카카오톡 같은 앱으로 바로 보내는 공유 창을 쓴다. 없으면 링크를 복사한다.
  async share(notice: Notice) {
    if (!navigator.share) { this.copyLink(notice); return; }
    try { await navigator.share({ title: cleanTitle(notice.title_ko || notice.title), url: safeUrl(notice.url) }); } catch { /* 닫으면 그대로 둔다 */ }
  }

  showToast(text: string, link: string | null = null, linkLabel = '') {
    this.toast = text;
    this.toastLink = link;
    this.toastLinkLabel = linkLabel;
    clearTimeout(this.toastTimer);
    if (!link) this.toastTimer = window.setTimeout(() => { this.toast = ''; }, 3500);
  }

  async runInstall() {
    if (!this.install) return;
    await this.install.prompt();
    this.install = null;
  }

  onKey(event: KeyboardEvent) {
    const target = event.target as Element | null;
    // 첫 로그인 설정 창이 떠 있으면 Esc는 그 창이 처리한다(뒤쪽 화면이 같이 닫히지 않게).
    if (this.needsOnboarding()) return;
    if (event.key === 'Escape' && this.sortMenuOpen) {
      event.preventDefault();
      this.sortMenuOpen = false;
      this.updateComplete.then(() => qs<HTMLButtonElement>('.sort-trigger')?.focus());
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
    if (event.key === 'Escape' && this.isWide && this.detailOpen && this.shownId) { this.setDetail(false); return; }
    // 단추나 링크에 포커스가 있으면 Enter는 그 요소의 기본 동작에 맡긴다.
    if (event.key === 'Enter' && target?.closest(INTERACTIVE)) return;
    const list = this.visible();
    const index = list.findIndex((n) => n.id === (this.selectedId ?? this.shownId));
    const move = (step: number) => {
      const next = list[Math.max(0, Math.min(list.length - 1, index + step))];
      if (!next) return;
      this.selectedId = next.id;
      if (this.isWide) { this.setDetail(true); this.markRead(next); }
      this.updateComplete.then(() => qsel(`[data-id="${CSS.escape(next.id)}"]`)?.scrollIntoView({ block: 'nearest' }));
    };
    const actions: Record<string, () => void> = {
      '/': () => qs<HTMLInputElement>('.search input')?.focus(),
      j: () => move(1), ArrowDown: () => move(1), k: () => move(-1), ArrowUp: () => move(-1),
      Enter: () => { const notice = list[index]; if (notice) { this.markRead(notice); window.open(safeUrl(notice.url), '_blank', 'noopener'); } },
      r: () => this.collectNow(), 1: () => this.setView('all'), 2: () => this.setView('intern'), 3: () => this.setView('saved'),
      s: () => { const notice = list[index]; if (notice) this.toggleSave(notice); },
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
  summary(notice: Notice): string | null {
    const userId = this.authUserId;
    if (!authClient || !userId) return null;
    const cached = this.summaries.get(notice.id);
    if (cached !== undefined) return cached === 'loading' ? null : cached;
    this.summaries.set(notice.id, 'loading');
    const epoch = this.subscriptionsEpoch;
    loadNoticeSummary(authClient, userId, notice.id).catch(() => null).then((text) => {
      if (epoch !== this.subscriptionsEpoch || userId !== this.authUserId) return;
      this.summaries.set(notice.id, text);
      this.requestUpdate();
    });
    return null;
  }

  /** 상세 화면의 "요약 만들기". 내 Gemini 키가 있어야 하고, 만든 요약은 저장돼서 다시 만들지 않는다. */
  async makeSummary(notice: Notice): Promise<void> {
    const userId = this.authUserId, epoch = this.subscriptionsEpoch;
    if (!authClient || !userId || this.summarizing) return;
    this.summarizing = notice.id; this.summaryError = '';
    try {
      const text = await requestNoticeSummary(authClient, notice.id);
      if (epoch !== this.subscriptionsEpoch) return;
      this.summaries.set(notice.id, text);
    } catch (error) {
      if (epoch === this.subscriptionsEpoch) this.summaryError = error instanceof Error && /[가-힣]/.test(error.message) ? error.message : '요약을 만들지 못했어요. 잠시 뒤 다시 눌러 주세요.';
    } finally {
      if (epoch === this.subscriptionsEpoch) this.summarizing = null;
    }
  }

  body(notice: Notice): NoticeBody | null | 'loading' {
    const cached = this.bodies.get(notice.id);
    if (cached !== undefined) return cached;
    this.bodies.set(notice.id, 'loading');
    const generation = this.generatedAt;
    fetchBody(notice).catch(() => null).then((body) => {
      if (generation !== this.generatedAt) return;
      this.bodies.set(notice.id, body);
      this.requestUpdate();
    });
    return 'loading';
  }
}

defineReactive(AppController, Object.keys(AppController.properties));
