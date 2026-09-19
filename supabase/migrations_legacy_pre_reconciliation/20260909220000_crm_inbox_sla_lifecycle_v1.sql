ALTER TABLE public.crm_conversations
  ADD COLUMN IF NOT EXISTS priority text NOT NULL DEFAULT 'normal',
  ADD COLUMN IF NOT EXISTS queue_entered_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_inbound_at timestamptz,
  ADD COLUMN IF NOT EXISTS first_response_at timestamptz,
  ADD COLUMN IF NOT EXISTS first_response_due_at timestamptz,
  ADD COLUMN IF NOT EXISTS sla_breached_at timestamptz;

ALTER TABLE public.crm_conversations
  DROP CONSTRAINT IF EXISTS crm_conversations_priority_check;
ALTER TABLE public.crm_conversations
  ADD CONSTRAINT crm_conversations_priority_check CHECK (priority IN ('low','normal','high','urgent'));

CREATE INDEX IF NOT EXISTS crm_conversations_user_sla_idx
  ON public.crm_conversations(user_id, first_response_due_at, first_response_at, sla_breached_at)
  WHERE first_response_at IS NULL;

CREATE INDEX IF NOT EXISTS crm_conversations_user_priority_idx
  ON public.crm_conversations(user_id, priority, updated_at DESC);

CREATE OR REPLACE FUNCTION public.crm_sync_inbox_sla()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path=public
AS $$
DECLARE
  v_due_minutes integer := 15;
  v_priority text;
BEGIN
  IF NEW.direction = 'inbound' THEN
    v_priority := COALESCE(NULLIF(NEW.metadata->>'priority',''), NULLIF(NEW.metadata->'lead'->>'priority',''), 'normal');
    IF v_priority NOT IN ('low','normal','high','urgent') THEN v_priority := 'normal'; END IF;

    UPDATE public.crm_conversations
       SET priority = CASE
                        WHEN v_priority = 'urgent' THEN 'urgent'
                        WHEN v_priority = 'high' THEN 'high'
                        WHEN priority = 'urgent' THEN priority
                        WHEN priority = 'high' AND v_priority = 'normal' THEN priority
                        ELSE v_priority
                      END,
           queue_entered_at = COALESCE(queue_entered_at, NEW.created_at),
           last_inbound_at = NEW.created_at,
           first_response_due_at = CASE
             WHEN first_response_at IS NULL THEN COALESCE(first_response_due_at, NEW.created_at + make_interval(mins => v_due_minutes))
             ELSE first_response_due_at
           END,
           updated_at = GREATEST(updated_at, NEW.created_at)
     WHERE id = NEW.conversation_id
       AND user_id = NEW.user_id;

  ELSIF NEW.direction = 'outbound' THEN
    UPDATE public.crm_conversations
       SET first_response_at = CASE
             WHEN first_response_at IS NULL AND last_inbound_at IS NOT NULL THEN NEW.created_at
             ELSE first_response_at
           END,
           sla_breached_at = CASE
             WHEN first_response_at IS NULL
              AND first_response_due_at IS NOT NULL
              AND NEW.created_at > first_response_due_at
             THEN NEW.created_at
             ELSE sla_breached_at
           END,
           updated_at = GREATEST(updated_at, NEW.created_at)
     WHERE id = NEW.conversation_id
       AND user_id = NEW.user_id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_crm_inbox_sla_lifecycle ON public.crm_messages;
CREATE TRIGGER trg_crm_inbox_sla_lifecycle
AFTER INSERT ON public.crm_messages
FOR EACH ROW
EXECUTE FUNCTION public.crm_sync_inbox_sla();

CREATE OR REPLACE FUNCTION public.crm_conversation_sla(p_conversation_id uuid)
RETURNS TABLE(
  conversation_id uuid,
  priority text,
  queue_entered_at timestamptz,
  last_inbound_at timestamptz,
  first_response_at timestamptz,
  first_response_due_at timestamptz,
  sla_breached_at timestamptz,
  sla_state text,
  response_seconds bigint
)
LANGUAGE sql
SECURITY INVOKER
STABLE
SET search_path=public
AS $$
  SELECT c.id,
         c.priority,
         c.queue_entered_at,
         c.last_inbound_at,
         c.first_response_at,
         c.first_response_due_at,
         c.sla_breached_at,
         CASE
           WHEN c.first_response_at IS NOT NULL AND c.first_response_due_at IS NOT NULL AND c.first_response_at <= c.first_response_due_at THEN 'met'
           WHEN c.first_response_at IS NOT NULL THEN 'breached'
           WHEN c.first_response_due_at IS NOT NULL AND now() > c.first_response_due_at THEN 'breached_open'
           WHEN c.first_response_due_at IS NOT NULL THEN 'at_risk'
           ELSE 'not_started'
         END,
         CASE WHEN c.last_inbound_at IS NOT NULL AND c.first_response_at IS NOT NULL
              THEN EXTRACT(EPOCH FROM (c.first_response_at - c.last_inbound_at))::bigint
              ELSE NULL END
    FROM public.crm_conversations c
   WHERE c.id = p_conversation_id
     AND c.user_id = auth.uid();
$$;

REVOKE ALL ON FUNCTION public.crm_conversation_sla(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.crm_conversation_sla(uuid) TO authenticated;
