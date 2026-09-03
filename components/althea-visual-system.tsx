'use client'

import BrandLogo from '@/components/brand-logo'

function PillarIcon({ type }: { type: 'security' | 'stability' | 'growth' | 'technology' | 'prosperity' }) {
  if (type === 'security') return <svg viewBox="0 0 48 48" aria-hidden="true"><path d="M24 5 39 11v10c0 10-6.2 17.2-15 22-8.8-4.8-15-12-15-22V11l15-6Z" fill="none" stroke="currentColor" strokeWidth="1.7"/><path d="m16.5 24 5 5 10-11" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/></svg>
  if (type === 'stability') return <svg viewBox="0 0 48 48" aria-hidden="true"><path d="M7 19h34M10 19l14-10 14 10M12 21v16M20 21v16M28 21v16M36 21v16M8 39h32" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/></svg>
  if (type === 'growth') return <svg viewBox="0 0 48 48" aria-hidden="true"><path d="M7 39h34M11 35V26h7v9M22 35V19h7v16M33 35V12h7v23M29 17l7-7 5 5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/></svg>
  if (type === 'technology') return <svg viewBox="0 0 48 48" aria-hidden="true"><path d="M8 14h9M31 14h9M8 24h9M31 24h9M8 34h9M31 34h9M17 14h14M17 24h14M17 34h14" fill="none" stroke="currentColor" strokeWidth="1.5"/><circle cx="8" cy="14" r="2.5" fill="currentColor"/><circle cx="40" cy="14" r="2.5" fill="currentColor"/><circle cx="8" cy="24" r="2.5" fill="currentColor"/><circle cx="40" cy="24" r="2.5" fill="currentColor"/><circle cx="8" cy="34" r="2.5" fill="currentColor"/><circle cx="40" cy="34" r="2.5" fill="currentColor"/><circle cx="24" cy="14" r="2.5" fill="currentColor"/><circle cx="24" cy="24" r="2.5" fill="currentColor"/><circle cx="24" cy="34" r="2.5" fill="currentColor"/></svg>
  return <BrandLogo variant="mark" alt="" />
}

export function BrandPillars() {
  const pillars = [
    ['security', 'SEGURANÇA'],
    ['stability', 'ESTABILIDADE'],
    ['growth', 'CRESCIMENTO'],
    ['technology', 'TECNOLOGIA'],
    ['prosperity', 'PROSPERIDADE'],
  ] as const
  return <section className="althea-pillars" aria-label="Pilares da marca Althea Pay"><div className="visual-section-label">ICONOGRAFIA</div><div className="pillar-grid">{pillars.map(([type, label]) => <div className="pillar-item" key={label}><span className="pillar-icon"><PillarIcon type={type} /></span><span>{label}</span></div>)}</div></section>
}

export function RevenueChart({ points = [26, 40, 31, 54, 46, 68, 61, 84, 74, 91] }: { points?: number[] }) {
  const safe = points.length > 1 ? points : [26, 40]
  const width = 600
  const height = 180
  const coords = safe.map((value, index) => `${(index / (safe.length - 1)) * width},${height - (Math.max(4, Math.min(96, value)) / 100) * 145 - 15}`).join(' ')
  const area = `0,${height} ${coords} ${width},${height}`
  return <div className="althea-revenue-chart" aria-label="Gráfico de faturamento"><svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img"><defs><linearGradient id="altheaChartFade" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#1DB854" stopOpacity=".30"/><stop offset="1" stopColor="#1DB854" stopOpacity="0"/></linearGradient></defs><path d={`M ${area}`} fill="url(#altheaChartFade)"/><polyline points={coords} fill="none" stroke="#1DB854" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke"/></svg></div>
}

export function VirtualCard({ label = 'ALTHEA PAY', number = '••••  ••••  ••••  4821' }: { label?: string; number?: string }) {
  return <div className="althea-virtual-card" aria-label="Cartão virtual Althea Pay"><div className="virtual-card-top"><BrandLogo variant="mark" alt="Althea Pay" /><span>VIRTUAL</span></div><div className="virtual-card-chip"><i /><i /><i /><i /></div><div className="virtual-card-number">{number}</div><div className="virtual-card-bottom"><span>{label}</span><span>●  ●</span></div></div>
}
