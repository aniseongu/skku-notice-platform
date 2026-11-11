-- 사용자의 키로 뽑은 공고 사실은 그 사용자만 다시 쓴다(사용자 지시 2026-11-11: 내 API 키가 다른 사람의 판정에 쓰이면 안 된다).
-- 이전 설계(20261111120000)는 공고 단위로 모두가 공유해 무료 호출을 아꼈지만, 누구의 키로 뽑았는지 구분하지 못했다.
-- 만든 사람을 알 수 없는 공유 결과(수십 건)는 버린다. 공고 글에서 다시 만들 수 있다. 여러 번 실행해도 안전하다.
do $$
begin
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'platform_notice_ai_facts' and column_name = 'user_id') then
    delete from public.platform_notice_ai_facts;
    alter table public.platform_notice_ai_facts add column user_id uuid not null references auth.users(id) on delete cascade;
    alter table public.platform_notice_ai_facts drop constraint if exists platform_notice_ai_facts_pkey;
    alter table public.platform_notice_ai_facts add primary key (user_id, notice_id, text_hash, extractor_version);
  end if;
end $$;
