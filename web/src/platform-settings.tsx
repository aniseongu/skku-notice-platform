import { createRoot, type Root } from 'react-dom/client';
import { useEffect, useState } from 'react';
import { ENROLLMENT, MILITARY, type ByokStatus, type JudgeProfile } from './byok';

export interface SettingsModel {
  configured: boolean;
  userId: string | null;
  email: string | null;
  authBusy: boolean;
  authError: string;
  sources: { id: string; label: string }[];
  subscriptions: string[];
  subscriptionsOnly: boolean;
  setSubscriptionsOnly: (enabled: boolean) => void;
  keywords: string[];
  preferencesLoading: boolean;
  preferencesError: string;
  preferencesUnavailable: boolean;
  retryPreferences: () => void;
  saveKeywords: (input: string) => void;
  loading: boolean;
  error: string;
  signIn: () => void;
  signOut: () => void;
  toggle: (id: string, enabled: boolean) => void;
  retry: () => void;
  pushStatus: 'unsupported' | 'checking' | 'off' | 'on' | 'busy' | 'denied';
  pushError: string;
  pushRetry?: boolean;
  enablePush: () => void;
  disablePush: () => void;
  byok?: {
    available: boolean;
    loading: boolean;
    busy: boolean;
    error: string;
    status: ByokStatus | null;
    profile: JudgeProfile;
    profileMessage: string;
    register: (apiKey: string) => void;
    remove: () => void;
    saveProfile: (profile: JudgeProfile) => void;
  };
}

function ByokSection({ byok }: { byok: NonNullable<SettingsModel['byok']> }) {
  const [apiKey, setApiKey] = useState('');
  const [profile, setProfile] = useState(byok.profile);
  const profileKey = JSON.stringify(byok.profile);
  useEffect(() => setProfile(byok.profile), [profileKey]);
  // 등록이 끝나 상태가 생기면 입력란을 비운다. 키는 이 입력란 밖에 남기지 않는다.
  useEffect(() => { if (byok.status) setApiKey(''); }, [byok.status?.keyHint]);
  const numeric = (value: string) => value === '' ? null : Number(value);
  return <>
    <h2>인턴 공고 알림 (선택)</h2>
    <p>링커리어와 자소설닷컴의 인턴 공고를 내 Gemini 키로 살펴보고, 나에게 맞는 공고만 알려드려요. 키가 없어도 다른 알림은 그대로예요.</p>
    {byok.loading ? <p role="status">불러오고 있어요.</p> : byok.status
      ? <><p>등록된 키 ····{byok.status.keyHint}{byok.status.disabled ? ' (사용 중지됨)' : ''}</p>
        {byok.status.lastError ? <p role="alert">{byok.status.lastError}</p> : null}
        <button className="ghost-button" disabled={byok.busy} onClick={() => byok.remove()}>키 지우기</button></>
      : <>
        <label>Gemini API 키<input type="password" autoComplete="off" spellCheck={false} aria-label="Gemini API 키" value={apiKey}
          disabled={byok.busy} onChange={(event) => setApiKey(event.currentTarget.value.trim())} /></label>
        <p>키는 암호화해 서버에만 저장하고, 나에게 맞는 공고를 고르는 데만 써요.</p>
        <button className="solid-button" disabled={byok.busy || !apiKey} onClick={() => byok.register(apiKey)}>
          {byok.busy ? '확인하고 있어요' : '키 등록하기'}</button></>}
    {byok.error ? <p role="alert">{byok.error}</p> : null}
    <h3>지원 자격 확인용 정보</h3>
    <p>공고의 지원 자격을 판단할 때만 써요. 이름이나 학번은 받지 않아요.</p>
    <label>학년<select aria-label="학년" value={profile.year ?? ''} onChange={(event) => setProfile({ ...profile, year: numeric(event.currentTarget.value) })}>
      <option value="">선택 안 함</option>{[1, 2, 3, 4, 5, 6].map((n) => <option key={n} value={n}>{n}학년</option>)}</select></label>
    <label>학기<select aria-label="학기" value={profile.semester ?? ''} onChange={(event) => setProfile({ ...profile, semester: numeric(event.currentTarget.value) })}>
      <option value="">선택 안 함</option><option value="1">1학기</option><option value="2">2학기</option></select></label>
    <label>재학 상태<select aria-label="재학 상태" value={profile.enrollmentStatus ?? ''} onChange={(event) => setProfile({ ...profile, enrollmentStatus: event.currentTarget.value || null })}>
      <option value="">선택 안 함</option>{ENROLLMENT.map((v) => <option key={v} value={v}>{v}</option>)}</select></label>
    <label>병역<select aria-label="병역" value={profile.militaryService ?? ''} onChange={(event) => setProfile({ ...profile, militaryService: event.currentTarget.value || null })}>
      <option value="">선택 안 함</option>{MILITARY.map((v) => <option key={v} value={v}>{v}</option>)}</select></label>
    <button className="ghost-button" disabled={byok.busy} onClick={() => byok.saveProfile(profile)}>정보 저장하기</button>
    {byok.profileMessage ? <p role="status">{byok.profileMessage}</p> : null}
  </>;
}

