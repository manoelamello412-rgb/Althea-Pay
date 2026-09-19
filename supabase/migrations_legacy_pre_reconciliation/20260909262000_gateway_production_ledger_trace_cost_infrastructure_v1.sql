BEGIN;

CREATE TABLE IF NOT EXISTS public.gateway_interchange_fees (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  gateway_id text NOT NULL REFERENCES public.gateways(id) ON DELETE CASCADE,
  card_brand text NOT NULL,
  fixed_fee_minor bigint NOT NULL DEFAULT 0 CHECK (fixed_fee_minor >= 0),
  percentage_fee numeric(9,6) NOT NULL DEFAULT 0 CHECK (percentage_fee >= 0 AND percentage_fee <= 1),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, gateway_id, card_brand)
);
CREATE INDEX IF NOT EXISTS idx_gateway_interchange_fees_lookup ON public.gateway_interchange_fees(user_id, gateway_id, card_brand, active);
ALTER TABLE public.gateway_interchange_fees ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS gateway_interchange_fees_select_own ON public.gateway_interchange_fees;
CREATE POLICY gateway_interchange_fees_select_own ON public.gateway_interchange_fees FOR SELECT TO authenticated USING (user_id = (select auth.uid()));
DROP POLICY IF EXISTS gateway_interchange_fees_write_own ON public.gateway_interchange_fees;
CREATE POLICY gateway_interchange_fees_write_own ON public.gateway_interchange_fees FOR ALL TO authenticated USING (user_id = (select auth.uid())) WITH CHECK (user_id = (select auth.uid()));

