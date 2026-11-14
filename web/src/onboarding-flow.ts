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

/** 전공이 바뀌면 추천 게시판을 다시 맞춘다. 고른 전공의 단과대·학과 게시판은 늘 켠다(사용자 지시 2026-11-12).
 * 게시판을 직접 바꿨거나 이미 받는 게시판이 있으면 그 선택은 두고, 새 전공 때문에 새로 추천된 게시판만 더 켠다. */
export function withPrograms(draft: Draft, programs: Program[]): Draft {
  const unique = programs.filter((program, index) => programs.findIndex((other) => programKey(other) === programKey(program)) === index).slice(0, MAX_PROGRAMS);
  if (!draft.boardsTouched) return { ...draft, programs: unique, boards: boardsForPrograms(unique) };
  const before = new Set(boardsForPrograms(draft.programs));
  const added = boardsForPrograms(unique).filter((id) => !before.has(id) && !draft.boards.includes(id));
  return { ...draft, programs: unique, boards: [...draft.boards, ...added] };
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

/** 필수 항목이 비었는지 판단할 때 쓰는 값. keysUsable이 null이면 아직 모르는 것(기능 꺼짐, 불러오는 중, 불러오기 실패)이라 비었다고 보지 않는다. */
export interface RequiredContext { draft: Draft; doubleAnswer: DoubleAnswer; keysUsable: boolean | null }
export interface RequiredItem { step: Step; label: string; missing: (ctx: RequiredContext) => boolean }

/** 계정이 반드시 채워야 하는 정보의 목록. 순서가 화면 순서다.
 * 업데이트로 새 필수 정보가 생기면 여기 항목 하나를 더한다(단계 화면, 확인 함수, 이름). 기존 사용자는 다음 접속 때 그 항목만 채우는 화면을 본다.
 * 왼쪽 단계 목록, 진행 막대, 시작 단계, 건너뛰는 단계, 앞을 막는 판단이 모두 이 배열에서 나온다. */
export const REQUIRED_ITEMS: readonly RequiredItem[] = [
  { step: 'primary', label: '주전공', missing: ({ draft, doubleAnswer }) => !canContinue('primary', draft, doubleAnswer) },
  { step: 'double', label: '복수전공', missing: ({ draft, doubleAnswer }) => !canContinue('double', draft, doubleAnswer) },
  { step: 'status', label: '학교 정보', missing: ({ draft, doubleAnswer }) => !canContinue('status', draft, doubleAnswer) },
  { step: 'internship', label: '인턴십', missing: ({ draft, doubleAnswer }) => !canContinue('internship', draft, doubleAnswer) },
  { step: 'ai', label: 'AI 키', missing: ({ keysUsable }) => keysUsable === false },
];

/** 채워야 하지만 비어 있는 항목(목록 순서). 첫 설정을 끝낸 계정에 이 화면만 보이게 하는 기준이다. registry는 시험에서 바꿔 끼운다. */
export function missingItems(ctx: RequiredContext, registry: readonly RequiredItem[] = REQUIRED_ITEMS): RequiredItem[] {
  return registry.filter((item) => item.missing(ctx));
}

export function missingRequired(draft: Draft, doubleAnswer: DoubleAnswer, keys: { usable: boolean | null }, registry: readonly RequiredItem[] = REQUIRED_ITEMS): Step[] {
  return missingItems({ draft, doubleAnswer, keysUsable: keys.usable }, registry).map((item) => item.step);
}

/** 저장된 프로필로 만든 값의 복수전공 답. 복수전공이 있으면 '있어요', 없으면 '없어요'. */
export const savedDoubleAnswer = (draft: Pick<Draft, 'programs'>): DoubleAnswer => (draft.programs.length > 1 ? 'yes' : 'no');

/** 필수 답이 있는 단계. 뒤 단계에 있는 사이에 새 필수 항목이 생겨도 이 순서대로 되돌아가게 한다. */
export const REQUIRED_STEPS: readonly Step[] = ['primary', 'double', 'status', 'internship'];
export const STEP_LABEL: Readonly<Partial<Record<Step, string>>> = { primary: '주전공', double: '복수전공', status: '학교 정보', internship: '인턴십' };

/** step보다 앞 단계 중 필수 답이 비어 있는 첫 단계. 없으면 null. 있으면 이 단계에서는 넘어가지 않고 그 단계로 돌아가게 한다. */
export function earlierMissing(step: Step, draft: Draft, doubleAnswer: DoubleAnswer = null): Step | null {
  const limit = STEPS.indexOf(step);
  return REQUIRED_STEPS.find((name) => STEPS.indexOf(name) < limit && !canContinue(name, draft, doubleAnswer)) ?? null;
}

/** 앞서 첫 설정을 저장까지 했는지(게시판 단계에서 프로필이 저장된다). 저장한 재학 상태가 있으면 앞 단계 답을 모두 했다는 뜻이다. */
export function savedBefore(profile: Pick<UserProfile, 'programs' | 'enrollmentStatus'>): boolean {
  return profile.programs.length > 0 && profile.enrollmentStatus !== null;
}

/** 다시 열었을 때 시작할 단계. 저장까지 하고 AI 키 단계에서 나갔다면 이미 답한 질문을 다시 묻지 않고 AI 키 단계부터 잇는다.
 * 그 사이 새 필수 질문이 생겨 답이 비어 있으면 처음부터 묻는다(그 단계로 돌아가는 일은 earlierMissing이 맡는다). */
export function resumeStep(profile: Pick<UserProfile, 'programs' | 'enrollmentStatus'>, draft: Draft): Step {
  if (!savedBefore(profile)) return 'primary';
  const answer: DoubleAnswer = draft.programs.length > 1 ? 'yes' : 'no';
  return REQUIRED_STEPS.every((name) => canContinue(name, draft, answer)) ? 'ai' : 'primary';
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
