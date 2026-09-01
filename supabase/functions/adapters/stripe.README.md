# Stripe Adapter (skeleton)

This file documents how to test and configure the Stripe adapter skeleton included in `supabase/functions/adapters/stripe.ts`.

Environment
- PSP_STRIPE_KEY: (optional) Stripe sandbox API key. If absent the adapter returns sandbox responses for local development.

Local quick test
1. Ensure Node 18+ is installed.
2. From repo root: `node supabase/functions/adapters/stripe.test.node.js`

Notes
- This adapter is a skeleton. When you provide `PSP_STRIPE_KEY` the adapter will still need implementation for actual API calls (authorize -> PaymentIntent with capture_method=manual; capture -> capture PaymentIntent; refund -> create refund).
- Webhook verification for Stripe should use `stripe.webhooks.constructEvent` when integrating the real key/secret.
