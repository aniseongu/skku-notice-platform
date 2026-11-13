import assert from 'node:assert/strict';
import test from 'node:test';
import { haeyo } from '../../supabase/functions/byok/haeyo.ts';

// 서버 judge.haeyo(Python)와 같은 결과여야 한다: 공지를 열 때 만드는 요약도 해요체로 저장한다.
test('formal endings in summaries become haeyo like the server', () => {
  const cases = [
    ['퍼포먼스 마케팅 실습생을 모집합니다.', '퍼포먼스 마케팅 실습생을 모집해요.'],
    ['월~금 09:00~18:00입니다.', '월~금 09:00~18:00이에요.'],
    ['최종 선발은 11월 24일에 확정됩니다.', '최종 선발은 11월 24일에 확정돼요.'],
    ['신청 안내입니다.', '신청 안내예요.'],
    ['참여할 수 있습니다.', '참여할 수 있어요.'],
    ['합격자를 발표했습니다.', '합격자를 발표했어요.'],
    ['공지를 참고하시기 바랍니다.', '공지를 참고해 주세요.'],
    ['링크를 받습니다.\n포럼이 열립니다', '링크를 받아요.\n포럼이 열려요'],
    ['이미 해요체예요.', '이미 해요체예요.'],
    ['대상이 아닙니다. 확인이 어렵습니다. 학교가 멉니다. 조건이 다릅니다.', '대상이 아니에요. 확인이 어려워요. 학교가 멀어요. 조건이 달라요.'],
  ];
  for (const [input, expected] of cases) assert.equal(haeyo(input), expected, input);
});
