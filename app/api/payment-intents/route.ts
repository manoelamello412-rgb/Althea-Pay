import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createSupabaseServerClient } from '@/lib/supabase/server'

const PaymentIntentSchema = z.object({
  organizationId: z.string().uuid(),
  funnelId: z.string().uuid(),
  customerId: z.string().uuid().optional(),
  externalReference: z.string().max(255).optional(),
  amount: z.number().finite().positive(),
  currency: z.string().regex(/^[A-Z]{3}$/),
  method: z.enum(['pix', 'credit_card', 'debit_card', 'boleto']),
  idempotencyKey: z.string().trim().min(8).max(255),
  metadata: z.record(z.string(), z.unknown()).optional(),
})

export async function POST(request: Request) {
  try {
    const supabase = await createSupabaseServerClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) return NextResponse.json({ error: 'UNAUTHENTICATED' }, { status: 401 })

    const body = PaymentIntentSchema.parse(await request.json())
    const { data: member, error: memberError } = await supabase
      .from('organization_members')
      .select('organization_id')
      .eq('organization_id', body.organizationId)
      .eq('user_id', user.id)
      .maybeSingle()

    if (memberError) return NextResponse.json({ error: 'AUTHORIZATION_CHECK_FAILED' }, { status: 500 })
    if (!member) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })

    const { data: funnel, error: funnelError } = await supabase
      .from('funnels')
      .select('id, organization_id, status')
      .eq('id', body.funnelId)
      .eq('organization_id', body.organizationId)
      .maybeSingle()

    if (funnelError) return NextResponse.json({ error: 'FUNNEL_LOOKUP_FAILED' }, { status: 500 })
    if (!funnel) return NextResponse.json({ error: 'FUNNEL_NOT_FOUND' }, { status: 404 })
    if (funnel.status !== 'connected') return NextResponse.json({ error: 'FUNNEL_NOT_READY' }, { status: 409 })

    const { data: existing, error: existingError } = await supabase
      .from('payment_intents')
      .select('*')
      .eq('organization_id', body.organizationId)
      .eq('idempotency_key', body.idempotencyKey)
      .maybeSingle()

    if (existingError) return NextResponse.json({ error: 'IDEMPOTENCY_LOOKUP_FAILED' }, { status: 500 })
    if (existing) return NextResponse.json({ paymentIntent: existing, reused: true }, { status: 200 })

    const { data: flow, error: flowError } = await supabase
      .from('payment_flows')
      .select('id')
      .eq('funnel_id', body.funnelId)
      .eq('organization_id', body.organizationId)
      .eq('status', 'published')
      .maybeSingle()

    if (flowError) return NextResponse.json({ error: 'PAYMENT_FLOW_LOOKUP_FAILED' }, { status: 500 })
    if (!flow) return NextResponse.json({ error: 'PAYMENT_FLOW_NOT_CONFIGURED' }, { status: 409 })

    const { data: intent, error: insertError } = await supabase
      .from('payment_intents')
      .insert({
        organization_id: body.organizationId,
        funnel_id: body.funnelId,
        payment_flow_id: flow.id,
        customer_id: body.customerId,
        external_reference: body.externalReference,
        amount: body.amount,
        currency: body.currency,
        method: body.method,
        idempotency_key: body.idempotencyKey,
        metadata: body.metadata ?? {},
        status: 'pending',
      })
      .select('*')
      .single()

    if (insertError) {
      if (insertError.code === '23505') {
        const { data: winner } = await supabase
          .from('payment_intents')
          .select('*')
          .eq('organization_id', body.organizationId)
          .eq('idempotency_key', body.idempotencyKey)
          .maybeSingle()
        if (winner) return NextResponse.json({ paymentIntent: winner, reused: true }, { status: 200 })
      }
      return NextResponse.json({ error: 'PAYMENT_INTENT_CREATE_FAILED' }, { status: 500 })
    }

    return NextResponse.json({ paymentIntent: intent, reused: false }, { status: 201 })
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: 'INVALID_REQUEST', details: error.flatten() }, { status: 400 })
    return NextResponse.json({ error: 'INTERNAL_SERVER_ERROR' }, { status: 500 })
  }
}
