'use client'

import { motion } from 'framer-motion'
import { CheckCircle2, ChevronLeft, Mail, Phone, RefreshCcw, Save } from 'lucide-react'
import { FormEvent, useEffect, useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'

type RecoverySettings = {
  cartAutomation: boolean
  pixAutomation: boolean
  boletoAutomation: boolean
  senderEmail: string
  senderWhatsapp: string
}

const DEFAULTS: RecoverySettings = {
  cartAutomation: false,
  pixAutomation: false,
  boletoAutomation: false,
  senderEmail: '',
  senderWhatsapp: '',
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: () => void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} onClick={onChange} className={`flex h-6 w-11 shrink-0 items-center rounded-full p-0.5 transition-colors duration-200 ${checked ? 'justify-end bg-[var(--althea-brand)]' : 'justify-start border border-white/[.045] bg-[var(--althea-bg)]'}`}>
      <motion.span layout className="h-5 w-5 rounded-full bg-white shadow-md" />
    </button>
  )
}

export function ConfigTabRecuperacao({ onBack }: { onBack: () => void }) {
  const supabase = createSupabaseBrowserClient()
  const [settings, setSettings] = useState<RecoverySettings>(DEFAULTS)
  const [loading, setLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [saveSuccess, setSaveSuccess] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let mounted = true
    async function load() {
      setLoading(true); setError('')
      const { data: auth, error: authError } = await supabase.auth.getUser()
      if (authError || !auth.user) { if (mounted) { setError('Sessão expirada.'); setLoading(false) }; return }
      const { data, error: settingsError } = await supabase.from('platform_settings').select('data').eq('user_id', auth.user.id).maybeSingle()
      if (!mounted) return
      if (settingsError) setError(settingsError.message)
      const recovery = data?.data && typeof data.data === 'object' ? (data.data as Record<string, unknown>).recovery : null
      if (recovery && typeof recovery === 'object') {
        const value = recovery as Partial<RecoverySettings>
        setSettings({
          cartAutomation: value.cartAutomation === true,
          pixAutomation: value.pixAutomation === true,
          boletoAutomation: value.boletoAutomation === true,
          senderEmail: typeof value.senderEmail === 'string' ? value.senderEmail : '',
          senderWhatsapp: typeof value.senderWhatsapp === 'string' ? value.senderWhatsapp : '',
        })
      }
      setLoading(false)
    }
    void load()
    return () => { mounted = false }
  }, [supabase])

  async function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setIsSaving(true); setSaveSuccess(false); setError('')
    const { data: auth, error: authError } = await supabase.auth.getUser()
    if (authError || !auth.user) { setError('Sessão expirada.'); setIsSaving(false); return }
    const current = await supabase.from('platform_settings').select('data').eq('user_id', auth.user.id).maybeSingle()
    if (current.error) { setError(current.error.message); setIsSaving(false); return }
    const existing = current.data?.data && typeof current.data.data === 'object' ? current.data.data as Record<string, unknown> : {}
    const result = await supabase.from('platform_settings').upsert({ user_id: auth.user.id, data: { ...existing, recovery: settings }, updated_at: new Date().toISOString() }, { onConflict: 'user_id' })
    setIsSaving(false)
    if (result.error) { setError(result.error.message); return }
    setSaveSuccess(true)
    window.setTimeout(() => setSaveSuccess(false), 3000)
  }

  return (
    <div className="w-full space-y-5 text-white">
      <section className="flex flex-col gap-5 border-b border-white/[.055] pb-5 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[.2em] text-[var(--althea-brand)]">Automação</p>
          <h1 className="mt-2 text-[30px] font-semibold tracking-[-.04em] text-white sm:text-[34px]">Recuperação</h1>
          <p className="mt-1 max-w-2xl text-xs leading-5 text-[var(--althea-muted)]">Configure réguas e canais reais para recuperação de carrinho e pagamentos pendentes.</p>
        </div>
        <button type="button" onClick={onBack} className="inline-flex h-10 items-center gap-2 self-start rounded-xl border border-white/[.06] bg-[var(--althea-surface)] px-4 text-[10px] font-semibold text-[var(--althea-muted)] transition hover:text-white lg:self-auto"><ChevronLeft className="h-3.5 w-3.5 text-[var(--althea-brand)]" />Configurações</button>
      </section>

      {loading ? <div className="animate-pulse space-y-3"><div className="h-5 w-48 rounded bg-[#0F1A16]" /><div className="h-28 rounded-2xl bg-[#0F1A16]" /><div className="h-32 rounded-2xl bg-[#0F1A16]" /></div> : <>
        <section className="space-y-2">
          <span className="pl-1 text-[10px] font-bold uppercase tracking-wider text-[var(--althea-muted)]">Automações Assíncronas</span>
          <div className="rounded-2xl border border-white/[.055] bg-[var(--althea-surface)] p-4">
            {[['cartAutomation','Carrinho Abandonado','Disparos após 15 minutos de inatividade'],['pixAutomation','PIX Expirado','Lembrete após expiração do pagamento'],['boletoAutomation','Boleto sem Pagamento','Notificação antes do vencimento']].map(([key,title,description], index) => <div key={key} className={`flex items-center justify-between gap-3 ${index ? 'border-t border-[#0D362D]/40 pt-4 mt-4' : ''}`}><div><span className="block text-xs font-bold text-white">{title}</span><span className="mt-0.5 block text-[10px] text-[var(--althea-muted)]">{description}</span></div><Toggle checked={settings[key as keyof RecoverySettings] as boolean} label={`Ativar ${title}`} onChange={() => setSettings((current) => ({ ...current, [key]: !current[key as keyof RecoverySettings] }))} /></div>)}
          </div>
        </section>

        <section className="space-y-2">
          <span className="pl-1 text-[10px] font-bold uppercase tracking-wider text-[var(--althea-muted)]">Canais de Remetente</span>
          <div className="space-y-4 rounded-2xl border border-white/[.055] bg-[var(--althea-surface)] p-4">
            <label className="block space-y-1.5"><span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-300"><Mail className="h-3 w-3 text-[var(--althea-brand)]" />E-mail de Disparo</span><input type="email" value={settings.senderEmail} onChange={(event) => setSettings((current) => ({ ...current, senderEmail: event.target.value }))} placeholder="notificacoes@seudominio.com.br" className="w-full rounded-xl border border-white/[.045] bg-[var(--althea-bg)] px-3 py-2.5 text-xs text-slate-200 outline-none transition focus:border-[rgba(29,184,84,.32)]" /></label>
            <label className="block space-y-1.5"><span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-300"><Phone className="h-3 w-3 text-[var(--althea-brand)]" />WhatsApp (API)</span><input type="tel" value={settings.senderWhatsapp} onChange={(event) => setSettings((current) => ({ ...current, senderWhatsapp: event.target.value }))} placeholder="+55 (11) 99999-9999" className="w-full rounded-xl border border-white/[.045] bg-[var(--althea-bg)] px-3 py-2.5 text-xs text-slate-200 outline-none transition focus:border-[rgba(29,184,84,.32)]" /></label>
          </div>
        </section>

        {error && <div className="rounded-xl border border-red-900/40 bg-red-950/20 p-3 text-[10px] text-red-300" role="alert">{error}</div>}
        <motion.button whileTap={{ scale: 0.97 }} type="submit" form="recovery-settings-form" disabled={isSaving} className={`flex h-11 w-full items-center justify-center gap-2 rounded-xl border text-xs font-bold transition-all ${saveSuccess ? 'border-[#1DB854] bg-[var(--althea-brand)]/20 text-[var(--althea-brand)]' : 'border-[#1DB854] bg-[var(--althea-brand)] text-black disabled:opacity-40'}`}>
          {isSaving ? <><span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-black/30 border-t-black" />Atualizando Canais...</> : saveSuccess ? <><CheckCircle2 className="h-4 w-4" />Configurações Confirmadas!</> : <><Save className="h-4 w-4" />Confirmar Alterações</>}
        </motion.button>
      </>}
      <form id="recovery-settings-form" onSubmit={handleSave} className="hidden" />
    </div>
  )
}
