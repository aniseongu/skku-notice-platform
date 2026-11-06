// 정적 API v1(D-010) 형식과, 화면에서 쓰는 날짜와 분류 계산. 네트워크는 fetchJson에만 있다.

// external: 외부 인턴 공고(링커리어, 자소설닷컴, D-026). 성대 공지 탭에는 넣지 않는다.
export interface Source { id: string; name: string; url: string; external?: boolean }

export interface Notice {
  id: string;
  source_id: string;
  article_no: string;
  title: string;
  category: string | null;
  url: string;
  posted_on: string;
  pinned: boolean;
  deadline: string | null;
  first_seen: string | null;
  // 영어 공지를 Gemini가 옮긴 제목(추가 필드). 없으면 원문 제목을 쓴다.
  title_ko?: string | null;
  // 제목에 마감이 없을 때 Gemini가 본문에서 읽은 날짜의 종류(추가 필드, D-023). 없으면 마감.
  deadline_kind?: '마감' | '일정';
  // 학교가 글을 고친 때와 종류(추가 필드, D-025). 제목이 바뀌었으면 바뀌기 전 제목.
  changed_at?: string | null;
  change_kind?: '제목' | '본문' | null;
  previous_title?: string | null;
}

export type Verdict = 'relevant' | 'maybe' | 'not_relevant';

export interface Judgement {
  rule_name: string | null;
  priority: 'high' | 'default' | 'low' | null;
  reasons: string[];
  // interests: D-010에 추가된 필드(서버의 관심 키워드 글자 매칭, ai.interests는 Gemini가 뜻으로 맞춘 것). 없을 수 있다.
  interests?: string[];
  ai: { verdict: Verdict; reason: string; model: string; interests?: string[] } | null;
  notified: boolean;
}

// D-013: 글별 본문 파일(site/api/v1/notices/<게시판>/<글번호>.json). 아직 안 받은 글은 파일이 없다.
export interface NoticeBody {
  version: number;
  id: string;
  summary: string | null;
  summary_status?: 'ready' | 'failed' | 'pending';
  body: string | null;
  body_status?: 'pending' | 'retrying' | 'unavailable' | 'ready';
  // type, size는 D-016에 추가된 필드(형식, 크기 글자). 없을 수 있다. 첨부는 학교 다운로드 주소로 바로 받는다.
  attachments: { name: string; url: string; type?: string; size?: string | null }[];
  // 서버가 nh3로 정제한 본문 HTML(D-016). 없으면 글자 본문(body)을 그린다.
  body_html?: string | null;
  // 본문 영역 안 그림 주소(본문이 그림으로만 올라온 글이 있다). 없을 수 있다.
  images?: string[];
  // 그림에서 기계가 읽어 옮긴 본문인지(D-014, D-015). 틀릴 수 있어 화면에 밝힌다.
  body_from_image?: boolean;
  // 영어 공지의 한국어 번역(translate.py). 원문은 body, body_html 그대로 있다.
  translation?: { title: string; body: string; model?: string } | null;
  fetched_at: string | null;
}

export async function fetchBody(notice: Notice): Promise<NoticeBody | null> {
  // 주소에 들어가는 값은 형식을 확인한 뒤에만 쓴다.
  if (!/^[\w-]+$/.test(notice.source_id) || !/^\d+$/.test(notice.article_no)) return null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const body = await fetchJson<NoticeBody>(`notices/${notice.source_id}/${notice.article_no}.json`, true);
      if (body) return body;
    } catch { /* 일시적인 네트워크 오류는 한 번 더 확인한다. */ }
    if (attempt === 0) await new Promise((resolve) => window.setTimeout(resolve, 800));
  }
  return null;
}

export interface NoticesFile { version: number; generated_at: string; sources: Source[]; notices: Notice[] }
export interface MatchedFile { version: number; generated_at: string; items: Record<string, Judgement> }

// 개발 서버에서만 ?api=sample/api/v1 로 예시 데이터를 본다. 배포본은 항상 같은 출처의 api/v1만 읽는다
// (주소 인자로 남의 JSON을 읽게 하면 그 안의 링크로 스크립트를 심을 수 있다).
const requested = new URLSearchParams(location.search).get('api');
const API = import.meta.env.DEV && requested && /^[\w-]+(\/[\w-]+)*$/.test(requested) ? requested : 'api/v1';

// 원문 링크는 http, https만 연다. javascript: 같은 주소는 막는다.
export function safeUrl(url: string): string {
  try {
    const parsed = new URL(url, location.href);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.href : '#';
  } catch {
    return '#';
  }
}

