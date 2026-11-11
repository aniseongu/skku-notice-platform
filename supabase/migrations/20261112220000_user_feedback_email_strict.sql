-- 답장 메일 검사를 메일 서비스가 받는 모양(영문·숫자·. _ % + - 와 도메인)으로 엄격하게 맞춘다. 서버 워커의 검사와 같은 기준이다.
alter table public.user_feedback drop constraint if exists user_feedback_reply_email_check;
alter table public.user_feedback add constraint user_feedback_reply_email_check
  check (reply_email is null or (char_length(reply_email) <= 254 and reply_email ~ '^[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$')) not valid;
alter table public.user_feedback validate constraint user_feedback_reply_email_check;
