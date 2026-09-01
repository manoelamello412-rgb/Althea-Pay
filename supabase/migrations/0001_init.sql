-- Initial migrations for Althea Pay

-- Table: idempotency_keys
CREATE TABLE IF NOT EXISTS idempotency_keys (
  key TEXT PRIMARY KEY,
  response JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Table: webhook_events
CREATE TABLE IF NOT EXISTS webhook_events (
  id BIGSERIAL PRIMARY KEY,
  event_id TEXT NOT NULL,
  payload JSONB NOT NULL,
  received_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  processed BOOLEAN DEFAULT FALSE,
  attempts INTEGER DEFAULT 0,
  next_attempt_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  UNIQUE(event_id)
);

-- Table: webhook_events_dlq
CREATE TABLE IF NOT EXISTS webhook_events_dlq (
  id BIGSERIAL PRIMARY KEY,
  event_id TEXT NOT NULL,
  payload JSONB NOT NULL,
  moved_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  reason TEXT
);

-- Table: ledger_transactions (POC)
CREATE TABLE IF NOT EXISTS ledger_transactions (
  id BIGSERIAL PRIMARY KEY,
  gateway_tx_id TEXT,
  merchant_id UUID,
  amount BIGINT NOT NULL,
  gross BIGINT,
  fees BIGINT,
  net BIGINT,
  currency TEXT,
  status TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Table: reconciliations (POC)
CREATE TABLE IF NOT EXISTS reconciliations (
  id BIGSERIAL PRIMARY KEY,
  ledger_tx_id BIGINT REFERENCES ledger_transactions(id),
  settlement_reference TEXT,
  matched BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);
