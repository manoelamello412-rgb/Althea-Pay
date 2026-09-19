-- Canonical financial-source rule: settlement journals are the authoritative
-- financial posting for provider fees. Reconciliation item fees remain
-- evidence and must never create a second economic fee posting.
DROP TRIGGER IF EXISTS trg_gateway_fee_financial_posting ON public.reconciliation_items;
DROP FUNCTION IF EXISTS public.post_gateway_fee_financial_journal();

CREATE OR REPLACE FUNCTION public.assert_reconciliation_item_tenant_link()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.transaction_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public.gateway_transactions t
      WHERE t.id = NEW.transaction_id
        AND t.user_id = NEW.user_id
    ) THEN
      RAISE EXCEPTION 'reconciliation_transaction_tenant_mismatch';
    END IF;
  END IF;
  IF NEW.run_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public.reconciliation_runs r
      WHERE r.id = NEW.run_id
        AND r.user_id = NEW.user_id
    ) THEN
      RAISE EXCEPTION 'reconciliation_run_tenant_mismatch';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_reconciliation_item_tenant_link ON public.reconciliation_items;
CREATE TRIGGER trg_reconciliation_item_tenant_link
BEFORE INSERT OR UPDATE ON public.reconciliation_items
FOR EACH ROW EXECUTE FUNCTION public.assert_reconciliation_item_tenant_link();

REVOKE ALL ON FUNCTION public.assert_reconciliation_item_tenant_link() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.assert_reconciliation_item_tenant_link() TO service_role;

COMMENT ON TABLE public.reconciliation_items IS 'Gateway reconciliation evidence. Provider fees are evidence only; canonical fee posting occurs from settlement financial journals to prevent double counting.';
