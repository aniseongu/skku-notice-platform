import { OPPORTUNITY_STATUSES, type OpportunityStatus } from './opportunities.ts';

// 기회 탐험 지도: 기록한 활동을 여섯 영역으로 나눠 센다. 설명할 수 있는 개수만 만든다(퍼센트·순위·점수 없음).
export type DomainId = 'career' | 'academic' | 'scholarship' | 'exchange' | 'contest' | 'extra';
export type DomainOrOther = DomainId | 'other';

export interface ExploreDomain { id: DomainId; label: string; hint: string; keywords: readonly string[] }

/** 위에서부터 처음 맞는 영역이 된다. */
export const EXPLORE_DOMAINS: readonly ExploreDomain[] = [
  { id: 'exchange', label: '교환학생', hint: '교환학생 공지 게시판에서 찾아볼 수 있어요', keywords: ['교환학생', '파견', '협정교', '해외 대학', '해외대학'] },
  { id: 'scholarship', label: '장학금', hint: '공지 검색에서 \'장학\'으로 찾아볼 수 있어요', keywords: ['장학'] },
  { id: 'contest', label: '공모전', hint: '공지 검색에서 \'공모전\'으로 찾아볼 수 있어요', keywords: ['공모전', '경진대회', '해커톤', '콘테스트', '아이디어톤'] },
  { id: 'career', label: '취업·인턴', hint: '인턴 탭에서 공고를 찾아볼 수 있어요', keywords: ['인턴', '채용', '현장실습', '취업', '신입'] },
  { id: 'academic', label: '학사·졸업', hint: '학과 공지 게시판에서 찾아볼 수 있어요', keywords: ['졸업', '수강', '휴학', '복학', '복수전공', '전과', '계절학기', '학사'] },
  { id: 'extra', label: '비교과', hint: '공지 검색에서 \'비교과\'로 찾아볼 수 있어요', keywords: ['비교과', '특강', '세미나', '멘토링', '워크숍', '부트캠프', '봉사', '동아리'] },
];
/** 화면에 보여 주는 순서(분류 우선순위와 다르다). */
export const DISPLAY_ORDER: readonly DomainId[] = ['career', 'academic', 'scholarship', 'exchange', 'contest', 'extra'];

export interface ExploreItem { id: string; title: string; board: string | null; category?: string | null; status: OpportunityStatus }

export function domainOf(item: { title: string; board?: string | null; category?: string | null }): DomainOrOther {
  const text = `${item.title} ${item.board ?? ''} ${item.category ?? ''}`.toLowerCase();
  for (const domain of EXPLORE_DOMAINS) if (domain.keywords.some((word) => text.includes(word))) return domain.id;
  return 'other';
}

export type StatusCounts = Record<OpportunityStatus, number>;
export interface DomainSummary { id: DomainOrOther; label: string; hint: string; count: number; byStatus: StatusCounts }
export interface ExploreSummary { total: number; domains: DomainSummary[]; other: DomainSummary }

const emptyCounts = (): StatusCounts => ({ interested: 0, preparing: 0, applied: 0, result: 0 });

/** 같은 공지(id)는 한 번만 센다. 영역은 DISPLAY_ORDER 순서로 항상 여섯 개를 돌려준다. */
export function summarize(items: readonly ExploreItem[]): ExploreSummary {
  const seen = new Set<string>();
  const make = (id: DomainOrOther, label: string, hint: string): DomainSummary => ({ id, label, hint, count: 0, byStatus: emptyCounts() });
  const byId = new Map<DomainOrOther, DomainSummary>(EXPLORE_DOMAINS.map((d) => [d.id, make(d.id, d.label, d.hint)]));
  const other = make('other', '그 밖', '');
  let total = 0;
  for (const item of items) {
    if (seen.has(item.id)) continue;
    seen.add(item.id); total += 1;
    const target = byId.get(domainOf(item)) ?? other;
    target.count += 1; target.byStatus[item.status] += 1;
  }
  return { total, domains: DISPLAY_ORDER.map((id) => byId.get(id)!), other };
}

const STATUS_SHORT: Record<OpportunityStatus, string> = { interested: '관심', preparing: '준비', applied: '지원', result: '결과' };
/** "관심 2 · 준비 1": 0개인 상태는 빼고 진행 순서대로 잇는다. */
export function statusLine(counts: StatusCounts): string {
  return OPPORTUNITY_STATUSES.filter((s) => counts[s] > 0).map((s) => `${STATUS_SHORT[s]} ${counts[s]}`).join(' · ');
}
