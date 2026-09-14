create unique index if not exists crm_messages_provider_external_message_uidx
on public.crm_messages (user_id, provider, external_message_id)
where external_message_id is not null;

create unique index if not exists crm_channel_delivery_events_dedupe_uidx
on public.crm_channel_delivery_events
(channel_account_id, external_message_id, status, (md5(provider_event::text)));
