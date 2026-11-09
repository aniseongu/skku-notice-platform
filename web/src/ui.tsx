// 설정과 온보딩이 같이 쓰는 작은 구성요소. 모양은 styles.css의 platform 층에 있다.
import { useEffect, useState, type ReactNode } from 'react';

/** 원본 설정의 구역(작은 제목 + 상자). 구역 제목이 구역의 이름표가 된다. */
export function Card({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return <section aria-labelledby={`${id}-title`}>
    <h2 id={`${id}-title`} className="settings-head">{title}</h2>
    <div className="box">{children}</div>
  </section>;
}

/** 켜고 끄는 한 줄. 줄 전체가 눌리는 영역이다. */
export function SwitchRow({ checked, onChange, label, description, badge, disabled }: {
  checked: boolean; onChange: (next: boolean) => void; label: string; description?: string; badge?: string; disabled?: boolean;
}) {
  return <button type="button" role="switch" className="switch-row" aria-checked={checked} disabled={disabled} onClick={() => onChange(!checked)}>
    <span className="switch-text"><span className="switch-label">{label}{badge ? <>{" "}<span className="badge">{badge}</span></> : null}</span>
      {description ? <span className="switch-note">{description}</span> : null}</span>
    <span className="switch-state" aria-hidden="true">{checked ? '켜짐' : '꺼짐'}</span>
    <span className="switch" aria-hidden="true" />
  </button>;
}

/** 몇 개 안 되는 값 중 하나를 고른다(학년, 재학 상태 등). */
export function Segmented<T extends string | number>({ label, options, value, onChange, columns }: {
  label: string; options: readonly { value: T; label: string }[]; value: T | null; onChange: (next: T) => void; columns?: number;
}) {
  return <div className="seg" data-columns={columns} role="group" aria-label={label}>
    {options.map((option) => <button type="button" key={String(option.value)} aria-pressed={value === option.value}
      onClick={() => onChange(option.value)}>{option.label}</button>)}
  </div>;
}

/** 목록에서 하나를 고른다. 누르면 바로 다음 단계로 가는 용도라 항목이 크다. */
export function ChoiceList({ label, items, selected, onSelect }: {
  label: string; items: readonly { id: string; label: string; note?: string; description?: string }[]; selected?: string | null; onSelect: (id: string) => void;
}) {
  return <div className="choice-list" role="radiogroup" aria-label={label}>
    {items.map((item) => <button type="button" className="choice" role="radio" key={item.id} aria-checked={selected === item.id} onClick={() => onSelect(item.id)}>
      <span>{item.label}{item.note ? <span className="choice-note">{item.note}</span> : null}{item.description ? <span className="choice-desc">{item.description}</span> : null}</span>
      <span className="choice-check" aria-hidden="true" />
    </button>)}
  </div>;
}

/** 여러 개를 고른다(관심 키워드). */
export function ChipGroup({ label, options, selected, onToggle }: { label: string; options: readonly string[]; selected: readonly string[]; onToggle: (value: string) => void }) {
  return <div className="chips chip-wrap" role="group" aria-label={label}>
    {options.map((option) => <button type="button" className="chip" key={option} aria-pressed={selected.includes(option)} onClick={() => onToggle(option)}>{option}</button>)}
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
  return <span className="avatar" style={{ width: size, height: size }} aria-hidden="true" data-loaded={loaded}>
    {src && loaded
      ? <img src={src} alt="" referrerPolicy="no-referrer" draggable={false} />
      : <svg viewBox="0 0 24 24" focusable="false"><circle cx="12" cy="9" r="4.2" /><path d="M3.5 22c.6-4.9 4.3-8 8.5-8s7.9 3.1 8.5 8z" /></svg>}
  </span>;
}
