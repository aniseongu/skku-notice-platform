// 설정과 온보딩이 같이 쓰는 작은 구성요소. 모양은 styles.css의 platform 층에 있다.
import { useEffect, useState, type ReactNode } from 'react';
import { BADGE, CHEVRON_LEFT_STRONG, CHEVRON_RIGHT, CHIP, CHIPS, CHOICE, CHOICE_CHECK, SWITCH, SWITCH_ROW } from './cls';

/** 원본 설정의 구역(작은 제목 + 상자). 구역 제목이 구역의 이름표가 된다. */
export function Card({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return <section aria-labelledby={`${id}-title`}>
    <h2 id={`${id}-title`} className="settings-head mt-[28px] mb-[8px] text-[14px] leading-[20px] font-semibold text-ink-2">{title}</h2>
    <div className="box rounded-lg bg-surface px-[var(--gutter)] min-[720px]:rounded-none min-[720px]:border-t min-[720px]:border-line min-[720px]:bg-transparent min-[720px]:p-0">{children}</div>
  </section>;
}

/** 켜고 끄는 한 줄. 줄 전체가 눌리는 영역이다. */
export function SwitchRow({ checked, onChange, label, description, badge, disabled }: {
  checked: boolean; onChange: (next: boolean) => void; label: string; description?: string; badge?: string; disabled?: boolean;
}) {
  return <button type="button" role="switch" className={SWITCH_ROW} aria-checked={checked} disabled={disabled} onClick={() => onChange(!checked)}>
    <span className="switch-text grid gap-[2px]"><span className="switch-label inline-flex items-center gap-[8px] text-[15px] font-medium">{label}{badge ? <>{" "}<span className={BADGE}>{badge}</span></> : null}</span>
      {description ? <span className="switch-note text-[13px] text-ink-2">{description}</span> : null}</span>
    <span className={SWITCH} aria-hidden="true" />
  </button>;
}


/** 몇 개 안 되는 값 중 하나를 고른다(학년, 재학 상태 등). */
export function Segmented<T extends string | number>({ label, options, value, onChange, columns }: {
  label: string; options: readonly { value: T; label: string }[]; value: T | null; onChange: (next: T) => void; columns?: number;
}) {
  return <div className="seg flex flex-wrap gap-[8px] data-[columns=3]:grid data-[columns=3]:grid-cols-[repeat(3,minmax(0,1fr))]" data-columns={columns} role="group" aria-label={label}>
    {options.map((option) => <button type="button" className={`min-h-[44px] flex-[1_1_4.5rem] rounded-md border px-[12px] py-0 ${value === option.value ? 'border-ink bg-ink font-bold text-bg' : 'border-line bg-surface font-medium text-ink'}`} key={String(option.value)} aria-pressed={value === option.value}
      onClick={() => onChange(option.value)}>{option.label}</button>)}
  </div>;
}

/**
 * 목록 한 줄을 고른다. 기본은 라디오(고르기만 하고 아래 "다음"이 확정한다).
 * nav이면 누르면 다음 목록으로 들어가는 이동 줄이라 오른쪽에 ›를 두고 버튼으로 읽힌다.
 */
export function ChoiceList({ label, items, selected, onSelect, nav }: {
  label: string; items: readonly { id: string; label: string; note?: string; description?: string }[]; selected?: string | null; onSelect: (id: string) => void; nav?: boolean;
}) {
  return <div className="choice-list grid overflow-hidden rounded-lg bg-surface" role={nav ? 'group' : 'radiogroup'} aria-label={label}>
    {items.map((item) => <button type="button" className={CHOICE} key={item.id} onClick={() => onSelect(item.id)}
      {...(nav ? {} : { role: 'radio', 'aria-checked': selected === item.id })}>
      <span>{item.label}{item.note ? <span className="choice-note block text-[13px] font-normal text-ink-3">{item.note}</span> : null}{item.description ? <span className="choice-desc block text-[13px] font-normal text-ink-2">{item.description}</span> : null}</span>
      {nav ? <span className={`choice-chevron ${CHEVRON_RIGHT}`} aria-hidden="true" /> : <span className={CHOICE_CHECK} aria-hidden="true" />}
    </button>)}
  </div>;
}

/** 여러 개를 고른다(관심 키워드). */
export function ChipGroup({ label, options, selected, onToggle }: { label: string; options: readonly string[]; selected: readonly string[]; onToggle: (value: string) => void }) {
  return <div className={`${CHIPS} flex-wrap`} role="group" aria-label={label}>
    {options.map((option) => <button type="button" className={CHIP} key={option} aria-pressed={selected.includes(option)} onClick={() => onToggle(option)}>{option}</button>)}
  </div>;
}

/**
 * 프로필 아이콘. Radix Avatar와 같은 규약이다: 사진은 실제로 불러온 뒤에만 보이고, 없거나 실패하면 기본 사람 모양이 보인다.
 * 이름이나 이메일이 바로 옆에 있어 장식으로 취급한다(alt 비움). 사진 서버에 우리 주소가 새지 않게 referrer를 보내지 않는다.
 */
export function Avatar({ src, size = 48 }: { src?: string | null; size?: number }) {
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    setLoaded(false);
    if (!src) return;
    let alive = true;
    const image = new Image();
    image.referrerPolicy = 'no-referrer';
    image.onload = () => { if (alive) setLoaded(true); };
    image.onerror = () => { if (alive) setLoaded(false); };
    image.src = src;
    return () => { alive = false; };
  }, [src]);
  return <span className="avatar inline-grid flex-none place-items-center overflow-hidden rounded-[50%] bg-sunken text-ink-3 [box-shadow:inset_0_0_0_1px_var(--line)] [&_img]:h-full [&_img]:w-full [&_img]:object-cover [&_svg]:h-[72%] [&_svg]:w-[72%] [&_svg]:[align-self:end] [&_svg]:fill-current" style={{ width: size, height: size }} aria-hidden="true" data-loaded={loaded}>
    {src && loaded
      ? <img src={src} alt="" referrerPolicy="no-referrer" draggable={false} />
      : <svg viewBox="0 0 24 24" focusable="false"><circle cx="12" cy="9" r="4.2" /><path d="M3.5 22c.6-4.9 4.3-8 8.5-8s7.9 3.1 8.5 8z" /></svg>}
  </span>;
}

