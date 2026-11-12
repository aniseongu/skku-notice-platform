// 여러 화면이 같이 쓰는 Tailwind 클래스 묶음. Tailwind는 소스에서 완성된 문자열을 찾으므로 이어 붙이지 않고 통째로 적는다.

/** 상세의 구역(위 구분선) */
export const DETAIL_SECTION = 'detail-section mt-[20px] border-t border-line pt-[16px]';
/** 구역 제목(h3) */
export const SECTION_TITLE = 'm-0 mb-[8px] text-[13px] leading-[18px] font-semibold text-ink-3';
/** 본문에서 깨진 그림 자리에 보이는 안내 */
export const IMAGE_MISSING_CLASS = 'image-missing block mb-[12px] px-[14px] py-[12px] rounded-sm bg-sunken text-[13px] leading-[19px] text-ink-2';
/** 선택 모드의 체크 칸(input). 체크 표시는 base.css의 .check-mark가 그린다. */
export const CHECKBOX = 'check-mark relative m-0 size-[18px] flex-none cursor-pointer appearance-none rounded-sm border-[1.5px] border-ink-3 bg-transparent [transition:background-color_.12s,border-color_.12s] checked:border-ink checked:bg-ink indeterminate:border-ink indeterminate:bg-ink';

/** 오른쪽 화살표(›) */
/** 왼쪽 꺾쇠(되돌아가기). CHEVRON_RIGHT와 같은 크기와 굵기다. */
export const CHEVRON_LEFT = 'size-[8px] flex-none ml-[4px] border-b-[1.5px] border-l-[1.5px] border-ink-3 [transform:rotate(45deg)]';
/** 되돌아가기 줄의 왼쪽 꺾쇠. 눌리는 줄임을 보이도록 CHEVRON_LEFT보다 진하다. Tailwind는 완성된 이름만 찾으므로 문자열을 바꿔 만들지 않는다. */
export const CHEVRON_LEFT_STRONG = 'size-[8px] flex-none ml-[4px] border-b-[1.5px] border-l-[1.5px] border-ink-2 [transform:rotate(45deg)]';
export const CHEVRON_RIGHT = 'size-[8px] flex-none mr-[4px] border-t-[1.5px] border-r-[1.5px] border-ink-3 [transform:rotate(45deg)]';
/** 가로로 넘기는 칩 묶음(휴대폰 목록 위, 설정의 관심 키워드). 설정 줄 안에서는 줄바꿈하고 바깥 여백을 없앤다. */
export const CHIPS = 'chips mt-[4px] mb-0 mx-[calc(-1*var(--gutter))] flex gap-[8px] overflow-x-auto px-[var(--gutter)] py-[4px] [scrollbar-width:none] select-none [-webkit-user-select:none] [.setting-control_&]:m-0 [.setting-control_&]:flex-wrap [.setting-control_&]:overflow-visible [.setting-control_&]:p-0';
export const CHIP = 'chip relative min-h-[36px] flex-none rounded-pill border border-line bg-surface px-[14px] py-0 text-[14px] font-medium text-ink-2 before:absolute before:inset-x-0 before:inset-y-[-4px] before:content-[\'\'] aria-pressed:border-ink aria-pressed:bg-ink aria-pressed:font-semibold aria-pressed:text-bg [.setting-control_&[aria-pressed=true]]:border-line [.setting-control_&[aria-pressed=true]]:bg-sunken [.setting-control_&[aria-pressed=true]]:font-semibold [.setting-control_&[aria-pressed=true]]:text-ink [.setting-control_&[aria-pressed=false]]:text-ink-3 [.setting-control_&[aria-pressed=false]]:line-through';
export const CHIP_ADD = 'chip-add relative inline-flex min-h-[36px] flex-none items-center gap-[4px] rounded-pill border border-line bg-transparent py-0 pr-[14px] pl-[10px] text-[14px] font-medium text-ink-2 before:absolute before:inset-x-0 before:inset-y-[-4px] before:content-[\'\'] [&_.i]:size-[18px]';
/** 켜고 끄는 줄과 스위치. 켜짐은 aria-checked가 정한다. */
export const SWITCH_ROW = 'switch-row group/sw flex min-h-[52px] w-full items-center justify-between gap-[12px] border-0 border-t border-line bg-transparent px-0 py-[6px] text-left text-ink disabled:opacity-[0.55] [.setting-control>&:first-child]:border-t-0 [.box>&:first-child]:border-t-0';
export const SWITCH_ONLY = 'switch-row switch-only group/sw flex min-h-[44px] w-auto flex-none items-center justify-between gap-[12px] border-0 bg-transparent p-0 ml-auto text-left text-ink disabled:opacity-[0.55]';
export const SWITCH = 'switch relative h-[28px] w-[46px] flex-none rounded-pill border border-ink-2 bg-[color-mix(in_oklch,var(--text-3)_16%,var(--surface))] [transition:background_.15s,border-color_.15s] group-aria-checked/sw:border-accent group-aria-checked/sw:bg-accent after:absolute after:top-[2px] after:left-[2px] after:size-[22px] after:rounded-[50%] after:bg-[light-dark(var(--surface),var(--text-2))] group-aria-checked/sw:after:bg-surface after:content-[\'\'] after:[box-shadow:0_1px_2px_oklch(0.2_0.02_var(--h)/0.25)] after:[transition:transform_.15s] group-aria-checked/sw:after:[transform:translateX(18px)] motion-reduce:[transition:none] motion-reduce:after:[transition:none]';
export const BADGE = 'badge rounded-pill bg-sunken px-[8px] py-[1px] text-[12px] font-semibold text-ink-2';

export const CHOICE = 'choice group/ch relative flex min-h-[56px] items-center justify-between gap-[12px] rounded-none border-0 bg-surface px-[16px] py-[8px] text-left text-[15px] font-normal text-ink aria-checked:font-bold [.choice+&]:before:absolute [.choice+&]:before:top-0 [.choice+&]:before:right-[16px] [.choice+&]:before:left-[16px] [.choice+&]:before:h-[1px] [.choice+&]:before:bg-line [.choice+&]:before:content-[\'\']';
export const CHOICE_CHECK = 'choice-check grid size-[20px] flex-none place-items-center rounded-[50%] border-[1.5px] border-ink-3 group-aria-checked/ch:border-ink group-aria-checked/ch:after:size-[8px] group-aria-checked/ch:after:rounded-[50%] group-aria-checked/ch:after:bg-ink group-aria-checked/ch:after:content-[\'\']';
