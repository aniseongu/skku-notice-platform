import type { SupabaseClient } from '@supabase/supabase-js';
import { MAX_PROGRAMS, programKey, validProgram, type Program } from './skku-programs.ts';

export interface UserProfile {
  programs: Program[];
  year: number | null;
  semester: number | null;
  enrollmentStatus: string | null;
  militaryService: string | null;
  onboardedAt: string | null;
  /** 입학 연도 네 자리(학번 전체는 받지 않는다). 소프트웨어학과 인턴십 졸업요건 판정에만 쓴다. */
  admissionYear: number | null;
  /** 학교 신3품에서 인턴십 영역을 골랐는지. 모르면 null. */
  university3pInternshipSelected: boolean | null;
  /** 소프트웨어학과 인턴십 졸업요건을 이미 채웠는지. 채웠으면 공지에서 이 판정을 숨긴다. */
  deptInternshipDone: boolean | null;
  /** 학교 신3품 인턴십 영역을 이미 채웠는지. */
  university3pInternshipDone: boolean | null;
  /** Gemini가 인턴 공고를 고를 때 읽는 주관식 설명. 각각 300자까지. */
  interests: string;
  wants: string;
  avoids: string;
}

export const PROFILE_TEXT_LIMIT = 300;
export type ProfileTextField = 'interests' | 'wants' | 'avoids';

export const ENROLLMENT = ['재학', '휴학', '졸업예정', '졸업'] as const;
export const MILITARY = ['복무 전', '복무 완료', '해당 없음'] as const;
export const EMPTY_PROFILE: UserProfile = {
  programs: [], year: null, semester: null, enrollmentStatus: null, militaryService: null, onboardedAt: null,
  admissionYear: null, university3pInternshipSelected: null, deptInternshipDone: null, university3pInternshipDone: null,
  interests: '', wants: '', avoids: '',
};

const COLUMNS = 'programs,year,semester,enrollment_status,military_service,onboarded_at,interests,wants,avoids';
const EXTRA_COLUMNS = ',admission_year,university_3p_internship_selected';
const DONE_COLUMNS = ',dept_internship_done,university_3p_internship_done';
/** 새 열이 아직 없는 환경(마이그레이션 전)이면 예전 열만으로 다시 시도한다. */
const missingColumn = (error: { code?: string; message?: string } | null) =>
  !!error && (error.code === '42703' || error.code === 'PGRST204' || /admission_year|university_3p_internship_selected|dept_internship_done|university_3p_internship_done/.test(error.message ?? ''));

export const ADMISSION_YEARS = Array.from({ length: 10 }, (_, i) => 2026 - i); // 2026 ~ 2017
export const OLD_ADMISSION_YEAR = 2016;  // "2016학번 이전"을 하나로 묶는다

/** 행이 없으면 null이다. 테이블이 아직 없는 환경처럼 읽을 수 없으면 던진다(호출하는 쪽이 온보딩을 숨긴다). */
export async function loadProfile(client: SupabaseClient, userId: string): Promise<UserProfile | null> {
  // 새 열이 없는 환경이면 가장 새로운 열부터 하나씩 빼며 다시 읽는다(있는 열은 그대로 읽는다).
  let data_: unknown = null, error: { code?: string; message?: string } | null = null;
  for (const columns of [COLUMNS + EXTRA_COLUMNS + DONE_COLUMNS, COLUMNS + EXTRA_COLUMNS, COLUMNS]) {
    ({ data: data_, error } = await client.from('user_profiles').select(columns).eq('user_id', userId).maybeSingle());
    if (!missingColumn(error)) break;
  }
  const raw = data_;
  if (error) throw error;
  const data = raw as unknown as Record<string, any> | null;  // eslint-disable-line @typescript-eslint/no-explicit-any
  if (!data) return null;
  return {
    programs: parsePrograms(data.programs), year: data.year, semester: data.semester,
    enrollmentStatus: data.enrollment_status, militaryService: data.military_service, onboardedAt: data.onboarded_at,
    admissionYear: Number.isInteger(data.admission_year) ? data.admission_year : null,
    university3pInternshipSelected: typeof data.university_3p_internship_selected === 'boolean' ? data.university_3p_internship_selected : null,
    deptInternshipDone: typeof data.dept_internship_done === 'boolean' ? data.dept_internship_done : null,
    university3pInternshipDone: typeof data.university_3p_internship_done === 'boolean' ? data.university_3p_internship_done : null,
    interests: cleanText(data.interests), wants: cleanText(data.wants), avoids: cleanText(data.avoids),
  };
}

