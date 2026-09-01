# ALTHEA PAY — PCI Boundary

ALTHEA PAY is designed as a control plane, not a card-data vault.

## In scope
- Checkout orchestration.
- Gateway routing and fallback decisions.
- Transaction metadata and lifecycle state.
- Webhook processing.
- Operational logs and audit trails.

## Explicitly prohibited in application storage/logs
- Full PAN.
- CVC/CVV.
- Magnetic-stripe data.
- Authentication data that a gateway does not require ALTHEA to retain.
- Raw gateway secrets in browser code.

## Preferred payment pattern
The browser sends payment data directly to a PCI-compliant external gateway/hosted payment component whenever the provider supports it. ALTHEA receives only the minimum token/reference and transaction metadata required for orchestration and reconciliation.

## Production gate
`BLOQUEIO EXTERNO`: this document is an engineering boundary, not a PCI DSS attestation. Production launch requires the applicable PCI scope determination, provider responsibilities, contractual evidence and independent compliance review.
