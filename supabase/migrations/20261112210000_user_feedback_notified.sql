-- 새 문의를 운영자에게 알렸는지 기록한다. 알림은 서버의 푸시 워커가 운영자 본인의 기기로만 보낸다.
alter table public.user_feedback add column notified_at timestamptz;
create index user_feedback_unnotified on public.user_feedback (created_at) where notified_at is null;
-- 사용자 열 권한은 그대로다(보내는 사람은 kind, body, reply_email만 쓴다). 서비스 역할은 이미 전체 권한이 있다.
