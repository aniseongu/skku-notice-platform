import { useId, useLayoutEffect, useRef, type MouseEvent, type ReactNode, type RefObject } from 'react';
import { BOTTOM_SHEET, BOTTOM_SHEET_MOTION, HEADER_ICON_BUTTON } from './cls';

function isBackdrop(event: MouseEvent<HTMLDialogElement>): boolean {
  const { left, right, top, bottom } = event.currentTarget.getBoundingClientRect();
  return event.target === event.currentTarget
    && (event.clientX < left || event.clientX >= right || event.clientY < top || event.clientY >= bottom);
}

export function OverlaySheet({ title, trigger, onClose, children }: {
  title: string;
  trigger: RefObject<HTMLButtonElement | null>;
  onClose: () => void;
  children: ReactNode;
}) {
  const headingId = useId();
  const ref = useRef<HTMLDialogElement>(null);
  const pressedBackdrop = useRef(false);

  useLayoutEffect(() => {
    const dialog = ref.current;
    const anchor = trigger.current;
    if (!dialog || !anchor) return;
    const root = document.documentElement;
    const locked = root.classList.contains('overflow-hidden');
    root.classList.add('overflow-hidden');
    const position = () => {
      const { right, bottom } = anchor.getBoundingClientRect();
      dialog.style.setProperty('--overlay-top', `${bottom + 8}px`);
      dialog.style.setProperty('--overlay-right', `${Math.max(8, root.clientWidth - right)}px`);
    };
    position();
    dialog.showModal();
    window.addEventListener('resize', position);
    return () => {
      window.removeEventListener('resize', position);
      dialog.close();
      if (!locked) root.classList.remove('overflow-hidden');
      if (anchor.isConnected) anchor.focus({ preventScroll: true });
    };
  }, [trigger]);

  return <dialog ref={ref} className={`overlay-sheet ${BOTTOM_SHEET} ${BOTTOM_SHEET_MOTION} m-0 mt-auto w-full max-w-none overscroll-contain p-0 pb-[env(safe-area-inset-bottom)] text-ink backdrop:bg-[oklch(0.15_0.01_var(--h)/0.4)] min-[720px]:inset-x-auto min-[720px]:top-[var(--overlay-top)] min-[720px]:right-[var(--overlay-right)] min-[720px]:bottom-auto min-[720px]:mt-0 min-[720px]:max-h-[min(70dvh,calc(100dvh-var(--overlay-top)-8px))] min-[720px]:w-[400px] min-[720px]:rounded-lg min-[720px]:pb-0 min-[720px]:animate-none`}
    aria-labelledby={headingId} onClose={(event) => { if (!event.currentTarget.open) onClose(); }}
    onPointerDown={(event) => { pressedBackdrop.current = isBackdrop(event); }}
    onClick={(event) => {
      if (pressedBackdrop.current && isBackdrop(event)) event.currentTarget.close();
      pressedBackdrop.current = false;
    }}>
    <header className="sticky top-0 z-[1] flex min-h-[56px] items-center justify-between gap-[8px] border-b border-line bg-surface pr-[8px] pl-[var(--gutter)] min-[720px]:pl-[24px]">
      <h2 id={headingId} className="text-[17px] font-bold">{title}</h2>
      <button type="button" className={`${HEADER_ICON_BUTTON} min-[720px]:size-[44px]!`} aria-label="닫기" onClick={() => ref.current?.close()}>
        <svg className="i size-[22px] fill-none stroke-current [stroke-width:1.75] [stroke-linecap:round] [stroke-linejoin:round]" aria-hidden="true"><use href="icons/sprite.svg#close" /></svg>
      </button>
    </header>
    {children}
  </dialog>;
}
