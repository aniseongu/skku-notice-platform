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

샘플 공지는 개발 서버 URL에 `?api=sample/api/v1`을 붙여 볼 수 있습니다. 샘플은 실제 사용자별 데이터가 아닙니다. 빌드에는 최근 수동 수집한 학교 공지 스냅샷이 포함됩니다. 수집 시각 이후의 공지를 자동으로 갱신하지 않으며 정식 서비스가 아닙니다.

Python 테스트는 프로젝트 루트에서 `uv run pytest -q`로 실행합니다. 기존 개인용 예약 워크플로는 이 저장소에 포함하지 않습니다.

로컬 작업 지침과 명세는 `docs/시작하기.md`, `docs/SKKU_NOTICE_PLATFORM_CODEX_SPEC.md`에 있으며 기존 방침에 따라 Git에서 제외합니다. 비밀키와 개인 데이터도 커밋하지 않습니다.

## 인증 설정

`web/.env.example`을 `web/.env.local`로 복사하고 Supabase 프로젝트 URL과 **publishable** 키를 입력합니다. 이 값은 빌드 결과에 공개되므로 secret 또는 service-role 키를 사용하지 않습니다. OAuth 복귀 주소를 Supabase 허용 목록에 추가해야 실제 로그인이 가능합니다. Google 로그인과 Calendar 권한은 별개입니다. 현재 개인 설정은 서버에 동기화되지 않습니다.

인증 구현은 [Supabase JavaScript SDK](https://github.com/supabase/supabase-js)의 OAuth와 인증 상태 이벤트를 사용합니다. 향후 데이터베이스 격리는 [Supabase RLS 테스트 가이드](https://supabase.com/docs/guides/database/postgres/testing-row-level-security)에 따라 다른 사용자로 읽기·수정·삭제가 차단되는지 검증합니다.

## 학교 공지 수동 수집

프로젝트 루트에서 `uv run python -m skku_notice.public_snapshot`을 실행하면 `config/sources.yaml`의 학교 게시판 목록과 본문을 `web/public/api/v1`에 수집합니다. 공통으로 공개된 공지만 저장하며 개인 판정 및 인턴 출처는 포함하지 않습니다. 모든 게시판의 목록 수집이 성공해야 목록 파일을 갱신합니다. 이 명령은 예약 실행이나 푸시 발송을 설정하지 않습니다.
