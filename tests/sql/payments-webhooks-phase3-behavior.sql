\set ON_ERROR_STOP 1
do $$
declare
  org uuid := gen_random_uuid(); uid uuid := gen_random_uuid(); t1 uuid; wh uuid; conv uuid; blocked_conv uuid; r jsonb; ev public.outbound_webhook_events; n int;
begin
  insert into public.organizations values (org); insert into auth.users values (uid);
  perform set_config('test.org', org::text, false); perform set_config('test.uid', uid::text, false);
  perform set_config('test.role', 'authenticated', false);
  insert into public.funnels(id, nome, organization_id) values ('f3', 'Funil 3', org), ('f4', 'Outro', org);

  -- resumo: bruto - taxa = líquido; taxa da conciliação ou do metadata; % de estorno/chargeback
  insert into public.gateway_transactions(user_id, organization_id, status, amount) values (uid, org, 'approved', 100) returning id into t1;
  insert into public.reconciliation_items(transaction_id, provider_fee) values (t1, 5);
  insert into public.gateway_transactions(user_id, organization_id, status, amount, metadata) values (uid, org, 'approved', 50, '{"fee":"2.5"}');
  insert into public.gateway_transactions(user_id, organization_id, status, amount) values (uid, org, 'approved', 30), (uid, org, 'refunded', 20), (uid, org, 'chargeback', 10);
  insert into public.gateway_transactions(user_id, organization_id, status, amount, created_at) values (uid, org, 'approved', 999, now() - interval '40 days');
  r := public.transactions_summary_v1(now() - interval '1 day', now() + interval '1 day');
  assert (r->>'gross')::numeric = 180 and (r->>'fees')::numeric = 7.5 and (r->>'net')::numeric = 172.5, 'gross-fee=net: ' || r::text;
  assert (r->>'fee_missing_count')::int = 1, 'fee missing';
  assert (r->>'refunded_pct')::numeric = 9.52 and (r->>'chargeback_pct')::numeric = 4.76, 'pcts: ' || r::text;
  r := public.transactions_list_v1(50, null, null, null, null, null, null, now() - interval '1 day', null);
  assert jsonb_array_length(r->'items') = 5, 'list period: ' || jsonb_array_length(r->'items');

  -- clientes: busca por CPF com pontuação acha o salvo só com dígitos
  insert into public.clients values ('c1', org, uid, '{"name":"Ana","cpf":"12345678901"}'), ('c2', org, uid, '{"name":"Bia"}');
  r := public.clients_page_v1('123.456.789-01');
  assert (r->>'total')::int = 1 and r->'items'->0->>'id' = 'c1', 'cpf search';
  r := public.clients_page_v1(null, now() - interval '1 hour', now() + interval '1 hour');
  assert (r->>'total')::int = 2, 'clients by day';

  -- webhooks: só enfileira o que alguém escuta, respeitando o funil
  assert not exists (select 1 from public.outbound_webhook_events), 'no webhook, no queue';
  insert into public.outbound_webhooks(user_id, organization_id, name, endpoint_url, events, funnel_id, kind, secret_ref)
    values (uid, org, 'Pushcut', 'https://api.pushcut.io/x', array['transaction.approved','message.received'], 'f3', 'pushcut',
            vault.create_secret('whsec_abc', 'n', 'd')::text) returning id into wh;
  insert into public.gateway_transactions(user_id, organization_id, status, amount, funnel_id) values (uid, org, 'pending', 10, 'f3') returning id into t1;
  assert not exists (select 1 from public.outbound_webhook_events), 'pending not subscribed';
  update public.gateway_transactions set status = 'approved' where id = t1;
  insert into public.gateway_transactions(user_id, organization_id, status, amount, funnel_id) values (uid, org, 'approved', 10, 'f4');
  assert (select count(*) from public.outbound_webhook_events where event_type = 'transaction.approved') = 1, 'only funnel f3';
  assert (select payload->>'funnel_name' from public.outbound_webhook_events limit 1) = 'Funil 3', 'payload funnel name';

  insert into public.crm_conversations(user_id, organization_id, funnel_id, buyer_name) values (uid, org, 'f3', 'Leo') returning id into conv;
  insert into public.crm_messages(conversation_id, user_id, direction, channel, body) values (conv, uid, 'inbound', 'webchat', 'quero comprar');
  insert into public.crm_conversations(user_id, organization_id, funnel_id, blocked) values (uid, org, 'f3', true) returning id into blocked_conv;
  insert into public.crm_messages(conversation_id, user_id, direction, channel, body) values (blocked_conv, uid, 'inbound', 'webchat', 'spam');
  assert (select count(*) from public.outbound_webhook_events where event_type = 'message.received') = 1, 'message.received, not from blocked';

  -- fila: claim, retry com espera, done
  perform set_config('test.role', 'service_role', false);
  select count(*) into n from public.outbound_webhook_claim_v1(10);
  assert n = 2, 'claim';
  select * into ev from public.outbound_webhook_events where event_type = 'message.received';
  perform public.outbound_webhook_finish_v1(ev.id, true);
  assert (select status from public.outbound_webhook_events where id = ev.id) = 'pending'
     and (select next_attempt_at from public.outbound_webhook_events where id = ev.id) > now(), 'retry later';
  perform public.outbound_webhook_finish_v1(ev.id, false);
  assert (select status from public.outbound_webhook_events where id = ev.id) = 'done', 'done';
  assert public.outbound_webhook_secret_v1(wh) = 'whsec_abc', 'secret read from vault';

  -- teste manual
  perform set_config('test.role', 'authenticated', false);
  perform public.outbound_webhook_test_v1(wh);
  assert exists (select 1 from public.outbound_webhook_events where event_type = 'webhook.test' and target_webhook_id = wh), 'test event';
end $$;
select 'PHASE 3 CHECKS PASSED';
