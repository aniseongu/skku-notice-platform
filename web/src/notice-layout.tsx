import type { ReactNode } from 'react';
import { TABS, type AppController } from './app-controller';
import { APP_NAME } from './brand';
import { HEADER_ICON_BUTTON } from './cls';
import { Empty } from './empty';
import type { IconName, Notice } from './data';

export const DESKTOP_GRID = 'min-[720px]:grid min-[720px]:h-[calc(100dvh-var(--wco-h))] min-[720px]:grid-cols-[248px_minmax(0,1fr)]';
export const THREE_COLUMNS = 'min-[1080px]:grid-cols-[248px_minmax(0,680px)_minmax(400px,1fr)]';
export const SHARED_COLUMNS = 'min-[720px]:max-[1079px]:grid-cols-[minmax(120px,20%)_minmax(0,1fr)_minmax(0,1.3fr)]';

export const Icon = ({ name }: { name: IconName }) => <svg className="i size-[22px] flex-none fill-none stroke-current [stroke-width:1.75] [stroke-linecap:round] [stroke-linejoin:round]" aria-hidden="true"><use href={`icons/sprite.svg#${name}`} /></svg>;
export const Brand = ({ className = 'brand-mark' }: { className?: string }) => <svg className={className} aria-hidden="true"><use href="icons/sprite.svg#brand" /></svg>;

export const TOPBAR = 'pane-head topbar glass sticky top-[var(--wco-h)] z-[2] flex items-center gap-[4px] border-b border-line pt-[calc(10px_+_env(safe-area-inset-top))] pr-[4px] pb-[10px] pl-[var(--gutter)] select-none [-webkit-user-select:none] min-[720px]:top-0 min-[720px]:h-[var(--head-h)] min-[720px]:flex-none min-[720px]:gap-[8px] min-[720px]:px-[24px] min-[720px]:py-0';
// 사이드바(PC 전용) 항목. 현재 항목은 aria-current=page로 표시한다.
export const SIDE_ITEM = 'flex items-center justify-between gap-[8px] min-h-[40px] px-[12px] py-0 border-0 rounded-sm text-[15px] font-medium text-left select-none [-webkit-user-select:none] [@media(pointer:coarse)]:min-h-[44px]';
export const SIDE_ITEM_IDLE = 'bg-transparent [@media(hover:hover)]:hover:bg-hover active:bg-hover';
const SIDE_ITEM_CURRENT = 'bg-sunken text-ink font-semibold [&_.i]:text-accent';

export function SideItem({ label, count, active, onClick, shortcut, ariaLabel, icon }: {
  label: string; count: number | null; active: boolean; onClick: () => void; shortcut?: string; ariaLabel?: string; icon?: IconName;
}) {
  return <button type="button" className={`side-item ${SIDE_ITEM} ${active ? SIDE_ITEM_CURRENT : `text-ink-2 ${SIDE_ITEM_IDLE}`}`} aria-current={active ? 'page' : 'false'} onClick={onClick}
    aria-label={ariaLabel} aria-keyshortcuts={shortcut} title={shortcut ? `${label} (${shortcut})` : undefined}>
    <span className="side-label flex min-w-0 items-center gap-[10px] [&_.i]:h-[20px] [&_.i]:w-[20px]">{icon ? <Icon name={icon} /> : null}<span className="overflow-hidden text-ellipsis whitespace-nowrap">{label}</span></span>{count === null ? null : <span className="count text-[14px] text-ink-3 tabular-nums">{count}</span>}</button>;
}

export function NoticeSidebar({ tabs, active, counts = {}, onPick, shortcuts = false, children }: {
  tabs: typeof TABS;
  active: (typeof TABS)[number]['id'] | null;
  counts?: Record<string, number | null>;
  onPick: (id: (typeof TABS)[number]['id']) => void;
  shortcuts?: boolean;
  children?: ReactNode;
}) {
  return <aside className="sidebar hidden border-r border-line bg-mica px-[12px] pt-0 pb-[12px] min-[720px]:flex min-[720px]:min-h-0 min-[720px]:flex-col min-[720px]:overflow-y-auto" aria-label="탐색">
    <div className="pane-head brand min-[720px]:-mx-[12px] min-[720px]:mt-0 min-[720px]:mb-[12px] min-[720px]:flex min-[720px]:h-[var(--head-h)] min-[720px]:flex-none min-[720px]:items-center min-[720px]:gap-[8px] min-[720px]:border-b min-[720px]:border-line min-[720px]:px-[24px] min-[720px]:text-[17px] min-[720px]:font-bold min-[720px]:tracking-[-0.02em] min-[720px]:[&_.brand-mark]:text-accent min-[720px]:[&_.brand-mark]:size-[32px]"><Brand />{APP_NAME}</div>
    <nav className="side-group flex flex-col gap-[1px]" aria-label="보기">
      {tabs.map((tab) => <SideItem key={tab.id} label={tab.label} count={counts[tab.id] ?? null} active={active === tab.id}
        onClick={() => onPick(tab.id)} shortcut={shortcuts ? String(TABS.indexOf(tab) + 1) : undefined} icon={tab.icon} />)}
    </nav>
    {children}
  </aside>;
}

