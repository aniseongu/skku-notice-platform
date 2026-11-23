// 공지 월드컵(설정 하위 쪽 틀: ?view=settings&section=worldcup). 설계는 docs/design/2026-11-23_notice-worldcup.md.
// 순위·퍼센트·비교 없이 내가 고른 공지만 보여 주고, 서버에는 아무것도 남기지 않는다.
import { useEffect, useRef, useState } from 'react';
import { GHOST_BUTTON, NOTE_TEXT, SOLID_BUTTON } from './cls';
import { koreanDate, kstDateOf } from './data';
import { currentPair, pick, progressLabel, startCup, type CupNotice } from './worldcup';

export interface WorldcupModel {
  candidates: CupNotice[];
  isSaved: (id: string) => boolean;
  save: (id: string) => void;
  open: (id: string) => void;
  share: (id: string) => void;
}

const GUTTER = 'px-[var(--gutter)] min-[720px]:px-[24px]';
const CARD = 'worldcup-card [@media(hover:hover)]:hover:bg-hover active:bg-hover flex min-h-[88px] w-full flex-col justify-center gap-[4px] rounded-md border border-line bg-surface px-[16px] py-[16px] text-left text-ink min-[720px]:min-h-[160px]';

const deadlineText = (item: CupNotice) => item.deadline ? `마감 ${koreanDate(kstDateOf(item.deadline))}` : '';

function CardBody({ item }: { item: CupNotice }) {
  const deadline = deadlineText(item);
  return <>
    <span className="text-[13px] leading-[18px] text-ink-3">{item.board}{item.saved ? ' · 저장한 공지' : ''}</span>
    <span className="worldcup-title line-clamp-3 text-[16px] leading-[24px] font-semibold [overflow-wrap:anywhere]">{item.title}</span>
    {deadline ? <span className="text-[14px] leading-[20px] text-ink-2">{deadline}</span> : null}
  </>;
}

export function WorldcupPage({ model }: { model: WorldcupModel }) {
  const [cup, setCup] = useState(() => startCup(model.candidates));
  const cupRef = useRef(cup);
  cupRef.current = cup;
  const choose = (side: 0 | 1) => setCup((current) => pick(current, side));
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || (event.target as HTMLElement | null)?.closest('input, textarea, select')) return;
      if (!currentPair(cupRef.current)) return;
      if (event.key === '1' || event.key === 'ArrowLeft') { event.preventDefault(); choose(0); }
      else if (event.key === '2' || event.key === 'ArrowRight') { event.preventDefault(); choose(1); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const pair = currentPair(cup);
  const champion = cup.champion;
  const wrap = 'worldcup pb-[calc(var(--tabbar-h)+32px)] min-[720px]:pb-[48px]';
  if (!pair && champion) {
    const saved = model.isSaved(champion.id);
    return <div className={wrap}>
      <div className={`pt-[16px] pb-[12px] ${GUTTER}`}>
        <h2 className="m-0 text-[15px] leading-[22px] font-medium text-ink">내가 고른 공지예요</h2>
        <p className={NOTE_TEXT}>마음에 든 순서일 뿐, 지원 가능 여부나 추천이 아니에요</p>
      </div>
      <div className={GUTTER}>
        <div className="worldcup-champion grid gap-[4px] rounded-md border border-line bg-surface px-[16px] py-[16px]"><CardBody item={champion} /></div>
        <div className="mt-[12px] grid gap-[8px] min-[720px]:grid-cols-2">
          <button type="button" className={`${SOLID_BUTTON} worldcup-open`} onClick={() => model.open(champion.id)}>공지 열기</button>
          <button type="button" className={`${GHOST_BUTTON} worldcup-save`} disabled={saved} onClick={() => model.save(champion.id)}>{saved ? '저장했어요' : '저장하기'}</button>
          <button type="button" className={`${GHOST_BUTTON} worldcup-share`} onClick={() => model.share(champion.id)}>공유하기</button>
          <button type="button" className={`${GHOST_BUTTON} worldcup-again`} onClick={() => setCup(startCup(model.candidates))}>다시 하기</button>
        </div>
      </div>
    </div>;
  }
  if (!pair) return null;
  const label = progressLabel(cup);
  return <div className={wrap}>
    <div className={`pt-[16px] pb-[12px] ${GUTTER}`}>
      <p className="worldcup-progress m-0 text-[15px] leading-[22px] font-medium text-ink" role="status" aria-live="polite">{label}</p>
      <p className={NOTE_TEXT}>더 눈에 들어오는 공지를 눌러요</p>
    </div>
    <div className={GUTTER}>
      <ul className="m-0 grid list-none gap-[12px] p-0 min-[720px]:grid-cols-2" role="list" aria-label={`${label} 대결`}>
        {pair.map((item, side) => <li key={side}>
          <button type="button" className={CARD} aria-keyshortcuts={`${side + 1} ${side ? 'ArrowRight' : 'ArrowLeft'}`}
            aria-label={`${item.title}, ${item.board}${deadlineText(item) ? `, ${deadlineText(item)}` : ''}`} onClick={() => choose(side as 0 | 1)}><CardBody item={item} /></button>
        </li>)}
      </ul>
    </div>
  </div>;
}
