// 출처: https://freshrss.github.io/FreshRSS/en/users/03_Main_view.html
// 여러 키워드에 속한 글도 전체 건수에는 한 번만 센다.
export function keywordCounts<T>(items: readonly T[], words: readonly string[],
  interests: (item: T) => readonly string[]) {
  const counts = Object.fromEntries(words.map((word) => [word, 0])) as Record<string, number>;
  let total = 0;
  for (const item of items) {
    let matched = false;
    for (const word of new Set(interests(item))) {
      if (Object.hasOwn(counts, word)) { counts[word]++; matched = true; }
    }
    if (matched) total++;
  }
  return { counts, total };
}
