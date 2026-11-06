// 설정 화면. 규칙은 docs/design/ux-rules.md 2-2절: 한 열, 왼쪽 이름과 도움말, 오른쪽 입력, 1px 구분선, 카드 없음.
import { LitElement, html, nothing, type TemplateResult } from 'lit';
import { unsafeHTML } from 'lit/directives/unsafe-html.js';
import {
  GitHubError, SecretWriteUncertainError, REPO_PATTERN, checkGeminiKey, deleteSecret, listSecrets, readVariable, saveSecret, saveVariable,
} from './github';
import { forgetToken, loadToken, readSavedSecrets, rememberSavedSecrets, storeToken } from './settings-storage';
import { GoogleError, connectGoogleCalendar, validClientId } from './google-calendar';
import { keyConnection, KeyConnectionError } from './key-connection';
import { deviceNameVariable, loadDeviceNames, saveDeviceName, suggestDeviceName } from './device-names';
import { syncCurrentDeviceName } from './device-name-sync';
import { browserPushEnabled, canvasPushMode, clearLocalBrowserPush, currentDeviceSlot, matchesCurrentDevice, DEVICE_SLOTS, defaultCanvasPushMode, connectBrowserPush, disconnectBrowserPush, pushConfiguration, setCanvasPushMode, supportsBrowserPush, testBrowserNotification } from './browser-push';

export type Theme = 'auto' | 'light' | 'dark';
type CanvasMode = 'off' | 'summary' | 'reminders';
const CANVAS_MODES: { value: CanvasMode; label: string }[] = [
  { value: 'off', label: '끄기' },
  { value: 'summary', label: '하루 요약' },
  { value: 'reminders', label: '요약과 마감' },
];

interface KeyField {
  secret: string;
  label: string;
  help: string;
  placeholder: string;
  multiline?: boolean;
  steps: (string | TemplateResult)[];
}

const link = (href: string, text: string) => html`<a href=${href} target="_blank" rel="noopener">${text}</a>`;

const KEY_FIELDS: KeyField[] = [
  {
    secret: 'GEMINI_API_KEY',
    label: 'Gemini 키',
    help: '공지의 요약과 번역, 지원 자격 판정에 써요',
    placeholder: 'AIza로 시작하는 키',
    steps: [
      html`${link('https://aistudio.google.com/apikey', 'Google AI Studio의 API 키 화면')}을 열고 Google 계정으로 로그인해요`,
      '"API 키 만들기"를 누르고, 프로젝트를 고르라고 하면 새 프로젝트를 만들어요',
      '만들어진 키를 붙여 넣고 "키 확인하기"로 확인한 뒤 "저장하기"를 눌러요',
      '무료 등급은 보낸 내용이 Google 제품 개선에 쓰일 수 있어요. 프로필에 이름, 학번, 연락처는 넣지 마세요',
    ],
  },
  {
    secret: 'CANVAS_TOKEN',
    label: '아이캠퍼스 토큰',
    help: '지금 할 수 있는 강의와 과제 마감을 알려요',
    placeholder: '아이캠퍼스에서 만든 액세스 토큰',
    steps: [
      html`${link('https://canvas.skku.edu/profile/settings', '아이캠퍼스(Canvas) 설정')}에 로그인해요. 왼쪽 "계정"에서 "설정"으로 가도 돼요`,
      '"승인된 통합" 아래 "새 액세스 토큰"을 눌러요',
      '용도에 "성공", 만료일은 학기 끝 날짜로 적고 "토큰 생성"을 눌러요',
      '토큰은 이때 한 번만 보여요. 바로 복사해서 붙여 넣어요. 잃어버렸거나 샌 것 같으면 같은 화면에서 지우고 새로 만들어요',
    ],
  },
  {
    secret: 'PROFILE_YAML',
    label: '내 프로필',
    help: 'Gemini가 지원 자격을 판단할 때 써요',
    placeholder: 'department: 소프트웨어학과\nyear: 3\nenrollment_status: 재학',
    multiline: true,
    steps: [
      '학과, 학년, 재학 상태, 캠퍼스, 복수전공, 관심 분야, 받고 싶은 공지와 받기 싫은 공지를 적어요',
      '형식은 프로젝트의 config/profile.example.yaml 파일과 같아요',
      'Google로 보내는 내용이라 이름, 학번, 전화번호, 주소는 빼고 적어요',
    ],
  },
];

