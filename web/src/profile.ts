import type { SupabaseClient } from '@supabase/supabase-js';
import { MAX_PROGRAMS, programKey, validProgram, type Program } from './skku-programs.ts';

export interface UserProfile {
  programs: Program[];
  year: number | null;
  semester: number | null;
  enrollmentStatus: string | null;
  militaryService: string | null;
  onboardedAt: string | null;
}

export const ENROLLMENT = ['재학', '휴학', '졸업예정', '졸업'] as const;
export const MILITARY = ['복무 전', '복무 완료', '해당 없음'] as const;
export const EMPTY_PROFILE: UserProfile = {
  programs: [], year: null, semester: null, enrollmentStatus: null, militaryService: null, onboardedAt: null,
};

const COLUMNS = 'programs,year,semester,enrollment_status,military_service,onboarded_at';

/** 행이 없으면 null이다. 테이블이 아직 없는 환경처럼 읽을 수 없으면 던진다(호출하는 쪽이 온보딩을 숨긴다). */
export async function loadProfile(client: SupabaseClient, userId: string): Promise<UserProfile | null> {
  const { data, error } = await client.from('user_profiles').select(COLUMNS).eq('user_id', userId).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return {
    programs: parsePrograms(data.programs), year: data.year, semester: data.semester,
    enrollmentStatus: data.enrollment_status, militaryService: data.military_service, onboardedAt: data.onboarded_at,
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

export function validateProfile(profile: UserProfile): void {
  const inRange = (value: number | null, low: number, high: number) => value === null || (Number.isInteger(value) && value >= low && value <= high);
  const keys = profile.programs.map(programKey);
  if (profile.programs.length > MAX_PROGRAMS || new Set(keys).size !== keys.length || !profile.programs.every(validProgram)) {
    throw new Error('대학과 학과를 확인해 주세요.');
  }
  if (!inRange(profile.year, 1, 6) || !inRange(profile.semester, 1, 2)) throw new Error('학년과 학기를 확인해 주세요.');
  if (profile.enrollmentStatus !== null && !(ENROLLMENT as readonly string[]).includes(profile.enrollmentStatus)) throw new Error('재학 상태를 확인해 주세요.');
  if (profile.militaryService !== null && !(MILITARY as readonly string[]).includes(profile.militaryService)) throw new Error('병역 상태를 확인해 주세요.');
}

export async function saveProfile(client: SupabaseClient, userId: string, profile: UserProfile): Promise<void> {
  validateProfile(profile);
  const { error } = await client.from('user_profiles').upsert({
    user_id: userId, programs: profile.programs, year: profile.year, semester: profile.semester,
    enrollment_status: profile.enrollmentStatus, military_service: profile.militaryService,
    onboarded_at: profile.onboardedAt, updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id' });
  if (error) throw error;
}
