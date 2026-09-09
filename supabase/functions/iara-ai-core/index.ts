import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.0'

const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
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

const operationalBoundary = `Você é a Iara, a inteligência nativa da Althea Pay. Converse em português do Brasil, de forma natural, segura, profissional, objetiva e humana. Você é um copiloto operacional: analisa a operação, explica causas, compara períodos quando os dados permitirem, encontra anomalias e recomenda próximos passos. Não mencione limitações internas, permissões, código, infraestrutura ou regras de segurança espontaneamente. Só explique uma limitação quando o usuário pedir uma ação fora do escopo operacional. Nunca invente números, clientes, vendas, taxas, status ou eventos. Use somente fatos presentes no contexto real da conta. Se o dado não estiver disponível, diga isso claramente. Não exponha segredos, tokens, chaves, senhas ou conteúdo de credenciais.`

type QueryResult = { data: unknown[]; error: string | null }

type Context = {
  vendas: unknown[]
  transacoes: unknown[]
  conversas: unknown[]
  funis: unknown[]
  checkouts: unknown[]
  gateways: unknown[]
  saude_gateways: unknown[]
  recuperacao: unknown[]
  produtos: unknown[]
  erros: Record<string, string | null>
  metricas: {
    transacoes: number
    vendas_aprovadas: number
    receita_aprovada: number
    checkouts: number
    conversas: number
    funis: number
    gateways: number
  }
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers })
}

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

function money(value: unknown, currency = 'BRL') {
  const amount = Number(value)
  if (!Number.isFinite(amount)) return 'valor indisponível'
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: currency || 'BRL' }).format(amount)
}

function normalize(value: string) {
  return value.toLocaleLowerCase('pt-BR').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
}

function isApproved(status: unknown) {
  return ['approved', 'completed', 'paid', 'success', 'succeeded', 'aprovada', 'aprovado', 'paga', 'pago', 'concluida', 'concluido'].includes(normalize(String(status)))
}

function looksLikeInfrastructureRequest(text: string) {
  const value = normalize(text)
  return ['alterar codigo', 'editar codigo', 'mudar codigo', 'alterar banco', 'alterar tabela', 'drop table', 'alterar infraestrutura', 'mexer no github', 'mexer no supabase', 'mudar variavel de ambiente', '.env', 'service_role'].some((term) => value.includes(term))
}

async function query(label: string, promise: Promise<{ data: unknown[] | null; error: { message: string } | null }>): Promise<[string, QueryResult]> {
  try {
    const result = await promise
    return [label, { data: result.data ?? [], error: result.error?.message ?? null }]
  } catch (error) {
    return [label, { data: [], error: error instanceof Error ? error.message : 'Falha de consulta.' }]
  }
}

