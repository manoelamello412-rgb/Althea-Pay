-- Preserve the OCC invariant: transaction versions are strictly positive.
ALTER TABLE public.gateway_transactions
  ADD CONSTRAINT gateway_transactions_version_positive CHECK (version > 0);
