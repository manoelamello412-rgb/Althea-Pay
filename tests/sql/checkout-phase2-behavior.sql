\set ON_ERROR_STOP 1
do $$
declare
  org uuid := gen_random_uuid(); uid uuid := gen_random_uuid();
  wa uuid; mail uuid; rule public.crm_remarketing_rules; slow public.crm_remarketing_rules;
  cs uuid; cs2 uuid; old_cs uuid; tx uuid; ob uuid; n int; r jsonb; failed boolean;
begin
  insert into public.organizations values (org); insert into auth.users values (uid);
  insert into public.profiles values (uid, org);
  perform set_config('test.org', org::text, false); perform set_config('test.uid', uid::text, false);
  insert into public.funnels(id, nome, organization_id) values ('fx', 'Funil X', org);
  insert into public.crm_channel_accounts(user_id, organization_id, channel, provider, status) values (uid, org, 'whatsapp', 'infobip', 'active') returning id into wa;
  insert into public.crm_channel_accounts(user_id, organization_id, channel, provider, status) values (uid, org, 'email', 'resend', 'active') returning id into mail;

  -- validação da regra
  failed := false; begin perform public.crm_remarketing_rule_save(null, 'payment_pending', 'email', mail, 5, 'oi'); exception when others then failed := sqlerrm = 'REMARKETING_SUBJECT_REQUIRED'; end;
  assert failed, 'email needs subject';
  failed := false; begin perform public.crm_remarketing_rule_save(null, 'payment_pending', 'whatsapp', wa, 5, 'oi', null, 'Pagar', 'javascript:x'); exception when others then failed := sqlerrm = 'REMARKETING_BUTTON_URL_INVALID'; end;
  assert failed, 'unsafe button url';
  failed := false; begin perform public.crm_remarketing_rule_save(null, 'payment_pending', 'whatsapp', mail, 5, 'oi'); exception when others then failed := sqlerrm = 'REMARKETING_ACCOUNT_INVALID'; end;
  assert failed, 'account channel must match';
  rule := public.crm_remarketing_rule_save(null, 'payment_pending', 'whatsapp', wa, 5, 'Oi {primeiro_nome}', null, 'Pagar', null);
  assert rule.button_url = '{link}', 'button defaults to {link}';
  slow := public.crm_remarketing_rule_save(null, 'payment_pending', 'email', mail, 60, 'Oi', 'Assunto');

  -- fila: PIX pendente há 10 min -> só a regra de 5 min dispara
  insert into public.checkout_sessions(user_id, organization_id, status, funnel_id, created_at) values (uid, org, 'pending', 'fx', now() - interval '10 minutes') returning id into cs;
  insert into public.gateway_transactions(user_id, organization_id, status, metadata, created_at)
    values (uid, org, 'pending', jsonb_build_object('checkout_session_id', cs), now() - interval '10 minutes') returning id into tx;
  perform set_config('test.role', 'service_role', false);
  assert public.enqueue_remarketing_rule_events(100) = 1, 'one rule due';
  assert public.enqueue_remarketing_rule_events(100) = 0, 'idempotent';
  assert exists (select 1 from public.recovery_events where checkout_id = cs and event_type = 'rule:' || rule.id and rule_id = rule.id), 'rule event';
  assert public.enqueue_payment_pending_events(100) = 0, 'legacy 5min nudge skipped when a rule exists';

  -- claim devolve rule_id e não mexe no estado de recuperação do checkout
  select count(*) into n from public.claim_checkout_recovery_events_v1(10) c where c.rule_id = rule.id;
  assert n = 1, 'claim returns rule';
  assert (select recovery_status from public.checkout_sessions where id = cs) is null, 'rule claim leaves cart state alone';

  -- pagamento aprovado: conclui o checkout e cancela outbox/eventos pendentes
  insert into public.crm_channel_message_outbox(user_id, channel, body, status, idempotency_key, metadata)
    values (uid, 'whatsapp', 'oi', 'queued', 'k1', jsonb_build_object('recovery_checkout_id', cs)) returning id into ob;
  insert into public.recovery_events(user_id, organization_id, checkout_id, event_type, status, payload) values (uid, org, cs, 'manual:email:1', 'queued', '{}');
  update public.gateway_transactions set status = 'approved' where id = tx;
  assert (select status from public.checkout_sessions where id = cs) = 'completed', 'checkout completed on approval';
  assert (select completed_at from public.checkout_sessions where id = cs) is not null, 'completed_at set';
  assert (select status from public.crm_channel_message_outbox where id = ob) = 'cancelled', 'queued remarketing cancelled';
  assert not exists (select 1 from public.recovery_events where checkout_id = cs and status in ('queued', 'processing')), 'events cancelled';

  -- botão manual
  perform set_config('test.role', 'authenticated', false);
  failed := false; begin perform public.checkout_remarketing_send_v1(cs, 'email'); exception when others then failed := sqlerrm = 'CHECKOUT_ALREADY_PAID'; end;
  assert failed, 'paid checkout cannot be remarketed';
  insert into public.checkout_sessions(user_id, organization_id, status, abandoned_at) values (uid, org, 'abandoned', now()) returning id into cs2;
  r := public.checkout_remarketing_send_v1(cs2, 'email');
  assert (r->>'rule_id')::uuid = slow.id, 'manual uses the channel rule';
  failed := false; begin perform public.checkout_remarketing_send_v1(cs2, 'email'); exception when others then failed := sqlerrm = 'REMARKETING_RECENTLY_SENT'; end;
  assert failed, 'manual throttled';

  -- regra de abandono respeita a janela de 24h
  perform public.crm_remarketing_rule_save(null, 'checkout_abandoned', 'email', mail, 30, 'Volte', 'Volte');
  insert into public.checkout_sessions(user_id, organization_id, status, abandoned_at, created_at) values (uid, org, 'abandoned', now() - interval '3 days', now() - interval '3 days') returning id into old_cs;
  update public.checkout_sessions set abandoned_at = now() - interval '45 minutes' where id = cs2;
  perform set_config('test.role', 'service_role', false);
  perform public.enqueue_remarketing_rule_events(100);
  assert exists (select 1 from public.recovery_events where checkout_id = cs2 and event_type like 'rule:%'), 'abandoned rule due';
  assert not exists (select 1 from public.recovery_events where checkout_id = old_cs), 'old abandoned ignored';

  -- comprovante manual: caminho precisa ficar na pasta do checkout
  perform set_config('test.role', 'authenticated', false);
  failed := false; begin perform public.checkout_receipt_attach_v1(cs, org || '/outro/x.png', 'image/png', 10); exception when others then failed := sqlerrm = 'INVALID_ATTACHMENT_PATH'; end;
  assert failed, 'receipt path guarded';
  r := public.checkout_receipt_attach_v1(cs, org || '/checkouts/' || cs || '/a.png', 'image/png', 10, 'pix.png');
  assert (r->>'transaction_id')::uuid = tx, 'receipt linked to latest transaction';

  -- lista com filtro de período
  r := public.checkout_operations_page_v1(50, null, null, null, null, null, now() - interval '1 hour', now() + interval '1 hour');
  assert jsonb_array_length(r->'items') = 2, 'period filter: ' || jsonb_array_length(r->'items');
  r := public.checkout_operations_page_v1(50, null, null, 'completed', null, null, null, null);
  assert jsonb_array_length(r->'items') = 1, 'status filter';
end $$;
select 'PHASE 2 CHECKS PASSED';
