import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('authentication access policy', () => {
  it('keeps the public login surface sign-in only', () => {
    const source = readFileSync('app/login/page.tsx', 'utf8')

    expect(source).toContain('signInWithPassword')
    expect(source).not.toContain('auth.signUp')
    expect(source).not.toContain("mode === 'signup'")
    expect(source).not.toContain('Criar acesso')
    expect(source).not.toContain('Criar conta')
  })

  it('declares Supabase Auth as invite-only', () => {
    const policy = JSON.parse(readFileSync('security/supabase-auth-policy.json', 'utf8')) as {
      disable_signup?: boolean
    }

    expect(policy.disable_signup).toBe(true)
  })
})
