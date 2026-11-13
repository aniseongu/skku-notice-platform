// 요약이 격식체("-습니다", "-ㅂ니다")로 끝나면 해요체로 바꾼다(서버 judge.haeyo와 같은 규칙, 토스 문구 규칙).
const VOWEL_HAEYO: Record<number, number> = { 0: 0, 4: 4, 8: 9, 13: 14, 20: 6, 18: 4, 11: 10, 1: 1, 5: 5 };
const syllable = (ch: string) => { const c = ch.charCodeAt(0) - 0xac00; return [Math.floor(c / 588), Math.floor((c % 588) / 28), c % 28]; };
const hasBatchim = (ch: string) => (/[가-힣]/.test(ch) ? syllable(ch)[2] !== 0 : '013678'.includes(ch) || /[A-Za-z]/.test(ch));
export function haeyo(text: string): string {
  return text.replace(/(\S+?)하시기\s*바랍니다(?=[.!?\s]|$)/g, '$1해 주세요').replace(/([가-힣])(습니다|니다)(?=[.!?\s]|$)/g, (all, stem: string, ending: string, offset: number, whole: string) => {
    const [cho, jung, jong] = syllable(stem);
    if (ending === '습니다') return jong === 0 ? all : stem + ((jung === 0 || jung === 8) && jong !== 20 ? '아요' : '어요');
    if (jong !== 17) return all;
    if (stem === '입') return offset > 0 && hasBatchim(whole[offset - 1]) ? '이에요' : '예요';
    if (stem === '합') return '해요';
    const next = VOWEL_HAEYO[jung];
    return next === undefined ? all : String.fromCharCode(0xac00 + cho * 588 + next * 28) + '요';
  });
}
