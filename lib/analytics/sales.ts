export const SALES_STATUSES = {
  pending: 'pending',
  approved: 'approved',
  failed: 'failed',
  cancelled: 'cancelled',
  refunded: 'refunded',
  chargeback: 'chargeback',
} as const

export type SalesStatus = (typeof SALES_STATUSES)[keyof typeof SALES_STATUSES]

export type AnalyticsSale = {
  id: string
  amount: number | string | null
  status: string | null
  customer_id: string | null
  data: Record<string, unknown> | null
  gateway_id: string | null
  external_id?: string | null
  transaction_id?: string | null
  occurred_at: string | null
  created_at: string | null
}

export type DateRange = {
  start: string
  end: string
}

export type SalesAnalytics = {
  range: DateRange
  previousRange: DateRange
  sales: AnalyticsSale[]
  approved: AnalyticsSale[]
  pending: AnalyticsSale[]
  failed: AnalyticsSale[]
  cancelled: AnalyticsSale[]
  refunded: AnalyticsSale[]
  chargebacks: AnalyticsSale[]
  unknown: AnalyticsSale[]
  decidedCount: number
  approvalRate: number
  approvedRevenue: number
  averageTicket: number
  uniqueCustomers: number
  previousApprovedRevenue: number
  revenueChange: number
  dailyRevenue: Array<{ date: string; revenue: number; approvedCount: number }>
}

export const TIME_ZONE = 'America/Sao_Paulo'

const dateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

export function todayInSaoPaulo(): string {
  return dateFormatter.format(new Date())
}

export function normalizeStatus(status: string | null | undefined): string {
  return String(status ?? '').trim().toLowerCase()
}

export function isCanonicalStatus(status: string | null | undefined): status is SalesStatus {
  return Object.values(SALES_STATUSES).includes(normalizeStatus(status) as SalesStatus)
}

export function amountOf(sale: AnalyticsSale): number {
  const primary = Number(sale.amount)
  if (Number.isFinite(primary)) return primary

  const fallback = sale.data?.amount
  const parsed = Number(fallback)
  return Number.isFinite(parsed) ? parsed : 0
}

export function dateOf(sale: AnalyticsSale): string {
  const value = sale.occurred_at ?? sale.created_at
  if (!value) return ''

  try {
    return dateFormatter.format(new Date(value))
  } catch {
    return ''
  }
}

export function parseDate(value: string): Date {
  const [year, month, day] = value.split('-').map(Number)
  return new Date(year, month - 1, day)
}

export function isoDate(value: Date): string {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`
}

export function addDays(value: string, amount: number): string {
  const date = parseDate(value)
  date.setDate(date.getDate() + amount)
  return isoDate(date)
}

export function makeRange(days: 7 | 30 | 90, end = todayInSaoPaulo()): DateRange {
  return { start: addDays(end, -(days - 1)), end }
}

export function makePreviousRange(range: DateRange, days: number): DateRange {
  return { start: addDays(range.start, -days), end: addDays(range.start, -1) }
}

function inRange(date: string, range: DateRange): boolean {
  return Boolean(date) && date >= range.start && date <= range.end
}

function statusBuckets(sales: AnalyticsSale[]) {
  const approved: AnalyticsSale[] = []
  const pending: AnalyticsSale[] = []
  const failed: AnalyticsSale[] = []
  const cancelled: AnalyticsSale[] = []
  const refunded: AnalyticsSale[] = []
  const chargebacks: AnalyticsSale[] = []
  const unknown: AnalyticsSale[] = []

  for (const sale of sales) {
    switch (normalizeStatus(sale.status)) {
      case SALES_STATUSES.approved:
        approved.push(sale)
        break
      case SALES_STATUSES.pending:
        pending.push(sale)
        break
      case SALES_STATUSES.failed:
        failed.push(sale)
        break
      case SALES_STATUSES.cancelled:
        cancelled.push(sale)
        break
      case SALES_STATUSES.refunded:
        refunded.push(sale)
        break
      case SALES_STATUSES.chargeback:
        chargebacks.push(sale)
        break
      default:
        unknown.push(sale)
    }
  }

  return { approved, pending, failed, cancelled, refunded, chargebacks, unknown }
}

function revenueOf(sales: AnalyticsSale[]): number {
  return sales.reduce((total, sale) => total + amountOf(sale), 0)
}

export function calculateSalesAnalytics(
  allSales: AnalyticsSale[],
  range: DateRange,
  previousRange = makePreviousRange(range, Math.max(1, dateDistance(range))),
): SalesAnalytics {
  const sales = allSales
    .filter((sale) => inRange(dateOf(sale), range))
    .sort((a, b) => String(b.occurred_at ?? b.created_at).localeCompare(String(a.occurred_at ?? a.created_at)))

  const previousSales = allSales.filter((sale) => inRange(dateOf(sale), previousRange))
  const buckets = statusBuckets(sales)
  const previousBuckets = statusBuckets(previousSales)
  const approvedRevenue = revenueOf(buckets.approved)
  const previousApprovedRevenue = revenueOf(previousBuckets.approved)
  const decidedCount = buckets.approved.length + buckets.failed.length + buckets.cancelled.length + buckets.refunded.length + buckets.chargebacks.length
  const approvalRate = decidedCount > 0 ? (buckets.approved.length / decidedCount) * 100 : 0
  const averageTicket = buckets.approved.length > 0 ? approvedRevenue / buckets.approved.length : 0
  const uniqueCustomers = new Set(
    sales.map((sale) => sale.customer_id).filter((id): id is string => Boolean(id)),
  ).size
  const revenueChange = previousApprovedRevenue === 0
    ? approvedRevenue > 0 ? 100 : 0
    : ((approvedRevenue - previousApprovedRevenue) / previousApprovedRevenue) * 100

  const dailyMap = new Map<string, { revenue: number; approvedCount: number }>()
  for (let cursor = range.start; cursor <= range.end; cursor = addDays(cursor, 1)) {
    dailyMap.set(cursor, { revenue: 0, approvedCount: 0 })
  }
  for (const sale of buckets.approved) {
    const day = dateOf(sale)
    const current = dailyMap.get(day)
    if (current) {
      current.revenue += amountOf(sale)
      current.approvedCount += 1
    }
  }

  return {
    range,
    previousRange,
    sales,
    ...buckets,
    decidedCount,
    approvalRate,
    approvedRevenue,
    averageTicket,
    uniqueCustomers,
    previousApprovedRevenue,
    revenueChange,
    dailyRevenue: Array.from(dailyMap.entries()).map(([date, values]) => ({ date, ...values })),
  }
}

function dateDistance(range: DateRange): number {
  const start = parseDate(range.start).getTime()
  const end = parseDate(range.end).getTime()
  return Math.round((end - start) / 86400000) + 1
}

export function customerNameOf(sale: AnalyticsSale): string {
  const data = sale.data ?? {}
  const customer = data.customer && typeof data.customer === 'object' && !Array.isArray(data.customer)
    ? data.customer as Record<string, unknown>
    : null
  const name = data.customer_name ?? data.name ?? customer?.name ?? customer?.full_name
  if (typeof name === 'string' && name.trim()) return name.trim()
  const email = data.customer_email ?? data.email ?? customer?.email
  if (typeof email === 'string' && email.trim()) return email.trim()
  return sale.customer_id ? `Cliente ${sale.customer_id.slice(0, 6).toUpperCase()}` : 'Cliente'
}