export async function fetchJson<T>(name: string, optional = false): Promise<T | null> {
  const response = await fetch(`${API}/${name}`, { cache: 'no-cache' });
  if (optional && response.status === 404) return null;
  if (!response.ok) throw new Error(`${name}: HTTP ${response.status}`);
  return (await response.json()) as T;
}

export const VERDICT_LABEL: Record<Verdict, string> = { relevant: '해당', maybe: '확인 필요', not_relevant: '해당 없음' };

export const boardName = (source: Source | undefined, fallback: string) => (source?.name ?? fallback).replace(/\s*공지$/, '');

// 학교 제목 속 이모지(✅, ✨)는 표시할 때만 지운다(DESIGN 8절). 원문은 그대로다.
export const cleanTitle = (title: string) =>
  title.replace(/\p{Extended_Pictographic}\uFE0F?/gu, '').replace(/\(\s+~/g, '(~').replace(/\s+/g, ' ').trim();

// 관심 키워드 글자 매칭. 서버(src/skku_notice/interests.py)와 같은 규칙: 띄어쓰기로 나눈 낱말이 모두 들어 있으면 맞음,
// 띄어쓰기 무시, 비슷한 말 포함(docs/design/ux-rules.md 2-1절).
const squash = (text: string) => text.replace(/\s+/g, '').toLowerCase();

export function keywordMatches(keyword: string, text: string): boolean {
  const haystack = squash(text);
  const words = keyword.split(/\s+/).filter(Boolean);
  // 그 글자가 그대로 있을 때만 맞는다. 비슷한 말이나 뜻으로는 맞추지 않는다(D-024).
  return words.length > 0 && words.every((word) => haystack.includes(squash(word)));
}

// 날짜 계산은 모두 한국 시간 기준 날짜(YYYY-MM-DD)로 한다.
const kstDay = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' });
const WEEKDAY = '일월화수목금토';

export const todayKst = () => kstDay.format(new Date());
const toUtc = (day: string) => { const [y, m, d] = day.split('-').map(Number); return Date.UTC(y, m - 1, d); };
export const dayDiff = (from: string, to: string) => Math.round((toUtc(to) - toUtc(from)) / 86_400_000);

export function koreanDate(day: string): string {
  const [, m, d] = day.split('-').map(Number);
  return `${m}월 ${d}일 (${WEEKDAY[new Date(toUtc(day)).getUTCDay()]})`;
}

export function postedGroup(day: string, today: string): string {
  const diff = dayDiff(day, today);
  if (diff <= 0) return '오늘';
  if (diff === 1) return '어제';
  return koreanDate(day);
}

export const deadlinePassed = (iso: string) => new Date(iso).getTime() < Date.now();
export const daysLeft = (iso: string, today: string) => dayDiff(today, kstDay.format(new Date(iso)));

export function deadlineGroup(iso: string, today: string): string {
  const days = daysLeft(iso, today);
  if (days <= 0) return '오늘 마감';
  if (days <= 3) return '3일 안';
  if (days <= 7) return '일주일 안';
  return '일주일 뒤';
}

export function deadlineText(iso: string, today: string): string {
  if (deadlinePassed(iso)) return '마감';
  const days = daysLeft(iso, today);
  return days <= 0 ? '오늘' : `D-${days}`;
}

export function deadlineDetail(iso: string): string {
  const date = new Date(iso);
  const day = kstDay.format(date);
  const time = new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hour12: false }).format(date);
  return time === '23:59' ? koreanDate(day) : `${koreanDate(day)} ${time}`;
}

export type IconName = 'ginkgo' | 'coin' | 'briefcase' | 'calendar' | 'trophy' | 'book' | 'alarm'
  | 'search' | 'refresh' | 'list' | 'select-list' | 'user-check' | 'plus' | 'close' | 'back' | 'panel' | 'clip' | 'bookmark' | 'bookmark-on';

// 분류 글자와 제목 단어로 아이콘을 고른다. 알림 아이콘(scripts/build_icons.py NOTIFY)과 같은 이름.
const CATEGORY_ICONS: [IconName, RegExp][] = [
  ['coin', /장학|등록금|학자금/],
  ['trophy', /공모전|해커톤|경진|대회|챌린지/],
  ['briefcase', /채용|인턴|취업|모집|현장실습|아르바이트|TA/],
  ['calendar', /행사|세미나|특강|설명회|콜로키움|성과공유회|만남/],
  ['book', /학사|수업|수강|계절|학점|졸업|시험/],
];

export function categoryIcon(notice: Notice): IconName {
  const text = `${notice.category ?? ''} ${notice.title}`;
  return CATEGORY_ICONS.find(([, pattern]) => pattern.test(text))?.[0] ?? 'ginkgo';
}
