// 요약은 세 줄로 보여 준다(2026-11-15 사용자 지시: "요약은 전부 3줄 요약으로").
// 예전에 저장된 요약은 세 문장이 한 줄에 붙어 있는 경우가 많아 화면에서도 같은 규칙으로 나눈다.
// 서버 judge.three_lines, supabase/functions/byok/haeyo.ts의 threeLines와 같은 규칙이다(시험이 둘을 비교한다).
// 구형 iOS Safari가 lookbehind 정규식을 읽지 못해 앱 전체가 멈추지 않도록 캡처 묶음으로 나눈다.
export function summaryLines(text: string): string[] {
  let lines = text.split('\n').map((l) => l.replace(/[\u0000-\u001f\u007f​-‏⁠﻿]/g, '').trim()).filter(Boolean);
  if (lines.length < 3) {
    lines = lines.flatMap((line) => line.replace(/([가-힣)\]][.!?])\s+/g, '$1\n').replace(/([해예에어아여워와줘세돼져려봐써]요)\s+(?=[가-힣A-Za-z0-9(\[])/g, '$1\n').split('\n')).map((l) => l.trim()).filter(Boolean);
  }
  if (lines.length > 3) lines = [...lines.slice(0, 2), lines.slice(2).join(' ')];
  return lines;
}
