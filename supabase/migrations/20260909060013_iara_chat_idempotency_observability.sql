BEGIN;

ALTER TABLE public.chat_messages
  ADD COLUMN IF NOT EXISTS client_request_id UUID,
  ADD COLUMN IF NOT EXISTS in_reply_to UUID REFERENCES public.chat_messages(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_chat_messages_user_client_request
  ON public.chat_messages(user_id, client_request_id)
  WHERE client_request_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_chat_messages_reply_to
  ON public.chat_messages(in_reply_to)
  WHERE in_reply_to IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.iara_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  session_id UUID NOT NULL REFERENCES public.chat_sessions(id) ON DELETE CASCADE,
  client_request_id UUID,
  model TEXT,
  status TEXT NOT NULL CHECK (status IN ('running','completed','failed')),
  latency_ms INTEGER,
  tool_count INTEGER NOT NULL DEFAULT 0,
  error_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_iara_runs_user_created
  ON public.iara_runs(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_iara_runs_session_created
  ON public.iara_runs(session_id, created_at DESC);

ALTER TABLE public.iara_runs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS iara_runs_select_own ON public.iara_runs;
CREATE POLICY iara_runs_select_own ON public.iara_runs FOR SELECT TO authenticated USING (auth.uid() = user_id);

COMMIT;
