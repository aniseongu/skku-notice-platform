// 첫 로그인 설정의 단계와 초안. 화면과 무관한 규칙만 둔다(화면은 onboarding.tsx).
import { boardsForPrograms } from './skku-boards.ts';
import { MAX_PROGRAMS, programKey, type Program } from './skku-programs.ts';
import type { UserProfile } from './profile.ts';

export type Step = 'primary' | 'double' | 'status' | 'etc' | 'boards' | 'notify';
export const STEPS: readonly Step[] = ['primary', 'double', 'status', 'etc', 'boards', 'notify'];

// 골라서 쓰는 키워드. 직접 쓰는 입력은 설정에서 한다(처음에는 고르기만 해도 되게).
export const KEYWORD_SUGGESTIONS = ['장학', '인턴', '채용', '공모전', '대외활동', '교환학생', '수강신청', '졸업', '특강', '등록금'] as const;

export interface Draft {
  /** 첫 항목이 주전공, 나머지가 복수전공이다. */
  programs: Program[];
  year: number | null;
  enrollmentStatus: string | null;
  boards: string[];
  keywords: string[];
  /** 사용자가 게시판을 직접 바꿨으면 전공을 고쳐도 추천으로 덮어쓰지 않는다. */
  boardsTouched: boolean;
}

export function initialDraft(profile: UserProfile, subscriptions: string[], keywords: string[]): Draft {
  const subscribed = subscriptions.length > 0;
  return {
    programs: [...profile.programs],
    year: profile.year,
    // 가장 흔한 값을 미리 골라 두어 클릭을 줄인다. 이미 정한 사람의 값은 그대로 둔다.
    enrollmentStatus: profile.enrollmentStatus ?? '재학',
    boards: subscribed ? [...subscriptions] : boardsForPrograms(profile.programs),
    keywords: [...keywords],
    boardsTouched: subscribed,
  };
}

/** 전공이 바뀌면 추천 게시판을 다시 맞춘다. 직접 고른 게시판은 건드리지 않는다. */
export function withPrograms(draft: Draft, programs: Program[]): Draft {
  const unique = programs.filter((program, index) => programs.findIndex((other) => programKey(other) === programKey(program)) === index).slice(0, MAX_PROGRAMS);
  return { ...draft, programs: unique, boards: draft.boardsTouched ? draft.boards : boardsForPrograms(unique) };
}

export function toggleValue(list: readonly string[], value: string): string[] {
  return list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
}

export function canContinue(step: Step, draft: Draft): boolean {
  switch (step) {
    case 'primary': return draft.programs.length >= 1;
    case 'double': return true;
    case 'status': return draft.year !== null && draft.enrollmentStatus !== null;
    case 'etc': return true;
    case 'boards': return true;
    case 'notify': return true;
  }
}

export const stepIndex = (step: Step): number => STEPS.indexOf(step);
export const previousStep = (step: Step): Step | null => STEPS[stepIndex(step) - 1] ?? null;
export const nextStep = (step: Step): Step | null => STEPS[stepIndex(step) + 1] ?? null;

/** 학과 목록이 길면 검색을 보인다. */
export const SEARCH_THRESHOLD = 8;
export function filterDepartments(departments: readonly string[], query: string): string[] {
  const needle = query.replace(/\s+/g, '').toLowerCase();
  return needle ? departments.filter((name) => name.replace(/\s+/g, '').toLowerCase().includes(needle)) : [...departments];
}
