import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { IaraExecutionKernel, IaraKernelError } from '@/services/iara-agent/execution-kernel'

export const dynamic = 'force-dynamic'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{12}$/i

export async function POST(request: Request) {
  const supabase = await createSupabaseServerClient()
  const { data: { user }, error: auth } = await supabase.auth.getUser()
  if (auth || !user) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })

  const body = await request.json().catch(() => null) as { action_id?: unknown } | null
  const actionId = typeof body?.action_id === 'string' ? body.action_id.trim() : ''
  if (!UUID.test(actionId)) return NextResponse.json({ error: 'INVALID_ACTION' }, { status: 400 })

  try {
    const kernel = new IaraExecutionKernel(supabase)
    const result = await kernel.execute(actionId, user.id)
    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    if (error instanceof IaraKernelError) {
      const payload: { error: string; detail?: string } = { error: error.code }
      if (error.detail) payload.detail = error.detail
      return NextResponse.json(payload, { status: error.status })
    }
    return NextResponse.json({ error: 'AI_ACTION_EXECUTION_FAILED' }, { status: 500 })
  }
}
