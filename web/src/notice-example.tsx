import { APP_NAME } from './brand';

/** 알림 예시 카드. 실제 알림(src/skku_notice/push_collection.py)과 같은 모양이다: 제목은 공지 제목, 본문 첫 줄은 AI 판정 문구, 둘째 줄은 관심 키워드와 마감, 마지막 줄은 게시판. 로그인 화면과 첫 설정 알림 단계가 함께 쓴다. */
export function NoticeExample({ idPrefix }: { idPrefix: string }) {
  return <div className="pointer-events-none">
    <p className="m-0 mb-[8px] text-[13px] leading-[18px] font-semibold text-ink-2" id={`${idPrefix}-preview-label`}>알림 예시</p>
    <div className="w-full px-[16px] py-[14px] border border-line rounded-lg bg-surface" role="img" aria-labelledby={`${idPrefix}-preview-label`} aria-describedby={`${idPrefix}-note-text`}>
      <div className="flex items-center gap-[6px] text-[13px] leading-[18px] text-ink-2">
        <svg className="w-[18px] h-[18px] flex-none" aria-hidden="true"><use href="icons/sprite.svg#brand" /></svg>
        <span className="font-semibold text-ink">{APP_NAME}</span>
        <span className="ml-auto text-ink-2">지금</span>
      </div>
      <div id={`${idPrefix}-note-text`}><p className="m-0 mt-[8px] text-[15px] leading-[22px] font-semibold text-ink">[소프트웨어학과] 겨울방학 소프트웨어 인턴 모집 안내</p>
      <p className="m-0 mt-[2px] text-[14px] leading-[20px] font-medium text-ink break-keep">소프트웨어학과 학생이 지원할 수 있는 개발 인턴이에요</p>
      <p className="m-0 text-[14px] leading-[20px] text-ink-2">관심 키워드 인턴, <span className="whitespace-nowrap">12월 5일(토) 마감이에요</span></p></div>
    </div>
  </div>;
}
