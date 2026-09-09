import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.0'

const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const llmApiKey = Deno.env.get('IARA_LLM_API_KEY') ?? ''
const llmUrl = Deno.env.get('IARA_LLM_URL') ?? 'https://api.openai.com/v1/chat/completions'
const llmModel = Deno.env.get('IARA_LLM_MODEL') ?? 'gpt-4o-mini'
const db = createClient(supabaseUrl, serviceRoleKey)

const headers = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const boundary = 'A Iara é um copiloto operacional. Ela nunca executa código, altera arquivos, modifica variáveis de ambiente, schema/tabelas, infraestrutura, credenciais ou configurações de build. Ela pode explicar procedimentos e consultar dados operacionais autorizados.'

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers })
}

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers })
  if (req.method !== 'POST') return json({ error: 'Método não permitido.' }, 405)

  try {
    const authHeader = req.headers.get('Authorization') ?? ''
    if (!authHeader.startsWith('Bearer ')) return json({ error: 'Autenticação obrigatória.' }, 401)

    const token = authHeader.slice(7)
    const authClient = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY') ?? '', {
      global: { headers: { Authorization: `Bearer ${token}` } },
    })
    const { data: authData, error: authError } = await authClient.auth.getUser(token)
    if (authError || !authData.user) return json({ error: 'Sessão inválida.' }, 401)
    const userId = authData.user.id

    const payload = await req.json()
    const sessionId = payload?.sessionId
    const message = typeof payload?.message === 'string' ? payload.message.trim() : ''
    if (!isUuid(sessionId) || !message || message.length > 8000) return json({ error: 'Mensagem ou sessão inválida.' }, 400)

    const { data: chatSession, error: sessionError } = await db
      .from('chat_sessions')
      .select('id,title')
      .eq('id', sessionId)
      .eq('user_id', userId)
      .maybeSingle()
    if (sessionError) throw sessionError
    if (!chatSession) return json({ error: 'Sessão não encontrada.' }, 404)

    const { error: insertError } = await db.from('chat_messages').insert({ session_id: sessionId, user_id: userId, sender: 'user', content: message })
    if (insertError) throw insertError

    const { data: history, error: historyError } = await db
      .from('chat_messages')
      .select('sender,content,created_at')
      .eq('session_id', sessionId)
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(30)
    if (historyError) throw historyError

    let responseText = ''
    if (llmApiKey) {
      const messages = [
        { role: 'system', content: `Você é Iara, copiloto nativo da Althea Pay. Seja clara, acolhedora, objetiva e tecnicamente correta. Não invente dados, taxas, status ou resultados. Quando a pergunta depender de dados da conta que não estejam disponíveis no contexto, diga isso. ${boundary}` },
        ...(history ?? []).reverse().map((item) => ({ role: item.sender === 'iara' ? 'assistant' : 'user', content: item.content })),
      ]
      const llmResponse = await fetch(llmUrl, {
        method: 'POST',
        headers: { Authorization: `Bearer ${llmApiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: llmModel, messages, temperature: 0.2 }),
      })
      if (!llmResponse.ok) throw new Error(`Provedor de IA retornou HTTP ${llmResponse.status}.`)
      const completion = await llmResponse.json()
      responseText = String(completion?.choices?.[0]?.message?.content ?? '').trim()
    } else {
      const normalized = message.toLowerCase()
      const blocked = ['drop table', 'alter table', 'delete from', 'update schema', 'editar código', 'alterar código', 'mexer no código', '.env', 'service_role']
      if (blocked.some((term) => normalized.includes(term))) {
        responseText = 'Posso te orientar sobre a operação da Althea Pay, mas não posso executar nem alterar código, infraestrutura, banco estrutural, credenciais ou configurações de desenvolvimento. Posso, por exemplo, te ajudar a entender uma venda, gateway, checkout ou configuração disponível no painel.'
      } else {
        responseText = 'Entendi sua solicitação. A Iara está conectada ao núcleo operacional da sua conta, mas não vou inventar informações que não estejam disponíveis nos dados autorizados. Se a sua dúvida for sobre vendas, gateways, checkout, funis ou configurações do painel, me diga exatamente o que você quer consultar.'
      }
    }

    if (!responseText) throw new Error('O provedor de IA não retornou conteúdo.')

    const { data: savedReply, error: replyError } = await db
      .from('chat_messages')
      .insert({ session_id: sessionId, user_id: userId, sender: 'iara', content: responseText })
      .select('id,sender,content,created_at')
      .single()
    if (replyError) throw replyError

    await db.from('chat_sessions').update({ updated_at: new Date().toISOString() }).eq('id', sessionId).eq('user_id', userId)
    return json(savedReply)
  } catch (error) {
    console.error('[IARA_AI_CORE]', error)
    return json({ error: error instanceof Error ? error.message : 'Falha interna da Iara.' }, 500)
  }
})
