// <notice-app>: React 화면을 붙이는 얇은 껍데기. 상태와 동작은 AppController, 화면은 NoticeShell에 있다.
// 테스트와 검증 스크립트(e2e, 웨일)가 요소에서 상태를 읽고 바꾸므로 컨트롤러의 멤버를 요소로 위임한다.
import { createRoot, type Root } from 'react-dom/client';
import { AppController } from './app-controller';
import { NoticeShell } from './notice-shell';

class NoticeAppElement extends HTMLElement {
  readonly controller = new AppController();
  private root: Root | null = null;

  connectedCallback() {
    if (this.root) return;
    this.controller.start();
    this.root = createRoot(this);
    this.root.render(<NoticeShell app={this.controller} />);
  }

  disconnectedCallback() {
    this.root?.unmount();
    this.root = null;
    this.controller.stop();
  }
}

// 요소가 이미 가진 이름(title, hidden 등)은 건드리지 않는다.
const reserved = new Set(['constructor']);
const methods = Object.getOwnPropertyNames(AppController.prototype).filter((name) => !reserved.has(name));
const members = new Set([...Object.keys(AppController.properties), ...methods, 'leaveSettings', 'requestUpdate', 'subscribe', 'getVersion']);
const target = NoticeAppElement.prototype as unknown as Record<string, unknown>;
const controllerOf = (element: NoticeAppElement) => element.controller as unknown as Record<string, unknown>;
for (const name of members) {
  if (name in HTMLElement.prototype) continue;
  Object.defineProperty(target, name, {
    configurable: true,
    get(this: NoticeAppElement) {
      const value = controllerOf(this)[name];
      return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(this.controller) : value;
    },
    set(this: NoticeAppElement, value: unknown) { controllerOf(this)[name] = value; },
  });
}

customElements.define('notice-app', NoticeAppElement);
