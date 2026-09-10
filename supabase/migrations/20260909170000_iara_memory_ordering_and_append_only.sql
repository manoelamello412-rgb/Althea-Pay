BEGIN;

-- IARA memory journal: transactional sequence authority and append-only enforcement.
-- PostgreSQL is the sole source of truth for ordering. Redis must never allocate
-- authoritative sequence numbers.

CREATE TABLE IF NOT EXISTS public.iara_memory_sequences (
  tenant_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  next_sequence BIGINT NOT NULL DEFAULT 1 CHECK (next_sequence > 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION public.iara_next_memory_sequence(p_tenant_id UUID)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sequence BIGINT;
BEGIN
  IF p_tenant_id IS NULL THEN
    RAISE EXCEPTION 'tenant_id is required';
  END IF;

  INSERT INTO public.iara_memory_sequences (tenant_id, next_sequence)
  VALUES (p_tenant_id, 2)
  ON CONFLICT (tenant_id) DO UPDATE
    SET next_sequence = public.iara_memory_sequences.next_sequence + 1,
        updated_at = now()
  RETURNING next_sequence - 1 INTO v_sequence;

  RETURN v_sequence;
END;
$$;

REVOKE ALL ON FUNCTION public.iara_next_memory_sequence(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.iara_next_memory_sequence(UUID) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.iara_next_memory_sequence(UUID) TO service_role;

CREATE OR REPLACE FUNCTION public.iara_memory_journal_append_only()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'IARA memory journal is append-only';
END;
$$;

DROP TRIGGER IF EXISTS iara_memory_journal_no_update ON public.iara_memory_journal;
CREATE TRIGGER iara_memory_journal_no_update
BEFORE UPDATE ON public.iara_memory_journal
FOR EACH ROW EXECUTE FUNCTION public.iara_memory_journal_append_only();

DROP TRIGGER IF EXISTS iara_memory_journal_no_delete ON public.iara_memory_journal;
CREATE TRIGGER iara_memory_journal_no_delete
BEFORE DELETE ON public.iara_memory_journal
FOR EACH ROW EXECUTE FUNCTION public.iara_memory_journal_append_only();

-- Service-role execution may allocate the next committed sequence inside the
-- same transaction as the journal INSERT. A rollback therefore does not burn
-- a committed sequence number.
COMMENT ON TABLE public.iara_memory_sequences IS 'Transactional per-tenant sequence authority for IARA memory journal ordering.';
COMMENT ON FUNCTION public.iara_next_memory_sequence(UUID) IS 'Allocates the next per-tenant IARA memory sequence under a row lock/UPSERT transaction.';

COMMIT;
