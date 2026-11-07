// 화면과 무관한 상태 컨테이너의 최소 반응형 베이스. 속성에 값을 넣으면 구독자(React의 useSyncExternalStore)에게 바로 알린다.
// 알림은 동기식이어야 한다. 입력란의 값을 바꾸는 이벤트 안에서 상태가 먼저 갱신돼야 React의 제어 입력(한글 조합 포함)이 깨지지 않는다.
export type Listener = () => void;

export class Reactive {
  private values: Record<string, unknown> = {};
  private listeners = new Set<Listener>();
  private version = 0;
  private waiters: Array<() => void> = [];

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  getVersion = (): number => this.version;

  /** 값이 바뀌었음을 알린다. 내부 객체를 직접 고친 뒤 화면을 다시 그리고 싶을 때도 쓴다. */
  requestUpdate(): void {
    this.version++;
    for (const listener of [...this.listeners]) listener();
  }

  /** 다음 화면 반영 뒤에 풀린다. 반영이 일어나지 않아도 잠시 뒤 풀려 포커스 이동 같은 후속 작업이 멈추지 않는다. */
  get updateComplete(): Promise<void> {
    return new Promise((resolve) => {
      this.waiters.push(resolve);
      setTimeout(resolve, 100);
    });
  }

  /** 화면이 반영된 직후 뷰가 부른다. */
  commit(): void {
    const waiting = this.waiters;
    this.waiters = [];
    for (const resolve of waiting) resolve();
  }

  /** @internal defineReactive가 쓰는 저장소 접근 */
  getValue(name: string): unknown { return this.values[name]; }
  setValue(name: string, value: unknown): void {
    if (Object.is(this.values[name], value)) return;
    this.values[name] = value;
    this.requestUpdate();
  }
}

/** 이름마다 읽기·쓰기 접근자를 클래스에 만든다. 클래스 필드 초기화는 이 접근자를 거치도록 useDefineForClassFields를 끈다. */
export function defineReactive(ctor: { prototype: Reactive }, names: readonly string[]): void {
  for (const name of names) {
    Object.defineProperty(ctor.prototype, name, {
      configurable: true,
      enumerable: true,
      get(this: Reactive) { return this.getValue(name); },
      set(this: Reactive, value: unknown) { this.setValue(name, value); },
    });
  }
}
