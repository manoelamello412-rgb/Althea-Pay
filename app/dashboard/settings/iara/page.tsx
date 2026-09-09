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

  if (loading) return <div className="min-h-[400px] grid place-items-center text-xs text-zinc-500">Carregando configurações reais da conta...</div>

  return (
    <div className="space-y-5 pb-32 text-left font-['Space_Grotesk'] text-white">
      <header className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-xl border border-[#1DB854]/20 bg-[#0F1A16] text-[#1DB854]"><Sparkles size={16} /></span>
          <div><h1 className="text-xl font-bold tracking-tight">Assistente Virtual: Iara</h1><p className="text-[11px] font-medium text-zinc-500">Preferências persistidas na configuração real da conta.</p></div>
        </div>
        <button type="button" onClick={() => router.push('/dashboard/settings')} className="min-h-10 rounded-xl border border-zinc-900 px-3 text-xs font-semibold text-zinc-400 hover:text-white">Voltar</button>
      </header>

      <form onSubmit={handleSave} className="space-y-4">
        <section className="space-y-4 rounded-2xl border border-zinc-900 bg-[#0F1A16]/40 p-4">
          <div><span className="text-[10px] font-bold uppercase tracking-wider text-[#1DB854]">Identidade</span><p className="mt-1 text-[10px] text-zinc-500">Defina como a assistente será apresentada na operação.</p></div>
          <label className="block space-y-1.5"><span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">Nome de exibição</span><input type="text" maxLength={40} value={settings.name} onChange={(event) => setSettings((current) => ({ ...current, name: event.target.value }))} className="w-full rounded-xl border border-zinc-900 bg-[#060608] p-3 text-xs text-white outline-none focus:border-[#1DB854]/40" /></label>
        </section>

        <section className="space-y-4 rounded-2xl border border-zinc-900 bg-[#0F1A16]/40 p-4">
          <div><span className="text-[10px] font-bold uppercase tracking-wider text-[#1DB854]">Contexto Comercial & Tom</span><p className="mt-1 text-[10px] text-zinc-500">Dados armazenados no banco da operação.</p></div>
          <label className="block space-y-1.5"><span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">Contexto da operação</span><textarea rows={5} maxLength={4000} value={settings.context} onChange={(event) => setSettings((current) => ({ ...current, context: event.target.value }))} className="w-full resize-none rounded-xl border border-zinc-900 bg-[#060608] p-3 text-xs leading-relaxed text-white outline-none focus:border-[#1DB854]/40" /></label>
          <label className="block space-y-1.5"><span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">Tom de voz</span><select value={settings.tone} onChange={(event) => setSettings((current) => ({ ...current, tone: event.target.value }))} className="w-full rounded-xl border border-zinc-900 bg-[#060608] p-3 text-xs text-white outline-none focus:border-[#1DB854]/40"><option value="prestativo">Amigável e Prestativo</option><option value="analitico">Analítico e Focado em Métricas</option><option value="agressivo-vendas">Persuasivo e Focado em Conversão</option></select></label>
          <div className="rounded-xl border border-zinc-900 bg-[#060608] px-3 py-2.5 text-[10px] text-zinc-500">Tom selecionado: <span className="font-semibold text-zinc-300">{toneLabel}</span></div>
        </section>

        <section className="space-y-4 rounded-2xl border border-zinc-900 bg-[#0F1A16]/40 p-4">
          <div><span className="text-[10px] font-bold uppercase tracking-wider text-red-500">Autonomia</span><p className="mt-1 text-[10px] text-zinc-500">Preferência persistida no banco. A execução continua limitada pelas permissões do backend.</p></div>
          <label className="flex cursor-pointer items-center justify-between gap-3 rounded-xl border border-zinc-900 bg-[#060608] p-3"><span className="flex items-center gap-3"><span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#0F1A16] text-[#1DB854]"><Globe2 size={15} /></span><span><span className="block text-xs font-bold text-zinc-200">Busca externa permitida</span><span className="block text-[10px] text-zinc-500">Controla apenas a preferência registrada para a assistente.</span></span></span><input type="checkbox" className="h-4 w-4" checked={settings.allowWeb} onChange={(event) => setSettings((current) => ({ ...current, allowWeb: event.target.checked }))} /></label>
          <div className="space-y-2 rounded-xl border border-red-900/40 bg-red-950/20 p-3"><div className="flex items-center gap-2"><ShieldCheck size={15} className="text-red-400" /><span className="text-xs font-bold text-red-400">Limite de infraestrutura</span></div><p className="text-[10px] leading-relaxed text-zinc-400">{SECURITY_BOUNDARY}</p></div>
        </section>

        <button type="submit" disabled={saving} className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#1DB854] py-3 text-xs font-bold text-black disabled:opacity-60">{saving ? 'Salvando no banco...' : saved ? 'Configurações salvas' : 'Salvar configurações'}{saved && <Check size={14} />}</button>
        {error && <div className="rounded-xl border border-red-900/40 bg-red-950/20 p-3 text-[10px] text-red-300" role="alert">{error}</div>}
        {saved && <p className="text-center text-[10px] font-medium text-[#1DB854]" role="status">Alteração persistida em platform_settings.</p>}
      </form>
    </div>
  )
}
