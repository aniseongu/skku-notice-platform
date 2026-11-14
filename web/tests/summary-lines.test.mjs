import assert from 'node:assert/strict';
import test from 'node:test';
import { summaryLines } from '../src/summary-lines.ts';
import { threeLines } from '../../supabase/functions/byok/haeyo.ts';

// 서버(Python three_lines, tests/test_three_lines.py)와 같은 예시로 화면과 Edge Function이 같은 결과인지 본다.
const CASES = [
  ['당근마켓이 디자이너 인턴을 모집해요. 재학생도 지원할 수 있어요. 마감은 12월 28일(월)이며, 온라인으로 지원해요',
    ['당근마켓이 디자이너 인턴을 모집해요.', '재학생도 지원할 수 있어요.', '마감은 12월 28일(월)이며, 온라인으로 지원해요']],
  ['필요 서류를 내는 장학금 공고예요 대상은 재학생이에요 주요 일정은 홈페이지에서 확인해요',
    ['필요 서류를 내는 장학금 공고예요', '대상은 재학생이에요', '주요 일정은 홈페이지에서 확인해요']],
  ['첫째예요.\n둘째예요.\n셋째예요.\n넷째예요.', ['첫째예요.', '둘째예요.', '셋째예요. 넷째예요.']],
  ['첫째예요. 둘째예요. 셋째예요. 넷째예요.', ['첫째예요.', '둘째예요.', '셋째예요. 넷째예요.']],
  ['평점 3.5 이상이면 지원해요', ['평점 3.5 이상이면 지원해요']],
  ['Co. Ltd. 인턴을 뽑아요', ['Co. Ltd. 인턴을 뽑아요']],
  ['모집해요​.\n\n\n대상은 학생이에요.', ['모집해요.', '대상은 학생이에요.']],
  ['  \n ', []],
];

test('요약을 세 줄로 나누고 넘치는 문장은 셋째 줄에 붙인다', () => {
  for (const [input, expected] of CASES) {
    assert.deepEqual(summaryLines(input), expected, input);
    assert.equal(threeLines(input), expected.join('\n'), input);
  }
});

test('화면과 Edge Function의 요약 나누기는 lookbehind 정규식을 쓰지 않는다(구형 Safari)', async () => {
  const { readFile } = await import('node:fs/promises');
  for (const file of ['../src/summary-lines.ts', '../../supabase/functions/byok/haeyo.ts']) {
    const source = await readFile(new URL(file, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /\(\?<[=!]/, file);
  }
});
