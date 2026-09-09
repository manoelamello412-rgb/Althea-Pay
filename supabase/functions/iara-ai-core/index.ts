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

const operationalBoundary = `Você é a Iara, a inteligência nativa da Althea Pay. Converse em português do Brasil, de forma natural, profissional, objetiva e humana. Você é uma copiloto operacional de alto nível: entende a pergunta, consulta os dados reais disponíveis, cruza sinais, identifica anomalias, explica causas, compara períodos quando possível e recomenda ações práticas. Não invente fatos. Não trate amostras como dados completos. Quando uma consulta falhar, não transforme ausência de dados em zero: informe que aquele dado específico está indisponível. Não exponha segredos, tokens, chaves, senhas ou credenciais. Não execute nem proponha como se já tivesse executado alterações destrutivas. Para mudanças estruturais, apenas analise e oriente. Prefira respostas curtas e úteis, mas aprofunde quando a pergunta exigir. Sempre diferencie fato observado de hipótese e recomendação.`

type Row = Record<string, unknown>
type QueryResult = { data: Row[]; error: string | null }

type Context = {
  vendas: Row[]
  transacoes: Row[]
  conversas: Row[]
  funis: Row[]
  checkouts: Row[]
  gateways: Row[]
  saude_gateways: Row[]
  recuperacao: Row[]
  produtos: Row[]
  erros: Record<string, string | null>
  metricas: {
    transacoes: number
    vendas: number
    vendas_aprovadas: number
    receita_aprovada: number
    checkouts: number
    checkouts_abandonados: number
    conversas: number
    funis: number
    gateways: number
    gateways_saudaveis: number
    latencia_gateway_max: number
    taxa_aprovacao: number
  }
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers })
}

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

function normalize(value: string) {
  return value.toLocaleLowerCase('pt-BR').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
}

function number(value: unknown) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function money(value: unknown, currency = 'BRL') {
  const amount = number(value)
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: currency || 'BRL' }).format(amount)
}

function isApproved(status: unknown) {
  return ['approved', 'completed', 'paid', 'success', 'succeeded', 'aprovada', 'aprovado', 'paga', 'pago', 'concluida', 'concluido'].includes(normalize(String(status)))
}

function isAbandoned(row: Row) {
  const status = normalize(String(row.status ?? ''))
  return status === 'abandoned' || status === 'abandonado' || Boolean(row.abandoned_at)
}

function looksLikeInfrastructureRequest(text: string) {
  const value = normalize(text)
  return ['alterar codigo', 'editar codigo', 'mudar codigo', 'alterar banco', 'alterar tabela', 'drop table', 'alterar infraestrutura', 'mexer no github', 'mexer no supabase', 'mudar variavel de ambiente', '.env', 'service_role', 'deletar banco'].some((term) => value.includes(term))
}

async function query(label: string, promise: PromiseLike<{ data: Row[] | null; error: { message: string } | null }>): Promise<[string, QueryResult]> {
  try {
    const result = await promise
    return [label, { data: result.data ?? [], error: result.error?.message ?? null }]
  } catch (error) {
    return [label, { data: [], error: error instanceof Error ? error.message : 'Falha de consulta.' }]
  }
}

