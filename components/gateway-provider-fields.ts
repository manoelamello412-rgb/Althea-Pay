export type GatewayCredentialField = {
  name: string
  label: string
  type: 'text' | 'password'
  required: boolean
  section?: 'credentials' | 'technical'
}

const TECHNICAL_NAMES = new Set([
  'base_url', 'api_base_url', 'webhook_url', 'auth_header',
  'authentication_header', 'auth_prefix', 'health_endpoint', 'health_path',
  'create_payment_endpoint', 'create_path', 'payment_endpoint', 'query_payment_endpoint',
  'status_endpoint', 'status_path', 'refund_endpoint', 'refund_path',
  'request_template', 'response_mapping', 'status_mapping', 'additional_headers',
  'custom_headers', 'idempotency_header', 'create_method', 'query_method',
  'status_method', 'refund_method', 'health_method', 'http_method',
])

const WEBHOOK_NAMES = new Set(['webhook_secret'])

export const isWebhookCredentialField = (field: GatewayCredentialField): boolean =>
  WEBHOOK_NAMES.has(field.name.trim().toLowerCase())

export const isTechnicalGatewayField = (field: GatewayCredentialField): boolean => {
  if (field.section === 'technical') return true
  return TECHNICAL_NAMES.has(field.name.trim().toLowerCase())
}

/**
 * Native providers inherit transport from their adapter, so technical fields stay hidden.
 * Generic HTTP providers are intentionally operator-configurable and may expose transport fields.
 */
export const getOperationalCredentialFields = (
  fields: GatewayCredentialField[],
  includeTechnical = false,
): GatewayCredentialField[] =>
  fields.filter(field =>
    !isWebhookCredentialField(field) && (includeTechnical || !isTechnicalGatewayField(field))
  )

export const getWebhookCredentialFields = (fields: GatewayCredentialField[]): GatewayCredentialField[] =>
  fields.filter(isWebhookCredentialField)
