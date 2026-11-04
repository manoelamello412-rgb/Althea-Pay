import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  parseSigiloPayTransactionCreatedPayload,
  toSigiloPayQueuePayload,
} from '../supabase/functions/_shared/sigilopay-webhook'

const validPayload = {
  event: 'TRANSACTION_CREATED',
  token: 'do-not-persist-this',
  offerCode: 'ABCK181',
  checkoutUrl: 'https://checkout.example.test/checkout/session?offer=ABCK181&utm_source=facebook',
  client: {
    id: 'client-1',
    name: 'Example Customer',
    email: 'customer@example.test',
    phone: '+5511999999999',
    cpf: '12345678901',
    cnpj: null,
    address: null,
  },
  transaction: {
    id: 'transaction-1',
    identifier: 'internal-order-1',
    status: 'COMPLETED',
    paymentMethod: 'PIX',
    originalAmount: 20,
    amount: 100,
    commissionAmount: 90,
    originalCurrency: 'USD',
    currency: 'BRL',
    exchangeRate: 5,
    installments: 1,
    createdAt: '2026-11-03T15:18:23.643Z',
    payedAt: null,
    pixInformation: {
      id: 'pix-1',
      qrCode: 'pix-qr-payload',
      endToEndId: '',
    },
    pixMetadata: {
      payerName: 'Example Payer',
    },
    boletoInformation: null,
    subscription: null,
    orderItems: [{
      id: 'item-1',
      price: 100,
      product: {
        id: 'product-1',
        name: 'Example Product',
        externalId: 'EXT-1',
      },
    }],
    trackProps: {
      utm_source: 'facebook',
      utm_campaign: 'launch',
    },
  },
}

describe('SigiloPay TRANSACTION_CREATED webhook contract', () => {
  it('validates the documented payload and maps transaction fields for the durable queue', () => {
    const parsed = parseSigiloPayTransactionCreatedPayload(validPayload)
    expect(parsed).not.toBeNull()

    const queued = toSigiloPayQueuePayload(parsed!)
    expect(queued.external_transaction_id).toBe('transaction-1')
    expect(queued.id).toBe('transaction-1')
    expect(queued.status).toBe('completed')
    expect(queued.amount).toBe(100)
    expect(queued.currency).toBe('BRL')
    expect(queued.event_kind).toBe('payment')
    expect(queued).not.toHaveProperty('token')
  })

  it('maps charged back to the existing canonical queue status', () => {
    const parsed = parseSigiloPayTransactionCreatedPayload({
      ...validPayload,
      transaction: { ...validPayload.transaction, status: 'CHARGED_BACK' },
    })
    expect(parsed).not.toBeNull()
    expect(toSigiloPayQueuePayload(parsed!).status).toBe('chargeback')
    expect(toSigiloPayQueuePayload(parsed!).event_kind).toBe('chargeback')
  })

  it('rejects unsupported events and incomplete required fields', () => {
    expect(parseSigiloPayTransactionCreatedPayload({
      ...validPayload,
      event: 'TRANSACTION_PAID',
    })).toBeNull()

    const missingTransactionId = {
      ...validPayload,
      transaction: { ...validPayload.transaction, id: undefined },
    }
    expect(parseSigiloPayTransactionCreatedPayload(missingTransactionId)).toBeNull()
  })

  it('rejects invalid enum values and malformed dates', () => {
    expect(parseSigiloPayTransactionCreatedPayload({
      ...validPayload,
      transaction: { ...validPayload.transaction, paymentMethod: 'CASH' },
    })).toBeNull()

    expect(parseSigiloPayTransactionCreatedPayload({
      ...validPayload,
      transaction: { ...validPayload.transaction, createdAt: 'not-a-date' },
    })).toBeNull()
  })
})

describe('SigiloPay webhook endpoint integration', () => {
  const endpoint = readFileSync('supabase/functions/gateway-webhook/index.ts', 'utf8')
  const normalizer = readFileSync('supabase/functions/_shared/sigilopay-webhook.ts', 'utf8')

  it('authenticates with the gateway-scoped secret before validation and durable ingestion', () => {
    const secretResolution = endpoint.indexOf('"resolve_gateway_webhook_secret"')
    const tokenComparison = endpoint.indexOf('safe(String(secretResult.data), String(payload.token ?? ""))')
    const ingestion = endpoint.indexOf('"ingest_gateway_webhook_v2"')

    expect(secretResolution).toBeGreaterThan(-1)
    expect(tokenComparison).toBeGreaterThan(secretResolution)
    expect(ingestion).toBeGreaterThan(tokenComparison)
    expect(endpoint).toContain('credentialGatewayName.includes("sigilopay")')
    expect(endpoint).toContain('sigiloPayPayload?.transaction.id')
    expect(endpoint).toContain('event: "TRANSACTION_CREATED"')
    expect(endpoint).toContain('}, 202)')
  })

  it('queues accepted events durably without making outbound provider requests or logging payload data', () => {
    expect(endpoint).toContain('"ingest_gateway_webhook_v2"')
    expect(endpoint).not.toContain('fetch(')
    expect(endpoint).not.toContain('console.log(payload')
    expect(normalizer).toContain('Object.entries(payload).filter(([key]) => key !== "token")')
    expect(normalizer).toContain('...safePayload')
  })
})


describe('SigiloPay external transaction materialization migration', () => {
  const migration = readFileSync(
    'supabase/migrations/20261104203000_import_sigilopay_external_transactions.sql',
    'utf8',
  )

  it('imports only SigiloPay transactions through the claimed webhook worker', () => {
    expect(migration).toContain("lower(trim(coalesce(v_event.provider,''))) = 'sigilopay'")
    expect(migration).toContain("lower(trim(coalesce(v_gateway.provider,''))) <> 'sigilopay'")
    expect(migration).toContain("v_payload->>'event' is distinct from 'TRANSACTION_CREATED'")
    expect(migration).toContain('insert into public.gateway_transactions')
    expect(migration).toContain('public.allocate_and_insert_gateway_payment_attempt')
    expect(migration).toContain('public.process_gateway_webhook_v11')
    expect(migration).toContain("'external_gateway_mirror'")
  })

  it('keeps tenant identity, idempotency, and the provider token out of persisted transaction data', () => {
    expect(migration).toContain('v_gateway.user_id')
    expect(migration).toContain('v_gateway.organization_id')
    expect(migration).toContain('v_gateway.id')
    expect(migration).toContain("'sigilopay:' || v_gateway.id || ':' || v_external")
    expect(migration).toContain("v_metadata := v_metadata - 'token'")
    expect(migration).toContain('revoke all on function public.server_process_claimed_gateway_webhook_v1')
  })

  it('does not associate an unverified funnel or product and seeds refundable states safely', () => {
    expect(migration).not.toMatch(/insert into public\.gateway_transactions\s*\([^)]*funnel_id/s)
    expect(migration).not.toMatch(/insert into public\.gateway_transactions\s*\([^)]*product_id/s)
    expect(migration).toContain("then 'approved'")
    expect(migration).toContain("else 'created'")
  })
})
