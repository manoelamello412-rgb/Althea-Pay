import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { pushcutMessage } from '../supabase/functions/_shared/pushcut'

describe('Pushcut', () => {
  it('sends {title, text} for approved payments', () => {
    const body = pushcutMessage('transaction.approved', { amount: 97, currency: 'BRL', customer: { name: 'Maria' }, product_name: 'Curso' })
    expect(Object.keys(body).sort()).toEqual(['text', 'title'])
    expect(body.title).toMatch(/^Venda aprovada R\$\s?97,00$/)
    expect(body.text).toBe('Maria · Curso')
  })
  it('message.received carries who and what', () => {
    expect(pushcutMessage('message.received', { customer: { phone: '5511999' }, body: 'oi', funnel_name: 'F' })).toEqual({ title: 'Nova mensagem · F', text: '5511999: oi' })
  })
})

describe('outbound dispatcher', () => {
  const dispatcher = readFileSync('supabase/functions/outbound-webhook-dispatcher/index.ts', 'utf8')
  it('signs with the Vault secret, never with secret_ref itself', () => {
    expect(dispatcher).toContain('outbound_webhook_secret_v1')
    expect(dispatcher).not.toContain('secret_ref')
  })
  it('filters by funnel and sends Pushcut unsigned', () => {
    expect(dispatcher).toContain('wh.funnel_id === event.funnel_id')
    expect(dispatcher).toContain('pushcutMessage(event.event_type, event.payload)')
  })
})
