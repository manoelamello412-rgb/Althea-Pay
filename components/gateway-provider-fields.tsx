'use client'

export type GatewayCredentialField = {
  name: string
  type: 'text' | 'password'
  label: string
  required: boolean
}

/**
 * Provider registry schemas may contain execution/webhook metadata as well as
 * operator-entered credentials. The gateway connection UI must expose only
 * credentials that are safe and meaningful for an operational connection.
 */
const TECHNICAL_FIELDS = new Set([
  'base_url',
  'auth_header',
  'auth_prefix',
  'health_path',
  'create_path',
  'status_path',
  'refund_path',
  'request_template',
  'response_mapping',
  'status_mapping',
  'custom_headers',
  'idempotency_header',
  'create_method',
  'status_method',
  'refund_method',
  'health_method',
])

const WEBHOOK_FIELDS = new Set([
  'webhook_secret',
])

export function getOperationalCredentialFields(fields: GatewayCredentialField[]): GatewayCredentialField[] {
  return fields.filter(field => !TECHNICAL_FIELDS.has(field.name) && !WEBHOOK_FIELDS.has(field.name))
}

export function getWebhookCredentialFields(fields: GatewayCredentialField[]): GatewayCredentialField[] {
  return fields.filter(field => WEBHOOK_FIELDS.has(field.name))
}
