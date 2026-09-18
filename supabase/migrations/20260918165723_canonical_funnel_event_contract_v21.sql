alter table public.funnel_event_types
  add column if not exists canonical_event_type text,
  add column if not exists protocol_version text not null default '1',
  add column if not exists deprecated boolean not null default false;

update public.funnel_event_types
set canonical_event_type = case event_type
  when 'page_view' then 'page_viewed'
  when 'purchase' then 'payment_approved'
  when 'upsell' then 'upsell_accepted'
  when 'refund' then 'payment_refunded'
  when 'chargeback' then 'chargeback_created'
  else event_type
end,
deprecated = event_type in ('page_view','purchase','upsell','refund','chargeback');

insert into public.funnel_event_types(event_type,description,enabled,canonical_event_type,protocol_version,deprecated)
values
('session_started','Sessão iniciada',true,'session_started','1',false),
('session_ended','Sessão encerrada',true,'session_ended','1',false),
('page_viewed','Página visualizada',true,'page_viewed','1',false),
('step_viewed','Etapa visualizada',true,'step_viewed','1',false),
('cta_clicked','CTA clicado',true,'cta_clicked','1',false),
('quiz_started','Quiz iniciado',true,'quiz_started','1',false),
('quiz_answered','Resposta de quiz',true,'quiz_answered','1',false),
('form_started','Formulário iniciado',true,'form_started','1',false),
('form_completed','Formulário concluído',true,'form_completed','1',false),
('lead_created','Lead criado',true,'lead_created','1',false),
('offer_viewed','Oferta visualizada',true,'offer_viewed','1',false),
('order_bump_selected','Order bump selecionado',true,'order_bump_selected','1',false),
('order_bump_removed','Order bump removido',true,'order_bump_removed','1',false),
('upsell_viewed','Upsell visualizado',true,'upsell_viewed','1',false),
('upsell_accepted','Upsell aceito',true,'upsell_accepted','1',false),
('upsell_rejected','Upsell recusado',true,'upsell_rejected','1',false),
('downsell_viewed','Downsell visualizado',true,'downsell_viewed','1',false),
('checkout_started','Checkout iniciado',true,'checkout_started','1',false),
('checkout_identified','Checkout identificado',true,'checkout_identified','1',false),
('checkout_abandoned','Checkout abandonado',true,'checkout_abandoned','1',false),
('payment_created','Pagamento criado',true,'payment_created','1',false),
('pix_created','PIX criado',true,'pix_created','1',false),
('pix_displayed','PIX exibido',true,'pix_displayed','1',false),
('pix_copied','PIX copiado',true,'pix_copied','1',false),
('payment_pending','Pagamento pendente',true,'payment_pending','1',false),
('payment_processing','Pagamento processando',true,'payment_processing','1',false),
('payment_approved','Pagamento aprovado',true,'payment_approved','1',false),
('payment_failed','Pagamento falhou',true,'payment_failed','1',false),
('payment_expired','Pagamento expirado',true,'payment_expired','1',false),
('payment_cancelled','Pagamento cancelado',true,'payment_cancelled','1',false),
('refund_created','Reembolso iniciado',true,'refund_created','1',false),
('payment_refunded','Pagamento reembolsado',true,'payment_refunded','1',false),
('chargeback_created','Chargeback criado',true,'chargeback_created','1',false),
('chat_started','Chat iniciado',true,'chat_started','1',false),
('chat_message','Mensagem de chat',true,'chat_message','1',false),
('conversation_assigned','Conversa atribuída',true,'conversation_assigned','1',false),
('conversation_closed','Conversa encerrada',true,'conversation_closed','1',false)
on conflict (event_type) do update set
  description=excluded.description,
  enabled=excluded.enabled,
  canonical_event_type=excluded.canonical_event_type,
  protocol_version=excluded.protocol_version,
  deprecated=excluded.deprecated;

alter table public.integration_events
  add column if not exists protocol_version text not null default '1',
  add column if not exists original_event_type text,
  add column if not exists session_id text,
  add column if not exists visitor_id text,
  add column if not exists customer_id text;

create index if not exists integration_events_org_funnel_session_time_idx
  on public.integration_events(organization_id,funnel_id,session_id,occurred_at desc)
  where session_id is not null;

create index if not exists integration_events_org_visitor_time_idx
  on public.integration_events(organization_id,visitor_id,occurred_at desc)
  where visitor_id is not null;

comment on column public.integration_events.event_type is
  'Canonical Althea event type. Incoming legacy aliases are preserved in original_event_type.';
comment on column public.integration_events.original_event_type is
  'Raw external event type before canonical alias normalization.';
comment on column public.integration_events.protocol_version is
  'Major event contract version accepted by the Althea ingestion pipeline.';
