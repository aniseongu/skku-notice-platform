// 저장 목록 순서 바꾸기(게시판 순서 바꾸기와 같은 방식): 손잡이는 오른쪽, 끄는 줄은 떠오르고 강조 테두리, 놓으면 바로 저장한다.
// 마우스·터치 끌기는 dnd-kit(MIT), 키보드는 손잡이에서 Space로 집고 위아래 방향키로 옮겨 Space로 놓는다.
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { AppController } from './app-controller';
import { boardName, cleanTitle, type Notice } from './data';
import { REORDER_META, REORDER_META_SPAN, SavedRowStatus } from './notice-rows';
import type { OpportunityStatus } from './opportunities';
import { ReorderHandle, useReorder, type ReorderState } from './reorder-handle';

export interface ReorderItem { id: string; title: string; source: string; tags: string; read: boolean; status?: OpportunityStatus }

function Row({ item, reorder }: { item: ReorderItem; reorder: ReorderState }) {
  const keyboardIndex = reorder.keyboardIndexOf(item.id);
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: item.id });
  return <li ref={setNodeRef} data-notice-id={item.id} style={{ transform: CSS.Transform.toString(transform), transition, order: keyboardIndex }}
    className={`flex min-h-[56px] items-center gap-[12px] rounded-md border bg-surface py-[14px] pr-[6px] pl-[16px] ${isDragging ? 'relative z-10 border-accent shadow-pop' : 'border-line'}`}>
    <span className="min-w-0 flex-1">
      <span className={REORDER_META}>
        <SavedRowStatus status={item.status} />
        {item.source ? <span className={REORDER_META_SPAN}>{item.source}</span> : null}
        {item.tags ? <span className={REORDER_META_SPAN}>{item.tags}</span> : null}
      </span>
      <span className={`reorder-title line-clamp-2 text-[16px] leading-[23px] ${item.read ? 'font-normal text-ink-2' : 'font-semibold'} min-[720px]:text-[15px] min-[720px]:leading-[22px]`}>{item.title}</span>
    </span>
    <ReorderHandle id={item.id} label={item.title} state={reorder} activatorRef={setActivatorNodeRef} attributes={attributes} listeners={listeners} />
  </li>;
}

export function reorderItems(app: AppController, list: Notice[]): ReorderItem[] {
  return list.map((notice) => ({
    id: notice.id, title: cleanTitle(notice.title_ko || notice.title),
    source: boardName(app.sources.find((item) => item.id === notice.source_id), notice.source_id), status: app.statusOf(notice),
    tags: [notice.category, notice.pinned ? '고정' : '', notice.changed_at ? '수정됨' : ''].filter(Boolean).join(', '), read: app.isRead(notice),
  }));
}

export function SavedReorderList({ app, items }: { app: AppController; items: ReorderItem[] }) {
  const ids = items.map((item) => item.id);
  const { state, shell } = useReorder({
    ids, labelOf: (id) => items.find((item) => item.id === id)?.title ?? '',
    position: (id, order) => `${order.length}개 중 ${order.indexOf(String(id)) + 1}번째`,
    onCommit: (next) => app.commitSavedOrder(next), pickHint: '. 위아래 화살표로 옮기고 스페이스로 놓으세요',
  });
  return <div className="saved-reorder px-[var(--gutter)] pt-[8px] pb-[16px] min-[720px]:px-[24px]">
    {shell(<ol className="m-0 flex list-none flex-col gap-[8px] p-0" aria-label="저장한 공지 순서">
      {items.map((item) => <Row key={item.id} item={item} reorder={state} />)}
    </ol>)}
    {app.savedOrderStatus === 'failed' ? <p className="m-0 mt-[8px] text-[14px] leading-[20px] text-danger" role="alert">저장하지 못했어요. 다시 옮기면 또 저장해요</p> : null}
  </div>;
}
