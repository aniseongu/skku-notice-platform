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
export const CHIP = 'chip [@media(hover:hover)]:[&:hover:not([aria-pressed=true])]:bg-hover active:[&:not([aria-pressed=true])]:bg-hover relative min-h-[36px] flex-none rounded-pill border border-line bg-surface px-[14px] py-0 text-[14px] font-medium text-ink-2 before:absolute before:inset-x-0 before:inset-y-[-4px] before:content-[\'\'] aria-pressed:border-ink aria-pressed:bg-ink aria-pressed:font-semibold aria-pressed:text-bg [.setting-control_&[aria-pressed=true]]:border-line [.setting-control_&[aria-pressed=true]]:bg-sunken [.setting-control_&[aria-pressed=true]]:font-semibold [.setting-control_&[aria-pressed=true]]:text-ink [.setting-control_&[aria-pressed=false]]:text-ink-3 [.setting-control_&[aria-pressed=false]]:line-through';
export const CHIP_ADD = 'chip-add [@media(hover:hover)]:hover:bg-hover active:bg-hover relative inline-flex min-h-[36px] flex-none items-center gap-[4px] rounded-pill border border-line bg-transparent py-0 pr-[14px] pl-[10px] text-[14px] font-medium text-ink-2 before:absolute before:inset-x-0 before:inset-y-[-4px] before:content-[\'\'] [&_.i]:size-[18px]';
/** 켜고 끄는 줄과 스위치. 켜짐은 aria-checked가 정한다. */
export const SWITCH_ROW = 'switch-row group/sw [@media(hover:hover)]:hover:enabled:bg-hover active:enabled:bg-hover flex min-h-[52px] w-full items-center justify-between gap-[12px] border-0 border-t border-line bg-transparent px-0 py-[6px] text-left text-ink disabled:opacity-[0.55] [.setting-control>&:first-child]:border-t-0 [.box>&:first-child]:border-t-0';
export const SWITCH_ONLY = 'switch-row switch-only group/sw [@media(hover:hover)]:hover:enabled:bg-hover active:enabled:bg-hover flex min-h-[44px] w-auto flex-none items-center justify-between gap-[12px] border-0 bg-transparent p-0 ml-auto text-left text-ink disabled:opacity-[0.55]';
export const SWITCH = 'switch relative h-[28px] w-[46px] flex-none rounded-pill border border-ink-2 bg-[color-mix(in_oklch,var(--text-3)_16%,var(--surface))] [transition:background_.15s,border-color_.15s] group-aria-checked/sw:border-accent group-aria-checked/sw:bg-accent after:absolute after:top-[2px] after:left-[2px] after:size-[22px] after:rounded-[50%] after:bg-[light-dark(var(--surface),var(--text-2))] group-aria-checked/sw:after:bg-surface after:content-[\'\'] after:[box-shadow:0_1px_2px_oklch(0.2_0.02_var(--h)/0.25)] after:[transition:transform_.15s] group-aria-checked/sw:after:[transform:translateX(18px)] motion-reduce:[transition:none] motion-reduce:after:[transition:none]';
export const BADGE = 'badge rounded-pill bg-sunken px-[8px] py-[1px] text-[12px] font-semibold text-ink-2';

export const CHOICE = 'choice group/ch [@media(hover:hover)]:[&:hover:not([aria-checked=true])]:bg-hover active:[&:not([aria-checked=true])]:bg-hover relative flex min-h-[56px] items-center justify-between gap-[12px] rounded-none border-0 bg-surface px-[16px] py-[8px] text-left text-[15px] font-normal text-ink aria-checked:font-bold [.choice+&]:before:absolute [.choice+&]:before:top-0 [.choice+&]:before:right-[16px] [.choice+&]:before:left-[16px] [.choice+&]:before:h-[1px] [.choice+&]:before:bg-line [.choice+&]:before:content-[\'\']';
export const CHOICE_CHECK = 'choice-check grid size-[20px] flex-none place-items-center rounded-[50%] border-[1.5px] border-ink-3 group-aria-checked/ch:border-ink group-aria-checked/ch:after:size-[8px] group-aria-checked/ch:after:rounded-[50%] group-aria-checked/ch:after:bg-ink group-aria-checked/ch:after:content-[\'\']';

/** 기다리는 자리의 조용한 막대(움직이지 않는다). 목록 뼈대와 상세의 본문·요약 자리가 같이 쓴다. sunken은 면과 거의 같아 보여 한 단계 진한 line을 쓴다. */
export const SKELETON_BAR = 'block h-[14px] rounded-sm bg-line';

