import { randomUUID } from 'node:crypto'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'

export enum PixStatus {
  PENDING = 'PENDING',
  PAID = 'PAID',
  EXPIRED = 'EXPIRED',
  CANCELED = 'CANCELED',
}

export interface PixInvoicePayload {
  tenantId: string
  productId: string
  clientId: string
  amountCents: number
  discountCents?: number
  gatewayId?: string | null
  transactionId?: string | null
  pixKey?: string
  merchantName?: string
  merchantCity?: string
  expiresInSeconds?: number
}

export interface PixInvoiceResult {
  pixId: string
  txid: string
  copyAndPasteCode: string
  expiresAt: string
  status: PixStatus
  amountCents: number
  discountCents: number
  finalAmountCents: number
}

export interface PixSettlementWebhook {
  eventId: string
  pixId: string
  providerPaymentId: string
  paidAmountCents: number
  payload: Record<string, unknown>
  signatureVerified: boolean
}

export interface PixSettlementResult {
  success: boolean
  alreadySettled: boolean
  pixId: string
  transactionId: string | null
  journalId: string | null
  status: PixStatus
}

interface PixInvoiceRow {
  id: string
  user_id: string
  product_id: string
  client_id: string
  amount_cents: number | string
  discount_cents: number | string
  final_amount_cents: number | string
  txid: string
  emv_payload: string
  status: PixStatus
  expires_at: string
}

interface PixSettlementRow {
  settled: boolean
  already_settled: boolean
  invoice_id: string
  transaction_id: string | null
  journal_id: string | null
  status: PixStatus
}

const PIX_MAX_EXPIRATION_SECONDS = 15 * 60
const PIX_MIN_EXPIRATION_SECONDS = 60
const PIX_TXID_LENGTH = 25

function normalizeText(value: string, maxLength: number): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9 .&\-]/g, '')
    .trim()
    .toUpperCase()
    .slice(0, maxLength)
}

function encodeEmvField(id: string, value: string): string {
  if (value.length > 99) throw new Error(`EMV field ${id} exceeds 99 characters.`)
  return `${id}${String(value.length).padStart(2, '0')}${value}`
}

function crc16Ccitt(payload: string): string {
  let crc = 0xffff
  for (let index = 0; index < payload.length; index += 1) {
    crc ^= payload.charCodeAt(index) << 8
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc & 0x8000) !== 0 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0')
}

function buildPixPayload(
  pixKey: string,
  amountCents: number,
  txid: string,
  merchantName: string,
  merchantCity: string,
): string {
  const amount = (amountCents / 100).toFixed(2)
  const merchantAccountInformation = [
    encodeEmvField('00', 'br.gov.bcb.pix'),
    encodeEmvField('01', pixKey),
  ].join('')

  const payloadWithoutCrc = [
    encodeEmvField('00', '01'),
    encodeEmvField('01', '12'),
    encodeEmvField('26', merchantAccountInformation),
    encodeEmvField('52', '0000'),
    encodeEmvField('53', '986'),
    encodeEmvField('54', amount),
    encodeEmvField('58', 'BR'),
    encodeEmvField('59', merchantName),
    encodeEmvField('60', merchantCity),
    encodeEmvField('62', encodeEmvField('05', txid)),
    '6304',
  ].join('')

  return `${payloadWithoutCrc}${crc16Ccitt(payloadWithoutCrc)}`
}

