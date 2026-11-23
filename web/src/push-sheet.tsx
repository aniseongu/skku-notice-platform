import { BOTTOM_SHEET_CARD, BOTTOM_SHEET_MOTION, BOTTOM_SHEET_PADDING, SHEET_GHOST_BUTTON, SHEET_SOLID_BUTTON } from './cls';
import type { AppController } from './app-controller';
import { AlertIcon } from './alert-icon';
import { remember } from './app-controller';
import { pushSheetDismissed, pushSheetDue } from './push-sheet-rule';

const KEY = 'push-sheet';

/** 이 기기의 알림이 꺼져 있으면 화면 아래에서 올라와 켜기를 권한다(사전 안내 후 브라우저 허용 창, 규칙은 push-sheet-rule.ts). */
export function pushSheetShown(app: AppController, update: boolean, closed: boolean): boolean {
  return !closed && !app.toast && !update && (app.pushStatus === 'off' || app.pushStatus === 'denied' || app.pushStatus === 'busy') && pushSheetDue(remember(KEY), Date.now());
}

export function PushSheet({ app, onClose }: { app: AppController; onClose: () => void }) {
  const denied = app.pushStatus === 'denied';
  // 켜는 동안(busy)에도 패널을 두어 실패하면 같은 자리에서 이유와 다시 시도를 보인다(busy는 사용자가 누른 뒤에만 생긴다).
  const busy = app.pushStatus === 'busy';
  const close = () => { remember(KEY, pushSheetDismissed(remember(KEY), Date.now())); onClose(); };
  return <section className={`push-sheet ${BOTTOM_SHEET_CARD} ${BOTTOM_SHEET_PADDING} ${BOTTOM_SHEET_MOTION} min-[720px]:pb-[20px]`} aria-label="알림 켜기">
    <div className="flex items-start gap-[12px]">
      <img src="icon-192.png" alt="" className="size-[48px] flex-none rounded-md border border-line" />
      <div className="min-w-0 flex-1 pt-[2px]">
        <p className="m-0 text-[18px] leading-[25px] font-bold text-ink break-keep text-pretty">새 공지를 알림으로 받아요</p>
        <p className="m-0 mt-[4px] text-[15px] leading-[22px] text-ink-2 break-keep text-balance">{denied ? '브라우저가 알림을 막아 두었어요. 주소창 옆 자물쇠에서 알림을 허용한 뒤 아래 단추를 눌러 주세요' : '앱을 닫아도 바로 알려드려요. 설정에서 언제든 끌 수 있어요'}</p>
        {app.pushError && !denied ? <p className="error-text m-0 mt-[8px] text-[14px] leading-[21px] font-medium text-danger break-keep text-pretty" role="alert"><AlertIcon />{app.pushError}</p> : null}
      </div>
    </div>
    <button type="button" className={`${SHEET_SOLID_BUTTON} disabled:opacity-60`} disabled={busy} onClick={() => { void (denied ? app.recheckPush() : app.enablePush()); }}>{busy ? '확인하고 있어요' : denied ? '다시 확인하기' : app.pushRetry ? '다시 시도하기' : '알림 받기'}</button>
    <button type="button" className={SHEET_GHOST_BUTTON} onClick={close}>다음에 할게요</button>
  </section>;
}
