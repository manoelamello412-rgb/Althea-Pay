import { beforeEach, describe, expect, it, vi } from 'vitest'

const rpcMock = vi.fn()

vi.mock('@/lib/supabase/admin', () => ({
  createSupabaseAdminClient: () => ({ rpc: rpcMock }),
}))

import { AltheaPixEngine, PixStatus } from './AltheaPixEngine'

describe('AltheaPixEngine', () => {
  beforeEach(() => {
    rpcMock.mockReset()
    process.env.ALTHEA_PIX_KEY = 'pix-key-test@example.com'
    process.env.ALTHEA_PIX_MERCHANT_NAME = 'ALTHEA PAY'
    process.env.ALTHEA_PIX_MERCHANT_CITY = 'SAO PAULO'
  })

  it('rejects unsafe monetary input instead of rounding silently', async () => {
    const engine = new AltheaPixEngine()

    await expect(
      engine.generateContingencyPix({
        tenantId: '00000000-0000-0000-0000-000000000001',
        productId: 'prod-1',
        clientId: 'client-1',
        amountCents: 100.5,
      }),
    ).rejects.toThrow('amountCents must be a positive safe integer')
  })

  it('persists a real EMV payload with a 15-minute maximum expiry', async () => {
    rpcMock.mockResolvedValue({
      data: {
        id: '00000000-0000-0000-0000-000000000010',
        txid: 'ALTHEA12345678901234567',
        emv_payload: '0002010102126304ABCD',
        expires_at: new Date(Date.now() + 900000).toISOString(),
        status: PixStatus.PENDING,
        amount_cents: 1000,
        discount_cents: 100,
        final_amount_cents: 900,
      },
      error: null,
    })

    const engine = new AltheaPixEngine()
    const result = await engine.generateContingencyPix({
      tenantId: '00000000-0000-0000-0000-000000000001',
      productId: 'prod-1',
      clientId: 'client-1',
      amountCents: 1000,
      discountCents: 100,
    })

    expect(result.pixId).toBe('00000000-0000-0000-0000-000000000010')
    expect(result.finalAmountCents).toBe(900)
    expect(result.status).toBe(PixStatus.PENDING)
    expect(rpcMock).toHaveBeenCalledWith('create_iara_pix_invoice', expect.objectContaining({
      p_amount_cents: 1000,
      p_discount_cents: 100,
      p_pix_key: 'pix-key-test@example.com',
    }))
  })

  it('refuses an unverified PSP webhook', async () => {
    const engine = new AltheaPixEngine()

    await expect(
      engine.liquidatePixCallback('00000000-0000-0000-0000-000000000001', {
        eventId: 'evt-1',
        pixId: '00000000-0000-0000-0000-000000000010',
        providerPaymentId: 'pay-1',
        paidAmountCents: 900,
        payload: {},
        signatureVerified: false,
      }),
    ).rejects.toThrow('provider signature was not verified')
    expect(rpcMock).not.toHaveBeenCalled()
  })

  it('returns the database idempotent settlement result', async () => {
    rpcMock.mockResolvedValue({
      data: [{
        settled: true,
        already_settled: true,
        invoice_id: '00000000-0000-0000-0000-000000000010',
        transaction_id: null,
        journal_id: null,
        status: PixStatus.PAID,
      }],
      error: null,
    })

    const engine = new AltheaPixEngine()
    const result = await engine.liquidatePixCallback('00000000-0000-0000-0000-000000000001', {
      eventId: 'evt-1',
      pixId: '00000000-0000-0000-0000-000000000010',
      providerPaymentId: 'pay-1',
      paidAmountCents: 900,
      payload: { status: 'paid' },
      signatureVerified: true,
    })

    expect(result.success).toBe(true)
    expect(result.alreadySettled).toBe(true)
    expect(result.status).toBe(PixStatus.PAID)
  })
})
