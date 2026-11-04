insert into public.gateway_provider_registry (provider_key,display_name,credential_schema,capabilities,operational,is_custom_or_webhook_only,is_active,adapter_key,adapter_url)
values (
  'sigilopay',
  'SigiloPay (PIX)',
  jsonb_build_object('fields',jsonb_build_array(
    jsonb_build_object('name','public_key','label','Chave pública (x-public-key)','type','password','required',true),
    jsonb_build_object('name','secret_key','label','Chave secreta (x-secret-key)','type','password','required',true),
    jsonb_build_object('name','webhook_secret','label','Token do webhook (gere um valor aleatório longo)','type','password','required',true)
  )),
  jsonb_build_object('create_payment',true,'payment_status',true,'retrieve_payment',true,'refund',false,'health_check',true,'webhook',true,'payment_methods',jsonb_build_array('pix')),
  true,false,true,'sigilopay',null
)
on conflict (provider_key) do update set display_name=excluded.display_name,credential_schema=excluded.credential_schema,capabilities=excluded.capabilities,operational=excluded.operational,is_custom_or_webhook_only=excluded.is_custom_or_webhook_only,is_active=excluded.is_active,adapter_key=excluded.adapter_key,adapter_url=excluded.adapter_url,updated_at=now();

-- Contingência no checkout: um Pix só cobra quando o cliente paga o QR que viu, e o QR de uma tentativa que deu
-- timeout/erro nunca chega ao cliente. Então trocar de gateway num Pix não tem risco de cobrança dupla; o guard
-- continua valendo para cartão e demais métodos.
CREATE OR REPLACE FUNCTION public.guard_gateway_ambiguous_failover() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_exists boolean; v_base text;
BEGIN
  v_base := split_part(NEW.idempotency_key, ':', 1);
  IF NEW.idempotency_key IS NULL OR v_base = '' THEN RETURN NEW; END IF;
  SELECT EXISTS (
    SELECT 1 FROM public.gateway_payment_attempts a
    WHERE a.user_id = NEW.user_id
      AND split_part(a.idempotency_key, ':', 1) = v_base
      AND a.id <> NEW.id
      AND a.gateway_id IS DISTINCT FROM NEW.gateway_id
      AND a.failure_class IN ('timeout','technical','unavailable','unknown')
  ) AND NOT EXISTS (
    SELECT 1 FROM public.gateway_transactions t
    WHERE t.id = NEW.transaction_id AND lower(coalesce(t.metadata->>'payment_method','')) = 'pix'
  ) INTO v_exists;
  IF v_exists THEN RAISE EXCEPTION 'ambiguous_gateway_attempt_requires_status_recovery'; END IF;
  IF NEW.failure_class IN ('timeout','technical','unavailable','unknown') THEN
    INSERT INTO public.gateway_recovery_queue(user_id,attempt_id,transaction_id,gateway_id,provider,idempotency_key,failure_class,external_transaction_id)
    VALUES (NEW.user_id,NEW.id,NEW.transaction_id,NEW.gateway_id,NEW.gateway_name,NEW.idempotency_key,NEW.failure_class,NEW.external_transaction_id)
    ON CONFLICT (user_id,attempt_id) DO NOTHING;
  END IF;
  RETURN NEW;
END; $$;
REVOKE EXECUTE ON FUNCTION public.guard_gateway_ambiguous_failover() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.guard_gateway_ambiguous_failover() TO service_role;
