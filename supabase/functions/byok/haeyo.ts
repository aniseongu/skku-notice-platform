// 요약이 격식체("-습니다", "-ㅂ니다")로 끝나면 해요체로 바꾼다(서버 judge.haeyo와 같은 규칙, 토스 문구 규칙).
const VOWEL_HAEYO: Record<number, number> = { 0: 0, 4: 4, 8: 9, 13: 14, 20: 6, 18: 4, 11: 10, 1: 1, 5: 5 };
const syllable = (ch: string) => { const c = ch.charCodeAt(0) - 0xac00; return [Math.floor(c / 588), Math.floor((c % 588) / 28), c % 28]; };
const hasBatchim = (ch: string) => (/[가-힣]/.test(ch) ? syllable(ch)[2] !== 0 : '013678'.includes(ch) || /[A-Za-z]/.test(ch));
export function haeyo(text: string): string {
  const irregular: Record<string, string> = { '아닙니다': '아니에요', '어렵습니다': '어려워요', '멉니다': '멀어요', '다릅니다': '달라요' };
  return text.replace(/(\S+?)하시기\s*바랍니다(?=[.!?\s]|$)/g, '$1해 주세요').replace(/(아닙니다|어렵습니다|멉니다|다릅니다)(?=[.!?\s]|$)/g, (word) => irregular[word]).replace(/([가-힣])(습니다|니다)(?=[.!?\s]|$)/g, (all, stem: string, ending: string, offset: number, whole: string) => {
    const [cho, jung, jong] = syllable(stem);
    if (ending === '습니다') return jong === 0 ? all : stem + ((jung === 0 || jung === 8) && jong !== 20 ? '아요' : '어요');
    if (jong !== 17) return all;
    if (stem === '입') return offset > 0 && hasBatchim(whole[offset - 1]) ? '이에요' : '예요';
    if (stem === '합') return '해요';
    const next = VOWEL_HAEYO[jung];
    return next === undefined ? all : String.fromCharCode(0xac00 + cho * 588 + next * 28) + '요';
  });
}

// 요약은 세 줄이다(2026-11-15 사용자 지시). 서버 judge.three_lines, web/src/summary-lines.ts와 같은 규칙:
// 줄이 셋보다 적으면 문장 끝(한글·닫는 괄호 뒤 마침표류, 해요체 어미 뒤 공백)에서 나누고, 넘치면 셋째 줄에 붙인다.
// 구형 Safari가 lookbehind를 못 읽으므로 캡처 묶음으로 나눈다.
export function threeLines(text: string): string {
  let lines = text.split('\n').map((l) => l.replace(/[\u0000-\u001f\u007f​-‏⁠﻿]/g, '').trim()).filter(Boolean);
  if (lines.length < 3) {
    lines = lines.flatMap((line) => line.replace(/([가-힣)\]][.!?])\s+/g, '$1\n').replace(/([해예에어아여워와줘세돼져려봐써]요)\s+(?=[가-힣A-Za-z0-9(\[])/g, '$1\n').split('\n')).map((l) => l.trim()).filter(Boolean);
  }
  if (lines.length > 3) lines = [...lines.slice(0, 2), lines.slice(2).join(' ')];
  return lines.join('\n');
}
