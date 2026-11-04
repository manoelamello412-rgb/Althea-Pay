import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { emailHtml, renderNamed, ruleMessage, templateMessage } from '../supabase/functions/_shared/remarketing'
import { periodRange } from '../lib/checkout-period'

const ctx = { nome: 'Maria <b>Silva</b>', primeiro_nome: 'Maria', link: 'https://pay.example/c/1', valor: 'R$ 97,00' }

describe('remarketing rule message', () => {
  it('fills {chave} variables', () => {
    expect(renderNamed('Oi {primeiro_nome}, faltam {valor}. {desconhecida}', ctx)).toBe('Oi Maria, faltam R$ 97,00. {desconhecida}')
  })

  it('WhatsApp gets the button as text + link', () => {
    const m = ruleMessage({ channel: 'whatsapp', email_subject: null, body: 'Oi {primeiro_nome}', button_text: 'Pagar', button_url: '{link}' }, ctx)
    expect(m.body).toBe('Oi Maria\n\nPagar: https://pay.example/c/1')
  })

  it('e-mail HTML escapes customer data and drops the button without a safe URL', () => {
    const m = ruleMessage({ channel: 'email', email_subject: 'Oi {nome}', body: 'Oi {nome}', button_text: 'Pagar', button_url: '{link}' }, ctx)
    expect(m.metadata.email_html).toContain('Maria &lt;b&gt;Silva&lt;/b&gt;')
    expect(m.metadata.email_html).toContain('href="https://pay.example/c/1"')
    const unsafe = ruleMessage({ channel: 'email', email_subject: 's', body: 'b', button_text: 'Pagar', button_url: 'javascript:alert(1)' }, ctx)
    expect(unsafe.metadata.email_html).not.toContain('<a ')
  })
})

describe('e-mail templates', () => {
  const base = { body: 'Oi {{1}}', subject: 'Oi', variables: ['nome', 'link'], whatsapp_template_name: null, language: 'pt_BR' }
  it('fills the button link from {{n}} or {link} and keeps the header', () => {
    const m = templateMessage({ ...base, email_header_url: 'https://cdn.x/logo.png', email_button_text: 'Pagar', email_button_url: '{{2}}' }, ctx)
    expect(m.metadata).toMatchObject({ email_header_url: 'https://cdn.x/logo.png', email_button: { text: 'Pagar', url: 'https://pay.example/c/1' } })
    expect(templateMessage({ ...base, email_button_text: 'Pagar', email_button_url: '{link}' }, ctx).metadata).toMatchObject({ email_button: { url: 'https://pay.example/c/1' } })
  })
  it('drops a button without a safe URL and an http header', () => {
    expect(templateMessage({ ...base, email_button_text: 'Pagar', email_button_url: '{link}' }, {}).metadata).not.toHaveProperty('email_button')
    const html = emailHtml('<b>x</b>', { headerUrl: 'http://insecure/logo.png', unsubscribeUrl: 'https://u/x?t=1&a=2' })
    expect(html).not.toContain('<img')
    expect(html).toContain('&lt;b&gt;x&lt;/b&gt;')
    expect(html).toContain('href="https://u/x?t=1&amp;a=2"')
  })
})

describe('checkout period filter', () => {
  it('builds [from, to) local-day bounds', () => {
    const [from, to] = periodRange('day', '2026-03-10', '')
    expect(new Date(to!).getTime() - new Date(from!).getTime()).toBe(24 * 3600 * 1000)
    const [mFrom, mTo] = periodRange('month', '2026-02', '')
    expect(new Date(mFrom!).getDate()).toBe(1)
    expect(new Date(mTo!).getMonth()).toBe(2)
    expect(periodRange('year', '26', '')).toEqual([null, null])
    expect(periodRange('all', '', '')).toEqual([null, null])
  })
})

describe('phase 2 migration', () => {
  const sql = readFileSync('supabase/migrations/20261102150000_checkout_remarketing_rules_v1.sql', 'utf8')
  it('approved payment completes the checkout and cancels queued remarketing', () => {
    expect(sql).toMatch(/after insert or update of status on public\.gateway_transactions/)
    expect(sql).toMatch(/set status = 'cancelled', last_error = 'checkout_paid'/)
  })
  it('dispatcher re-checks payment before sending remarketing', () => {
    const dispatcher = readFileSync('supabase/functions/crm-channel-outbox-dispatcher/index.ts', 'utf8')
    expect(dispatcher).toContain('recovery_checkout_id')
    expect(dispatcher).toContain('"cancelled"')
  })
})
