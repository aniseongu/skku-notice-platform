import { Reason } from './reason';
import { createRoot, type Root } from 'react-dom/client';
import { cleanTitle, deadlineDetail, deadlinePassed, deadlineText, daysLeft, koreanDate, safeUrl, type Notice, type NoticeBody, type Verdict } from './data';
import { useState } from 'react';
import type { GradPart } from './graduation-assessment';
import { GraduationNotes, GraduationSection, type GraduationModel } from './graduation-assessment-view';
import { DETAIL_SECTION, IMAGE_MISSING_CLASS, SECTION_TITLE } from './cls';
import { cleanHtml, fileType, IMAGE_MISSING, replaceBrokenImage } from './rich';

export interface NoticeDetailModel {
  notice: Notice;
  source: string;
  today: string;
  body: NoticeBody | null | 'loading';
  /** 내 Gemini 키로 만든 요약(없으면 null) */
  mySummary?: string | null;
  summarizing?: boolean;
  summaryError?: string;
  makeSummary?: () => void;
  interests: string[];
  ai: { verdict: Verdict; reason: string } | null;
  rule: string | null;
  notified: boolean;
  retry: () => void;
  /** 소프트웨어학과 원전공이 인턴 공고를 열었을 때만 있다. */
  graduation?: GraduationModel;
  grad?: GradPart[];
}

/** 그림의 대체 텍스트: 자동으로 읽은 글이 있으면 앞부분을 함께 알려 준다. */
function imageAlt(index: number, body: NoticeBody): string {
  const text = (body.ocr_text ?? []).flatMap((chunk) => chunk.split(/\n+/)).map((line) => line.trim()).filter(Boolean).join(' ');
  return text ? `본문 그림 ${index + 1}. 자동으로 읽은 글: ${text.slice(0, 120)}` : `본문 그림 ${index + 1}`;
}

/** innerHTML 그림의 error는 React가 못 보므로 직접 capture로 받는다. 같은 함수라 중복 등록되지 않는다. */
function watchBrokenImages(node: HTMLDivElement | null) {
  node?.addEventListener('error', replaceBrokenImage, true);
}

/** React가 관리하는 그림: DOM을 바꾸지 않고 상태로 안내 글을 보여 준다. */
function BodyImage({ src, alt }: { src: string; alt: string }) {
  const [broken, setBroken] = useState(false);
  if (broken) return <span className={IMAGE_MISSING_CLASS}>{IMAGE_MISSING}</span>;
  return <img className="block max-w-full h-auto m-0 mb-[12px] rounded-sm bg-sunken" src={src} alt={alt} loading="lazy" referrerPolicy="no-referrer" onError={() => setBroken(true)} />;
}

/** 글자가 거의 없는(줄표뿐인) 본문은 본문이 없는 것으로 본다. 그림을 보여 준다. */
const readable = (text: string | null | undefined): boolean => (text ?? '').replace(/<[^>]*>/g, '').replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, ' ').match(/[0-9A-Za-z가-힣]/g)?.length! >= 3;

