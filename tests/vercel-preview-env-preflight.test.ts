import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const script = resolve(process.cwd(), 'scripts/vercel-preview-env-preflight.mjs')

function run(overrides: Record<string, string> = {}) {
  const env = { ...process.env }
  delete env.VERCEL_ENV
  delete env.NEXT_PUBLIC_SUPABASE_URL
  delete env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  delete env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  Object.assign(env, overrides)

  return spawnSync(process.execPath, [script], {
    cwd: process.cwd(),
    env,
    encoding: 'utf8',
  })
}

describe('Vercel Preview environment preflight', () => {
  it('does not affect non-preview builds', () => {
    const result = run({ VERCEL_ENV: 'production' })
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('skipped')
  })

  it('fails preview builds when Supabase public configuration is missing', () => {
    const result = run({ VERCEL_ENV: 'preview' })
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('NEXT_PUBLIC_SUPABASE_URL')
    expect(result.stderr).toContain('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY')
  })

  it('accepts the canonical publishable-key configuration', () => {
    const result = run({
      VERCEL_ENV: 'preview',
      NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test',
    })
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('passed')
  })

  it('accepts the legacy anon-key fallback used by the auth proxy', () => {
    const result = run({
      VERCEL_ENV: 'preview',
      NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: 'legacy-anon-test',
    })
    expect(result.status).toBe(0)
  })

  it('rejects malformed or non-https Supabase URLs in preview', () => {
    const malformed = run({
      VERCEL_ENV: 'preview',
      NEXT_PUBLIC_SUPABASE_URL: 'not-a-url',
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test',
    })
    expect(malformed.status).toBe(1)
    expect(malformed.stderr).toContain('valid absolute URL')

    const insecure = run({
      VERCEL_ENV: 'preview',
      NEXT_PUBLIC_SUPABASE_URL: 'http://example.supabase.co',
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test',
    })
    expect(insecure.status).toBe(1)
    expect(insecure.stderr).toContain('must use https')
  })
})
