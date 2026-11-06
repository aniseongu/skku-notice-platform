// 화면 전체. 규칙은 docs/DESIGN.md, docs/design/ux-rules.md, docs/design/platforms.md.
// 그림자 DOM을 쓰지 않는다(전역 토큰과 글꼴을 그대로 받으려고). 학교 글자는 Lit 템플릿으로만 넣어 자동 이스케이프한다.
import { LitElement, html, nothing, type TemplateResult } from 'lit';
import {
  type IconName, type Judgement, type MatchedFile, type Notice, type NoticeBody, type NoticesFile, type Source,
  VERDICT_LABEL, boardName, cleanTitle, deadlineDetail, deadlineGroup, deadlinePassed, deadlineText,
  daysLeft, fetchBody, fetchJson, keywordMatches, koreanDate, postedGroup, safeUrl, todayKst,
} from './data';
import { unsafeHTML } from 'lit/directives/unsafe-html.js';
import { cleanHtml, fileType } from './rich';
import './settings-view';
import { GitHubError, collectionWorkflowUrl, readVariable, saveVariable, requestCollection } from './github';
import { loadToken } from './settings-storage';
import { SAVED_VARIABLE, type SavedNotice, loadSaved, orderSaved, parseSaved, storeSaved, toggleSaved } from './saved-notices';
import { READ_STATE_VARIABLE, READ_VARIABLE, isNoticeRead, loadReadState, mergeReadStates, parseReadState, readIds, serializeReadState, setReadState, storeReadState } from './read-notices';
import { keywordCounts } from './keyword-counts';
import type { Theme } from './settings-view';
import { APP_NAME } from './brand';
import { orderNotices, type Sort } from './notice-order';
import { syncCurrentDeviceName } from './device-name-sync';

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
const SOON_DAYS = 3;
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
    if (value === undefined) return localStorage.getItem(key);
    localStorage.setItem(key, value);
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
    unreadOnly: { state: true }, selecting: { state: true }, selectedReads: { state: true },
  };

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
  private readTimer = 0;
  private readWrite: Promise<void> = Promise.resolve();
  // GitHub 연결(설정에서 한 번 넣은 토큰). 있으면 저장 목록과 키워드를 모든 기기와 맞춘다.
  private github: { repo: string; token: string } | null = null;
  private savedWrite: Promise<void> = Promise.resolve();
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
    this.refresh();
    this.syncFromGitHub();
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
      const load = () => Promise.all([fetchJson<NoticesFile>('notices.json'), fetchJson<MatchedFile>('matched.json', true)]);
      let [notices, matched] = await load();
      // 두 파일은 같은 실행에서 함께 만들어진다. 한쪽만 저장본이면 한 번 더 받는다.
      if (matched && matched.generated_at !== notices!.generated_at) [notices, matched] = await load();
      // 뒤늦게 채운 본문도 새 수집 결과와 함께 다시 받는다.
      if (this.generatedAt !== notices!.generated_at) this.bodies.clear();
      this.notices = notices!.notices;
      this.sources = notices!.sources;
      this.generatedAt = notices!.generated_at;
      this.matched = matched;
      this.failed = false;
      // 처음 열면 이미 있던 글이 모두 굵게 보이지 않게, 그때 있던 글은 읽은 것으로 시작한다.
      if (this.needsReadBaseline) {
        const baseline = parseReadState(JSON.stringify(this.notices.map((n) => n.id)));
        this.readState = mergeReadStates(baseline, this.readState ?? parseReadState(null));
        this.read = readIds(this.readState);
        storeReadState(this.readState);
        this.needsReadBaseline = false;
        this.pushRead();
      }
      if (this.board !== 'all' && !this.sources.some((s) => s.id === this.board)) this.board = 'all';
    } catch (error) {
      console.error(error);
      this.failed = true;
      if (this.notices.length) this.showToast('새 목록을 받지 못했어요. 잠시 뒤 새로고침해 주세요');
    } finally {
      this.loading = false;
    }
  }

  private async collectNow() {
    await this.refresh();
    const repo = remember('github-repo');
    const token = await loadToken();
    if (!repo || !token) { this.showToast('기기를 연결하면 공지를 직접 확인할 수 있어요', '?view=settings&section=connection', '기기 연결하기'); return; }
    if (this.generatedAt && Date.now() - Date.parse(this.generatedAt) < 14 * 60_000) {
      this.showToast('최근에 공지를 확인했어요. 잠시 뒤 다시 시도해 주세요'); return;
    }
    try {
      await requestCollection(repo, token);
      this.showToast('공지 확인을 요청했어요. 진행 중인 확인이 끝나면 반영돼요');
    } catch (error) {
      if (error instanceof GitHubError && error.status === 401) {
        this.showToast('GitHub 연결을 확인하지 못했어요. 기기에서 다시 연결해 주세요', '?view=settings&section=connection', '기기 연결하기');
      } else if (error instanceof GitHubError && (error.status === 403 || error.status === 404)) {
        this.showToast('GitHub 토큰의 저장소 접근과 Actions 권한을 확인해 주세요',
          'https://github.com/settings/personal-access-tokens', '토큰 권한 확인하기');
      } else {
        this.showToast('요청하지 못했어요. 잠시 뒤 다시 시도해 주세요', collectionWorkflowUrl(repo), 'GitHub에서 실행하기');
      }
    }
  }

  // GitHub 값이 있으면 그것을 따른다(다른 기기에서 바꾼 것). 없으면 이 기기 것을 올린다.
  private async syncFromGitHub() {
    const repo = remember('github-repo');
    const token = await loadToken();
    if (!repo || !token) return;
    this.github = { repo, token };
    void syncCurrentDeviceName(repo, token).catch(() => { /* 설정 화면에서 다시 시도한다 */ });
    try {
      const [saved, keywords, read, readState] = await Promise.all([
        readVariable(repo, token, SAVED_VARIABLE), readVariable(repo, token, 'INTEREST_KEYWORDS'),
        readVariable(repo, token, READ_VARIABLE), readVariable(repo, token, READ_STATE_VARIABLE),
      ]);
      // 명시적으로 읽지 않음으로 바꾼 시각도 함께 병합한다.
      if (read !== null || readState !== null || this.readState) {
        const remote = mergeReadStates(parseReadState(read), parseReadState(readState));
        const merged = mergeReadStates(remote, this.readState ?? parseReadState(null));
        this.readState = merged;
        this.read = readIds(merged);
        storeReadState(merged);
        if (serializeReadState(merged) !== readState || JSON.stringify(readIds(merged)) !== read) this.pushRead();
      }
      if (saved !== null) { this.saved = parseSaved(saved); storeSaved(this.saved); }
      else if (this.saved.length) this.pushSaved();
      const words = (keywords ?? '').split(/[,\n]/).map((w) => w.trim()).filter(Boolean);
      if (words.length) this.setKeywords(words);
    } catch { /* 인터넷 오류면 이 기기 것을 그대로 보여 준다 */ }
  }

  private pushSaved() {
    const github = this.github;
    if (!github) return;
    const value = JSON.stringify(this.saved);
    // 빠르게 여러 번 눌러도 마지막 상태가 남도록 차례로 보낸다.
    this.savedWrite = this.savedWrite.then(() => saveVariable(github.repo, github.token, SAVED_VARIABLE, value))
      .catch(() => this.showToast('이 기기에만 저장했어요. 다른 기기에는 다음에 열 때 맞춰요'));
  }

  private pushRead() {
    const github = this.github;
    if (!github) return;
    clearTimeout(this.readTimer);
    this.readTimer = window.setTimeout(() => {
      this.readWrite = this.readWrite.then(async () => {
        const [legacy, versioned] = await Promise.all([
          readVariable(github.repo, github.token, READ_VARIABLE), readVariable(github.repo, github.token, READ_STATE_VARIABLE),
        ]);
        const remote = mergeReadStates(parseReadState(legacy), parseReadState(versioned));
        const merged = mergeReadStates(remote, this.readState ?? parseReadState(null));
        this.readState = merged;
        this.read = readIds(merged);
        storeReadState(merged);
        await saveVariable(github.repo, github.token, READ_STATE_VARIABLE, serializeReadState(merged));
        await saveVariable(github.repo, github.token, READ_VARIABLE, JSON.stringify(readIds(merged)));
      }).catch(() => this.showToast('이 기기에만 저장했어요. 다른 기기에는 다음에 열 때 맞춰요'));
    }, 3000);
  }

  private updateRead(ids: string[], read: boolean) {
    const selected = new Set(ids);
    const latestChange = read ? Math.max(0, ...this.notices.filter((notice) => selected.has(notice.id))
      .map((notice) => Date.parse(notice.changed_at ?? '') || 0)) : 0;
    this.readState = setReadState(this.readState ?? parseReadState(null), ids, read, Math.max(Date.now(), latestChange));
    this.read = readIds(this.readState);
    storeReadState(this.readState);
    this.pushRead();
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
    this.pushSaved();
    this.showToast(added ? '저장했어요' : '저장을 지웠어요');
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

          ${settings ? html`<settings-view .keywords=${this.keywords} .theme=${this.theme} .canInstall=${Boolean(this.install && browserTab.matches)}
              .categories=${[...new Set(this.notices.map((n) => n.category).filter((c): c is string => Boolean(c)))].sort()}
              @keywords-change=${(e: CustomEvent<string[]>) => this.setKeywords(e.detail)}
              @theme-change=${(e: CustomEvent<Theme>) => this.setTheme(e.detail)} @install-request=${this.runInstall}
              @shortcuts-request=${() => { this.shortcutsOpen = true; }}></settings-view>` : html`
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

  // 영어 공지는 옮긴 글을 먼저, 그 아래에 영어 원문을 함께 보인다(원문이 정확하다).
  private translatedView(loaded: NoticeBody | null) {
    const translation = loaded?.translation;
    if (!translation?.body) return this.bodyView(loaded);
    return html`<section class="detail-section body-text" aria-label="한국어로 옮긴 본문">
        <h3>본문 (한국어로 옮긴 글)</h3>
        <p class="detail-note first">Gemini 번역이에요. 정확한 내용은 아래 영어 원문을 확인해 주세요</p>
        ${translation.body.split(/\n+/).filter(Boolean).map((para) => html`<p>${para}</p>`)}
      </section>
      <div class="original-body" lang="en">${this.bodyView(loaded, '영어 원문')}</div>`;
  }

  private bodyView(loaded: NoticeBody | null, heading = '본문') {
    if (!loaded) return html`<p class="detail-note" role="status">본문을 불러오지 못했어요. 원문에서 확인해 주세요</p>`;
    if (!loaded.body && !loaded.body_html && !loaded.images?.length && loaded.body_status !== 'ready') {
      const status = loaded.body_status ?? (loaded.fetched_at ? 'ready' : 'pending');
      const message = {
        pending: '본문을 준비하고 있어요. 먼저 원문을 볼 수 있어요',
        retrying: '본문을 다시 가져올 예정이에요. 먼저 원문을 볼 수 있어요',
        unavailable: '본문을 가져오지 못했어요. 나중에 다시 확인할게요. 먼저 원문을 볼 수 있어요',
        ready: '본문에 내용이 없어요. 원문에서 확인해 주세요',
      }[status];
      return html`<p class="detail-note" role="status">${message}</p>`;
    }
    const paragraphs = (loaded.body ?? '').split(/\n+/).filter(Boolean);
    // 정제한 본문 HTML이 있으면 표, 굵게, 링크, 목록을 살려 그린다(D-016). 그림도 그 안에 들어 있다.
    if (loaded.body_html && !loaded.body_from_image) {
      return html`<section class="detail-section body-text" aria-label=${heading}><h3>${heading}</h3>
        <div class="rich">${unsafeHTML(cleanHtml(loaded.body_html))}</div></section>`;
    }
    // 그림은 사용자가 볼 때만 학교 서버에서 받는다(수집 실행은 주소만 저장).
    const images = (loaded.images ?? []).map(safeUrl).filter((url) => url !== '#');
    if (!paragraphs.length && !images.length) return html`<p class="detail-note">본문에 글자가 없어요. 원문 열기로 볼 수 있어요</p>`;
    return html`<section class="detail-section body-text" aria-label="본문">
      <h3>${loaded.body_from_image ? `${heading} (그림에서 읽은 글)` : heading}</h3>
      ${loaded.body_from_image && paragraphs.length ? html`<p class="detail-note first">그림 속 글자를 기계가 옮겨 적어서 틀린 곳이 있을 수 있어요. 아래 그림과 원문이 정확해요</p>` : nothing}
      ${paragraphs.map((para) => html`<p>${para}</p>`)}
      ${images.map((src, index) => html`<img src=${src} alt="본문 그림 ${index + 1}" loading="lazy" referrerpolicy="no-referrer">`)}
    </section>`;
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
      return this.empty('목록을 불러오지 못했어요', '인터넷 연결을 확인하고 다시 시도해 주세요', '다시 불러오기', () => this.refresh());
    }
    if (!list.length) {
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
        <ol class="rows">${items.map((n) => this.row(n, today))}</ol>
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

  private reasonLine(notice: Notice) {
    const ai = this.judgement(notice)?.ai;
    const interests = this.interests(notice);
    if (interests.length) {
      return html`<span class="reason"><b class="interest">관심 ${interests.join(', ')}</b>${ai && ai.verdict !== 'not_relevant' ? ai.reason : ''}</span>`;
    }
    if (ai) return html`<span class="reason ${ai.verdict}"><b>${VERDICT_LABEL[ai.verdict]}</b>${ai.reason}</span>`;
    const rule = this.judgement(notice)?.rule_name;
    return rule ? html`<span class="reason rule"><b>기준</b>${rule}</span>` : nothing;
  }

  private dday(notice: Notice, today: string) {
    if (!notice.deadline) return nothing;
    const passed = deadlinePassed(notice.deadline);
    const urgent = !passed && daysLeft(notice.deadline, today) <= SOON_DAYS;
    return html`<span class="dday ${urgent ? 'urgent' : ''} ${passed ? 'ended' : ''}">${deadlineText(notice.deadline, today)}</span>`;
  }

  private row(notice: Notice, today: string) {
    const ai = this.judgement(notice)?.ai;
    const source = this.sources.find((s) => s.id === notice.source_id);
    const dim = ai?.verdict === 'not_relevant' && !this.interests(notice).length;
    return html`<li class=${this.selecting ? 'batch-row' : ''}>
      ${this.selecting ? html`<label class="selection-check"><input type="checkbox"
        aria-label=${`${cleanTitle(notice.title_ko || notice.title)} 선택`}
        .checked=${this.selectedReads.includes(notice.id)} @change=${() => this.toggleReadSelection(notice.id)}></label>` : nothing}
      <a class="row ${dim ? 'dim' : ''} ${this.isRead(notice) ? 'read' : 'unread'}" href=${safeUrl(notice.url)} target="_blank" rel="noopener"
        data-id=${notice.id} aria-current=${this.isWide && this.detailOpen && this.shownId === notice.id ? 'true' : 'false'}
        @click=${(e: MouseEvent) => this.onRow(e, notice)}>
        <span class="visually-hidden">${this.isRead(notice) ? '읽은 공지' : '읽지 않은 공지'}</span>
        <span class="meta"><span class="board">${boardName(source, notice.source_id)}</span>${(() => {
          const tags = [notice.category, notice.pinned ? '고정' : '', notice.changed_at ? '수정됨' : '',
            this.view !== 'saved' && this.isSaved(notice) ? '저장함' : ''].filter(Boolean);
          return tags.length ? html`<span class="cat" title=${tags.join(', ')}>${tags.join(', ')}</span>` : nothing;
        })()}</span>
        <span class="title">${cleanTitle(notice.title_ko || notice.title)}</span>
        <span class="sub">${this.reasonLine(notice)}</span>
        ${this.dday(notice, today)}
      </a></li>`;
  }

  private detail(notice: Notice) {
    const judgement = this.judgement(notice);
    const source = this.sources.find((s) => s.id === notice.source_id);
    const interests = this.interests(notice);
    const today = todayKst();
    const body = this.body(notice);
    const loaded = body !== 'loading' ? body : null;
    const reason = this.reasonLine(notice);
    // 순서: 내용이 먼저, 관리 정보(게시일, 알림 여부)는 맨 아래(사용자 요청 2026-11-02, ux-rules 1절).
    return html`
      <div class="detail">
        <p class="meta"><span>${boardName(source, notice.source_id)}</span>${notice.category ? html`<span>${notice.category}</span>` : nothing}</p>
        <h2 class="detail-title" title=${cleanTitle(notice.title_ko || notice.title)}>${cleanTitle(notice.title_ko || notice.title)}</h2>
        ${notice.title_ko ? html`<p class="detail-original" lang="en">${cleanTitle(notice.title)}</p>` : nothing}
        ${reason === nothing ? nothing : html`<p class="detail-reason">${reason}</p>`}
        ${notice.deadline ? html`<p class="detail-deadline">${notice.deadline_kind ?? '마감'} ${deadlineDetail(notice.deadline)} ${this.dday(notice, today)}</p>` : nothing}
        ${notice.changed_at ? html`<p class="detail-change">${koreanDate(notice.changed_at.slice(0, 10))}에 원문 ${notice.change_kind === '제목' ? '제목이' : '본문이'} 바뀌었어요</p>` : nothing}
        ${loaded?.summary ? html`<section class="detail-section summary" aria-label="요약">
          <h3>요약</h3>${loaded.summary.split('\n').filter(Boolean).map((line) => html`<p>${line}</p>`)}</section>` : nothing}
        ${!loaded?.summary && loaded?.summary_status === 'failed' ? html`<section class="detail-section" aria-label="요약">
          <h3>요약</h3><p class="detail-note first" role="status">요약을 만들지 못했어요. 나중에 다시 시도해요</p></section>` : nothing}
        ${body === 'loading' ? html`<p class="detail-note">본문을 불러오는 중</p>`
          : !loaded ? html`<p class="detail-note" role="status">본문을 불러오지 못했어요. 다시 불러오거나 원문을 확인해 주세요</p>
              <button type="button" class="text-button" @click=${() => { this.bodies.delete(notice.id); this.requestUpdate(); }}>본문 다시 불러오기</button>`
          : this.translatedView(loaded)}
        ${loaded?.attachments?.length ? this.attachmentsView(loaded) : nothing}
        <dl class="facts" aria-label="글 정보">
          <div><dt>게시일</dt><dd>${koreanDate(notice.posted_on)}</dd></div>
          ${notice.previous_title ? html`<div><dt>이전 제목</dt><dd>${cleanTitle(notice.previous_title)}</dd></div>` : nothing}
          ${interests.length ? html`<div><dt>관심</dt><dd><b class="interest">${interests.join(', ')}</b></dd></div>` : nothing}
          ${judgement?.notified ? html`<div><dt>알림</dt><dd>알림을 보냈어요</dd></div>` : nothing}
        </dl>
      </div>`;
  }

  private saveButton(notice: Notice) {
    const saved = this.isSaved(notice);
    return html`<button type="button" class="icon-button save-button" aria-pressed=${String(saved)}
      aria-label=${saved ? '저장 지우기' : '저장하기'} title=${saved ? '저장 지우기 (S)' : '저장하기 (S)'} aria-keyshortcuts="s"
      @click=${() => this.toggleSave(notice)}>${icon(saved ? 'bookmark-on' : 'bookmark')}</button>`;
  }

  private attachmentsView(loaded: NoticeBody) {
    return html`<section class="detail-section" aria-label="첨부">
      <h3>첨부 ${loaded.attachments.length}개</h3>
      <ul class="attachments">${loaded.attachments.map((file) => html`<li>
        <a class="file" href=${safeUrl(file.url)} target="_blank" rel="noopener">
          <span class="file-type">${fileType(file.name, file.type)}</span>
          <span class="file-name">${file.name}</span>${file.size ? html`<span class="file-size">${file.size}</span>` : nothing}</a></li>`)}</ul>
      <p class="detail-note first">누르면 학교 공지 사이트의 원본 파일을 받아요</p></section>`;
  }
}

customElements.define('notice-app', NoticeApp);
