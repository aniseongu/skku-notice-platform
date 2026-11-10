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

/** 짧은 이유 한 문장: 앞의 이름 표기와 뒤따르는 규정 설명은 떼고 첫 문장만 남긴다. */
export function shortReason(text: string): string {
  return text.replace(/^[^:：]{1,20}[:：]\s*/, '').split(/(?<=[요다])\.\s+/)[0].replace(/\.$/, '').trim();
}

/** 이유: 안 맞는 항목이 있으면 그것, 확인 못 한 항목이 있으면 그것, 아니면 판정 문장. */
export function reasonOf(track: Track): string {
  const fail = track.checks.find((c) => c.result === 'fail');
  if (track.status === 'NOT_ELIGIBLE' && fail) return shortReason(fail.note);
  const unknown = track.checks.find((c) => c.result === 'unknown');
  if ((track.status === 'NEEDS_REVIEW' || track.status === 'CONDITIONAL') && unknown) return shortReason(unknown.note);
  return shortReason(track.label);
}

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
/** 새 요청은 insert, 이미 있으면 update로 다시 요청한다. 사용자는 요청 열만 쓸 수 있어서 upsert는 권한 오류(403)가 난다. */
export async function requestGraduation(client: SupabaseClient, userId: string, noticeId: string): Promise<void> {
  const table = 'user_notice_graduation_assessments';
  const requestedAt = new Date().toISOString();
  let { error } = await client.from(table).insert({ user_id: userId, notice_id: noticeId, status: 'PENDING', requested_at: requestedAt });
  if (error?.code === '23505') {
    ({ error } = await client.from(table).update({ status: 'PENDING', requested_at: requestedAt }).eq('user_id', userId).eq('notice_id', noticeId));
  }
  if (error) throw error;
}

const SW = { college: '소프트웨어융합대학', department: '소프트웨어학과' };
/** 소프트웨어학과가 원전공이면 졸업요건 확인을 보여 준다. 복수전공은 인턴십이 졸업평가 항목이 아니다. */
export const isSoftwareOriginal = (profile: Pick<UserProfile, 'programs'>): boolean =>
  profile.programs[0]?.college === SW.college && profile.programs[0]?.department === SW.department;

/** 공지에서 보여 줄 판정. 이미 채운 요건과 고르지 않은 3품 영역은 숨긴다. */
export interface VisibleTracks { dept: boolean; p3: boolean }
export function visibleTracks(profile: Pick<UserProfile, 'programs' | 'deptInternshipDone' | 'university3pInternshipDone' | 'university3pInternshipSelected'>): VisibleTracks {
  return {
    dept: isSoftwareOriginal(profile) && profile.deptInternshipDone !== true,
    p3: profile.university3pInternshipDone !== true && profile.university3pInternshipSelected !== false,
  };
}

/** 신3품 인턴십 질문의 답: 채웠어요 / 아직 안 채웠어요 / 이 영역은 안 해요. 아직 답하지 않았으면 null. */
export type ThreePAnswer = 'done' | 'todo' | 'no';
export function threePAnswer(value: { university3pInternshipDone: boolean | null; university3pInternshipSelected: boolean | null }): ThreePAnswer | null {
  if (value.university3pInternshipDone === true) return 'done';
  if (value.university3pInternshipSelected === false) return 'no';
  return value.university3pInternshipSelected === true ? 'todo' : null;
}
export function threePFields(answer: ThreePAnswer): { university3pInternshipDone: boolean; university3pInternshipSelected: boolean } {
  return { university3pInternshipDone: answer === 'done', university3pInternshipSelected: answer !== 'no' };
}

/** 학교 글에서 인턴 공고가 아닌 행정 안내(서류 제출, 인증 신청 절차, 졸업 안내 등). */
const ADMIN_TITLE = /서류|제출|절차|인증|졸업|수료|설명회|결과|발표|지침|이수|교과목|학점\s*인정/;
/** 회사 이름이 들어 있다는 표시(법인 표기). */
const COMPANY_MARK = /㈜|\(주\)|주식회사|유한회사|재단법인|사단법인|\(재\)|\b(?:Inc|Corp|Co\.|Ltd)/i;
/** 졸업요건을 확인할 인턴 공고만 대상이다. 외부 채용 소스는 모두, 학교 글은 인턴 모집 공고(회사 이름이 있는 글)만이다.
 *  서류 제출·인증 신청 절차 같은 안내는 제외한다. DB의 is_graduation_candidate_notice와 같은 규칙이다. */
export function isInternshipNotice(notice: { title: string; source_id?: string }, external: boolean): boolean {
  if (external) return true;
  const careerBoard = notice.source_id === 'skku-career-intern';
  if (!careerBoard && !/인턴|현장\s*실습/.test(notice.title)) return false;
  if (ADMIN_TITLE.test(notice.title)) return false;
  return careerBoard || COMPANY_MARK.test(notice.title);
}

/** 목록 표지: 내가 채워야 할 요건에 이 공고가 맞는지. */
export type GraduationBadge = 'ok' | 'review' | 'no';
export const BADGE_LABEL: Record<GraduationBadge, string> = { ok: '졸업요건 충족', review: '열어서 졸업요건 확인', no: '졸업요건 미달' };
export interface GraduationStatuses { dept: Status | null; p3: Status | null }

/** 보이는 영역의 판정을 하나로 합친다. 아직 판정이 없으면(현장실습 모집처럼 열어서 봐야 알 수 있는 공고) review. 하나라도 가능하면 ok, 아니면 확인 필요가 있으면 review, 모두 안 맞으면 no. */
export function badgeOf(statuses: GraduationStatuses | undefined, tracks: VisibleTracks): GraduationBadge | null {
  if (!statuses) return 'review';
  const shown = [tracks.dept ? statuses.dept : null, tracks.p3 ? statuses.p3 : null].filter((v): v is Status => v !== null && v !== 'NOT_APPLICABLE');
  if (!shown.length) return null;
  if (shown.some((v) => v === 'LIKELY' || v === 'CONDITIONAL')) return 'ok';
  return shown.some((v) => v === 'NEEDS_REVIEW') ? 'review' : 'no';
}

/** 내 판정 결과의 요약만 한 번에 읽는다(목록 표지와 "졸업요건 충족만 보기"에 쓴다). */
export async function loadGraduationStatuses(client: SupabaseClient, userId: string): Promise<Map<string, GraduationStatuses>> {
  const { data, error } = await client.from('user_notice_graduation_assessments').select('notice_id,department,university_3p')
    .eq('user_id', userId).eq('status', 'READY').limit(1000);
  if (error) throw error;
  const read = (value: unknown): Status | null => {
    const status = (value as { status?: unknown } | null)?.status;
    return STATUSES.includes(status as Status) ? status as Status : null;
  };
  return new Map((data ?? []).map((row) => [String(row.notice_id), { dept: read(row.department), p3: read(row.university_3p) }]));
}

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
