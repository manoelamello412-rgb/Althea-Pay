import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { consumePublicRateLimit, retryAfterSeconds } from '@/lib/security/public-rate-limit'

/**
 * Public, scoped, rate-limited transcript of VIRTUS scripted replies.
 * Does NOT accept arbitrary assistant messages from the browser.
 * Does NOT impersonate the CRM operator; the message is explicitly marked as scripted.
 */
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
}

const SCRIPTED: Record<string, string> = {
  "greeting": "Ol\u00e1! \ud83e\udde1 Sou a Lu\u00edsa, do suporte Membros VIRTUS. Posso esclarecer d\u00favidas sobre a inscri\u00e7\u00e3o, os conte\u00fados, o Pix e os comprovantes. Se preferir, nossa equipe tamb\u00e9m pode atender por aqui. Como posso ajudar?",
  "pending": "Se voc\u00ea j\u00e1 pagou o Pix, n\u00e3o pague novamente. A confirma\u00e7\u00e3o pode levar alguns instantes. Se continuar pendente, envie o comprovante pelo bot\u00e3o abaixo do QR Code ou pelo anexo do chat para confer\u00eancia da equipe.",
  "product": "Membros VIRTUS re\u00fane conte\u00fados, materiais e experi\u00eancias de desenvolvimento pessoal em um ambiente digital organizado. A disponibilidade dos recursos acompanha a programa\u00e7\u00e3o do projeto.",
  "payment": "A inscri\u00e7\u00e3o exibida neste checkout custa R$ 250,00, em pagamento \u00fanico via Pix. Cart\u00e3o e boleto n\u00e3o est\u00e3o dispon\u00edveis nesta condi\u00e7\u00e3o.",
  "beneficiary": "O nome do recebedor pode ser o de uma intermediadora. Confira os dados no aplicativo do banco. Se n\u00e3o reconhecer o destinat\u00e1rio, consulte o suporte antes de pagar.",
  "guarantee": "Para cancelamentos, garantias e reembolsos, a equipe confirma os termos aplic\u00e1veis \u00e0 oferta Membros VIRTUS. Posso encaminhar seu pedido ao atendimento humano.",
  "later": "A condi\u00e7\u00e3o de inscri\u00e7\u00e3o pode mudar. Confira o pre\u00e7o e a disponibilidade atualizados nesta p\u00e1gina antes de concluir o Pix.",
  "access": "Ap\u00f3s a confirma\u00e7\u00e3o do pagamento, acompanhe as orienta\u00e7\u00f5es de acesso informadas pela equipe Membros VIRTUS. Se n\u00e3o receber as instru\u00e7\u00f5es, solicite atendimento humano neste chat.",
  "receipt": "Voc\u00ea pode anexar o comprovante, em PDF ou imagem, na tela do Pix ou pelo \u00edcone de anexo do chat. Nossa equipe recebe o arquivo para confer\u00eancia; o comprovante, sozinho, n\u00e3o significa que o pagamento foi confirmado.",
  "fallback": "Posso ajudar com a plataforma VIRTUS, pagamento Pix, envio de comprovante, acesso e suporte. Sobre qual assunto voc\u00ea quer falar?",
  "greeting_reply": "Oi! \ud83e\udde1 Pode mandar sua d\u00favida. Se precisar, encaminho seu atendimento \u00e0 equipe humana.",
  "thanks": "Por nada! \ud83e\udde1 Se precisar de alguma orienta\u00e7\u00e3o sobre a VIRTUS ou seu pagamento, estou por aqui."
}

const SOURCE_LABEL = 'Lu\u00edsa \u00b7 Orienta\u00e7\u00e3o inicial\n'

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: cors })
}

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: { ...cors, 'Cache-Control': 'no-store' } })
}

function plain(s: string) {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
}

function asksForHuman(s: string) {
  const q = plain(s)
  return /(quero (suporte|humano|atendente|falar com|uma pessoa)|preciso de (suporte|atendente|humano)|atendimento humano|falar com (um |uma |a |o )?(atendente|humano|pessoa|equipe)|me liga|pessoa de verdade|fraude|golpe|banco.{0,35}(bloque|recus|suspeit|seguranca))/.test(q)
}

