import type { Database } from '@/types/supabase'

export type RecoveryContext = Pick<
  Database['public']['Functions']['crm_recovery_opportunities']['Returns'][number],
  'conversation_id' | 'context_status'
>

export type RecoveryOpportunity = RecoveryContext & {
  event_id: string
  received_at: string
  status: string
  transaction_id: string | null
  buyer_name: string | null
  buyer_email: string | null
  funnel_id: string | null
  product_id: string | null
  amount: number | null
  currency: string | null
  priority: number
  opportunity_type: string
  next_action: string
}

type RecoveryResolution =
  | { status: 'resolved'; conversationId: string }
  | { status: 'unlinked' | 'ambiguous' | 'unavailable'; message: string }

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const unavailable: RecoveryResolution = {
  status: 'unavailable',
  message: 'O vínculo desta oportunidade está indisponível. Selecione a conversa manualmente no Multi-CRM.',
}

/** The backend context is authoritative. Missing fields never enable a legacy lookup. */
export function resolveRecoveryContext(value: unknown): RecoveryResolution {
  if (!value || typeof value !== 'object') return unavailable
  const context = value as Record<string, unknown>
  if (context.context_status === 'unlinked') return {
    status: 'unlinked', message: 'Esta oportunidade não tem conversa vinculada. Selecione a conversa manualmente no Multi-CRM.',
  }
  if (context.context_status === 'ambiguous') return {
    status: 'ambiguous', message: 'O vínculo desta oportunidade é ambíguo. Selecione a conversa manualmente no Multi-CRM.',
  }
  if (context.context_status === 'resolved' && typeof context.conversation_id === 'string' && uuid.test(context.conversation_id)) {
    return { status: 'resolved', conversationId: context.conversation_id }
  }
  return unavailable
}

export function resolveRecoveryEventResponse(body: unknown, eventId: string): RecoveryResolution {
  if (!body || typeof body !== 'object' || !('opportunities' in body) || !Array.isArray(body.opportunities)) return unavailable
  const matches = body.opportunities.filter(row => row && typeof row === 'object' && row.event_id === eventId)
  return matches.length === 1 ? resolveRecoveryContext(matches[0]) : unavailable
}
