// 기회 탐험 지도(설정 하위 쪽 틀: ?view=settings&section=explore). 설계는 docs/design/2026-11-21_explore-map.md.
// 개수만 보여 준다. 퍼센트·막대·순위·연속 기록은 두지 않는다.
import { statusLine, type DomainSummary, type ExploreSummary } from './explore-map';
import { GHOST_BUTTON, NOTE_TEXT } from './cls';

export type ExploreModel =
  | { status: 'loading' }
  | { status: 'failed'; retry: () => void }
  | { status: 'ready'; summary: ExploreSummary };

const GUTTER = 'px-[var(--gutter)] min-[720px]:px-[24px]';

function DomainCard({ domain }: { domain: DomainSummary }) {
  return <li className={`explore-card flex min-h-[88px] flex-col justify-center gap-[2px] rounded-md border border-line bg-surface px-[16px] py-[14px]`} data-open="true">
    <div className="flex items-baseline justify-between gap-[12px]">
      <h3 className="m-0 text-[15px] leading-[22px] font-semibold text-ink">{domain.label}</h3>
      <span className="explore-count text-[20px] leading-[26px] font-bold text-ink">{domain.count}개</span>
    </div>
    <p className="explore-status m-0 text-[14px] leading-[20px] text-ink-2">{statusLine(domain.byStatus)}</p>
  </li>;
}

export function ExploreMapPage({ model }: { model: ExploreModel }) {
  if (model.status === 'loading') {
    return <p className={`${GUTTER} m-0 pt-[8px] text-[14px] leading-[20px] text-ink-2`} role="status">활동 기록을 불러오고 있어요</p>;
  }
  if (model.status === 'failed') {
    return <div className={`${GUTTER} grid justify-items-start gap-[8px] pt-[8px]`}>
      <p className="m-0 text-[14px] leading-[20px] text-danger" role="alert">활동 기록을 불러오지 못했어요</p>
      <button type="button" className={GHOST_BUTTON} onClick={model.retry}>다시 불러오기</button>
    </div>;
  }
  const { summary } = model;
  const open = summary.domains.map((domain, index) => ({ domain, index })).filter((entry) => entry.domain.count > 0)
    .sort((a, b) => b.domain.count - a.domain.count || a.index - b.index).map((entry) => entry.domain);
  const empty = summary.domains.filter((domain) => domain.count === 0);
  const otherLine = statusLine(summary.other.byStatus);
  return <div className="explore-map pb-[calc(var(--tabbar-h)+32px)] min-[720px]:pb-[48px]">
    <div className={`pt-[8px] pb-[12px] ${GUTTER}`}>
      <p className="explore-total m-0 text-[15px] leading-[22px] font-medium text-ink">기록한 활동 {summary.total}개</p>
      <p className={NOTE_TEXT}>내가 기록한 공고를 제목으로 나눴어요</p>
    </div>
    <ul className={`m-0 grid list-none grid-cols-1 gap-[8px] p-0 min-[720px]:grid-cols-2 min-[720px]:gap-[12px] ${GUTTER}`} aria-label="영역별 기록">
      {open.map((domain) => <DomainCard key={domain.id} domain={domain} />)}
      {summary.other.count > 0
        ? <li className={`explore-other flex min-h-[88px] flex-col justify-center gap-[2px] rounded-md border border-line bg-surface px-[16px] py-[14px]`}>
          <div className="flex items-baseline justify-between gap-[12px]"><h3 className="m-0 text-[15px] leading-[22px] font-semibold text-ink">그 밖</h3><span className="text-[20px] leading-[26px] font-bold text-ink">{summary.other.count}개</span></div>
          {otherLine ? <p className="m-0 text-[14px] leading-[20px] text-ink-2">{otherLine}</p> : null}
        </li> : null}
    </ul>
    {empty.length ? <section className={`explore-empty mt-[20px] ${GUTTER}`} aria-labelledby="explore-empty-title">
      <h2 id="explore-empty-title" className={`m-0 mb-[4px] text-[13px] leading-[18px] font-semibold text-ink-2`}>아직 기록이 없는 영역</h2>
      <ul className="m-0 grid list-none gap-0 p-0">
        {empty.map((domain) => <li key={domain.id} className={`explore-card flex min-h-[44px] flex-wrap items-center gap-x-[8px] border-0 border-t border-line py-[8px] text-[13px] leading-[19px] first:border-t-0`} data-open="false">
          <span className={`font-semibold text-ink-2`}>{domain.label}</span><span className="text-ink-2">· {domain.hint}</span></li>)}
      </ul>
    </section> : null}
  </div>;
}
