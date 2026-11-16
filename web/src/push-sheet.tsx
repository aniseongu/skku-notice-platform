import type { AppController } from './app-controller';
import { remember } from './app-controller';
import { pushSheetDismissed, pushSheetDue } from './push-sheet-rule';

const KEY = 'push-sheet';

/** 이 기기의 알림이 꺼져 있으면 화면 아래에서 올라와 켜기를 권한다(사전 안내 후 브라우저 허용 창, 규칙은 push-sheet-rule.ts). */
export function pushSheetShown(app: AppController, update: boolean, closed: boolean): boolean {
  return !closed && !app.toast && !update && (app.pushStatus === 'off' || app.pushStatus === 'denied') && pushSheetDue(remember(KEY), Date.now());
}

export function PushSheet({ app, onClose }: { app: AppController; onClose: () => void }) {
  const denied = app.pushStatus === 'denied';
  const close = () => { remember(KEY, pushSheetDismissed(remember(KEY), Date.now())); onClose(); };
  return <section className="push-sheet fixed inset-x-0 bottom-0 z-[4] max-h-[75dvh] overflow-y-auto rounded-t-lg border border-line bg-surface px-[20px] pt-[20px] pb-[calc(20px+env(safe-area-inset-bottom))] shadow-lg [animation:install-rise_240ms_ease-out_both] motion-reduce:animate-none min-[720px]:bottom-[24px] min-[720px]:mx-auto min-[720px]:w-[420px] min-[720px]:max-w-[calc(100%-32px)] min-[720px]:rounded-lg min-[720px]:pb-[20px]" aria-label="알림 켜기">
    <div className="flex items-start gap-[12px]">
      <img src="icon-192.png" alt="" className="size-[48px] flex-none rounded-md border border-line" />
      <div className="min-w-0 flex-1 pt-[2px]">
        <p className="m-0 text-[18px] leading-[25px] font-bold text-ink break-keep">새 공지를 알림으로 받아 보세요</p>
        <p className="m-0 mt-[4px] text-[15px] leading-[22px] text-ink-2 break-keep">앱을 닫아도 새 공지를 바로 알려드려요. 설정에서 언제든 끌 수 있어요</p>
      </div>
      <button type="button" className="-mt-[8px] -mr-[8px] inline-flex min-h-[44px] min-w-[44px] flex-none items-center justify-center rounded-md border-0 bg-transparent text-ink-2 [@media(hover:hover)]:hover:bg-hover active:bg-hover" aria-label="닫기" onClick={close}>
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
      </button>
    </div>
    {denied ? <p className="push-hint m-0 mt-[16px] rounded-md bg-sunken px-[16px] py-[14px] text-[15px] leading-[22px] text-ink-2 break-keep">브라우저가 알림을 막아 두었어요. 주소창 옆 자물쇠나 브라우저 설정에서 <b className="font-semibold text-ink">이 사이트의 알림을 허용</b>한 뒤 설정에서 켜 주세요</p> : null}
    {denied ? null : <button type="button" className="mt-[16px] inline-flex min-h-[48px] w-full items-center justify-center rounded-md border-0 bg-accent px-[16px] text-[16px] font-semibold text-on-accent active:opacity-80" onClick={() => { void app.enablePush(); }}>알림 받기</button>}
    <button type="button" className={`inline-flex min-h-[48px] w-full items-center justify-center rounded-md border-0 px-[16px] text-[16px] font-semibold ${denied ? 'mt-[16px] bg-accent text-on-accent active:opacity-80' : 'mt-[8px] bg-sunken text-ink [@media(hover:hover)]:hover:bg-line active:bg-line'}`} onClick={close}>{denied ? '확인했어요' : '다음에 할게요'}</button>
  </section>;
}
