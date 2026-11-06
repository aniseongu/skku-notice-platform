// 출처: https://github.com/temporalio/documentation/blob/main/docs/develop/typescript/activities/timeouts.mdx
// 성공한 단계는 다시 실행하지 않는다. 상태와 입력은 이 탭의 메모리에만 둔다.
export function connectionChain(steps: Array<() => Promise<void>>) {
  let next = 0;
  let running = false;
  return {
    async run(): Promise<void> {
      if (running) throw new Error('이미 연결하고 있어요');
      running = true;
      try {
        while (next < steps.length) {
          await steps[next]();
          next++;
        }
      } finally { running = false; }
    },
  };
}
