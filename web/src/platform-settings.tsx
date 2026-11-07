import { createRoot, type Root } from 'react-dom/client';
import { useEffect, useState } from 'react';

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