const remember = (key: string, value?: string | null) => {
  try {
    if (value === undefined) return localStorage.getItem(key);
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch { /* 저장 못 해도 화면은 돈다 */ }
  return null;
};


export class SettingsView extends LitElement {
  static properties = {
    keywords: { attribute: false }, theme: { attribute: false }, categories: { attribute: false }, canInstall: { attribute: false }, muted: { state: true },
    repo: { state: true }, token: { state: true }, values: { state: true },
    saved: { state: true }, status: { state: true }, open: { state: true }, reveal: { state: true }, busy: { state: true },
    keywordDraft: { state: true }, editing: { state: true }, browserNotifications: { state: true }, linked: { state: true }, connectionState: { state: true },
    qr: { state: true }, handoff: { state: true }, canvasMode: { state: true }, scanningQr: { state: true }, summaryTime: { state: true }, summaryTimeLoaded: { state: true }, googleChain: { state: true }, googleEditing: { state: true }, deviceNames: { state: true }, deviceNameEditing: { state: true }, deviceNameDraft: { state: true }, deviceSuggestion: { state: true },
  };

  keywords: string[] = [];
  // 지금 목록에 있는 분류(notice-app이 넘긴다)와 알림을 끈 분류(Actions 변수 MUTED_CATEGORIES, D-018).
  categories: string[] = [];
  muted: string[] = [];
  theme: Theme = 'auto';
  canInstall = false;
  repo = remember('github-repo') ?? '';
  // 사용자 요청(2026-11-03)으로 연결 토큰은 이 기기에 암호화해 기억한다(D-017). 키 값은 남기지 않는다.
  token = '';
  linked = false;
  connectionState: 'loading' | 'unlinked' | 'checking' | 'connected' | 'unverified' | 'invalid' = 'loading';
  // 다른 기기 연결 QR(SVG). 1분 뒤 지운다.
  qr = '';
  scanningQr = false;
  private scanGeneration = 0;
  private stopQrScanner: (() => void) | null = null;
  // QR 주소로 받은 연결. 사용자가 "연결하기"를 누르기 전에는 쓰지 않는다(남의 저장소로 몰래 연결되는 것을 막는다).
  handoff: { repo: string; token: string } | null = null;
  private qrTimer = 0;
  // GitHub에 있는 키워드(모든 기기 공용)와 같은지 비교해 바뀐 것만 저장한다.
  private syncedKeywords: string | null = null;
  values: Record<string, string> = {};
  saved: Record<string, string> = readSavedSecrets(this.repo);
  editing: Record<string, boolean> = {};
  status: Record<string, { ok: boolean; text: string }> = {};
  open: Record<string, boolean> = {};
  reveal: Record<string, boolean> = {};
  busy = '';
  keywordDraft = '';
  browserNotifications = false;
  canvasMode: CanvasMode | null = null;
  summaryTime = '21:00';
  summaryTimeLoaded = false;
  private googleChain: { run(): Promise<void> } | null = null;
  private googleEditing = false;
  private keyChains: Record<string, { repo: string; token: string; value: string; run(): Promise<void> }> = {};
  private deviceNames: Record<string, string> = {};
  private deviceNameEditing = '';
  private deviceNameDraft = '';
  private deviceSuggestion = '';

  createRenderRoot() { return this; }

  connectedCallback() {
    super.connectedCallback();
    window.addEventListener('beforeunload', this.warnUnsaved);
    browserPushEnabled().then((enabled) => { this.browserNotifications = enabled; this.canvasMode = enabled ? canvasPushMode() : null; }).catch(() => {});
    const receivedHandoff = this.takeHandoff();
    if (!receivedHandoff) loadToken().then((token) => {
      if (token && !this.token) { this.token = token; if (this.connected()) this.connect(); }
    }).finally(() => { if (this.connectionState === 'loading') this.connectionState = 'unlinked'; });
    if (receivedHandoff) this.connectionState = 'unlinked';
    if (!this.repo && !receivedHandoff) pushConfiguration().then((config) => {
      if (!this.repo) { this.setRepo(config.repository); remember('github-repo', config.repository); }
    }).catch(() => {});
    this.updateComplete.then(() => {
      if (location.hash === '#google-calendar') this.querySelector('#google-calendar')?.scrollIntoView();
    });
  }

  disconnectedCallback() {
    window.removeEventListener('beforeunload', this.warnUnsaved);
    this.stopScanning();
    this.hideHandoff();
    this.keyChains = {};
    super.disconnectedCallback();
  }

  private warnUnsaved = (event: BeforeUnloadEvent) => {
    if (!Object.values(this.values).some((value) => value.trim())) return;
    event.preventDefault();
    event.returnValue = '';
  };

  private emit(name: string, detail: unknown) { this.dispatchEvent(new CustomEvent(name, { detail, bubbles: true })); }
  private setStatus(key: string, ok: boolean, text: string) { this.status = { ...this.status, [key]: { ok, text } }; }
  // 저장소 하나에만 권한을 주는 Fine-grained 토큰만 받는다. classic 토큰(ghp_)은 모든 저장소에 닿는다.
  private connected() { return REPO_PATTERN.test(this.repo) && this.token.startsWith('github_pat_'); }

  private setRepo(repo: string) {
    if (this.repo === repo) return;
    this.repo = repo;
    this.saved = readSavedSecrets(repo);
    this.linked = false;
    this.connectionState = 'unlinked';
    this.canvasMode = null;
    this.deviceNames = {};
    this.deviceNameEditing = '';
    this.googleChain = null;
    this.keyChains = {};
    this.editing = {};
    this.status = {};
  }

  private closeEdit(name: string) {
    delete this.keyChains[name];
    this.editing = { ...this.editing, [name]: false };
    this.values = { ...this.values, [name]: '' };
    this.reveal = { ...this.reveal, [name]: false };
    const status = { ...this.status };
    delete status[name];
    this.status = status;
  }


  private async toggleBrowserNotifications() {
    if (!this.connected()) { this.setStatus('browser-push', false, '위에서 GitHub에 한 번 연결하면 이 기기의 알림을 켤 수 있어요'); return; }
    this.busy = 'browser-push';
    try {
      if (this.browserNotifications) {
        const result = await disconnectBrowserPush(this.repo, this.token);
        this.browserNotifications = false;
        this.canvasMode = null;
        this.setStatus('browser-push', true, result.remoteRetained
          ? '이 기기 알림을 껐어요. 기기 목록에 남은 등록은 다른 기기의 것일 수도 있어요'
          : '이 기기의 알림을 껐어요');
      } else {
        await connectBrowserPush(this.repo, this.token);
        this.browserNotifications = true;
        this.canvasMode = canvasPushMode();
        this.setStatus('browser-push', true, '연결했어요. 앱을 닫아도 브라우저가 켜져 있으면 알림을 받아요');
      }
      try { this.saved = await listSecrets(this.repo, this.token); await this.refreshDeviceNames(this.saved, this.browserNotifications); }
      catch { this.setStatus('browser-push', false, '알림 설정은 바꿨어요. 기기 목록은 다시 연결해 확인해 주세요'); }
    } catch (error) {
      this.setStatus('browser-push', false, error instanceof Error ? error.message : '알림을 연결하지 못했어요');
    } finally { this.busy = ''; }
  }

  private async testBrowserNotifications() {
    try {
      await testBrowserNotification();
      this.setStatus('browser-push', true, '테스트 알림을 띄웠어요. 안 보이면 기기의 알림 설정에서 이 브라우저를 켜 주세요');
    } catch (error) {
      this.setStatus('browser-push', false, error instanceof Error ? error.message : '테스트 알림을 띄우지 못했어요');
    }
  }

  private async refreshDeviceNames(saved: Record<string, string>, enabled: boolean) {
    const repo = this.repo, token = this.token;
    const slots = [...DEVICE_SLOTS, 'WEB_PUSH_SUBSCRIPTION'].filter((slot) => saved[slot]);
    try {
      const names = await loadDeviceNames(repo, token, slots);
      const slot = enabled ? currentDeviceSlot() : null;
      let suggestion = '';
      if (slot && matchesCurrentDevice(slot, saved[slot]) && !names[slot]) {
        try {
          const synced = await syncCurrentDeviceName(repo, token);
          if (synced && currentDeviceSlot() === slot && matchesCurrentDevice(slot, saved[slot])) names[slot] = synced;
        } catch {
          suggestion = await suggestDeviceName();
          if (this.repo === repo && this.token === token) this.setStatus('device-list', false, '기기 이름을 자동으로 저장하지 못했어요. 잠시 뒤 다시 열어 주세요');
        }
      }
      if (this.repo === repo && this.token === token) { this.deviceNames = names; this.deviceSuggestion = suggestion; }
    } catch {
      if (this.repo === repo && this.token === token) {
        this.deviceNames = {};
        this.setStatus('device-list', false, '기기 이름을 불러오지 못했어요. 연결을 다시 확인해 주세요');
      }
    }
  }

  private async changeDeviceName(slot: string) {
    if (!this.linked || this.busy) return;
    this.busy = 'device-name';
    try {
      const saved = await listSecrets(this.repo, this.token);
      if (!saved[slot] || saved[slot] !== this.saved[slot]) throw new Error('기기 등록이 바뀌었어요. 다시 불러와 주세요');
      await saveDeviceName(this.repo, this.token, slot, this.deviceNameDraft);
      this.deviceNames = { ...this.deviceNames, [slot]: this.deviceNameDraft.trim() };
      this.deviceNameEditing = '';
      this.setStatus('device-list', true, '기기 이름을 저장했어요');
    } catch (error) {
      this.setStatus('device-list', false, error instanceof Error ? error.message : '기기 이름을 저장하지 못했어요');
    } finally { this.busy = ''; }
  }

  private async removeDevice(slot: string) {
    if (![...DEVICE_SLOTS, 'WEB_PUSH_SUBSCRIPTION'].includes(slot) || !this.linked) return;
    const label = this.deviceNames[slot] || (slot === 'WEB_PUSH_SUBSCRIPTION' ? '이전 알림 등록' : `알림 기기 ${slot.slice(-1)}`);
    const uncertain = currentDeviceSlot() === slot && !matchesCurrentDevice(slot, this.saved[slot]);
    const detail = uncertain ? '이 기기에서 사용한 기록이 있지만 지금은 다른 기기의 등록일 수도 있어요.'
      : '이 등록을 쓰는 기기는 알림을 다시 연결할 때까지 받을 수 없어요.';
    if (!window.confirm(`${label} 등록 정보를 삭제할까요? ${detail}`)) return;
    this.busy = 'device-list';
    try {
      if (this.browserNotifications && matchesCurrentDevice(slot, this.saved[slot])) {
        const result = await disconnectBrowserPush(this.repo, this.token);
        this.browserNotifications = false;
        this.canvasMode = null;
        if (result.remoteRetained) {
          this.setStatus('device-list', true, '이 기기 알림을 껐어요. 남은 등록은 기기 목록에서 확인해 주세요');
          return;
        }
      } else {
        const local = this.browserNotifications && currentDeviceSlot() === slot;
        const saved = await listSecrets(this.repo, this.token);
        if (saved[slot] && saved[slot] !== this.saved[slot]) throw new Error('기기 등록이 바뀌었어요');
        if (saved[slot]) {
          await deleteSecret(this.repo, this.token, slot);
        }
        if (local) {
          await clearLocalBrowserPush();
          this.browserNotifications = false;
          this.canvasMode = null;
        }
        if (saved[slot]) {
          await saveVariable(this.repo, this.token, deviceNameVariable(slot), '');
        }
      }
      this.saved = await listSecrets(this.repo, this.token);
      const names = { ...this.deviceNames }; delete names[slot]; this.deviceNames = names;
      this.setStatus('device-list', true, '등록 정보를 삭제했어요');
    } catch {
      try { this.saved = await listSecrets(this.repo, this.token); } catch { /* 확인할 수 없으면 이전 표시를 유지한다 */ }
      this.setStatus('device-list', false, '삭제를 마치지 못했어요. 다시 시도해 주세요');
    } finally { this.busy = ''; }
  }

  private async connect(sync = true) {
    remember('github-repo', this.repo);
    if (!this.connected()) { this.setStatus('github', false, '저장소는 아이디/저장소 이름으로, 토큰은 github_pat_로 시작하는 값을 넣어 주세요'); return; }
    this.busy = 'github';
    this.connectionState = 'checking';
    if (sync) this.canvasMode = null;
    const repo = this.repo;
    const token = this.token;
    try {
      const saved = await listSecrets(repo, token);
      if (this.repo !== repo || this.token !== token) return;
      rememberSavedSecrets(repo, saved);
      await storeToken(token);
      if (this.repo === repo && this.token === token) {
        this.saved = saved;
        this.linked = true;
        this.connectionState = 'connected';
        if (!sync) { await this.refreshDeviceNames(saved, await browserPushEnabled()); this.setStatus('github', true, '연결을 확인했어요'); return; }
        await this.pullKeywords(repo, token);
        this.summaryTimeLoaded = false;
        try {
          const clock = await readVariable(repo, token, 'CANVAS_SUMMARY_TIME');
          if (this.repo !== repo || this.token !== token) return;
          this.summaryTime = clock && /^([01]\d|2[0-3]):[0-5]\d$/.test(clock) ? clock : '21:00';
          this.summaryTimeLoaded = true;
          const { 'summary-time': _previous, ...otherStatus } = this.status;
          this.status = otherStatus;
        } catch {
          this.setStatus('summary-time', false, '요약 시간을 불러오지 못했어요. 기기 연결을 다시 확인해 주세요');
        }
        const muted = await readVariable(repo, token, 'MUTED_CATEGORIES');
        this.muted = (muted ?? '').split(/[,\n]/).map((w) => w.trim()).filter(Boolean);
        const enabled = await browserPushEnabled();
        if (this.repo === repo && this.token === token) {
          this.browserNotifications = enabled;
          if (enabled && canvasPushMode() === null) {
            try { await setCanvasPushMode(repo, token, defaultCanvasPushMode()); }
            catch { this.setStatus('canvas-mode', false, '아캠 알림 범위를 저장하지 못했어요. 알림 설정에서 다시 골라 주세요'); }
          }
          this.canvasMode = enabled ? canvasPushMode() : null;
          if (enabled) this.saved = await listSecrets(repo, token);
          await this.refreshDeviceNames(this.saved, enabled);
        }
        this.setStatus('github', true, '연결했어요. 다음에 열 때도 연결돼 있어요');
      }
    } catch (error) {
      // 만료되거나 지운 토큰은 기억하지 않는다. 인터넷 오류면 다음에 다시 시도한다.
      if (this.repo !== repo || this.token !== token) return;
      this.linked = false;
      this.connectionState = error instanceof GitHubError && error.status === 401 ? 'invalid' : 'unverified';
      if (error instanceof GitHubError && error.status === 401) { await forgetToken(); this.token = ''; }
      this.setStatus('github', false, error instanceof GitHubError ? error.message : '인터넷 연결을 확인해 주세요');
    } finally { this.busy = ''; }
  }

  // 다른 기기의 QR로 열면 주소 # 뒤에 저장소와 토큰이 온다. # 뒤는 서버로 가지 않고, 읽자마자 주소에서 지운다.
  private takeHandoff(): boolean {
    const params = new URLSearchParams(location.hash.slice(1));
    const token = params.get('token');
    if (!token) return false;
    history.replaceState(history.state, '', `${location.pathname}?view=settings&section=connection`);
    const repo = params.get('repo') ?? '';
    if (!token.startsWith('github_pat_') || !REPO_PATTERN.test(repo)) {
      this.setStatus('github', false, 'QR이 올바르지 않아요. 연결된 기기에서 QR을 다시 띄워 주세요');
      return true;
    }
    // 이 사이트를 배포한 저장소가 아니면 받지 않는다. 같아도 사용자가 확인해야 연결한다.
    pushConfiguration().then((config) => {
      if (config.repository === repo) this.handoff = { repo, token };
      else this.setStatus('github', false, '이 사이트의 저장소가 아닌 QR이라 연결하지 않았어요');
    }).catch(() => this.setStatus('github', false, 'QR을 확인하지 못했어요. 잠시 뒤 다시 찍어 주세요'));
    loadToken().then((saved) => { if (saved && !this.token) { this.token = saved; if (this.connected()) this.connect(); } });
    return true;
  }

  private acceptHandoff() {
    const handoff = this.handoff;
    if (!handoff) return;
    this.handoff = null;
    this.setRepo(handoff.repo);
    remember('github-repo', handoff.repo);
    this.token = handoff.token;
    this.connect();
  }

  private async showHandoff() {
    // QR 그리는 코드는 이때만 불러온다(첫 화면을 가볍게).
    const { renderSVG } = await import('uqr');
    const url = new URL(document.baseURI);
    url.search = '?view=settings&section=connection';
    url.hash = new URLSearchParams({ repo: this.repo, token: this.token }).toString();
    this.qr = renderSVG(url.href, { border: 1 });
    clearTimeout(this.qrTimer);
    this.qrTimer = window.setTimeout(() => { this.qr = ''; }, 60_000);
  }

  private hideHandoff() { clearTimeout(this.qrTimer); this.qr = ''; }

  private stopScanning() {
    this.scanGeneration++;
    this.stopQrScanner?.();
    this.stopQrScanner = null;
    this.scanningQr = false;
  }

  private async scanNotebookQr() {
    this.stopScanning();
    const generation = this.scanGeneration;
    this.scanningQr = true;
    await this.updateComplete;
    const { startQrScanner } = await import('./qr-pairing');
    const video = this.querySelector<HTMLVideoElement>('.pairing-camera');
    if (!this.scanningQr || generation !== this.scanGeneration || !video) return;
    this.stopQrScanner = startQrScanner(video, (raw) => {
      this.stopScanning();
      try {
        const url = new URL(raw);
        const params = new URLSearchParams(url.hash.slice(1));
        if (url.origin !== location.origin || url.pathname !== location.pathname
          || !REPO_PATTERN.test(params.get('repo') ?? '') || !params.get('token')?.startsWith('github_pat_')) throw new Error();
        history.replaceState(history.state, '', `${location.pathname}?view=settings&section=connection${url.hash}`);
        this.takeHandoff();
      } catch { this.setStatus('qr-scan', false, '성공의 연결 QR이 아니에요. 노트북에서 QR을 다시 띄워 주세요'); }
    }, (reason) => {
      this.stopScanning();
      const text = reason === 'denied' ? '카메라를 허용하거나 휴대폰 카메라 앱으로 노트북 QR을 찍어 주세요'
        : reason === 'timeout' ? 'QR을 찾지 못했어요. 노트북에서 새 QR을 띄우고 다시 찍어 주세요'
          : '휴대폰 카메라 앱으로 노트북 QR을 찍어 주세요. 같은 브라우저에서 열면 연결을 기억해요';
      this.setStatus('qr-scan', false, text);
    });
  }

  private async disconnect() {
    this.hideHandoff();
    await forgetToken();
    this.token = '';
    this.googleChain = null;
    this.keyChains = {};
    this.linked = false;
    this.connectionState = 'unlinked';
    this.syncedKeywords = null;
    this.setStatus('github', true, '연결을 끊었어요. 저장한 키는 GitHub에 그대로 있어요');
  }

  private async save(name: string, value: string) {
    if (this.busy) return;
    if (!value.trim()) { this.setStatus(name, false, '키를 먼저 붙여 넣어 주세요'); return; }
    const status = { ...this.status }; delete status[name]; this.status = status;
    this.busy = name;
    const repo = this.repo;
    const token = this.token;
    try {
      const trimmed = value.trim();
      if (name === 'CANVAS_TOKEN' || name === 'GEMINI_API_KEY') {
        let chain = this.keyChains[name];
        if (!chain || chain.repo !== repo || chain.token !== token || chain.value !== trimmed) {
          chain = { repo, token, value: trimmed, ...keyConnection(repo, token, name, trimmed) };
          this.keyChains[name] = chain;
        }
        await chain.run();
        delete this.keyChains[name];
      } else await saveSecret(repo, token, name, trimmed);
      const saved = { ...readSavedSecrets(repo), ...(this.repo === repo ? this.saved : {}), [name]: new Date().toISOString() };
      rememberSavedSecrets(repo, saved);
      if (this.repo === repo) {
        this.saved = saved;
        this.closeEdit(name);
        this.setStatus(name, true, name === 'CANVAS_TOKEN' ? '토큰을 저장했어요. 연결은 다음 수집 때 확인해요' : '저장했어요. 다음 실행부터 써요');
      }
    } catch (error) {
      this.setStatus(name, false, error instanceof GitHubError || error instanceof SecretWriteUncertainError || error instanceof KeyConnectionError ? error.message : '연결을 마치지 못했어요. 다시 시도해 주세요');
    } finally { this.busy = ''; }
  }

  private async check(name: string) {
    if (this.busy) return;
    const value = this.values[name]?.trim() ?? '';
    if (!value) { this.setStatus(name, false, '키를 먼저 붙여 넣어 주세요'); return; }
    const status = { ...this.status }; delete status[name]; this.status = status;
    this.busy = name;
    try {
      const ok = await checkGeminiKey(value);
      this.setStatus(name, ok, ok ? '키가 맞아요' : '키를 다시 복사해 붙여 넣어 주세요');
    } catch {
      this.setStatus(name, false, '키를 확인하지 못했어요. 잠시 뒤 다시 확인해 주세요');
    } finally { this.busy = ''; }
  }

  // GitHub 값이 있으면 그것을 따른다. 없으면 이 기기의 키워드를 올린다.
  private async pullKeywords(repo: string, token: string) {
    const remote = await readVariable(repo, token, 'INTEREST_KEYWORDS');
    const words = (remote ?? '').split(/[,\n]/).map((w) => w.trim()).filter(Boolean);
    if (words.length) {
      this.syncedKeywords = words.join('\n');
      if (words.join('\n') !== this.keywords.join('\n')) this.emit('keywords-change', words);
    } else if (this.keywords.length) {
      await this.saveKeywords();
    } else {
      this.syncedKeywords = '';
    }
  }

  updated(changed: Map<string, unknown>) {
    if (changed.has('keywords') && this.linked && this.syncedKeywords !== null
      && this.keywords.join('\n') !== this.syncedKeywords) this.saveKeywords();
  }

  private async saveKeywords() {
    const value = this.keywords.join('\n');
    try {
      await saveVariable(this.repo, this.token, 'INTEREST_KEYWORDS', value);
      this.syncedKeywords = value;
      this.setStatus('keywords', true, '모든 기기에 저장했어요');
    } catch (error) {
      this.setStatus('keywords', false, error instanceof GitHubError ? `${error.message}. 다시 바꾸면 또 저장해요` : '인터넷 연결을 확인해 주세요');
    }
  }

  private async toggleCategory(category: string) {
    if (!this.linked) { this.setStatus('muted', false, 'GitHub에 연결하면 바꿀 수 있어요'); return; }
    const before = this.muted;
    this.muted = before.includes(category) ? before.filter((c) => c !== category) : [...before, category];
    try {
      await saveVariable(this.repo, this.token, 'MUTED_CATEGORIES', this.muted.join('\n'));
      this.setStatus('muted', true, this.muted.includes(category) ? `${category} 알림을 껐어요` : `${category} 알림을 켰어요`);
    } catch (error) {
      this.muted = before;
      this.setStatus('muted', false, error instanceof GitHubError ? error.message : '인터넷 연결을 확인해 주세요');
    }
  }

  private async setCanvasMode(mode: CanvasMode) {
    if (!this.linked || !this.browserNotifications || this.busy) return;
    const repo = this.repo;
    const token = this.token;
    this.busy = 'canvas-mode';
    try {
      await setCanvasPushMode(repo, token, mode);
      if (this.repo === repo && this.token === token) {
        this.canvasMode = mode;
        this.setStatus('canvas-mode', true, '저장했어요. 다음 알림부터 이 기기에만 적용해요');
      }
    } catch (error) {
      this.setStatus('canvas-mode', false, error instanceof GitHubError ? error.message : '인터넷 연결을 확인하고 다시 골라 주세요');
    } finally { this.busy = ''; }
  }

  private resetSummaryInputs() {
    const [hour, minute] = this.summaryTime.split(':').map(Number);
    const hourInput = this.querySelector<HTMLInputElement>('#summary-hour');
    const minuteInput = this.querySelector<HTMLInputElement>('#summary-minute');
    if (hourInput) hourInput.value = String(hour % 12 || 12);
    if (minuteInput) minuteInput.value = String(minute).padStart(2, '0');
  }

  private changeSummaryPart(part: 'period' | 'hour' | 'minute', raw: string) {
    const [storedHour, storedMinute] = this.summaryTime.split(':').map(Number);
    const number = Number(raw);
    if ((part === 'hour' && (!/^\d{1,2}$/.test(raw) || number < 1 || number > 12))
        || (part === 'minute' && (!/^\d{1,2}$/.test(raw) || number > 59))) {
      this.resetSummaryInputs();
      this.setStatus('summary-time', false, '시는 1부터 12, 분은 0부터 59까지 입력해 주세요');
      return;
    }
    let hour = storedHour;
    let minute = storedMinute;
    if (part === 'period') hour = storedHour % 12 + (raw === 'pm' ? 12 : 0);
    if (part === 'hour') hour = number % 12 + (storedHour >= 12 ? 12 : 0);
    if (part === 'minute') minute = number;
    this.saveSummaryTime(`${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`);
  }

  private async saveSummaryTime(value: string) {
    if (!this.linked || !this.summaryTimeLoaded || this.busy) { this.resetSummaryInputs(); return; }
    if (value === this.summaryTime) { this.resetSummaryInputs(); return; }
    this.busy = 'summary-time';
    try {
      await saveVariable(this.repo, this.token, 'CANVAS_SUMMARY_TIME', value);
      this.summaryTime = value;
      this.setStatus('summary-time', true, '저장했어요. 모든 기기에 적용해요');
    } catch {
      this.resetSummaryInputs();
      this.setStatus('summary-time', false, '시간을 저장하지 못했어요. 연결을 확인하고 다시 골라 주세요');
    } finally { this.busy = ''; }
  }

  private addKeyword() {
    const word = this.keywordDraft.trim().replace(/\s+/g, ' ');
    if (word && !this.keywords.includes(word)) this.emit('keywords-change', [...this.keywords, word]);
    this.keywordDraft = '';
  }

  // 키 값은 클립보드에 넣지 않는다(클립보드 기록에 남는다). 이름만 있는 양식을 복사하고 값은 사용자가 직접 붙여 넣는다.
  private envText() {
    return KEY_FIELDS.filter((f) => !f.multiline).map((f) => `${f.secret}=`).join('\n');
  }

  private async connectGoogle() {
    if (this.busy) return;
    const clientId = (this.values.GOOGLE_CLIENT_ID ?? '').trim();
    const secret = (this.values.GOOGLE_CLIENT_SECRET ?? '').trim();
    if (!this.linked) { this.setStatus('google', false, '위 연결에서 GitHub에 먼저 연결해 주세요'); return; }
    if (!validClientId(clientId)) { this.setStatus('google', false, '클라이언트 ID는 .apps.googleusercontent.com으로 끝나요'); return; }
    if (secret.length < 10) { this.setStatus('google', false, '클라이언트 보안 비밀번호를 붙여 넣어 주세요'); return; }
    this.busy = 'google';
    try {
      if (!this.googleChain) this.googleChain = await connectGoogleCalendar(this.repo, this.token, clientId, secret);
      await this.googleChain.run();
      this.googleChain = null;
      this.googleEditing = false;
      this.values = { ...this.values, GOOGLE_CLIENT_ID: '', GOOGLE_CLIENT_SECRET: '' };
      this.saved = { ...this.saved, GOOGLE_CONNECTION: new Date().toISOString() };
      rememberSavedSecrets(this.repo, this.saved);
      this.setStatus('google', true, '연결했어요. 다음 공지 확인 때 "성대 공지" 캘린더에 마감이 들어가요');
    } catch (error) {
      this.setStatus('google', false, error instanceof GoogleError || error instanceof GitHubError ? error.message : '연결을 마치지 못했어요. 다시 시도해 주세요');
    } finally { this.busy = ''; }
  }

  private async disconnectGoogle() {
    if (this.busy) return;
    this.busy = 'google';
    try {
      // 갱신 토큰과 비밀번호만 지운다. 이미 넣은 일정과 캘린더는 구글에 남는다.
      const saved = await listSecrets(this.repo, this.token);
      for (const name of ['GOOGLE_CLIENT_SECRET', 'GOOGLE_REFRESH_TOKEN', 'GOOGLE_CONNECTION']) {
        if (saved[name]) await deleteSecret(this.repo, this.token, name);
        delete saved[name];
        this.saved = { ...saved };
        rememberSavedSecrets(this.repo, saved);
      }
      this.setStatus('google', true, '연결을 끊었어요. 넣어 둔 일정은 구글 캘린더에 남아요');
    } catch {
      this.setStatus('google', false, '연결을 모두 끊지 못했어요. 다시 연결 끊기를 눌러 주세요');
    } finally { this.busy = ''; }
  }

  // 마감 캘린더(deadlines.ics)와 RSS(feed.xml)는 Actions가 수집할 때 새로 쓴다(GOAL.md M3).
  private feedUrl(name: string) { return new URL(name, document.baseURI).href; }

  private async copyFeed(key: string, name: string) {
    try {
      await navigator.clipboard.writeText(this.feedUrl(name));
      this.setStatus(key, true, '주소를 복사했어요');
    } catch {
      this.setStatus(key, false, '복사하지 못했어요');
    }
  }

  private async copyEnv() {
    try {
      await navigator.clipboard.writeText(this.envText());
      this.setStatus('env', true, '양식을 복사했어요. .env 파일에 붙여 넣고 = 뒤에 값을 하나씩 넣어요');
    } catch {
      this.setStatus('env', false, '복사하지 못했어요');
    }
  }

  private note(key: string) {
    const status = this.status[key];
    return status ? html`<p class="field-note ${status.ok ? 'ok' : 'error'}" role="status">${status.text}</p>` : nothing;
  }

  private guide(key: string, steps: (string | TemplateResult)[], title = '받는 방법') {
    const opened = Boolean(this.open[key]);
    return html`
      <button type="button" class="text-button" aria-expanded=${String(opened)}
        @click=${() => { this.open = { ...this.open, [key]: !opened }; }}>${opened ? '닫기' : title}</button>
      ${opened ? html`<ol class="steps">${steps.map((step) => html`<li>${step}</li>`)}</ol>` : nothing}`;
  }

  render() {
    if (new URLSearchParams(location.search).get('keys') === '1') return html`
      <div class="settings ${this.linked ? '' : 'unlinked'}">
        <a class="settings-back" href="?view=settings">설정으로</a>
        ${!this.linked ? html`<p class="field-note">일반 설정에서 GitHub에 먼저 연결하면 키를 저장할 수 있어요</p>` : nothing}
        <section aria-labelledby="s-keys">
          <h2 id="s-keys" class="settings-head">연결 키</h2>
          <div class="box">
          ${KEY_FIELDS.map((field) => this.keyRow(field))}

          <details class="connection-manual">
            <summary>컴퓨터에서 먼저 쓰기</summary>
            <p class="field-note">저장소를 만들기 전에는 프로젝트 폴더의 .env 파일에 키를 적어요</p>
            <button type="button" class="ghost-button" @click=${this.copyEnv}>.env 양식 복사하기</button>
            ${this.note('env')}
          </details>
          </div>
        </section>

      </div>`;
    const section = new URLSearchParams(location.search).get('section');
    if (section === 'connection' || section === 'notifications' || section === 'keywords' || section === 'calendar') return html`
      <div class="settings ${this.linked ? '' : 'unlinked'}">
        <a class="settings-back" href="?view=settings">설정으로</a>
        ${section === 'connection' ? this.connectionSettings() : section === 'notifications' ? this.notificationSettings() : section === 'calendar' ? html`<section id="google-calendar" aria-labelledby="s-google-keys"><h2 id="s-google-keys" class="settings-head">구글 캘린더 연결</h2><div class="box">${this.googleKeyRow()}</div></section>` : this.keywordSettings()}
      </div>`;
    return html`
      <div class="settings settings-overview">
        <section aria-labelledby="s-preferences">
          <h2 id="s-preferences" class="settings-head">내 설정</h2>
          <div class="box">
            ${this.settingsLink('알림', '받을 공지와 이 기기 알림, 아이캠퍼스', '?view=settings&section=notifications')}
            ${this.settingsLink('관심 키워드', this.keywords.length ? `${this.keywords.length}개 키워드를 쓰고 있어요` : '관심 있는 공지를 골라 봐요', '?view=settings&section=keywords')}
            ${this.settingsLink('캘린더', this.saved.GOOGLE_CONNECTION || this.saved.GOOGLE_REFRESH_TOKEN ? '구글 연결 정보가 있어요' : '저장한 공지의 마감을 모아요', '?view=settings&section=calendar')}
          </div>
        </section>
        <section aria-labelledby="s-connections">
          <h2 id="s-connections" class="settings-head">연결</h2>
          <div class="box">
            ${this.settingsLink('기기 연결', this.connectionLabel(), '?view=settings&section=connection')}
            ${this.settingsLink('연결 키', 'Gemini 키, 아이캠퍼스 토큰과 내 프로필', '?view=settings&keys=1')}
          </div>
        </section>
        <section aria-labelledby="s-view">
          <h2 id="s-view" class="settings-head">화면</h2>
          <div class="box">
          <div class="setting">
            <div class="setting-text"><p class="setting-name">화면 모드</p><p class="setting-help">자동은 휴대폰과 PC 설정을 따라요</p></div>
            <div class="setting-control">
              <div class="segmented" role="radiogroup" aria-label="화면 모드">
                ${(['auto', 'light', 'dark'] as Theme[]).map((value) => html`
                  <button type="button" role="radio" aria-checked=${String(this.theme === value)}
                    @click=${() => this.emit('theme-change', value)}>${{ auto: '자동', light: '밝게', dark: '어둡게' }[value]}</button>`)}
              </div>
            </div>
          </div>
          ${this.canInstall ? html`<div class="setting">
            <div class="setting-text"><p class="setting-name">앱 설치</p><p class="setting-help">바탕화면이나 홈 화면에서 바로 열어요</p></div>
            <div class="setting-control"><button type="button" class="ghost-button" @click=${() => this.emit('install-request', null)}>앱으로 설치하기</button></div>
          </div>` : nothing}
          <div class="setting kbd-only">
            <div class="setting-text"><p class="setting-name">단축키</p><p class="setting-help">키보드로 빠르게 이동해요</p></div>
            <div class="setting-control"><button type="button" class="ghost-button" aria-keyshortcuts="?" @click=${() => this.emit('shortcuts-request', null)}>단축키 보기</button></div>
          </div>
          </div>
        </section>
      </div>`;
  }

  private settingsLink(label: string, help: string, href: string) {
    return html`<a class="settings-link" href=${href}><span><span class="setting-name">${label}</span><span class="setting-help">${help}</span></span><span class="settings-chevron" aria-hidden="true"></span></a>`;
  }

  private connectionLabel() {
    return {
      loading: '이 기기의 연결 정보를 읽고 있어요',
      unlinked: '이 기기에 GitHub를 연결해 주세요',
      checking: 'GitHub 연결을 확인하고 있어요',
      connected: '이 기기가 GitHub에 연결돼 있어요',
      unverified: '연결 정보를 다시 확인해 주세요',
      invalid: 'GitHub 토큰을 다시 연결해 주세요',
    }[this.connectionState];
  }

  private connectionSettings() { return html`
        <section aria-labelledby="s-github">
          <h2 id="s-github" class="settings-head">연결</h2>
          <div class="box">
          <div class="setting">
            <div class="setting-text">
              <p class="setting-name">GitHub 저장소</p>
              <p class="setting-help">한 번 연결하면 저장한 키를 모든 기기에서 함께 써요. 연결 정보는 이 기기에 기억해요</p>
            </div>
            <div class="setting-control">
              ${this.handoff ? html`
                <p class="field-note">QR로 이 기기를 ${this.handoff.repo}에 연결할까요?</p>
                <p class="field-note">내가 다른 기기에서 띄운 QR일 때만 연결해 주세요</p>
                <div class="inline">
                  <button type="button" class="solid-button" @click=${this.acceptHandoff}>연결하기</button>
                  <button type="button" class="ghost-button" @click=${() => { this.handoff = null; }}>취소</button>
                </div>` : nothing}
              <div class="connection-summary" role="status" aria-label="GitHub 연결 상태">
                <span class="setting-state">${{loading: '연결 정보 확인 중', unlinked: '연결 안 됨', checking: '연결 확인 중', connected: '연결됨', unverified: '연결 확인 필요', invalid: '다시 연결 필요'}[this.connectionState]}</span>
                ${this.connected() ? html`<span class="field-note">${this.repo}</span>` : nothing}
              </div>
              ${this.connected() ? html`<button type="button" class="ghost-button" ?disabled=${this.busy === 'github'} @click=${() => this.connect(false)}>연결 확인하기</button>` : nothing}
              ${this.linked ? html`
                <a class="ghost-button" href="?view=settings&section=notifications">이 기기 알림 설정하기</a>
                <details class="connection-manual"><summary>연결 관리</summary>
                <div class="inline">
                  <button type="button" class="ghost-button" ?disabled=${this.busy === 'github'} @click=${this.disconnect}>연결 끊기</button>
                </div></details>
                ${this.qr ? html`
                  <div class="qr" role="img" aria-label="다른 기기 연결 QR">${unsafeHTML(this.qr)}</div>
                  <p class="field-note">다른 기기에서 QR을 찍고 연결하기를 누르면 돼요. 연결 열쇠가 들어 있으니 다른 사람에게 보여 주지 마세요. 1분 뒤 사라져요</p>
                  <button type="button" class="text-button" @click=${this.hideHandoff}>QR 닫기</button>
                ` : html`<button type="button" class="text-button" @click=${this.showHandoff}>휴대폰 연결 QR 띄우기</button>`}
              ` : html`
              ${!this.handoff ? html`
                ${!this.connected() ? html`
                <p class="field-note">노트북에서 이미 연결했다면 키를 다시 넣지 않아도 돼요. 노트북의 설정, 기기 연결에서 휴대폰 연결 QR을 띄워 주세요</p>
                ${this.scanningQr ? html`
                  <video class="pairing-camera" autoplay playsinline muted aria-label="노트북 QR 카메라"></video>
                  <button type="button" class="ghost-button" @click=${this.stopScanning}>카메라 닫기</button>
                ` : html`<button type="button" class="solid-button" @click=${this.scanNotebookQr}>노트북 QR로 연결하기</button>`}
                ${this.note('qr-scan')}
                ` : nothing}
                <details class="connection-manual">
                  <summary>처음 연결하기</summary>
              <input class="input" type="text" autocomplete="off" spellcheck="false" aria-label="저장소" placeholder="아이디/저장소 이름" ?disabled=${this.busy === 'github'}
                .value=${this.repo} @input=${(e: Event) => this.setRepo((e.target as HTMLInputElement).value.trim())}>
              <div class="inline">
                <input class="input" type="password" autocomplete="off" spellcheck="false" aria-label="GitHub 토큰" placeholder="github_pat_로 시작하는 토큰" ?disabled=${this.busy === 'github'}
                  .value=${this.token} @input=${(e: Event) => { this.token = (e.target as HTMLInputElement).value.trim(); }}>
                <button type="button" class="ghost-button" ?disabled=${this.busy === 'github'} @click=${() => this.connect()}>
                  ${this.busy === 'github' ? '연결 중' : '연결하기'}</button>
              </div>
              ${this.guide('github', [
                html`${link('https://github.com/settings/personal-access-tokens/new', 'GitHub 새 토큰 화면')}을 열어요(Fine-grained token)`,
                '"Repository access"에서 "Only select repositories"를 고르고 이 저장소 하나만 골라요',
                '"Permissions"에서 Secrets, Variables와 Actions를 "Read and write"로 바꿔요. Actions는 공지를 직접 다시 가져올 때 써요',
                '만료일을 정하고 만든 토큰을 복사해 위 칸에 넣어요',
                '저장소가 아직 없으면 연결 키 화면의 ".env 양식 복사하기"로 컴퓨터에서 먼저 써요',
              ])}
                </details>
              ` : nothing}
              `}
              ${this.status.github && !this.status.github.ok ? this.note('github') : nothing}

            </div>
          </div>

          </div>
        </section>
        <section aria-labelledby="s-devices">
          <h2 id="s-devices" class="settings-head">알림 기기</h2>
          <div class="box">
            ${!this.linked ? html`<div class="setting"><p class="field-note">GitHub에 연결하면 등록된 알림 기기를 볼 수 있어요</p></div>` : html`
              ${[...DEVICE_SLOTS, 'WEB_PUSH_SUBSCRIPTION'].filter((slot) => this.saved[slot]).length === 0
                ? html`<div class="setting"><p class="field-note">등록된 알림 기기가 없어요</p></div>`
                : [...DEVICE_SLOTS, 'WEB_PUSH_SUBSCRIPTION'].filter((slot) => this.saved[slot]).sort((a, b) =>
                  Number(currentDeviceSlot() === b) - Number(currentDeviceSlot() === a)).map((slot) => {
                  const recorded = currentDeviceSlot() === slot;
                  const local = this.browserNotifications && recorded;
                  const current = local && matchesCurrentDevice(slot, this.saved[slot]);
                  const label = this.deviceNames[slot] || (current && this.deviceSuggestion) || (slot === 'WEB_PUSH_SUBSCRIPTION' ? '이전 알림 등록' : `알림 기기 ${slot.slice(-1)}`);
                  const date = new Date(this.saved[slot]);
                  const updated = Number.isNaN(date.getTime()) ? '' : new Intl.DateTimeFormat('ko-KR', { dateStyle: 'medium' }).format(date);
                  return html`<div class="setting"><div class="setting-text"><p class="setting-name">${label}${current ? ' (이 기기)' : recorded ? ' (이 기기의 연결 기록)' : ''}</p>
                    ${updated ? html`<p class="setting-help">등록 정보 갱신: ${updated}</p>` : nothing}
                    ${current && !this.deviceNames[slot] && this.deviceSuggestion ? html`<p class="setting-help">이 기기에서 제안한 이름이에요</p>` : nothing}
                    ${current ? html`<p class="setting-help">이 기기의 알림이 연결돼 있어요</p>` : recorded ? html`<p class="setting-help">지금은 다른 기기의 등록일 수도 있어요</p>` : nothing}</div>
                    <div class="setting-control">
                    ${this.deviceNameEditing === slot ? html`<div class="inline"><input class="input" aria-label="${label} 이름" maxlength="40" .value=${this.deviceNameDraft} @input=${(e: Event) => { this.deviceNameDraft = (e.target as HTMLInputElement).value; }}>
                      <button type="button" class="ghost-button" ?disabled=${!!this.busy} @click=${() => this.changeDeviceName(slot)}>저장하기</button>
                      <button type="button" class="text-button device-name-action" ?disabled=${!!this.busy} @click=${() => { this.deviceNameEditing = ''; }}>닫기</button></div>` : html`<div class="inline">
                      <button type="button" class="text-button device-name-action" aria-label="${label} 이름 바꾸기" ?disabled=${!!this.busy} @click=${() => { this.deviceNameDraft = this.deviceNames[slot] || (current ? this.deviceSuggestion : '') || ''; this.deviceNameEditing = slot; }}>이름 바꾸기</button>
                      <button type="button" class="text-button device-name-action" aria-label="${label} 등록 정보 삭제하기" ?disabled=${!!this.busy} @click=${() => this.removeDevice(slot)}>등록 정보 삭제하기</button></div>`}
                    </div></div>`;
                })}
              <div class="setting"><p class="field-note">기기 이름은 다른 기기에서도 보여요</p>
                <p class="field-note">알림이 도착하는지는 각 기기에서 확인해 주세요. 등록 목록만으로는 알 수 없어요</p>
                <a class="ghost-button" href="?view=settings&section=notifications">이 기기 알림 확인하기</a>${this.note('device-list')}</div>`}
          </div>
        </section>
  `; }

  private notificationSettings() { return html`
        <section aria-labelledby="s-notify">
          <h2 id="s-notify" class="settings-head">알림 받을 곳</h2>
          <div class="box">
          <div class="setting">
            <div class="setting-text">
              <p class="setting-name">이 기기 알림</p>
              <p class="setting-help">앱과 탭을 닫아도 브라우저가 켜져 있으면 휴대폰이나 PC 알림으로 받아요. 소리는 기기의 알림 설정을 따라요</p>
            </div>
            <div class="setting-control" data-needs-link>
              <p class="field-note link-note">기기 연결에서 노트북 QR로 연결하면 쓸 수 있어요</p>
              ${this.browserNotifications ? html`<span class="setting-state">켜짐</span>` : html`<span class="setting-state">꺼짐</span>`}
              <p class="field-note">브라우저 알림 권한: ${!supportsBrowserPush() ? '지원하지 않음' : Notification.permission === 'granted' ? '허용' : Notification.permission === 'denied' ? '차단' : '아직 선택하지 않음'}</p>
              <div class="inline">
                <button type="button" class="ghost-button" ?disabled=${this.busy === 'browser-push' || !supportsBrowserPush()}
                  @click=${this.toggleBrowserNotifications}>${this.busy === 'browser-push' ? '연결 중' : this.browserNotifications ? '알림 끄기' : '알림 받기'}</button>
                ${this.browserNotifications ? html`<button type="button" class="ghost-button" @click=${this.testBrowserNotifications}>테스트 알림 띄우기</button>` : nothing}
              </div>
              ${!supportsBrowserPush() ? html`<p class="field-note">최신 브라우저에서 알림을 연결해 주세요</p>` : nothing}
              ${this.note('browser-push')}
              <p class="field-note">알림 수신은 이 기기에만 적용해요</p>
            </div>
          </div>
          <div class="setting">
            <div class="setting-text"><p class="setting-name">받을 공지</p><p class="setting-help">알림을 보내는 기준이에요</p></div>
            <div class="setting-control"><p class="field-note">성대 공지는 모두 알려요. 인턴은 Gemini가 본문을 읽고 지원할 만한 IT 직무로 판단한 공고만 알려요</p></div>
          </div>
          </div>
        </section>
        <section aria-labelledby="s-canvas">
          <h2 id="s-canvas" class="settings-head">아이캠퍼스</h2>
          <div class="box">
            <div class="setting">
              <div class="setting-text">
                <p class="setting-name">이 기기 아캠 알림</p>
                <p class="setting-help">강의, 과제와 퀴즈 마감을 이 기기에서 받아요</p>
              </div>
              <div class="setting-control">
                <div class="segmented" role="radiogroup" aria-label="이 기기 아캠 알림">
                  ${CANVAS_MODES.map(({ value, label }) => html`
                    <button type="button" role="radio" aria-checked=${String(this.browserNotifications && this.canvasMode === value)}
                      ?disabled=${!this.linked || !this.browserNotifications || this.busy !== ''}
                      @click=${() => this.setCanvasMode(value)}>${label}</button>`)}
                </div>
                <p class="field-note">${!this.linked ? '기기를 연결하면 알림을 설정할 수 있어요' : !this.browserNotifications ? '먼저 이 기기 알림을 켜 주세요' : '요약과 마감을 고르면 하루 전과 3시간 전에도 알려요'}</p>
                ${this.linked && !this.saved.CANVAS_TOKEN ? html`<p class="field-note">연결 키에서 아이캠퍼스 토큰을 저장해 주세요</p>` : nothing}
                ${this.status['canvas-mode'] && !this.status['canvas-mode'].ok ? this.note('canvas-mode') : nothing}
              </div>
            </div>
            <div class="setting">
              <div class="setting-text">
                <p class="setting-name" id="summary-time-label">하루 요약 시간</p>
                <p class="setting-help">모든 기기에 같은 시간을 적용해요. 할 일이 없어도 알려요</p>
              </div>
              <div class="setting-control">
                <div class="time-control" role="group" aria-labelledby="summary-time-label">
                  <div class="segmented" role="group" aria-label="오전 또는 오후">
                    ${[['am', '오전'], ['pm', '오후']].map(([period, label]) => html`
                      <button type="button" aria-pressed=${String((Number(this.summaryTime.slice(0, 2)) >= 12) === (period === 'pm'))}
                        ?disabled=${!this.linked || !this.summaryTimeLoaded || this.busy !== ''}
                        @click=${() => this.changeSummaryPart('period', period)}>${label}</button>`)}
                  </div>
                  <div class="time-numbers">
                    <input id="summary-hour" class="input time-number" type="number" min="1" max="12" inputmode="numeric"
                      aria-label="시" .value=${String(Number(this.summaryTime.slice(0, 2)) % 12 || 12)}
                      ?disabled=${!this.linked || !this.summaryTimeLoaded || (this.busy !== '' && this.busy !== 'summary-time')}
                      ?readonly=${this.busy === 'summary-time'}
                      @change=${(e: Event) => this.changeSummaryPart('hour', (e.target as HTMLInputElement).value)}><span>시</span>
                    <input id="summary-minute" class="input time-number" type="number" min="0" max="59" inputmode="numeric"
                      aria-label="분" .value=${this.summaryTime.slice(3)}
                      ?disabled=${!this.linked || !this.summaryTimeLoaded || (this.busy !== '' && this.busy !== 'summary-time')}
                      ?readonly=${this.busy === 'summary-time'}
                      @change=${(e: Event) => this.changeSummaryPart('minute', (e.target as HTMLInputElement).value)}><span>분</span>
                  </div>
                </div>
                ${this.note('summary-time')}
                <p class="field-note">확인이 늦어지면 알림도 늦어져요</p>
              </div>
            </div>
          </div>
        </section>
        <details class="connection-manual"><summary>RSS 피드로 받기</summary>
        <section aria-labelledby="s-feeds">
          <h2 id="s-feeds" class="settings-head">RSS 피드</h2>
          <div class="box">
          <div class="setting">
            <div class="setting-text">
              <p class="setting-name">RSS 피드</p>
              <p class="setting-help">피드 앱(Feedly, Inoreader 등)에서 새 공지를 받아 봐요</p>
            </div>
            <div class="setting-control">
              <button type="button" class="ghost-button" @click=${() => this.copyFeed('feed', 'feed.xml')}>피드 주소 복사하기</button>
              ${this.note('feed')}
            </div>
          </div>
          </div>
        </section>
        </details>
  `; }

  private keywordSettings() { return html`
        <section aria-labelledby="s-keywords">
          <h2 id="s-keywords" class="settings-head">관심 키워드</h2>
          <div class="box">
          <div class="setting">
            <div class="setting-text">
              <p class="setting-name">키워드</p>
              <p class="setting-help">제목이나 본문에 이 글자가 그대로 들어간 공지를 "관심"으로 표시해요</p>
            </div>
            <div class="setting-control">
              <div class="inline">
                <input class="input" type="text" autocomplete="off" aria-label="새 키워드" placeholder="예: 겨울방학 인턴" .value=${this.keywordDraft}
                  @input=${(e: Event) => { this.keywordDraft = (e.target as HTMLInputElement).value; }}
                  @keydown=${(e: KeyboardEvent) => { if (e.key === 'Enter' && !e.isComposing) this.addKeyword(); }}>
                <button type="button" class="ghost-button" @click=${this.addKeyword}>추가하기</button>
              </div>
              ${this.keywords.length ? html`<ul class="keyword-list">${this.keywords.map((word) => html`
                <li><span>${word}</span><button type="button" class="text-button" aria-label="${word} 삭제"
                  @click=${() => this.emit('keywords-change', this.keywords.filter((w) => w !== word))}>삭제</button></li>`)}</ul>` : nothing}
              ${this.linked ? this.note('keywords') : html`<p class="field-note">기기를 연결하면 다른 기기와 같은 키워드를 써요</p>`}
            </div>
          </div>
          </div>
        </section>
  `; }

  private googleKeyRow() {
    return html`
          <div class="setting">
            <div class="setting-text">
              <p class="setting-name">Google 캘린더</p>
              <p class="setting-help">저장한 공지의 마감을 자동으로 모아요</p>
            </div>
            <div class="setting-control">

              ${(this.saved.GOOGLE_CONNECTION || this.saved.GOOGLE_REFRESH_TOKEN || this.saved.GOOGLE_CLIENT_SECRET) && !this.googleChain && !this.googleEditing ? html`
                <span class="setting-state">${this.saved.GOOGLE_CONNECTION || (this.saved.GOOGLE_REFRESH_TOKEN && this.saved.GOOGLE_CLIENT_SECRET) ? '연결 정보 저장됨' : '연결 정보 확인 필요'}</span>
                <details class="connection-manual"><summary>연결 관리</summary>
                <button type="button" class="ghost-button" ?disabled=${!!this.busy || !this.linked} @click=${() => { this.googleEditing = true; }}>다시 연결하기</button>
                <button type="button" class="ghost-button" ?disabled=${!!this.busy || !this.linked} @click=${this.disconnectGoogle}>연결 끊기</button></details>
              ` : html`
                <span class="setting-state">${this.linked ? '미연결' : '확인 필요'}</span>
                <details class="connection-manual" ?open=${!!this.googleChain || this.googleEditing}><summary>연결하기</summary>
                <input class="input" type="text" autocomplete="off" spellcheck="false" aria-label="구글 클라이언트 ID" placeholder="클라이언트 ID (apps.googleusercontent.com으로 끝나요)"
                  ?disabled=${!!this.googleChain} .value=${this.values.GOOGLE_CLIENT_ID ?? ''} @input=${(e: Event) => { this.values = { ...this.values, GOOGLE_CLIENT_ID: (e.target as HTMLInputElement).value }; }}>
                <input class="input" type="password" autocomplete="off" spellcheck="false" aria-label="구글 클라이언트 보안 비밀번호" placeholder="클라이언트 보안 비밀번호"
                  ?disabled=${!!this.googleChain} .value=${this.values.GOOGLE_CLIENT_SECRET ?? ''} @input=${(e: Event) => { this.values = { ...this.values, GOOGLE_CLIENT_SECRET: (e.target as HTMLInputElement).value }; }}>
                <button type="button" class="solid-button" ?disabled=${!!this.busy || !this.linked} @click=${this.connectGoogle}>
                  ${this.busy === 'google' ? '연결 중' : this.googleChain ? '다시 시도하기' : '구글 캘린더 연결하기'}</button>
                ${this.googleChain ? html`<button type="button" class="text-button" ?disabled=${this.busy === 'google'} @click=${() => { this.googleChain = null; this.setStatus('google', false, '다시 연결하려면 구글 승인을 받아 주세요'); }}>처음부터 다시 연결하기</button>` : nothing}
                ${this.googleEditing ? html`<button type="button" class="text-button" ?disabled=${this.busy === 'google'} @click=${() => { this.googleEditing = false; this.googleChain = null; this.values = { ...this.values, GOOGLE_CLIENT_ID: '', GOOGLE_CLIENT_SECRET: '' }; }}>닫기</button>` : nothing}
                ${this.linked ? nothing : html`<p class="field-note">GitHub에 연결하면 쓸 수 있어요</p>`}
              ${this.guide('google', [
                html`${link('https://console.cloud.google.com/apis/credentials', 'Google Cloud 사용자 인증 정보')}를 열어요. 아캠 플러스 때 만든 프로젝트를 그대로 써도 돼요`,
                html`${link('https://console.cloud.google.com/apis/library/calendar-json.googleapis.com', 'Google Calendar API')}를 "사용"으로 켜요`,
                '"OAuth 클라이언트 ID"의 웹 애플리케이션을 열거나 새로 만들어요',
                '"승인된 자바스크립트 원본"에 https://aniseongu.github.io 를 넣어요',
                `"승인된 리디렉션 URI"에 ${new URL('oauth-callback.html', document.baseURI).href} 를 넣어요`,
                html`${link('https://console.cloud.google.com/auth/audience', 'OAuth 대상')}에서 사용자 유형을 "내부로 설정"해요. 학교 계정(g.skku.edu)으로 쓰면 이것만으로 돼요`,
                '학교 밖 계정(개인 Gmail)으로 쓰려면 "외부"로 두고 브랜딩을 채운 뒤 게시 상태를 "프로덕션"으로 바꿔요. "테스트"로 두면 7일마다 연결이 끊겨요',
                '클라이언트 ID와 보안 비밀번호를 위 칸에 붙여 넣고 연결하기를 눌러요',
                '"외부"로 두었다면 "확인되지 않은 앱" 화면이 나와요. 내가 만든 앱이니 고급, 이동을 눌러요',
              ], '연결하는 방법')}
                </details>
              `}
              ${this.status.google && !this.status.google.ok ? this.note('google') : nothing}

            </div>
          </div>
    `;
  }

  private keyRow(field: KeyField) {
    const name = field.secret;
    const shown = Boolean(this.reveal[name]);
    const value = this.values[name] ?? '';
    const editing = Boolean(this.editing[name]);
    const state = this.saved[name] ? '저장됨' : this.linked ? '미설정' : '확인 필요';
    const onInput = (e: Event) => {
      const next = (e.target as HTMLInputElement).value;
      if (this.values[name] !== next) {
        delete this.keyChains[name];
        const status = { ...this.status }; delete status[name]; this.status = status;
      }
      this.values = { ...this.values, [name]: next };
    };
    return html`
      <div class="setting" data-key=${name}>
        <div class="setting-text">
          <p class="setting-name">${field.label}</p>
          <p class="setting-help">${field.help}</p>
        </div>
        <div class="setting-control">
          ${editing ? html`
            ${field.multiline
              ? html`<textarea class="input" rows="5" autocomplete="off" spellcheck="false" aria-label=${field.label}
                  placeholder=${field.placeholder} ?disabled=${!!this.busy} .value=${value} @input=${onInput}></textarea>`
              : html`<div class="inline">
                  <input class="input" type=${shown ? 'text' : 'password'} autocomplete="off" spellcheck="false" aria-label=${field.label}
                    placeholder=${field.placeholder} ?disabled=${!!this.busy} .value=${value} @input=${onInput}>
                  <button type="button" class="ghost-button" aria-pressed=${String(shown)} ?disabled=${!!this.busy}
                    @click=${() => { this.reveal = { ...this.reveal, [name]: !shown }; }}>${shown ? '숨기기' : '보기'}</button>
                </div>`}
            <div class="inline">
              ${name === 'GEMINI_API_KEY' ? html`<button type="button" class="ghost-button" ?disabled=${!!this.busy} @click=${() => this.check(name)}>키 확인하기</button>` : nothing}
              <button type="button" class="solid-button" ?disabled=${!this.connected() || !!this.busy} @click=${() => this.save(name, value)}>
                ${this.busy === name ? '연결 중' : this.keyChains[name] && this.status[name] && !this.status[name].ok ? '다시 시도하기' : '저장하기'}</button>
              <button type="button" class="ghost-button" ?disabled=${!!this.busy} @click=${() => this.closeEdit(name)}>닫기</button>
            </div>
            ${this.connected() && value.trim() && !this.status[name] && !this.busy ? html`<p class="field-note">아직 저장하지 않았어요</p>` : nothing}
            ${name === 'CANVAS_TOKEN' ? html`<p class="field-note">토큰 연결은 저장한 뒤 다음 수집에서 확인해요</p>` : nothing}
            ${this.note(name)}
            ${this.guide(name, field.steps, field.multiline ? '쓰는 방법' : '받는 방법')}
          ` : html`
            <div class="connection-summary">
              <span class="setting-state">${state}</span>
              <button type="button" class="text-button key-action" aria-label=${`${field.label} ${this.saved[name] ? '수정하기' : '입력하기'}`}
                @click=${() => { const status = { ...this.status }; delete status[name]; this.status = status; this.editing = { ...this.editing, [name]: true }; }}>${this.saved[name] ? '수정하기' : '입력하기'}</button>
            </div>
            ${this.note(name)}
          `}
        </div>
      </div>`;
  }

}

customElements.define('settings-view', SettingsView);