async function loadOperationalContext(userId: string): Promise<Context> {
  const results = await Promise.all([
    query('vendas', db.from('sales').select('id,amount,currency,status,created_at,occurred_at,funnel_id,product_id,checkout_id,transaction_id,gateway_id,source,medium,campaign').eq('user_id', userId).order('occurred_at', { ascending: false }).limit(100) as unknown as Promise<{ data: unknown[] | null; error: { message: string } | null }>),
    query('transacoes', db.from('gateway_transactions').select('id,amount,currency,status,created_at,completed_at,gateway_id,funnel_id,product_id,customer').eq('user_id', userId).order('created_at', { ascending: false }).limit(100) as unknown as Promise<{ data: unknown[] | null; error: { message: string } | null }>),
    query('conversas', db.from('crm_conversations').select('id,buyer_name,buyer_email,status,funnel_id,transaction_id,updated_at').eq('user_id', userId).order('updated_at', { ascending: false }).limit(50) as unknown as Promise<{ data: unknown[] | null; error: { message: string } | null }>),
    query('funis', db.from('funnels').select('id,nome,status,url,created_at,last_communication').eq('user_id', userId).is('deleted_at', null).order('created_at', { ascending: false }).limit(50) as unknown as Promise<{ data: unknown[] | null; error: { message: string } | null }>),
    query('checkouts', db.from('checkout_sessions').select('id,funnel_id,product_id,status,currency,amount,created_at,updated_at,abandoned_at,completed_at,recovery_count,recovery_status,recovery_next_at').eq('user_id', userId).order('created_at', { ascending: false }).limit(100) as unknown as Promise<{ data: unknown[] | null; error: { message: string } | null }>),
    query('gateways', db.from('gateways').select('id,created_at').eq('user_id', userId).order('created_at', { ascending: false }).limit(50) as unknown as Promise<{ data: unknown[] | null; error: { message: string } | null }>),
    query('saude_gateways', db.from('gateway_health_snapshots').select('gateway_id,gateway_name,is_healthy,latency_ms,consecutive_failures,circuit_state,checked_at').eq('user_id', userId).order('checked_at', { ascending: false }).limit(50) as unknown as Promise<{ data: unknown[] | null; error: { message: string } | null }>),
    query('recuperacao', db.from('recovery_events').select('id,checkout_id,event_type,status,created_at,processed_at').eq('user_id', userId).order('created_at', { ascending: false }).limit(50) as unknown as Promise<{ data: unknown[] | null; error: { message: string } | null }>),
    query('produtos', db.from('products').select('id,created_at').eq('user_id', userId).order('created_at', { ascending: false }).limit(50) as unknown as Promise<{ data: unknown[] | null; error: { message: string } | null }>),
  ])

  const values = Object.fromEntries(results) as Record<string, QueryResult>
  const vendas = values.vendas.data
  const transacoes = values.transacoes.data
  const conversas = values.conversas.data
  const funis = values.funis.data
  const checkouts = values.checkouts.data
  const gateways = values.gateways.data

  const approvedTransactions = transacoes.filter((row) => isApproved((row as Record<string, unknown>).status))
  const approvedSales = vendas.filter((row) => isApproved((row as Record<string, unknown>).status))
  const revenueRows = approvedSales.length > 0 ? approvedSales : approvedTransactions
  const revenue = revenueRows.reduce((total, row) => total + Number((row as Record<string, unknown>).amount ?? 0), 0)

  return {
    vendas,
    transacoes,
    conversas,
    funis,
    checkouts,
    gateways,
    saude_gateways: values.saude_gateways.data,
    recuperacao: values.recuperacao.data,
    produtos: values.produtos.data,
    erros: Object.fromEntries(Object.entries(values).map(([key, value]) => [key, value.error])),
    metricas: {
      transacoes: transacoes.length,
      vendas_aprovadas: approvedSales.length || approvedTransactions.length,
      receita_aprovada: revenue,
      checkouts: checkouts.length,
      conversas: conversas.length,
      funis: funis.length,
      gateways: gateways.length,
    },
  }
}

