import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'

const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } })

export async function POST(request: Request) {
  try {
    const supabase = await createSupabaseServerClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) return json({ error: 'unauthorized' }, 401)

    const body = await request.json().catch(() => ({}))
    const stepId = typeof body?.step_id === 'string' ? body.step_id.trim() : ''
    const offerId = typeof body?.offer_id === 'string' ? body.offer_id.trim() : ''
    const paymentMethods = Array.isArray(body?.payment_methods) ? body.payment_methods : ['pix', 'card', 'boleto']
    if (!/^[0-9a-f-]{36}$/i.test(stepId) || !/^[0-9a-f-]{36}$/i.test(offerId)) return json({ error: 'step_id and offer_id are required' }, 400)

    const { data, error } = await supabase.rpc('configure_funnel_checkout_step', {
      p_step_id: stepId,
      p_offer_id: offerId,
      p_payment_methods: paymentMethods,
    })
    if (error) {
      const message = String(error.message || '')
      if (/UNAUTHORIZED/i.test(message)) return json({ error: 'unauthorized' }, 401)
      if (/FORBIDDEN/i.test(message)) return json({ error: 'forbidden' }, 403)
      if (/NOT_FOUND/i.test(message)) return json({ error: 'resource_not_found' }, 404)
      if (/MISMATCH|REQUIRED|INVALID|UNSUPPORTED|ACTIVE/i.test(message)) return json({ error: message.toLowerCase() }, 409)
      console.error('[funnels/journey/checkout]', error)
      return json({ error: 'checkout_configuration_failed' }, 500)
    }
    return json({ step: data })
  } catch (cause) {
    console.error('[funnels/journey/checkout]', cause)
    return json({ error: 'internal_error' }, 500)
  }
}
