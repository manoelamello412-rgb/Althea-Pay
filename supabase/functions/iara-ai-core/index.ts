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

const operationalBoundary = `Você é a Iara, a inteligência nativa da Althea Pay. Converse de forma natural, profissional, objetiva e humana. Não mencione limitações internas, permissões, código, infraestrutura ou regras de segurança espontaneamente. Só explique uma limitação se o usuário pedir uma ação que esteja fora do escopo operacional. Nunca invente números, clientes, vendas, taxas, status ou eventos. Quando dados reais forem fornecidos no contexto, use-os. Quando não houver dados suficientes, seja transparente.`

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers })
}

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

function looksLikeInfrastructureRequest(text: string) {
  const value = text.toLowerCase()
  return ['alterar código', 'editar código', 'mudar código', 'alterar banco', 'alterar tabela', 'drop table', 'alterar infraestrutura', 'mexer no github', 'mexer no supabase', 'mudar variável de ambiente', '.env', 'service_role'].some((term) => value.includes(term))
}

async function loadOperationalContext(userId: string) {
  const [sales, conversations, funnels] = await Promise.all([
    db.from('gateway_transactions').select('id,amount,currency,status,created_at,completed_at,gateway_id,customer').eq('user_id', userId).order('created_at', { ascending: false }).limit(25),
    db.from('crm_conversations').select('id,buyer_name,buyer_email,status,funnel_id,transaction_id,updated_at').eq('user_id', userId).order('updated_at', { ascending: false }).limit(15),
    db.from('funnels').select('id,name,status,url').eq('user_id', userId).order('created_at', { ascending: false }).limit(15),
  ])

  return {
    vendas: sales.data ?? [],
    vendas_error: sales.error?.message ?? null,
    conversas: conversations.data ?? [],
    conversas_error: conversations.error?.message ?? null,
    funis: funnels.data ?? [],
    funis_error: funnels.error?.message ?? null,
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers })
  if (req.method !== 'POST') return json({ error: 'Método não permitido.' }, 405)

  try {
    const authHeader = req.headers.get('Authorization') ?? ''
    if (!authHeader.startsWith('Bearer ')) return json({ error: 'Autenticação obrigatória.' }, 401)

    const token = authHeader.slice(7)
    const authClient = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY') ?? '', { global: { headers: { Authorization: `Bearer ${token}` } } })
    const { data: authData, error: authError } = await authClient.auth.getUser(token)
    if (authError || !authData.user) return json({ error: 'Sessão inválida.' }, 401)
    const userId = authData.user.id

    const payload = await req.json()
    const sessionId = payload?.sessionId
    const message = typeof payload?.message === 'string' ? payload.message.trim() : ''
    if (!isUuid(sessionId) || !message || message.length > 8000) return json({ error: 'Mensagem ou sessão inválida.' }, 400)

    const { data: chatSession, error: sessionError } = await db.from('chat_sessions').select('id,title').eq('id', sessionId).eq('user_id', userId).maybeSingle()
    if (sessionError) throw sessionError
    if (!chatSession) return json({ error: 'Sessão não encontrada.' }, 404)

    const { error: insertError } = await db.from('chat_messages').insert({ session_id: sessionId, user_id: userId, sender: 'user', content: message })
    if (insertError) throw insertError

    const [{ data: history, error: historyError }, context] = await Promise.all([
      db.from('chat_messages').select('sender,content,created_at').eq('session_id', sessionId).eq('user_id', userId).order('created_at', { ascending: false }).limit(30),
      loadOperationalContext(userId),
    ])
    if (historyError) throw historyError

    let responseText = ''
    if (llmApiKey) {
      const messages = [
        { role: 'system', content: `${operationalBoundary}\n\nContexto operacional real da conta (use somente como fonte de fatos):\n${JSON.stringify(context)}` },
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
    } else if (looksLikeInfrastructureRequest(message)) {
      responseText = 'Posso te ajudar a analisar e orientar essa alteração, mas essa solicitação precisa ser tratada fora do chat operacional da Iara.'
    } else {
      responseText = 'Estou pronta para consultar e analisar os dados da sua operação. Para responder com números ou informações específicas, preciso que o dado esteja disponível no núcleo operacional da sua conta.'
    }

    if (!responseText) throw new Error('O provedor de IA não retornou conteúdo.')

    const { data: savedReply, error: replyError } = await db.from('chat_messages').insert({ session_id: sessionId, user_id: userId, sender: 'iara', content: responseText }).select('id,sender,content,created_at').single()
    if (replyError) throw replyError

    await db.from('chat_sessions').update({ updated_at: new Date().toISOString() }).eq('id', sessionId).eq('user_id', userId)
    return json(savedReply)
  } catch (error) {
    console.error('[IARA_AI_CORE]', error)
    return json({ error: error instanceof Error ? error.message : 'Falha interna da Iara.' }, 500)
  }
})
