import { createHmac, randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'

export type NetworkToken = { token: string; brand: string; last4: string; provider: string; expiresAt: string | null }
export type PortableVaultReference = { vaultToken: string; fingerprint: string; brand: string; last4: string; networkTokens: NetworkToken[] }
export type NetworkTokenProvider = { name: string; provision: (input: { userId: string; customerReference: string; cardBrand: string; last4: string; networkToken?: string }) => Promise<NetworkToken> }

type VaultRow = { vault_token: string; fingerprint: string; card_brand: string; last4: string; network_tokens: unknown }

function secret(): string {
  const value = process.env.ALTHEA_VAULT_HMAC_SECRET
  if (!value || value.length < 32) throw new Error('ALTHEA_VAULT_HMAC_SECRET must be configured with at least 32 characters.')
  return value
}

function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceRoleKey) throw new Error('Supabase service role configuration is required by the vault.')
  return createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } })
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
  const supabase = adminClient()
  const vaultToken = createVaultToken(input.userId, input.cardBrand, input.last4, input.customerReference)
  const digest = fingerprint(input.userId, input.cardBrand, input.last4, input.customerReference)
  const existing = await supabase.from('card_vault_tokens').select('id,network_tokens').eq('user_id', input.userId).eq('fingerprint', digest).maybeSingle()
  if (existing.error) throw existing.error
  const previousTokens = existing.data && Array.isArray(existing.data.network_tokens) ? existing.data.network_tokens as NetworkToken[] : []
  const networkTokens = [...previousTokens.filter((candidate) => candidate.provider !== input.networkToken.provider), { provider: input.networkToken.provider, token: input.networkToken.token, brand: input.networkToken.brand, last4: input.networkToken.last4, expiresAt: input.networkToken.expiresAt }]
  const row = { user_id: input.userId, vault_token: existing.data?.id ? undefined : vaultToken, fingerprint: digest, card_brand: normalizeBrand(input.cardBrand), last4: normalizeLast4(input.last4), network_tokens: networkTokens, updated_at: new Date().toISOString() }
  const result = existing.data?.id ? await supabase.from('card_vault_tokens').update(row).eq('id', existing.data.id).select('vault_token,fingerprint,card_brand,last4,network_tokens').single() : await supabase.from('card_vault_tokens').insert(row).select('vault_token,fingerprint,card_brand,last4,network_tokens').single()
  if (result.error || !result.data) throw result.error ?? new Error('Unable to persist vault reference.')
  const data = result.data as unknown as VaultRow
  return { vaultToken: data.vault_token, fingerprint: data.fingerprint, brand: data.card_brand, last4: data.last4, networkTokens: Array.isArray(data.network_tokens) ? data.network_tokens as NetworkToken[] : [] }
}

export async function resolveNetworkToken(userId: string, vaultToken: string, provider: string): Promise<NetworkToken> {
  if (!userId || !vaultToken || !provider) throw new Error('Vault resolution requires user, token and provider.')
  const result = await adminClient().from('card_vault_tokens').select('network_tokens').eq('user_id', userId).eq('vault_token', vaultToken).maybeSingle()
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
