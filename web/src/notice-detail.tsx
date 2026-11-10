import { Reason } from './reason';
import { createRoot, type Root } from 'react-dom/client';
import { cleanTitle, deadlineDetail, deadlinePassed, deadlineText, daysLeft, koreanDate, safeUrl, type Notice, type NoticeBody, type Verdict } from './data';
import { useState } from 'react';
import type { GraduationBadge } from './graduation-assessment';
import { GraduationSection, type GraduationModel } from './graduation-assessment-view';
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
  grad?: GraduationBadge | null;
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
  if (broken) return <span className="image-missing">{IMAGE_MISSING}</span>;
  return <img src={src} alt={alt} loading="lazy" referrerPolicy="no-referrer" onError={() => setBroken(true)} />;
}

/** 글자가 거의 없는(줄표뿐인) 본문은 본문이 없는 것으로 본다. 그림과 그림에서 읽은 글을 보여 준다. */
const readable = (text: string | null | undefined): boolean => (text ?? '').replace(/<[^>]*>/g, '').match(/[0-9A-Za-z가-힣]/g)?.length! >= 3;

function Body({ body: rawBody, heading = '본문' }: { body: NoticeBody; heading?: string }) {
  const empty = !readable(rawBody.body) && !readable(rawBody.body_html);
  const body: NoticeBody = empty ? { ...rawBody, body: '', body_html: null } : rawBody;
  if (!body.body && !body.body_html && !body.images?.length && body.body_status !== 'ready') {
    const status = body.body_status ?? (body.fetched_at ? 'ready' : 'pending');
    const messages = { pending: '본문을 준비하고 있어요. 원문은 바로 열 수 있어요', retrying: '본문을 다시 가져올게요. 원문은 바로 열 수 있어요', unavailable: '본문을 가져오지 못했어요. 나중에 다시 확인할게요. 원문은 바로 열 수 있어요', ready: '본문에 내용이 없어요. 원문에서 확인해 주세요' };
    return <p className="detail-note" role="status">{messages[status]}</p>;
  }
  if (body.body_html && !body.body_from_image) return <section className="detail-section body-text" aria-label={heading}>
    <h3>{heading}</h3><div className="rich" ref={watchBrokenImages} dangerouslySetInnerHTML={{ __html: cleanHtml(body.body_html) }} />
  </section>;
  const paragraphs = (body.body ?? '').split(/\n+/).filter(Boolean);
  const images = (body.images ?? []).map(safeUrl).filter((url) => url !== '#');
  if (!paragraphs.length && !images.length) return <p className="detail-note">본문에 글자가 없어요. '원문 열기'에서 확인해 주세요</p>;
  return <section className="detail-section body-text" aria-label="본문">
    <h3>{body.body_from_image ? `${heading} (그림에서 읽은 글)` : heading}</h3>
    {body.body_from_image && paragraphs.length > 0 ? <p className="detail-note first">그림 속 글자를 자동으로 읽어서 틀릴 수 있어요. 아래 그림과 원문이 정확해요</p> : null}
    {paragraphs.map((para, index) => <p key={index}>{para}</p>)}
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
  const hasReason = interests.length > 0 || !!ai || !!model.rule || !!model.grad;
  return <div className="detail">
    <p className="meta flex min-w-0 flex-wrap gap-[6px] mb-[6px] text-[13px] leading-[18px] font-medium text-ink-3"><span className="min-w-0 max-w-full [overflow-wrap:anywhere]">{model.source}</span>{notice.category ? <span className="min-w-0 max-w-full [overflow-wrap:anywhere]">{notice.category}</span> : null}</p>
    <h2 className="detail-title" title={title}>{title}</h2>
    {notice.title_ko ? <p className="detail-original" lang="en">{cleanTitle(notice.title)}</p> : null}
    {hasReason ? <p className="detail-reason"><Reason interests={interests} ai={ai} rule={model.rule} grad={model.grad} detail /></p> : null}
    {notice.deadline ? <p className="detail-deadline">{notice.deadline_kind ?? '마감'} {deadlineDetail(notice.deadline)} <span className={`dday ${urgent ? 'urgent' : ''} ${passed ? 'ended' : ''} ml-[6px] text-[14px] leading-[18px] tabular-nums ${passed ? 'font-medium' : 'font-bold'} ${urgent ? 'text-danger' : passed ? 'text-ink-3' : ''}`}>{deadlineText(notice.deadline, model.today)}</span></p> : null}
    {notice.changed_at ? <p className="detail-change">{koreanDate(notice.changed_at.slice(0, 10))}에 원문 {notice.change_kind === '제목' ? '제목이' : '본문이'} 바뀌었어요</p> : null}
    {summary ? <section className="detail-section summary" aria-labelledby="sec-summary"><h3 id="sec-summary">요약</h3>{summary.split('\n').filter(Boolean).map((line, index) => <p key={index}>{line}</p>)}</section>
      : model.summarizing ? <section className="detail-section" aria-labelledby="sec-summary"><h3 id="sec-summary">요약</h3><p className="detail-note first" role="status">요약을 만들고 있어요</p></section>
      : model.summaryError && model.makeSummary ? <section className="detail-section" aria-labelledby="sec-summary"><h3 id="sec-summary">요약</h3><p className="detail-note first" role="status">{model.summaryError}</p><button type="button" className="text-button" onClick={model.makeSummary}>다시 만들기</button></section>
      : loaded?.summary_status === 'failed' ? <section className="detail-section" aria-labelledby="sec-summary"><h3 id="sec-summary">요약</h3><p className="detail-note first" role="status">요약을 만들지 못했어요. 나중에 다시 만들어 볼게요</p></section> : null}
    {model.graduation ? <GraduationSection title={title} model={model.graduation} /> : null}
    {body === 'loading' ? <p className="detail-note">본문을 불러오고 있어요</p> : !loaded ? <><p className="detail-note" role="status">본문을 불러오지 못했어요. 다시 불러오거나 원문을 확인해 주세요</p><button type="button" className="text-button" onClick={model.retry}>본문 다시 불러오기</button></>
      : loaded.translation?.body ? <><section className="detail-section body-text" aria-label="한국어로 옮긴 본문"><h3>본문 (한국어로 옮긴 글)</h3><p className="detail-note first">Gemini 번역이에요. 정확한 내용은 아래 영어 원문을 확인해 주세요</p>{loaded.translation.body.split(/\n+/).filter(Boolean).map((para, index) => <p key={index}>{para}</p>)}</section><div className="original-body" lang="en"><Body body={loaded} heading="영어 원문" /></div></> : <Body body={loaded} />}
    {loaded?.ocr_text?.length ? <section className="detail-section body-text" aria-labelledby="sec-ocr">
      <h3 id="sec-ocr">그림에서 읽은 글</h3><p className="detail-note first">그림 속 글자를 자동으로 읽어서 틀릴 수 있어요. 그림과 원문이 정확해요</p>
      {loaded.ocr_text.flatMap((text) => text.split(/\n+/).filter(Boolean)).map((line, index) => <p key={index}>{line}</p>)}
    </section> : null}
    {loaded?.attachments?.length ? <section className="detail-section" aria-labelledby="sec-files"><h3 id="sec-files">첨부 {loaded.attachments.length}개</h3><ul className="attachments">{loaded.attachments.map((file, index) => <li key={index}><a className="file" href={safeUrl(file.url)} target="_blank" rel="noopener"><span className="file-type">{fileType(file.name, file.type)}</span><span className="file-name">{file.name}</span>{file.size ? <span className="file-size">{file.size}</span> : null}</a></li>)}</ul><p className="detail-note first">누르면 학교 공지 사이트의 원본 파일을 받아요</p></section> : null}
    <dl className="facts" aria-label="글 정보"><div><dt>게시일</dt><dd>{koreanDate(notice.posted_on)}</dd></div>
      {notice.previous_title ? <div><dt>이전 제목</dt><dd>{cleanTitle(notice.previous_title)}</dd></div> : null}
      {interests.length ? <div><dt>관심</dt><dd><b className="interest font-semibold text-accent">{interests.join(', ')}</b></dd></div> : null}
      {model.notified ? <div><dt>알림</dt><dd>알림을 보냈어요</dd></div> : null}</dl>
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
