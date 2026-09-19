create table if not exists public.chat_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null default 'Nova Conversa',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.chat_sessions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  sender text not null check (sender in ('user','iara')),
  content text not null,
  created_at timestamptz not null default now()
);

create index if not exists chat_sessions_user_updated_idx on public.chat_sessions(user_id, updated_at desc);
create index if not exists chat_messages_session_created_idx on public.chat_messages(session_id, created_at asc);
create index if not exists chat_messages_user_created_idx on public.chat_messages(user_id, created_at desc);

alter table public.chat_sessions enable row level security;
alter table public.chat_messages enable row level security;

drop policy if exists chat_sessions_select_own on public.chat_sessions;
drop policy if exists chat_sessions_insert_own on public.chat_sessions;
drop policy if exists chat_sessions_update_own on public.chat_sessions;
drop policy if exists chat_sessions_delete_own on public.chat_sessions;
create policy chat_sessions_select_own on public.chat_sessions for select to authenticated using ((select auth.uid()) = user_id);
create policy chat_sessions_insert_own on public.chat_sessions for insert to authenticated with check ((select auth.uid()) = user_id);
create policy chat_sessions_update_own on public.chat_sessions for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy chat_sessions_delete_own on public.chat_sessions for delete to authenticated using ((select auth.uid()) = user_id);

drop policy if exists chat_messages_select_own on public.chat_messages;
drop policy if exists chat_messages_insert_own on public.chat_messages;
create policy chat_messages_select_own on public.chat_messages for select to authenticated using ((select auth.uid()) = user_id and exists (select 1 from public.chat_sessions s where s.id = chat_messages.session_id and s.user_id = (select auth.uid())));
create policy chat_messages_insert_own on public.chat_messages for insert to authenticated with check ((select auth.uid()) = user_id and exists (select 1 from public.chat_sessions s where s.id = chat_messages.session_id and s.user_id = (select auth.uid())));

grant select, insert, update, delete on public.chat_sessions to authenticated;
grant select, insert on public.chat_messages to authenticated;

do $$ begin
  alter publication supabase_realtime add table public.chat_sessions;
exception when duplicate_object then null;
end $$;

do $$ begin
  alter publication supabase_realtime add table public.chat_messages;
exception when duplicate_object then null;
end $$;

create or replace function public.touch_chat_session_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists chat_sessions_touch_updated_at on public.chat_sessions;
create trigger chat_sessions_touch_updated_at before update on public.chat_sessions for each row execute function public.touch_chat_session_updated_at();

drop trigger if exists chat_messages_touch_session_updated_at on public.chat_messages;
create trigger chat_messages_touch_session_updated_at after insert on public.chat_messages for each row execute function public.touch_chat_session_updated_at();