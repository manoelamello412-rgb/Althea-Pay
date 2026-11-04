\set ON_ERROR_STOP 1
do $$
declare org uuid := gen_random_uuid(); uid uuid := gen_random_uuid(); acc jsonb; t public.crm_message_templates; seg uuid := gen_random_uuid(); out jsonb;
begin
  insert into public.organizations values (org); insert into auth.users values (uid);
  perform set_config('test.org', org::text, false); perform set_config('test.uid', uid::text, false);

  -- Remetente Resend: key no Vault, nunca devolvida.
  begin perform public.crm_email_configure('vendas@loja.com'); assert false, 'new account needs key';
  exception when others then assert sqlerrm = 'RESEND_API_KEY_REQUIRED', sqlerrm; end;
  begin perform public.crm_email_configure('não é email', null, null, 're_abcdefghijkl'); assert false, 'bad from';
  exception when others then assert sqlerrm = 'EMAIL_FROM_INVALID', sqlerrm; end;
  acc := public.crm_email_configure(' Vendas@Loja.com ', 'Loja "X"', 'suporte@loja.com', 're_abcdefghijkl');
  assert acc->>'from_email' = 'vendas@loja.com' and acc->>'from_name' = 'Loja X' and (acc->>'has_api_key')::boolean, acc::text;
  assert acc::text not like '%re_abc%', 'key leaked';
  assert public.crm_channel_account_credentials((acc->>'id')::uuid)->>'api_key' = 're_abcdefghijkl', 'dispatcher reads key';
  acc := public.crm_email_configure('vendas@loja.com', null, null, null, (acc->>'id')::uuid);
  assert public.crm_channel_account_credentials((acc->>'id')::uuid)->>'api_key' = 're_abcdefghijkl', 'blank key keeps it';
  assert acc->>'reply_to' is null and acc->>'from_name' is null, 'cleared optional fields';
  begin perform public.crm_email_configure('vendas@loja.com', null, null, 're_abcdefghijkl'); assert false, 'dup';
  exception when others then assert sqlerrm = 'EMAIL_FROM_TAKEN', sqlerrm; end;

  -- Template de e-mail com cabeçalho e botão.
  begin perform public.crm_template_save(null, 'ruim', 'email', 'b', '{}', 's', p_email_header_url => 'http://x/logo.png'); assert false, 'http header';
  exception when others then assert sqlerrm = 'TEMPLATE_INVALID', sqlerrm; end;
  t := public.crm_template_save(null, 'carrinho', 'email', 'Oi {{1}}', array['primeiro_nome','link'], 'Volte {{1}}',
         p_email_header_url => 'https://cdn.x/logo.png', p_email_button_text => 'Pagar', p_email_button_url => '');
  assert t.email_button_url = '{link}', 'button defaults to {link}';
  t := public.crm_template_save(t.id, 'carrinho', 'email', 'Oi {{1}}', array['primeiro_nome','link'], 'Volte {{1}}',
         p_email_header_url => 'https://cdn.x/logo.png', p_email_button_text => 'Pagar', p_email_button_url => '{{2}}');

  -- Campanha leva cabeçalho e botão renderizados para o outbox.
  insert into public.crm_campaigns(organization_id, user_id, name, channel_account_id, template_id, segment_id, status, scheduled_at)
  values (org, uid, 'c1', (acc->>'id')::uuid, t.id, seg, 'scheduled', now() - interval '1 minute');
  perform set_config('test.role', 'service_role', false);
  assert public.crm_campaign_enqueue_due(5) = 1, 'enqueued';
  select metadata into out from public.crm_channel_message_outbox where organization_id = org;
  assert out->>'email_subject' = 'Volte Ana', out::text;
  assert out->>'email_header_url' = 'https://cdn.x/logo.png', out::text;
  assert out->'email_button' = '{"text":"Pagar","url":"https://pay.x/c/1"}'::jsonb, out::text;
  assert (select body from public.crm_channel_message_outbox where organization_id = org) = 'Oi Ana', 'body';
end $$;
select 'PHASE 6 CHECKS PASSED';
