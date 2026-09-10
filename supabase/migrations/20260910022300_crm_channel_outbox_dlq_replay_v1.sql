create table if not exists public.crm_channel_outbox_replay_events (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null,
 outbox_id uuid not null references public.crm_channel_message_outbox(id) on delete cascade,
 replay_key text not null,
 reason text,
 requested_by uuid not null,
 created_at timestamptz not null default now(),
 unique(outbox_id,replay_key)
);

create index if not exists crm_channel_outbox_replay_events_user_idx
 on public.crm_channel_outbox_replay_events(user_id,created_at desc);
create index if not exists crm_channel_outbox_replay_events_outbox_idx
 on public.crm_channel_outbox_replay_events(outbox_id,created_at desc);

alter table public.crm_channel_outbox_replay_events enable row level security;
drop policy if exists crm_channel_outbox_replay_events_owner on public.crm_channel_outbox_replay_events;
create policy crm_channel_outbox_replay_events_owner
 on public.crm_channel_outbox_replay_events
 for select to authenticated
 using (user_id=(select auth.uid()));

create or replace function public.crm_replay_channel_outbox(
 p_outbox_id uuid,
 p_replay_key text,
 p_reason text default null
)
returns jsonb
language plpgsql
security invoker
set search_path=public
as $$
declare
 o public.crm_channel_message_outbox%rowtype;
 r_id uuid;
begin
 if auth.uid() is null then raise exception 'not_authenticated'; end if;
 if nullif(trim(p_replay_key),'') is null then raise exception 'replay_key_required'; end if;

 select * into o
 from public.crm_channel_message_outbox
 where id=p_outbox_id and user_id=(select auth.uid())
 for update;

 if not found then raise exception 'outbox_not_found'; end if;
 if o.status <> 'dead_letter' then raise exception 'outbox_not_dead_letter'; end if;

 insert into public.crm_channel_outbox_replay_events(user_id,outbox_id,replay_key,reason,requested_by)
 values ((select auth.uid()),o.id,p_replay_key,p_reason,(select auth.uid()))
 on conflict (outbox_id,replay_key) do nothing
 returning id into r_id;

 if r_id is null then
   return jsonb_build_object('replayed',false,'idempotent',true,'outbox_id',o.id);
 end if;

 update public.crm_channel_message_outbox
 set status='queued',
     next_attempt_at=now(),
     failed_at=null,
     last_error=null,
     updated_at=now(),
     metadata=jsonb_set(
       coalesce(metadata,'{}'::jsonb),
       '{dlq_replay}',
       jsonb_build_object('replay_id',r_id,'replay_key',p_replay_key,'reason',p_reason,'requested_by',(select auth.uid()),'requested_at',now()),
       true
     )
 where id=o.id;

 return jsonb_build_object('replayed',true,'idempotent',false,'replay_id',r_id,'outbox_id',o.id);
end;
$$;

revoke all on function public.crm_replay_channel_outbox(uuid,text,text) from public,anon;
grant execute on function public.crm_replay_channel_outbox(uuid,text,text) to authenticated;
