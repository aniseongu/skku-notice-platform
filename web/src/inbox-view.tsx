// 알림함 쪽(설정 하위 쪽 틀을 쓴다: ?view=settings&section=inbox). 설계는 docs/design/2026-11-20_notification-inbox.md.
import { useState } from 'react';
import { NOTE_TEXT, TEXT_BUTTON, TEXT_BUTTON_DANGER } from './cls';
import { inboxTime, type InboxItem } from './inbox';

export interface InboxModel {
  items: InboxItem[];
  pushOn: boolean;
  open: (item: InboxItem) => void;
  remove: (id: string) => void;
  readAll: () => void;
  clear: () => void;
  goNotifications: () => void;
}

const ROW = 'inbox-row group/ib flex items-stretch border-t border-line first:border-t-0';
const ROW_MAIN = 'inbox-open [@media(hover:hover)]:hover:bg-hover active:bg-hover flex min-h-[64px] min-w-0 flex-1 flex-col items-start justify-center gap-[2px] border-0 bg-transparent py-[12px] text-left text-ink focus-visible:rounded-sm';

export function InboxPage({ model }: { model: InboxModel }) {
  const [confirming, setConfirming] = useState(false);
  const { items } = model;
  const hasUnread = items.some((item) => !item.read);
  return <div className="settings inbox px-[var(--gutter)] pb-[calc(var(--tabbar-h)+32px)] min-[720px]:px-[24px] min-[720px]:pb-[48px]">
    {items.length === 0 ? <section aria-label="알림함" className="mt-[24px]"><div className="box grid justify-items-center gap-[4px] px-[16px] py-[48px] text-center">
      <h2 className="m-0 text-[17px] leading-[24px] font-bold">{model.pushOn ? '받은 알림이 없어요' : '알림이 꺼져 있어요'}</h2>
      <p className={NOTE_TEXT}>{model.pushOn ? '새 공지 알림을 놓쳐도 여기서 다시 볼 수 있어요' : '알림을 켜면 놓친 공지를 여기서 볼 수 있어요'}</p>
      {model.pushOn ? null : <button type="button" className={`${TEXT_BUTTON} mt-[8px] text-accent!`} onClick={model.goNotifications}>알림 켜러 가기</button>}
    </div></section> : <section aria-label="받은 알림" className="mt-[8px]">
      <div className="inbox-actions flex items-center justify-end gap-[4px]">
        <button type="button" className={TEXT_BUTTON} disabled={!hasUnread} onClick={model.readAll}>모두 읽음</button>
        {confirming
          ? <button type="button" className={TEXT_BUTTON_DANGER} onClick={() => { setConfirming(false); model.clear(); }} onBlur={() => setConfirming(false)} autoFocus>정말 지울까요? 모두 지우기</button>
          : <button type="button" className={TEXT_BUTTON} onClick={() => setConfirming(true)}>모두 지우기</button>}
      </div>
      <div className="box rounded-lg bg-surface px-[var(--gutter)] min-[720px]:rounded-none min-[720px]:bg-transparent min-[720px]:p-0" role="list">
        {items.map((item) => <div className={ROW} role="listitem" key={item.id} data-read={item.read}>
          <button type="button" className={ROW_MAIN} onClick={() => model.open(item)}>
            <span className={`inbox-title line-clamp-2 text-[15px] leading-[22px] [word-break:keep-all] ${item.read ? 'font-normal text-ink-2' : 'font-bold'}`}>{item.title}{item.read ? null : <span className="visually-hidden"> (안 읽음)</span>}</span>
            <span className="inbox-body line-clamp-2 text-[14px] leading-[20px] text-ink-2 [word-break:keep-all]">{item.body}</span>
            <span className="inbox-time text-[13px] leading-[18px] text-ink-3">{inboxTime(item.at)}</span>
          </button>
          <button type="button" className="[@media(hover:hover)]:hover:bg-hover active:bg-hover grid size-[44px] flex-none cursor-pointer place-items-center self-center rounded-pill border-0 bg-transparent text-ink-3 focus-visible:rounded-sm" aria-label={`알림 지우기: ${item.title}`} onClick={() => model.remove(item.id)}>
            <svg className="i size-[18px] fill-none stroke-current [stroke-width:1.75] [stroke-linecap:round]" aria-hidden="true" viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>)}
      </div>
      <p className={`${NOTE_TEXT} mt-[12px]`}>이 기기에 30일 동안, 최대 200개까지 보관해요</p>
    </section>}
  </div>;
}
