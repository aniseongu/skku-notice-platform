// 공지 상세의 "졸업요건 확인". 서버가 수집할 때 미리 판정해 두고, 이 화면은 결과를 글로만 보여 준다(버튼 없음).
// 영역 이름, 판정 키워드(되면 초록·안 되면 빨강), 이유가 한 문단에 이어진다. 색만으로 구분하지 않도록 판정도 글로 쓴다.
import { useState } from 'react';
import { STATUS_TEXT, displayStatus, reasonOf, type GraduationAssessment, type Track, type VisibleTracks } from './graduation-assessment';

export interface GraduationModel {
  tracks: VisibleTracks;
  assessment: GraduationAssessment | null;
  error: string;
}

// 업체 이름(Gemini 등)이 아니라 "AI 키"라고 쓴다. 그리고 "공고 내용만 봤다"고만 쓰면 무엇을 못 봤는지 모르니, AI가 해 주는 일(담당 업무 확인)을 못 했다고 말한다.
const AI_NOTE = {
  no_key: 'AI 키를 연결하면 담당 업무까지 확인해요',
  unavailable: 'AI가 응답하지 않아 담당 업무는 확인하지 못했어요. 잠시 뒤 다시 확인해요',
  limit: '오늘 AI 사용 한도를 다 써서 담당 업무는 확인하지 못했어요. 내일 다시 확인해요',
} as const;

const WORK_MODE: Record<string, string> = { full_time: '전일제', part_time: '파트타임' };
/** 판정에 쓴 공고 내용. "무엇을 보고 판단했는지"가 보여야 믿을 수 있다. 읽은 것이 없으면 빈 문자열이다. */
function readFacts(facts: GraduationAssessment['facts']): string {
  if (!facts) return '';
  const period = facts.startDate && facts.endDate ? `근무 기간 ${facts.startDate} ~ ${facts.endDate}` : '';
  return [facts.organizationName, period, WORK_MODE[facts.workMode], facts.hours ? `근무 시간 ${facts.hours}시간` : ''].filter(Boolean).join(' · ');
}

// 목록의 "해당 / 확인 필요 / 해당 없음"(reason.tsx)과 같은 모양: 되면 강조색 굵게, 확인은 주황 굵게, 안 되면 굵지 않은 옅은 회색(이유도 같이 옅게).
const KEYWORD: Record<string, string> = {
  LIKELY: 'font-semibold text-accent',
  CONDITIONAL: 'font-semibold text-soon',
  NEEDS_REVIEW: 'font-semibold text-soon',
  NOT_ELIGIBLE: 'font-normal text-ink-3',
  NOT_APPLICABLE: 'font-normal text-ink-3',
};
const MUTED = new Set(['NOT_ELIGIBLE', 'NOT_APPLICABLE']);

/** "3품 인턴십 가능" 키워드 바로 옆에 이유가 이어지는 한 문단. */
function Result({ name, track }: { name: string; track: Track }) {
  const display = displayStatus(track);
  return <p className={`m-0 mb-[8px] text-[14px] leading-[21px] [word-break:keep-all] ${MUTED.has(display) ? 'text-ink-3' : 'text-ink-2'}`} data-status={display}>
    <b className={`mr-[6px] ${KEYWORD[display] ?? 'font-semibold text-ink-2'}`}>{name} {STATUS_TEXT[display]}</b><span aria-hidden className="mr-[6px] text-ink-3">·</span>{reasonOf(track)}
  </p>;
}

export function GraduationSection({ model }: { title: string; model: GraduationModel }) {
  const { assessment, error } = model;
  const ready = assessment?.state === 'ready' ? assessment : null;
  return <section className="detail-section grad" aria-labelledby="sec-grad">
    <h3 id="sec-grad">인턴십 요건 확인</h3>
    {!ready && !error ? <p className="m-0 text-[14px] leading-[21px] text-ink-3" role="status">내 인턴십 요건에 맞는지 확인하고 있어요</p> : null}
    {ready ? <>
      {model.tracks.p3 && ready.university3p ? <Result name="3품 인턴십" track={ready.university3p} /> : null}
      {model.tracks.dept && ready.department ? <Result name="솦 인턴십" track={ready.department} /> : null}
    </> : null}
    {error ? <p className="field-note error" role="alert">{error}</p> : null}
  </section>;
}

/** 안내문은 결과 옆이 아니라 공지 맨 아래(글 정보 다음)에 작고 옅게 둔다(Toss: 읽는 흐름을 끊지 않는 보조 안내). 판정이 나온 뒤에만 보인다.
 *  평소에는 면책 한 줄과 "판정 기준" 단추만 보이고, 기준 두 줄은 눌러서 펼친다(휴대폰에서 길어지지 않게). */
export function GraduationNotes({ model }: { model: GraduationModel }) {
  const [open, setOpen] = useState(false);
  const ready = model.assessment?.state === 'ready' ? model.assessment : null;
  if (!ready) return null;
  const hasP3 = model.tracks.p3 && !!ready.university3p;
  const hasDept = model.tracks.dept && !!ready.department;
  return <div className="mt-[16px] text-[12px] leading-[18px] text-ink-2 [word-break:keep-all]" aria-label="인턴십 요건 안내">
    <p className="m-0">공고에 적힌 근무 기간과 시간으로 대략 판단해요. 실제 인정 여부는 학교와 학과에 확인해 주세요{hasP3 || hasDept
      // 글자는 문장 끝에 붙고, 눌리는 영역은 위아래 여백으로 44px를 채운다(줄 높이는 그대로).
      ? <button type="button" aria-expanded={open} aria-controls="grad-criteria" onClick={() => setOpen((value) => !value)}
          className="ml-[6px] inline cursor-pointer border-0 bg-transparent p-0 py-[13px] -my-[13px] text-[12px] leading-[18px] font-medium text-ink-3 underline underline-offset-2">판정 근거 {open ? '접기' : '보기'}</button>
      : null}</p>
    {open ? <div id="grad-criteria" className="mt-[8px]">
      {readFacts(ready.facts) ? <p className="m-0">공고에서 읽은 내용: {readFacts(ready.facts)}</p> : null}
      {ready.facts?.missing.length ? <p className="m-0">공고에 없어 확인하지 못한 내용: {ready.facts.missing.join(', ')}</p> : null}
      {hasP3 ? <p className="m-0">3품은 근무 시간이 280시간 이상인지 확인해요</p> : null}
      {hasDept ? <p className="m-0">솦은 소프트웨어 업무인지와 근무 기간·시간을 확인해요</p> : null}
    </div> : null}
    {ready.aiStatus && ready.aiStatus !== 'used' ? <p className="m-0 mt-[12px] text-ink-3" role="status">{AI_NOTE[ready.aiStatus]}</p> : null}
  </div>;
}
