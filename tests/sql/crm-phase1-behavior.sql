\set ON_ERROR_STOP 1
do $$
declare
  org uuid := gen_random_uuid(); uid uuid := gen_random_uuid();
  conv uuid; wa uuid; empty uuid; paid uuid; old_open uuid; pin_c uuid; tx uuid; n int; r jsonb; acc jsonb; acc2 jsonb;
begin
  insert into public.organizations values (org); insert into auth.users values (uid);
  perform set_config('test.org', org::text, false); perform set_config('test.uid', uid::text, false);
  insert into public.funnels values ('f1', 'Mapa da Expansão', org, null);

  -- 1.3: chat do funil -> boas-vindas, depois opção 3 -> atendente e para
  insert into public.crm_conversations(user_id, organization_id, funnel_id, buyer_name) values (uid, org, 'f1', 'Maria Silva') returning id into conv;
  insert into public.crm_messages(conversation_id, user_id, direction, channel, body) values (conv, uid, 'inbound', 'webchat', 'oi');
  select body into r from (select to_jsonb(m.body) body from public.crm_messages m where conversation_id = conv and direction = 'outbound') x;
  assert r::text like '%Maria%Mapa da Expansão%', 'welcome with name/funnel: ' || coalesce(r::text, 'null');
  assert (select count(*) from public.crm_channel_message_outbox where conversation_id = conv) = 1, 'outbox for welcome';
  assert (select count(*) from public.crm_messages where conversation_id = conv and metadata->>'outbox_id' is not null) = 1, 'local message links outbox';
  insert into public.crm_messages(conversation_id, user_id, direction, channel, body) values (conv, uid, 'inbound', 'webchat', '1');
  assert exists (select 1 from public.crm_messages where conversation_id = conv and body like 'Seu pagamento está: ainda não%'), 'status reply';
  insert into public.crm_messages(conversation_id, user_id, direction, channel, body) values (conv, uid, 'inbound', 'webchat', '3');
  assert (select metadata->>'human_requested' from public.crm_conversations where id = conv) = 'true', 'human requested';
  assert (select status from public.crm_conversations where id = conv) = 'pending', 'pending after human';
  insert into public.crm_messages(conversation_id, user_id, direction, channel, body) values (conv, uid, 'inbound', 'webchat', 'alguém?');
  assert (select count(*) from public.crm_messages where conversation_id = conv and direction = 'outbound') = 3, 'no autoreply after human';

  -- WhatsApp nunca recebe automática
  insert into public.crm_conversations(user_id, organization_id, primary_channel, customer_whatsapp, buyer_name) values (uid, org, 'whatsapp', '+55 11 99999-0000', 'João') returning id into wa;
  insert into public.crm_messages(conversation_id, user_id, direction, channel, body) values (wa, uid, 'inbound', 'whatsapp', 'oi');
  assert not exists (select 1 from public.crm_messages where conversation_id = wa and direction = 'outbound'), 'no whatsapp autoreply';

  -- operador respondeu -> automático para
  insert into public.crm_conversations(user_id, organization_id, funnel_id) values (uid, org, 'f1') returning id into old_open;
  insert into public.crm_messages(conversation_id, user_id, direction, channel, body, metadata) values (old_open, uid, 'outbound', 'funnel_chat', 'Olá, sou a Ana', '{"source":"crm_operator"}');
  insert into public.crm_messages(conversation_id, user_id, direction, channel, body) values (old_open, uid, 'inbound', 'webchat', 'oi');
  assert (select count(*) from public.crm_messages where conversation_id = old_open and direction = 'outbound') = 1, 'operator silences automation';

  -- desligado por funil
  perform public.crm_funnel_chat_flow_save('f1', false, '{}');
  insert into public.crm_conversations(user_id, organization_id, funnel_id) values (uid, org, 'f1') returning id into pin_c;
  insert into public.crm_messages(conversation_id, user_id, direction, channel, body) values (pin_c, uid, 'inbound', 'webchat', 'oi');
  assert not exists (select 1 from public.crm_messages where conversation_id = pin_c and direction = 'outbound'), 'flow disabled';
  r := public.crm_funnel_chat_flow_save(null, true, '{"welcome":"Bem-vindo {nome}","x":"ignored"}');
  assert r->'texts'->>'welcome' = 'Bem-vindo {nome}' and not (r->'texts' ? 'x'), 'save keeps known keys';

  -- 1.5: bloquear -> conversa nova do mesmo número cai em bloqueados e sem não lidas
  r := public.crm_contact_block(wa, true, 'spam');
  assert (select blocked from public.crm_conversations where id = wa), 'blocked flag';
  delete from public.crm_conversations where id = wa; -- simula a limpeza
  insert into public.crm_conversations(user_id, organization_id, primary_channel, customer_whatsapp) values (uid, org, 'whatsapp', '5511999990000') returning id into wa;
  assert (select blocked from public.crm_conversations where id = wa), 'new conversation from blocked number is blocked';
  insert into public.crm_messages(conversation_id, user_id, direction, channel, body) values (wa, uid, 'inbound', 'whatsapp', 'de novo');
  assert (select unread_count from public.crm_conversations where id = wa) = 0, 'blocked stays quiet';

  -- abas
  r := public.crm_multicrm_conversations_page(50, null, null, null, 'blocked');
  assert jsonb_array_length(r->'items') = 1 and r->'items'->0->>'id' = wa::text, 'blocked tab: ' || r::text;
  assert r->'items'->0->>'source_label' = 'WhatsApp', 'source label';
  r := public.crm_multicrm_conversations_page(50, null, null, null, 'all');
  assert not exists (select 1 from jsonb_array_elements(r->'items') e where e->>'id' = wa::text), 'blocked hidden from all';
  assert exists (select 1 from jsonb_array_elements(r->'items') e where e->>'funnel_name' = 'Mapa da Expansão' and e->>'source_label' = 'Chat do funil'), 'funnel name';
  r := public.crm_multicrm_conversations_page(50, null, null, null, 'today');
  assert jsonb_array_length(r->'items') >= 3, 'today tab';
  r := public.crm_contact_block(wa, false);
  assert not (select blocked from public.crm_conversations where id = wa), 'unblock';

  -- 1.5: limpeza 48h
  insert into public.gateway_transactions(user_id, organization_id, status) values (uid, org, 'approved') returning id into tx;
  insert into public.crm_conversations(user_id, organization_id, transaction_id, last_message_at) values (uid, org, tx::text, now() - interval '3 days') returning id into paid;
  update public.crm_conversations set last_message_at = now() - interval '3 days', updated_at = now() - interval '3 days' where id in (conv, old_open, pin_c);
  update public.crm_conversations set pinned = true where id = pin_c;
  update public.crm_conversations set assigned_to = uid, status = 'open' where id = old_open;
  insert into public.crm_conversations(user_id, organization_id, last_message_at) values (uid, org, now() - interval '49 hours') returning id into empty;
  n := private.crm_conversations_purge_48h();
  assert n = 2, 'purged count ' || n; -- conv (pending, sem pagamento) e a vazia de 49h
  assert not exists (select 1 from public.crm_conversations where id = conv), 'old unpaid deleted';
  assert not exists (select 1 from public.crm_messages where conversation_id = conv), 'messages cascade';
  assert exists (select 1 from public.crm_conversations where id = paid), 'paid kept';
  assert exists (select 1 from public.crm_conversations where id = pin_c), 'pinned kept';
  assert exists (select 1 from public.crm_conversations where id = old_open), 'assigned open kept';
  assert exists (select 1 from public.crm_conversations where id = wa), 'recent kept';
  r := public.crm_multicrm_conversations_page(50, null, null, null, 'paid');
  assert jsonb_array_length(r->'items') = 1, 'paid tab';

  -- delete manual
  perform set_config('test.role_name', 'agent', false);
  begin perform public.crm_conversation_delete(wa); assert false, 'agent cannot delete'; exception when insufficient_privilege then null; end;
  perform set_config('test.role_name', 'owner', false);
  perform public.crm_conversation_delete(wa);
  assert not exists (select 1 from public.crm_conversations where id = wa), 'deleted';

  -- 1.1: dois números, provedor travado, número duplicado recusado, Baileys nasce inativo
  acc := public.crm_whatsapp_configure('infobip', 'abc.api.infobip.com', '11999990000', 'key1', null, 'Suporte');
  acc2 := public.crm_whatsapp_configure('infobip', 'abc.api.infobip.com', '11988880000', 'key2', null, 'Vendas');
  assert jsonb_array_length(public.crm_whatsapp_settings()) = 2, 'two numbers';
  assert acc->>'from_number' = '5511999990000' and acc->>'webhook_token' is not null, 'infobip saved';
  begin perform public.crm_whatsapp_configure('infobip', 'abc.api.infobip.com', '11988880000', 'k', (acc->>'id')::uuid); assert false, 'dup number';
  exception when unique_violation then null; end;
  begin perform public.crm_whatsapp_configure('baileys', null, null, null, (acc->>'id')::uuid); assert false, 'provider locked';
  exception when invalid_parameter_value then null; end;
  acc := public.crm_whatsapp_configure('baileys');
  assert acc->>'status' = 'inactive', 'baileys starts inactive';
  perform public.crm_whatsapp_mark_paired((acc->>'id')::uuid, '+55 11 97777-0000');
  assert (select status = 'active' and external_account_id = '5511977770000' from public.crm_channel_accounts where id = (acc->>'id')::uuid), 'paired';

  -- Fase 0: trava de documento e financial_metrics
  insert into public.merchant_business_profiles values (uid, 'CPF', '12345678901', 'X', '{"financial_metrics":{"gmv":1},"state_registration":"IE1"}', now());
  assert (select not (operation_metadata ? 'financial_metrics') from public.merchant_business_profiles where user_id = uid), 'insert strips metrics';
  begin update public.merchant_business_profiles set document_number = '999' where user_id = uid; assert false, 'doc locked';
  exception when insufficient_privilege then null; end;
  update public.merchant_business_profiles set operation_metadata = operation_metadata || '{"financial_metrics":{"gmv":999},"trade_name":"Y"}' where user_id = uid;
  assert (select operation_metadata->'financial_metrics' = '{}'::jsonb and operation_metadata->>'trade_name' = 'Y' from public.merchant_business_profiles where user_id = uid), 'metrics not writable';
  raise notice 'ALL BEHAVIOR CHECKS PASSED';
end $$;
