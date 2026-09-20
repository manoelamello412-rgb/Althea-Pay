import { withSupabase } from 'npm:@supabase/server'
import { WebhookVerifier } from '../../../lib/security/WebhookVerifier.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type, x-althea-signature, x-althea-event-id, x-althea-timestamp',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const SUCCESS = ['approved', 'paid', 'completed', 'success']
const REVERSAL = ['refunded', 'refund', 'chargeback']

function norm(value: unknown): string {
  return String(value ?? '').trim().toLowerCase()
}

function endpointKey(request: Request): string {
  const parts = new URL(request.url).pathname.split('/').filter(Boolean)
  const index = parts.indexOf('althea-webhook')
  return index >= 0 ? (parts[index + 1] ?? '') : ''
}

function transactionStatus(value: string, current: string): string {
  if (!value) return current
  if (SUCCESS.includes(value)) return 'approved'
  if (value === 'refund') return 'refunded'
  if (value === 'chargeback') return 'chargeback'
  if (value === 'declined' || value === 'rejected' || value === 'failed' || value === 'error') return 'failed'
  if (value === 'pending' || value === 'processing' || value === 'created') return value
  return current
}

Deno.serve(
  withSupabase({ auth: 'none' }, async (req, ctx) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
    if (req.method !== 'POST') return Response.json({ ok: false, error: 'method_not_allowed' }, { status: 405, headers: corsHeaders })

    const started = Date.now()
    const raw = await req.text()
    const signature = req.headers.get('x-althea-signature') ?? ''
    const eventId = req.headers.get('x-althea-event-id') ?? ''
    const timestamp = req.headers.get('x-althea-timestamp') ?? ''
    const key = endpointKey(req)
    const db = ctx.supabaseAdmin
    let deliveryId: string | null = null
    let eventIdDb: string | null = null
    let tenantUserId: string | null = null
    let tenantOrganizationId: string | null = null

    try {
      if (!eventId) return Response.json({ ok: false, error: 'event_id_required' }, { status: 400, headers: corsHeaders })
      if (!key || key.length > 300) return Response.json({ ok: false, error: 'webhook_endpoint_required' }, { status: 400, headers: corsHeaders })

      const result = await db.rpc('get_webhook_integration', { p_endpoint_key: key })
      if (result.error) throw result.error
      const integration = Array.isArray(result.data) ? (result.data[0] ?? null) : result.data
      if (!integration) return Response.json({ ok: false, error: 'webhook_integration_not_found' }, { status: 404, headers: corsHeaders })
      tenantUserId = integration.user_id
      const integrationTenant = await db.from('webhook_integrations').select('organization_id').eq('id', integration.id).eq('user_id', integration.user_id).maybeSingle()
      if (integrationTenant.error) throw integrationTenant.error
      const organizationId = integrationTenant.data?.organization_id ? String(integrationTenant.data.organization_id) : ''
      tenantOrganizationId = organizationId || null
      if (!organizationId) return Response.json({ ok: false, error: 'webhook_integration_organization_missing' }, { status: 500, headers: corsHeaders })

      const secret = String(integration.secret ?? '')
      if (!secret) return Response.json({ ok: false, error: 'webhook_secret_not_configured' }, { status: 503, headers: corsHeaders })

      const verification = await WebhookVerifier.verifyPayload({
        rawBody: raw,
        signatureHeader: signature,
        timestampHeader: timestamp,
        secret,
        toleranceSeconds: 300,
      })
      if (!verification.isValid || !verification.parsedBody) {
        const status = verification.reason === 'timestamp_outside_tolerance' ? 401 : 401
        return Response.json({ ok: false, error: verification.reason ?? 'invalid_signature' }, { status, headers: corsHeaders })
      }

      const payload = verification.parsedBody
      const eventType = String(payload.event_type ?? payload.type ?? '').trim()
      const payloadUserId = payload.user_id ? String(payload.user_id) : null
      const payloadFunnelId = payload.funnel_id ? String(payload.funnel_id) : null
      const userId = integration.user_id
      const funnelId = integration.funnel_id
      if (!eventType || !userId || !funnelId) return Response.json({ ok: false, error: 'webhook_integration_incomplete' }, { status: 400, headers: corsHeaders })
      if (payloadUserId && payloadUserId !== userId) return Response.json({ ok: false, error: 'tenant_mismatch' }, { status: 403, headers: corsHeaders })
      if (payloadFunnelId && payloadFunnelId !== funnelId) return Response.json({ ok: false, error: 'funnel_mismatch' }, { status: 403, headers: corsHeaders })

      const transactionId = payload.transaction_id ? String(payload.transaction_id) : null
      const checkoutId = payload.checkout_id ? String(payload.checkout_id) : null
      const externalId = payload.external_id ? String(payload.external_id) : null
      const status = norm(payload.status)

      const delivery = await db.from('webhook_deliveries').insert({ user_id: userId, integration_id: integration.id, event_type: eventType, endpoint: new URL(req.url).pathname, signature_valid: true, status: 'received', attempt: 1, payload }).select('id').single()
      if (delivery.error) throw delivery.error
      deliveryId = delivery.data.id

      const eventKey = `${integration.id}:${eventId}`
      const existing = await db.from('integration_events').select('id,status').eq('event_key', eventKey).maybeSingle()
      if (existing.error) throw existing.error
      if (existing.data) {
        await db.from('webhook_deliveries').update({ status: 'duplicate', response_code: 200, response_time_ms: Date.now() - started, delivered_at: new Date().toISOString() }).eq('id', deliveryId).eq('user_id', userId)
        return Response.json({ ok: true, duplicate: true, event_id: existing.data.id, status: existing.data.status }, { headers: corsHeaders })
      }

      const event = await db.rpc('server_insert_integration_event_v1', {
        p_user_id: userId,
        p_organization_id: organizationId,
        p_funnel_id: funnelId,
        p_event_type: eventType,
        p_event_key: eventKey,
        p_external_id: eventId,
        p_status: 'processing',
        p_payload: payload,
        p_occurred_at: new Date(Number(timestamp.length <= 10 ? Number(timestamp) * 1000 : timestamp)).toISOString(),
        p_integration_id: integration.id,
        p_claim_attempt: 0,
      })
      if (event.error) {
        if (event.error.code === '23505') {
          const duplicate = await db.from('integration_events').select('id,status').eq('event_key', eventKey).maybeSingle()
          if (duplicate.error) throw duplicate.error
          if (duplicate.data) {
            await db.from('webhook_deliveries').update({ status: 'duplicate', response_code: 200, response_time_ms: Date.now() - started, delivered_at: new Date().toISOString() }).eq('id', deliveryId).eq('user_id', userId)
            return Response.json({ ok: true, duplicate: true, event_id: duplicate.data.id, status: duplicate.data.status }, { headers: corsHeaders })
          }
        }
        throw event.error
      }
      eventIdDb = String(event.data)

      let transaction: any = null
      if (transactionId) {
        const result = await db.from('gateway_transactions').select('*').eq('id', transactionId).eq('user_id', userId).eq('organization_id', organizationId).eq('funnel_id', funnelId).maybeSingle()
        if (result.error) throw result.error
        transaction = result.data
        if (transaction) {
          const nextStatus = transactionStatus(status, transaction.status)
          const transitioned = await db.rpc('transition_gateway_transaction_status', { p_transaction_id: transaction.id, p_user_id: userId, p_next_status: nextStatus, p_failure_code: payload.failure_code ? String(payload.failure_code) : null, p_external_id: externalId, p_expected_version: Number(transaction.version) })
          if (transitioned.error) throw transitioned.error
          transaction = transitioned.data
        }
      }

      let checkout: any = null
      if (checkoutId) {
        const result = await db.from('checkout_sessions').select('*').eq('id', checkoutId).eq('user_id', userId).eq('organization_id', organizationId).eq('funnel_id', funnelId).maybeSingle()
        if (result.error) throw result.error
        checkout = result.data
        if (checkout) {
          const next = SUCCESS.includes(status) ? 'completed' : REVERSAL.includes(status) ? 'failed' : null
          if (next) {
            const updated = await db.from('checkout_sessions').update({ status: next, completed_at: next === 'completed' ? new Date().toISOString() : null, updated_at: new Date().toISOString() }).eq('id', checkoutId).eq('user_id', userId).eq('organization_id', organizationId).eq('funnel_id', funnelId)
            if (updated.error) throw updated.error
          }
        }
      }

      const purchase = SUCCESS.includes(status) && (eventType.toLowerCase().includes('payment') || eventType.toLowerCase().includes('purchase') || SUCCESS.includes(eventType.toLowerCase()))
      const reversal = REVERSAL.includes(status) || REVERSAL.includes(norm(eventType))
      let saleId: string | null = null

      if (purchase && transaction) {
        const saleExternalId = externalId || transaction.external_id || eventId
        const attribution = checkout?.attribution && typeof checkout.attribution === 'object' ? checkout.attribution : {}
        const upserted = await db.rpc('server_upsert_transaction_sale_v1', {
          p_user_id: userId,
          p_organization_id: organizationId,
          p_transaction_id: transaction.id,
          p_funnel_id: funnelId,
          p_product_id: checkout?.product_id ?? transaction.product_id ?? null,
          p_checkout_id: checkoutId,
          p_amount: transaction.amount ?? checkout?.amount ?? payload.amount ?? 0,
          p_currency: transaction.currency ?? checkout?.currency ?? payload.currency ?? 'BRL',
          p_attribution: attribution,
          p_external_id: saleExternalId,
          p_occurred_at: new Date(Number(timestamp.length <= 10 ? Number(timestamp) * 1000 : timestamp)).toISOString(),
          p_data: payload,
        })
        if (upserted.error) throw upserted.error
        saleId = upserted.data ? String(upserted.data) : null
      }

      if (reversal) {
        const saleExternalId = externalId || transaction?.external_id || eventId
        const updated = await db.rpc('server_update_sale_status_v1', {
          p_user_id: userId,
          p_organization_id: organizationId,
          p_status: status === 'chargeback' || norm(eventType) === 'chargeback' ? 'chargeback' : 'refunded',
          p_sale_id: saleId,
          p_transaction_id: transaction?.id ?? null,
          p_external_id: saleExternalId,
          p_data: payload,
          p_occurred_at: null,
        })
        if (updated.error) throw updated.error
        if (updated.data) saleId = String(updated.data)
      }

      const internalSecret = Deno.env.get('ALTHEA_INTERNAL_SECRET') || ''
      let automationTriggered = false
      let universalWebhookTriggered = false
      if (internalSecret) {
        const automationResponse = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/automation-engine-v2`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-internal-secret': internalSecret }, body: JSON.stringify({ user_id: userId, organization_id: organizationId, funnel_id: funnelId, event_id: eventIdDb, event_type: eventType, transaction_id: transactionId, checkout_id: checkoutId, sale_id: saleId, external_id: externalId, payload }) })
        automationTriggered = automationResponse.ok
        if (!automationResponse.ok) throw new Error(`automation_engine_http_${automationResponse.status}`)
        if (purchase) {
          const webhookResponse = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/outbound-webhook-dispatcher`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-internal-secret': internalSecret }, body: JSON.stringify({ user_id: userId, event_id: eventIdDb, event_type: 'order.approved', event_db_id: eventIdDb, payload: { ...payload, sale_id: saleId, transaction_id: transactionId, funnel_id: funnelId } }) })
          universalWebhookTriggered = webhookResponse.ok
          if (!webhookResponse.ok) throw new Error(`outbound_webhook_http_${webhookResponse.status}`)
        }
      }

      const eventProcessed = await db.rpc('server_complete_integration_event_v1', { p_event_id: eventIdDb, p_user_id: userId, p_organization_id: organizationId, p_expected_status: 'processing' })
      if (eventProcessed.error || eventProcessed.data !== true) throw eventProcessed.error ?? new Error('integration_event_complete_rejected')
      await db.from('webhook_deliveries').update({ status: 'delivered', response_code: 200, response_time_ms: Date.now() - started, delivered_at: new Date().toISOString() }).eq('id', deliveryId).eq('user_id', userId)
      return Response.json({ ok: true, duplicate: false, event_id: eventIdDb, processed: true, sale_id: saleId, sale_synced: purchase || reversal, automation_triggered: automationTriggered, universal_webhook_triggered: universalWebhookTriggered }, { headers: corsHeaders })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'webhook_processing_failed'
      console.error('althea-webhook', error)
      if (eventIdDb && tenantUserId && tenantOrganizationId) {
        const existingEvent = await db.from('integration_events').select('retry_count').eq('id', eventIdDb).eq('user_id', tenantUserId).eq('organization_id', tenantOrganizationId).maybeSingle()
        const eventRetry = await db.rpc('server_fail_integration_event_v1', {
          p_event_id: eventIdDb,
          p_user_id: tenantUserId,
          p_organization_id: tenantOrganizationId,
          p_next_status: 'retry',
          p_expected_status: 'processing',
          p_retry_count: Number(existingEvent.data?.retry_count ?? 0) + 1,
          p_error: message,
          p_next_retry_at: null,
        })
        if (eventRetry.error || eventRetry.data !== true) console.error('althea-webhook-retry-transition', eventRetry.error ?? 'transition_rejected')
      }
      if (deliveryId && tenantUserId) await db.from('webhook_deliveries').update({ status: 'failed', response_code: 500, response_time_ms: Date.now() - started, error_message: message }).eq('id', deliveryId).eq('user_id', tenantUserId)
      return Response.json({ ok: false, error: message, event_id: eventIdDb, retryable: Boolean(eventIdDb) }, { status: 500, headers: corsHeaders })
    }
  }),
)