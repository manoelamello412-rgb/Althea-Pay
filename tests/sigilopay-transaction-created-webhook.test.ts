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
