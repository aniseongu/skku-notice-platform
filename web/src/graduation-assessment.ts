// 소프트웨어학과 인턴십 졸업요건과 학교 신3품 인턴십 판정을 읽고 요청한다. 판정은 OCI 워커가 만들고(src/skku_notice/grad_intern_*),
// 이 모듈은 본인 행만 읽고 "확인 요청"만 쓴다. 결과를 "인정"이라고 말하지 않는다(최종 인증은 학과와 학교가 한다).
import type { SupabaseClient } from '@supabase/supabase-js';
import type { UserProfile } from './profile.ts';
import type { WorkPeriod } from './keyword-match.ts';

export type Status = 'LIKELY' | 'CONDITIONAL' | 'NEEDS_REVIEW' | 'NOT_ELIGIBLE' | 'NOT_APPLICABLE';
const STATUSES: readonly Status[] = ['LIKELY', 'CONDITIONAL', 'NEEDS_REVIEW', 'NOT_ELIGIBLE', 'NOT_APPLICABLE'];

/** 색만으로 구분하지 않도록 글자로도 보여 준다. */
export const STATUS_TEXT: Record<Status, string> = {
  LIKELY: '가능', CONDITIONAL: '확인 필요', NEEDS_REVIEW: '확인 필요', NOT_ELIGIBLE: '어려움', NOT_APPLICABLE: '해당 없음',
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
  'DEPT-WORK-COMMITTEE': '수행 내용이 IT·SW 분야에 맞는지 졸업평가위원회 심의',
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

/** 학과 요건의 직무 근거 한 문장: 여러 직무 중 어떤 직무가 소프트웨어와 관련 있어 보이는지 이름으로 말한다. 맞지 않는 경우(이유로 이미 보임)는 비운다. */
export function jobNote(track: Track): string {
  const work = track.checks.find((c) => c.ruleId === 'DEPT-WORK');
  if (!work || work.result === 'fail') return '';
  return shortReason(work.note.replace(/\([^)]*\)\s*$/, ''));
}

/** 화면에 쓰는 단계. 확인할 게 남지 않고 통과한 검사만 있으면 "조건부"(승인·증빙은 수행 뒤 확인)여도 "가능"으로 보여 준다. */
export function displayStatus(track: Track): Status {
  const passed = track.checks.some((c) => c.result === 'pass');
  const open = track.checks.some((c) => c.result !== 'pass');
  return track.status === 'CONDITIONAL' && passed && !open ? 'LIKELY' : track.status;
}

/** 이유: 안 맞는 항목이 있으면 그것, 확인 못 한 항목이 있으면 그것, 통과했으면 통과한 근거, 아니면 판정 문장. */
export function reasonOf(track: Track): string {
  const fail = track.checks.find((c) => c.result === 'fail');
  if (track.status === 'NOT_ELIGIBLE' && fail) return shortReason(fail.note);
  const unknown = track.checks.find((c) => c.result === 'unknown');
  if ((track.status === 'NEEDS_REVIEW' || track.status === 'CONDITIONAL') && unknown) return shortReason(unknown.note);
  // 가능이라고 말한 뒤의 이유는 같은 말을 되풀이하지 않고 근거(기간·시간 기준)를 보인다. 없으면 통과한 첫 검사.
  if (displayStatus(track) === 'LIKELY') {
    const passes = track.checks.filter((c) => c.result === 'pass');
    const pass = passes.find((c) => /-(FT|PT)$|TIME|HOURS/.test(c.ruleId)) ?? passes[0];
    if (pass) return shortReason(pass.note.replace(/\([^)]*\)\s*$/, ''));
  }
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

/** 신3품 인턴십 질문의 답: 채웠어요 / 아직이에요 / 안 해요. 아직 답하지 않았으면 null. */
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
/** 졸업요건을 확인할 인턴 공고만 대상이다. 외부 채용 소스는 모두, 학교 글은 제목에 인턴·현장실습이 있는 모집 공고다.
 *  회사 이름에 (주)가 붙는 일은 드물어서 법인 표기는 요구하지 않고, 서류 제출·인증 신청 절차 같은 안내만 제외한다. DB의 is_graduation_candidate_notice와 같은 규칙이다. */
