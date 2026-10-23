import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('dashboard design system', () => {
  it('generated theme layer is in sync with the color utilities used in the code', () => {
    const before = readFileSync('app/althea-theme.generated.css', 'utf8')
    execFileSync('node', ['scripts/generate-theme.mjs'])
    expect(readFileSync('app/althea-theme.generated.css', 'utf8')).toBe(before)
  })

  it('is light by default, scoped to the dashboard shell and imported globally', () => {
    const tokens = readFileSync('app/althea-theme.css', 'utf8')
    expect(tokens).toMatch(/\.althea-ds \{\n {2}--ds-bg: #FFFFFF;/)
    expect(tokens).toContain('.althea-ds[data-theme="dark"]')
    expect(readFileSync('components/mobile-shell.tsx', 'utf8')).toContain('className="althea-ds ')
    expect(readFileSync('app/althea-styles.css', 'utf8')).toContain("@import './althea-theme.generated.css';")
  })
})
