export type Period = 'all' | 'today' | 'day' | 'range' | 'month' | 'year'

// Local-time [from, to) for the period filter; null = no bound.
export function periodRange(period: Period, a: string, b: string): [string | null, string | null] {
  const day = (value: string) => { const [y, m, d] = value.split('-').map(Number); return new Date(y, (m || 1) - 1, d || 1) }
  const plus = (date: Date, days: number) => new Date(date.getFullYear(), date.getMonth(), date.getDate() + days)
  const iso = (date: Date) => date.toISOString()
  if (period === 'today') { const t = new Date(); const start = new Date(t.getFullYear(), t.getMonth(), t.getDate()); return [iso(start), iso(plus(start, 1))] }
  if (period === 'day' && a) return [iso(day(a)), iso(plus(day(a), 1))]
  if (period === 'range' && (a || b)) return [a ? iso(day(a)) : null, b ? iso(plus(day(b), 1)) : null]
  if (period === 'month' && a) { const start = day(`${a}-01`); return [iso(start), iso(new Date(start.getFullYear(), start.getMonth() + 1, 1))] }
  if (period === 'year' && /^\d{4}$/.test(a)) return [iso(new Date(Number(a), 0, 1)), iso(new Date(Number(a) + 1, 0, 1))]
  return [null, null]
}
