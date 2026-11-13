// 로딩 표시: 성균관대 로고처럼 파란 고리 안에 초록 은행잎을 두고, 고리가 화살표로 돈다. 움직임 줄이기를 켠 사람에게는 멈춘 채로 보인다.
// 토스 기준: 얇고 둥근 선, 색은 파랑(고리)과 초록(잎) 둘뿐, 군더더기 없이.
export function Spinner({ size = 22, className = '' }: { size?: number; className?: string }) {
  return <span className={`relative inline-flex flex-none items-center justify-center ${className}`} style={{ width: size, height: size }} aria-hidden="true">
    <svg className="absolute inset-0 size-full animate-spin motion-reduce:animate-none [animation-duration:1.1s]" viewBox="0 0 24 24" fill="none" stroke="#2f6db5" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2.5a9.5 9.5 0 1 1-9.5 9.5" /><path d="M0.9 14.2 2.5 11.8l1.6 2.4" />
    </svg>
    <svg className="size-full" viewBox="0 0 24 24" fill="none">
            <path d="M12 18.2 5 9.8C7.3 6.2 10.7 6.3 12 8.8c1.3-2.5 4.7-2.6 7-.9z" fill="#8cc63f" />
      <path d="M12 18.2V10.6M12 18.2 8 11.6M12 18.2 16 11.6M12 18.2 6.6 12.4M12 18.2l5.4-5.8" stroke="#f1f9df" strokeWidth="0.55" strokeLinecap="round" />
    </svg>
  </span>;
}
