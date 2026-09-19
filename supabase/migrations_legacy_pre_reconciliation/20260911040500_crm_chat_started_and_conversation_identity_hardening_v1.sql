-- CRM chat integrity hardening: prevent duplicate active funnel conversations per customer email.
create unique index if not exists crm_conversations_active_email_per_funnel_uq
  on public.crm_conversations (user_id, funnel_id, lower(buyer_email))
  where buyer_email is not null and status in ('open','pending');

-- Keep the canonical operator-visible conversation state finite and explicit.
alter table public.crm_conversations drop constraint if exists crm_conversations_status_check;
alter table public.crm_conversations
  add constraint crm_conversations_status_check
  check (status in ('open','pending','closed'));

create index if not exists crm_conversations_customer_id_idx
  on public.crm_conversations (user_id, customer_id)
  where customer_id is not null;