function PlatformSettings({ model }: { model: SettingsModel }) {
  const [keywordInput, setKeywordInput] = useState(model.keywords.join('\n'));
  const keywordKey = model.keywords.join('\n');
  useEffect(() => setKeywordInput(keywordKey), [model.userId, keywordKey]);
  return <section className="platform-settings" aria-label="설정">
    <h2>계정</h2>
    {!model.configured ? <p>로그인 연결을 준비하고 있어요.</p> : model.userId
      ? <><p>{model.email ?? '로그인됨'}</p><button className="ghost-button" disabled={model.authBusy} onClick={model.signOut}>이 기기에서 로그아웃</button></>
      : <button className="solid-button" disabled={model.authBusy} onClick={model.signIn}>Google 계정으로 계속하기</button>}
    {model.authError && <p role="alert">{model.authError}</p>}
    {model.userId && <><h2>관심 키워드</h2>
      <label>한 줄에 하나씩 입력해요<textarea aria-label="관심 키워드" rows={4} value={keywordInput} disabled={model.preferencesLoading} onChange={(event) => setKeywordInput(event.currentTarget.value)} /></label>
      {model.preferencesError ? <p role="alert">{model.preferencesError}</p> : null}
      {model.preferencesUnavailable ? <button className="ghost-button" disabled={model.preferencesLoading} onClick={model.retryPreferences}>키워드 다시 불러오기</button> : null}
      <button className="ghost-button" disabled={model.preferencesLoading || model.preferencesUnavailable} onClick={() => model.saveKeywords(keywordInput)}>키워드 저장하기</button>
      <h2>알림</h2>
      {model.pushStatus === 'unsupported' ? <p>이 브라우저에서는 알림을 받을 수 없어요.</p>
        : model.pushStatus === 'denied' ? <p>브라우저 설정에서 알림을 허용하면 다시 켤 수 있어요.</p>
        : model.pushStatus === 'on' ? <><p>이 기기로 알림을 받고 있어요.</p><button className="ghost-button" onClick={model.disablePush}>이 기기 알림 끄기</button></>
        : <><p>구독한 게시판의 새 공지를 알려드려요. 관심 키워드와 맞는 공지는 소리로, 나머지는 조용히 보여드려요.</p>
          <button className="solid-button" disabled={model.pushStatus !== 'off'} onClick={model.enablePush}>
            {model.pushStatus === 'off' ? (model.pushRetry ? '다시 시도하기' : '이 기기에서 알림 받기') : '확인하고 있어요'}</button></>}
      {model.pushError ? <p role="alert">{model.pushError}</p> : null}
      {model.byok?.available ? <ByokSection byok={model.byok} /> : null}
      <h2>게시판 구독</h2>
      <p>알림을 받을 게시판을 선택해요.</p>
      <label><input type="checkbox" checked={model.subscriptionsOnly} disabled={model.loading || !!model.error}
        onChange={(event) => model.setSubscriptionsOnly(event.currentTarget.checked)} /> 구독한 게시판만 보기</label>
      {model.sources.map((source) => <label key={source.id}>
        <input type="checkbox" checked={model.subscriptions.includes(source.id)} disabled={model.loading || !!model.error}
          onChange={(event) => model.toggle(source.id, event.currentTarget.checked)} /> {source.label}
      </label>)}
      {model.error && <><p role="alert">{model.error}</p><button className="ghost-button" onClick={model.retry}>다시 불러오기</button></>}
    </>}
    <p>{model.userId ? '저장과 읽음 표시는 계정에 남아 다른 기기에서도 이어져요.' : '로그인하지 않으면 저장과 읽음 표시는 이 브라우저에만 남아요.'}</p>
  </section>;
}

// The legacy shell owns routing while individual screens move to React.
class PlatformSettingsElement extends HTMLElement {
  private root: Root | null = null;
  private current: SettingsModel | null = null;
  set model(value: SettingsModel) { this.current = value; this.renderReact(); }
  connectedCallback() { this.root = createRoot(this); this.renderReact(); }
  disconnectedCallback() { this.root?.unmount(); this.root = null; }
  private renderReact() { if (this.root && this.current) this.root.render(<PlatformSettings key={this.current.userId ?? 'guest'} model={this.current} />); }
}
customElements.define('platform-settings-screen', PlatformSettingsElement);
