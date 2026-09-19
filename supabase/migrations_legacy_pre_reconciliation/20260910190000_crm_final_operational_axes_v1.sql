begin;

create table if not exists public.crm_teams (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
 name text not null, description text, active boolean not null default true,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(user_id,name)
);
create index if not exists idx_crm_teams_user_active on public.crm_teams(user_id,active);

create table if not exists public.crm_team_members (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
 team_id uuid not null references public.crm_teams(id) on delete cascade, agent_id uuid references public.crm_agents(id) on delete cascade,
 role text not null default 'member' check(role in ('member','lead','manager')), active boolean not null default true,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(team_id,agent_id)
);
create index if not exists idx_crm_team_members_user on public.crm_team_members(user_id,active);

create table if not exists public.crm_tags (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
 name text not null, description text, active boolean not null default true,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(user_id,name)
);
create index if not exists idx_crm_tags_user_active on public.crm_tags(user_id,active);
alter table public.crm_conversation_tags add column if not exists tag_id uuid references public.crm_tags(id) on delete set null;
create index if not exists idx_crm_conversation_tags_tag on public.crm_conversation_tags(tag_id);

create table if not exists public.crm_quick_replies (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
 title text not null, body text not null, channel text not null default 'all', active boolean not null default true,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(user_id,title)
);

create table if not exists public.crm_tasks (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
 conversation_id uuid references public.crm_conversations(id) on delete cascade, assigned_to uuid, title text not null, description text,
 status text not null default 'open' check(status in ('open','in_progress','completed','cancelled')),
 priority text not null default 'normal' check(priority in ('low','normal','high','urgent')),
 due_at timestamptz, completed_at timestamptz, created_by uuid, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists idx_crm_tasks_user_status_due on public.crm_tasks(user_id,status,due_at);
create index if not exists idx_crm_tasks_conversation on public.crm_tasks(conversation_id,status);

create table if not exists public.crm_segments (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
 name text not null, description text, definition jsonb not null default '{}'::jsonb, active boolean not null default true,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(user_id,name)
);

alter table public.crm_teams enable row level security;
alter table public.crm_team_members enable row level security;
alter table public.crm_tags enable row level security;
alter table public.crm_quick_replies enable row level security;
alter table public.crm_tasks enable row level security;
alter table public.crm_segments enable row level security;

create policy crm_teams_owner on public.crm_teams for all to authenticated using (user_id=(select auth.uid())) with check (user_id=(select auth.uid()));
create policy crm_team_members_owner on public.crm_team_members for all to authenticated using (user_id=(select auth.uid())) with check (user_id=(select auth.uid()));
create policy crm_tags_owner on public.crm_tags for all to authenticated using (user_id=(select auth.uid())) with check (user_id=(select auth.uid()));
create policy crm_quick_replies_owner on public.crm_quick_replies for all to authenticated using (user_id=(select auth.uid())) with check (user_id=(select auth.uid()));
create policy crm_tasks_owner on public.crm_tasks for all to authenticated using (user_id=(select auth.uid())) with check (user_id=(select auth.uid()));
create policy crm_segments_owner on public.crm_segments for all to authenticated using (user_id=(select auth.uid())) with check (user_id=(select auth.uid()));

create or replace function public.crm_assign_conversation(p_conversation_id uuid,p_agent_id uuid default null,p_team_id uuid default null,p_priority text default null)
returns jsonb language plpgsql security definer set search_path=public,pg_catalog as $$
declare v_uid uuid:=auth.uid(); v jsonb;
begin
 if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
 if not exists(select 1 from crm_conversations where id=p_conversation_id and user_id=v_uid) then raise exception 'CONVERSATION_NOT_FOUND'; end if;
 if p_agent_id is not null and not exists(select 1 from crm_agents where id=p_agent_id and user_id=v_uid) then raise exception 'AGENT_NOT_FOUND'; end if;
 if p_team_id is not null and not exists(select 1 from crm_teams where id=p_team_id and user_id=v_uid and active) then raise exception 'TEAM_NOT_FOUND'; end if;
 if p_priority is not null and p_priority not in ('low','normal','high','urgent') then raise exception 'INVALID_PRIORITY'; end if;
 update crm_conversations set assigned_to=coalesce(p_agent_id,assigned_to),priority=coalesce(p_priority,priority),updated_at=now(),metadata=case when p_team_id is null then metadata else jsonb_set(coalesce(metadata,'{}'::jsonb),'{team_id}',to_jsonb(p_team_id::text),true) end where id=p_conversation_id and user_id=v_uid returning jsonb_build_object('id',id,'assigned_to',assigned_to,'priority',priority,'team_id',metadata->>'team_id','updated_at',updated_at) into v;
 return v;
end $$;
revoke all on function public.crm_assign_conversation(uuid,uuid,uuid,text) from public,anon; grant execute on function public.crm_assign_conversation(uuid,uuid,uuid,text) to authenticated;

create or replace function public.crm_complete_task(p_task_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_catalog as $$
declare r crm_tasks;
begin
 if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
 update crm_tasks set status='completed',completed_at=coalesce(completed_at,now()),updated_at=now() where id=p_task_id and user_id=auth.uid() returning * into r;
 if not found then raise exception 'TASK_NOT_FOUND'; end if;
 return jsonb_build_object('id',r.id,'status',r.status,'completed_at',r.completed_at);
end $$;
revoke all on function public.crm_complete_task(uuid) from public,anon; grant execute on function public.crm_complete_task(uuid) to authenticated;

commit;
