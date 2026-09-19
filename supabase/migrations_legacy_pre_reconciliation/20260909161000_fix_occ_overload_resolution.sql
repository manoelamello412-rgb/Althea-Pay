BEGIN;

-- The OCC overload intentionally has no defaults. This prevents PostgreSQL
-- from treating it as a candidate for existing 5-argument calls.
DROP FUNCTION IF EXISTS public.transition_gateway_transaction_status(UUID, UUID, TEXT, TEXT, TEXT, BIGINT);

CREATE FUNCTION public.transition_gateway_transaction_status(
  p_transaction_id UUID,
  p_user_id UUID,
  p_next_status TEXT,
  p_failure_code TEXT,
  p_external_id TEXT,
  p_expected_version BIGINT
)
RETURNS public.gateway_transactions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_row public.gateway_transactions;
  v_current TEXT;
  v_next TEXT := lower(trim(coalesce(p_next_status, '')));
  v_version BIGINT;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  IF v_next NOT IN ('created', 'pending', 'approved', 'failed', 'refunded', 'chargeback') THEN
    RAISE EXCEPTION 'invalid_status';
  END IF;

  SELECT t.status, t.version
    INTO v_current, v_version
  FROM public.gateway_transactions AS t
  WHERE t.id = p_transaction_id
    AND t.user_id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'transaction_not_found';
  END IF;

  IF p_expected_version IS NOT NULL AND v_version <> p_expected_version THEN
    RAISE EXCEPTION 'concurrency_stale_detected';
  END IF;

  IF NOT (
    v_current = v_next
    OR (v_current = 'created' AND v_next IN ('pending', 'approved', 'failed'))
    OR (v_current = 'pending' AND v_next IN ('approved', 'failed', 'refunded', 'chargeback'))
    OR (v_current = 'approved' AND v_next IN ('refunded', 'chargeback'))
  ) THEN
    RAISE EXCEPTION 'invalid_status_transition';
  END IF;

  IF v_current = v_next
     AND nullif(p_failure_code, '') IS NULL
     AND nullif(p_external_id, '') IS NULL THEN
    SELECT t.* INTO v_row
    FROM public.gateway_transactions AS t
    WHERE t.id = p_transaction_id
      AND t.user_id = p_user_id;
    RETURN v_row;
  END IF;

  UPDATE public.gateway_transactions AS t
  SET status = v_next,
      failure_code = coalesce(nullif(p_failure_code, ''), t.failure_code),
      external_id = coalesce(nullif(p_external_id, ''), t.external_id),
      completed_at = CASE
        WHEN v_next IN ('approved', 'refunded', 'chargeback')
          THEN coalesce(t.completed_at, now())
        ELSE t.completed_at
      END,
      version = t.version + 1,
      updated_at = now()
  WHERE t.id = p_transaction_id
    AND t.user_id = p_user_id
    AND t.version = v_version
  RETURNING t.* INTO v_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'concurrency_update_failed';
  END IF;

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.transition_gateway_transaction_status(UUID, UUID, TEXT, TEXT, TEXT, BIGINT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.transition_gateway_transaction_status(UUID, UUID, TEXT, TEXT, TEXT, BIGINT) TO service_role;

COMMIT;
