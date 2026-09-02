import 'server-only'
import { createHmac, randomUUID } from 'node:crypto'
import { createSupabaseServerClient } from '@/lib/supabase/server'

export type NetworkToken = { token: string; brand: string; last4: string; provider: string; expiresAt: string | null }
export type PortableVaultReference = { vaultToken: string; fingerprint: string; brand: string; last4: string; networkTokens: NetworkToken[] }
export type NetworkTokenProvider = { name: string; provision: (input: { userId: string; customerReference: string; cardBrand: string; last4: string; networkToken?: string }) => Promise<NetworkToken> }

function secret(): string {
  const value = process.env.ALTHEA_VAULT_HMAC_SECRET
  if (!value || value.length < 32) throw new Error('ALTHEA_VAULT_HMAC_SECRET must be configured with at least 32 characters.')
  return value
}

function normalizeBrand(value: string): string {
  const brand = value.trim().toLowerCase()
  if (!/^[a-z0-9_-]{2,32}$/.test(brand)) throw new Error('Invalid card brand.')
  return brand
}

function normalizeLast4(value: string): string {
  if (!/^\d{4}$/.test(value)) throw new Error('last4 must contain exactly four digits.')
  return value
}

function fingerprint(userId: string, cardBrand: string, last4: string, stableReference: string): string {
  return createHmac('sha256', secret()).update(`${userId}:${normalizeBrand(cardBrand)}:${normalizeLast4(last4)}:${stableReference}`).digest('hex')
}

export function createVaultToken(userId: string, cardBrand: string, last4: string, stableReference: string): string {
  if (!userId) throw new Error('userId is required.')
  if (!stableReference) throw new Error('A provider or checkout stable reference is required.')
  const digest = fingerprint(userId, cardBrand, last4, stableReference)
  return `alv_${digest.slice(0, 48)}_${randomUUID().replaceAll('-', '')}`
}

export async function storeNetworkTokenReference(input: { userId: string; customerReference: string; cardBrand: string; last4: string; networkToken: NetworkToken }): Promise<PortableVaultReference> {
  if (!input.userId || !input.customerReference) throw new Error('Vault identity is incomplete.')
  const supabase = await createSupabaseServerClient()
  const vaultToken = createVaultToken(input.userId, input.cardBrand, input.last4, input.customerReference)
  const digest = fingerprint(input.userId, input.cardBrand, input.last4, input.customerReference)
  const result = await supabase.from('card_vault_tokens').upsert({ user_id: input.userId, vault_token: vaultToken, fingerprint: digest, card_brand: normalizeBrand(input.cardBrand), last4: normalizeLast4(input.last4), network_tokens: [{ provider: input.networkToken.provider, token: input.networkToken.token, expiresAt: input.networkToken.expiresAt }], updated_at: new Date().toISOString() }, { onConflict: 'user_id,fingerprint' }).select('vault_token,fingerprint,card_brand,last4,network_tokens').single()
  if (result.error || !result.data) throw result.error ?? new Error('Unable to persist vault reference.')
  return { vaultToken: String(result.data.vault_token), fingerprint: String(result.data.fingerprint), brand: String(result.data.card_brand), last4: String(result.data.last4), networkTokens: Array.isArray(result.data.network_tokens) ? result.data.network_tokens as NetworkToken[] : [] }
}

export async function resolveNetworkToken(userId: string, vaultToken: string, provider: string): Promise<NetworkToken> {
  if (!userId || !vaultToken || !provider) throw new Error('Vault resolution requires user, token and provider.')
  const supabase = await createSupabaseServerClient()
  const result = await supabase.from('card_vault_tokens').select('network_tokens').eq('user_id', userId).eq('vault_token', vaultToken).maybeSingle()
  if (result.error) throw result.error
  if (!result.data) throw new Error('Vault token not found.')
  const tokens = Array.isArray(result.data.network_tokens) ? result.data.network_tokens as NetworkToken[] : []
  const token = tokens.find((candidate) => candidate.provider === provider)
  if (!token) throw new Error(`No network token provisioned for provider ${provider}.`)
  return token
}

export async function provisionPortableToken(provider: NetworkTokenProvider, input: { userId: string; customerReference: string; cardBrand: string; last4: string; existingNetworkToken?: string }): Promise<PortableVaultReference> {
  const token = await provider.provision({ userId: input.userId, customerReference: input.customerReference, cardBrand: input.cardBrand, last4: input.last4, networkToken: input.existingNetworkToken })
  if (!token.token || !token.provider) throw new Error('The tokenization provider returned an invalid token.')
  return storeNetworkTokenReference({ userId: input.userId, customerReference: input.customerReference, cardBrand: input.cardBrand, last4: input.last4, networkToken: token })
}

export function assertNoRawCardData(payload: Record<string, unknown>): void {
  const forbidden = ['pan', 'card_number', 'cardNumber', 'number', 'cvv', 'cvc', 'security_code', 'securityCode']
  for (const key of forbidden) if (key in payload) throw new Error(`Raw card field ${key} is forbidden in the orchestration layer.`)
}
