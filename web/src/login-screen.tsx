// 로그인 전용 화면. 로그인하기 전에는 앱의 어떤 부분도 보이지 않고 이 화면만 뜬다.
import { APP_NAME } from './brand';
import type { AppController } from './app-controller';

// 출처: https://developers.google.com/identity/branding-guidelines
const GoogleG = () => <svg className="login-g" width="18" height="18" viewBox="0 0 48 48" aria-hidden="true" focusable="false">
  <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
  <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
  <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
  <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
</svg>;

export function LoginStatus({ text }: { text: string }) {
  return <div className="login-screen is-status"><p role="status" className="login-status">{text}</p></div>;
}

export function LoginScreen({ app }: { app: AppController }) {
  const busy = app.authBusy;
  return <div className="login-screen">
    <div className="login-column">
      <div className="login-top">
        <div className="login-brand"><svg className="login-mark" aria-hidden="true"><use href="icons/sprite.svg#brand" /></svg><span>{APP_NAME}</span></div>
        <h1>성균관대 공지를 놓치지 않게 알려 드려요</h1>
        <p className="login-sub">로그인하면 내 학과와 관심 키워드에 맞는 공지를 모아 줘요</p>
      </div>
      <div className="login-bottom">
        <button type="button" className="google-button" disabled={busy} aria-busy={busy} onClick={() => { void app.signIn(); }}>
          {busy ? null : <GoogleG />}
          <span>{busy ? 'Google로 이동하고 있어요' : 'Google로 계속하기'}</span>
        </button>
        <div aria-live="polite" className="login-live">
          {app.authError ? <p className="login-error" role="alert">{app.authError}</p> : null}
        </div>
        <p className="login-legal">계속하면 <a href="./privacy.html">개인정보처리방침</a>에 동의하게 돼요</p>
      </div>
    </div>
  </div>;
}