export function DesktopDetail({ shown, shared = false, header, children }: {
  shown: boolean; shared?: boolean; header?: ReactNode; children?: ReactNode;
}) {
  return <aside className={`detail-pane hidden min-[720px]:min-w-0 min-[720px]:min-h-0 min-[720px]:overflow-y-auto min-[1080px]:bg-bg ${shown ? shared ? 'min-[720px]:block min-[720px]:bg-bg' : 'min-[1080px]:block' : ''}`} aria-label="공지 상세">
    <div className={`pane-head detail-head min-[720px]:flex min-[720px]:h-[var(--head-h)] min-[720px]:flex-none min-[720px]:items-center min-[720px]:gap-[8px] min-[720px]:border-b min-[720px]:border-line min-[1080px]:justify-between min-[1080px]:pr-[32px] min-[1080px]:pl-[20px] min-[1080px]:[&_:is(.save-button,.share-button)]:size-[36px] [@media(pointer:coarse)]:min-[1080px]:[&_:is(.save-button,.share-button)]:size-[44px] min-[1080px]:[&_:is(.save-button,.share-button)]:rounded-md min-[1080px]:[&_.solid-button]:min-h-[36px] min-[1080px]:[&_.solid-button]:px-[14px] min-[1080px]:[&_.solid-button]:text-[14px] min-[1080px]:[&_.ghost-button]:min-h-[36px] min-[1080px]:[&_.ghost-button]:px-[14px] min-[1080px]:[&_.ghost-button]:text-[14px] ${shared ? 'min-[720px]:max-[1079px]:justify-between min-[720px]:max-[1079px]:px-[8px]' : ''}`}>
      {header}
    </div>
    {children}
  </aside>;
}

export function ReadingHeader({ onBack, actions, backLabel = '목록으로' }: { onBack: () => void; actions?: ReactNode; backLabel?: string }) {
  return <header className={TOPBAR}>
    <button type="button" className={`${HEADER_ICON_BUTTON} back -ml-[12px]`} aria-label={backLabel} onClick={onBack}><Icon name="back" /></button>
    {actions ? <Brand className="brand-mark mr-[4px] size-[28px] flex-none text-accent" /> : null}
    <div className="topbar-text min-w-0 flex-1 min-[720px]:min-w-[88px]"><h1 className="min-[720px]:text-[21px] min-[720px]:leading-[28px]">공지</h1></div>
    {actions}
  </header>;
}

/** 공유 단추: 휴대폰은 기기의 공유 창(카카오톡·메시지 등), 공유 창이 없는 PC 브라우저는 링크 복사 */
export function ShareButton({ app, notice }: { app: AppController; notice: Notice }) {
  return <button type="button" className="icon-button share-button grid place-items-center flex-none size-[44px] rounded-md border border-line bg-surface text-ink active:bg-hover disabled:text-ink-3 min-[720px]:size-[36px] min-[720px]:rounded-sm [@media(hover:hover)]:[&:hover:not(:disabled)]:bg-hover"
    aria-label="공유하기" title="공유하기" onClick={() => { void app.share(notice); }}><Icon name={app.linkCopied ? 'check' : 'share'} /></button>;
}

export function SaveButton({ app, notice, onSave }: { app: AppController; notice: Notice; onSave?: () => void }) {
  const saved = !onSave && app.isSaved(notice);
  return <button type="button" className="icon-button save-button grid place-items-center flex-none size-[44px] rounded-md border border-line bg-surface text-ink active:bg-sunken aria-pressed:bg-transparent aria-pressed:text-accent disabled:text-ink-3 min-[720px]:size-[36px] min-[720px]:rounded-sm [@media(hover:hover)]:[&:hover:not(:disabled)]:bg-hover" aria-pressed={saved}
    aria-label={saved ? '저장 지우기' : '저장하기'} title={onSave ? '저장하기' : saved ? '저장 지우기 (S)' : '저장하기 (S)'} aria-keyshortcuts={onSave ? undefined : 's'}
    onClick={onSave ?? (() => app.toggleSave(notice))}><Icon name={saved ? 'bookmark-on' : 'bookmark'} /></button>;
}

export function SharedNoticeEmpty({ failed, guest, onAction }: { failed?: boolean; guest?: boolean; onAction: () => void }) {
  return <Empty sectionLabel="공유 공지" title={failed ? '공지를 불러오지 못했어요' : '공지를 찾을 수 없어요'}
    body={failed ? '연결을 확인하고 다시 시도해 주세요' : '공지가 삭제됐거나 마감됐을 수 있어요'}
    action={guest ? failed ? '다시 불러오기' : '로그인하고 다른 공지 보기' : '목록으로 돌아가기'} onAction={onAction} />;
}