const NOTE = 'mt-[20px] text-[13px] leading-[19px] text-ink-3';
const NOTE_FIRST = 'm-0 mb-[10px] text-[13px] leading-[19px] text-ink-3';
const NOTE_BODY = 'm-0 mb-[10px] text-[13px] leading-[19px] text-ink-2 whitespace-pre-line';
const BODY_P = 'm-0 mb-[10px] text-[15px] leading-[26px] text-ink whitespace-pre-line';
const SUMMARY_P = 'm-0 mb-[4px] text-[15px] leading-[24px]';
const FACT = 'grid grid-cols-[56px_1fr] gap-[12px] py-[4px] text-[13px] leading-[19px] text-ink-2';
const FACT_DT = 'font-medium text-ink-3';
const RICH = 'rich text-[15px] leading-[26px] text-ink [overflow-wrap:anywhere] [&_p]:m-0 [&_p]:mb-[10px] [&_p]:whitespace-pre-line [&_h3]:text-ink-3 [&_img]:bg-sunken [&_:is(h1,h2,h3,h4)]:mt-[16px] [&_:is(h1,h2,h3,h4)]:mb-[8px] [&_:is(h1,h2,h3,h4)]:text-[15px] [&_:is(h1,h2,h3,h4)]:leading-[22px] [&_:is(h1,h2,h3,h4)]:font-bold [&_:is(ul,ol)]:m-0 [&_:is(ul,ol)]:mb-[10px] [&_:is(ul,ol)]:pl-[20px] [&_a]:text-accent [&_img]:block [&_img]:max-w-full [&_img]:h-auto [&_img]:m-0 [&_img]:mb-[12px] [&_img]:rounded-sm [&_hr]:border-0 [&_hr]:border-t [&_hr]:border-line [&_hr]:my-[16px] [&_blockquote]:m-0 [&_blockquote]:mb-[10px] [&_blockquote]:p-0 [&_blockquote]:pl-[12px] [&_blockquote]:text-ink-2 [&_table]:block [&_table]:max-w-full [&_table]:overflow-x-auto [&_table]:m-0 [&_table]:mb-[12px] [&_table]:border-collapse [&_table]:text-[13px] [&_table]:leading-[19px] [&_:is(th,td)]:px-[8px] [&_:is(th,td)]:py-[6px] [&_:is(th,td)]:border [&_:is(th,td)]:border-line [&_:is(th,td)]:align-top [&_:is(th,td)]:text-left [&_th]:bg-sunken [&_th]:font-semibold';

function Body({ body: rawBody, heading = '본문' }: { body: NoticeBody; heading?: string }) {
  const empty = !readable(rawBody.body) && !readable(rawBody.body_html);
  const body: NoticeBody = empty ? { ...rawBody, body: '', body_html: null } : rawBody;
  if (!body.body && !body.body_html && !body.images?.length && body.body_status !== 'ready') {
    const status = body.body_status ?? (body.fetched_at ? 'ready' : 'pending');
    const messages = { pending: '본문을 준비하고 있어요. 원문은 바로 열 수 있어요', retrying: '본문을 다시 가져올게요. 원문은 바로 열 수 있어요', unavailable: '본문을 가져오지 못했어요. 나중에 다시 확인할게요. 원문은 바로 열 수 있어요', ready: '본문에 내용이 없어요. 원문에서 확인해 주세요' };
    return <p className={NOTE} role="status">{messages[status]}</p>;
  }
  if (body.body_html && !body.body_from_image) return <section className={`${DETAIL_SECTION} body-text`} aria-label={heading}>
    <h3 className={SECTION_TITLE}>{heading}</h3><div className={RICH} ref={watchBrokenImages} dangerouslySetInnerHTML={{ __html: cleanHtml(body.body_html) }} />
  </section>;
  const paragraphs = (body.body ?? '').split(/\n+/).filter(Boolean);
  const images = (body.images ?? []).map(safeUrl).filter((url) => url !== '#');
  if (!paragraphs.length && !images.length) return <p className={NOTE}>본문에 글자가 없어요. '원문 열기'에서 확인해 주세요</p>;
  // 글자가 없고 그림만 있으면 빈 "본문" 제목을 달지 않고 그림만 보여 준다.
  return <section className={`${DETAIL_SECTION} body-text`} aria-label={paragraphs.length ? '본문' : '본문 그림'}>
    {paragraphs.length ? <h3 className={SECTION_TITLE}>{body.body_from_image ? `${heading} (그림에서 읽은 글)` : heading}</h3> : null}
    {body.body_from_image && paragraphs.length > 0 ? <p className={NOTE_BODY}>그림 속 글자를 자동으로 읽어서 틀릴 수 있어요. 아래 그림과 원문이 정확해요</p> : null}
    {paragraphs.map((para, index) => <p className={BODY_P} key={index}>{para}</p>)}
    {images.map((src, index) => <BodyImage key={`${src}-${index}`} src={src} alt={imageAlt(index, body)} />)}
  </section>;
}

