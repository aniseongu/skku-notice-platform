// 소프트웨어학과 인턴십 졸업요건과 학교 신3품 인턴십 판정을 읽고 요청한다. 판정은 OCI 워커가 만들고(src/skku_notice/grad_intern_*),
// 이 모듈은 본인 행만 읽고 "확인 요청"만 쓴다. 결과를 "인정"이라고 말하지 않는다(최종 인증은 학과와 학교가 한다).
import type { SupabaseClient } from '@supabase/supabase-js';
import type { UserProfile } from './profile.ts';

export type Status = 'LIKELY' | 'CONDITIONAL' | 'NEEDS_REVIEW' | 'NOT_ELIGIBLE' | 'NOT_APPLICABLE';
const STATUSES: readonly Status[] = ['LIKELY', 'CONDITIONAL', 'NEEDS_REVIEW', 'NOT_ELIGIBLE', 'NOT_APPLICABLE'];

/** 색만으로 구분하지 않도록 글자로도 보여 준다. */
export const STATUS_TEXT: Record<Status, string> = {
  LIKELY: '가능성 높음', CONDITIONAL: '조건부 가능', NEEDS_REVIEW: '확인 필요', NOT_ELIGIBLE: '어려울 수 있음', NOT_APPLICABLE: '해당 없음',
};

export interface Check { ruleId: string; result: 'pass' | 'fail' | 'unknown'; note: string }
export interface Track { status: Status; label: string; checks: Check[]; unknowns: string[]; afterCompletion: string[]; notes: string[] }
export interface Facts { organizationName: string | null; workMode: string; startDate: string | null; endDate: string | null; hours: number | null; taskCategory: string; missing: string[] }
export interface GraduationAssessment {
  state: 'pending' | 'ready';
  aiStatus: 'used' | 'no_key' | 'unavailable' | 'limit' | null;
  department: Track | null;
  university3p: Track | null;
  facts: Facts | null;
}

/** 수행 후에 확인하는 요건. 공고만으로는 통과로 표시하지 않는다. */
export const AFTER_COMPLETION: Record<string, string> = {
  'DEPT-EVALUATION': '수행 기관 평가 60점 이상(60점 미만이면 미수행으로 봐요)',
  'DEPT-WORK-COMMITTEE': '수행 내용이 IT·SW 교육에 맞는지 졸업평가위원회 심의',
  'DEPT-COMPANY-DOCS': '출근부, 수행 평가표, 주간·종합 보고서, 수행 확인서 제출',
  'DEPT-LAB-DOCS': '출근부, 수행 평가표, 월간·종합 보고서, 수행 확인서(학과장 도장과 책임교수 서명)',
  'DEPT-DEADLINE': '졸업 학기 종강 뒤 14일 안에 수행 증명서 제출',
  'DEPT-OTHER-APPROVAL': '수행하기 전에 신청서를 내고 졸업평가위원회 심의',
  '3P-EVIDENCE': '근무기간이 적히고 기관장 직인이 찍힌 경력증명서',
  '3P-APPLICATION': '챌린지스퀘어에서 교외이수비교과 승인 신청 뒤 3품 인턴십 인증 신청',
};

const text = (value: unknown, max = 200): string => (typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max) : '');
const list = (value: unknown, max = 12): string[] => (Array.isArray(value) ? value.map((v) => text(v)).filter(Boolean).slice(0, max) : []);

function parseTrack(value: unknown): Track | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  const status = row.status as Status;
  if (!STATUSES.includes(status)) return null;
  const checks = Array.isArray(row.checks) ? row.checks.flatMap((c): Check[] => {
    const item = c as Record<string, unknown> | null;
    return item && ['pass', 'fail', 'unknown'].includes(item.result as string) && text(item.note)
      ? [{ ruleId: text(item.rule_id, 40), result: item.result as Check['result'], note: text(item.note) }] : [];
  }).slice(0, 12) : [];
  return { status, label: text(row.label), checks, unknowns: list(row.unknowns), afterCompletion: list(row.after_completion), notes: list(row.notes) };
}