/** 단과대(묶음) 고르기: 2열 격자다. 17개를 한 줄씩 늘어놓으면 스크롤해야 해서 한 화면에 들어오게 하고, 홀수 마지막 칸은 전체 폭으로 둔다. 전공 고르기와 게시판 추가가 같이 쓴다. */
/** notes가 있으면 이름 아래에 상태를 한 줄로 적는다(예: 첫 설정에서 그 단과대의 켠 게시판 수). 묶음을 닫아도 무엇을 켰는지 보인다. */
export function GroupGrid({ label, names, onPick, notes }: { label: string; names: readonly string[]; onPick: (name: string) => void; notes?: Readonly<Record<string, string>> }) {
  return <div role="group" aria-label={label} className="grid grid-cols-2 gap-2">
    {names.map((name) => <button key={name} type="button" onClick={() => onPick(name)}
      className="flex min-h-[56px] items-center justify-between gap-1 rounded-md border border-line bg-surface px-3 text-left text-[14px] font-medium text-ink break-keep [@media(hover:hover)]:hover:bg-hover active:bg-hover [&:last-child:nth-child(odd)]:col-span-2">
      <span className="flex flex-col py-[6px]"><span>{name}</span>{notes?.[name] ? <span className="text-[13px] font-semibold leading-[18px] text-accent">{notes[name]}</span> : null}</span><span className={`choice-chevron ${CHEVRON_RIGHT}`} aria-hidden="true" /></button>)}
  </div>;
}

/** 고른 묶음(단과대)을 위에 보이고 눌러서 다른 묶음으로 돌아간다. 오른쪽에 같은 말을 또 쓰지 않고, 낭독용 이름(aria-label)에만 "다른 ○○ 고르기"를 둔다. */
export function BackToGroups({ current, noun = '단과대', onBack }: { current: string; noun?: string; onBack: () => void }) {
  return <button type="button" aria-label={`${current}, 다른 ${noun} 고르기`} onClick={onBack}
    className="flex min-h-[48px] w-full items-center justify-start gap-2 rounded-md border-0 bg-sunken px-3 text-left text-[15px] font-semibold text-ink [@media(hover:hover)]:hover:bg-hover active:bg-hover">
    <span className="flex items-center gap-[10px]"><span className={`choice-chevron ${CHEVRON_LEFT_STRONG}`} aria-hidden="true" />{current}</span>
  </button>;
}
