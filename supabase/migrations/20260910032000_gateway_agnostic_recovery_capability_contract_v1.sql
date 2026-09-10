-- ALTHEA PAY — canonical agnostic recovery/capability contract
-- IMPORTANT: extends existing canonical tables; never creates gateway_configurations.

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'recovery_state') THEN
    CREATE TYPE public.recovery_state AS ENUM ('UNKNOWN','RECOVERY','STATUS_CHECK','APPROVED','DECLINED','PENDING','DEAD_LETTER');
  END IF;
END $$;

ALTER TABLE public.gateway_recovery_queue
  ADD COLUMN IF NOT EXISTS recovery_state public.recovery_state,
  ADD COLUMN IF NOT EXISTS state_version bigint NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS execution_logs jsonb NOT NULL DEFAULT '[]'::jsonb;

UPDATE public.gateway_recovery_queue
SET recovery_state = CASE
  WHEN status = 'resolved' THEN 'APPROVED'::public.recovery_state
  WHEN status = 'dead_letter' THEN 'DEAD_LETTER'::public.recovery_state
  WHEN status = 'processing' THEN 'STATUS_CHECK'::public.recovery_state
  WHEN status = 'not_found' THEN 'PENDING'::public.recovery_state
  ELSE 'RECOVERY'::public.recovery_state
END
WHERE recovery_state IS NULL;

ALTER TABLE public.gateway_recovery_queue
  ALTER COLUMN recovery_state SET DEFAULT 'RECOVERY'::public.recovery_state,
  ALTER COLUMN recovery_state SET NOT NULL;

ALTER TABLE public.gateway_recovery_queue
  ADD CONSTRAINT gateway_recovery_queue_state_version_positive_ck CHECK (state_version > 0),
  ADD CONSTRAINT gateway_recovery_queue_execution_logs_array_ck CHECK (jsonb_typeof(execution_logs) = 'array');

CREATE INDEX IF NOT EXISTS idx_gateway_recovery_queue_state_execution
  ON public.gateway_recovery_queue(user_id, recovery_state, next_retry_at, created_at)
  WHERE recovery_state IN ('UNKNOWN','RECOVERY','STATUS_CHECK','PENDING');

CREATE OR REPLACE FUNCTION public.transition_gateway_recovery_state(
  p_job_id uuid,
  p_expected_version bigint,
  p_next_state public.recovery_state,
  p_note text DEFAULT NULL,
  p_next_retry_at timestamptz DEFAULT NULL
) RETURNS TABLE(updated boolean, state_version bigint, current_state public.recovery_state)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_current public.recovery_state; v_version bigint;
BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'service_role_required'; END IF;
  IF p_next_state IS NULL THEN RAISE EXCEPTION 'recovery_state_required'; END IF;
  UPDATE public.gateway_recovery_queue
  SET recovery_state = p_next_state,
      state_version = state_version + 1,
      status = CASE p_next_state
        WHEN 'APPROVED' THEN 'resolved'
        WHEN 'DECLINED' THEN 'not_found'
        WHEN 'DEAD_LETTER' THEN 'dead_letter'
        WHEN 'STATUS_CHECK' THEN 'processing'
        ELSE status
      END,
      next_retry_at = COALESCE(p_next_retry_at, next_retry_at),
      execution_logs = execution_logs || jsonb_build_array(jsonb_build_object('at', clock_timestamp(), 'from_state', recovery_state::text, 'from_version', state_version, 'to', p_next_state::text, 'note', p_note)),
      updated_at = clock_timestamp()
  WHERE id = p_job_id AND state_version = p_expected_version
  RETURNING gateway_recovery_queue.state_version, gateway_recovery_queue.recovery_state INTO v_version, v_current;
  IF NOT FOUND THEN
    RETURN QUERY SELECT false, NULL::bigint, NULL::public.recovery_state;
  ELSE
    RETURN QUERY SELECT true, v_version, v_current;
  END IF;
END $$;

REVOKE ALL ON FUNCTION public.transition_gateway_recovery_state(uuid,bigint,public.recovery_state,text,timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.transition_gateway_recovery_state(uuid,bigint,public.recovery_state,text,timestamptz) TO service_role;

ALTER TABLE public.gateway_provider_registry
  ADD COLUMN IF NOT EXISTS adapter_contract_version integer NOT NULL DEFAULT 1;

ALTER TABLE public.gateway_provider_registry
  ADD CONSTRAINT gateway_provider_registry_capabilities_object_ck CHECK (jsonb_typeof(capabilities) = 'object'),
  ADD CONSTRAINT gateway_provider_registry_adapter_contract_positive_ck CHECK (adapter_contract_version > 0);

CREATE INDEX IF NOT EXISTS idx_gateway_provider_registry_operational_adapter
  ON public.gateway_provider_registry(operational, adapter_key)
  WHERE is_active = true;
