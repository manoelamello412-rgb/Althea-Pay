-- Campaigns fill link, valor and produto from the contact's latest checkout, like checkout-recovery-worker:
--   link    = checkout metadata recovery/checkout/return/resume url, else the funnel url
--   valor   = checkout amount as "R$ 97,00" (other currencies: "USD 97,00")
--   produto = checkout metadata.product_name, else products.name
-- ponytail: checkout matched by e-mail only (indexed); WhatsApp-only contacts without e-mail get the funnel url
-- of their conversation and empty valor/produto. Add a phone match if that audience matters.

create or replace function private.crm_campaign_checkout_context(p_user_id uuid, p_organization_id uuid, p_conversation_id uuid, p_email text)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public, private
as $function$
  select jsonb_build_object(
    'link', coalesce(
      nullif(btrim(cs.metadata->>'recovery_url'), ''),
      nullif(btrim(cs.metadata->>'checkout_url'), ''),
      nullif(btrim(cs.metadata->>'return_url'), ''),
      nullif(btrim(cs.metadata->>'resume_url'), ''),
      nullif(btrim(f.url), '')),
    'valor', case when cs.id is null then null else
      case when upper(coalesce(cs.currency, 'BRL')) = 'BRL' then 'R$ ' else upper(cs.currency) || ' ' end
      || translate(to_char(coalesce(cs.amount, 0), 'FM999,999,999,990.00'), ',.', '.,') end,
    'produto', coalesce(nullif(btrim(cs.metadata->>'product_name'), ''), nullif(btrim(p.name), ''))
  )
  from public.crm_conversations cv
  left join lateral (
    select s.*
      from public.checkout_sessions s
     where s.user_id = p_user_id
       and s.organization_id = p_organization_id
       and s.customer->>'email' = any(array[p_email, lower(p_email)])
     order by s.created_at desc
     limit 1
  ) cs on true
  left join public.funnels f on f.id::text = coalesce(cs.funnel_id::text, cv.funnel_id::text) and f.organization_id = p_organization_id
  left join public.products p on p.id::text = coalesce(cs.product_id::text, cv.product_id::text) and p.deleted_at is null
  where cv.id = p_conversation_id
$function$;
revoke all on function private.crm_campaign_checkout_context(uuid, uuid, uuid, text) from public, anon, authenticated;

create or replace function public.crm_campaign_enqueue_due(p_limit integer default 5)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $function$
declare
  k record;
  r record;
  v_ctx jsonb;
  v_count integer;
  v_done integer := 0;
begin
  if auth.role() <> 'service_role' and current_user not in ('postgres', 'supabase_admin') then
    raise exception 'forbidden';
  end if;
  for k in
    select cp.*, t.channel, t.body, t.subject, t.variables, t.whatsapp_template_name, t.language
      from public.crm_campaigns cp
      join public.crm_message_templates t on t.id = cp.template_id
     where cp.status = 'scheduled' and cp.scheduled_at <= now()
     order by cp.scheduled_at
     limit greatest(1, least(coalesce(p_limit, 5), 50))
       for update of cp skip locked
  loop
    v_count := 0;
    for r in select * from private.crm_campaign_audience(k.organization_id, k.segment_id, k.channel) loop
      v_ctx := jsonb_build_object('nome', r.display_name, 'primeiro_nome', split_part(coalesce(r.display_name, ''), ' ', 1), 'email', r.email, 'telefone', r.phone);
      -- Checkout lookup only when the template uses it, so plain campaigns stay one query per recipient.
      if k.variables && array['link', 'valor', 'produto'] then
        v_ctx := v_ctx || coalesce(private.crm_campaign_checkout_context(k.user_id, k.organization_id, r.conversation_id,
          coalesce(r.email, (select buyer_email from public.crm_conversations where id = r.conversation_id))), '{}'::jsonb);
      end if;
      insert into public.crm_channel_message_outbox(user_id, organization_id, conversation_id, channel_account_id, channel, direction, body, status, next_attempt_at, idempotency_key, metadata)
      values (k.user_id, k.organization_id, r.conversation_id, k.channel_account_id, k.channel, 'outbound',
              private.crm_render_template(k.body, k.variables, v_ctx), 'queued', now(),
              'campaign:' || k.id || ':' || r.address,
              jsonb_build_object('source', 'campaign', 'campaign_id', k.id, 'email_subject', private.crm_render_template(k.subject, k.variables, v_ctx))
              || case when k.channel = 'whatsapp' then jsonb_build_object('whatsapp_template', jsonb_build_object(
                   'name', k.whatsapp_template_name, 'language', k.language, 'placeholders', private.crm_template_placeholders(k.variables, v_ctx)))
                 else '{}'::jsonb end)
      on conflict (user_id, idempotency_key) do nothing;
      v_count := v_count + 1;
    end loop;
    update public.crm_campaigns set status = 'enqueued', enqueued_at = now(), recipient_count = v_count, updated_at = now() where id = k.id;
    v_done := v_done + 1;
  end loop;
  return v_done;
end;
$function$;
revoke all on function public.crm_campaign_enqueue_due(integer) from public, anon, authenticated;
grant execute on function public.crm_campaign_enqueue_due(integer) to service_role;
