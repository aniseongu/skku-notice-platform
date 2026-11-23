import { useState, type KeyboardEvent } from 'react';
import { SEGMENTED_GRID, SEGMENTED_INLINE, SEGMENTED_OPTION } from './cls';

export function SegmentedChoice<T extends string | number>({ label, options, value, onPick, disabled, grid, columns = 4, touchHeight, noWrap }: {
  label: string;
  options: readonly (readonly [T, string])[];
  value: T | null;
  onPick: (value: T) => void;
  disabled?: boolean;
  grid?: boolean;
  columns?: 3 | 4;
  touchHeight?: boolean;
  noWrap?: boolean;
}) {
  const [cursor, setCursor] = useState<number | null>(null);
  const focused = cursor ?? Math.max(0, options.findIndex(([option]) => option === value));
  const verticalStep = grid && options.length > columns ? columns : 1;
  const move = (event: KeyboardEvent<HTMLDivElement>) => {
    const radios = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="radio"]')];
    const index = radios.indexOf(event.target as HTMLButtonElement);
    if (index < 0 || disabled) return;
    const next = {
      ArrowLeft: index - 1, ArrowRight: index + 1, ArrowUp: index - verticalStep, ArrowDown: index + verticalStep,
      Home: 0, End: radios.length - 1,
    }[event.key];
    if (next === undefined) return;
    event.preventDefault();
    event.stopPropagation();
    const clamped = Math.max(0, Math.min(next, radios.length - 1));
    setCursor(clamped);
    radios[clamped]?.focus();
  };
  const cols = columns === 3 ? 'grid-cols-3' : 'grid-cols-4';
  return <div className={grid ? `${SEGMENTED_GRID} ${cols}` : SEGMENTED_INLINE} role="radiogroup" aria-label={label}
    onKeyDown={move} onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setCursor(null); }}>
    {options.map(([option, text], index) => <button type="button" role="radio" key={option}
      className={`${SEGMENTED_OPTION}${touchHeight ? ' min-h-[44px]!' : ''}${noWrap ? ' whitespace-nowrap' : ''}`}
      aria-checked={value === option} tabIndex={index === focused ? 0 : -1} disabled={disabled} onClick={() => onPick(option)}>{text}</button>)}
  </div>;
}
