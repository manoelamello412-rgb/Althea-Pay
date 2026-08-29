export const ALTHEA_PAY = {
  name: 'ALTHEA PAY',
  tagline: 'Onde você constrói sua raiz financeira',
  description: 'Uma nova geração de infraestrutura financeira para operar, crescer e construir patrimônio.',
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
