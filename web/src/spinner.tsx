// 로딩 표시: 가운데 성균관대 마크(명륜당) 둘레를 화살표가 도는 모양. 움직임 줄이기를 켠 사람에게는 멈춘 채로 보인다.
export function Spinner({ size = 22, className = '' }: { size?: number; className?: string }) {
  return <span className={`relative inline-flex flex-none items-center justify-center text-accent ${className}`} style={{ width: size, height: size }} aria-hidden="true">
    <svg className="absolute inset-0 size-full animate-spin motion-reduce:animate-none [animation-duration:1.1s]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3a9 9 0 1 1-9 9" /><path d="M0.9 12.6 3 9.6l2.1 3" />
    </svg>
    <svg className="size-[62%]" aria-hidden="true"><use href="icons/sprite.svg#brand" /></svg>
  </span>;
}
