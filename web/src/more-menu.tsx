import { useEffect, useRef, useState } from 'react';
import { NOTE_TEXT, TEXT_BUTTON, TEXT_BUTTON_DANGER } from './cls';

interface MoreAction {
  label: string;
  run: () => void | Promise<unknown>;
  confirm?: { question: string; label: string };
}

export function MoreMenu({ actions, busy = false, className = '' }: {
  actions: MoreAction[];
  busy?: boolean;
  className?: string;
}) {
  const [stage, setStage] = useState<string | null>(null);
  const container = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const open = stage !== null;
  const action = actions.find(({ label }) => label === stage);
  const confirm = action?.confirm;

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => {
      if (!container.current?.contains(event.target as Node)) setStage(null);
    };
    document.addEventListener('pointerdown', closeOutside);
    return () => document.removeEventListener('pointerdown', closeOutside);
  }, [open]);

  const close = () => { trigger.current?.focus(); setStage(null); };
  return <div ref={container} className={`relative ml-auto shrink-0 ${className}`}
    onBlur={(event) => { if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget)) setStage(null); }}
    onKeyDown={(event) => { if (open && event.key === 'Escape') { event.stopPropagation(); close(); } }}>
    <button type="button" ref={trigger} className={`${TEXT_BUTTON} grid size-[44px] place-items-center`} aria-label="더 보기 메뉴" aria-expanded={open}
      onClick={() => open ? close() : setStage('menu')}>
      <span className="text-[20px] leading-none" aria-hidden="true">⋯</span>
    </button>
    {open ? <div className="absolute top-full right-0 z-10 grid min-w-[112px] gap-[2px] rounded-md border border-line bg-surface p-[4px] shadow-lg">
      {action && confirm ? <div key={stage} role="group" aria-label={confirm.label} className="grid w-[184px] gap-[2px]">
        <p className={`${NOTE_TEXT} px-[8px] pt-[6px]`}>{confirm.question}</p>
        <div className="flex flex-wrap">
          <button type="button" className={TEXT_BUTTON_DANGER} disabled={busy} onClick={() => { close(); void action.run(); }}>{confirm.label}</button>
          <button type="button" className={TEXT_BUTTON} autoFocus onClick={close}>취소</button>
        </div>
      </div> : actions.map((item, index) => <button type="button" key={item.label} className={`${TEXT_BUTTON} text-left`}
        autoFocus={index === 0} disabled={busy} onClick={() => {
          if (item.confirm) setStage(item.label);
          else { setStage(null); void item.run(); }
        }}>{item.label}</button>)}
    </div> : null}
  </div>;
}
