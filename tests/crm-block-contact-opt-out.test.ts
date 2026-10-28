import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  'supabase/migrations/20261028183000_crm_block_contact_opt_out_v1.sql',
  'utf8',
)

describe('CRM contact blocking opt-out', () => {
  it('recognizes the WhatsApp blocking button', () => {
    expect(migration).toContain("'BLOQUEARCONTATO'")
  })

  it('recognizes explicit requests to stop contact', () => {
    expect(migration).toContain("'NAOENTREMAISEMCONTATO'")
    expect(migration).toContain("'NAOMECHAMEMAIS'")
    expect(migration).toContain("'REMOVERMEUNUMERO'")
    expect(migration).toContain("'NAOQUERORECEBERMENSAGENS'")
  })

  it('normalizes accents before comparing the message', () => {
    expect(migration).toContain('translate(')
    expect(migration).toContain("'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ'")
  })

  it('records the source and original inbound message', () => {
    expect(migration).toContain("'inbound_block_request'")
    expect(migration).toContain('source_message_id')
    expect(migration).toContain('new.id')
  })

  it('supports an explicit resubscribe request', () => {
    expect(migration).toContain("'DESBLOQUEARCONTATO'")
    expect(migration).toContain("'inbound_resubscribe'")
  })
})
