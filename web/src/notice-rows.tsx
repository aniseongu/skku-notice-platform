import { createRoot, type Root } from 'react-dom/client';
import { cleanTitle, deadlinePassed, deadlineText, daysLeft, safeUrl, type Notice, type Verdict } from './data';
import { Reason } from './reason';
import type { GraduationBadge } from './graduation-assessment';

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
  grad?: GraduationBadge | null;
}
export interface NoticeRowsModel {
  rows: NoticeRowModel[];
  today: string;
  selecting: boolean;
  savedView: boolean;
  open: (event: MouseEvent, notice: Notice) => void;
  toggleSelection: (id: string) => void;
}

// 줄 배치: 휴대폰은 [메타 | D-day] > 제목 > 판정, 720px부터는 [메타 열 120px] [제목과 판정] [D-day 48px].
export const ROW_LAYOUT = 'grid grid-cols-[minmax(0,1fr)_auto] [grid-template-areas:"meta_dday""title_title""reason_reason"] gap-x-[12px] gap-y-[2px] px-[16px] py-[14px] text-inherit no-underline min-[720px]:grid-cols-[120px_minmax(0,1fr)_48px] min-[720px]:gap-x-[24px] min-[720px]:px-[24px] min-[720px]:py-[12px]';
// 선택 모드: 체크박스 자리를 줄 왼쪽에 36px 만들고 열 사이 간격을 줄여, 분류·제목 열이 평소와 같은 자리에 있게 한다.
const ROW_LAYOUT_SELECTING = ROW_LAYOUT.replace('min-[720px]:grid-cols-[120px_minmax(0,1fr)_48px]', 'min-[720px]:grid-cols-[108px_minmax(0,1fr)_48px]').replace('min-[720px]:px-[24px]', 'min-[720px]:pl-[36px] min-[720px]:pr-[24px]');
const DESKTOP_AREAS = 'min-[720px]:[grid-template-areas:"meta_title_dday"_"meta_reason_dday"]';
const DESKTOP_AREAS_NO_REASON = 'min-[720px]:[grid-template-areas:"meta_title_dday"]';

const META = '[grid-area:meta] flex min-w-0 flex-wrap gap-[6px] text-[13px] leading-[18px] font-medium text-ink-3 min-[720px]:flex-col min-[720px]:flex-nowrap min-[720px]:gap-0 min-[720px]:pt-[2px]';
const META_SPAN = 'min-w-0 max-w-full [overflow-wrap:anywhere] min-[720px]:overflow-hidden min-[720px]:text-ellipsis min-[720px]:whitespace-nowrap';

function NoticeRows({ model }: { model: NoticeRowsModel }) {
  return <ol className="rows">{model.rows.map((row, index) => {
    const n = row.notice;
    const title = cleanTitle(n.title_ko || n.title);
    const tags = [n.category, n.pinned ? '고정' : '', n.changed_at ? '수정됨' : '', !model.savedView && row.saved ? '저장함' : ''].filter(Boolean).join(', ');
    const passed = n.deadline ? deadlinePassed(n.deadline) : false;
    const urgent = !!n.deadline && !passed && daysLeft(n.deadline, model.today) <= 3;
    const hasReason = row.interests.length > 0 || !!row.ai || !!row.rule || !!row.grad;
    const bg = model.selecting && row.selected ? 'bg-[color-mix(in_oklch,var(--accent)_12%,var(--surface))] shadow-[inset_3px_0_0_var(--accent)]' : row.current && !model.selecting ? 'bg-sunken' : row.read ? 'bg-read' : 'bg-surface';
    const hover = row.current ? '' : 'min-[720px]:hover:bg-hover';
    const border = index > 0 ? 'border-t border-line' : 'min-[720px]:border-t min-[720px]:border-line';
    const ddayColor = urgent ? 'text-danger' : row.read ? 'text-ink-2' : passed ? 'text-ink-3' : '';
    const ddayWeight = row.read ? 'font-semibold' : passed ? 'font-medium' : 'font-bold';
    return <li key={n.id} className={model.selecting ? 'batch-row' : ''}>
      {model.selecting ? <label className="selection-check"><input type="checkbox" aria-label={`${title} 선택`} checked={row.selected}
        onChange={() => model.toggleSelection(n.id)} /></label> : null}
      <a className={`row ${row.dim ? 'dim' : ''} ${row.read ? 'read' : 'unread'} ${model.selecting ? ROW_LAYOUT_SELECTING : ROW_LAYOUT} ${hasReason ? DESKTOP_AREAS : DESKTOP_AREAS_NO_REASON} ${border} ${bg} ${hover} active:bg-sunken focus-visible:outline-offset-[-2px]`} href={safeUrl(n.url)} target="_blank" rel="noopener"
        data-id={n.id} aria-current={row.current ? 'true' : 'false'} onClick={(event) => model.open(event.nativeEvent, n)}>
        <span className="visually-hidden">{row.read ? '읽은 공지' : '읽지 않은 공지'}</span>
        <span className={`meta ${META}`}><span className={`board ${META_SPAN} ${row.read ? '' : 'min-[720px]:text-ink-2 min-[720px]:font-semibold'}`}>{row.source}</span>{tags ? <span className={`cat ${META_SPAN}`} title={tags}>{tags}</span> : null}</span>
        <span className={`title [grid-area:title] line-clamp-2 text-[16px] leading-[23px] min-[720px]:text-[15px] min-[720px]:leading-[22px] ${row.read ? 'font-normal text-ink-2' : 'font-semibold'} ${n.deadline ? 'mt-[4px] min-[720px]:mt-0' : ''}`}>{title}</span>
        <span className="sub [grid-area:reason] mt-[2px] text-[14px] leading-[20px] text-ink-2 empty:hidden min-[720px]:mt-0 min-[720px]:overflow-hidden min-[720px]:text-[13px] min-[720px]:leading-[19px] min-[720px]:text-ellipsis min-[720px]:whitespace-nowrap"><Reason interests={row.interests} ai={row.ai} rule={row.rule} read={row.read} grad={row.grad} /></span>
        {n.deadline ? <span className={`dday ${urgent ? 'urgent' : ''} ${passed ? 'ended' : ''} [grid-area:dday] self-center text-[14px] leading-[18px] tabular-nums min-[720px]:self-start min-[720px]:pt-[2px] min-[720px]:text-right ${ddayWeight} ${ddayColor}`}>{deadlineText(n.deadline, model.today)}</span> : null}
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
