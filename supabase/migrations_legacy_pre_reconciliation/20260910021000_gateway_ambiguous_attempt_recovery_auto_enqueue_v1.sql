BEGIN;

CREATE OR REPLACE FUNCTION public.enqueue_gateway_ambiguous_recovery()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tx_user uuid;
BEGIN
  IF NEW.failure_class IS NULL OR NEW.failure_class NOT IN ('timeout','technical','unavailable','unknown') THEN
    RETURN NEW;
  END IF;

  IF NEW.status NOT IN ('error','unknown') THEN
    RETURN NEW;
  END IF;

  IF NEW.user_id IS NULL OR NEW.gateway_id IS NULL OR NEW.idempotency_key IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT t.user_id INTO v_tx_user
  FROM public.gateway_transactions t
  WHERE t.id = NEW.transaction_id
    AND t.user_id = NEW.user_id;

  IF NEW.transaction_id IS NULL OR v_tx_user IS NULL THEN
    RETURN NEW;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.gateway_recovery_queue q
    WHERE q.user_id = NEW.user_id
      AND q.attempt_id = NEW.id
      AND q.status IN ('queued','processing')
  ) THEN
    INSERT INTO public.gateway_recovery_queue (
      user_id, attempt_id, transaction_id, gateway_id, provider,
      idempotency_key, failure_class, external_transaction_id,
      status, attempts, next_retry_at, last_error
    )
    SELECT
      NEW.user_id, NEW.id, NEW.transaction_id, NEW.gateway_id,
      COALESCE(g.provider, NEW.gateway_name), NEW.idempotency_key,
      NEW.failure_class, NEW.external_transaction_id, 'queued', 0,
      now(), LEFT(COALESCE(NEW.error_message, 'ambiguous_gateway_attempt'), 2000)
    FROM public.gateways g
    WHERE g.id = NEW.gateway_id
      AND g.user_id = NEW.user_id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_gateway_ambiguous_attempt_recovery_auto_enqueue
  ON public.gateway_payment_attempts;

CREATE TRIGGER trg_gateway_ambiguous_attempt_recovery_auto_enqueue
AFTER INSERT ON public.gateway_payment_attempts
FOR EACH ROW
EXECUTE FUNCTION public.enqueue_gateway_ambiguous_recovery();

REVOKE ALL ON FUNCTION public.enqueue_gateway_ambiguous_recovery() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_gateway_ambiguous_recovery() TO service_role;

COMMIT;
