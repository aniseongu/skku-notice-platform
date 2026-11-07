// 화면 전체. 규칙은 docs/DESIGN.md, docs/design/ux-rules.md, docs/design/platforms.md.
// 그림자 DOM을 쓰지 않는다(전역 토큰과 글꼴을 그대로 받으려고). 학교 글자는 Lit 템플릿으로만 넣어 자동 이스케이프한다.
import { LitElement, html, nothing, type TemplateResult } from 'lit';
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
import './platform-settings';
import { loadNoticeStates, planStateSync, pushRead, pushSaved, type StatePlan } from './notice-state-sync';
import { connectionChain } from './connection-chain';
import { createEnableChain, disableDevicePush, inspectDevicePush, releaseDevicePush } from './platform-browser-push';
import './notice-rows';
import './notice-detail';
import { localKey, setLocalOwner } from './local-scope.ts';
import type { Subscription } from '@supabase/supabase-js';
import { orderNotices, type Sort } from './notice-order';

type Tab = 'all' | 'intern' | 'saved';
type View = Tab | 'settings';
const TABS: { id: Tab; label: string; icon: IconName }[] = [
  { id: 'all', label: '성대 공지', icon: 'list' },
  // 전체는 성균관대 공지만, 인턴 공고는 링커리어와 자소설닷컴(사용자 결정 2026-11-03, D-026).
  { id: 'intern', label: '인턴 공고', icon: 'briefcase' },
  { id: 'saved', label: '저장', icon: 'bookmark' },
];
const STALE_MS = 2 * 3600_000;
// 화면을 켜 둔 채로 있어도 1시간 주기의 새 공지와 D-day가 바뀌도록 5분마다 다시 받는다.
const REFRESH_MS = 5 * 60_000;
const isTab = (value: string | null): value is Tab => TABS.some((t) => t.id === value);
const normalizeTab = (value: string | null) => value === 'mine' || value === 'deadline' ? 'all' : value;
const INTERACTIVE = 'a, button, input, textarea, select, [contenteditable]';
const wide = matchMedia('(min-width: 1080px)');
const browserTab = matchMedia('(display-mode: browser)');

function settingsTitle(): string {
  const params = new URLSearchParams(location.search);
  if (params.get('keys') === '1') return '연결 키';
  return ({ notifications: '알림', keywords: '관심 키워드', connection: '기기 연결', calendar: '캘린더' } as Record<string, string>)[params.get('section') ?? ''] ?? '설정';
}

interface InstallPrompt extends Event { prompt(): Promise<void> }

