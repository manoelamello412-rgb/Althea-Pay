import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const supabase = await createSupabaseServerClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })

  const id = new URL(request.url).searchParams.get('conversation')?.trim()
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ error: 'INVALID_CONVERSATION_ID' }, { status: 400 })
  }

  const { data, error } = await supabase.rpc('crm_customer_360', { p_conversation_id: id })
  if (error) {
    const status = error.message.includes('CONVERSATION_NOT_FOUND') ? 404 : 500
    return NextResponse.json({ error: error.message }, { status })
  }

  return NextResponse.json(data, {
    headers: { 'Cache-Control': 'no-store' },
  })
}
