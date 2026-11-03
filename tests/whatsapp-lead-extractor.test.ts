import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { leadsCsv, uniqueByPhone } from '../lib/crm/leads-csv'

describe('lead extractor CSV', () => {
  it('opens in Excel pt-BR and marks who was already a client', () => {
    const csv = leadsCsv([{ phone: '5511999990000', name: 'Ana; Souza', known: true }], 'Grupo "VIP"')
    expect(csv.startsWith('﻿Nome;Telefone;Grupo;Já era cliente\r\n')).toBe(true)
    expect(csv).toContain('"Ana; Souza";55 11999990000;"Grupo ""VIP""";sim')
  })
  it('neutralizes formulas in participant names', () => {
    expect(leadsCsv([{ phone: '5511', name: '=HYPERLINK("x")', known: false }], 'G')).toContain(`"'=HYPERLINK(""x"")"`)
  })
  it('drops repeated numbers', () => {
    expect(uniqueByPhone([{ phone: '55 11 9999' }, { phone: '55119999' }, { phone: '5521' }]).length).toBe(2)
  })
  it('bridge lists communities and names participants', () => {
    const bridge = readFileSync('whatsapp-bridge/server.mjs', 'utf8')
    expect(bridge).toContain("action === 'communities'")
    expect(bridge).toContain('isCommunity')
    expect(bridge).toContain('p.notify')
  })
})
