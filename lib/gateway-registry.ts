export type GatewayEnvironment = 'sandbox' | 'production'

export type GatewayAuthField = Readonly<{
  key: string
  label: string
  secret: boolean
  required: boolean
}>

export type GatewayProviderDefinition = Readonly<{
  key: string
  displayName: string
  adapterKey: string
  environments: readonly GatewayEnvironment[]
  capabilities: Readonly<{
    authorize: boolean
    capture: boolean
    refund: boolean
    void: boolean
    webhooks: boolean
  }>
  credentialFields: readonly GatewayAuthField[]
}>

const definitions: readonly GatewayProviderDefinition[] = [
  {
    key: 'stripe',
    displayName: 'Stripe',
    adapterKey: 'stripe',
    environments: ['sandbox', 'production'],
    capabilities: { authorize: true, capture: true, refund: true, void: true, webhooks: true },
    credentialFields: [
      { key: 'api_key', label: 'Secret API key', secret: true, required: true },
      { key: 'webhook_secret', label: 'Webhook signing secret', secret: true, required: true },
    ],
  },
  {
    key: 'asaas',
    displayName: 'Asaas',
    adapterKey: 'asaas',
    environments: ['sandbox', 'production'],
    capabilities: { authorize: true, capture: false, refund: true, void: false, webhooks: true },
    credentialFields: [
      { key: 'api_key', label: 'API key', secret: true, required: true },
      { key: 'webhook_secret', label: 'Webhook token', secret: true, required: false },
    ],
  },
  {
    key: 'mercado_pago',
    displayName: 'Mercado Pago',
    adapterKey: 'mercado_pago',
    environments: ['sandbox', 'production'],
    capabilities: { authorize: true, capture: false, refund: true, void: false, webhooks: true },
    credentialFields: [
      { key: 'access_token', label: 'Access token', secret: true, required: true },
      { key: 'webhook_secret', label: 'Webhook secret', secret: true, required: false },
    ],
  },
]

const byKey = new Map(definitions.map((definition) => [definition.key, definition]))

export function getGatewayProvider(provider: string): GatewayProviderDefinition | null {
  return byKey.get(provider.trim().toLowerCase()) ?? null
}

export function listGatewayProviders(): readonly GatewayProviderDefinition[] {
  return definitions
}

export function isGatewayProviderSupported(provider: string): boolean {
  return getGatewayProvider(provider) !== null
}
