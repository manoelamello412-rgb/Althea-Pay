'use client'

import { useEffect, useState } from 'react'

const DEFAULTS = {
  ink: '#0B0B0D',
  forest: '#0F1A16',
  deep: '#0D362D',
  green: '#1DB854',
  gold: '#D4AF37',
  silver: '#A6A6A6',
  logo: '/althea-mark.svg',
} as const

type Brand = typeof DEFAULTS

const STORAGE_KEY = 'althea-brand-kit-v1'

function applyBrand(brand: Brand) {
  const root = document.documentElement
  root.style.setProperty('--althea-ink', brand.ink)
  root.style.setProperty('--althea-forest', brand.forest)
  root.style.setProperty('--althea-deep', brand.deep)
  root.style.setProperty('--althea-green', brand.green)
  root.style.setProperty('--althea-gold', brand.gold)
  root.style.setProperty('--althea-silver', brand.silver)
  root.style.setProperty('--althea-brand-logo', `url(${brand.logo})`)
}

export function BrandKit() {
  const [brand, setBrand] = useState<Brand>(DEFAULTS)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY)
      const next = stored ? { ...DEFAULTS, ...JSON.parse(stored) } : DEFAULTS
      setBrand(next)
      applyBrand(next)
    } catch {
      applyBrand(DEFAULTS)
    }
  }, [])

  function update(key: keyof Brand, value: string) {
    setSaved(false)
    setBrand(current => {
      const next = { ...current, [key]: value }
      applyBrand(next)
      return next
    })
  }

  function save() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(brand))
    applyBrand(brand)
    setSaved(true)
    window.setTimeout(() => setSaved(false), 2200)
  }

  function reset() {
    setBrand(DEFAULTS)
    localStorage.removeItem(STORAGE_KEY)
    applyBrand(DEFAULTS)
    setSaved(false)
  }

  const swatches: Array<[keyof Brand, string]> = [
    ['ink', 'Preto'],
    ['forest', 'Verde profundo'],
    ['deep', 'Verde institucional'],
    ['green', 'Verde principal'],
    ['gold', 'Dourado'],
    ['silver', 'Cinza'],
  ]

  return (
    <div className="brand-kit">
      <div className="brand-kit-hero">
        <div>
          <span className="brand-kit-kicker">BRAND KIT · ALTHEA PAY</span>
          <h2>Marca e Identidade</h2>
          <p>Controle a identidade visual da Althea Pay e aplique a linguagem da marca de forma consistente nos componentes digitais.</p>
        </div>
        <div className="brand-kit-mark"><img src={brand.logo} alt="Símbolo Althea Pay" /></div>
      </div>

      <section className="brand-kit-section">
        <div className="brand-kit-section-head"><div><span>LOGOTIPO</span><h3>Assinatura da marca</h3></div></div>
        <div className="brand-logo-preview">
          <img src={brand.logo} alt="Althea Pay" />
          <div><strong>ALTHEA <em>PAY</em></strong><small>Onde você constrói sua raiz financeira</small></div>
        </div>
        <label className="brand-upload">URL do símbolo<input value={brand.logo} onChange={e => update('logo', e.target.value)} placeholder="/althea-mark.svg" /></label>
      </section>

      <section className="brand-kit-section">
        <div className="brand-kit-section-head"><div><span>PALETA OFICIAL</span><h3>Suas cores</h3></div></div>
        <div className="brand-swatches">
          {swatches.map(([key, label]) => (
            <label className="brand-swatch" key={key}>
              <input type="color" value={brand[key]} onChange={e => update(key, e.target.value)} aria-label={`Cor ${label}`} />
              <span className="brand-color-chip" style={{ background: brand[key] }} />
              <strong>{label}</strong><code>{brand[key].toUpperCase()}</code>
            </label>
          ))}
        </div>
      </section>

      <section className="brand-kit-section">
        <div className="brand-kit-section-head"><div><span>PRÉ-VISUALIZAÇÃO</span><h3>Sistema aplicado</h3></div></div>
        <div className="brand-preview-grid">
          <div className="brand-preview-card"><span>Dashboard</span><strong>Seu crescimento</strong><small>Identidade aplicada aos cartões, estados e ações.</small><button className="brand-preview-button">Acessar plataforma</button></div>
          <div className="brand-preview-card brand-preview-checkout"><span>Checkout</span><strong>Compra segura</strong><small>O mesmo sistema visual acompanha seus clientes.</small><button className="brand-preview-button">Continuar</button></div>
        </div>
      </section>

      <div className="brand-kit-actions">
        <button className="brand-reset" onClick={reset}>Restaurar padrão</button>
        <button className="primary" onClick={save}>{saved ? 'Identidade salva ✓' : 'Salvar identidade'}</button>
      </div>
    </div>
  )
}