function asPositiveInteger(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${field} must be a positive safe integer.`)
  }
  return value
}

function getRpcErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'object' && error !== null && 'message' in error) {
    const message = (error as { message?: unknown }).message
    if (typeof message === 'string') return message
  }
  return 'Supabase RPC failed.'
}

export class AltheaPixEngine {
  private readonly supabase = createSupabaseAdminClient()

  public async generateContingencyPix(payload: PixInvoicePayload): Promise<PixInvoiceResult> {
    const amountCents = asPositiveInteger(payload.amountCents, 'amountCents')
    const discountCents = payload.discountCents ?? 0

    if (!Number.isSafeInteger(discountCents) || discountCents < 0 || discountCents >= amountCents) {
      throw new Error('discountCents must be zero or a positive integer smaller than amountCents.')
    }

    const expiresInSeconds = payload.expiresInSeconds ?? PIX_MAX_EXPIRATION_SECONDS
    if (
      !Number.isSafeInteger(expiresInSeconds) ||
      expiresInSeconds < PIX_MIN_EXPIRATION_SECONDS ||
      expiresInSeconds > PIX_MAX_EXPIRATION_SECONDS
    ) {
      throw new Error('Pix expiration must be between 60 and 900 seconds.')
    }

    const pixKey = payload.pixKey?.trim() || process.env.ALTHEA_PIX_KEY?.trim()
    if (!pixKey) throw new Error('ALTHEA_PIX_KEY is required to issue a Pix payload.')

    const merchantName = normalizeText(
      payload.merchantName || process.env.ALTHEA_PIX_MERCHANT_NAME || 'ALTHEA PAY',
      25,
    )
    const merchantCity = normalizeText(
      payload.merchantCity || process.env.ALTHEA_PIX_MERCHANT_CITY || 'SAO PAULO',
      15,
    )
    if (!merchantName || !merchantCity) throw new Error('Pix merchant identity is invalid.')

    const txid = `ALTHEA${randomUUID().replace(/-/g, '').slice(0, PIX_TXID_LENGTH - 6)}`
    const finalAmountCents = amountCents - discountCents
    const expiresAt = new Date(Date.now() + expiresInSeconds * 1000)
    const emvPayload = buildPixPayload(pixKey, finalAmountCents, txid, merchantName, merchantCity)

    const { data, error } = await this.supabase.rpc('create_iara_pix_invoice', {
      p_user_id: payload.tenantId,
      p_product_id: payload.productId,
      p_client_id: payload.clientId,
      p_gateway_id: payload.gatewayId ?? null,
      p_transaction_id: payload.transactionId ?? null,
      p_amount_cents: amountCents,
      p_discount_cents: discountCents,
      p_pix_key: pixKey,
      p_txid: txid,
      p_emv_payload: emvPayload,
      p_expires_at: expiresAt.toISOString(),
    })

    if (error) throw new Error(`PIX_ISSUANCE_FAILED: ${error.message}`)
    if (!data) throw new Error('PIX_ISSUANCE_FAILED: empty persistence result.')

    const row = data as unknown as PixInvoiceRow
    return {
      pixId: row.id,
      txid: row.txid,
      copyAndPasteCode: row.emv_payload,
      expiresAt: row.expires_at,
      status: row.status,
      amountCents: Number(row.amount_cents),
      discountCents: Number(row.discount_cents),
      finalAmountCents: Number(row.final_amount_cents),
    }
  }

  public async liquidatePixCallback(
    tenantId: string,
    webhook: PixSettlementWebhook,
  ): Promise<PixSettlementResult> {
    if (!webhook.signatureVerified) {
      throw new Error('PIX_WEBHOOK_REJECTED: provider signature was not verified.')
    }
    if (!webhook.eventId.trim() || !webhook.pixId.trim() || !webhook.providerPaymentId.trim()) {
      throw new Error('PIX_WEBHOOK_REJECTED: missing immutable event identity.')
    }
    asPositiveInteger(webhook.paidAmountCents, 'paidAmountCents')

    const { data, error } = await this.supabase.rpc('settle_iara_pix', {
      p_user_id: tenantId,
      p_event_id: webhook.eventId,
      p_pix_invoice_id: webhook.pixId,
      p_provider_payment_id: webhook.providerPaymentId,
      p_paid_amount_cents: webhook.paidAmountCents,
      p_payload: webhook.payload,
      p_signature_verified: true,
    })

    if (error) throw new Error(`PIX_SETTLEMENT_FAILED: ${getRpcErrorMessage(error)}`)
    if (!data) throw new Error('PIX_SETTLEMENT_FAILED: empty settlement result.')

    const raw = Array.isArray(data) ? data[0] : data
    const row = raw as unknown as PixSettlementRow
    if (!row?.invoice_id) throw new Error('PIX_SETTLEMENT_FAILED: invalid settlement result.')

    return {
      success: row.settled,
      alreadySettled: row.already_settled,
      pixId: row.invoice_id,
      transactionId: row.transaction_id,
      journalId: row.journal_id,
      status: row.status,
    }
  }
}
