import type { Notice } from './data';

export type Sort = 'latest' | 'deadline';
type DatedNotice = Pick<Notice, 'deadline' | 'posted_on'>;

// 서울대 비교과 매뉴얼의 정렬 방식처럼 지난 모집은 뒤에 두고, 날짜가 없는 글도 숨기지 않는다.
// 출처: https://cse.snu.ac.kr/api/v1/file/1757569660804_%EB%B9%84%EA%B5%90%EA%B3%BC%EA%B4%80%EB%A6%AC%EC%8B%9C%EC%8A%A4%ED%85%9C%20%EB%A7%A4%EB%89%B4%EC%96%BC(%ED%95%99%EC%83%9D%EC%9A%A9).pdf
export function orderNotices<T extends DatedNotice>(notices: readonly T[], sort: Sort, now = Date.now()): T[] {
  const bucket = (notice: T) => !notice.deadline ? 1 : Date.parse(notice.deadline) >= now ? 0 : 2;
  return [...notices].sort((a, b) => {
    if (sort === 'latest') return b.posted_on.localeCompare(a.posted_on);
    const aBucket = bucket(a), bBucket = bucket(b);
    if (aBucket !== bBucket) return aBucket - bBucket;
    if (aBucket === 1) return b.posted_on.localeCompare(a.posted_on);
    const delta = Date.parse(a.deadline!) - Date.parse(b.deadline!);
    return (aBucket === 2 ? -delta : delta) || b.posted_on.localeCompare(a.posted_on);
  });
}
