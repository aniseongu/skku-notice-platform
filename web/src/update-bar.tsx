import { useSyncExternalStore } from 'react';
import { applyUpdate, dismissUpdate, subscribeUpdate, updateAvailable } from './app-update';

/** 새 버전이 나왔다는 알림 줄. 화면을 가리지 않고, 누르기 전에는 아무것도 바뀌지 않는다. */
export function UpdateBar() {
  const available = useSyncExternalStore(subscribeUpdate, updateAvailable, () => false);
  if (!available) return null;
  return <div className="update-bar fixed bottom-[calc(var(--tabbar-h)+72px+env(safe-area-inset-bottom))] left-1/2 z-[4] flex w-max max-w-[calc(100%-32px)] [transform:translateX(-50%)] items-center gap-[12px] rounded-md bg-ink px-[16px] py-[8px] text-[14px] text-bg [box-shadow:var(--shadow-pop)] min-[1080px]:bottom-[24px]" role="status">
    <span>새 버전이 나왔어요</span>
    <button type="button" className="inline-flex min-h-[44px] items-center border-0 bg-transparent px-[4px] text-[14px] font-semibold text-bg underline [@media(hover:hover)]:hover:opacity-80 active:opacity-80" onClick={applyUpdate}>업데이트</button>
    <button type="button" className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center border-0 bg-transparent px-[4px] text-[14px] text-bg [@media(hover:hover)]:hover:opacity-80 active:opacity-80" onClick={dismissUpdate}>나중에</button>
  </div>;
}