export function parseAssessment(row: Record<string, unknown> | null): GraduationAssessment | null {
  if (!row) return null;
  const facts = row.facts && typeof row.facts === 'object' ? row.facts as Record<string, unknown> : null;
  const ai = row.ai_status;
  return {
    state: row.status === 'READY' && row.department ? 'ready' : 'pending',
    aiStatus: ai === 'used' || ai === 'no_key' || ai === 'unavailable' || ai === 'limit' ? ai : null,
    department: parseTrack(row.department), university3p: parseTrack(row.university_3p),
    facts: facts ? {
      organizationName: text(facts.organization_name, 80) || null, workMode: text(facts.work_mode, 20),
      startDate: text(facts.start_date, 10) || null, endDate: text(facts.end_date, 10) || null,
      hours: Number.isInteger(facts.explicitly_stated_hours) ? facts.explicitly_stated_hours as number : null,
      taskCategory: text(facts.task_category, 30), missing: list(facts.missing_fields),
    } : null,
  };
}

const COLUMNS = 'status,ai_status,department,university_3p,facts';

export async function loadGraduation(client: SupabaseClient, userId: string, noticeId: string): Promise<GraduationAssessment | null> {
  const { data, error } = await client.from('user_notice_graduation_assessments').select(COLUMNS).eq('user_id', userId).eq('notice_id', noticeId).maybeSingle();
  if (error) throw error;
  return parseAssessment(data as Record<string, unknown> | null);
}

/** 확인을 요청한다(다시 확인도 같다). 결과는 워커가 채우고, 같은 입력이면 저장된 결과를 다시 쓴다. */
export async function requestGraduation(client: SupabaseClient, userId: string, noticeId: string): Promise<void> {
  const { error } = await client.from('user_notice_graduation_assessments')
    .upsert({ user_id: userId, notice_id: noticeId, status: 'PENDING', requested_at: new Date().toISOString() }, { onConflict: 'user_id,notice_id' });
  if (error) throw error;
}

const SW = { college: '소프트웨어융합대학', department: '소프트웨어학과' };
/** 소프트웨어학과가 원전공이면 졸업요건 확인을 보여 준다. 복수전공은 인턴십이 졸업평가 항목이 아니다. */
export const isSoftwareOriginal = (profile: Pick<UserProfile, 'programs'>): boolean =>
  profile.programs[0]?.college === SW.college && profile.programs[0]?.department === SW.department;

/** 인턴 공고만 대상이다: 외부 채용 소스, 학교 취업 인턴 게시판, 제목에 인턴·현장실습이 있는 글. */
export const isInternshipNotice = (notice: { title: string; source_id?: string }, external: boolean): boolean =>
  external || notice.source_id === 'skku-career-intern' || /인턴|현장\s*실습/.test(notice.title);

/** 학과에 문의할 때 붙여 넣을 질문. 개인 정보는 넣지 않는다. */
export function inquiryText(title: string, facts: Facts | null): string {
  const known = facts ? [
    facts.organizationName ? `근무기관 ${facts.organizationName}` : '',
    facts.taskCategory && facts.taskCategory !== 'unknown' ? '담당 업무는 공고의 모집 직무 기준' : '',
    facts.workMode === 'full_time' ? '전일제' : facts.workMode === 'part_time' ? '파트타임' : '',
    facts.startDate && facts.endDate ? `근무기간 ${facts.startDate}~${facts.endDate}` : '',
    facts.hours ? `총 ${facts.hours}시간` : '',
  ].filter(Boolean).join(', ') : '';
  return `「${title}」 인턴십이 소프트웨어학과 졸업평가 인턴십(졸업평가 지침 제28조) 기준에 맞는지 확인 부탁드립니다.`
    + `${known ? ` 공고에는 ${known}으로 적혀 있습니다.` : ''} 법인 설립 여부, 실제 담당 SW 업무, 전일제·파트타임 여부와 근무시간을 확인해 주세요.`;
}
