-- Final structural hardening for Multi-Gateway.
-- No gateway/provider connection or production data is created.

CREATE OR REPLACE FUNCTION public.allocate_and_insert_gateway_payment_attempt(
  p_user_id uuid,
  p_transaction_id uuid,
  p_gateway_id text,
  p_gateway_name text,
  p_idempotency_key text,
  p_status text DEFAULT 'pending',
  p_failure_class text DEFAULT NULL,
  p_external_transaction_id text DEFAULT NULL,
  p_routing_rule_id uuid DEFAULT NULL,
  p_routing_policy_id uuid DEFAULT NULL,
  p_routing_policy_version bigint DEFAULT NULL,
  p_decision_reason text DEFAULT NULL,
  p_provider_request_id text DEFAULT NULL,
  p_duration_ms integer DEFAULT NULL,
  p_sale_id text DEFAULT NULL,
  p_product_id text DEFAULT NULL
)
RETURNS public.gateway_payment_attempts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog','public'
AS $function$
DECLARE
  v_tx public.gateway_transactions%ROWTYPE;
  v_attempt public.gateway_payment_attempts;
  v_next_order integer;
  v_status text := lower(trim(coalesce(p_status,'pending')));
BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF p_user_id IS NULL OR p_transaction_id IS NULL OR p_gateway_id IS NULL
     OR nullif(trim(p_gateway_name),'') IS NULL
     OR nullif(trim(p_idempotency_key),'') IS NULL THEN
    RAISE EXCEPTION 'attempt_identity_required';
  END IF;
  IF v_status NOT IN ('pending','processing','approved','declined','error','unknown') THEN
    RAISE EXCEPTION 'invalid_attempt_status';
  END IF;
  IF p_duration_ms IS NOT NULL AND p_duration_ms < 0 THEN RAISE EXCEPTION 'invalid_duration'; END IF;

  SELECT * INTO v_tx FROM public.gateway_transactions
  WHERE id=p_transaction_id AND user_id=p_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'transaction_not_found'; END IF;

  IF NOT EXISTS (SELECT 1 FROM public.gateways g WHERE g.id=p_gateway_id AND g.user_id=p_user_id) THEN
    RAISE EXCEPTION 'gateway_not_found';
  END IF;

  SELECT COALESCE(MAX(a.attempt_order),0)+1 INTO v_next_order
  FROM public.gateway_payment_attempts a
  WHERE a.transaction_id=p_transaction_id AND a.user_id=p_user_id;

  INSERT INTO public.gateway_payment_attempts(
    user_id,sale_id,product_id,gateway_id,gateway_name,routing_rule_id,idempotency_key,
    attempt_order,status,failure_class,external_transaction_id,transaction_id,
    routing_policy_id,routing_policy_version,decision_reason,provider_request_id,
    duration_ms,created_at,updated_at,completed_at
  ) VALUES (
    p_user_id,p_sale_id,p_product_id,p_gateway_id,trim(p_gateway_name),p_routing_rule_id,
    trim(p_idempotency_key),v_next_order,v_status,p_failure_class,p_external_transaction_id,
    p_transaction_id,p_routing_policy_id,p_routing_policy_version,p_decision_reason,
    p_provider_request_id,p_duration_ms,now(),now(),
    CASE WHEN v_status IN ('approved','declined','error') THEN now() ELSE NULL END
  ) RETURNING * INTO v_attempt;
  RETURN v_attempt;
END;
$function$;

REVOKE ALL ON FUNCTION public.allocate_and_insert_gateway_payment_attempt(uuid,uuid,text,text,text,text,text,text,uuid,uuid,bigint,text,text,integer,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.allocate_and_insert_gateway_payment_attempt(uuid,uuid,text,text,text,text,text,text,uuid,uuid,bigint,text,text,integer,text,text) TO service_role;

CREATE UNIQUE INDEX IF NOT EXISTS uq_gateway_payment_attempts_transaction_order
  ON public.gateway_payment_attempts(user_id,transaction_id,attempt_order);

DROP TRIGGER IF EXISTS trg_gateway_ambiguous_attempt_recovery_auto_enqueue ON public.gateway_payment_attempts;
CREATE TRIGGER trg_gateway_ambiguous_attempt_recovery_auto_enqueue
AFTER INSERT OR UPDATE OF status, failure_class, external_transaction_id, transaction_id, gateway_id
ON public.gateway_payment_attempts
FOR EACH ROW EXECUTE FUNCTION public.enqueue_gateway_ambiguous_recovery();
