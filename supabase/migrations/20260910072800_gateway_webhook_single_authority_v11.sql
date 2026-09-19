CREATE OR REPLACE FUNCTION public.process_gateway_webhook_v11(
  p_webhook_id uuid,
  p_next_status text,
  p_external_transaction_id text,
  p_failure_code text DEFAULT NULL,
  p_event_kind text DEFAULT 'payment',
  p_amount numeric DEFAULT NULL,
  p_currency text DEFAULT NULL,
  p_external_event_id text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog','public'
AS $function$
DECLARE
  v_event public.gateway_webhook_events%ROWTYPE;
  v_gateway public.gateways%ROWTYPE;
  v_tx public.gateway_transactions%ROWTYPE;
  v_attempt public.gateway_payment_attempts%ROWTYPE;
  v_count integer;
  v_next text := lower(trim(coalesce(p_next_status,'')));
  v_kind text := lower(trim(coalesce(p_event_kind,'payment')));
  v_external text := nullif(trim(coalesce(p_external_transaction_id,'')),'');
  v_currency text;
  v_amount numeric;
BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF p_webhook_id IS NULL OR v_external IS NULL THEN RAISE EXCEPTION 'webhook_identity_required'; END IF;
  IF v_next NOT IN ('approved','pending','failed','refunded','chargeback','created') THEN RAISE EXCEPTION 'invalid_webhook_status'; END IF;
  IF v_kind NOT IN ('payment','refund','chargeback') THEN RAISE EXCEPTION 'invalid_webhook_event_kind'; END IF;

  SELECT * INTO v_event FROM public.gateway_webhook_events WHERE id=p_webhook_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'webhook_not_found'; END IF;
  IF v_event.status='processed' THEN
    RETURN jsonb_build_object('processed',true,'duplicate',true,'webhook_id',v_event.id);
  END IF;

  SELECT g.* INTO v_gateway FROM public.gateways g WHERE g.id=v_event.gateway_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'gateway_not_found'; END IF;

  SELECT t.* INTO v_tx
  FROM public.gateway_transactions t
  WHERE t.user_id=v_gateway.user_id
    AND t.gateway_id=v_gateway.id
    AND t.external_id=v_external
  ORDER BY t.created_at DESC
  LIMIT 1
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'transaction_not_found'; END IF;

  SELECT count(*) INTO v_count
  FROM public.gateway_payment_attempts a
  WHERE a.user_id=v_gateway.user_id AND a.transaction_id=v_tx.id
    AND a.gateway_id=v_gateway.id
    AND a.external_transaction_id=v_external;
  IF v_count>1 THEN RAISE EXCEPTION 'ambiguous_attempt'; END IF;

  IF v_count=1 THEN
    SELECT * INTO v_attempt FROM public.gateway_payment_attempts a
    WHERE a.user_id=v_gateway.user_id AND a.transaction_id=v_tx.id
      AND a.gateway_id=v_gateway.id AND a.external_transaction_id=v_external
    ORDER BY a.attempt_order DESC LIMIT 1 FOR UPDATE;
  ELSE
    SELECT count(*) INTO v_count FROM public.gateway_payment_attempts a
    WHERE a.user_id=v_gateway.user_id AND a.transaction_id=v_tx.id
      AND a.gateway_id=v_gateway.id AND a.status='pending';
    IF v_count<>1 THEN RAISE EXCEPTION 'ambiguous_attempt'; END IF;
    SELECT * INTO v_attempt FROM public.gateway_payment_attempts a
    WHERE a.user_id=v_gateway.user_id AND a.transaction_id=v_tx.id
      AND a.gateway_id=v_gateway.id AND a.status='pending'
    ORDER BY a.attempt_order DESC LIMIT 1 FOR UPDATE;
  END IF;

  IF v_kind='payment' THEN
    PERFORM public.transition_gateway_transaction_status(
      v_tx.id,v_gateway.user_id,
      CASE WHEN v_next='failed' THEN 'failed' ELSE v_next END,
      nullif(trim(coalesce(p_failure_code,'')),''),v_external,v_tx.version
    );
    UPDATE public.gateway_payment_attempts SET
      status=CASE WHEN v_next='failed' THEN 'declined' WHEN v_next='approved' THEN 'approved' WHEN v_next='pending' THEN 'pending' ELSE status END,
      failure_class=CASE WHEN v_next='failed' THEN coalesce(nullif(trim(coalesce(p_failure_code,'')),''),'declined') ELSE failure_class END,
      external_transaction_id=v_external,
      updated_at=now(),
      completed_at=CASE WHEN v_next IN ('approved','failed') THEN coalesce(completed_at,now()) ELSE completed_at END
    WHERE id=v_attempt.id AND user_id=v_gateway.user_id;
  ELSIF v_kind='refund' THEN
    v_currency:=coalesce(nullif(upper(trim(coalesce(p_currency,''))),''),upper(v_tx.currency));
    v_amount:=coalesce(p_amount,v_tx.amount);
    INSERT INTO public.gateway_refunds(user_id,transaction_id,gateway_id,idempotency_key,amount,currency,status,external_refund_id,metadata,completed_at)
    VALUES(v_gateway.user_id,v_tx.id,v_gateway.id,'webhook:'||v_event.id::text,v_amount,v_currency,'approved',v_external,jsonb_build_object('source','gateway_webhook','provider_event_id',v_event.provider_event_id),now())
    ON CONFLICT (user_id,idempotency_key) DO NOTHING;
    PERFORM public.transition_gateway_transaction_status(v_tx.id,v_gateway.user_id,'refunded',null,v_tx.external_id,v_tx.version);
    UPDATE public.gateway_payment_attempts SET status='approved',updated_at=now(),completed_at=coalesce(completed_at,now()) WHERE id=v_attempt.id AND user_id=v_gateway.user_id;
  ELSE
    v_currency:=coalesce(nullif(upper(trim(coalesce(p_currency,''))),''),upper(v_tx.currency));
    v_amount:=coalesce(p_amount,v_tx.amount);
    INSERT INTO public.disputes(user_id,transaction_id,gateway_id,external_dispute_id,status,amount,currency,metadata)
    VALUES(v_gateway.user_id,v_tx.id,v_gateway.id,v_external,'open',v_amount,v_currency,jsonb_build_object('source','gateway_webhook','provider_event_id',v_event.provider_event_id))
    ON CONFLICT DO NOTHING;
    PERFORM public.transition_gateway_transaction_status(v_tx.id,v_gateway.user_id,'chargeback',null,v_tx.external_id,v_tx.version);
    UPDATE public.gateway_payment_attempts SET status='approved',updated_at=now(),completed_at=coalesce(completed_at,now()) WHERE id=v_attempt.id AND user_id=v_gateway.user_id;
  END IF;

  UPDATE public.gateway_webhook_events SET status='processed',processed_at=now(),updated_at=now(),last_error=NULL WHERE id=v_event.id;
  RETURN jsonb_build_object('processed',true,'duplicate',false,'webhook_id',v_event.id,'transaction_id',v_tx.id,'attempt_id',v_attempt.id,'status',v_next,'event_kind',v_kind);
END;
$function$;
REVOKE ALL ON FUNCTION public.process_gateway_webhook_v11(uuid,text,text,text,text,numeric,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.process_gateway_webhook_v11(uuid,text,text,text,text,numeric,text,text) TO service_role;