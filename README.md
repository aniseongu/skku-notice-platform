# 성공 — 다중 사용자 공지 플랫폼

기존 [개인용 성공 프로젝트](https://github.com/aniseongu/skku-notice-alert)에서 분리해 개발하는 성균관대 공지 플랫폼입니다. **현재 개발 초기 단계이며 학생용 서비스로 배포할 수 없습니다.** 기존 화면과 수집 코드는 개인용 구조이므로 인증, 사용자 간 데이터 격리와 서버 처리로 전환해야 합니다. 원본 저장소와 운영 서비스는 변경하지 않습니다.

목표 구조는 Lit/Vite/PWA 프론트엔드, Supabase Auth/PostgreSQL/RLS, 공유 Python 수집 작업과 사용자별 알림입니다. Google 로그인 연동은 구현 중이며 실제 OAuth 복귀 검증이 필요합니다. 개인 설정 동기화, BYOK 및 알림은 아직 구현되지 않았습니다. 미리보기에서는 기존 GitHub PAT 기반 연결과 개인 판정 JSON을 사용하지 않습니다. 저장과 읽음 표시는 현재 브라우저에만 남으며, 개인용 개인정보 안내는 새 서비스의 정책이 아닙니다.

## 로컬 확인

```sh
cd web
npm ci
npm test
npm run build
npm run dev -- --host 127.0.0.1
```

샘플 공지는 개발 서버 URL에 `?api=sample/api/v1`을 붙여 볼 수 있습니다. 샘플은 실제 사용자별 데이터가 아닙니다. 빌드에는 DB 연결에 실패할 때 사용할 학교 공지 스냅샷이 포함됩니다. 정식 서비스는 아직 아닙니다.

Python 테스트는 프로젝트 루트에서 `uv run pytest -q`로 실행합니다. 기존 개인용 예약 워크플로는 이 저장소에 포함하지 않습니다.

로컬 작업 지침과 명세는 `docs/시작하기.md`, `docs/SKKU_NOTICE_PLATFORM_CODEX_SPEC.md`에 있으며 기존 방침에 따라 Git에서 제외합니다. 비밀키와 개인 데이터도 커밋하지 않습니다.

## 인증 설정

`web/.env.example`을 `web/.env.local`로 복사하고 Supabase 프로젝트 URL과 **publishable** 키를 입력합니다. 이 값은 빌드 결과에 공개되므로 secret 또는 service-role 키를 사용하지 않습니다. OAuth 복귀 주소를 Supabase 허용 목록에 추가해야 실제 로그인이 가능합니다. Google 로그인과 Calendar 권한은 별개입니다. 현재 개인 설정은 서버에 동기화되지 않습니다.

인증 구현은 [Supabase JavaScript SDK](https://github.com/supabase/supabase-js)의 OAuth와 인증 상태 이벤트를 사용합니다. 향후 데이터베이스 격리는 [Supabase RLS 테스트 가이드](https://supabase.com/docs/guides/database/postgres/testing-row-level-security)에 따라 다른 사용자로 읽기·수정·삭제가 차단되는지 검증합니다.

## 학교 공지 수동 수집

프로젝트 루트에서 `uv run python -m skku_notice.public_snapshot`을 실행하면 `config/sources.yaml`의 학교 게시판 목록과 본문을 `web/public/api/v1`에 수집합니다. 공통으로 공개된 공지만 저장하며 개인 판정 및 인턴 출처는 포함하지 않습니다. 모든 게시판의 목록 수집이 성공해야 목록 파일을 갱신합니다. 이 명령은 예약 실행이나 푸시 발송을 설정하지 않습니다.

## 공통 공지 데이터

공개 공지는 Supabase의 `platform_sources`, `platform_notices`에 따로 보관합니다. 브라우저는 읽기만 할 수 있고 수집 작업만 서버 측 비밀키로 기록합니다. 각 게시판의 마지막 성공 시각을 보관하며, 새 글과 제목이 바뀐 글의 본문을 우선 받고, 오래된 본문은 게시판당 한 건씩 다시 확인합니다. DB를 읽을 수 없을 때 프론트는 마지막 수동 스냅샷을 보여 줍니다. 계정별 구독과 푸시 알림은 아직 연결되지 않았습니다.

테이블과 변경 기록 정의는 `supabase/migrations/`에 있습니다. 현재 프로젝트에서는 SQL Editor로 수동 적용했으므로 Supabase CLI 마이그레이션 이력에 자동 등록되지는 않았습니다. 추후 CLI를 연결할 때는 기존 테이블을 다시 만들지 않도록 이력을 먼저 정리해야 합니다. 수집 작업의 `SUPABASE_SECRET_KEY`는 서버용 GitHub Actions secret으로만 보관하고, 프론트 환경 변수나 로그에 넣지 않습니다.

새 저장소의 `Collect school notices`는 매시간 17분 예약과 별도 릴레이를 함께 사용합니다. 릴레이는 약 55분 후 다음 확인을 요청하고, 모든 게시판을 최근 50분 안에 성공적으로 확인했다면 중복 수집을 건너뜁니다. 예약 실행이나 릴레이는 GitHub 상황에 따라 지연되거나 실패할 수 있습니다. 실행 결과는 저장소 Actions에서 확인합니다. 변경사항은 DB에 기록하므로 매 시간 웹사이트를 다시 빌드하지 않습니다.
