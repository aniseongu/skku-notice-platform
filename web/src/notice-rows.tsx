import { createRoot, type Root } from 'react-dom/client';
import { cleanTitle, deadlinePassed, deadlineText, daysLeft, safeUrl, VERDICT_LABEL, type Notice, type Verdict } from './data';

export interface NoticeRowModel {
  notice: Notice;
  source: string;
  read: boolean;
  saved: boolean;
  current: boolean;
  selected: boolean;
  dim: boolean;
  interests: string[];
  ai: { verdict: Verdict; reason: string } | null;
  rule: string | null;
}
export interface NoticeRowsModel {
  rows: NoticeRowModel[];
  today: string;
  selecting: boolean;
  savedView: boolean;
  open: (event: MouseEvent, notice: Notice) => void;
  toggleSelection: (id: string) => void;
}

function Reason({ row }: { row: NoticeRowModel }) {
  if (row.interests.length) return <span className="reason"><b className="interest">관심 {row.interests.join(', ')}</b>{row.ai && row.ai.verdict !== 'not_relevant' ? row.ai.reason : ''}</span>;
  if (row.ai) return <span className={`reason ${row.ai.verdict}`}><b>{VERDICT_LABEL[row.ai.verdict]}</b>{row.ai.reason}</span>;
  return row.rule ? <span className="reason rule"><b>기준</b>{row.rule}</span> : null;
}

function NoticeRows({ model }: { model: NoticeRowsModel }) {
  return <ol className="rows">{model.rows.map((row) => {
    const n = row.notice;
    const title = cleanTitle(n.title_ko || n.title);
    const tags = [n.category, n.pinned ? '고정' : '', n.changed_at ? '수정됨' : '', !model.savedView && row.saved ? '저장함' : ''].filter(Boolean).join(', ');
    const passed = n.deadline ? deadlinePassed(n.deadline) : false;
    const urgent = !!n.deadline && !passed && daysLeft(n.deadline, model.today) <= 3;
    return <li key={n.id} className={model.selecting ? 'batch-row' : ''}>
      {model.selecting ? <label className="selection-check"><input type="checkbox" aria-label={`${title} 선택`} checked={row.selected}
        onChange={() => model.toggleSelection(n.id)} /></label> : null}
      <a className={`row ${row.dim ? 'dim' : ''} ${row.read ? 'read' : 'unread'}`} href={safeUrl(n.url)} target="_blank" rel="noopener"
        data-id={n.id} aria-current={row.current ? 'true' : 'false'} onClick={(event) => model.open(event.nativeEvent, n)}>
        <span className="visually-hidden">{row.read ? '읽은 공지' : '읽지 않은 공지'}</span>
        <span className="meta"><span className="board">{row.source}</span>{tags ? <span className="cat" title={tags}>{tags}</span> : null}</span>
        <span className="title">{title}</span><span className="sub"><Reason row={row} /></span>
        {n.deadline ? <span className={`dday ${urgent ? 'urgent' : ''} ${passed ? 'ended' : ''}`}>{deadlineText(n.deadline, model.today)}</span> : null}
      </a>
    </li>;
  })}</ol>;
}

class NoticeRowsElement extends HTMLElement {
  private root: Root | null = null;
  private current: NoticeRowsModel | null = null;
  set model(value: NoticeRowsModel) { this.current = value; this.renderReact(); }
  connectedCallback() { this.root = createRoot(this); this.renderReact(); }
  disconnectedCallback() { this.root?.unmount(); this.root = null; }
  private renderReact() { if (this.root && this.current) this.root.render(<NoticeRows model={this.current} />); }
}
customElements.define('notice-rows-screen', NoticeRowsElement);
