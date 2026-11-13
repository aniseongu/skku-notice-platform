import { createRoot, type Root } from 'react-dom/client';
import { cleanTitle, deadlinePassed, deadlineText, daysLeft, safeUrl, type Notice, type Verdict } from './data';
import { Reason } from './reason';
import type { GradPart } from './graduation-assessment';
import { CHECKBOX } from './cls';

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
  grad?: GradPart[];
  /** AI 판정 전(키가 있는 사용자의 새 공지). 줄이 비어 보이지 않게 "판정 중"을 적는다. */
  pending?: boolean;
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
// 선택 모드: 체크박스 자리를 줄 왼쪽에 48px 만들어(체크칸이 제목 글자와 같은 왼쪽 선에 오게) 열 사이 간격을 줄여, 분류·제목 열이 평소와 같은 자리에 있게 한다.
const ROW_LAYOUT_SELECTING = ROW_LAYOUT.replace('min-[720px]:grid-cols-[120px_minmax(0,1fr)_48px]', 'min-[720px]:grid-cols-[106px_minmax(0,1fr)_48px]').replace('px-[16px]', 'pl-0 pr-[16px]').replace('min-[720px]:gap-x-[24px]', 'min-[720px]:gap-x-[12px]').replace('min-[720px]:px-[24px]', 'min-[720px]:pl-[50px] min-[720px]:pr-[24px]');
const DESKTOP_AREAS = 'min-[720px]:[grid-template-areas:"meta_title_dday"_"meta_reason_dday"]';
const DESKTOP_AREAS_NO_REASON = 'min-[720px]:[grid-template-areas:"meta_title_dday"]';

// 메타(게시판·분류)는 보조 정보라 Regular(400)·연한 색(토스 목록 규칙). 읽은 공지 제목(400)보다 굵으면 위계가 뒤집힌다.
const META = '[grid-area:meta] flex min-w-0 flex-wrap gap-[6px] text-[13px] leading-[18px] font-normal text-ink-3 min-[720px]:flex-col min-[720px]:flex-nowrap min-[720px]:gap-0 min-[720px]:pt-[2px]';
const META_SPAN = 'min-w-0 max-w-full [overflow-wrap:anywhere] min-[720px]:overflow-hidden min-[720px]:text-ellipsis min-[720px]:whitespace-nowrap';

function NoticeRows({ model }: { model: NoticeRowsModel }) {
  return <ol className="rows m-0 list-none overflow-hidden bg-surface p-0 min-[720px]:rounded-none min-[720px]:bg-transparent">{model.rows.map((row, index) => {
    const n = row.notice;
    const title = cleanTitle(n.title_ko || n.title);
    const tags = [n.category, n.pinned ? '고정' : '', n.changed_at ? '수정됨' : '', !model.savedView && row.saved ? '저장함' : ''].filter(Boolean).join(', ');
    const passed = n.deadline ? deadlinePassed(n.deadline) : false;
    const urgent = !!n.deadline && !passed && daysLeft(n.deadline, model.today) <= 3;
    const hasReason = row.interests.length > 0 || !!row.ai || !!row.rule || (row.grad?.length ?? 0) > 0 || !!row.pending;
    const bg = model.selecting && row.selected ? 'bg-sunken' : row.current ? 'bg-sunken' : row.read ? 'bg-read' : 'bg-surface';
    const hover = row.current ? '' : 'min-[720px]:hover:bg-hover';
    const border = index > 0 ? 'border-t border-line' : 'min-[720px]:border-t min-[720px]:border-line';
    const ddayColor = urgent ? 'text-danger' : row.read ? 'text-ink-2' : passed ? 'text-ink-3' : '';
    const ddayWeight = row.read ? 'font-semibold' : passed ? 'font-medium' : 'font-bold';
    // 선택 칸의 면(휴대폰): 고른 줄과 열린 줄은 짙게, 읽은 줄은 읽은 줄 면, 눌린 줄은 짙게. 넓은 화면은 칸이 줄 위에 겹쳐 면이 없다.
    const checkBg = row.selected || row.current ? 'max-[719px]:bg-sunken' : row.read ? 'max-[719px]:bg-read' : 'max-[719px]:bg-transparent';
    return <li key={n.id} className={model.selecting ? 'batch-row flex items-stretch bg-surface min-[720px]:relative max-[719px]:[&:has(.row:active)_.selection-check]:bg-sunken' : ''}>
      {model.selecting ? <label className={`selection-check box-border grid min-h-[44px] w-[42px] flex-none cursor-pointer [place-items:center_start] pl-[var(--gutter)] min-[720px]:absolute min-[720px]:inset-y-0 min-[720px]:left-0 min-[720px]:z-[1] min-[720px]:w-[48px] min-[720px]:bg-transparent! min-[720px]:pl-[24px] ${checkBg} ${index > 0 ? 'border-t border-line' : ''}`}><input className={CHECKBOX} type="checkbox" aria-label={`${title} 선택`} checked={row.selected}
        onChange={() => model.toggleSelection(n.id)} /></label> : null}
      <a className={`row ${row.dim ? 'dim' : ''} ${row.read ? 'read' : 'unread'} ${model.selecting ? `${ROW_LAYOUT_SELECTING} min-w-0 flex-1` : ROW_LAYOUT} ${hasReason ? DESKTOP_AREAS : DESKTOP_AREAS_NO_REASON} ${border} ${bg} ${hover} active:bg-sunken focus-visible:outline-offset-[-2px]`} href={safeUrl(n.url)} target="_blank" rel="noopener"
        data-id={n.id} aria-current={row.current ? 'true' : 'false'} onClick={(event) => model.open(event.nativeEvent, n)}>
        <span className="visually-hidden">{row.read ? '읽은 공지' : '읽지 않은 공지'}</span>
        <span className={`meta ${META}`}>{row.source ? <span className={`board ${META_SPAN} ${row.read ? '' : 'min-[720px]:text-ink-2 min-[720px]:font-semibold'}`}>{row.source}</span> : null}{tags ? <span className={`cat ${META_SPAN}`} title={tags}>{tags}</span> : null}</span>
        <span className={`title [grid-area:title] line-clamp-2 text-[16px] leading-[23px] min-[720px]:text-[15px] min-[720px]:leading-[22px] ${row.read ? 'font-normal text-ink-2' : 'font-semibold'} ${n.deadline ? 'mt-[4px] min-[720px]:mt-0' : ''}`}>{title}</span>
        <span className="sub [grid-area:reason] mt-[2px] text-[14px] leading-[20px] text-ink-2 empty:hidden min-[720px]:mt-0 min-[720px]:overflow-hidden min-[720px]:text-[13px] min-[720px]:leading-[19px] min-[720px]:text-ellipsis min-[720px]:whitespace-nowrap"><Reason interests={row.interests} ai={row.ai} rule={row.rule} read={row.read} grad={row.grad} pending={row.pending} /></span>
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
