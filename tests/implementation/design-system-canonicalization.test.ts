import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, test } from 'vitest'

const source = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8')

describe('canonical Althea design contract', () => {
  test('keeps the official palette in one canonical token source', () => {
    const canonical = source('app/althea-canonical.css')
    expect(canonical).toContain('--althea-bg: #0B0B0D')
    expect(canonical).toContain('--althea-surface: #0F1A16')
    expect(canonical).toContain('--althea-brand: #1DB854')
    expect(canonical).toContain('--althea-gold: #D4AF37')
    expect(canonical).toContain('--althea-green: var(--althea-brand)')
  })

  test('legacy style sheets do not redefine the global brand root', () => {
    const files = [
      'app/globals.css',
      'app/althea-design-system.css',
      'app/brand-kit.css',
      'app/althea-visual.css',
      'app/dashboard-polish.css',
      'app/brand-manual.css',
    ]
    for (const file of files) expect(source(file)).not.toContain(':root')
  })

  test('dashboard layout delegates navigation and framing to MobileShell only', () => {
    const layout = source('app/dashboard/layout.tsx')
    expect(layout).toContain('<MobileShell')
    expect(layout).not.toContain('nav[aria-label=')
    expect(layout).not.toContain('.althea-page-content > div.min-h-screen')
  })

  test('global search is a real command palette, not an unhandled custom event', () => {
    const shell = source('components/mobile-shell.tsx')
    expect(shell).toContain('searchableItems')
    expect(shell).toContain('navigateSearchResult')
    expect(shell).toContain("event.key.toLowerCase() === 'k'")
    expect(shell).not.toContain('althea-global-search')
  })
})