/** 설정 입력과 강조 텍스트 단추의 공통 모양. */
export const SETTINGS_INPUT = 'input min-h-[44px] px-[12px] py-[10px] border border-line rounded-md bg-surface text-ink text-[15px] placeholder:text-ink-3 focus:outline-2 focus:outline-accent focus:outline-offset-[-1px]';
export const SETTINGS_ACTION = 'rounded-sm [@media(hover:hover)]:hover:bg-hover active:bg-hover min-h-[44px] cursor-pointer border-0 bg-transparent px-[8px] py-0 text-[14px] font-semibold text-accent [font-family:inherit] [line-height:inherit] [&:hover]:underline [&:hover]:underline-offset-[3px] focus-visible:rounded-sm';
/** 단추가 막혔을 때의 모양. 채운 단추와 보조 단추 모두 같다(테두리만 남기고 흐린 글자). */
export const BUTTON_DISABLED = 'disabled:border disabled:border-line disabled:bg-transparent disabled:text-ink-3 disabled:opacity-60';
/** 설정의 기본 강조 단추(채운 단추). */
export const SOLID_BUTTON = 'solid-button [@media(hover:hover)]:hover:bg-[color-mix(in_oklch,var(--accent)_88%,var(--text))] active:bg-[color-mix(in_oklch,var(--accent)_88%,var(--text))] inline-flex items-center justify-center min-h-[44px] px-[16px] py-0 rounded-md border-0 bg-accent text-on-accent text-[15px] font-semibold no-underline whitespace-nowrap select-none [-webkit-user-select:none] disabled:border disabled:border-line disabled:bg-transparent disabled:text-ink-3 disabled:opacity-60';
/** 설정의 보조 단추(테두리 단추). */
export const GHOST_BUTTON = 'ghost-button [@media(hover:hover)]:hover:bg-hover active:bg-hover inline-flex items-center justify-center min-h-[44px] px-[16px] py-0 rounded-md border border-line bg-surface text-ink text-[15px] font-semibold no-underline whitespace-nowrap select-none [-webkit-user-select:none] disabled:border disabled:border-line disabled:bg-transparent disabled:text-ink-3 disabled:opacity-60';
/** 지우기·연결 끊기·삭제처럼 되돌리기 어려운 동작의 단추. 보조 단추에 빨간 글자만 더한다. */
export const DANGER_BUTTON = 'ghost-button danger-button [@media(hover:hover)]:hover:bg-hover active:bg-hover inline-flex items-center justify-center min-h-[44px] px-[16px] py-0 rounded-md border border-line bg-surface text-danger text-[15px] font-semibold no-underline whitespace-nowrap select-none [-webkit-user-select:none] disabled:border disabled:border-line disabled:bg-transparent disabled:text-ink-3 disabled:opacity-60';

/** 목록 줄 안의 작은 보조 단추(기기 이름 바꾸기·지우기). 터치에서는 44px. */
export const DEVICE_ACTION = 'ghost-button [@media(hover:hover)]:hover:bg-hover active:bg-hover inline-flex min-h-[36px] items-center justify-center self-start rounded-md border border-line bg-surface px-[12px] py-0 text-[14px] font-medium text-ink-2 whitespace-nowrap select-none [@media(pointer:coarse)]:min-h-[44px] disabled:opacity-60';

/** 글자 단추 1종(눌림 44px). 구역 안의 보조 동작(지우기·취소·더 보기)에 쓴다. 위험한 동작은 TEXT_BUTTON_DANGER. */
export const TEXT_BUTTON = 'rounded-sm [@media(hover:hover)]:hover:bg-hover active:bg-hover min-h-[44px] cursor-pointer border-0 bg-transparent px-[8px] py-0 text-[14px] font-medium text-ink-2 disabled:text-ink-3';
export const TEXT_BUTTON_DANGER = 'rounded-sm [@media(hover:hover)]:hover:bg-hover active:bg-hover min-h-[44px] cursor-pointer border-0 bg-transparent px-[8px] py-0 text-[14px] font-semibold text-danger disabled:text-ink-3';
/** 구역·카드 안의 안내 한 줄(13px). 구역 제목(13px ink-3)보다 진하되 크지 않다. */
export const NOTE_TEXT = 'm-0 text-[13px] leading-[19px] text-ink-2';
/** 고르는 칩(상태·인원 등 하나를 고르는 것). 고른 것은 채움이 아니라 중립 면+굵기+체크다. aria-checked로 정한다. */
export const OPTION_CHIP = 'inline-flex min-h-[44px] items-center justify-center gap-[4px] rounded-pill border border-line bg-surface px-[14px] py-0 text-[14px] font-medium text-ink-2 [@media(hover:hover)]:[&:hover:not([aria-checked=true])]:bg-hover active:[&:not([aria-checked=true])]:bg-hover aria-checked:border-ink-3 aria-checked:bg-sunken aria-checked:font-semibold aria-checked:text-ink';
/** 선택 칩 안의 체크 표시(14px) */
export const OPTION_CHECK = 'size-[14px] flex-none fill-none stroke-current [stroke-width:2.25] [stroke-linecap:round] [stroke-linejoin:round]';
/** 접히는 구역의 머리 한 줄(제목 ··· 현재 값 ⌄). h3 안에 넣는 단추다. */
export const COLLAPSE_HEAD = '[@media(hover:hover)]:hover:bg-hover active:bg-hover -mx-[8px] flex min-h-[44px] w-[calc(100%+16px)] items-center justify-between gap-[8px] rounded-sm border-0 bg-transparent px-[8px] py-0 text-left text-[13px] font-semibold text-ink-3';
/** 저장 목록 줄의 상태 표시(메타 줄의 글자 한 요소). 기본 상태는 연하게, 직접 고른 상태는 굵게 한다. */
export const STATUS_META = 'status-meta inline-flex flex-none items-center gap-[5px]';
/** 상태 점 색(무채색 셋과 강조색 하나) */
export const STATUS_DOT: Record<'interested' | 'preparing' | 'applied' | 'result', string> = { interested: 'bg-ink-3', preparing: 'bg-accent', applied: 'bg-ink', result: 'bg-ink-2' };
