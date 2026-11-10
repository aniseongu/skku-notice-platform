// 공지 상세의 "졸업요건 확인". 학과 졸업 인턴십과 학교 신3품 인턴십을 따로 보여 주고, 공고만으로 알 수 없는 것은 "수행 뒤 확인"으로 둔다.
import { useState } from 'react';
import { AFTER_COMPLETION, STATUS_TEXT, inquiryText, type GraduationAssessment, type Track } from './graduation-assessment';

export interface GraduationModel {
  assessment: GraduationAssessment | null;
  busy: boolean;
  error: string;
  request: () => void;
  hasKey: boolean;
}

const MARK = { pass: '✓', fail: '✕', unknown: '?' } as const;
const MARK_TEXT = { pass: '확인됨', fail: '기준에 안 맞음', unknown: '확인 못 함' } as const;
const AI_NOTE = {
  no_key: 'Gemini 키가 없어서 공고에 적힌 표기만 읽었어요. 설정에서 키를 넣으면 담당 업무까지 살펴봐요',
  unavailable: 'Gemini가 잠시 응답하지 않아 공고에 적힌 표기만 읽었어요. 다시 확인하면 이어서 살펴봐요',
  limit: '오늘 Gemini 사용 한도를 다 써서 공고에 적힌 표기만 읽었어요. 내일 다시 확인해 주세요',
} as const;

function TrackBlock({ name, track }: { name: string; track: Track }) {
  const afterCompletion = track.afterCompletion.map((id) => AFTER_COMPLETION[id]).filter(Boolean);
  return <div className="grad-track" data-status={track.status}>
    <p className="grad-head"><b>{name}</b><span className="grad-badge">{STATUS_TEXT[track.status]}</span></p>
    {track.label ? <p className="grad-label">{track.label}</p> : null}
    {track.checks.length ? <ul className="grad-checks">{track.checks.map((check, index) => <li key={`${check.ruleId}-${index}`}>
      <span className="grad-mark" aria-hidden="true">{MARK[check.result]}</span><span className="visually-hidden">{MARK_TEXT[check.result]}: </span>{check.note}</li>)}</ul> : null}
    {track.notes.map((note, index) => <p className="detail-note" key={index}>{note}</p>)}
    {track.status !== 'NOT_APPLICABLE' && afterCompletion.length ? <>
      <p className="grad-sub">수행한 뒤에 확인해요</p>
      <ul className="grad-after">{afterCompletion.map((text) => <li key={text}>{text}</li>)}</ul>
    </> : null}
  </div>;
}

export function GraduationSection({ title, model }: { title: string; model: GraduationModel }) {
  const { assessment, busy, error } = model;
  const [copied, setCopied] = useState(false);
  const pending = assessment?.state === 'pending';
  const ready = assessment?.state === 'ready' ? assessment : null;
  const copy = async () => {
    try { await navigator.clipboard.writeText(inquiryText(title, ready?.facts ?? null)); setCopied(true); setTimeout(() => setCopied(false), 2500); }
    catch { setCopied(false); }
  };
  return <section className="detail-section grad" aria-labelledby="sec-grad">
    <h3 id="sec-grad">졸업요건 확인</h3>
    {!assessment ? <>
      <p className="detail-note first">소프트웨어학과 졸업평가 인턴십과 학교 신3품 인턴십에 맞는지 공고를 기준으로 살펴봐요. 최종 인정은 학과와 학교가 해요</p>
      {!model.hasKey ? <p className="detail-note">Gemini 키가 없으면 공고에 적힌 표기만 읽어서 확인 필요가 많아요</p> : null}
      <button type="button" className="solid-button" disabled={busy} onClick={model.request}>{busy ? '요청하고 있어요' : '졸업요건 확인하기'}</button>
    </> : null}
    {pending ? <p className="detail-note first" role="status">확인하고 있어요. 최대 10분 걸리고, 이 화면을 닫아도 돼요</p> : null}
    {ready ? <>
      {ready.department ? <TrackBlock name="학과 졸업 인턴십" track={ready.department} /> : null}
      {ready.university3p ? <TrackBlock name="학교 신3품 인턴십" track={ready.university3p} /> : null}
      {ready.facts?.missing.length ? <p className="detail-note">공고에서 못 찾은 것: {ready.facts.missing.join(', ')}</p> : null}
      {ready.aiStatus && ready.aiStatus !== 'used' ? <p className="detail-note" role="status">{AI_NOTE[ready.aiStatus]}</p> : null}
      <p className="detail-note">근거: 소프트웨어학과 졸업평가 지침 제28~31조(2025-06-01 시행), 학교 신3품 인턴십 안내. 공고만으로는 인정을 확정할 수 없어요</p>
      <div className="inline">
        <button type="button" className="ghost-button" disabled={busy} onClick={model.request}>{busy ? '요청하고 있어요' : '다시 확인하기'}</button>
        <button type="button" className="ghost-button" onClick={() => { void copy(); }}>{copied ? '복사했어요' : '학과 문의용 질문 복사'}</button>
      </div>
    </> : null}
    {error ? <p className="field-note error" role="alert">{error}</p> : null}
  </section>;
}
