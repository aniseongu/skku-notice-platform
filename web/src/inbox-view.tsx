// 알림함 쪽(설정 하위 쪽 틀을 쓴다: ?view=settings&section=inbox). 설계는 docs/design/2026-11-20_notification-inbox.md.
// 행 모양과 읽음 표시는 공지 목록(notice-rows.tsx)과 같다: 구분선만 있는 전체 폭 줄, 안 읽음은 면(surface)+굵은 제목, 읽음은 읽음 면(read)+보통 제목.
import { NOTE_TEXT, TEXT_BUTTON } from './cls';
import { inboxTime, type InboxItem } from './inbox';
import { Empty } from './empty';
import { Confirm } from './team-section';

export interface InboxModel {
  items: InboxItem[];
  pushOn: boolean;
  open: (item: InboxItem) => void;
  remove: (id: string) => void;
  readAll: () => void;
  clear: () => void;
  goNotifications: () => void;
}

const GUTTER = 'px-[var(--gutter)] min-[720px]:px-[24px]';

export function InboxPage({ model, overlay }: { model: InboxModel; overlay?: boolean }) {
  const { items } = model;
  const hasUnread = items.some((item) => !item.read);
  return <div className={`inbox ${overlay ? 'pb-[20px]' : 'pb-[calc(var(--tabbar-h)+32px)] min-[720px]:pb-[48px]'}`}>
    {items.length === 0 ? <Empty sectionLabel="알림함"
      title={model.pushOn ? '받은 알림이 없어요' : '알림이 꺼져 있어요'}
      body={model.pushOn ? '새 공지 알림을 놓쳐도 여기서 다시 볼 수 있어요' : '알림을 켜면 놓친 공지를 여기서 볼 수 있어요'}
      action={model.pushOn ? undefined : '알림 켜기'} onAction={model.goNotifications} /> : <section aria-label="받은 알림">
      <div className={`inbox-actions flex min-h-[48px] flex-wrap items-center justify-between gap-x-[4px] ${GUTTER}`}>
        <button type="button" className={`${TEXT_BUTTON} -ml-[8px]`} disabled={!hasUnread} onClick={model.readAll}>모두 읽음으로 표시</button>
        <div className="-mr-[8px] ml-auto"><Confirm label="모두 지우기" question="모두 지울까요? 되돌릴 수 없어요" onConfirm={model.clear} /></div>
      </div>
      <div role="list">
        {items.map((item) => <div className={`inbox-row flex items-stretch border-t border-line ${item.read ? 'bg-read' : 'bg-surface'}`} role="listitem" key={item.id} data-read={item.read}>
          <button type="button" className={`inbox-open [@media(hover:hover)]:hover:bg-hover active:bg-sunken flex min-h-[64px] min-w-0 flex-1 flex-col items-start justify-center gap-[2px] border-0 bg-transparent py-[14px] pr-0 text-left text-ink min-[720px]:py-[12px] ${GUTTER}`} onClick={() => model.open(item)}>
            <span className="visually-hidden">{item.read ? '읽은 알림' : '읽지 않은 알림'}</span>
            <span className={`inbox-title line-clamp-2 text-[16px] leading-[23px] [word-break:keep-all] ${item.read ? 'font-normal text-ink-2' : 'font-semibold'}`}>{item.title}</span>
            <span className="inbox-body line-clamp-2 text-[14px] leading-[20px] text-ink-2 [word-break:keep-all]">{item.body}</span>
            <span className="inbox-time text-[13px] leading-[18px] text-ink-3">{inboxTime(item.at)}</span>
          </button>
          <button type="button" className={`${TEXT_BUTTON} mr-[4px] grid size-[44px] flex-none place-items-center self-center min-[720px]:mr-[16px]`} aria-label={`알림 지우기: ${item.title}`} title="알림 지우기" onClick={() => model.remove(item.id)}>
            <svg className="i size-[18px] fill-none stroke-current [stroke-width:1.75] [stroke-linecap:round]" aria-hidden="true" viewBox="0 0 24 24"><path d="M4 7h16M9 7V4h6v3m3 0-1 13H7L6 7m4 4v5m4-5v5" /></svg>
          </button>
        </div>)}
      </div>
    </section>}
    <p className={`${NOTE_TEXT} ${items.length ? `mt-[12px] ${GUTTER}` : 'px-[24px] text-center'}`}>이 기기에서 받은 알림을 30일 동안 보관해요</p>
  </div>;
}
