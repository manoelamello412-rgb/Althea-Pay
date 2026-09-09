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

CREATE INDEX IF NOT EXISTS idx_iara_memory_journal_tenant_sequence
  ON public.iara_memory_journal(tenant_id, sequence_id ASC);
CREATE INDEX IF NOT EXISTS idx_iara_memory_journal_session_sequence
  ON public.iara_memory_journal(session_id, sequence_id ASC)
  WHERE session_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_iara_memory_journal_execution
  ON public.iara_memory_journal(execution_id)
  WHERE execution_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_iara_memory_journal_event_created
  ON public.iara_memory_journal(tenant_id, event_type, created_at DESC);

CREATE TABLE IF NOT EXISTS public.iara_memory_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  sequence_id BIGINT NOT NULL,
  state JSONB NOT NULL,
  state_version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT iara_memory_snapshot_tenant_sequence_unique UNIQUE (tenant_id, sequence_id)
);

CREATE INDEX IF NOT EXISTS idx_iara_memory_snapshots_tenant_sequence
  ON public.iara_memory_snapshots(tenant_id, sequence_id DESC);

ALTER TABLE public.iara_memory_journal ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.iara_memory_snapshots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS iara_memory_journal_select_own ON public.iara_memory_journal;
CREATE POLICY iara_memory_journal_select_own
  ON public.iara_memory_journal
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS iara_memory_snapshots_select_own ON public.iara_memory_snapshots;
CREATE POLICY iara_memory_snapshots_select_own
  ON public.iara_memory_snapshots
  FOR SELECT TO authenticated
  USING (auth.uid() = tenant_id);

ALTER TABLE public.iara_memory_journal REPLICA IDENTITY FULL;
ALTER TABLE public.iara_memory_snapshots REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'iara_memory_journal'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.iara_memory_journal;
    END IF;
  END IF;
END $$;

COMMIT;
