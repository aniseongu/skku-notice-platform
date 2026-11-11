// 첫 로그인 설정의 단계와 초안. 화면과 무관한 규칙만 둔다(화면은 onboarding.tsx).
import { boardsForPrograms } from './skku-boards.ts';
import { MAX_PROGRAMS, programKey, type Program } from './skku-programs.ts';
import type { UserProfile } from './profile.ts';
import { isSoftwareOriginal as isSwOriginal, threePAnswer } from './graduation-assessment.ts';

const isSoftwareOriginal = (draft: { programs: Program[] }) => isSwOriginal({ programs: draft.programs });

// 7단계: 알림은 핵심 가치라 먼저 묻고, 입력이 번거로운 선택 사항(AI 키)은 마지막에 둔다. 기타 게시판은 게시판에 합쳤다. 인턴십은 질문이 많아 학교 정보와 따로 둔다(독립 평가: 한 화면에 질문이 많으면 6.5점).
export type Step = 'primary' | 'double' | 'status' | 'internship' | 'boards' | 'notify' | 'ai';
export const STEPS: readonly Step[] = ['primary', 'double', 'status', 'internship', 'boards', 'notify', 'ai'];

// 골라서 쓰는 키워드. 직접 쓰는 입력은 설정에서 한다(처음에는 고르기만 해도 되게).
export const KEYWORD_SUGGESTIONS = ['장학', '인턴', '채용', '공모전', '대외활동', '교환학생', '수강신청', '졸업', '특강', '등록금'] as const;

export interface Draft {
  /** 첫 항목이 주전공, 나머지가 복수전공이다. */
  programs: Program[];
  year: number | null;
  enrollmentStatus: string | null;
  militaryService: string | null;
  /** 소프트웨어학과 원전공만 묻는다. */
  admissionYear: number | null;
  university3pInternshipSelected: boolean | null;
  deptInternshipDone: boolean | null;
  university3pInternshipDone: boolean | null;
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
    militaryService: profile.militaryService,
    admissionYear: profile.admissionYear,
    university3pInternshipSelected: profile.university3pInternshipSelected,
    deptInternshipDone: profile.deptInternshipDone,
    university3pInternshipDone: profile.university3pInternshipDone,
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

/** 다음이 눌리지 않을 때 이유를 한 줄로 알려 준다(회색 단추만 보이면 무엇이 빠졌는지 모른다). */
export function missingHint(step: Step, draft: Draft, doubleAnswer: DoubleAnswer = null): string {
  if (canContinue(step, draft, doubleAnswer)) return '';
  switch (step) {
    case 'primary': return '학과를 골라 주세요';
    case 'double': return '있는지 없는지 골라 주세요';
    case 'status': return draft.year === null && draft.enrollmentStatus !== '졸업' ? '학년을 골라 주세요' : '재학 상태를 골라 주세요';
    case 'internship':
      if (isSoftwareOriginal(draft) && draft.admissionYear === null) return '입학 연도를 골라 주세요';
      if (threePAnswer(draft) === null) return '3품 인턴십을 골라 주세요';
      return '솦 인턴십을 골라 주세요';
    default: return '';
  }
}

/** doubleAnswer는 복수전공 단계에서 '있어요'/'없어요'를 골랐는지(고르기 전에는 null)다. */
export type DoubleAnswer = 'yes' | 'no' | null;

export function canContinue(step: Step, draft: Draft, doubleAnswer: DoubleAnswer = null): boolean {
  switch (step) {
    case 'primary': return draft.programs.length >= 1;
    case 'double': return doubleAnswer === 'no' || draft.programs.length >= 2;
    // 졸업한 사람은 학년이 없어도 된다.
    case 'status': return draft.enrollmentStatus !== null && (draft.year !== null || draft.enrollmentStatus === '졸업');
    // 소프트웨어학과 원전공은 인턴십 졸업요건 판정에 입학 연도가 필요하다.
    // 3품 인턴십은 모두 답해야 하고, 소프트웨어학과 원전공은 입학 연도와 솦 인턴십도 답해야 한다(아무것도 안 골라도 켜져 있으면 무엇이 빠졌는지 모른다).
    case 'internship': return threePAnswer(draft) !== null && (!isSoftwareOriginal(draft) || (draft.admissionYear !== null && draft.deptInternshipDone !== null));
    case 'ai': return true;
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
