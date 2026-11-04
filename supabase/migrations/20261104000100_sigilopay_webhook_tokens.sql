CREATE TABLE public.sigilopay_webhook_tokens (
  gateway_id text NOT NULL
    REFERENCES public.gateways(id),
  transaction_id text NOT NULL,
  token_hash text NOT NULL
    CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (gateway_id, transaction_id)
);

ALTER TABLE public.sigilopay_webhook_tokens
ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.sigilopay_webhook_tokens
FROM PUBLIC, anon, authenticated;
