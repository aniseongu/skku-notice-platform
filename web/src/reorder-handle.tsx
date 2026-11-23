// 순서 바꾸기 공용 부품: 저장 목록과 설정의 게시판 순서가 같은 센서·키보드(Space/Enter로 집기, 방향키, Space로 놓기, Escape 취소)·낭독 안내를 쓴다.
// 마우스·터치 끌기는 dnd-kit(MIT). 손잡이는 오른쪽(.claude/rules/usability.md), 놓을 때 onCommit 한 번.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { DndContext, MeasuringStrategy, PointerSensor, TouchSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { restrictToParentElement, restrictToVerticalAxis } from '@dnd-kit/modifiers';
import { SortableContext, arrayMove, verticalListSortingStrategy } from '@dnd-kit/sortable';

export interface ReorderState {
  keyboardIndexOf: (id: string) => number | undefined;
  onKeyboard: (id: string, event: React.KeyboardEvent<HTMLButtonElement>) => void;
  onKeyboardBlur: (id: string) => void;
}

interface ReorderOptions {
  ids: string[];
  labelOf: (id: unknown) => string;
  /** 낭독용 위치 문구(예: "3번째", "5개 중 3번째") */
  position: (id: unknown, order: string[]) => string;
  onCommit: (ids: string[]) => void;
  /** false면 집은 상태를 비운다(설정의 순서 바꾸기 완료) */
  active?: boolean;
  /** 집었을 때 덧붙일 안내 */
  pickHint?: string;
}

export function useReorder({ ids, labelOf, position, onCommit, active = true, pickHint = '' }: ReorderOptions) {
  const latest = useRef({ ids, onCommit });
  latest.current = { ids, onCommit };
  const [picked, setPicked] = useState<{ id: string; ids: string[] } | null>(null);
  const pickedRef = useRef(picked);
  const [announcement, setAnnouncement] = useState('');
  const updatePicked = (value: typeof picked) => { pickedRef.current = value; setPicked(value); };
  useEffect(() => { if (!active) updatePicked(null); }, [active]);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 3 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 120, tolerance: 8 } }),
  );
  const onDragEnd = ({ active: dragged, over }: DragEndEvent) => {
    if (!over || dragged.id === over.id) return;
    const current = latest.current.ids;
    const from = current.indexOf(String(dragged.id)), to = current.indexOf(String(over.id));
    if (from < 0 || to < 0) return;
    latest.current.onCommit(arrayMove(current, from, to));
  };
  const onKeyboard = (id: string, event: React.KeyboardEvent<HTMLButtonElement>) => {
    const current = pickedRef.current;
    if (event.code === 'Space' || event.code === 'Enter') {
      event.preventDefault();
      if (!current) {
        updatePicked({ id, ids });
        setAnnouncement(`${labelOf(id)}을 집었어요. 지금 ${position(id, ids)}예요${pickHint}`);
      } else if (current.id === id) {
        updatePicked(null);
        if (current.ids.some((value, index) => value !== ids[index])) latest.current.onCommit(current.ids);
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
  const onKeyboardBlur = (id: string) => {
    if (pickedRef.current?.id === id) { updatePicked(null); setAnnouncement(`${labelOf(id)} 옮기기를 취소했어요`); }
  };
  const state: ReorderState = { keyboardIndexOf: (id) => (picked ? picked.ids.indexOf(id) : undefined), onKeyboard, onKeyboardBlur };
  const shell = (children: ReactNode) => <>
    <span className="sr-only" aria-live="assertive" aria-atomic="true">{announcement}</span>
    <DndContext measuring={{ droppable: { strategy: MeasuringStrategy.Always } }} sensors={sensors} collisionDetection={closestCenter} modifiers={[restrictToVerticalAxis, restrictToParentElement]}
      onDragEnd={onDragEnd}
      accessibility={{
        screenReaderInstructions: { draggable: '순서를 바꾸려면 Space를 눌러 집고, 위아래 방향키로 옮긴 뒤 Space로 놓으세요. 취소는 Esc예요.' },
        announcements: {
          onDragStart: ({ active: a }) => `${labelOf(a.id)}을 집었어요. 지금 ${position(a.id, ids)}예요`,
          onDragOver: ({ active: a, over }) => (over ? `${labelOf(a.id)}이 ${position(over.id, ids)} 자리 위에 있어요` : undefined),
          onDragEnd: ({ active: a, over }) => (over ? `${labelOf(a.id)}을 ${position(over.id, ids)}로 옮겼어요` : `${labelOf(a.id)}을 제자리에 놓았어요`),
          onDragCancel: ({ active: a }) => `${labelOf(a.id)} 옮기기를 취소했어요`,
        },
      }}>
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>{children}</SortableContext>
    </DndContext>
  </>;
  return { state, shell };
}

/** 줄 오른쪽의 끌기 손잡이. useSortable의 setActivatorNodeRef·attributes·listeners를 그대로 받는다. */
export function ReorderHandle({ label, state, id, activatorRef, attributes, listeners }: {
  label: string; id: string; state: ReorderState;
  activatorRef: (element: HTMLElement | null) => void; attributes: object; listeners?: object;
}) {
  return <button type="button" ref={activatorRef} {...attributes} {...listeners} onKeyDown={(event) => state.onKeyboard(id, event)} onBlur={() => state.onKeyboardBlur(id)} aria-label={`${label} 순서 옮기기`}
    className="order-handle grid size-[44px] flex-none cursor-grab touch-none place-items-center rounded-md border-0 bg-transparent text-ink-3 [@media(hover:hover)]:hover:bg-hover active:bg-hover active:cursor-grabbing focus-visible:outline-2 focus-visible:outline-accent">
    <svg aria-hidden="true" viewBox="0 0 24 24" width="20" height="20" fill="currentColor">{[7, 12, 17].flatMap((y) => [9, 15].map((x) => <circle key={`${x}-${y}`} cx={x} cy={y} r="1.7" />))}</svg></button>;
}
