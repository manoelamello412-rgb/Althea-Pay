BEGIN;

-- Distributed circuit state. gateway_health_snapshots remains the historical telemetry stream;
-- this table is the authoritative, mutable breaker state used by concurrent payment requests.
CREATE TABLE IF NOT EXISTS public.gateway_circuit_states (
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  gateway_id UUID NOT NULL,
  gateway_name TEXT NOT NULL,
  failure_count INTEGER NOT NULL DEFAULT 0 CHECK (failure_count >= 0),
  circuit_state TEXT NOT NULL DEFAULT 'closed' CHECK (circuit_state IN ('closed','open','half_open')),
  opened_at TIMESTAMPTZ,
  probe_until TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  version BIGINT NOT NULL DEFAULT 1 CHECK (version > 0),
  PRIMARY KEY (user_id, gateway_id)
);

CREATE INDEX IF NOT EXISTS idx_gateway_circuit_states_user_state
  ON public.gateway_circuit_states (user_id, circuit_state, updated_at DESC);

ALTER TABLE public.gateway_circuit_states ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS gateway_circuit_states_select ON public.gateway_circuit_states;
CREATE POLICY gateway_circuit_states_select
  ON public.gateway_circuit_states
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

REVOKE INSERT, UPDATE, DELETE ON public.gateway_circuit_states FROM authenticated;
REVOKE ALL ON public.gateway_circuit_states FROM anon;