CREATE TABLE IF NOT EXISTS public.gateway_orchestration_traces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id uuid NULL REFERENCES public.gateway_transactions(id) ON DELETE SET NULL,
  idempotency_key text NOT NULL,
  tenant_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  funnel_id text NULL REFERENCES public.funnels(id) ON DELETE SET NULL,
  trace_graph jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT gateway_orchestration_traces_graph_object CHECK (jsonb_typeof(trace_graph) = 'object')
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_gateway_orchestration_trace_transaction ON public.gateway_orchestration_traces(tenant_id, transaction_id) WHERE transaction_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_gateway_orchestration_traces_lookup ON public.gateway_orchestration_traces(tenant_id, idempotency_key, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_gateway_orchestration_traces_funnel ON public.gateway_orchestration_traces(tenant_id, funnel_id, created_at DESC);
ALTER TABLE public.gateway_orchestration_traces ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS gateway_orchestration_traces_select_own ON public.gateway_orchestration_traces;
CREATE POLICY gateway_orchestration_traces_select_own ON public.gateway_orchestration_traces FOR SELECT TO authenticated USING (tenant_id = (select auth.uid()));
REVOKE INSERT, UPDATE, DELETE ON public.gateway_orchestration_traces FROM anon, authenticated;
GRANT SELECT ON public.gateway_orchestration_traces TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.gateway_orchestration_traces TO service_role;

CREATE OR REPLACE FUNCTION public.gateway_refresh_orchestration_trace()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
DECLARE tx public.gateway_transactions%ROWTYPE; trace jsonb;
BEGIN
  SELECT * INTO tx FROM public.gateway_transactions WHERE id = NEW.transaction_id AND user_id = NEW.user_id;
  IF NOT FOUND THEN RETURN NEW; END IF;
  SELECT jsonb_build_object(
    'request', jsonb_build_object('transaction_id',tx.id,'amount',tx.amount,'currency',tx.currency,'funnel_id',tx.funnel_id,'product_id',tx.product_id,'idempotency_key',tx.idempotency_key,'trace_id',tx.routing_metadata->>'trace_id'),
    'policy_evaluation', jsonb_build_object('policy_id',tx.routing_metadata->>'policy_id','policy_version',NULLIF(tx.routing_metadata->>'policy_version','')::bigint,'source',tx.routing_metadata->>'source','decision_trace',COALESCE(tx.routing_metadata->'decision_trace','[]'::jsonb),'ranking',COALESCE(tx.routing_metadata->'ranking','[]'::jsonb)),
    'attempts', COALESCE((SELECT jsonb_agg(jsonb_build_object('attempt_id',a.id,'attempt',a.attempt_order,'gateway_id',a.gateway_id,'provider',a.gateway_name,'status',a.status,'failure_class',a.failure_class,'external_transaction_id',a.external_transaction_id,'provider_request_id',a.provider_request_id,'duration_ms',a.duration_ms,'decision_reason',a.decision_reason,'routing_policy_id',a.routing_policy_id,'routing_policy_version',a.routing_policy_version,'created_at',a.created_at,'completed_at',a.completed_at) ORDER BY a.attempt_order) FROM public.gateway_payment_attempts a WHERE a.user_id=tx.user_id AND a.transaction_id=tx.id),'[]'::jsonb),
    'final_state', jsonb_build_object('status',tx.status,'gateway_id',tx.gateway_id,'external_id',tx.external_id,'failure_code',tx.failure_code,'version',tx.version,'updated_at',tx.updated_at)
  ) INTO trace;
  INSERT INTO public.gateway_orchestration_traces(transaction_id,idempotency_key,tenant_id,funnel_id,trace_graph,updated_at)
  VALUES(tx.id,COALESCE(tx.idempotency_key,NEW.idempotency_key),tx.user_id,tx.funnel_id,trace,now())
  ON CONFLICT (tenant_id,transaction_id) WHERE transaction_id IS NOT NULL
  DO UPDATE SET trace_graph=EXCLUDED.trace_graph,updated_at=now();
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.gateway_refresh_orchestration_trace() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.gateway_refresh_orchestration_trace() TO service_role;
DROP TRIGGER IF EXISTS trg_gateway_refresh_orchestration_trace ON public.gateway_payment_attempts;
CREATE TRIGGER trg_gateway_refresh_orchestration_trace AFTER INSERT OR UPDATE OF status, external_transaction_id, failure_class, provider_request_id, duration_ms, decision_reason, routing_policy_id, routing_policy_version ON public.gateway_payment_attempts FOR EACH ROW WHEN (NEW.transaction_id IS NOT NULL) EXECUTE FUNCTION public.gateway_refresh_orchestration_trace();

CREATE OR REPLACE FUNCTION public.gateway_orchestration_trace_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'gateway_orchestration_trace_immutable'; END IF;
  IF TG_OP='UPDATE' AND OLD.tenant_id<>NEW.tenant_id THEN RAISE EXCEPTION 'gateway_orchestration_trace_tenant_immutable'; END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.gateway_orchestration_trace_guard() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.gateway_orchestration_trace_guard() TO service_role;
DROP TRIGGER IF EXISTS trg_gateway_orchestration_trace_guard ON public.gateway_orchestration_traces;
CREATE TRIGGER trg_gateway_orchestration_trace_guard BEFORE UPDATE OR DELETE ON public.gateway_orchestration_traces FOR EACH ROW EXECUTE FUNCTION public.gateway_orchestration_trace_guard();

CREATE OR REPLACE FUNCTION public.gateway_effective_cost_bps(p_user_id uuid,p_gateway_id text,p_card_brand text,p_amount_minor numeric)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $function$
  SELECT CASE WHEN p_amount_minor IS NULL OR p_amount_minor<=0 THEN NULL ELSE round((f.percentage_fee*10000)+((f.fixed_fee_minor/p_amount_minor)*10000),4) END
  FROM public.gateway_interchange_fees f
  WHERE f.user_id=p_user_id AND f.gateway_id=p_gateway_id AND f.active AND lower(f.card_brand)=lower(COALESCE(p_card_brand,'default')) LIMIT 1;
$function$;
REVOKE ALL ON FUNCTION public.gateway_effective_cost_bps(uuid,text,text,numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.gateway_effective_cost_bps(uuid,text,text,numeric) TO service_role;

CREATE OR REPLACE FUNCTION public.gateway_interchange_fees_touch()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
BEGIN NEW.updated_at=now(); RETURN NEW; END;
$function$;
REVOKE ALL ON FUNCTION public.gateway_interchange_fees_touch() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.gateway_interchange_fees_touch() TO service_role;
DROP TRIGGER IF EXISTS trg_gateway_interchange_fees_touch ON public.gateway_interchange_fees;
CREATE TRIGGER trg_gateway_interchange_fees_touch BEFORE UPDATE ON public.gateway_interchange_fees FOR EACH ROW EXECUTE FUNCTION public.gateway_interchange_fees_touch();

COMMIT;