async function loadOperationalContext(userId: string): Promise<Context> {
  const results = await Promise.all([
    query('vendas', db.from('sales').select('id,amount,currency,status,created_at,occurred_at,funnel_id,product_id,checkout_id,transaction_id,gateway_id,source,medium,campaign').eq('user_id', userId).order('occurred_at', { ascending: false }).limit(200) as unknown as PromiseLike<{ data: Row[] | null; error: { message: string } | null }>),
    query('transacoes', db.from('gateway_transactions').select('id,amount,currency,status,created_at,completed_at,gateway_id,funnel_id,product_id,customer').eq('user_id', userId).order('created_at', { ascending: false }).limit(200) as unknown as PromiseLike<{ data: Row[] | null; error: { message: string } | null }>),
    query('conversas', db.from('crm_conversations').select('id,buyer_name,buyer_email,status,funnel_id,transaction_id,updated_at').eq('user_id', userId).order('updated_at', { ascending: false }).limit(100) as unknown as PromiseLike<{ data: Row[] | null; error: { message: string } | null }>),
    query('funis', db.from('funnels').select('id,nome,status,url,created_at,last_communication').eq('user_id', userId).is('deleted_at', null).order('created_at', { ascending: false }).limit(100) as unknown as PromiseLike<{ data: Row[] | null; error: { message: string } | null }>),
    query('checkouts', db.from('checkout_sessions').select('id,funnel_id,product_id,status,currency,amount,created_at,updated_at,abandoned_at,completed_at,recovery_count,recovery_status,recovery_next_at').eq('user_id', userId).order('created_at', { ascending: false }).limit(200) as unknown as PromiseLike<{ data: Row[] | null; error: { message: string } | null }>),
    query('gateways', db.from('gateways').select('id,created_at').eq('user_id', userId).order('created_at', { ascending: false }).limit(100) as unknown as PromiseLike<{ data: Row[] | null; error: { message: string } | null }>),
    query('saude_gateways', db.from('gateway_health_snapshots').select('gateway_id,gateway_name,is_healthy,latency_ms,consecutive_failures,circuit_state,checked_at').eq('user_id', userId).order('checked_at', { ascending: false }).limit(100) as unknown as PromiseLike<{ data: Row[] | null; error: { message: string } | null }>),
    query('recuperacao', db.from('recovery_events').select('id,checkout_id,event_type,status,created_at,processed_at').eq('user_id', userId).order('created_at', { ascending: false }).limit(100) as unknown as PromiseLike<{ data: Row[] | null; error: { message: string } | null }>),
    query('produtos', db.from('products').select('id,created_at').eq('user_id', userId).order('created_at', { ascending: false }).limit(100) as unknown as PromiseLike<{ data: Row[] | null; error: { message: string } | null }>),
  ])

  const values = Object.fromEntries(results) as Record<string, QueryResult>
  const vendas = values.vendas.data
  const transacoes = values.transacoes.data
  const conversas = values.conversas.data
  const funis = values.funis.data
  const checkouts = values.checkouts.data
  const gateways = values.gateways.data
  const saude = values.saude_gateways.data

  const approvedTransactions = transacoes.filter((row) => isApproved(row.status))
  const approvedSales = vendas.filter((row) => isApproved(row.status))
  const revenueRows = approvedSales.length > 0 ? approvedSales : approvedTransactions
  const revenue = revenueRows.reduce((total, row) => total + number(row.amount), 0)
  const abandoned = checkouts.filter(isAbandoned).length
  const healthKnown = saude.length > 0 ? saude : []
  const healthy = healthKnown.filter((row) => row.is_healthy !== false).length
  const latencies = healthKnown.map((row) => number(row.latency_ms)).filter((value) => value > 0)
  const approved = approvedSales.length > 0 ? approvedSales.length : approvedTransactions.length
  const approvalBase = approvedSales.length > 0 ? vendas.length : transacoes.length

  return {
    vendas,
    transacoes,
    conversas,
    funis,
    checkouts,
    gateways,
    saude_gateways: saude,
    recuperacao: values.recuperacao.data,
    produtos: values.produtos.data,
    erros: Object.fromEntries(Object.entries(values).map(([key, value]) => [key, value.error])),
    metricas: {
      transacoes: transacoes.length,
      vendas: vendas.length,
      vendas_aprovadas: approved,
      receita_aprovada: revenue,
      checkouts: checkouts.length,
      checkouts_abandonados: abandoned,
      conversas: conversas.length,
      funis: funis.length,
      gateways: gateways.length,
      gateways_saudaveis: healthy,
      latencia_gateway_max: latencies.length ? Math.max(...latencies) : 0,
      taxa_aprovacao: approvalBase ? (approved / approvalBase) * 100 : 0,
    },
  }
}

function recentWindow(context: Context, days: number) {
  const cutoff = Date.now() - days * 86400000
  const recent = (rows: Row[], field: string) => rows.filter((row) => {
    const time = Date.parse(String(row[field] ?? ''))
    return Number.isFinite(time) && time >= cutoff
  })
  return {
    vendas: recent(context.vendas, 'occurred_at').length,
    transacoes: recent(context.transacoes, 'created_at').length,
    checkouts: recent(context.checkouts, 'created_at').length,
    conversas: recent(context.conversas, 'updated_at').length,
  }
}

