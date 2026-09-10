BEGIN;

-- Durable cold-history rollups. Original CHAT/WEBHOOK records are only
-- deleted after their aggregate has been committed in the same transaction.
CREATE TABLE IF NOT EXISTS public.iara_memory_archive_rollups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  bucket_start TIMESTAMPTZ NOT NULL,
  bucket_end TIMESTAMPTZ NOT NULL,
  row_count BIGINT NOT NULL CHECK (row_count > 0),
  first_sequence_id BIGINT,
  last_sequence_id BIGINT,
  payload_bytes BIGINT NOT NULL DEFAULT 0 CHECK (payload_bytes >= 0),
  summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, event_type, bucket_start)
);

ALTER TABLE public.iara_memory_journal
  DROP CONSTRAINT IF EXISTS iara_memory_journal_event_type_check;

ALTER TABLE public.iara_memory_journal
  ADD CONSTRAINT iara_memory_journal_event_type_check
  CHECK (event_type IN ('CONTEXT_MUTATION','CHAT_APPEND','CRM_TOOL_SNAPSHOT','EDGE_BEHAVIOR_TELEMETRY','WEBHOOK_SNAPSHOT'));

CREATE INDEX IF NOT EXISTS idx_iara_memory_journal_retention
  ON public.iara_memory_journal(tenant_id, event_type, created_at, sequence_id);

CREATE INDEX IF NOT EXISTS idx_iara_memory_archive_rollups_tenant_bucket
  ON public.iara_memory_archive_rollups(tenant_id, bucket_start DESC);

ALTER TABLE public.iara_memory_archive_rollups ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS iara_memory_archive_rollups_select_own ON public.iara_memory_archive_rollups;
CREATE POLICY iara_memory_archive_rollups_select_own
  ON public.iara_memory_archive_rollups
  FOR SELECT TO authenticated
  USING (auth.uid() = tenant_id);

-- One transaction = one maintenance critical section. PostgreSQL advisory
-- locks are used instead of a process-local/mandatory Redis lock, so the
-- maintenance mutex remains correct even when the application has replicas.
CREATE OR REPLACE FUNCTION public.iara_compact_memory_batch(
  p_tenant_id UUID,
  p_event_type TEXT,
  p_cutoff TIMESTAMPTZ,
  p_batch_limit INTEGER DEFAULT 500
)
RETURNS TABLE (
  rows_compacted BIGINT,
  bytes_compacted BIGINT,
  first_sequence_id BIGINT,
  last_sequence_id BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lock_key BIGINT;
BEGIN
  IF p_batch_limit < 1 OR p_batch_limit > 5000 THEN
    RAISE EXCEPTION 'invalid batch limit';
  END IF;

  IF p_event_type NOT IN ('CHAT_APPEND','WEBHOOK_SNAPSHOT','EDGE_BEHAVIOR_TELEMETRY') THEN
    RAISE EXCEPTION 'event type is not compactable';
  END IF;

  v_lock_key := hashtextextended('iara-ledger-maintenance:' || p_tenant_id::text, 0);
  IF NOT pg_try_advisory_xact_lock(v_lock_key) THEN
    RAISE EXCEPTION 'maintenance already running for tenant';
      
  END IF;

  WITH candidates AS (
    SELECT id
      FROM public.iara_memory_journal
     WHERE tenant_id = p_tenant_id
       AND event_type = p_event_type
       AND created_at < p_cutoff
     ORDER BY sequence_id
     LIMIT p_batch_limit
     FOR UPDATE SKIP LOCKED
  ), aggregated AS (
    SELECT
      min(j.sequence_id) AS first_sequence_id,
      max(j.sequence_id) AS last_sequence_id,
      count(*)::BIGINT AS row_count,
      COALESCE(sum(octet_length(j.payload::text)), 0)::BIGINT AS payload_bytes,
      date_trunc('day', min(j.created_at)) AS bucket_start
      FROM public.iara_memory_journal j
      JOIN candidates c ON c.id = j.id
  ), inserted AS (
    INSERT INTO public.iara_memory_archive_rollups (
      tenant_id, event_type, bucket_start, bucket_end, row_count,
      first_sequence_id, last_sequence_id, payload_bytes, summary
    )
    SELECT
      p_tenant_id,
      p_event_type,
      bucket_start,
      bucket_start + interval '1 day',
      row_count,
      first_sequence_id,
      last_sequence_id,
      payload_bytes,
      jsonb_build_object('compacted_at', now(), 'source', 'iara_memory_journal')
    FROM aggregated
    WHERE row_count > 0
    ON CONFLICT (tenant_id, event_type, bucket_start)
    DO UPDATE SET
      row_count = public.iara_memory_archive_rollups.row_count + EXCLUDED.row_count,
      first_sequence_id = LEAST(public.iara_memory_archive_rollups.first_sequence_id, EXCLUDED.first_sequence_id),
      last_sequence_id = GREATEST(public.iara_memory_archive_rollups.last_sequence_id, EXCLUDED.last_sequence_id),
      payload_bytes = public.iara_memory_archive_rollups.payload_bytes + EXCLUDED.payload_bytes
    RETURNING 1
  ), deleted AS (
    DELETE FROM public.iara_memory_journal j
     USING candidates c
     WHERE j.id = c.id
    RETURNING j.sequence_id, octet_length(j.payload::text)::BIGINT AS payload_bytes
  )
  SELECT count(*)::BIGINT, COALESCE(sum(payload_bytes),0)::BIGINT, min(sequence_id), max(sequence_id)
    INTO rows_compacted, bytes_compacted, first_sequence_id, last_sequence_id
    FROM deleted;

  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.iara_compact_memory_batch(UUID, TEXT, TIMESTAMPTZ, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.iara_compact_memory_batch(UUID, TEXT, TIMESTAMPTZ, INTEGER) TO service_role;

COMMIT;
