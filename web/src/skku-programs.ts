// 단과대학과 학부·학과·전공 목록. 출처: https://www.skku.edu/skku/edu/education.do (2026-11-07 확인).
// 교원정보 페이지(professor.skku.edu)와 대조했고 연계전공은 부전공 성격이라 넣지 않았다. 이름은 공식 표기를 따른다.
export interface College {
  name: string;
  departments: readonly string[];
}

export const COLLEGES: readonly College[] = [
  { name: '학부대학', departments: [] },
  { name: '유학대학', departments: ['유학.동양학과'] },
  { name: '문과대학', departments: ['국어국문학과', '영어영문학과', '프랑스어문학과', '중어중문학과', '독어독문학과', '러시아어문학과', '한문학과', '사학과', '철학과', '문헌정보학과'] },
  { name: '사회과학대학', departments: ['행정학과', '정치외교학과', '미디어커뮤니케이션학과', '사회학과', '사회복지학과', '심리학과', '소비자학과', '아동·청소년학과', '글로벌리더학부', '휴먼사이언스ㆍ사회융합전공'] },
  { name: '경제대학', departments: ['경제학과', '통계학과', '글로벌경제학과'] },
  { name: '경영대학', departments: ['경영학과', '글로벌경영학과'] },
  { name: '사범대학', departments: ['교육학과', '한문교육과', '수학교육과', '컴퓨터교육과'] },
  { name: '예술대학', departments: ['미술학과', '디자인학과', '무용학과', '영상학과', '연기예술학과', '의상학과'] },
  { name: '자연과학대학', departments: ['생명과학과', '수학과', '물리학과', '화학과'] },
  { name: '정보통신대학', departments: ['전자전기공학부', '반도체시스템공학과', '소재부품융합공학과', '반도체융합공학과'] },
  { name: '소프트웨어융합대학', departments: ['소프트웨어학과', '글로벌융합학부', '데이터사이언스융합전공', '인공지능융합전공', '컬처앤테크놀로지융합전공', '자기설계융합전공', '지능형소프트웨어학과', '인공지능학과'] },
  { name: '공과대학', departments: ['화학공학부', '신소재공학부', '기계공학부', '건설환경공학부', '시스템경영공학과', '건축학과(건축학계열)', '나노공학과', '양자정보공학과'] },
  { name: '약학대학', departments: ['약학과', '바이오신약·규제과학과'] },
  { name: '생명공학대학', departments: ['식품생명공학과', '바이오메카트로닉스학과', '융합생명공학과'] },
  { name: '스포츠과학대학', departments: ['스포츠과학과'] },
  { name: '의과대학', departments: ['의학과'] },
  { name: '성균융합원', departments: ['글로벌바이오메디컬공학과', '응용AI융합학부', 'AI융합운영전공', '산업인공지능전공', '에너지학과', '배터리학과'] },
];

export const findCollege = (name: string | null | undefined): College | undefined => COLLEGES.find((college) => college.name === name);

/** 복수전공을 위해 대학과 학과 쌍을 여러 개 고를 수 있다. 학과가 없는 대학(학부대학)은 학과를 비워 둔다. */
export interface Program { college: string; department: string | null }
export const MAX_PROGRAMS = 4;

/** 대학과 학과의 조합이 목록에 있는지 확인한다. */
export function validProgram(program: Program): boolean {
  const found = findCollege(program.college);
  if (!found) return false;
  if (found.departments.length === 0) return program.department === null;
  return program.department !== null && found.departments.includes(program.department);
}

export const programKey = (program: Program) => `${program.college}\u0000${program.department ?? ''}`;
export const programLabel = (program: Program) => program.department ?? program.college;
