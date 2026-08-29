export const ALTHEA_PAY = {
  name: 'ALTHEA PAY',
  tagline: 'Control Center',
  description: 'Central de controle para funis, gateways, vendas espelhadas e atendimento em tempo real.',
} as const

export type FunnelStatus = 'draft' | 'active' | 'paused' | 'archived'
export type GatewayStatus = 'connected' | 'disconnected' | 'error' | 'pending'

export interface FunnelSummary {
  id: string
  name: string
  domain?: string
  status: FunnelStatus
  gatewayName?: string
  conversionRate?: number
  updatedAt?: string
}

export interface DashboardSnapshot {
  funnels: FunnelSummary[]
  metrics: {
    visits: number
    leads: number
    sales: number
    revenue: number
    openChats: number
  }
}
