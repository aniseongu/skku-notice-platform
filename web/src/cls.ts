// 여러 화면이 같이 쓰는 Tailwind 클래스 묶음. Tailwind는 소스에서 완성된 문자열을 찾으므로 이어 붙이지 않고 통째로 적는다.

/** 상세의 구역(위 구분선) */
export const DETAIL_SECTION = 'detail-section mt-[20px] border-t border-line pt-[16px]';
/** 구역 제목(h3) */
export const SECTION_TITLE = 'm-0 mb-[8px] text-[13px] leading-[18px] font-semibold text-ink-3';
/** 본문에서 깨진 그림 자리에 보이는 안내 */
export const IMAGE_MISSING_CLASS = 'image-missing block mb-[12px] px-[14px] py-[12px] rounded-sm bg-sunken text-[13px] leading-[19px] text-ink-2';
/** 선택 모드의 체크 칸(input). 체크 표시는 base.css의 .check-mark가 그린다. */
export const CHECKBOX = 'check-mark relative m-0 size-[18px] flex-none cursor-pointer appearance-none rounded-sm border-[1.5px] border-ink-3 bg-transparent [transition:background-color_.12s,border-color_.12s] checked:border-ink checked:bg-ink indeterminate:border-ink indeterminate:bg-ink';