function remember(key: string, value?: string): string | null {
  try {
    const storageKey = ['keywords', 'board', 'view-unread', 'subscriptions-only'].includes(key) ? localKey(key) : key;
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

// 단축키 표시(Primer KeybindingHint 방식: 키 하나에 kbd 하나, 사방 1px 테두리). 화면 낭독기에는 aria-keyshortcuts로 알린다.
const kbd = (...keys: string[]) => html`<span class="kbd-group" aria-hidden="true">${keys.map((k) => html`<kbd class="kbd">${k}</kbd>`)}</span>`;

const SHORTCUTS: { group: string; items: [string, string[]][] }[] = [
  { group: '목록', items: [['다음 공지', ['J']], ['이전 공지', ['K']], ['원문 열기', ['Enter']], ['저장하기', ['S']], ['상세 칸 닫기', ['Esc']]] },
  { group: '이동', items: [['성대 공지', ['1']], ['인턴 공고', ['2']], ['저장', ['3']], ['검색', ['/']]] },
  { group: '그 밖', items: [['공지 다시 가져오기', ['R']], ['설정 닫기', ['Esc']], ['단축키 보기', ['?']]] },
];

const icon = (name: IconName) => html`<svg class="i" aria-hidden="true"><use href="icons/sprite.svg#${name}"></use></svg>`;
const gearIcon = html`<svg class="i" aria-hidden="true" viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/>
  <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>`;

export class NoticeApp extends LitElement {
  static properties = {
    notices: { state: true }, sources: { state: true }, matched: { state: true }, generatedAt: { state: true },
    view: { state: true }, board: { state: true }, keyword: { state: true }, keywords: { state: true }, query: { state: true },
    loading: { state: true }, failed: { state: true }, selectedId: { state: true }, install: { state: true },
    toast: { state: true }, toastLink: { state: true }, toastLinkLabel: { state: true }, isWide: { state: true }, theme: { state: true },
    detailOpen: { state: true }, openedId: { state: true }, shortcutsOpen: { state: true }, boardMenuOpen: { state: true }, sortMenuOpen: { state: true },
    saved: { state: true }, read: { state: true }, collapsed: { state: true }, sort: { state: true }, internSort: { state: true }, savedSort: { state: true },
    authReady: { state: true }, authUserId: { state: true }, authEmail: { state: true }, authError: { state: true }, authBusy: { state: true }, pushStatus: { state: true }, pushError: { state: true }, pushRetry: { state: true },
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
  private subscriptionsEpoch = 0;
  pushStatus: 'unsupported' | 'checking' | 'off' | 'on' | 'busy' | 'denied' = 'checking';
  pushError = '';
  // 클릭 안에서 권한 요청을 바로 부르려면 등록과 공개키를 미리 받아 둔다.
  private pushRegistration: ServiceWorkerRegistration | null = null;
  private pushVapidKey: string | null = null;
  private stateSyncedEpoch = -1;
  private stateChain: { run: () => Promise<void>; epoch: number } | null = null;
  // 실패한 켜기 작업을 이어서 실행하기 위해 사용자와 epoch마다 하나만 보관한다.
  private pushChain: { chain: ReturnType<typeof createEnableChain>; userId: string; epoch: number } | null = null;
  pushRetry = false;
  authReady = !authClient;
  authEmail: string | null = null;
  authError = '';
  authBusy = false;
  authUserId: string | null = null;
  private authSubscription: Subscription | null = null;
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
  private readState = loadReadState();
  private needsReadBaseline = this.readState === null;
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
  private bodies = new Map<string, NoticeBody | null | 'loading'>();
  private toastTimer = 0;
  // 상세 칸에 실제로 보이는 글(고른 글이 없으면 첫 글). 목록 행 표시와 맞춘다.
  private shownId: string | null = null;

  createRenderRoot() { return this; }

  connectedCallback() {
    super.connectedCallback();
    // 새 문서는 목록에서 시작한다. 이전 문서의 상세 history 상태가 설정 닫기에서 되살아나지 않게 맞춘다.
    if (history.state?.notice) history.replaceState(null, '');
    remember('notice-sort', this.sort);
    remember('intern-sort', this.internSort);
    applyTheme(this.theme);
    if (authClient) {
      this.authSubscription = authClient.auth.onAuthStateChange((_event, session) => {
        const userId = session?.user.id ?? null;
        if (!this.authReady || userId !== this.authUserId) {
          const previousUserId = this.authUserId;
          this.authUserId = userId;
          this.pushStatus = userId ? 'checking' : 'off'; this.pushError = ''; this.pushRetry = false;
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
          if (userId) setTimeout(() => { void this.refreshSubscriptions(userId, epoch); void this.refreshPreferences(userId, epoch); void this.refreshPush(userId, epoch); void this.syncStates(); }, 0);
          setLocalOwner(userId);
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

  disconnectedCallback() {
    this.authSubscription?.unsubscribe();
    this.authSubscription = null;
    document.removeEventListener('pointerdown', this.closeBoardMenuOutside);
    super.disconnectedCallback();
  }

  private closeBoardMenuOutside = (event: PointerEvent) => {
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

  private async signIn() {
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

  private async signOut() {
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

  private async collectNow() {
    await this.refresh();
  }

  private updateRead(ids: string[], read: boolean) {
    const selected = new Set(ids);
    const latestChange = read ? Math.max(0, ...this.notices.filter((notice) => selected.has(notice.id))
      .map((notice) => Date.parse(notice.changed_at ?? '') || 0)) : 0;
    this.readState = setReadState(this.readState ?? parseReadState(null), ids, read, Math.max(Date.now(), latestChange));
    this.read = readIds(this.readState);
    storeReadState(this.readState);
    const syncable = ids.filter((id) => this.isSyncable(id));
    if (syncable.length) this.uploadStates(() => pushRead(authClient!, syncable.map((id) => ({ id, read }))));
  }

  private markRead(notice: Notice) {
    if (this.isRead(notice)) return;
    this.updateRead([notice.id], true);
  }

  private toggleReadSelection(id: string) {
    this.selectedReads = this.selectedReads.includes(id)
      ? this.selectedReads.filter((selected) => selected !== id) : [...this.selectedReads, id];
  }

  private markSelectedRead(read: boolean) {
    const selected = new Set(this.selectedReads);
    const changed = this.visible().filter((notice) => selected.has(notice.id) && this.isRead(notice) !== read);
    if (!changed.length) return;
    this.updateRead(changed.map((notice) => notice.id), read);
    this.closeSelection();
    this.showToast(`${changed.length}개를 ${read ? '읽음' : '읽지 않음'}으로 표시했어요`);
  }

  private closeSelection() {
    this.selecting = false;
    this.selectedReads = [];
    this.updateComplete.then(() => this.querySelector<HTMLButtonElement>('.select-trigger')?.focus({ preventScroll: true }));
  }

  private isRead(notice: Notice): boolean { return this.readState === null || isNoticeRead(this.readState, notice.id, notice.changed_at); }

  private isSaved(notice: Notice): boolean { return this.saved.some((item) => item.id === notice.id); }

  private toggleSave(notice: Notice) {
    const next = toggleSaved(this.saved, notice);
    if (!next) { this.showToast('저장할 수 있는 공지가 가득 찼어요. 안 쓰는 저장을 지워 주세요'); return; }
    const added = next.length > this.saved.length;
    this.saved = next;
    storeSaved(next);
    this.showToast(added ? '저장했어요' : '저장을 지웠어요');
    this.uploadStates(() => pushSaved(authClient!, [{ id: notice.id, saved: added }]));
  }

  /** 저장한 글. 지금 목록에 있으면 최신 정보로, 밀려났으면 저장할 때 정보로 보여 준다. */
  private savedNotices(): Notice[] {
    return orderSaved(this.saved, this.notices, this.savedSort);
  }

  private judgement(notice: Notice): Judgement | undefined { return this.matched?.items[notice.id]; }

  /** 이 글에 맞는 관심 키워드: 이 기기의 글자 매칭 + 서버의 글자 매칭 + Gemini가 뜻으로 맞춘 것 */
  private interests(notice: Notice): string[] {
    // 제목과 분류(이 기기에서) + 서버가 본문과 그림 글자에서 찾은 것. 판정 이유 문장은 보지 않는다(D-024).
    const judgement = this.judgement(notice);
    const text = `${notice.title} ${notice.title_ko ?? ''} ${notice.category ?? ''}`;
    const found = new Set(this.keywords.filter((word) => keywordMatches(word, text)));
    for (const word of judgement?.interests ?? []) {
      if (this.keywords.includes(word)) found.add(word);
    }
    return [...found];
  }

  private filtered(notices = this.notices): Notice[] {
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
  private async refreshPreferences(userId: string, epoch: number): Promise<void> {
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
  private isSyncable(id: string): boolean {
    const notice = this.notices.find((item) => item.id === id);
    return !!notice && !this.sources.find((source) => source.id === notice.source_id)?.external;
  }

  private uploadStates(run: () => Promise<boolean>): void {
    if (!authClient || !this.authUserId) return;
    const epoch = this.subscriptionsEpoch;
    void run().then((ok) => { if (!ok && epoch === this.subscriptionsEpoch) this.showToast('이 기기에는 저장했지만 계정에 올리지 못했어요. 다음에 다시 맞출게요'); });
  }

  // 로그인 사용자의 저장·읽음을 서버와 맞춘다. 공지 목록이 있어야 서버에만 있는 저장의 글 정보를 찾을 수 있다.
  // 병합 → 저장 업로드 → 읽음 업로드 순서의 체인이며, 업로드가 일부 실패하면 다음 새로고침에서 실패한 단계부터 이어 간다.
  private async syncStates(): Promise<void> {
    const userId = this.authUserId, epoch = this.subscriptionsEpoch;
    if (!authClient || !userId || !this.notices.length || this.stateSyncedEpoch === epoch) return;
    if (!this.stateChain || this.stateChain.epoch !== epoch) {
      const client = authClient;
      let plan: StatePlan | null = null;
      const syncable = (id: string) => this.isSyncable(id);
      const chain = connectionChain([
        async () => {
          const remote = await loadNoticeStates(client, userId);
          if (epoch !== this.subscriptionsEpoch) throw new Error('계정이 바뀌었어요');
          plan = planStateSync(remote, this.saved, this.readState ?? parseReadState(null), this.notices);
          this.saved = plan.saved; storeSaved(plan.saved);
          this.readState = plan.read; this.read = readIds(plan.read); storeReadState(plan.read);
        },
        async () => { if (!await pushSaved(client, plan!.uploadSaved.filter((item) => syncable(item.id)))) throw new Error('저장을 올리지 못했어요'); },
        async () => { if (!await pushRead(client, plan!.uploadRead.filter((item) => syncable(item.id)))) throw new Error('읽음을 올리지 못했어요'); },
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

  private async releasePush(userId: string): Promise<void> {
    try {
      const registration = this.pushRegistration ?? await navigator.serviceWorker?.getRegistration() ?? null;
      if (registration) await releaseDevicePush(userId, registration, localStorage);
    } catch { /* 다음 로그인에서 소유자 표시로 다시 정리한다 */ }
  }

  private async refreshPush(userId: string, epoch: number): Promise<void> {
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
  private async enablePush(): Promise<void> {
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

  private async disablePush(): Promise<void> {
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

  private async saveKeywords(input: string): Promise<void> {
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

  private async refreshSubscriptions(userId: string, epoch: number): Promise<void> {
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

  private async toggleSubscription(sourceId: string, enabled: boolean): Promise<void> {
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

  private tabSources(): Source[] { return this.sources.filter((s) => Boolean(s.external) === (this.tab() === 'intern')); }

  // 고른 게시판이 지금 탭에 없으면 모든 게시판으로 본다(탭을 오가도 빈 목록이 되지 않게).
  private activeBoard(): string { return this.tabSources().some((s) => s.id === this.board) ? this.board : 'all'; }

  private isExternal(notice: Notice): boolean { return Boolean(this.sources.find((s) => s.id === notice.source_id)?.external); }

  private byTab(list: Notice[], tab: Tab): Notice[] {
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

  private sortFor(tab: Tab): Sort { return tab === 'saved' ? this.savedSort : tab === 'intern' ? this.internSort : this.sort; }

  private tab(): Tab { return this.view === 'settings' ? 'all' : this.view; }
  private visible(): Notice[] {
    return this.tab() === 'saved' ? this.filtered(this.savedNotices()) : this.byTab(this.filtered(), this.tab());
  }

  private setView(view: View) {
    const entering = view === 'settings' && this.view !== 'settings';
    this.selecting = false; this.selectedReads = [];
    this.view = view;
    this.openedId = null;
    this.boardMenuOpen = false;
    this.sortMenuOpen = false;
    if (view !== 'settings') remember('tab', view);
    // 주소도 보기와 맞춘다. 설정은 기록에 쌓아 뒤로 가기로 닫히고, 탭은 바꿔 써서 새로고침해도 같은 보기가 열린다.
    if (entering) history.pushState({ view: 'settings' }, '', `${location.pathname}?view=settings`);
    else if (view !== 'settings') history.replaceState(null, '', `${location.pathname}?tab=${view}`);
    this.selectedId = null;
    window.scrollTo({ top: 0 });
    this.querySelector('.list-pane')?.scrollTo({ top: 0 });
  }

  // 설정을 닫으면 들어오기 전에 보던 보기로 돌아간다.
  private leaveSettings = () => {
    const params = new URLSearchParams(location.search);
    if (params.has('keys') || params.has('section')) { location.assign('?view=settings'); return; }
    // 이 화면에서 설정을 열었으면 기록을 하나 되돌린다(주소에서 view=settings가 빠진다). 바로 설정 주소로 들어왔으면 바꿔 쓴다.
    if (history.state?.view === 'settings') { history.back(); return; }
    const last = normalizeTab(remember('tab'));
    this.setView(isTab(last) ? last : 'all');
  };

  private onPopState = () => {
    this.openedId = typeof history.state?.notice === 'string' ? history.state.notice : null;
    this.boardMenuOpen = false;
    this.sortMenuOpen = false;
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

  private setBoard(board: string) {
    this.board = board; this.boardMenuOpen = false; this.selectedId = null; this.selectedReads = []; remember('board', board);
  }
  private setKeyword(word: string | null) {
    this.keyword = word;
    this.selectedReads = [];
    this.selectedId = null;
    if (this.view === 'settings') this.setView('all');
  }

  private setKeywords(words: string[]) {
    this.keywords = words;
    remember('keywords', JSON.stringify(words));
    if (this.keyword && !words.includes(this.keyword)) this.keyword = null;
  }

  private setTheme(theme: Theme) {
    this.theme = theme;
    remember('theme', theme);
    applyTheme(theme);
  }

  private async copyLink(notice: Notice) {
    try {
      await navigator.clipboard.writeText(safeUrl(notice.url));
      this.showToast('원문 링크를 복사했어요');
    } catch {
      this.showToast('복사하지 못했어요');
    }
  }

  // 휴대폰은 카카오톡 같은 앱으로 바로 보내는 공유 창을 쓴다. 없으면 링크를 복사한다.
  private async share(notice: Notice) {
    if (!navigator.share) { this.copyLink(notice); return; }
    try { await navigator.share({ title: cleanTitle(notice.title_ko || notice.title), url: safeUrl(notice.url) }); } catch { /* 닫으면 그대로 둔다 */ }
  }

  private showToast(text: string, link: string | null = null, linkLabel = '') {
    this.toast = text;
    this.toastLink = link;
    this.toastLinkLabel = linkLabel;
    clearTimeout(this.toastTimer);
    if (!link) this.toastTimer = window.setTimeout(() => { this.toast = ''; }, 3500);
  }

  private async runInstall() {
    if (!this.install) return;
    await this.install.prompt();
    this.install = null;
  }

  private onKey(event: KeyboardEvent) {
    const target = event.target as Element | null;
    if (event.key === 'Escape' && this.sortMenuOpen) {
      event.preventDefault();
      this.sortMenuOpen = false;
      this.updateComplete.then(() => this.querySelector<HTMLButtonElement>('.sort-trigger')?.focus());
      return;
    }
    if (event.key === 'Escape' && this.boardMenuOpen) {
      event.preventDefault();
      this.boardMenuOpen = false;
      this.updateComplete.then(() => this.querySelector<HTMLButtonElement>('.board-picker .board-trigger')?.focus());
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
      this.updateComplete.then(() => this.querySelector(`[data-id="${CSS.escape(next.id)}"]`)?.scrollIntoView({ block: 'nearest' }));
    };
    const actions: Record<string, () => void> = {
      '/': () => this.querySelector<HTMLInputElement>('.search input')?.focus(),
      j: () => move(1), ArrowDown: () => move(1), k: () => move(-1), ArrowUp: () => move(-1),
      Enter: () => { const notice = list[index]; if (notice) { this.markRead(notice); window.open(safeUrl(notice.url), '_blank', 'noopener'); } },
      r: () => this.collectNow(), 1: () => this.setView('all'), 2: () => this.setView('intern'), 3: () => this.setView('saved'),
      s: () => { const notice = list[index]; if (notice) this.toggleSave(notice); },
    };
    const action = actions[event.key];
    if (action) { event.preventDefault(); action(); }
  }

  private onRow(event: MouseEvent, notice: Notice) {
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

  private setDetail(open: boolean) {
    this.detailOpen = open;
    if (!open && this.unreadOnly) this.selectedId = null;
    remember('detail', open ? '1' : '0');
  }

  private body(notice: Notice): NoticeBody | null | 'loading' {
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

  updated() {
    // 단축키 창은 네이티브 dialog로 연다(포커스 가두기와 Esc 닫기를 브라우저가 맡는다).
    const dialog = this.querySelector<HTMLDialogElement>('dialog.shortcuts');
    if (dialog && this.shortcutsOpen && !dialog.open) dialog.showModal();
    if (this.view === 'settings') {
      document.title = `${settingsTitle()} - ${APP_NAME}`;
      return;
    }
    document.title = APP_NAME;
  }

  render() {
    if (!this.authReady) return html`<p role="status" class="platform-preview">로그인 상태를 확인하고 있어요.</p>`;
    const filtered = this.filtered();
    const tabs = TABS;
    const counts = Object.fromEntries(tabs.map((t) => [t.id, t.id === 'saved'
      ? this.filtered(this.savedNotices()).length : this.byTab(filtered, t.id).length]));
    const list = this.visible();
    const settings = this.view === 'settings';
    const keywordScope = this.tab() === 'saved' ? this.savedNotices() : this.notices.filter((notice) =>
      this.isExternal(notice) === (this.tab() === 'intern') && (!notice.deadline || !deadlinePassed(notice.deadline)));
    const board = this.activeBoard();
    const keywordTotals = keywordCounts(keywordScope.filter((notice) => board === 'all' || notice.source_id === board),
      this.keywords, (notice) => this.interests(notice));
    const title = settings ? settingsTitle()
      : this.keyword ? this.keyword : TABS.find((t) => t.id === this.view)!.label;
    const selected = settings ? undefined
      : list.find((n) => n.id === this.selectedId) ?? (this.isWide ? list[0] : undefined);
    this.shownId = selected?.id ?? null;
    const reading = !this.isWide && !settings
      ? this.notices.find((n) => n.id === this.openedId) ?? list.find((n) => n.id === this.openedId) : undefined;
    const classes = [settings ? 'is-settings' : '', this.isWide && (!this.detailOpen || !selected) ? 'no-detail' : '', reading ? 'is-reading' : ''].join(' ');
    const mobileNav = html`<nav class="tabbar glass" aria-label="보기" ?hidden=${settings || Boolean(reading)}>
      ${tabs.map((t) => html`<button type="button" aria-current=${this.view === t.id ? 'page' : 'false'}
        @click=${() => this.setView(t.id)}>${icon(t.icon)}<span>${t.label}</span></button>`)}
    </nav>`;
    return html`
      <div class="wco-bar" aria-hidden="true"><svg class="brand-mark" aria-hidden="true"><use href="icons/sprite.svg#brand"></use></svg>${APP_NAME}</div>
      <div class="app ${classes}">
        <aside class="sidebar" aria-label="탐색">
          <div class="pane-head brand"><svg class="brand-mark" aria-hidden="true"><use href="icons/sprite.svg#brand"></use></svg>${APP_NAME}</div>
          <nav class="side-group" aria-label="보기">
            ${tabs.map((t) => this.sideItem(t.label, counts[t.id], this.view === t.id, () => this.setView(t.id),
              String(TABS.findIndex((x) => x.id === t.id) + 1), undefined, t.icon))}
          </nav>
          ${this.sideGroup('keywords', '관심 키워드', html`
            ${this.keywords.map((word) => this.sideItem(word, keywordTotals.counts[word],
              this.keyword === word && !settings, () => this.setKeyword(this.keyword === word ? null : word), undefined,
              `${word}, 공지 ${keywordTotals.counts[word]}개`))}
            <button type="button" class="side-item add" @click=${() => this.setView('settings')}>${this.keywords.length ? '키워드 관리하기' : '키워드 추가하기'}</button>`, keywordTotals.total)}
          ${this.sideGroup('boards', this.tab() === 'intern' ? '인턴 공고 사이트' : '게시판', html`
            ${[{ id: 'all', label: this.tab() === 'intern' ? '모든 사이트' : '모든 게시판' },
              ...this.tabSources().map((s) => ({ id: s.id, label: boardName(s, s.id) }))]
              .map((b) => this.sideItem(b.label, null, this.activeBoard() === b.id && !settings, () => { this.setBoard(b.id); if (settings) this.leaveSettings(); }))}`, this.tabSources().length)}
          <div class="side-foot">
            ${this.sideItem('설정', null, settings, () => this.setView('settings'))}
          </div>
        </aside>

        <main class="list-pane">
          <p class="platform-preview" role="status">미리보기예요. 공지는 한 시간 간격으로 확인해요. 알림은 준비하고 있어요.</p>
          ${reading ? this.readingView(reading) : html`
          <div class="navigation-head">
          <header class="pane-head topbar glass ${settings ? '' : 'feed-topbar'}">
            ${settings ? html`<button type="button" class="icon-button narrow-only back" aria-label="설정 닫기"
              @click=${this.leaveSettings}>${icon('back')}</button>` : nothing}
            ${settings ? nothing : html`<svg class="brand-mark narrow-only" aria-hidden="true"><use href="icons/sprite.svg#brand"></use></svg>`}
            <div class="topbar-text">
              <h1>${title}</h1>
              ${settings ? html`<p class="updated">알림과 연결을 정해요</p>` : this.updatedLine(list.length)}
            </div>
            ${settings ? nothing : html`
              <label class="search wide-only">${icon('search')}
                <input type="search" placeholder="공지 찾기" autocomplete="off" aria-label="공지 검색" aria-keyshortcuts="/" .value=${this.query}
                  @input=${(e: Event) => { this.query = (e.target as HTMLInputElement).value; this.selectedId = null; this.selectedReads = []; }}>${this.query ? nothing : kbd('/')}</label>
              ${this.detailOpen || !selected ? nothing : html`<button type="button" class="icon-button wide-only" aria-label="상세 칸 열기" title="상세 칸 열기"
                @click=${() => this.setDetail(true)}>${icon('panel')}</button>`}
              <button type="button" class="icon-button" aria-label="공지 다시 가져오기" title="공지 다시 가져오기 (R)" aria-keyshortcuts="r"
                ?disabled=${this.loading} @click=${this.collectNow}>${icon('refresh')}</button>`}
            ${settings ? nothing : html`<button type="button" class="icon-button narrow-only" aria-label="설정"
              @click=${() => this.setView('settings')}>${gearIcon}</button>`}
            ${settings ? html`<button type="button" class="icon-button wide-only" aria-label="설정 닫기" title="설정 닫기 (Esc)"
              aria-keyshortcuts="Escape" @click=${this.leaveSettings}>${icon('close')}</button>` : nothing}
          </header>
          </div>

          ${settings ? html`<platform-settings-screen .model=${{
            configured: !!authClient, userId: this.authUserId, email: this.authEmail,
            authBusy: this.authBusy, authError: this.authError,
            sources: this.sources.filter((source) => !source.external).map((source) => ({ id: source.id, label: boardName(source, source.id) })),
            subscriptions: this.subscriptions, loading: this.subscriptionsLoading, error: this.subscriptionsError,
            subscriptionsOnly: this.subscriptionsOnly, setSubscriptionsOnly: (enabled: boolean) => { this.subscriptionsOnly = enabled; this.selectedId = null; this.selectedReads = []; remember('subscriptions-only', enabled ? '1' : '0'); },
            keywords: this.keywords, preferencesLoading: this.preferencesLoading, preferencesError: this.preferencesError, preferencesUnavailable: this.preferencesUnavailable,
            retryPreferences: () => { if (this.authUserId) { this.preferencesLoading = true; this.preferencesError = ''; void this.refreshPreferences(this.authUserId, this.subscriptionsEpoch); } },
            saveKeywords: (input: string) => { void this.saveKeywords(input); },
            signIn: () => { void this.signIn(); }, signOut: () => { void this.signOut(); },
            pushStatus: this.pushStatus, pushError: this.pushError, pushRetry: this.pushRetry,
            enablePush: () => { void this.enablePush(); }, disablePush: () => { void this.disablePush(); },
            toggle: (id: string, enabled: boolean) => { void this.toggleSubscription(id, enabled); },
            retry: () => {
              if (this.authUserId) { this.subscriptionsLoading = true; this.subscriptionsError = ''; void this.refreshSubscriptions(this.authUserId, this.subscriptionsEpoch); }
            },
          }}></platform-settings-screen>` : html`
            <div class="tools narrow-only">
              <label class="search">${icon('search')}
                <input type="search" placeholder="제목, 분류, 판정 이유로 찾기" autocomplete="off" aria-label="공지 검색" .value=${this.query}
                  @input=${(e: Event) => { this.query = (e.target as HTMLInputElement).value; this.selectedId = null; this.selectedReads = []; }}></label>
              <div class="chips" role="group" aria-label="관심 키워드">
                ${this.keywords.length ? html`<button type="button" class="chip" aria-pressed=${String(!this.keyword)} @click=${() => this.setKeyword(null)}>모두</button>` : nothing}
                ${this.keywords.map((word) => html`<button type="button" class="chip" aria-pressed=${String(this.keyword === word)}
                  aria-label=${`${word}, 공지 ${keywordTotals.counts[word]}개`}
                  @click=${() => this.setKeyword(this.keyword === word ? null : word)}>${word} ${keywordTotals.counts[word]}</button>`)}
                <button type="button" class="chip-add" @click=${() => this.setView('settings')}>${icon('plus')}키워드 추가하기</button>
              </div>
            </div>
            ${this.viewFilters()}
            <div class="list" aria-live="polite" aria-busy=${this.loading ? 'true' : 'false'}>${this.listBody(list)}</div>`}`}
        </main>

        <aside class="detail-pane" aria-label="공지 상세">
          <div class="pane-head detail-head">
            ${selected ? html`<button type="button" class="icon-button" aria-label="상세 칸 닫기" title="상세 칸 닫기 (Esc)" aria-keyshortcuts="Escape"
              @click=${() => this.setDetail(false)}>${icon('close')}</button>` : nothing}
            ${selected ? html`<div class="detail-actions">
              ${this.saveButton(selected)}
              <button type="button" class="ghost-button" @click=${() => this.copyLink(selected)}>링크 복사하기</button>
              <a class="solid-button" href=${safeUrl(selected.url)} target="_blank" rel="noopener" aria-keyshortcuts="Enter">원문 열기${kbd('Enter')}</a></div>` : nothing}
          </div>
          ${selected ? this.detail(selected) : html`<p class="detail-note detail-empty">공지를 고르면 여기에 보여요</p>`}
        </aside>
      </div>

      ${mobileNav}
      <div class="toast" role="status" ?hidden=${!this.toast}>${this.toast}${this.toastLink ? html`
        <div class="toast-actions"><a href=${this.toastLink} target=${this.toastLink.startsWith('?') ? '_self' : '_blank'} rel="noopener noreferrer">${this.toastLinkLabel}</a>
          <button type="button" @click=${() => { this.toast = ''; this.toastLink = null; }}>닫기</button></div>` : nothing}</div>
      ${this.shortcutsOpen ? this.shortcutsDialog() : nothing}
    `;
  }

  /** 휴대폰 앱 안 상세 화면: 뒤로 가기, 상세, 바닥의 원문 열기 */
  private readingView(notice: Notice) {
    return html`
      <header class="pane-head topbar glass">
        <button type="button" class="icon-button back" aria-label="목록으로" @click=${() => history.back()}>${icon('back')}</button>
        <div class="topbar-text"><h1>공지</h1></div>
      </header>
      <div class="reading">${this.detail(notice)}</div>
      <div class="read-actions glass">
        ${this.saveButton(notice)}
        ${'share' in navigator
          ? html`<button type="button" class="ghost-button" @click=${() => this.share(notice)}>공유하기</button>`
          : html`<button type="button" class="ghost-button" @click=${() => this.copyLink(notice)}>링크 복사하기</button>`}
        <a class="solid-button" href=${safeUrl(notice.url)} target="_blank" rel="noopener">원문 열기</a>
      </div>`;
  }

  private shortcutsDialog() {
    const close = () => { this.shortcutsOpen = false; };
    return html`<dialog class="shortcuts" aria-labelledby="shortcuts-title" @close=${close}
      @click=${(e: MouseEvent) => { if (e.target === e.currentTarget) (e.currentTarget as HTMLDialogElement).close(); }}>
      <div class="dialog-head">
        <h2 id="shortcuts-title">단축키</h2>
        <button type="button" class="icon-button" aria-label="닫기" @click=${(e: Event) => (e.currentTarget as HTMLElement).closest('dialog')?.close()}>${icon('close')}</button>
      </div>
      ${SHORTCUTS.map((section) => html`<section class="shortcut-group">
        <h3>${section.group}</h3>
        <dl>${section.items.map(([label, keys]) => html`<div><dt>${label}</dt><dd>${kbd(...keys)}</dd></div>`)}</dl>
      </section>`)}
      <p class="dialog-foot">위아래 화살표로도 공지를 옮길 수 있어요</p>
    </dialog>`;
  }

  // 사이드바 묶음은 머리를 눌러 접고 편다. 접은 묶음은 기억한다(사용자 요청 2026-11-03).
  private sideGroup(id: string, title: string, items: TemplateResult, count?: number) {
    const open = !this.collapsed.includes(id);
    return html`<button type="button" class="side-head" aria-expanded=${String(open)} aria-controls="side-${id}"
        @click=${() => {
          this.collapsed = open ? [...this.collapsed, id] : this.collapsed.filter((x) => x !== id);
          remember('side-collapsed', JSON.stringify(this.collapsed));
        }}><span>${title}${!open && count ? html`<span class="side-count">${count}</span>` : nothing}</span><span class="side-chevron" aria-hidden="true"></span></button>
      <div class="side-group" id="side-${id}" ?hidden=${!open}>${items}</div>`;
  }

  private sideItem(label: string, count: number | null, active: boolean, onClick: () => void, shortcut?: string, ariaLabel?: string, itemIcon?: IconName) {
    return html`<button type="button" class="side-item" aria-current=${active ? 'page' : 'false'} @click=${onClick}
      aria-label=${ariaLabel ?? nothing}
      aria-keyshortcuts=${shortcut ?? nothing} title=${shortcut ? `${label} (${shortcut})` : nothing}>
      <span class="side-label">${itemIcon ? icon(itemIcon) : nothing}<span>${label}</span></span>${count === null ? nothing : html`<span class="count">${count}</span>`}</button>`;
  }

  private updatedLine(count?: number) {
    if (this.loading && !this.generatedAt) return html`<p class="updated">불러오는 중</p>`;
    if (!this.generatedAt) return html`<p class="updated">받은 시각을 알 수 없어요</p>`;
    const stale = Date.now() - Date.parse(this.generatedAt) > STALE_MS;
    const time = new Intl.DateTimeFormat('ko-KR', {
      timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
    }).format(new Date(this.generatedAt));
    const total = count === undefined ? '' : `${count}건, `;
    // "확인 필요"(판정)와 겹치지 않게 수집 지연은 다른 말로 쓴다.
    return html`<p class="updated ${stale ? 'stale' : ''}">${stale ? `${time} 수집 지연` : `${total}${time} 기준`}</p>`;
  }

  private listBody(list: Notice[]): TemplateResult | TemplateResult[] {
    if (this.loading && !this.notices.length) {
      return html`<ol class="rows">${Array.from({ length: 6 }, () => html`
        <li class="row skeleton" aria-hidden="true"><span></span><span></span><span></span></li>`)}</ol>`;
    }
    if (this.failed && !this.notices.length) {
      return this.empty('목록을 불러오지 못했어요', '공지 데이터를 연결하는 중이에요. 잠시 뒤 다시 확인해 주세요', '다시 불러오기', () => this.refresh());
    }
    if (!list.length) {
      if (this.tab() === 'all' && this.authUserId && this.subscriptionsOnly && this.subscriptionsLoading) {
        return html`<p class="detail-note" role="status">구독한 게시판을 불러오고 있어요.</p>`;
      }
      if (this.tab() === 'all' && this.authUserId && this.subscriptionsOnly && this.subscriptionsError) {
        return this.empty('구독을 불러오지 못했어요', '설정에서 다시 불러와 주세요', '설정 열기', () => this.setView('settings'));
      }
      if (this.tab() === 'all' && this.authUserId && this.subscriptionsOnly && !this.subscriptions.length) {
        return this.empty('구독한 게시판이 없어요', '설정에서 게시판을 선택해 주세요', '설정 열기', () => this.setView('settings'));
      }
      const boardPicker = html`<div class="group-head empty-head"><span></span>${this.boardSelect()}</div>`;
      if (this.query) return html`${boardPicker}${this.empty(`'${this.query}'에 맞는 공지가 없어요`, '다른 단어로 찾아보세요', '검색어 지우기', () => { this.query = ''; })}`;
      if (this.keyword && this.view !== 'saved' && this.unreadOnly) return html`${boardPicker}${this.empty(
        `'${this.keyword}'에 맞는 읽지 않은 공지가 없어요`, '읽지 않은 공지만 보기를 끄면 모든 공지를 볼 수 있어요')}`;
      if (this.keyword) return html`${boardPicker}${this.empty(`'${this.keyword}'에 맞는 공지가 아직 없어요`, '새 글이 오면 여기에 모여요')}`;
      if (this.view !== 'saved' && this.unreadOnly) return html`${boardPicker}${this.empty('읽지 않은 공지가 없어요', '읽지 않은 공지만 보기를 끄면 모든 공지를 볼 수 있어요')}`;
      const empty = {
        all: ['이 게시판에 공지가 없어요', '다른 게시판을 골라 보세요'],
        intern: ['이 사이트에 공고가 없어요', '다른 사이트를 골라 보세요'],
        saved: ['저장한 공지가 없어요', '공지를 열어 저장하면 여기에 모여요'],
      }[this.tab()];
      return html`${boardPicker}${this.empty(empty[0], empty[1])}`;
    }
    const today = todayKst();
    const groups = new Map<string, Notice[]>();
    for (const notice of list) {
      const key = this.sortFor(this.tab()) === 'deadline'
        ? !notice.deadline ? '마감일 미정' : deadlinePassed(notice.deadline) ? '마감 지난 글' : deadlineGroup(notice.deadline, today)
        : this.view === 'saved' ? '저장한 공지' : postedGroup(notice.posted_on, today);
      groups.set(key, [...(groups.get(key) ?? []), notice]);
    }
    return [...groups].map(([title, items], index) => html`
      <section class="group" aria-label=${title}>
        <div class="group-head"><h2>${title}</h2>${index === 0 ? this.boardSelect() : nothing}</div>
        <notice-rows-screen .model=${{
          rows: items.map((notice) => {
            const ai = this.judgement(notice)?.ai ?? null;
            const interests = this.interests(notice);
            return { notice, source: boardName(this.sources.find((source) => source.id === notice.source_id), notice.source_id),
              read: this.isRead(notice), saved: this.isSaved(notice), current: this.isWide && this.detailOpen && this.shownId === notice.id,
              selected: this.selectedReads.includes(notice.id), dim: ai?.verdict === 'not_relevant' && !interests.length,
              interests, ai, rule: this.judgement(notice)?.rule_name ?? null };
          }),
          today, selecting: this.selecting, savedView: this.view === 'saved',
          open: (event: MouseEvent, notice: Notice) => this.onRow(event, notice),
          toggleSelection: (id: string) => this.toggleReadSelection(id),
        }}></notice-rows-screen>
      </section>`);
  }

  private viewFilters() {
    const list = this.visible();
    if (this.selecting) {
      const selected = new Set(this.selectedReads);
      const selectedVisible = list.filter((notice) => selected.has(notice.id));
      const selectedUnread = selectedVisible.filter((notice) => !this.isRead(notice)).length;
      const selectedRead = selectedVisible.length - selectedUnread;
      return html`<div class="view-options select-options" role="group" aria-label="공지 선택">
        <label class="select-all"><input type="checkbox" .checked=${list.length > 0 && selectedVisible.length === list.length}
          .indeterminate=${selectedVisible.length > 0 && selectedVisible.length < list.length}
          ?disabled=${!list.length} @change=${(event: Event) => {
            this.selectedReads = (event.target as HTMLInputElement).checked ? list.map((notice) => notice.id) : [];
          }}>전체 선택</label>
        <div class="view-actions"><button type="button" class="read-all" ?disabled=${!selectedUnread}
          aria-label=${`선택한 읽지 않은 공지 ${selectedUnread}개 읽음으로 표시`}
          @click=${() => this.markSelectedRead(true)}>읽음 표시</button>
          <button type="button" class="read-all" ?disabled=${!selectedRead}
            aria-label=${`선택한 읽은 공지 ${selectedRead}개 읽지 않음으로 표시`}
            @click=${() => this.markSelectedRead(false)}>안 읽음 표시</button>
          <button type="button" class="read-all" @click=${() => this.closeSelection()}>닫기</button></div>
      </div>`;
    }
    const select = html`<button type="button" class="read-all select-trigger" ?disabled=${!list.length}
      @click=${(event: MouseEvent) => {
        this.selecting = true; this.selectedReads = [];
        if (event.detail === 0) this.updateComplete.then(() => this.querySelector<HTMLInputElement>('.select-all input')?.focus({ preventScroll: true }));
      }}>${icon('select-list')}선택</button>`;
    if (this.view === 'saved') return html`<div class="view-options saved-options"><div class="view-actions">${select}${this.sortSelect()}</div></div>`;
    return html`<div class="view-options" role="group" aria-label="공지 보기 조건">
      <button type="button" class="view-toggle" aria-pressed=${String(this.unreadOnly)} @click=${() => {
        this.unreadOnly = !this.unreadOnly;
        this.selectedId = null;
        remember('view-unread', this.unreadOnly ? '1' : '0');
      }}><span class="filter-check" aria-hidden="true"></span>읽지 않은 공지만</button>
      <div class="view-actions">${select}${this.sortSelect()}</div>
    </div>`;
  }

  private sortSelect() {
    const sort = this.sortFor(this.tab());
    const options = [{ id: 'latest', label: this.view === 'saved' ? '저장한 순' : '최신순' }, { id: 'deadline', label: '마감순' }] as const;
    const label = options.find((option) => option.id === sort)!.label;
    return html`<div class="sort-picker">
      <button type="button" class="board-trigger sort-trigger" aria-label="정렬: ${label}"
        aria-expanded=${String(this.sortMenuOpen)} aria-controls="sort-options" @click=${() => {
          this.sortMenuOpen = !this.sortMenuOpen;
          if (this.sortMenuOpen) this.updateComplete.then(() => this.querySelector<HTMLButtonElement>('.sort-option[aria-pressed="true"]')?.focus());
        }}>${label}<span class="board-chevron" aria-hidden="true"></span></button>
      ${this.sortMenuOpen ? html`<div id="sort-options" class="board-options sort-options" role="group" aria-label="정렬 선택"
        @keydown=${(event: KeyboardEvent) => {
          const buttons = [...this.querySelectorAll<HTMLButtonElement>('.sort-option')];
          const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
          const next = event.key === 'ArrowDown' ? (index + 1) % buttons.length
            : event.key === 'ArrowUp' ? (index + buttons.length - 1) % buttons.length
              : event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : -1;
          if (next >= 0) { event.preventDefault(); buttons[next]?.focus(); }
        }} @focusout=${(event: FocusEvent) => {
          if (!(event.currentTarget as HTMLElement).parentElement?.contains(event.relatedTarget as Node | null)) this.sortMenuOpen = false;
        }}>
        ${options.map((option) => html`<button type="button" class="board-option sort-option" aria-pressed=${String(sort === option.id)}
          @click=${() => {
            if (this.view === 'saved') this.savedSort = option.id;
            else if (this.view === 'intern') this.internSort = option.id;
            else this.sort = option.id;
            remember(this.view === 'saved' ? 'saved-sort' : this.view === 'intern' ? 'intern-sort' : 'notice-sort', option.id);
            this.selectedId = null;
            this.sortMenuOpen = false;
            history.replaceState(null, '', `${location.pathname}?tab=${this.tab()}&sort=${option.id}`);
            this.updateComplete.then(() => this.querySelector<HTMLButtonElement>('.sort-trigger')?.focus());
          }}><span>${option.label}</span>${sort === option.id ? html`<span class="board-check" aria-hidden="true"></span>` : nothing}</button>`)}
      </div>` : nothing}
    </div>`;
  }

  private boardSelect() {
    const boards = [{ id: 'all', label: this.tab() === 'intern' ? '모든 사이트' : '모든 게시판' },
      ...this.tabSources().map((s) => ({ id: s.id, label: boardName(s, s.id) }))];
    const current = boards.find((b) => b.id === this.activeBoard())?.label ?? boards[0].label;
    return html`<div class="board-picker narrow-only" @focusout=${(event: FocusEvent) => {
      if (!(event.currentTarget as HTMLElement).contains(event.relatedTarget as Node | null)) this.boardMenuOpen = false;
    }}>
      <button type="button" class="board-trigger" aria-label="게시판: ${current}" aria-expanded=${String(this.boardMenuOpen)}
        aria-controls="board-options" @click=${() => {
          this.boardMenuOpen = !this.boardMenuOpen;
          if (this.boardMenuOpen) this.updateComplete.then(() => this.querySelector<HTMLButtonElement>('.board-option[aria-pressed="true"]')?.focus());
        }}>
        ${current}<span class="board-chevron" aria-hidden="true"></span>
      </button>
      ${this.boardMenuOpen ? html`<div id="board-options" class="board-options" role="group" aria-label="게시판 선택"
        @keydown=${(event: KeyboardEvent) => {
          const options = [...this.querySelectorAll<HTMLButtonElement>('.board-option')];
          const index = options.indexOf(document.activeElement as HTMLButtonElement);
          const next = event.key === 'ArrowDown' ? (index + 1) % options.length
            : event.key === 'ArrowUp' ? (index + options.length - 1) % options.length
              : event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1 : -1;
          if (next >= 0) { event.preventDefault(); options[next]?.focus(); }
        }}>
        ${boards.map((b) => html`<button type="button" class="board-option" aria-pressed=${String(this.activeBoard() === b.id)}
          @click=${() => { this.setBoard(b.id); this.updateComplete.then(() => this.querySelector<HTMLButtonElement>('.board-picker .board-trigger')?.focus()); }}>
          <span>${b.label}</span>${this.activeBoard() === b.id ? html`<span class="board-check" aria-hidden="true"></span>` : nothing}</button>`)}
      </div>` : nothing}
    </div>`;
  }

  private empty(title: string, body: string, action?: string, onAction?: () => void) {
    return html`<div class="empty">${icon('ginkgo')}<strong>${title}</strong><p>${body}</p>
      ${action ? html`<button type="button" class="ghost-button" @click=${onAction}>${action}</button>` : nothing}</div>`;
  }

  private detail(notice: Notice) {
    const judgement = this.judgement(notice);
    return html`<notice-detail-screen .model=${{
      notice, source: boardName(this.sources.find((source) => source.id === notice.source_id), notice.source_id),
      today: todayKst(), body: this.body(notice), interests: this.interests(notice),
      ai: judgement?.ai ?? null, rule: judgement?.rule_name ?? null, notified: !!judgement?.notified,
      retry: () => { this.bodies.delete(notice.id); this.requestUpdate(); },
    }}></notice-detail-screen>`;
  }

  private saveButton(notice: Notice) {
    const saved = this.isSaved(notice);
    return html`<button type="button" class="icon-button save-button" aria-pressed=${String(saved)}
      aria-label=${saved ? '저장 지우기' : '저장하기'} title=${saved ? '저장 지우기 (S)' : '저장하기 (S)'} aria-keyshortcuts="s"
      @click=${() => this.toggleSave(notice)}>${icon(saved ? 'bookmark-on' : 'bookmark')}</button>`;
  }


}

customElements.define('notice-app', NoticeApp);
