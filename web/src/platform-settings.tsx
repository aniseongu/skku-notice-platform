import { createRoot, type Root } from 'react-dom/client';

export interface SettingsModel {
  configured: boolean;
  userId: string | null;
  email: string | null;
  authBusy: boolean;
  authError: string;
  sources: { id: string; label: string }[];
  subscriptions: string[];
  loading: boolean;
  error: string;
  signIn: () => void;
  signOut: () => void;
  toggle: (id: string, enabled: boolean) => void;
  retry: () => void;
}

function PlatformSettings({ model }: { model: SettingsModel }) {
  return <section className="platform-settings" aria-label="설정">
    <h2>계정</h2>
    {!model.configured ? <p>로그인 연결을 준비하고 있어요.</p> : model.userId
      ? <><p>{model.email ?? '로그인됨'}</p><button className="ghost-button" disabled={model.authBusy} onClick={model.signOut}>이 기기에서 로그아웃</button></>
      : <button className="solid-button" disabled={model.authBusy} onClick={model.signIn}>Google 계정으로 계속하기</button>}
    {model.authError && <p role="alert">{model.authError}</p>}
    {model.userId && <><h2>게시판 구독</h2>
      <p>구독할 게시판을 선택해요. 알림 기능은 준비 중이에요.</p>
      {model.sources.map((source) => <label key={source.id}>
        <input type="checkbox" checked={model.subscriptions.includes(source.id)} disabled={model.loading || !!model.error}
          onChange={(event) => model.toggle(source.id, event.currentTarget.checked)} /> {source.label}
      </label>)}
      {model.error && <><p role="alert">{model.error}</p><button className="ghost-button" onClick={model.retry}>다시 불러오기</button></>}
    </>}
    <p>저장과 읽음 표시는 현재 이 브라우저에만 남아요.</p>
  </section>;
}

// The legacy shell owns routing while individual screens move to React.
class PlatformSettingsElement extends HTMLElement {
  private root: Root | null = null;
  private current: SettingsModel | null = null;
  set model(value: SettingsModel) { this.current = value; this.renderReact(); }
  connectedCallback() { this.root = createRoot(this); this.renderReact(); }
  disconnectedCallback() { this.root?.unmount(); this.root = null; }
  private renderReact() { if (this.root && this.current) this.root.render(<PlatformSettings model={this.current} />); }
}
customElements.define('platform-settings-screen', PlatformSettingsElement);
