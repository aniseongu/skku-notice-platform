// 저장 목록 순서 바꾸기(게시판 순서 바꾸기와 같은 방식): 손잡이는 오른쪽, 끄는 줄은 떠오르고 강조 테두리, 놓으면 바로 저장한다.
// 마우스·터치 끌기는 dnd-kit(MIT), 키보드는 손잡이에서 Space로 집고 위아래 방향키로 옮겨 Space로 놓는다.
import { useRef, useState } from 'react';
import { DndContext, MeasuringStrategy, PointerSensor, TouchSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { restrictToParentElement, restrictToVerticalAxis } from '@dnd-kit/modifiers';
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { AppController } from './app-controller';
import { boardName, cleanTitle, type Notice } from './data';
import { STATUS_DOT, STATUS_META } from './cls';
import { OPPORTUNITY_LABELS } from './opportunities';

export interface ReorderItem { id: string; title: string; source: string; tags: string; read: boolean; status?: keyof typeof OPPORTUNITY_LABELS }

function Row({ item, keyboardIndex, onKeyboard, onKeyboardBlur }: { item: ReorderItem; keyboardIndex?: number; onKeyboard: (id: string, event: React.KeyboardEvent<HTMLButtonElement>) => void; onKeyboardBlur: (id: string) => void }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: item.id });
  return <li ref={setNodeRef} data-notice-id={item.id} style={{ transform: CSS.Transform.toString(transform), transition, order: keyboardIndex }}
    className={`flex min-h-[56px] items-center gap-[12px] rounded-md border bg-surface py-[14px] pr-[6px] pl-[16px] ${isDragging ? 'relative z-10 border-accent shadow-pop' : 'border-line'}`}>
    <span className="min-w-0 flex-1">
      <span className={`mb-[2px] flex min-w-0 flex-wrap gap-x-[6px] text-[13px] leading-[18px]`}>
        {item.status ? <span className={`${STATUS_META} ${item.status === 'interested' ? 'font-normal' : 'font-semibold text-ink-2'}`}><span className={`size-[6px] rounded-full ${STATUS_DOT}`} aria-hidden="true"></span>{OPPORTUNITY_LABELS[item.status]}</span> : null}
        {item.source ? <span className="min-w-0 [overflow-wrap:anywhere]">{item.source}</span> : null}{item.tags ? <span className="min-w-0 [overflow-wrap:anywhere]">{item.tags}</span> : null}
      </span>
      <span className={`reorder-title line-clamp-2 text-[16px] leading-[23px] ${item.read ? 'font-normal text-ink-2' : 'font-semibold'} min-[720px]:text-[15px] min-[720px]:leading-[22px]`}>{item.title}</span>
    </span>
    <button type="button" ref={setActivatorNodeRef} {...attributes} {...listeners} onKeyDown={(event) => onKeyboard(item.id, event)} onBlur={() => onKeyboardBlur(item.id)} aria-label={`${item.title} 순서 옮기기`}
      className="order-handle grid size-[44px] flex-none cursor-grab touch-none place-items-center rounded-md border-0 bg-transparent text-ink-3 [@media(hover:hover)]:hover:bg-hover active:bg-hover active:cursor-grabbing focus-visible:outline-2 focus-visible:outline-accent">
      <svg aria-hidden="true" viewBox="0 0 24 24" width="20" height="20" fill="currentColor">{[7, 12, 17].flatMap((y) => [9, 15].map((x) => <circle key={`${x}-${y}`} cx={x} cy={y} r="1.7" />))}</svg></button>
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
  const [picked, setPicked] = useState<{ id: string; ids: string[] } | null>(null);
  const pickedRef = useRef(picked);
  const [announcement, setAnnouncement] = useState('');
  const updatePicked = (value: typeof picked) => { pickedRef.current = value; setPicked(value); };
  const labelOf = (id: unknown) => items.find((item) => item.id === id)?.title ?? '';
  const position = (id: unknown, order: string[] = ids) => `${order.length}개 중 ${order.indexOf(String(id)) + 1}번째`;
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 3 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 120, tolerance: 8 } }),
  );
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const from = ids.indexOf(String(active.id)), to = ids.indexOf(String(over.id));
    if (from < 0 || to < 0) return;
    app.commitSavedOrder(arrayMove(ids, from, to));
  };
  const onKeyboard = (id: string, event: React.KeyboardEvent<HTMLButtonElement>) => {
    const current = pickedRef.current;
    if (event.code === 'Space' || event.code === 'Enter') {
      event.preventDefault();
      if (!current) {
        updatePicked({ id, ids });
        setAnnouncement(`${labelOf(id)}을 집었어요. 지금 ${position(id)}예요. 위아래 화살표로 옮기고 스페이스로 놓으세요`);
      } else if (current.id === id) {
        updatePicked(null);
        if (current.ids.some((value, index) => value !== ids[index])) app.commitSavedOrder(current.ids);
        setAnnouncement(`${labelOf(id)}을 ${position(id, current.ids)}로 옮겼어요`);
      }
    } else if (current?.id === id && event.code === 'Escape') {
      event.preventDefault(); event.stopPropagation();
      updatePicked(null);
      setAnnouncement(`${labelOf(id)} 옮기기를 취소했어요`);
    } else if (current?.id === id && (event.code === 'ArrowUp' || event.code === 'ArrowDown')) {
      event.preventDefault();
      const from = current.ids.indexOf(id);
      const to = Math.max(0, Math.min(current.ids.length - 1, from + (event.code === 'ArrowDown' ? 1 : -1)));
      const next = arrayMove(current.ids, from, to);
      updatePicked({ id, ids: next });
      setAnnouncement(`${labelOf(id)}이 ${position(id, next)} 자리예요`);
    }
  };
  return <div className="saved-reorder px-[var(--gutter)] pt-[8px] pb-[16px] min-[720px]:px-[24px]">
    <span className="sr-only" aria-live="assertive" aria-atomic="true">{announcement}</span>
    <DndContext measuring={{ droppable: { strategy: MeasuringStrategy.Always } }} sensors={sensors} collisionDetection={closestCenter} modifiers={[restrictToVerticalAxis, restrictToParentElement]}
      onDragEnd={onDragEnd}
      accessibility={{
        screenReaderInstructions: { draggable: '순서를 바꾸려면 Space를 눌러 집고, 위아래 방향키로 옮긴 뒤 Space로 놓으세요. 취소는 Esc예요.' },
        announcements: {
          onDragStart: ({ active }) => `${labelOf(active.id)}을 집었어요. 지금 ${position(active.id)}예요`,
          onDragOver: ({ active, over }) => (over ? `${labelOf(active.id)}이 ${position(over.id)} 자리 위에 있어요` : undefined),
          onDragEnd: ({ active, over }) => (over ? `${labelOf(active.id)}을 ${position(over.id)}로 옮겼어요` : `${labelOf(active.id)}을 제자리에 놓았어요`),
          onDragCancel: ({ active }) => `${labelOf(active.id)} 옮기기를 취소했어요`,
        },
      }}>
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        <ol className="m-0 flex list-none flex-col gap-[8px] p-0" aria-label="저장한 공지 순서">
          {items.map((item) => <Row key={item.id} item={item} keyboardIndex={picked ? picked.ids.indexOf(item.id) : undefined} onKeyboard={onKeyboard}
            onKeyboardBlur={(id) => { if (pickedRef.current?.id === id) { updatePicked(null); setAnnouncement(`${labelOf(id)} 옮기기를 취소했어요`); } }} />)}
        </ol>
      </SortableContext>
    </DndContext>
    {app.savedOrderStatus === 'failed' ? <p className="m-0 mt-[8px] text-[14px] leading-[20px] text-danger" role="alert">저장하지 못했어요. 다시 옮기면 또 저장해요</p> : null}
  </div>;
}
