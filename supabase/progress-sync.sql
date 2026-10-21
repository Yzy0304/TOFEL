begin;
create table if not exists public.toefl_progress (
 user_id uuid primary key references auth.users(id) on delete cascade,
 revision bigint not null default 1 check (revision > 0),
 document jsonb not null check (jsonb_typeof(document) = 'object' and octet_length(document::text) <= 4194304),
 updated_at timestamptz not null default now()
);
alter table public.toefl_progress enable row level security;
revoke all on public.toefl_progress from anon, authenticated;
grant select, insert, update on public.toefl_progress to authenticated;
create policy "Read own progress" on public.toefl_progress for select to authenticated using ((select auth.uid()) = user_id);
create policy "Insert own progress" on public.toefl_progress for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "Update own progress" on public.toefl_progress for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create or replace function public.save_toefl_progress(expected_revision bigint, new_document jsonb)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare current_revision bigint; current_user_id uuid := auth.uid();
begin
 if current_user_id is null then raise exception 'Authentication required'; end if;
 if expected_revision < 0 or new_document->>'version' is distinct from '1'
    or jsonb_typeof(new_document->'events') is distinct from 'array'
    or jsonb_typeof(new_document->'bases') is distinct from 'array'
    or octet_length(new_document::text) > 4194304 then raise exception 'Invalid progress document'; end if;
 if expected_revision = 0 then
  insert into public.toefl_progress(user_id, document) values(current_user_id,new_document) on conflict (user_id) do nothing;
  return found;
 end if;
 select revision into current_revision from public.toefl_progress where user_id=current_user_id for update;
 if not found or current_revision <> expected_revision then return false; end if;
 update public.toefl_progress set document=new_document, revision=revision+1, updated_at=now() where user_id=current_user_id;
 return true;
end;
$$;
revoke all on function public.save_toefl_progress(bigint,jsonb) from public,anon;
grant execute on function public.save_toefl_progress(bigint,jsonb) to authenticated;
commit;
