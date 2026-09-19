-- RLS policy templates for Althea Pay
-- NOTE: Do not apply these automatically. Use service_role and review before applying.

-- Example: enable RLS on transactions
ALTER TABLE IF EXISTS transactions ENABLE ROW LEVEL SECURITY;

-- Allow select/insert/update for role matching merchant_id claim
-- Replace jwt.claims syntax according to your Auth setup
CREATE POLICY IF NOT EXISTS "merchant_can_select_transactions"
ON transactions
FOR SELECT
USING (merchant_id::text = current_setting('jwt.claims.merchant_id', true));

CREATE POLICY IF NOT EXISTS "merchant_can_insert_transactions"
ON transactions
FOR INSERT
WITH CHECK (merchant_id::text = current_setting('jwt.claims.merchant_id', true));
