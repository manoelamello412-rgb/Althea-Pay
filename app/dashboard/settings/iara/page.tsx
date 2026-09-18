'use client'

import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Check, Globe2, ShieldCheck, Sparkles } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'

const SECURITY_BOUNDARY = 'A Iara não recebe autorização para executar código, alterar arquivos de desenvolvimento, modificar infraestrutura, editar .env, rotas, configurações de build ou estruturas de banco de dados.'

type IaraSettings = {
  name: string
  context: string
  tone: string
  allowWeb: boolean
}

const DEFAULTS: IaraSettings = { name: 'Iara', context: '', tone: 'prestativo', allowWeb: true }

export default function IaraSettingsPage() {
  const db = useMemo(() => createSupabaseBrowserClient(), [])
  const router = useRouter()
  const [settings, setSettings] = useState<IaraSettings>(DEFAULTS)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let mounted = true
    async function load() {
      setLoading(true); setError('')
      const { data: auth, error: authError } = await db.auth.getUser()
      if (authError || !auth.user) { router.replace('/login'); return }
      const { data, error: settingsError } = await db.from('platform_settings').select('data').eq('user_id', auth.user.id).maybeSingle()
      if (!mounted) return
      if (settingsError) setError(settingsError.message)
      const stored = data?.data && typeof data.data === 'object' ? data.data as Record<string, unknown> : {}
      const iara = stored.iara && typeof stored.iara === 'object' ? stored.iara as Record<string, unknown> : {}
      setSettings({
        name: typeof iara.name === 'string' && iara.name.trim() ? iara.name : DEFAULTS.name,
        context: typeof iara.context === 'string' ? iara.context : DEFAULTS.context,
        tone: typeof iara.tone === 'string' ? iara.tone : DEFAULTS.tone,
        allowWeb: typeof iara.allowWeb === 'boolean' ? iara.allowWeb : DEFAULTS.allowWeb,
      })
      setLoading(false)
    }
    void load()
    return () => { mounted = false }
  }, [db, router])

  const toneLabel = settings.tone === 'analitico' ? 'Analítico e Focado em Métricas' : settings.tone === 'agressivo-vendas' ? 'Persuasivo e Focado em Conversão' : 'Amigável e Prestativo'

  async function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (saving) return
    setSaving(true); setSaved(false); setError('')
    try {
      const { data: auth, error: authError } = await db.auth.getUser()
      if (authError || !auth.user) throw authError ?? new Error('Sessão expirada.')
      const { data: current, error: readError } = await db.from('platform_settings').select('data').eq('user_id', auth.user.id).maybeSingle()
      if (readError) throw readError
      const currentData = current?.data && typeof current.data === 'object' ? current.data as Record<string, unknown> : {}
      const nextData = {
        ...currentData,
        iara: { name: settings.name.trim() || DEFAULTS.name, context: settings.context.trim(), tone: settings.tone, allowWeb: settings.allowWeb },
      }
      const { error: saveError } = await db.from('platform_settings').upsert({ user_id: auth.user.id, data: nextData, updated_at: new Date().toISOString() }, { onConflict: 'user_id' })
      if (saveError) throw saveError
      setSettings((currentSettings) => ({ ...currentSettings, name: currentSettings.name.trim() || DEFAULTS.name, context: currentSettings.context.trim() }))
      setSaved(true)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível salvar as configurações.')
    } finally { setSaving(false) }
  }

  if (loading) return <div className="min-h-[400px] grid place-items-center text-xs text-[var(--althea-muted)]">Carregando configurações reais da conta...</div>

  return (
    <div className="w-full space-y-5 text-left text-white">
      <section className="flex flex-col gap-5 border-b border-white/[.055] pb-5 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[.2em] text-[var(--althea-brand)]">Inteligência</p>
          <h1 className="mt-2 text-[30px] font-semibold tracking-[-.04em] text-white sm:text-[34px]">Configurações da IARA</h1>
          <p className="mt-1 max-w-2xl text-xs leading-5 text-[var(--althea-muted)]">Defina identidade, contexto, tom e limites de atuação persistidos na configuração real da conta.</p>
        </div>
        <button type="button" onClick={() => router.push('/dashboard/settings')} className="inline-flex h-10 items-center self-start rounded-xl border border-white/[.06] bg-[var(--althea-surface)] px-4 text-[10px] font-semibold text-[var(--althea-muted)] transition hover:text-white lg:self-auto">Configurações</button>
      </section>

      <form onSubmit={handleSave} className="space-y-4">
        <section className="space-y-4 rounded-2xl border border-white/[.055] bg-[var(--althea-surface)] p-4">
          <div><span className="text-[10px] font-bold uppercase tracking-wider text-[var(--althea-brand)]">Identidade</span><p className="mt-1 text-[10px] text-[var(--althea-muted)]">Defina como a assistente será apresentada na operação.</p></div>
          <label className="block space-y-1.5"><span className="text-[10px] font-bold uppercase tracking-wider text-[var(--althea-muted)]">Nome de exibição</span><input type="text" maxLength={40} value={settings.name} onChange={(event) => setSettings((current) => ({ ...current, name: event.target.value }))} className="w-full rounded-xl border border-white/[.045] bg-[var(--althea-bg)] p-3 text-xs text-white outline-none focus:border-[rgba(29,184,84,.32)]" /></label>
        </section>

        <section className="space-y-4 rounded-2xl border border-white/[.055] bg-[var(--althea-surface)] p-4">
          <div><span className="text-[10px] font-bold uppercase tracking-wider text-[var(--althea-brand)]">Contexto Comercial & Tom</span><p className="mt-1 text-[10px] text-[var(--althea-muted)]">Dados armazenados no banco da operação.</p></div>
          <label className="block space-y-1.5"><span className="text-[10px] font-bold uppercase tracking-wider text-[var(--althea-muted)]">Contexto da operação</span><textarea rows={5} maxLength={4000} value={settings.context} onChange={(event) => setSettings((current) => ({ ...current, context: event.target.value }))} className="w-full resize-none rounded-xl border border-white/[.045] bg-[var(--althea-bg)] p-3 text-xs leading-relaxed text-white outline-none focus:border-[rgba(29,184,84,.32)]" /></label>
          <label className="block space-y-1.5"><span className="text-[10px] font-bold uppercase tracking-wider text-[var(--althea-muted)]">Tom de voz</span><select value={settings.tone} onChange={(event) => setSettings((current) => ({ ...current, tone: event.target.value }))} className="w-full rounded-xl border border-white/[.045] bg-[var(--althea-bg)] p-3 text-xs text-white outline-none focus:border-[rgba(29,184,84,.32)]"><option value="prestativo">Amigável e Prestativo</option><option value="analitico">Analítico e Focado em Métricas</option><option value="agressivo-vendas">Persuasivo e Focado em Conversão</option></select></label>
          <div className="rounded-xl border border-white/[.045] bg-[var(--althea-bg)] px-3 py-2.5 text-[10px] text-[var(--althea-muted)]">Tom selecionado: <span className="font-semibold text-[#c8d2cc]">{toneLabel}</span></div>
        </section>

        <section className="space-y-4 rounded-2xl border border-white/[.055] bg-[var(--althea-surface)] p-4">
          <div><span className="text-[10px] font-bold uppercase tracking-wider text-red-500">Autonomia</span><p className="mt-1 text-[10px] text-[var(--althea-muted)]">Preferência persistida no banco. A execução continua limitada pelas permissões do backend.</p></div>
          <label className="flex cursor-pointer items-center justify-between gap-3 rounded-xl border border-white/[.045] bg-[var(--althea-bg)] p-3"><span className="flex items-center gap-3"><span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--althea-surface)] text-[var(--althea-brand)]"><Globe2 size={15} /></span><span><span className="block text-xs font-bold text-white">Busca externa permitida</span><span className="block text-[10px] text-[var(--althea-muted)]">Controla apenas a preferência registrada para a assistente.</span></span></span><input type="checkbox" className="h-4 w-4" checked={settings.allowWeb} onChange={(event) => setSettings((current) => ({ ...current, allowWeb: event.target.checked }))} /></label>
          <div className="space-y-2 rounded-xl border border-red-900/40 bg-red-950/20 p-3"><div className="flex items-center gap-2"><ShieldCheck size={15} className="text-red-400" /><span className="text-xs font-bold text-red-400">Limite de infraestrutura</span></div><p className="text-[10px] leading-relaxed text-[var(--althea-muted)]">{SECURITY_BOUNDARY}</p></div>
        </section>

        <button type="submit" disabled={saving} className="flex w-full items-center justify-center gap-2 rounded-xl bg-[var(--althea-brand)] py-3 text-xs font-bold text-black disabled:opacity-60">{saving ? 'Salvando no banco...' : saved ? 'Configurações salvas' : 'Salvar configurações'}{saved && <Check size={14} />}</button>
        {error && <div className="rounded-xl border border-red-900/40 bg-red-950/20 p-3 text-[10px] text-red-300" role="alert">{error}</div>}
        {saved && <p className="text-center text-[10px] font-medium text-[var(--althea-brand)]" role="status">Alteração persistida em platform_settings.</p>}
      </form>
    </div>
  )
}
