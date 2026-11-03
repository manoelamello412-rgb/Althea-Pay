import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { authErrorPt } from '../lib/auth/errors'
import { infobipTestResult } from '../lib/crm/infobip-test'

describe('auth messages in Portuguese', () => {
  it('translates the common Supabase errors', () => {
    expect(authErrorPt('Invalid login credentials')).toMatch(/E-mail ou senha incorretos/)
    expect(authErrorPt('New password should be different from the old password.')).toMatch(/diferente/)
    expect(authErrorPt('Invalid TOTP code entered')).toMatch(/Código inválido/)
  })
})

describe('Infobip test', () => {
  it('explains each outcome', () => {
    expect(infobipTestResult(200).ok).toBe(true)
    expect(infobipTestResult(401).message).toMatch(/Chave inválida/)
    expect(infobipTestResult(404).message).toMatch(/Número remetente não encontrado/)
    expect(infobipTestResult(null).message).toMatch(/URL base/)
  })
})

describe('security wiring', () => {
  it('proxy sends accounts with 2FA to the code step', () => {
    const proxy = readFileSync('proxy.ts', 'utf8')
    expect(proxy).toContain("aal?.nextLevel === 'aal2' && aal.currentLevel !== 'aal2'")
    expect(proxy).toContain("'/login/mfa'")
  })
  it('CSP no longer allows scripts or connections to any https host', () => {
    const csp = readFileSync('next.config.mjs', 'utf8')
    const script = csp.split('\n').find(line => line.includes('script-src'))!
    const connect = csp.split('\n').find(line => line.includes('connect-src'))!
    expect(script).not.toMatch(/ https:[`'\s]/)
    expect(connect).not.toMatch(/ https:[`$'\s]/)
  })
  it('password needs 8+ characters and other devices can be signed out', () => {
    const page = readFileSync('app/dashboard/security/page.tsx', 'utf8')
    expect(page).toContain('newPassword.length < 8')
    expect(page).toContain("signOut({ scope: 'others' })")
  })
  it('AI routes are rate limited per user', () => {
    for (const route of ['app/api/iara/chat/route.ts', 'app/api/crm/ai-agent/route.ts', 'app/api/crm/ai-agent/execute/route.ts']) {
      expect(readFileSync(route, 'utf8')).toContain('limitUser(')
    }
  })
})
