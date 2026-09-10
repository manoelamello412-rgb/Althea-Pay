BEGIN;

CREATE TABLE IF NOT EXISTS public.iara_memory_sequences (
  tenant_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  next_sequence BIGINT NOT NULL DEFAULT 0 CHECK (next_sequence >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.iara_memory_sequences ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS iara_memory_sequences_select_own ON public.iara_memory_sequences;
CREATE POLICY iara_memory_sequences_select_own
  ON public.iara_memory_sequences
  FOR SELECT TO authenticated
  USING (auth.uid() = tenant_id);

CREATE OR REPLACE FUNCTION public.iara_allocate_memory_sequence(p_tenant_id UUID)
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
  VALUES (p_tenant_id, 1)
  ON CONFLICT (tenant_id)
  DO UPDATE SET next_sequence = public.iara_memory_sequences.next_sequence + 1,
                updated_at = now()
  RETURNING next_sequence INTO v_sequence;

  RETURN v_sequence;
END;
$$;

REVOKE ALL ON FUNCTION public.iara_allocate_memory_sequence(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.iara_allocate_memory_sequence(UUID) TO service_role;

CREATE OR REPLACE FUNCTION public.iara_memory_journal_assign_sequence()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.sequence_id := public.iara_allocate_memory_sequence(NEW.tenant_id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_iara_memory_journal_assign_sequence ON public.iara_memory_journal;
CREATE TRIGGER trg_iara_memory_journal_assign_sequence
  BEFORE INSERT ON public.iara_memory_journal
  FOR EACH ROW EXECUTE FUNCTION public.iara_memory_journal_assign_sequence();

CREATE OR REPLACE FUNCTION public.iara_memory_journal_immutable()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'IARA memory journal is append-only';
END;
$$;

DROP TRIGGER IF EXISTS trg_iara_memory_journal_immutable ON public.iara_memory_journal;
CREATE TRIGGER trg_iara_memory_journal_immutable
  BEFORE UPDATE OR DELETE ON public.iara_memory_journal
  FOR EACH ROW EXECUTE FUNCTION public.iara_memory_journal_immutable();

COMMIT;
