DROP TRIGGER IF EXISTS trg_gateway_fee_financial_posting ON public.reconciliation_items;
CREATE UNIQUE INDEX IF NOT EXISTS uq_gateway_financial_journal_source_event_tenant ON public.gateway_financial_journals(user_id, source_event_key) WHERE source_event_key IS NOT NULL;
COMMENT ON TABLE public.gateway_financial_journals IS 'Canonical gateway ledger. Settlement journals are authoritative for settled provider fees; reconciliation_items.provider_fee is source data and does not auto-post a second fee journal.';
