// 키워드가 공지에 맞는지. 목록의 "관심 ○○" 표시와 키워드로 거르기가 쓴다. 알림 대상 판정(DB의 keyword_in_text)과 같은 규칙이다.
//  - 낱말마다 따로 찾고 모두 있어야 맞는다(띄어쓰기는 무시). "겨울방학 인턴"은 제목에 "겨울 방학"과 "인턴"이 따로 있어도 맞는다.
//  - 방학 낱말은 같은 뜻의 말로도 찾는다(겨울방학=동계·겨울, 여름방학=하계·여름).
//  - 방학 낱말은 공고에서 뽑은 근무 기간이 그 방학에 들어가는 짧은 인턴십(약 2개월)이어도 맞는다.
//    반대로 5개월처럼 긴 인턴십은 방학 키워드에 맞추지 않는다(방학 인턴은 그 방학 기간만 일하는 짧은 인턴십이다).
const squash = (text: string) => text.replace(/\s+/g, '').toLowerCase();

export type Season = 'winter' | 'summer';
const SEASON_WORDS: Record<Season, readonly string[]> = { winter: ['겨울방학', '동계', '겨울'], summer: ['여름방학', '하계', '여름'] };
const SEASON_OF = new Map<string, Season>([['겨울방학', 'winter'], ['겨울', 'winter'], ['동계', 'winter'], ['여름방학', 'summer'], ['여름', 'summer'], ['하계', 'summer']]);

/** 공고에서 뽑은 근무 기간(없으면 null). */
export interface WorkPeriod { start: string | null; end: string | null; days: number | null }

const day = (value: string) => new Date(`${value}T00:00:00Z`).getTime();

/** 근무 기간이 그 방학에 들어가는 짧은 인턴십인지. 시작·종료일이 있으면 날짜로, 없으면 일수만으로는 정하지 않는다. */
export function periodFitsSeason(period: WorkPeriod | null | undefined, season: Season): boolean {
  if (!period?.start || !period.end) return false;
  const start = new Date(`${period.start}T00:00:00Z`), end = new Date(`${period.end}T00:00:00Z`);
  const days = Math.round((day(period.end) - day(period.start)) / 86_400_000) + 1;
  if (!(days >= 20 && days <= 100)) return false;
  const startMonth = start.getUTCMonth() + 1, endMonth = end.getUTCMonth() + 1;
  return season === 'winter'
    ? (startMonth === 12 || startMonth <= 2) && (endMonth <= 3 || endMonth === 12 || (endMonth === 2 || endMonth === 1))
    : startMonth >= 6 && startMonth <= 8 && endMonth >= 7 && endMonth <= 9;
}

export function keywordMatchesNotice(keyword: string, text: string, period?: WorkPeriod | null): boolean {
  const haystack = squash(text);
  const words = keyword.split(/\s+/).filter(Boolean);
  if (!words.length) return false;
  return words.every((word) => {
    const key = squash(word);
    const season = SEASON_OF.get(key);
    if (!season) return haystack.includes(key);
    return SEASON_WORDS[season].some((synonym) => haystack.includes(synonym)) || periodFitsSeason(period, season);
  });
}