-- Atomically decides whether this tenant/provider pair may attempt a request.
-- pg_advisory_xact_lock serializes concurrent breaker mutations without holding a
-- long-lived application lock. Only service_role can invoke these mutations.
CREATE OR REPLACE FUNCTION public.acquire_gateway_circuit(
  p_user_id UUID,
  p_gateway_id UUID,
  p_gateway_name TEXT,
  p_failure_threshold INTEGER DEFAULT 3,
  p_cooldown_seconds INTEGER DEFAULT 30,
  p_probe_lease_seconds INTEGER DEFAULT 5
)
RETURNS TABLE(allowed BOOLEAN, circuit_state TEXT, failure_count INTEGER, probe_token TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_row public.gateway_circuit_states;
  v_key BIGINT;
  v_probe TEXT;
BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF p_user_id IS NULL OR p_gateway_id IS NULL THEN RAISE EXCEPTION 'circuit_identity_required'; END IF;
  IF p_failure_threshold < 1 OR p_cooldown_seconds < 1 OR p_probe_lease_seconds < 1 THEN
    RAISE EXCEPTION 'circuit_parameters_invalid';
  END IF;

  v_key := hashtextextended(p_user_id::text || ':' || p_gateway_id::text, 0);
  PERFORM pg_advisory_xact_lock(v_key);

  INSERT INTO public.gateway_circuit_states(user_id, gateway_id, gateway_name)
  VALUES (p_user_id, p_gateway_id, lower(trim(coalesce(p_gateway_name, p_gateway_id::text))))
  ON CONFLICT (user_id, gateway_id) DO NOTHING;

  SELECT * INTO v_row
    FROM public.gateway_circuit_states
   WHERE user_id = p_user_id AND gateway_id = p_gateway_id
   FOR UPDATE;

  IF v_row.circuit_state = 'open' THEN
    IF v_row.opened_at IS NOT NULL
       AND v_row.opened_at > timezone('utc', now()) - make_interval(secs => p_cooldown_seconds) THEN
      RETURN QUERY SELECT false, 'open'::text, v_row.failure_count, NULL::text;
      RETURN;
    END IF;

    IF v_row.probe_until IS NOT NULL AND v_row.probe_until > timezone('utc', now()) THEN
      RETURN QUERY SELECT false, 'half_open'::text, v_row.failure_count, NULL::text;
      RETURN;
    END IF;

    v_probe := encode(gen_random_bytes(16), 'hex');
    UPDATE public.gateway_circuit_states
       SET circuit_state = 'half_open',
           probe_until = timezone('utc', now()) + make_interval(secs => p_probe_lease_seconds),
           updated_at = timezone('utc', now()),
           version = version + 1
     WHERE user_id = p_user_id AND gateway_id = p_gateway_id;
    RETURN QUERY SELECT true, 'half_open'::text, v_row.failure_count, v_probe;
    RETURN;
  END IF;

  IF v_row.circuit_state = 'half_open' THEN
    IF v_row.probe_until IS NULL OR v_row.probe_until <= timezone('utc', now()) THEN
      v_probe := encode(gen_random_bytes(16), 'hex');
      UPDATE public.gateway_circuit_states
         SET probe_until = timezone('utc', now()) + make_interval(secs => p_probe_lease_seconds),
             updated_at = timezone('utc', now()),
             version = version + 1
       WHERE user_id = p_user_id AND gateway_id = p_gateway_id;
      RETURN QUERY SELECT true, 'half_open'::text, v_row.failure_count, v_probe;
      RETURN;
    END IF;
    RETURN QUERY SELECT false, 'half_open'::text, v_row.failure_count, NULL::text;
    RETURN;
  END IF;

  RETURN QUERY SELECT true, 'closed'::text, v_row.failure_count, NULL::text;
END;
$$;

CREATE OR REPLACE FUNCTION public.record_gateway_circuit_success(
  p_user_id UUID,
  p_gateway_id UUID,
  p_gateway_name TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE v_key BIGINT;
BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'forbidden'; END IF;
  v_key := hashtextextended(p_user_id::text || ':' || p_gateway_id::text, 0);
  PERFORM pg_advisory_xact_lock(v_key);
  INSERT INTO public.gateway_circuit_states(user_id, gateway_id, gateway_name, failure_count, circuit_state, opened_at, probe_until)
  VALUES (p_user_id, p_gateway_id, lower(trim(coalesce(p_gateway_name, p_gateway_id::text))), 0, 'closed', NULL, NULL)
  ON CONFLICT (user_id, gateway_id) DO UPDATE SET
    gateway_name = excluded.gateway_name,
    failure_count = 0,
    circuit_state = 'closed',
    opened_at = NULL,
    probe_until = NULL,
    updated_at = timezone('utc', now()),
    version = public.gateway_circuit_states.version + 1;
END;
$$;

CREATE OR REPLACE FUNCTION public.record_gateway_circuit_failure(
  p_user_id UUID,
  p_gateway_id UUID,
  p_gateway_name TEXT,
  p_failure_class TEXT,
  p_failure_threshold INTEGER DEFAULT 3
)
RETURNS TABLE(circuit_state TEXT, failure_count INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_key BIGINT;
  v_failures INTEGER;
  v_state TEXT;
BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF p_failure_threshold < 1 THEN RAISE EXCEPTION 'circuit_threshold_invalid'; END IF;
  IF p_failure_class NOT IN ('technical','timeout','unavailable') THEN
    RAISE EXCEPTION 'non_retryable_failure_cannot_open_circuit';
  END IF;

  v_key := hashtextextended(p_user_id::text || ':' || p_gateway_id::text, 0);
  PERFORM pg_advisory_xact_lock(v_key);
  INSERT INTO public.gateway_circuit_states(user_id, gateway_id, gateway_name)
  VALUES (p_user_id, p_gateway_id, lower(trim(coalesce(p_gateway_name, p_gateway_id::text))))
  ON CONFLICT (user_id, gateway_id) DO NOTHING;

  SELECT failure_count INTO v_failures
    FROM public.gateway_circuit_states
   WHERE user_id = p_user_id AND gateway_id = p_gateway_id
   FOR UPDATE;

  v_failures := v_failures + 1;
  v_state := CASE WHEN v_failures >= p_failure_threshold THEN 'open' ELSE 'closed' END;

  UPDATE public.gateway_circuit_states
     SET gateway_name = lower(trim(coalesce(p_gateway_name, gateway_name))),
         failure_count = v_failures,
         circuit_state = v_state,
         opened_at = CASE WHEN v_state = 'open' THEN timezone('utc', now()) ELSE opened_at END,
         probe_until = NULL,
         updated_at = timezone('utc', now()),
         version = version + 1
   WHERE user_id = p_user_id AND gateway_id = p_gateway_id;

  RETURN QUERY SELECT v_state, v_failures;
END;
$$;

REVOKE ALL ON FUNCTION public.acquire_gateway_circuit(UUID,UUID,TEXT,INTEGER,INTEGER,INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_gateway_circuit_success(UUID,UUID,TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_gateway_circuit_failure(UUID,UUID,TEXT,TEXT,INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.acquire_gateway_circuit(UUID,UUID,TEXT,INTEGER,INTEGER,INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_gateway_circuit_success(UUID,UUID,TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_gateway_circuit_failure(UUID,UUID,TEXT,TEXT,INTEGER) TO service_role;

COMMIT;
