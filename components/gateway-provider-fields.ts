export type GatewayCredentialField = { name: string; label: string; type: 'text' | 'password'; required: boolean; section?: 'credentials' | 'technical' }

/** Technical transport settings belong to the provider registry/adapter, never to a gateway connection. */
const TECHNICAL_NAMES = new Set([
  'base_url', 'api_base_url', 'webhook_url', 'webhook_secret', 'auth_header',
  'authentication_header', 'auth_prefix', 'health_endpoint', 'health_path',
  'create_payment_endpoint', 'create_path', 'payment_endpoint', 'query_payment_endpoint',
  'status_endpoint', 'status_path', 'refund_endpoint', 'refund_path',
  'request_template', 'response_mapping', 'status_mapping', 'additional_headers',
  'custom_headers', 'idempotency_header', 'create_method', 'query_method',
  'status_method', 'refund_method', 'health_method', 'http_method',
])

export const isTechnicalGatewayField = (field: GatewayCredentialField): boolean => {
  if (field.section === 'technical') return true
  return TECHNICAL_NAMES.has(field.name.trim().toLowerCase())
}

export const getOperationalCredentialFields = (fields: GatewayCredentialField[]): GatewayCredentialField[] =>
  fields.filter(field => !isTechnicalGatewayField(field))
