# 성공 — 다중 사용자 공지 플랫폼

기존 [개인용 성공 프로젝트](https://github.com/aniseongu/skku-notice-alert)에서 분리해 개발하는 성균관대 공지 플랫폼입니다. **현재 개발 초기 단계이며 학생용 서비스로 배포할 수 없습니다.** 기존 화면과 수집 코드는 개인용 구조이므로 인증, 사용자 간 데이터 격리와 서버 처리로 전환해야 합니다. 원본 저장소와 운영 서비스는 변경하지 않습니다.

현재 프론트엔드는 Lit/Vite/PWA이며, 목표는 React/Vite/PWA, NestJS API, Supabase Auth/PostgreSQL/RLS와 Python 공유 수집 워커입니다. 기존 미리보기에서 Google OAuth 복귀를 시험했으며 운영 환경 재검증이 필요합니다. 개인 설정 동기화, BYOK 및 알림은 아직 구현되지 않았습니다. 미리보기에서는 기존 GitHub PAT 기반 연결과 개인 판정 JSON을 사용하지 않습니다. 저장과 읽음 표시는 현재 브라우저에만 남으며, 개인용 개인정보 안내는 새 서비스의 정책이 아닙니다.

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

AI 작업 지침, 계획과 인수인계 기록은 로컬에서만 관리하며 Git에 포함하지 않습니다. 비밀키와 개인 데이터도 커밋하지 않습니다.

## 인증 설정

`web/.env.example`을 `web/.env.local`로 복사하고 Supabase 프로젝트 URL과 **publishable** 키를 입력합니다. 이 값은 빌드 결과에 공개되므로 secret 또는 service-role 키를 사용하지 않습니다. OAuth 복귀 주소를 Supabase 허용 목록에 추가해야 실제 로그인이 가능합니다. Google 로그인과 Calendar 권한은 별개입니다. 현재 개인 설정은 서버에 동기화되지 않습니다.

인증 구현은 [Supabase JavaScript SDK](https://github.com/supabase/supabase-js)의 OAuth와 인증 상태 이벤트를 사용합니다. 향후 데이터베이스 격리는 [Supabase RLS 테스트 가이드](https://supabase.com/docs/guides/database/postgres/testing-row-level-security)에 따라 다른 사용자로 읽기·수정·삭제가 차단되는지 검증합니다.

## 학교 공지 수동 수집

프로젝트 루트에서 `uv run python -m skku_notice.public_snapshot`을 실행하면 `config/sources.yaml`의 학교 게시판 목록과 본문을 `web/public/api/v1`에 수집합니다. 공통으로 공개된 공지만 저장하며 개인 판정 및 인턴 출처는 포함하지 않습니다. 모든 게시판의 목록 수집이 성공해야 목록 파일을 갱신합니다. 이 명령은 예약 실행이나 푸시 발송을 설정하지 않습니다.

## 공통 공지 데이터

공개 공지는 Supabase의 `platform_sources`, `platform_notices`에 따로 보관합니다. 브라우저는 읽기만 할 수 있고 수집 작업만 서버 측 비밀키로 기록합니다. 각 게시판의 마지막 성공 시각을 보관하며, 새 글과 제목이 바뀐 글의 본문을 우선 받고, 오래된 본문은 게시판당 한 건씩 다시 확인합니다. DB를 읽을 수 없을 때 프론트는 마지막 수동 스냅샷을 보여 줍니다. 계정별 구독과 푸시 알림은 아직 연결되지 않았습니다.

테이블과 변경 기록 정의는 `supabase/migrations/`에 있습니다. 현재 프로젝트에서는 SQL Editor로 수동 적용했으므로 Supabase CLI 마이그레이션 이력에 자동 등록되지는 않았습니다. 추후 CLI를 연결할 때는 기존 테이블을 다시 만들지 않도록 이력을 먼저 정리해야 합니다. 수집 작업의 `SUPABASE_SECRET_KEY`는 서버의 제한된 환경 파일에만 보관하고, 프론트 환경 변수나 로그에 넣지 않습니다.

기존 GitHub Actions 예약과 릴레이는 비활성화했습니다. OCI 무료 Micro 서버에 30분 타이머를 설치하고 수동 수집을 확인했습니다. 첫 예약 실행과 재부팅 후 복구는 아직 확인하지 않았습니다. 설치 전 템플릿과 확인 방법은 `infra/oracle/`과 `docs/OPERATIONS.md`를 참조하세요.
