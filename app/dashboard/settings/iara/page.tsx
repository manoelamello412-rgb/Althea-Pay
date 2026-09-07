'use client'

import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Check, Globe2, ShieldCheck, Sparkles } from 'lucide-react'

const SECURITY_BOUNDARY =
  'STRICT_RESTRICTION: Você não possui permissão para ler, alterar, injetar ou sugerir mudanças no código-fonte da plataforma, arquivos de configuração de desenvolvimento (.env, rotas, configs de build) ou bancos de dados estruturais. Seu escopo é estritamente limitado ao auxílio operacional do negócio do usuário e consultas externas.'

const STORAGE_KEY = 'althea-iara-settings'

export default function IaraSettingsPage() {
  const [assistantName, setAssistantName] = useState('Iara')
  const [businessContext, setBusinessContext] = useState('')
  const [toneOfVoice, setToneOfVoice] = useState('prestativo')
  const [enableWebSearch, setEnableWebSearch] = useState(true)
  const [isLoading, setIsLoading] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY)
      if (!stored) return
      const settings = JSON.parse(stored) as Partial<{
        name: string
        context: string
        tone: string
        allowWeb: boolean
      }>
      if (typeof settings.name === 'string' && settings.name.trim()) setAssistantName(settings.name)
      if (typeof settings.context === 'string') setBusinessContext(settings.context)
      if (typeof settings.tone === 'string') setToneOfVoice(settings.tone)
      if (typeof settings.allowWeb === 'boolean') setEnableWebSearch(settings.allowWeb)
    } catch {
      // Ignore an invalid local preference and keep the safe defaults.
    }
  }, [])

  const toneLabel = useMemo(() => {
    if (toneOfVoice === 'analitico') return 'Analítico e Focado em Métricas'
    if (toneOfVoice === 'agressivo-vendas') return 'Persuasivo e Focado em Conversão'
    return 'Amigável e Prestativo'
  }, [toneOfVoice])

  const handleSave = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const name = assistantName.trim() || 'Iara'
    setAssistantName(name)
    setIsLoading(true)
    setSaved(false)

    window.setTimeout(() => {
      window.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          name,
          context: businessContext.trim(),
          tone: toneOfVoice,
          allowWeb: enableWebSearch,
        }),
      )
      setIsLoading(false)
      setSaved(true)
    }, 400)
  }

  return (
    <div className="space-y-5 pb-32 text-left font-['Space_Grotesk'] text-white">
      <header className="space-y-1">
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-xl border border-[#1DB854]/20 bg-[#0F1A16] text-[#1DB854]">
            <Sparkles size={16} aria-hidden="true" />
          </span>
          <div>
            <h1 className="text-xl font-bold tracking-tight">Assistente Virtual: Iara</h1>
            <p className="text-[11px] font-medium text-zinc-500">
              Configure a personalidade, o contexto e a autonomia do seu copiloto.
            </p>
          </div>
        </div>
      </header>

      <form onSubmit={handleSave} className="space-y-4">
        <section className="space-y-4 rounded-2xl border border-zinc-900 bg-[#0F1A16]/40 p-4">
          <div>
            <span className="text-[10px] font-bold uppercase tracking-wider text-[#1DB854]">Identidade & Nome</span>
            <p className="mt-1 text-[10px] text-zinc-500">Defina como a assistente será apresentada na operação.</p>
          </div>
          <label className="block space-y-1.5">
            <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">Nome de Exibição da IA</span>
            <input
              type="text"
              maxLength={40}
              placeholder="Ex: Iara"
              className="w-full rounded-xl border border-zinc-900 bg-[#060608] p-3 text-xs text-white outline-none transition focus:border-[#1DB854]/40"
              value={assistantName}
              onChange={(event) => setAssistantName(event.target.value)}
            />
          </label>
        </section>

        <section className="space-y-4 rounded-2xl border border-zinc-900 bg-[#0F1A16]/40 p-4">
          <div>
            <span className="text-[10px] font-bold uppercase tracking-wider text-[#1DB854]">Contexto Comercial & Tom</span>
            <p className="mt-1 text-[10px] text-zinc-500">Dê à Iara o contexto necessário para respostas mais úteis.</p>
          </div>
          <label className="block space-y-1.5">
            <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">Sobre a sua Operação (Contexto)</span>
            <textarea
              rows={5}
              maxLength={4000}
              placeholder="Explique à Iara o que sua operação vende e quais são seus objetivos, para que ela possa ajudar com estratégias, suporte e insights."
              className="w-full resize-none rounded-xl border border-zinc-900 bg-[#060608] p-3 text-xs leading-relaxed text-white outline-none transition focus:border-[#1DB854]/40"
              value={businessContext}
              onChange={(event) => setBusinessContext(event.target.value)}
            />
          </label>
          <label className="block space-y-1.5">
            <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">Tom de Voz Dominante</span>
            <select
              className="w-full appearance-none rounded-xl border border-zinc-900 bg-[#060608] p-3 text-xs text-white outline-none transition focus:border-[#1DB854]/40"
              value={toneOfVoice}
              onChange={(event) => setToneOfVoice(event.target.value)}
            >
              <option value="prestativo">Amigável e Prestativo (Ideal para vendas)</option>
              <option value="analitico">Analítico e Focado em Métricas</option>
              <option value="agressivo-vendas">Persuasivo e Focado em Conversão</option>
            </select>
          </label>
          <div className="rounded-xl border border-zinc-900 bg-[#060608] px-3 py-2.5 text-[10px] text-zinc-500">
            Tom selecionado: <span className="font-semibold text-zinc-300">{toneLabel}</span>
          </div>
        </section>

        <section className="space-y-4 rounded-2xl border border-zinc-900 bg-[#0F1A16]/40 p-4">
          <div>
            <span className="text-[10px] font-bold uppercase tracking-wider text-red-500">Políticas de Autonomia & Sandbox</span>
            <p className="mt-1 text-[10px] text-zinc-500">Controles de escopo que acompanham a configuração da assistente.</p>
          </div>

          <label className="flex cursor-pointer items-center justify-between gap-3 rounded-xl border border-zinc-900 bg-[#060608] p-3 transition hover:border-zinc-800">
            <span className="flex min-w-0 items-center gap-3">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#0F1A16] text-[#1DB854]">
                <Globe2 size={15} aria-hidden="true" />
              </span>
              <span className="min-w-0">
                <span className="block text-xs font-bold text-zinc-200">Autonomia de Busca Externa</span>
                <span className="mt-0.5 block text-[10px] leading-normal text-zinc-500">
                  Permite consultas externas para enriquecer respostas com informações atualizadas.
                </span>
              </span>
            </span>
            <input
              type="checkbox"
              className="h-4 w-4 shrink-0 accent-[#1DB854]"
              checked={enableWebSearch}
              onChange={(event) => setEnableWebSearch(event.target.checked)}
            />
          </label>

          <div className="space-y-2 rounded-xl border border-red-900/40 bg-red-950/20 p-3">
            <div className="flex items-center gap-2">
              <ShieldCheck size={15} className="text-red-400" aria-hidden="true" />
              <span className="text-xs font-bold text-red-400">Proteção de Infraestrutura Ativa</span>
            </div>
            <p className="text-[10px] leading-relaxed text-zinc-400">
              A Iara não recebe, por esta configuração, autorização para executar código, alterar arquivos de desenvolvimento,
              modificar infraestrutura, editar .env, rotas, configurações de build ou estruturas de banco de dados.
            </p>
            <div className="rounded-lg border border-red-900/30 bg-black/20 p-2 font-mono text-[9px] leading-relaxed text-zinc-500">
              {SECURITY_BOUNDARY}
            </div>
          </div>
        </section>

        <button
          type="submit"
          disabled={isLoading}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#1DB854] py-3 text-xs font-bold text-black transition-all duration-200 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isLoading ? 'Atualizando Diretrizes...' : saved ? 'Configurações Salvas' : 'Salvar Configurações da Iara ⚡'}
          {saved && <Check size={14} aria-hidden="true" />}
        </button>

        {saved && (
          <p className="text-center text-[10px] font-medium text-[#1DB854]" role="status">
            Preferências da Iara salvas neste dispositivo.
          </p>
        )}
      </form>
    </div>
  )
}
