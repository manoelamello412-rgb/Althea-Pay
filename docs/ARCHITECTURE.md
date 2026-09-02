# ALTHEA PAY — Architecture

This document describes the high-level architecture of Althea Pay and how components interact.

Architecture overview

- Independent Funnel -> External Gateway
- Funnels send events / webhooks -> ALTHEA PAY public API
- ALTHEA PAY orchestrates gateways via Gateway Orchestrator
- Sandbox Gateway used for testing payment flows (approved, declined, error, fallback, refund, chargeback)
- Supabase stores operational data (transactions, idempotency keys, audit logs, reconciliation)
- Edge Functions host gateway orchestrator, gateway sandbox, webhook ingestion and health endpoints

Security principles

- ALTHEA PAY is a CONTROL PLANE (does not custody funds).
- PAN and CVC are never stored. Use hosted fields or gateway tokenization.
- Secrets (gateway keys, service_role) must live in env (Supabase/Vercel) and not in repo.

Files added in this commit:
- docs/ARCHITECTURE.md