export function isInternshipNotice(notice: { title: string; source_id?: string }, external: boolean): boolean {
  if (external) return true;
  const careerBoard = notice.source_id === 'skku-career-intern';
  if (!careerBoard && !/인턴|현장\s*실습/.test(notice.title)) return false;
  if (ADMIN_TITLE.test(notice.title)) return false;
  return true;
}

/** 목록 표지: 내가 채워야 할 요건에 이 공고가 맞는지. */
export type GraduationBadge = 'ok' | 'review' | 'no';
export interface GraduationStatuses { dept: Status | null; p3: Status | null; period?: WorkPeriod }

/** 보이는 영역의 판정을 하나로 합친다. 아직 판정이 없으면(현장실습 모집처럼 열어서 봐야 알 수 있는 공고) review. 하나라도 가능하면 ok, 아니면 확인 필요가 있으면 review, 모두 안 맞으면 no. */
export function badgeOf(statuses: GraduationStatuses | undefined, tracks: VisibleTracks): GraduationBadge | null {
  if (!statuses) return 'review';
  const shown = [tracks.dept ? statuses.dept : null, tracks.p3 ? statuses.p3 : null].filter((v): v is Status => v !== null && v !== 'NOT_APPLICABLE');
  if (!shown.length) return null;
  if (shown.some((v) => v === 'LIKELY' || v === 'CONDITIONAL')) return 'ok';
  return shown.some((v) => v === 'NEEDS_REVIEW') ? 'review' : 'no';
}

/** 목록·상세 머리에 적는 졸업요건 결과. 영역마다 "3품 인턴십 충족", "솦 인턴십 미달"처럼 한 묶음으로 적고,
 *  "해당"이나 "졸업 충족"을 따로 적지 않는다(학교에서는 소프트웨어학과를 솦이라고 줄여 부른다).
 *  정보가 되는 것만 적는다: 확인 필요·해당 없음(NOT_APPLICABLE)은 적지 않고, 이 학생과 관련 없다고(해당 없음) 이미 판정한 글에도 적지 않는다. */
export interface GradPart { key: 'p3' | 'dept'; name: string; met: boolean }
export const TRACK_NAME = { p3: '3품 인턴십', dept: '솦 인턴십' } as const;
export function gradParts(statuses: GraduationStatuses | undefined, tracks: VisibleTracks, verdict?: string | null): GradPart[] {
  if (!statuses || verdict === 'not_relevant') return [];
  const parts: GradPart[] = [];
  for (const key of ['p3', 'dept'] as const) {
    if (!tracks[key]) continue;
    const status = statuses[key];
    if (status === 'LIKELY' || status === 'CONDITIONAL') parts.push({ key, name: TRACK_NAME[key], met: true });
    else if (status === 'NOT_ELIGIBLE') parts.push({ key, name: TRACK_NAME[key], met: false });
  }
  return parts;
}

/** 내 판정 결과의 요약만 한 번에 읽는다(목록 표지와 "인턴십 충족만 보기"에 쓴다). */
export async function loadGraduationStatuses(client: SupabaseClient, userId: string): Promise<Map<string, GraduationStatuses>> {
  const { data, error } = await client.from('user_notice_graduation_assessments').select('notice_id,department,university_3p,facts')
    .eq('user_id', userId).eq('status', 'READY').limit(1000);
  if (error) throw error;
  // 상세와 같은 기준(displayStatus)으로 읽는다: 조건부라도 확인할 것이 남았으면 확인 필요, 통과한 검사뿐이면 가능.
  const read = (value: unknown): Status | null => {
    const raw = value as { status?: unknown; checks?: unknown } | null;
    if (!STATUSES.includes(raw?.status as Status)) return null;
    if (raw?.status !== 'CONDITIONAL') return raw?.status as Status;
    const results = Array.isArray(raw.checks) ? raw.checks.map((c) => (c as { result?: unknown } | null)?.result) : [];
    return results.length > 0 && results.every((r) => r === 'pass') ? 'LIKELY' : 'NEEDS_REVIEW';
  };
  const period = (value: unknown): WorkPeriod | undefined => {
    const facts = value as { start_date?: unknown; end_date?: unknown; duration_days?: unknown } | null;
    if (!facts) return undefined;
    const text = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
    return { start: text(facts.start_date), end: text(facts.end_date), days: typeof facts.duration_days === 'number' ? facts.duration_days : null };
  };
  return new Map((data ?? []).map((row) => [String(row.notice_id), { dept: read(row.department), p3: read(row.university_3p), period: period(row.facts) }]));
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
