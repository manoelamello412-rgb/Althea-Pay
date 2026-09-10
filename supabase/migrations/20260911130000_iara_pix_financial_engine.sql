BEGIN;

CREATE TABLE IF NOT EXISTS public.iara_pix_invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  gateway_id TEXT,
  transaction_id UUID REFERENCES public.gateway_transactions(id),
  amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
  discount_cents BIGINT NOT NULL DEFAULT 0 CHECK (discount_cents >= 0),
  final_amount_cents BIGINT NOT NULL CHECK (final_amount_cents > 0),
  currency TEXT NOT NULL DEFAULT 'BRL' CHECK (currency = 'BRL'),
  pix_key TEXT NOT NULL,
  txid TEXT NOT NULL,
  emv_payload TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','PAID','EXPIRED','CANCELED')),
  expires_at TIMESTAMPTZ NOT NULL,
  paid_at TIMESTAMPTZ,
  provider_payment_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  CONSTRAINT iara_pix_amount_integrity CHECK (final_amount_cents = amount_cents - discount_cents),
  CONSTRAINT iara_pix_txid_unique UNIQUE (user_id, txid),
  CONSTRAINT iara_pix_transaction_user_fk UNIQUE (user_id, transaction_id)
);

CREATE INDEX IF NOT EXISTS idx_iara_pix_invoices_user_status_created
  ON public.iara_pix_invoices(user_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_iara_pix_invoices_user_expires
  ON public.iara_pix_invoices(user_id, expires_at)
  WHERE status = 'PENDING';
CREATE INDEX IF NOT EXISTS idx_iara_pix_invoices_provider_payment
  ON public.iara_pix_invoices(user_id, provider_payment_id)
  WHERE provider_payment_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.iara_pix_webhook_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  event_id TEXT NOT NULL,
  pix_invoice_id UUID REFERENCES public.iara_pix_invoices(id) ON DELETE RESTRICT,
  provider_payment_id TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  signature_verified BOOLEAN NOT NULL DEFAULT FALSE,
  received_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  processed_at TIMESTAMPTZ,
  UNIQUE (user_id, event_id)
);

CREATE INDEX IF NOT EXISTS idx_iara_pix_webhook_events_invoice
  ON public.iara_pix_webhook_events(user_id, pix_invoice_id, received_at DESC);

ALTER TABLE public.iara_pix_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.iara_pix_webhook_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS iara_pix_invoices_select_own ON public.iara_pix_invoices;
CREATE POLICY iara_pix_invoices_select_own
  ON public.iara_pix_invoices FOR SELECT TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS iara_pix_webhook_events_select_own ON public.iara_pix_webhook_events;
CREATE POLICY iara_pix_webhook_events_select_own
  ON public.iara_pix_webhook_events FOR SELECT TO authenticated
  USING (user_id = auth.uid());

REVOKE INSERT, UPDATE, DELETE ON public.iara_pix_invoices FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.iara_pix_webhook_events FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.create_iara_pix_invoice(
  p_user_id UUID,
  p_product_id TEXT,
  p_client_id TEXT,
  p_gateway_id TEXT,
  p_transaction_id UUID,
  p_amount_cents BIGINT,
  p_discount_cents BIGINT,
  p_pix_key TEXT,
  p_txid TEXT,
  p_emv_payload TEXT,
  p_expires_at TIMESTAMPTZ
) RETURNS public.iara_pix_invoices
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
DECLARE v_row public.iara_pix_invoices;
BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF p_user_id IS NULL OR nullif(trim(p_product_id), '') IS NULL OR nullif(trim(p_client_id), '') IS NULL THEN RAISE EXCEPTION 'invalid_pix_context'; END IF;
  IF p_amount_cents <= 0 OR p_discount_cents < 0 OR p_discount_cents >= p_amount_cents THEN RAISE EXCEPTION 'invalid_pix_amount'; END IF;
  IF p_expires_at <= now() OR p_expires_at > now() + interval '16 minutes' THEN RAISE EXCEPTION 'invalid_pix_expiration'; END IF;
  IF nullif(trim(p_pix_key), '') IS NULL OR nullif(trim(p_txid), '') IS NULL OR nullif(trim(p_emv_payload), '') IS NULL THEN RAISE EXCEPTION 'invalid_pix_payload'; END IF;
  INSERT INTO public.iara_pix_invoices(user_id,product_id,client_id,gateway_id,transaction_id,amount_cents,discount_cents,final_amount_cents,pix_key,txid,emv_payload,expires_at)
  VALUES(p_user_id,trim(p_product_id),trim(p_client_id),nullif(trim(p_gateway_id),''),p_transaction_id,p_amount_cents,p_discount_cents,p_amount_cents-p_discount_cents,trim(p_pix_key),upper(trim(p_txid)),p_emv_payload,p_expires_at)
  RETURNING * INTO v_row;
  RETURN v_row;
EXCEPTION WHEN unique_violation THEN
  SELECT * INTO v_row FROM public.iara_pix_invoices WHERE user_id=p_user_id AND txid=upper(trim(p_txid));
  IF FOUND THEN RETURN v_row; END IF;
  RAISE;