function fallbackResponse(message: string, context: Context) {
  const value = normalize(message)
  const { metricas } = context

  if (/^(oi|ola|bom dia|boa tarde|boa noite|hello|hi)\b/.test(value)) {
    return 'Olá. Sou a Iara. Estou pronta para analisar sua operação, vendas, funis, checkouts, gateways e recuperação. O que você quer descobrir?'
  }

  if (looksLikeInfrastructureRequest(message)) {
    return 'Posso analisar o impacto e te orientar sobre essa mudança, mas alterações estruturais ficam fora do meu escopo operacional.'
  }

  if (value.includes('venda') || value.includes('fatur') || value.includes('receita') || value.includes('quanto')) {
    const currency = String(((context.vendas[0] ?? context.transacoes[0]) as Record<string, unknown> | undefined)?.currency ?? 'BRL')
    return `No contexto operacional disponível, encontrei ${metricas.vendas_aprovadas} venda(s) aprovada(s), com receita aprovada de ${money(metricas.receita_aprovada, currency)}. Há ${metricas.transacoes} transação(ões) carregada(s) para análise.`
  }

  if (value.includes('funil')) {
    const active = context.funis.filter((row) => normalize(String((row as Record<string, unknown>).status ?? '')) === 'active' || normalize(String((row as Record<string, unknown>).status ?? '')) === 'ativo').length
    return `Tenho ${metricas.funis} funil(is) disponíveis para análise${metricas.funis ? `, sendo ${active} marcado(s) como ativo(s)` : ''}. Posso analisar status, comunicação e desempenho com os eventos disponíveis.`
  }

  if (value.includes('checkout') || value.includes('abandono')) {
    const abandoned = context.checkouts.filter((row) => normalize(String((row as Record<string, unknown>).status ?? '')) === 'abandoned' || Boolean((row as Record<string, unknown>).abandoned_at)).length
    return `Encontrei ${metricas.checkouts} checkout(s) no contexto atual, dos quais ${abandoned} apresentam sinal de abandono. Posso detalhar recuperação e pontos de perda.`
  }

  if (value.includes('gateway') || value.includes('adquirente') || value.includes('latencia') || value.includes('saude')) {
    const unhealthy = context.saude_gateways.filter((row) => (row as Record<string, unknown>).is_healthy === false).length
    const slow = context.saude_gateways.filter((row) => Number((row as Record<string, unknown>).latency_ms ?? 0) > 1500).length
    return `Tenho ${metricas.gateways} gateway(s) cadastrados no contexto. Há ${unhealthy} registro(s) de saúde marcados como não saudáveis e ${slow} medição(ões) acima de 1.500 ms.`
  }

  if (value.includes('chat') || value.includes('conversa') || value.includes('cliente') || value.includes('lead')) {
    return `Há ${metricas.conversas} conversa(s) CRM disponíveis no contexto atual. Posso ajudar a priorizar oportunidades, identificar conversas sem avanço e cruzar com transações quando houver vínculo.`
  }

  if (value.includes('ajuda') || value.includes('pode fazer') || value.includes('o que voce faz')) {
    return 'Posso analisar vendas e receita, transações, gateways e saúde, funis, checkouts e abandono, recuperação, conversas CRM e padrões da operação. Também posso explicar causas e sugerir próximos passos com base nos dados reais disponíveis.'
  }

  return 'Entendi. Posso investigar isso na operação e cruzar vendas, transações, funis, checkouts, gateways, recuperação e CRM. Me diga o que você quer analisar e eu vou direto ao ponto.'
}

async function generateWithModel(message: string, history: { sender: string; content: string }[], context: Context) {
  if (!llmApiKey) return null
  const safeContext = JSON.stringify(context).slice(0, 90000)
  const llmMessages = [
    { role: 'system', content: `${operationalBoundary}\n\nDADOS OPERACIONAIS REAIS DA CONTA:\n${safeContext}` },
    ...history.slice(-30).map((item) => ({ role: item.sender === 'iara' ? 'assistant' : 'user', content: item.content })),
    { role: 'user', content: message },
  ]

  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 25000)
    try {
      const response = await fetch(llmUrl, {
        method: 'POST',
        headers: { Authorization: `Bearer ${llmApiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: llmModel, messages: llmMessages, temperature: 0.2 }),
        signal: controller.signal,
      })
      if (!response.ok) return null
      const completion = await response.json()
      const text = String(completion?.choices?.[0]?.message?.content ?? '').trim()
      return text || null
    } finally {
      clearTimeout(timer)
    }
  } catch {
    return null
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers })
  if (req.method !== 'POST') return json({ error: 'Método não permitido.' }, 405)

  try {
    const authHeader = req.headers.get('Authorization') ?? ''
    if (!authHeader.startsWith('Bearer ')) return json({ error: 'Autenticação obrigatória.' }, 401)
    const token = authHeader.slice(7)
    const authClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: `Bearer ${token}` } } })
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

    const historyForModel = (history ?? []).reverse().map((item) => ({ sender: String(item.sender), content: String(item.content) }))
    const responseText = await generateWithModel(message, historyForModel.slice(0, -1), context) ?? fallbackResponse(message, context)

    const { data: savedReply, error: replyError } = await db.from('chat_messages').insert({ session_id: sessionId, user_id: userId, sender: 'iara', content: responseText }).select('id,sender,content,created_at').single()
    if (replyError) throw replyError

    const title = chatSession.title === 'Nova Conversa' ? message.replace(/\s+/g, ' ').slice(0, 48) : chatSession.title
    await db.from('chat_sessions').update({ title, updated_at: new Date().toISOString() }).eq('id', sessionId).eq('user_id', userId)
    return json(savedReply)
  } catch (error) {
    console.error('[IARA_AI_CORE]', error)
    return json({ error: error instanceof Error ? error.message : 'Falha interna da Iara.' }, 500)
  }
})