function fallbackResponse(message: string, context: Context) {
  const value = normalize(message)
  const { metricas } = context
  const currency = String(((context.vendas[0] ?? context.transacoes[0]) as Row | undefined)?.currency ?? 'BRL')

  if (/^(oi|ola|bom dia|boa tarde|boa noite|hello|hi)\b/.test(value)) {
    return 'Olá. Sou a Iara. Estou pronta para analisar sua operação. Pode me perguntar sobre vendas, receita, conversão, gateways, funis, checkouts, recuperação, clientes ou CRM.'
  }

  if (looksLikeInfrastructureRequest(message)) {
    return 'Posso analisar o impacto, dependências e riscos dessa mudança e te orientar sobre a melhor abordagem. Alterações estruturais no núcleo da plataforma não são executadas pela Iara.'
  }

  if (value.includes('hoje') || value.includes('ultimos 7 dias') || value.includes('ultima semana') || value.includes('ontem')) {
    const days = value.includes('hoje') || value.includes('ontem') ? 1 : 7
    const recent = recentWindow(context, days)
    return `Na janela recente disponível, encontrei ${recent.vendas} venda(s), ${recent.transacoes} transação(ões), ${recent.checkouts} checkout(s) e ${recent.conversas} conversa(s) CRM. Posso cruzar esses números com aprovação, abandono e gateways.`
  }

  if (value.includes('taxa de aprovacao') || value.includes('aprovacao') || value.includes('conversao')) {
    if (!metricas.transacoes && !metricas.vendas) return 'Não encontrei transações ou vendas suficientes no contexto atual para calcular a taxa de aprovação.'
    return `A taxa de aprovação calculável no contexto atual é de ${metricas.taxa_aprovacao.toFixed(1)}%, considerando ${metricas.vendas || metricas.transacoes} registro(s) na base usada e ${metricas.vendas_aprovadas} aprovado(s).`
  }

  if (value.includes('venda') || value.includes('fatur') || value.includes('receita') || value.includes('quanto')) {
    return `No contexto operacional disponível, encontrei ${metricas.vendas_aprovadas} venda(s) aprovada(s), com receita aprovada de ${money(metricas.receita_aprovada, currency)}. Há ${metricas.transacoes} transação(ões) e ${metricas.vendas} venda(s) carregadas para análise.`
  }

  if (value.includes('funil')) {
    const active = context.funis.filter((row) => ['active', 'ativo'].includes(normalize(String(row.status ?? '')))).length
    return `Tenho ${metricas.funis} funil(is) disponíveis${metricas.funis ? `, com ${active} marcado(s) como ativo(s)` : ''}. Posso cruzar funil com vendas, checkout, comunicação e conversas.`
  }

  if (value.includes('checkout') || value.includes('abandono')) {
    const rate = metricas.checkouts ? (metricas.checkouts_abandonados / metricas.checkouts) * 100 : 0
    return `Encontrei ${metricas.checkouts} checkout(s), dos quais ${metricas.checkouts_abandonados} apresentam sinal de abandono${metricas.checkouts ? ` (${rate.toFixed(1)}%)` : ''}. Posso analisar os sinais de recuperação disponíveis.`
  }

  if (value.includes('gateway') || value.includes('adquirente') || value.includes('latencia') || value.includes('saude')) {
    const unhealthy = context.saude_gateways.filter((row) => row.is_healthy === false).length
    const slow = context.saude_gateways.filter((row) => number(row.latency_ms) > 1500).length
    return `Tenho ${metricas.gateways} gateway(s) cadastrados. Nos snapshots de saúde disponíveis, ${unhealthy} registro(s) estão não saudáveis e ${slow} medição(ões) passaram de 1.500 ms${metricas.latencia_gateway_max ? `; pico observado: ${metricas.latencia_gateway_max} ms` : ''}.`
  }

  if (value.includes('chat') || value.includes('conversa') || value.includes('cliente') || value.includes('lead')) {
    return `Há ${metricas.conversas} conversa(s) CRM disponíveis no contexto. Posso cruzá-las com funis e transações quando houver vínculo e priorizar oportunidades.`
  }

  if (value.includes('ajuda') || value.includes('pode fazer') || value.includes('o que voce faz')) {
    return 'Posso investigar vendas e receita, aprovação, funis, checkouts e abandono, gateways e saúde, recuperação, CRM e tendências recentes. Também consigo explicar causas prováveis e sugerir próximos passos usando os dados reais disponíveis.'
  }

  return 'Entendi. Vou tratar isso como uma investigação operacional. Posso cruzar vendas, transações, funis, checkouts, gateways, recuperação e CRM para chegar à resposta mais útil com os dados disponíveis.'
}

