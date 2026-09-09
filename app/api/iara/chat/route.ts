import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  try {
    const supabase = await createSupabaseServerClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) return NextResponse.json({ error: 'Autenticação obrigatória.' }, { status: 401 })

    const body = await request.json()
    const sessionId = typeof body?.sessionId === 'string' ? body.sessionId : ''
    const message = typeof body?.message === 'string' ? body.message.trim() : ''
    if (!sessionId || !message) return NextResponse.json({ error: 'sessionId e message são obrigatórios.' }, { status: 400 })

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL
    const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
    if (!url || !key) return NextResponse.json({ error: 'Supabase não configurado.' }, { status: 500 })

    const { data: { session } } = await supabase.auth.getSession()
    if (!session?.access_token) return NextResponse.json({ error: 'Sessão expirada.' }, { status: 401 })

    const response = await fetch(`${url}/functions/v1/iara-ai-core`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        apikey: key,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ sessionId, message }),
      cache: 'no-store',
    })

    const data = await response.json().catch(() => ({ error: 'Resposta inválida da Iara.' }))
    return NextResponse.json(data, { status: response.status })
  } catch (error) {
    console.error('[IARA_CHAT_API]', error)
    return NextResponse.json({ error: 'Não foi possível processar a conversa agora.' }, { status: 500 })
  }
}
