-- ALTHEA PAY — Live Chat / Checkout operational hardening
-- Integrates the checkout live-chat contract into the existing CRM model.
-- No duplicate chat tables are created.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'lead_checkout_status' AND typnamespace = 'public'::regnamespace) THEN
    CREATE TYPE public.lead_checkout_status AS ENUM ('respondendo_quiz','no_checkout','parado_no_caixa','cartao_recusado','pago');
  END IF;
END $$;

ALTER TABLE public.crm_conversations
  ADD COLUMN IF NOT EXISTS checkout_status public.lead_checkout_status NOT NULL DEFAULT 'respondendo_quiz'::public.lead_checkout_status,
  ADD COLUMN IF NOT EXISTS quiz_answers jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS gateway_error_log text,
  ADD COLUMN IF NOT EXISTS last_activity_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  ADD COLUMN IF NOT EXISTS customer_whatsapp text;

CREATE INDEX IF NOT EXISTS crm_conversations_user_checkout_status_idx ON public.crm_conversations(user_id, checkout_status, last_activity_at DESC);
CREATE INDEX IF NOT EXISTS crm_conversations_funnel_checkout_status_idx ON public.crm_conversations(funnel_id, checkout_status, last_activity_at DESC) WHERE funnel_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS crm_conversations_last_activity_idx ON public.crm_conversations(last_activity_at DESC);

CREATE OR REPLACE FUNCTION public.sync_checkout_chat_state_from_event()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  p jsonb := COALESCE(new.payload, '{}'::jsonb);
  c jsonb := COALESCE(p->'customer', '{}'::jsonb);
  v_email text := NULLIF(TRIM(COALESCE(c->>'email', p->>'email', '')), '');
  v_phone text := NULLIF(TRIM(COALESCE(c->>'whatsapp', c->>'phone', p->>'whatsapp', p->>'phone', '')), '');
  v_conversation uuid;
  v_status public.lead_checkout_status;
  v_gateway_error text := NULLIF(TRIM(COALESCE(p->>'gateway_error', p->>'error_message', p->>'decline_message', '')), '');
BEGIN
  IF new.event_type NOT IN ('page_view','quiz_started','quiz_answered','checkout_started','checkout_abandoned','payment_created','payment_failed','payment_approved','chat_started','chat_message') THEN RETURN new; END IF;
  v_status := CASE new.event_type
    WHEN 'page_view' THEN 'respondendo_quiz'::public.lead_checkout_status
    WHEN 'quiz_started' THEN 'respondendo_quiz'::public.lead_checkout_status
    WHEN 'quiz_answered' THEN 'respondendo_quiz'::public.lead_checkout_status
    WHEN 'checkout_started' THEN 'no_checkout'::public.lead_checkout_status
    WHEN 'checkout_abandoned' THEN 'parado_no_caixa'::public.lead_checkout_status
    WHEN 'payment_failed' THEN 'cartao_recusado'::public.lead_checkout_status
    WHEN 'payment_approved' THEN 'pago'::public.lead_checkout_status
    ELSE NULL
  END;
  SELECT id INTO v_conversation FROM public.crm_conversations
   WHERE user_id = new.user_id
     AND (funnel_id = new.funnel_id OR (funnel_id IS NULL AND new.funnel_id IS NULL))
     AND status <> 'closed'
     AND ((v_email IS NOT NULL AND lower(COALESCE(buyer_email,'')) = lower(v_email))
       OR (v_phone IS NOT NULL AND regexp_replace(COALESCE(customer_whatsapp,''),'[^0-9]+','','g') = regexp_replace(v_phone,'[^0-9]+','','g'))
       OR (v_email IS NULL AND v_phone IS NULL))
   ORDER BY updated_at DESC LIMIT 1;
  IF v_conversation IS NULL THEN
    INSERT INTO public.crm_conversations (user_id,funnel_id,transaction_id,buyer_name,buyer_email,customer_whatsapp,status,metadata,checkout_status,quiz_answers,gateway_error_log,last_activity_at,last_message_at,last_message_direction)
    VALUES (new.user_id,new.funnel_id,NULLIF(p->>'transaction_id',''),NULLIF(TRIM(COALESCE(c->>'name',p->>'name','')),''),v_email,v_phone,'open',p,COALESCE(v_status,'respondendo_quiz'::public.lead_checkout_status),CASE WHEN jsonb_typeof(p->'answers')='object' THEN p->'answers' ELSE '{}'::jsonb END,v_gateway_error,COALESCE(new.occurred_at,now()),CASE WHEN new.event_type IN ('chat_message','chat_started') THEN COALESCE(new.occurred_at,now()) ELSE NULL END,CASE WHEN new.event_type='chat_message' THEN 'inbound' ELSE NULL END)
    RETURNING id INTO v_conversation;
  ELSE
    UPDATE public.crm_conversations SET
      buyer_name=COALESCE(NULLIF(TRIM(COALESCE(c->>'name',p->>'name','')),''),buyer_name),
      buyer_email=COALESCE(v_email,buyer_email), customer_whatsapp=COALESCE(v_phone,customer_whatsapp),
      transaction_id=COALESCE(NULLIF(p->>'transaction_id',''),transaction_id),
      metadata=CASE WHEN jsonb_typeof(p)='object' THEN metadata || p ELSE metadata END,
      quiz_answers=CASE WHEN jsonb_typeof(p->'answers')='object' THEN quiz_answers || p->'answers' ELSE quiz_answers END,
      checkout_status=COALESCE(v_status,checkout_status), gateway_error_log=COALESCE(v_gateway_error,gateway_error_log),
      last_activity_at=GREATEST(last_activity_at,COALESCE(new.occurred_at,now())),
      last_message_at=CASE WHEN new.event_type IN ('chat_message','chat_started') THEN COALESCE(new.occurred_at,now()) ELSE last_message_at END,
      last_message_direction=CASE WHEN new.event_type='chat_message' THEN 'inbound' ELSE last_message_direction END,
      updated_at=now()
    WHERE id=v_conversation;
  END IF;
  RETURN new;
END;
$fn$;

DROP TRIGGER IF EXISTS integration_events_sync_checkout_chat_state ON public.integration_events;
CREATE TRIGGER integration_events_sync_checkout_chat_state AFTER INSERT ON public.integration_events FOR EACH ROW EXECUTE FUNCTION public.sync_checkout_chat_state_from_event();

CREATE OR REPLACE FUNCTION public.check_checkout_inactivity()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE v_count integer;
BEGIN
  UPDATE public.crm_conversations SET checkout_status='parado_no_caixa'::public.lead_checkout_status,updated_at=now()
   WHERE checkout_status='no_checkout'::public.lead_checkout_status AND status <> 'closed' AND last_activity_at < (now()-interval '1 minute');
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$fn$;

REVOKE ALL ON FUNCTION public.check_checkout_inactivity() FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname='cron') THEN
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname='althea-check-checkout-inactivity';
    PERFORM cron.schedule('althea-check-checkout-inactivity','* * * * *',$job$SELECT public.check_checkout_inactivity();$job$);
  END IF;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

ALTER TABLE public.crm_conversations REPLICA IDENTITY FULL;
