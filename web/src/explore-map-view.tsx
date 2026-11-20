// 기회 탐험 지도(설정 하위 쪽 틀: ?view=settings&section=explore). 설계는 docs/design/2026-11-21_explore-map.md.
// 개수만 보여 준다. 퍼센트·막대·순위·연속 기록은 두지 않는다.
import { NOTE_TEXT } from './cls';
import { statusLine, type DomainSummary, type ExploreSummary } from './explore-map';

export interface ExploreModel { summary: ExploreSummary }

const GUTTER = 'px-[var(--gutter)] min-[720px]:px-[24px]';

function DomainCard({ domain }: { domain: DomainSummary }) {
  const open = domain.count > 0;
  return <li className={`explore-card flex min-h-[88px] flex-col justify-center gap-[2px] rounded-md px-[16px] py-[14px] ${open ? 'border border-line bg-surface' : 'border border-dashed border-line bg-transparent'}`} data-open={open}>
    <div className="flex items-baseline justify-between gap-[12px]">
      <h3 className={`m-0 text-[15px] leading-[22px] font-semibold ${open ? 'text-ink' : 'text-ink-3'}`}>{domain.label}{open ? null : <span className="visually-hidden"> (잠겨 있어요)</span>}</h3>
      {open ? <span className="explore-count text-[20px] leading-[26px] font-bold text-ink">{domain.count}개</span> : null}
    </div>
    {open
      ? <p className={`explore-status ${NOTE_TEXT}`}>{statusLine(domain.byStatus)}</p>
      : <><p className="m-0 text-[14px] leading-[20px] text-ink-3">아직 기록이 없어요</p><p className="m-0 text-[13px] leading-[19px] text-ink-3">{domain.hint}</p></>}
  </li>;
}

export function ExploreMapPage({ model }: { model: ExploreModel }) {
  const { summary } = model;
  return <div className="explore-map pb-[calc(var(--tabbar-h)+32px)] min-[720px]:pb-[48px]">
    <p className={`explore-total m-0 pt-[8px] pb-[12px] text-[15px] leading-[22px] font-medium text-ink ${GUTTER}`}>기록한 활동 {summary.total}개</p>
    <ul className={`m-0 grid list-none grid-cols-1 gap-[8px] p-0 min-[720px]:grid-cols-2 min-[720px]:gap-[12px] ${GUTTER}`} aria-label="영역별 기록">
      {summary.domains.map((domain) => <DomainCard key={domain.id} domain={domain} />)}
    </ul>
    {summary.other.count > 0
      ? <p className={`explore-other ${NOTE_TEXT} mt-[12px] ${GUTTER}`}>그 밖 {summary.other.count}개{statusLine(summary.other.byStatus) ? ` · ${statusLine(summary.other.byStatus)}` : ''}</p>
      : null}
  </div>;
}
