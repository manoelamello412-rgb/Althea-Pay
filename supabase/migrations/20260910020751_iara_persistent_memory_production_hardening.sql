BEGIN;

CREATE TABLE IF NOT EXISTS public.iara_memory_journal (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  product_id UUID,
  session_id UUID REFERENCES public.chat_sessions(id) ON DELETE SET NULL,
  conversation_id UUID,
  execution_id UUID,
  idempotency_key UUID,
  event_type TEXT NOT NULL CHECK (event_type IN ('CONTEXT_MUTATION','CHAT_APPEND','CRM_TOOL_SNAPSHOT')),
  entity_type TEXT,
  entity_id TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  sequence_id BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT iara_memory_journal_tenant_sequence_unique UNIQUE (tenant_id, sequence_id),
  CONSTRAINT iara_memory_journal_idempotency_unique UNIQUE (tenant_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_iara_memory_journal_tenant_sequence ON public.iara_memory_journal(tenant_id, sequence_id ASC);
CREATE INDEX IF NOT EXISTS idx_iara_memory_journal_session_sequence ON public.iara_memory_journal(session_id, sequence_id ASC) WHERE session_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_iara_memory_journal_execution ON public.iara_memory_journal(execution_id) WHERE execution_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_iara_memory_journal_event_created ON public.iara_memory_journal(tenant_id, event_type, created_at DESC);

CREATE TABLE IF NOT EXISTS public.iara_memory_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  sequence_id BIGINT NOT NULL, state JSONB NOT NULL, state_version INTEGER NOT NULL DEFAULT 1, created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT iara_memory_snapshot_tenant_sequence_unique UNIQUE (tenant_id, sequence_id)
);
CREATE INDEX IF NOT EXISTS idx_iara_memory_snapshots_tenant_sequence ON public.iara_memory_snapshots(tenant_id, sequence_id DESC);

CREATE TABLE IF NOT EXISTS public.iara_memory_sequences (
  tenant_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  next_sequence BIGINT NOT NULL DEFAULT 0 CHECK (next_sequence >= 0), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.iara_memory_journal ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.iara_memory_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.iara_memory_sequences ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS iara_memory_journal_select_own ON public.iara_memory_journal;
CREATE POLICY iara_memory_journal_select_own ON public.iara_memory_journal FOR SELECT TO authenticated USING (auth.uid() = user_id);
DROP POLICY IF EXISTS iara_memory_snapshots_select_own ON public.iara_memory_snapshots;
CREATE POLICY iara_memory_snapshots_select_own ON public.iara_memory_snapshots FOR SELECT TO authenticated USING (auth.uid() = tenant_id);
DROP POLICY IF EXISTS iara_memory_sequences_select_own ON public.iara_memory_sequences;
CREATE POLICY iara_memory_sequences_select_own ON public.iara_memory_sequences FOR SELECT TO authenticated USING (auth.uid() = tenant_id);

CREATE OR REPLACE FUNCTION public.iara_allocate_memory_sequence(p_tenant_id UUID)
RETURNS BIGINT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_sequence BIGINT;
BEGIN
  IF p_tenant_id IS NULL THEN RAISE EXCEPTION 'tenant_id is required'; END IF;
  INSERT INTO public.iara_memory_sequences(tenant_id,next_sequence) VALUES(p_tenant_id,1)
  ON CONFLICT(tenant_id) DO UPDATE SET next_sequence=public.iara_memory_sequences.next_sequence+1,updated_at=now()
  RETURNING next_sequence INTO v_sequence;
  RETURN v_sequence;
END; $$;
REVOKE ALL ON FUNCTION public.iara_allocate_memory_sequence(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.iara_allocate_memory_sequence(UUID) TO service_role;

CREATE OR REPLACE FUNCTION public.iara_memory_journal_assign_sequence()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.sequence_id := public.iara_allocate_memory_sequence(NEW.tenant_id); RETURN NEW; END; $$;
DROP TRIGGER IF EXISTS trg_iara_memory_journal_assign_sequence ON public.iara_memory_journal;
CREATE TRIGGER trg_iara_memory_journal_assign_sequence BEFORE INSERT ON public.iara_memory_journal FOR EACH ROW EXECUTE FUNCTION public.iara_memory_journal_assign_sequence();

CREATE OR REPLACE FUNCTION public.iara_memory_journal_immutable()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN RAISE EXCEPTION 'IARA memory journal is append-only'; END; $$;
DROP TRIGGER IF EXISTS trg_iara_memory_journal_immutable ON public.iara_memory_journal;
CREATE TRIGGER trg_iara_memory_journal_immutable BEFORE UPDATE OR DELETE ON public.iara_memory_journal FOR EACH ROW EXECUTE FUNCTION public.iara_memory_journal_immutable();

ALTER TABLE public.iara_memory_journal REPLICA IDENTITY FULL;
ALTER TABLE public.iara_memory_snapshots REPLICA IDENTITY FULL;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname='supabase_realtime') AND NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='iara_memory_journal') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.iara_memory_journal;
  END IF;
END $$;
COMMIT;