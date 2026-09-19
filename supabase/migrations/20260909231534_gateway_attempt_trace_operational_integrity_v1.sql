ALTER TABLE public.gateway_payment_attempts
  ADD COLUMN IF NOT EXISTS transaction_id uuid,
  ADD COLUMN IF NOT EXISTS routing_policy_id uuid,
  ADD COLUMN IF NOT EXISTS routing_policy_version bigint,
  ADD COLUMN IF NOT EXISTS decision_reason text,
  ADD COLUMN IF NOT EXISTS provider_request_id text,
  ADD COLUMN IF NOT EXISTS duration_ms integer;

CREATE INDEX IF NOT EXISTS idx_gateway_payment_attempts_tenant_transaction
 ON public.gateway_payment_attempts(user_id,transaction_id,created_at DESC);

CREATE INDEX IF NOT EXISTS idx_gateway_payment_attempts_provider_request
 ON public.gateway_payment_attempts(user_id,provider_request_id)
 WHERE provider_request_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.gateway_payment_attempt_trace_integrity()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF NEW.duration_ms IS NOT NULL AND NEW.duration_ms < 0 THEN RAISE EXCEPTION 'gateway_attempt_duration_invalid'; END IF;
 IF NEW.routing_policy_version IS NOT NULL AND NEW.routing_policy_version < 1 THEN RAISE EXCEPTION 'gateway_attempt_policy_version_invalid'; END IF;
 IF NEW.transaction_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.gateway_transactions t WHERE t.id=NEW.transaction_id AND t.user_id=NEW.user_id) THEN RAISE EXCEPTION 'gateway_attempt_transaction_tenant_mismatch'; END IF;
 RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS trg_gateway_payment_attempt_trace_integrity ON public.gateway_payment_attempts;
CREATE TRIGGER trg_gateway_payment_attempt_trace_integrity BEFORE INSERT OR UPDATE ON public.gateway_payment_attempts FOR EACH ROW EXECUTE FUNCTION public.gateway_payment_attempt_trace_integrity();
REVOKE ALL ON FUNCTION public.gateway_payment_attempt_trace_integrity() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.gateway_payment_attempt_trace_integrity() TO service_role;

CREATE OR REPLACE FUNCTION public.finalize_gateway_unknown_attempt(p_transaction_id uuid,p_user_id uuid,p_status text,p_external_id text,p_failure_code text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_tx public.gateway_transactions%ROWTYPE;
BEGIN
 IF p_status NOT IN ('approved','pending','declined') THEN RAISE EXCEPTION 'invalid_recovery_status'; END IF;
 SELECT * INTO v_tx FROM public.gateway_transactions WHERE id=p_transaction_id AND user_id=p_user_id FOR UPDATE;
 IF v_tx.id IS NULL THEN RAISE EXCEPTION 'transaction_not_found'; END IF;
 IF p_status IN ('approved') AND NULLIF(trim(coalesce(p_external_id,'')),'') IS NULL THEN RAISE EXCEPTION 'gateway_external_id_required_for_terminal_state'; END IF;
 IF v_tx.status IN ('approved','refunded') AND p_status='declined' THEN RETURN jsonb_build_object('status',v_tx.status,'changed',false); END IF;
 UPDATE public.gateway_transactions SET status=p_status,external_id=COALESCE(NULLIF(trim(p_external_id),''),external_id),failure_code=p_failure_code,updated_at=now(),version=coalesce(version,0)+1,completed_at=CASE WHEN p_status IN ('approved','declined') THEN now() ELSE completed_at END WHERE id=v_tx.id AND user_id=p_user_id;
 RETURN jsonb_build_object('status',p_status,'changed',true,'transaction_id',v_tx.id);
END; $$;
REVOKE ALL ON FUNCTION public.finalize_gateway_unknown_attempt(uuid,uuid,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_gateway_unknown_attempt(uuid,uuid,text,text,text) TO service_role;