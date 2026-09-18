import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, test } from 'vitest'

const source = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8')

describe('canonical funnel UI flow', () => {
  test('uses one dashboard-native creation route', () => {
    const page = source('app/dashboard/funil/page.tsx')
    const legacy = source('app/funnels/new/page.tsx')
    expect(page).toContain("router.push('/dashboard/funil/novo')")
    expect(page).not.toContain('creatingNewFunnel')
    expect(page).not.toContain("fetch('/api/funnels/provision'")
    expect(legacy).toContain("redirect('/dashboard/funil/novo')")
  })

  test('provisions product and gateway atomically and hands off secrets locally', () => {
    const workspace = source('components/funnel-create-workspace.tsx')
    const page = source('app/dashboard/funil/page.tsx')
    expect(workspace).toContain('product_id: commercial.productId')
    expect(workspace).toContain('gateway_id: commercial.gatewayId')
    expect(workspace).toContain("window.sessionStorage.setItem('althea:funnel-provision-handoff'")
    expect(page).toContain("window.sessionStorage.getItem('althea:funnel-provision-handoff')")
    expect(page).toContain('secretFunnelId === selectedFunnelId')
  })

  test('keeps funnel workspaces inside the global shell and official palette', () => {
    const page = source('app/dashboard/funil/page.tsx')
    const create = source('components/funnel-create-workspace.tsx')
    const journey = source('app/dashboard/funil/jornada/journey-client.tsx')
    const shell = source('components/mobile-shell.tsx')
    expect(page).not.toContain('min-h-screen')
    expect(create).not.toContain('min-h-screen')
    expect(journey).not.toContain('min-h-screen')
    expect(shell).not.toContain('#1DBB54')
    expect(shell).toContain('#1DB854')
  })
})