function isLegacyBot(s: string) {
  const t = plain(s)
  return (t.includes('responda com o numero da opcao') && t.includes('status do meu pagamento')) ||
    (t.includes('1 ver status do meu pagamento') && t.includes('3 falar com um atendente')) ||
    t.includes('bem vindo ao suporte membros virtus')
}

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token')?.trim() || ''
  if (token.length < 32 || token.length > 128) return json({ error: 'invalid_token' }, 400)
  const admin = createSupabaseAdminClient()
  const rate = await consumePublicRateLimit(admin, req, 'virtus-assistant-takeover', token, 60, 60)
  if (!rate.allowed) {
    if (rate.unavailable) return json({ error: 'rate_limit_unavailable' }, 503)
    return NextResponse.json({ error: 'rate_limited' }, { status: 429,
      headers: { ...cors, 'Retry-After': retryAfterSeconds(rate.resetAt) } })
  }
  const { data: conversation, error } = await admin.from('crm_conversations')
    .select('id,assigned_to,status').eq('public_token', token).maybeSingle()
  if (error) return json({ error: 'conversation_unavailable' }, 503)
  if (!conversation) return json({ error: 'not_found' }, 404)
  return json({ human_active: !!conversation.assigned_to, closed: conversation.status === 'closed' })
}

export async function POST(req: NextRequest) {
  try {
    // Always map intent to a fixed, server-owned script. Never store user-provided text as an operator reply.
    const raw = await req.text()
    if (new TextEncoder().encode(raw).byteLength > 1500) return json({ error: 'payload_too_large' }, 413)
    const payload: unknown = JSON.parse(raw)
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return json({ error: 'invalid_body' }, 400)
    const body = payload as Record<string, unknown>
    const token = typeof body.conversation_token === 'string' ? body.conversation_token.trim() : ''
    const topic = typeof body.topic === 'string' ? body.topic.trim() : ''
    if (token.length < 32 || token.length > 128) return json({ error: 'invalid_token' }, 400)
    const response = SCRIPTED[topic]
    if (!response) return json({ error: 'invalid_topic' }, 400)

    const admin = createSupabaseAdminClient()
    const rate = await consumePublicRateLimit(admin, req, 'virtus-assistant-transcript', token, 16, 60)
    if (!rate.allowed) {
      if (rate.unavailable) return json({ error: 'rate_limit_unavailable' }, 503)
      return NextResponse.json({ error: 'rate_limited' }, {
        status: 429, headers: { ...cors, 'Retry-After': retryAfterSeconds(rate.resetAt) },
      })
    }

    const { data: conversation, error: cErr } = await admin.from('crm_conversations')
      .select('id,user_id,status,assigned_to').eq('public_token', token).maybeSingle()
    if (cErr) return json({ error: 'conversation_unavailable' }, 503)
    if (!conversation) return json({ error: 'conversation_not_found' }, 404)
    if (conversation.status === 'closed') return json({ error: 'conversation_closed' }, 409)
    if (conversation.assigned_to) return json({ accepted: false, reason: 'human_assigned' }, 409)

    const { data: messages, error: mErr } = await admin.from('crm_messages')
      .select('id,direction,channel,body,metadata,created_at')
      .eq('conversation_id', conversation.id)
      .neq('channel', 'internal')
      .order('created_at', { ascending: false }).limit(200)
    if (mErr) return json({ error: 'conversation_unavailable' }, 503)
    const entries = messages || []
    const lastInbound = entries.find(m => m.direction === 'inbound' && m.channel === 'webchat')
    if (!lastInbound) return json({ error: 'inbound_required' }, 409)
    // An explicit handoff request must never be automatically answered, even if called manually.
    if (asksForHuman(String(lastInbound.body || ''))) return json({ accepted: false, reason: 'human_required' }, 409)

    const takenOver = entries.some(m => {
      if (m.direction !== 'outbound') return false
      const meta = m.metadata
      if (meta && typeof meta === 'object' && !Array.isArray(meta) &&
          (meta as Record<string, unknown>).source === 'virtus_luisa') return false
      const msg = String(m.body || '')
      return !msg.startsWith(SOURCE_LABEL) && !isLegacyBot(msg)
    })
    if (takenOver) return json({ accepted: false, reason: 'human_active' }, 409)

    // Idempotency: one Luisa scripted answer per latest inbound CRM message.
    const duplicate = entries.some(m => {
      if (m.direction !== 'outbound') return false
      const meta = m.metadata
      return !!(meta && typeof meta === 'object' && !Array.isArray(meta) &&
        (meta as Record<string, unknown>).source === 'virtus_luisa' &&
        (meta as Record<string, unknown>).reply_to === lastInbound.id)
    })
    if (duplicate) return json({ accepted: true, already_recorded: true })

    const { error: insertError } = await admin.from('crm_messages').insert({
      conversation_id: conversation.id,
      user_id: conversation.user_id,
      direction: 'outbound',
      channel: 'webchat',
      body: SOURCE_LABEL + response,
      metadata: { source: 'virtus_luisa', reply_to: lastInbound.id, intent: topic, scripted: true },
      created_at: new Date().toISOString(),
    })
    if (insertError) return json({ error: 'message_unavailable' }, 503)
    return json({ accepted: true })
  } catch {
    return json({ error: 'assistant_unavailable' }, 503)
  }
}