async function generateWithModel(message: string, history: { sender: string; content: string }[], context: Context) {
  if (!llmApiKey) return null
  const safeContext = JSON.stringify(context).slice(0, 95000)
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

  const startedAt = performance.now()
  let runId: string | null = null

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
    const clientRequestId = payload?.clientRequestId
    if (!isUuid(sessionId) || !message || message.length > 8000) return json({ error: 'Mensagem ou sessão inválida.' }, 400)
    if (clientRequestId !== undefined && !isUuid(clientRequestId)) return json({ error: 'clientRequestId inválido.' }, 400)

    const { data: chatSession, error: sessionError } = await db.from('chat_sessions').select('id,title').eq('id', sessionId).eq('user_id', userId).maybeSingle()
    if (sessionError) throw sessionError
    if (!chatSession) return json({ error: 'Sessão não encontrada.' }, 404)

    if (clientRequestId) {
      const { data: existingUser } = await db.from('chat_messages').select('id').eq('user_id', userId).eq('client_request_id', clientRequestId).eq('session_id', sessionId).maybeSingle()
      if (existingUser?.id) {
        const { data: existingReply } = await db.from('chat_messages').select('id,sender,content,created_at').eq('user_id', userId).eq('in_reply_to', existingUser.id).eq('sender', 'iara').maybeSingle()
        if (existingReply) return json(existingReply)
      }
    }

    const { data: run, error: runError } = await db.from('iara_runs').insert({ user_id: userId, session_id: sessionId, client_request_id: clientRequestId ?? null, model: llmApiKey ? llmModel : 'deterministic-fallback', status: 'running' }).select('id').single()
    if (!runError && run) runId = String(run.id)

    const { data: insertedUser, error: insertError } = await db.from('chat_messages').insert({ session_id: sessionId, user_id: userId, sender: 'user', content: message, client_request_id: clientRequestId ?? null }).select('id').single()
    if (insertError) {
      if (clientRequestId) {
        const { data: duplicate } = await db.from('chat_messages').select('id').eq('user_id', userId).eq('client_request_id', clientRequestId).eq('session_id', sessionId).maybeSingle()
        if (duplicate?.id) {
          const { data: reply } = await db.from('chat_messages').select('id,sender,content,created_at').eq('user_id', userId).eq('in_reply_to', duplicate.id).eq('sender', 'iara').maybeSingle()
          if (reply) return json(reply)
        }
      }
      throw insertError
    }

    const [{ data: history, error: historyError }, context] = await Promise.all([
      db.from('chat_messages').select('sender,content,created_at').eq('session_id', sessionId).eq('user_id', userId).order('created_at', { ascending: false }).limit(30),
      loadOperationalContext(userId),
    ])
    if (historyError) throw historyError

    const historyForModel = (history ?? []).reverse().map((item) => ({ sender: String(item.sender), content: String(item.content) })).filter((item) => item.content.trim())
    const responseText = await generateWithModel(message, historyForModel.slice(0, -1), context) ?? fallbackResponse(message, context)

    const { data: savedReply, error: replyError } = await db.from('chat_messages').insert({ session_id: sessionId, user_id: userId, sender: 'iara', content: responseText, in_reply_to: insertedUser.id }).select('id,sender,content,created_at').single()
    if (replyError) throw replyError

    const title = chatSession.title === 'Nova Conversa' ? message.replace(/\s+/g, ' ').slice(0, 48) : chatSession.title
    await db.from('chat_sessions').update({ title, updated_at: new Date().toISOString() }).eq('id', sessionId).eq('user_id', userId)

    if (runId) {
      await db.from('iara_runs').update({ status: 'completed', latency_ms: Math.round(performance.now() - startedAt), completed_at: new Date().toISOString() }).eq('id', runId).eq('user_id', userId)
    }

    return json(savedReply)
  } catch (error) {
    console.error('[IARA_AI_CORE]', error)
    if (runId) {
      await db.from('iara_runs').update({ status: 'failed', latency_ms: Math.round(performance.now() - startedAt), completed_at: new Date().toISOString(), error_code: error instanceof Error ? error.name : 'UNKNOWN' }).eq('id', runId)
    }
    return json({ error: error instanceof Error ? error.message : 'Falha interna da Iara.' }, 500)
  }
})
