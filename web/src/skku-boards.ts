// scripts/board_catalog.py가 만든 파일이다. 직접 고치지 않는다.
// 단과대학·학과 공지 게시판. 2026-11-07에 학교 공개 페이지에서 찾아 수집 파서로 읽히는 것을 확인했다.
import type { Program } from './skku-programs.ts';

export interface BoardRef { id: string; name: string; url: string }
export const DEFAULT_BOARD = 'skku-notice01';
export const BOARD_CATALOG: readonly BoardRef[] = [
  { id: 'liberalarts-notice', name: '문과대학 공지', url: 'https://liberalarts.skku.edu/liberal/community/under_notice.do' },
  { id: 'sscience-notice', name: '사회과학대학 공지', url: 'https://sscience.skku.edu/sscience/community/under_notice.do' },
  { id: 'ecostat-notice', name: '경제대학 공지', url: 'https://ecostat.skku.edu/ecostat/notice_total.do' },
  { id: 'biz-notice', name: '경영대학 공지', url: 'https://biz.skku.edu/bizskk/notice.do' },
  { id: 'art-notice', name: '예술대학 공지', url: 'https://art.skku.edu/art/notice.do' },
  { id: 'cscience-notice', name: '자연과학대학 공지', url: 'https://cscience.skku.edu/cscience/community/under_notice.do' },
  { id: 'ice-notice', name: '정보통신대학 공지', url: 'https://ice.skku.edu/ice/notice.do' },
  { id: 'enc-notice', name: '공과대학 공지', url: 'https://enc.skku.edu/enc/notice.do' },
  { id: 'biotech-notice', name: '생명공학대학 공지', url: 'https://biotech.skku.edu/biotech/notice_under.do' },
  { id: 'sports-notice', name: '스포츠과학대학 공지', url: 'https://sport.skku.edu/sports/community/under_notice.do' },
  { id: 'scos-notice', name: '유학대학 공지', url: 'https://scos.skku.edu/scos/community/under_notice.do' },
  { id: 'korean-notice', name: '국어국문학과 공지', url: 'https://skb.skku.edu/korean/community/under_notice.do' },
  { id: 'english-notice', name: '영어영문학과 공지', url: 'https://skb.skku.edu/english/notice.do' },
  { id: 'french-notice', name: '프랑스어문학과 공지', url: 'https://skb.skku.edu/french/community/notice.do' },
  { id: 'chinese-notice', name: '중어중문학과 공지', url: 'https://skb.skku.edu/chinese/undergraduate_notice.do' },
  { id: 'german-notice', name: '독어독문학과 공지', url: 'https://skb.skku.edu/german/04_Community/notice.do' },
  { id: 'russian-notice', name: '러시아어문학과 공지', url: 'https://russian.skku.edu/russian/deptnews.do' },
  { id: 'klcc-notice', name: '한문학과 공지', url: 'https://skb.skku.edu/klcc/community/under_notice.do' },
  { id: 'history-notice', name: '사학과 공지', url: 'https://history.skku.edu/history/community/under_notice.do' },
  { id: 'philosophy-notice', name: '철학과 공지', url: 'https://skb.skku.edu/philosophy/community/under_notice.do' },
  { id: 'lis-notice', name: '문헌정보학과 공지', url: 'https://lis.skku.edu/lis/community/under_notice.do' },
  { id: 'psd-notice', name: '정치외교학과 공지', url: 'https://skb.skku.edu/psd/notice.do' },
  { id: 'mediacomm-notice', name: '미디어커뮤니케이션학과 공지', url: 'https://mediacomm.skku.edu/mediacomm/community/notice.do' },
  { id: 'soc-notice', name: '사회학과 공지', url: 'https://soc.skku.edu/soc/notice.do' },
  { id: 'welfare-notice', name: '사회복지학과 공지', url: 'https://skb.skku.edu/welfare/community/notice.do' },
  { id: 'psych-notice', name: '심리학과 공지', url: 'https://psych.skku.edu/psy/notice_undergraduate.do' },
  { id: 'child-notice', name: '아동·청소년학과 공지', url: 'https://skb.skku.edu/child/notice.do' },
  { id: 'gld-notice', name: '글로벌리더학부 공지', url: 'https://gld.skku.edu/gld/community/notice.do' },
  { id: 'stat-notice', name: '통계학과 공지', url: 'https://stat.skku.edu/stat/community/under_notice.do' },
  { id: 'globalecon-notice', name: '글로벌경제학과 공지', url: 'https://globalecon.skku.edu/gecon/notice.do' },
  { id: 'bus-notice', name: '경영학과 공지', url: 'https://skb.skku.edu/bus/notice.do' },
  { id: 'globalbiz-notice', name: '글로벌경영학과 공지', url: 'https://globalbiz.skku.edu/gba/notice.do' },
  { id: 'edu-notice', name: '교육학과 공지', url: 'https://skb.skku.edu/skku-edu/community/under_notice.do' },
  { id: 'klccedu-notice', name: '한문교육과 공지', url: 'https://skb.skku.edu/klccedu/community/notice.do' },
  { id: 'mathedu-notice', name: '수학교육과 공지', url: 'https://skb.skku.edu/mathedu/notice.do' },
  { id: 'comedu-notice', name: '컴퓨터교육과 공지', url: 'https://comedu.skku.edu/comedu/notice.do' },
  { id: 'design-notice', name: '디자인학과 공지', url: 'https://design.skku.edu/design/notice_dept.do' },
  { id: 'dance-notice', name: '무용학과 공지', url: 'https://dance.skku.edu/dance/notice.do' },
  { id: 'acting-notice', name: '연기예술학과 공지', url: 'https://acting.skku.edu/acting/notice.do' },
  { id: 'fashion-notice', name: '의상학과 공지', url: 'https://fashion.skku.edu/fashion/notice.do' },
  { id: 'math-notice', name: '수학과 공지', url: 'https://math.skku.edu/math/community/under_notice.do' },
  { id: 'physics-notice', name: '물리학과 공지', url: 'https://physics.skku.edu/physics/notice/notice.do' },
  { id: 'eee-notice', name: '전자전기공학부 공지', url: 'https://eee.skku.edu/eee/notice.do' },
  { id: 'mcce-notice', name: '소재부품융합공학과 공지', url: 'https://skb.skku.edu/mcce/notice.do' },
  { id: 'intelligentsw-notice', name: '지능형소프트웨어학과 공지', url: 'https://intelligentsw.skku.edu/intelligentsw/notice.do' },
  { id: 'ai-notice', name: '인공지능학과 공지', url: 'https://ai.skku.edu/ai/notice.do' },
  { id: 'amse-notice', name: '신소재공학부 공지', url: 'https://amse.skku.edu/AMSE/notice.do' },
  { id: 'mech-notice', name: '기계공학부 공지', url: 'https://mech.skku.edu/me/notice.do' },
  { id: 'sme-notice', name: '시스템경영공학과 공지', url: 'https://sme.skku.edu/iesys/notice.do' },
  { id: 'arch-notice', name: '건축학과 공지', url: 'https://arch.skku.edu/arch/NEWS/notice.do' },
  { id: 'qie-notice', name: '양자정보공학과 공지', url: 'https://qie.skku.edu/qie/notice.do' },
  { id: 'foodlife-notice', name: '식품생명공학과 공지', url: 'https://skb.skku.edu/foodlife/community/notice.do' },
  { id: 'biomecha-notice', name: '바이오메카트로닉스학과 공지', url: 'https://skb.skku.edu/biomecha/community/notice.do' },
  { id: 'gene-notice', name: '융합생명공학과 공지', url: 'https://skb.skku.edu/gene/community/under_notice.do' },
  { id: 'gbme-notice', name: '글로벌바이오메디컬공학과 공지', url: 'https://gbme.skku.edu/gbme/community/under_notice.do' },
  { id: 'aicon-notice', name: '응용AI융합학부 공지', url: 'https://aicon.skku.edu/aicon/notice.do' },
  { id: 'energy-notice', name: '에너지학과 공지', url: 'https://energy.skku.edu/energy/notice.do' },
  { id: 'ssbat-notice', name: '배터리학과 공지', url: 'https://ssbat.skku.edu/ssbat/notice.do' },
];