function NoticeDetail({ model }: { model: NoticeDetailModel }) {
  const { notice, body, ai, interests } = model;
  const loaded = body === 'loading' ? null : body;
  const summary = model.mySummary || loaded?.summary || null;
  const title = cleanTitle(notice.title_ko || notice.title);
  const passed = notice.deadline ? deadlinePassed(notice.deadline) : false;
  const urgent = !!notice.deadline && !passed && daysLeft(notice.deadline, model.today) <= 3;
  // 인턴십 충족 표시는 아래 "인턴십 요건 확인" 한 곳에서만 말한다(제목 아래와 구역에서 같은 말을 두 번 하지 않는다). 목록 줄에는 구역이 없어 그대로 둔다.
  const hasReason = interests.length > 0 || !!ai || !!model.rule;
  return <div className="detail min-[1080px]:px-[32px] min-[1080px]:py-[24px]">
    <p className="meta flex min-w-0 flex-wrap gap-[6px] mb-[6px] text-[13px] leading-[18px] font-medium text-ink-3"><span className="min-w-0 max-w-full [overflow-wrap:anywhere]">{model.source}</span>{notice.category ? <span className="min-w-0 max-w-full [overflow-wrap:anywhere]">{notice.category}</span> : null}</p>
    <h2 className="detail-title text-[20px] leading-[28px] font-bold tracking-[-0.02em]" title={title}>{title}</h2>
    {notice.title_ko ? <p className="detail-original mt-[4px] text-[13px] leading-[19px] text-ink-3" lang="en">{cleanTitle(notice.title)}</p> : null}
    {hasReason ? <p className="detail-reason mt-[10px] text-[14px] leading-[21px] text-ink-2"><Reason interests={interests} ai={ai} rule={model.rule} /></p> : null}
    {notice.deadline ? <p className="detail-deadline mt-[6px] text-[14px] leading-[21px] font-semibold tabular-nums">{notice.deadline_kind ?? '마감'} {deadlineDetail(notice.deadline)} <span className={`dday ${urgent ? 'urgent' : ''} ${passed ? 'ended' : ''} ml-[6px] text-[14px] leading-[18px] tabular-nums ${passed ? 'font-medium' : 'font-bold'} ${urgent ? 'text-danger' : passed ? 'text-ink-3' : ''}`}>{deadlineText(notice.deadline, model.today)}</span></p> : null}
    {notice.changed_at ? <p className="detail-change mt-[4px] text-[13px] leading-[19px] text-ink-2">{koreanDate(notice.changed_at.slice(0, 10))}에 원문 {notice.change_kind === '제목' ? '제목이' : '본문이'} 바뀌었어요</p> : null}
    {summary ? <section className={`${DETAIL_SECTION} summary`} aria-labelledby="sec-summary"><h3 id="sec-summary" className={SECTION_TITLE}>요약</h3>{summary.split('\n').filter(Boolean).map((line, index) => <p className={SUMMARY_P} key={index}>{line}</p>)}</section>
      : model.summarizing ? <section className={DETAIL_SECTION} aria-labelledby="sec-summary"><h3 id="sec-summary" className={SECTION_TITLE}>요약</h3><p className={NOTE_FIRST} role="status">요약을 만들고 있어요</p></section>
      : model.summaryError && model.makeSummary ? <section className={DETAIL_SECTION} aria-labelledby="sec-summary"><h3 id="sec-summary" className={SECTION_TITLE}>요약</h3><p className={NOTE_FIRST} role="status">{model.summaryError}</p><button type="button" className="text-button self-start px-0 py-[10px] border-0 bg-transparent text-ink-2 text-[14px] font-semibold underline underline-offset-[3px]" onClick={model.makeSummary}>다시 만들기</button></section>
      : loaded?.summary_status === 'failed' ? <section className={DETAIL_SECTION} aria-labelledby="sec-summary"><h3 id="sec-summary" className={SECTION_TITLE}>요약</h3><p className={NOTE_FIRST} role="status">요약을 만들지 못했어요. 나중에 다시 만들어 볼게요</p></section> : null}
    {model.graduation ? <GraduationSection title={title} model={model.graduation} /> : null}
    {body === 'loading' ? <p className={NOTE}>본문을 불러오고 있어요</p> : !loaded ? <><p className={NOTE} role="status">본문을 불러오지 못했어요. 다시 불러오거나 원문을 확인해 주세요</p><button type="button" className="text-button self-start px-0 py-[10px] border-0 bg-transparent text-ink-2 text-[14px] font-semibold underline underline-offset-[3px]" onClick={model.retry}>본문 다시 불러오기</button></>
      : loaded.translation?.body ? <><section className={`${DETAIL_SECTION} body-text`} aria-label="한국어로 옮긴 본문"><h3 className={SECTION_TITLE}>본문 (한국어로 옮긴 글)</h3><p className={NOTE_BODY}>Gemini 번역이에요. 정확한 내용은 아래 영어 원문을 확인해 주세요</p>{loaded.translation.body.split(/\n+/).filter(Boolean).map((para, index) => <p className={BODY_P} key={index}>{para}</p>)}</section><div className="original-body" lang="en"><Body body={loaded} heading="영어 원문" /></div></> : <Body body={loaded} />}
    {/* 그림에서 읽은 글은 판정에만 쓰고 화면에는 보이지 않는다(틀린 글자가 섞여 있고 그림이 더 정확하다). */}
    {loaded?.attachments?.length ? <section className={DETAIL_SECTION} aria-labelledby="sec-files"><h3 id="sec-files" className={SECTION_TITLE}>첨부 {loaded.attachments.length}개</h3><ul className="attachments m-0 p-0 list-none [&>li+li]:border-t [&>li+li]:border-line">{loaded.attachments.map((file, index) => <li key={index}><a className="file flex items-center gap-[10px] min-h-[48px] text-[14px] text-ink no-underline" href={safeUrl(file.url)} target="_blank" rel="noopener"><span className="file-type flex-none min-w-[40px] px-0 py-[2px] border border-line rounded-[4px] text-[11px] font-semibold text-center text-ink-2">{fileType(file.name, file.type)}</span><span className="file-name flex-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">{file.name}</span>{file.size ? <span className="file-size flex-none text-[12px] text-ink-3 tabular-nums">{file.size}</span> : null}</a></li>)}</ul><p className={NOTE_FIRST}>누르면 학교 공지 사이트의 원본 파일을 받아요</p></section> : null}
    <dl className="facts m-0 mt-[24px] border-t border-line pt-[4px]" aria-label="글 정보"><div className={FACT}><dt className={FACT_DT}>게시일</dt><dd className="m-0">{koreanDate(notice.posted_on)}</dd></div>
      {notice.previous_title ? <div className={FACT}><dt className={FACT_DT}>이전 제목</dt><dd className="m-0">{cleanTitle(notice.previous_title)}</dd></div> : null}
      {interests.length ? <div className={FACT}><dt className={FACT_DT}>관심</dt><dd className="m-0"><b className="interest font-semibold text-accent">{interests.join(', ')}</b></dd></div> : null}
      {model.notified ? <div className={FACT}><dt className={FACT_DT}>알림</dt><dd className="m-0">알림을 보냈어요</dd></div> : null}</dl>
    {model.graduation ? <GraduationNotes model={model.graduation} /> : null}
  </div>;
}
class NoticeDetailElement extends HTMLElement {
  private root: Root | null = null;
  private current: NoticeDetailModel | null = null;
  set model(value: NoticeDetailModel) { this.current = value; this.renderReact(); }
  connectedCallback() { this.root = createRoot(this); this.renderReact(); }
  disconnectedCallback() { this.root?.unmount(); this.root = null; }
  private renderReact() { if (this.root && this.current) this.root.render(<NoticeDetail model={this.current} />); }
}
customElements.define('notice-detail-screen', NoticeDetailElement);