/** 저장된 값을 믿지 않고 목록에 있는 전공만 남긴다. */
export function parsePrograms(value: unknown): Program[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const result: Program[] = [];
  for (const item of value) {
    const program = item && typeof item === 'object' ? { college: (item as Program).college, department: (item as Program).department ?? null } : null;
    if (program && typeof program.college === 'string' && (program.department === null || typeof program.department === 'string') && validProgram(program) && !seen.has(programKey(program))) {
      seen.add(programKey(program));
      result.push(program);
    }
  }
  return result.slice(0, MAX_PROGRAMS);
}

/** 제어 문자를 지우고 앞뒤 공백을 정리한다. 줄바꿈은 남긴다. */
export function cleanText(value: unknown): string {
  return typeof value === 'string' ? value.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').replace(/[ \t]+\n/g, '\n').trim() : '';
}

export function validateProfile(profile: UserProfile): void {
  const inRange = (value: number | null, low: number, high: number) => value === null || (Number.isInteger(value) && value >= low && value <= high);
  const keys = profile.programs.map(programKey);
  if (profile.programs.length > MAX_PROGRAMS || new Set(keys).size !== keys.length || !profile.programs.every(validProgram)) {
    throw new Error('단과대와 학과를 확인해 주세요.');
  }
  if (profile.admissionYear !== null && !(Number.isInteger(profile.admissionYear) && profile.admissionYear >= 2000 && profile.admissionYear <= 2100)) throw new Error('입학 연도를 확인해 주세요.');
  if (!inRange(profile.year, 1, 6) || !inRange(profile.semester, 1, 2)) throw new Error('학년과 학기를 확인해 주세요.');
  if (profile.enrollmentStatus !== null && !(ENROLLMENT as readonly string[]).includes(profile.enrollmentStatus)) throw new Error('재학 상태를 확인해 주세요.');
  if (profile.militaryService !== null && !(MILITARY as readonly string[]).includes(profile.militaryService)) throw new Error('병역 상태를 확인해 주세요.');
  for (const field of ['interests', 'wants', 'avoids'] as const) {
    if (typeof profile[field] !== 'string' || [...profile[field]].length > PROFILE_TEXT_LIMIT) throw new Error(`${PROFILE_TEXT_LIMIT}자 이하로 적어 주세요.`);
  }
}

export async function saveProfile(client: SupabaseClient, userId: string, profile: UserProfile): Promise<void> {
  validateProfile(profile);
  const row = {
    user_id: userId, programs: profile.programs, year: profile.year, semester: profile.semester,
    enrollment_status: profile.enrollmentStatus, military_service: profile.militaryService,
    onboarded_at: profile.onboardedAt, updated_at: new Date().toISOString(),
    interests: cleanText(profile.interests), wants: cleanText(profile.wants), avoids: cleanText(profile.avoids),
  };
  const extra = { admission_year: profile.admissionYear, university_3p_internship_selected: profile.university3pInternshipSelected };
  const done = { dept_internship_done: profile.deptInternshipDone, university_3p_internship_done: profile.university3pInternshipDone };
  let error: { code?: string; message?: string } | null = null;
  for (const values of [{ ...row, ...extra, ...done }, { ...row, ...extra }, row]) {
    ({ error } = await client.from('user_profiles').upsert(values, { onConflict: 'user_id' }));
    if (!missingColumn(error)) break;
  }
  if (error) throw error;
}