/** 전공과 상관없이 고르는 게시판(부트캠프 등). */
export interface OtherBoard { id: string; group: string; help: string }
export const OTHER_BOARDS: readonly OtherBoard[] = [
  { id: 'futurecar-notice', group: '부트캠프', help: '수강 모집과 행사 안내' },
];

export const COLLEGE_BOARD: Readonly<Record<string, string>> = {
  '문과대학': 'liberalarts-notice',
  '사회과학대학': 'sscience-notice',
  '경제대학': 'ecostat-notice',
  '경영대학': 'biz-notice',
  '예술대학': 'art-notice',
  '자연과학대학': 'cscience-notice',
  '정보통신대학': 'ice-notice',
  '소프트웨어융합대학': 'sw-notice',
  '공과대학': 'enc-notice',
  '생명공학대학': 'biotech-notice',
  '스포츠과학대학': 'sports-notice',
  '유학대학': 'scos-notice',
};

export const DEPARTMENT_BOARD: Readonly<Record<string, string>> = {
  '문과대학/국어국문학과': 'korean-notice',
  '문과대학/영어영문학과': 'english-notice',
  '문과대학/프랑스어문학과': 'french-notice',
  '문과대학/중어중문학과': 'chinese-notice',
  '문과대학/독어독문학과': 'german-notice',
  '문과대학/러시아어문학과': 'russian-notice',
  '문과대학/한문학과': 'klcc-notice',
  '문과대학/사학과': 'history-notice',
  '문과대학/철학과': 'philosophy-notice',
  '문과대학/문헌정보학과': 'lis-notice',
  '사회과학대학/정치외교학과': 'psd-notice',
  '사회과학대학/미디어커뮤니케이션학과': 'mediacomm-notice',
  '사회과학대학/사회학과': 'soc-notice',
  '사회과학대학/사회복지학과': 'welfare-notice',
  '사회과학대학/심리학과': 'psych-notice',
  '사회과학대학/아동·청소년학과': 'child-notice',
  '사회과학대학/글로벌리더학부': 'gld-notice',
  '경제대학/통계학과': 'stat-notice',
  '경제대학/글로벌경제학과': 'globalecon-notice',
  '경영대학/경영학과': 'bus-notice',
  '경영대학/글로벌경영학과': 'globalbiz-notice',
  '사범대학/교육학과': 'edu-notice',
  '사범대학/한문교육과': 'klccedu-notice',
  '사범대학/수학교육과': 'mathedu-notice',
  '사범대학/컴퓨터교육과': 'comedu-notice',
  '예술대학/디자인학과': 'design-notice',
  '예술대학/무용학과': 'dance-notice',
  '예술대학/연기예술학과': 'acting-notice',
  '예술대학/의상학과': 'fashion-notice',
  '자연과학대학/수학과': 'math-notice',
  '자연과학대학/물리학과': 'physics-notice',
  '정보통신대학/전자전기공학부': 'eee-notice',
  '정보통신대학/소재부품융합공학과': 'mcce-notice',
  '소프트웨어융합대학/소프트웨어학과': 'cse-notice',
  '소프트웨어융합대학/지능형소프트웨어학과': 'intelligentsw-notice',
  '소프트웨어융합대학/인공지능학과': 'ai-notice',
  '공과대학/신소재공학부': 'amse-notice',
  '공과대학/기계공학부': 'mech-notice',
  '공과대학/시스템경영공학과': 'sme-notice',
  '공과대학/건축학과(건축학계열)': 'arch-notice',
  '공과대학/양자정보공학과': 'qie-notice',
  '생명공학대학/식품생명공학과': 'foodlife-notice',
  '생명공학대학/바이오메카트로닉스학과': 'biomecha-notice',
  '생명공학대학/융합생명공학과': 'gene-notice',
  '성균융합원/글로벌바이오메디컬공학과': 'gbme-notice',
  '성균융합원/응용AI융합학부': 'aicon-notice',
  '성균융합원/에너지학과': 'energy-notice',
  '성균융합원/배터리학과': 'ssbat-notice',
  '스포츠과학대학/스포츠과학과': 'sports-notice',
  '경제대학/경제학과': 'ecostat-notice',
};

/** 전공에 맞는 게시판. 성균관대 공지는 항상 넣고, 전공마다 학과 게시판과 단과대학 게시판을 더한다(없는 것은 건너뛴다). */
export function boardsForPrograms(programs: readonly Program[]): string[] {
  const ids = [DEFAULT_BOARD];
  for (const program of programs) {
    const department = program.department ? DEPARTMENT_BOARD[`${program.college}/${program.department}`] : undefined;
    const college = COLLEGE_BOARD[program.college];
    for (const id of [department, college]) if (id && !ids.includes(id)) ids.push(id);
  }
  return ids;
}