END;
$$;

CREATE OR REPLACE FUNCTION public.settle_iara_pix(
  p_user_id UUID,
  p_event_id TEXT,
  p_pix_invoice_id UUID,
  p_provider_payment_id TEXT,
  p_paid_amount_cents BIGINT,
  p_payload JSONB,
  p_signature_verified BOOLEAN
) RETURNS TABLE(settled BOOLEAN, already_settled BOOLEAN, invoice_id UUID, transaction_id UUID, journal_id UUID, status TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
DECLARE
  v_invoice public.iara_pix_invoices;
  v_event_id UUID;
  v_journal_id UUID;
BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF p_user_id IS NULL OR nullif(trim(p_event_id), '') IS NULL OR p_pix_invoice_id IS NULL THEN RAISE EXCEPTION 'invalid_pix_webhook_identity'; END IF;
  IF p_signature_verified IS NOT TRUE THEN RAISE EXCEPTION 'pix_webhook_signature_not_verified'; END IF;
  IF p_paid_amount_cents <= 0 THEN RAISE EXCEPTION 'invalid_paid_amount'; END IF;

  INSERT INTO public.iara_pix_webhook_events(user_id,event_id,pix_invoice_id,provider_payment_id,payload,signature_verified)
  VALUES(p_user_id,trim(p_event_id),p_pix_invoice_id,nullif(trim(p_provider_payment_id),''),coalesce(p_payload,'{}'::jsonb),true)
  ON CONFLICT (user_id,event_id) DO NOTHING
  RETURNING id INTO v_event_id;

  SELECT * INTO v_invoice
  FROM public.iara_pix_invoices
  WHERE id=p_pix_invoice_id AND user_id=p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'pix_invoice_not_found'; END IF;

  IF v_invoice.status = 'PAID' THEN
    IF v_event_id IS NOT NULL THEN
      UPDATE public.iara_pix_webhook_events SET processed_at=timezone('utc',now()) WHERE id=v_event_id;
    END IF;
    RETURN QUERY SELECT true,true,v_invoice.id,v_invoice.transaction_id::uuid,NULL::uuid,v_invoice.status;
    RETURN;
  END IF;

  IF p_paid_amount_cents <> v_invoice.final_amount_cents THEN
    RAISE EXCEPTION 'pix_paid_amount_mismatch';
  END IF;

  IF v_invoice.status <> 'PENDING' THEN
    RAISE EXCEPTION 'pix_invoice_not_settleable';
  END IF;

  UPDATE public.iara_pix_invoices
  SET status='PAID',paid_at=timezone('utc',now()),provider_payment_id=coalesce(nullif(trim(p_provider_payment_id),''),provider_payment_id),updated_at=timezone('utc',now())
  WHERE id=v_invoice.id AND user_id=p_user_id AND status='PENDING';

  IF v_invoice.transaction_id IS NOT NULL AND v_invoice.gateway_id IS NOT NULL THEN
    PERFORM public.transition_gateway_transaction_status(v_invoice.transaction_id,p_user_id,'approved',NULL,p_provider_payment_id);
    SELECT public.post_gateway_financial_journal(
      p_user_id,
      v_invoice.transaction_id,
      v_invoice.gateway_id,
      'sale',
      'pix:' || v_invoice.id::text,
      'BRL',
      jsonb_build_array(
        jsonb_build_object('account_code','GATEWAY_CASH','direction','debit','amount',(v_invoice.final_amount_cents::numeric / 100)::text),
        jsonb_build_object('account_code','SALES_REVENUE','direction','credit','amount',(v_invoice.final_amount_cents::numeric / 100)::text)
      ),
      jsonb_build_object('payment_method','pix','provider_payment_id',p_provider_payment_id)
    ) INTO v_journal_id;
  END IF;

  IF v_event_id IS NOT NULL THEN
    UPDATE public.iara_pix_webhook_events SET processed_at=timezone('utc',now()) WHERE id=v_event_id;
  END IF;

  RETURN QUERY SELECT true,false,v_invoice.id,v_invoice.transaction_id,v_journal_id,'PAID'::text;
END;
$$;

REVOKE ALL ON FUNCTION public.create_iara_pix_invoice(UUID,TEXT,TEXT,TEXT,UUID,BIGINT,BIGINT,TEXT,TEXT,TEXT,TIMESTAMPTZ) FROM public,anon,authenticated;
REVOKE ALL ON FUNCTION public.settle_iara_pix(UUID,TEXT,UUID,TEXT,BIGINT,JSONB,BOOLEAN) FROM public,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.create_iara_pix_invoice(UUID,TEXT,TEXT,TEXT,UUID,BIGINT,BIGINT,TEXT,TEXT,TEXT,TIMESTAMPTZ) TO service_role;
GRANT EXECUTE ON FUNCTION public.settle_iara_pix(UUID,TEXT,UUID,TEXT,BIGINT,JSONB,BOOLEAN) TO service_role;

COMMIT;
