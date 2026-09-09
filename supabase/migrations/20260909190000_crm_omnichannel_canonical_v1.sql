alter table public.crm_messages add column if not exists provider text not null default 'internal';
alter table public.crm_messages add column if not exists external_message_id text;
alter table public.crm_messages add column if not exists channel_account_id text;
alter table public.crm_conversations add column if not exists primary_channel text not null default 'funnel_chat';
alter table public.crm_conversations add column if not exists channel_account_id text;

create index if not exists crm_messages_external_identity_idx
on public.crm_messages(user_id,provider,external_message_id)
where external_message_id is not null;

create index if not exists crm_messages_channel_account_created_idx
on public.crm_messages(user_id,channel,channel_account_id,created_at desc);

create index if not exists crm_conversations_channel_account_idx
on public.crm_conversations(user_id,primary_channel,channel_account_id);

alter table public.crm_messages
add constraint crm_messages_channel_ck
check (channel in ('funnel_chat','whatsapp','instagram','messenger','email','sms','webchat','internal'));

alter table public.crm_messages
add constraint crm_messages_provider_ck
check (length(provider) between 1 and 80);
