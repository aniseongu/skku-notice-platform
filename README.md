# 성공 — 다중 사용자 공지 플랫폼

기존 [개인용 성공 프로젝트](https://github.com/aniseongu/skku-notice-alert)에서 분리해 개발하는 성균관대 공지 플랫폼입니다. **현재 개발 초기 단계이며 학생용 서비스로 배포할 수 없습니다.** 기존 화면과 수집 코드는 개인용 구조이므로 인증, 사용자 간 데이터 격리와 서버 처리로 전환해야 합니다. 원본 저장소와 운영 서비스는 변경하지 않습니다.

목표 구조는 Lit/Vite/PWA 프론트엔드, Supabase Auth/PostgreSQL/RLS, 공유 Python 수집 작업과 사용자별 알림입니다. Google 로그인, 개인 설정, BYOK 및 알림은 아직 구현되지 않았습니다. 기존 GitHub PAT 기반 연결과 개인용 개인정보 안내는 새 서비스의 기능이나 정책이 아닙니다.

## 로컬 확인

```sh
cd web
npm ci
npm test
npm run build
npm run dev -- --host 127.0.0.1
```

샘플 공지는 개발 서버 URL에 `?api=sample/api/v1`을 붙여 볼 수 있습니다. 샘플은 실제 사용자별 데이터가 아닙니다. 빌드된 `web/dist`에는 공지 API 데이터가 포함되지 않으므로 정식 서비스로 배포하면 안 됩니다.

Python 테스트는 프로젝트 루트에서 `uv run pytest -q`로 실행합니다. 기존 개인용 예약 워크플로는 이 저장소에 포함하지 않습니다.

로컬 작업 지침과 명세는 `docs/시작하기.md`, `docs/SKKU_NOTICE_PLATFORM_CODEX_SPEC.md`에 있으며 기존 방침에 따라 Git에서 제외합니다. 비밀키와 개인 데이터도 커밋하지 않습니다.
