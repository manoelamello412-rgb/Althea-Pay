'use client'

import { useEffect, useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'

export const DEFAULT_ALTHEA_BRAND = {
  ink: '#0B0B0D', forest: '#0F1A16', deep: '#0D362D', green: '#1DB854', gold: '#D4AF37', silver: '#A6A6A6', logo: '/althea-mark.svg',
} as const

type Brand = typeof DEFAULT_ALTHEA_BRAND
type BrandRow = { user_id: string; logo_url: string; ink: string; forest: string; deep: string; green: string; gold: string; silver: string }
const STORAGE_KEY = 'althea-brand-kit-v1'

export function applyBrand(brand: Brand) {
  const root = document.documentElement
  root.style.setProperty('--althea-ink', brand.ink); root.style.setProperty('--althea-forest', brand.forest); root.style.setProperty('--althea-deep', brand.deep); root.style.setProperty('--althea-green', brand.green); root.style.setProperty('--althea-gold', brand.gold); root.style.setProperty('--althea-silver', brand.silver); root.style.setProperty('--althea-brand-logo', `url(${brand.logo})`)
}

function rowToBrand(row: BrandRow): Brand { return { ink: row.ink, forest: row.forest, deep: row.deep, green: row.green, gold: row.gold, silver: row.silver, logo: row.logo_url } }
function cacheBrand(brand: Brand) { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(brand)) } catch {} }

export function hydrateAltheaBrand() {
  try { const stored = localStorage.getItem(STORAGE_KEY); applyBrand(stored ? { ...DEFAULT_ALTHEA_BRAND, ...JSON.parse(stored) } : DEFAULT_ALTHEA_BRAND) } catch { applyBrand(DEFAULT_ALTHEA_BRAND) }
}

export function BrandKit() {
  const [brand, setBrand] = useState<Brand>(DEFAULT_ALTHEA_BRAND)
  const [saved, setSaved] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const supabase = createSupabaseBrowserClient()

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true); setError('')
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { setLoading(false); return }
      const { data, error: dbError } = await supabase.from('brand_identity_settings').select('user_id,logo_url,ink,forest,deep,green,gold,silver').eq('user_id', user.id).maybeSingle()
      if (cancelled) return
      if (dbError) { setError('Não foi possível carregar a identidade salva.'); hydrateAltheaBrand(); setLoading(false); return }
      const next = data ? rowToBrand(data as BrandRow) : DEFAULT_ALTHEA_BRAND
      setBrand(next); applyBrand(next); cacheBrand(next); setLoading(false)
    }
    load()
    return () => { cancelled = true }
  }, [supabase])

  function update(key: keyof Brand, value: string) { setSaved(false); setBrand(current => { const next = { ...current, [key]: value }; applyBrand(next); return next }) }

  async function save() {
    setError(''); setSaved(false)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setError('Sua sessão expirou. Entre novamente para salvar.'); return }
    const payload = { user_id: user.id, logo_url: brand.logo, ink: brand.ink, forest: brand.forest, deep: brand.deep, green: brand.green, gold: brand.gold, silver: brand.silver }
    const { error: dbError } = await supabase.from('brand_identity_settings').upsert(payload, { onConflict: 'user_id' })
    if (dbError) { setError('Não foi possível salvar a identidade.'); return }
    cacheBrand(brand); applyBrand(brand); setSaved(true); window.setTimeout(() => setSaved(false), 2200)
  }

  async function reset() {
    setError('')
    const { data: { user } } = await supabase.auth.getUser()
    if (user) { const { error: dbError } = await supabase.from('brand_identity_settings').delete().eq('user_id', user.id); if (dbError) { setError('Não foi possível restaurar a identidade.'); return } }
    setBrand(DEFAULT_ALTHEA_BRAND); applyBrand(DEFAULT_ALTHEA_BRAND); try { localStorage.removeItem(STORAGE_KEY) } catch {}; setSaved(false)
  }

  const swatches: Array<[keyof Brand, string]> = [['ink','Preto'],['forest','Verde profundo'],['deep','Verde institucional'],['green','Verde principal'],['gold','Dourado'],['silver','Cinza']]

  return <div className="brand-kit">
    <div className="brand-kit-hero"><div><span className="brand-kit-kicker">BRAND KIT · ALTHEA PAY</span><h2>Marca e Identidade</h2><p>Identidade individual por conta, sincronizada com o Supabase e aplicada em toda a experiência digital.</p></div><div className="brand-kit-mark"><img src={brand.logo} alt="Símbolo Althea Pay" /></div></div>
    {error && <div className="auth-error" role="alert">{error}</div>}
    <section className="brand-kit-section"><div className="brand-kit-section-head"><div><span>LOGOTIPO</span><h3>Assinatura da marca</h3></div></div><div className="brand-logo-preview"><img src={brand.logo} alt="Althea Pay" /><div><strong>ALTHEA <em>PAY</em></strong><small>Onde você constrói sua raiz financeira</small></div></div><label className="brand-upload">URL do símbolo<input value={brand.logo} onChange={e=>update('logo',e.target.value)} placeholder="/althea-mark.svg" /></label></section>
    <section className="brand-kit-section"><div className="brand-kit-section-head"><div><span>PALETA OFICIAL</span><h3>Suas cores</h3></div></div><div className="brand-swatches">{swatches.map(([key,label])=><label className="brand-swatch" key={key}><input type="color" value={brand[key]} onChange={e=>update(key,e.target.value)} aria-label={`Cor ${label}`} /><span className="brand-color-chip" style={{background:brand[key]}} /><strong>{label}</strong><code>{brand[key].toUpperCase()}</code></label>)}</div></section>
    <section className="brand-kit-section"><div className="brand-kit-section-head"><div><span>PRÉ-VISUALIZAÇÃO</span><h3>Sistema aplicado</h3></div></div><div className="brand-preview-grid"><div className="brand-preview-card"><span>Dashboard</span><strong>Seu crescimento</strong><small>Identidade aplicada aos cartões, estados e ações.</small><button className="brand-preview-button">Acessar plataforma</button></div><div className="brand-preview-card brand-preview-checkout"><span>Checkout</span><strong>Compra segura</strong><small>O mesmo sistema visual acompanha seus clientes.</small><button className="brand-preview-button">Continuar</button></div></div></section>
    <div className="brand-kit-actions"><button className="brand-reset" onClick={reset} disabled={loading}>Restaurar padrão</button><button className="primary" onClick={save} disabled={loading}>{loading?'Carregando...':saved?'Identidade salva ✓':'Salvar identidade'}</button></div>
  </div>
}
