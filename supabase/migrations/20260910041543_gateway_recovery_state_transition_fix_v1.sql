-- ALTHEA PAY — OCC-safe formal recovery state transition
CREATE OR REPLACE FUNCTION public.transition_gateway_recovery_state(
  p_job_id uuid,
  p_expected_version bigint,
  p_next_state public.recovery_state,
  p_note text DEFAULT NULL,
  p_next_retry_at timestamptz DEFAULT NULL
) RETURNS TABLE(updated boolean, state_version bigint, current_state public.recovery_state)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_current public.recovery_state; v_version bigint;
BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'service_role_required'; END IF;
  IF p_next_state IS NULL THEN RAISE EXCEPTION 'recovery_state_required'; END IF;
  UPDATE public.gateway_recovery_queue
  SET recovery_state=p_next_state,
      state_version=state_version+1,
      status=CASE p_next_state WHEN 'APPROVED' THEN 'resolved' WHEN 'DECLINED' THEN 'not_found' WHEN 'DEAD_LETTER' THEN 'dead_letter' WHEN 'STATUS_CHECK' THEN 'processing' ELSE status END,
      next_retry_at=COALESCE(p_next_retry_at,next_retry_at),
      execution_logs=execution_logs || jsonb_build_array(jsonb_build_object('at',clock_timestamp(),'from_state',recovery_state::text,'from_version',state_version,'to',p_next_state::text,'note',p_note)),
      updated_at=clock_timestamp()
  WHERE id=p_job_id AND state_version=p_expected_version
  RETURNING gateway_recovery_queue.state_version,gateway_recovery_queue.recovery_state INTO v_version,v_current;
  IF NOT FOUND THEN RETURN QUERY SELECT false,NULL::bigint,NULL::public.recovery_state;
  ELSE RETURN QUERY SELECT true,v_version,v_current;
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.transition_gateway_recovery_state(uuid,bigint,public.recovery_state,text,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.transition_gateway_recovery_state(uuid,bigint,public.recovery_state,text,timestamptz) TO service_role;
