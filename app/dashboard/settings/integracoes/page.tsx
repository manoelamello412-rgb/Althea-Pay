'use client'

import { useEffect, useState, type FormEvent } from 'react'
import { AlertTriangle, Check, ChevronLeft, Copy, Eye, EyeOff, KeyRound, Link2, Webhook, X } from 'lucide-react'

const STORAGE_KEY = 'althea-webhook-settings'

type WebhookConfig = { url: string; active: boolean }

export default function IntegracoesSettingsPage() {
  const [showSecret, setShowSecret] = useState(false)
  const [webhookUrl, setWebhookUrl] = useState('')
  const [active, setActive] = useState(false)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY)
      if (!saved) return
      const value = JSON.parse(saved) as Partial<WebhookConfig>
      if (typeof value.url === 'string') setWebhookUrl(value.url)
      if (typeof value.active === 'boolean') setActive(value.active)
    } catch {}
  }, [])

  async function copySecret(): Promise<void> {
    setMessage('')
    setError('A chave de produção ainda não foi provisionada para esta conta.')
  }

  async function saveWebhook(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    setSaving(true); setMessage(''); setError('')
    try {
      const url = webhookUrl.trim()
      if (url) {
        const parsed = new URL(url)
        if (parsed.protocol !== 'https:') throw new Error('O endpoint precisa usar HTTPS.')
      }
      await new Promise((resolve) => window.setTimeout(resolve, 300))
      const config = { url, active: Boolean(url) && active }
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(config))
      setWebhookUrl(url); setActive(config.active)
      setMessage(url ? 'Endpoint salvo neste dispositivo.' : 'Endpoint removido.')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível salvar o endpoint.')
    } finally { setSaving(false) }
  }

  return (
    <div className="space-y-4 pb-32 font-['Space_Grotesk'] text-white">
      <div className="flex items-center justify-between border-b border-[#0D362D]/30 pb-3">
        <button type="button" onClick={() => window.dispatchEvent(new CustomEvent('althea-settings-back'))} className="flex items-center gap-1.5 text-xs font-bold text-[#A6A6A6] hover:text-white">
          <ChevronLeft size={16} className="text-[#1DB854]" /> Voltar
        </button>
        <div className="flex items-center gap-1.5"><Webhook size={15} className="text-[#1DB854]" /><span className="text-[10px] font-bold uppercase tracking-wider text-zinc-200">API & Webhooks</span></div>
      </div>

      <section className="space-y-3 rounded-2xl border border-[#0D362D] bg-[#0F1A16] p-4">
        <div className="flex items-center gap-2"><KeyRound size={15} className="text-[#1DB854]" /><div><h2 className="text-xs font-bold">Chave Secreta de Produção</h2><p className="text-[9px] text-zinc-500">A credencial será exibida somente quando existir uma chave provisionada para a conta.</p></div></div>
        <div className="relative flex items-center rounded-xl border border-[#0D362D] bg-[#0B0B0D] px-3 py-3">
          <code className="truncate pr-16 font-mono text-xs tracking-wide text-zinc-500">chave de produção não provisionada</code>
          <div className="absolute right-2 flex items-center gap-1">
            <button type="button" onClick={() => setShowSecret((value) => !value)} className="rounded-lg p-1.5 text-zinc-500 hover:text-white" aria-label={showSecret ? 'Ocultar chave' : 'Revelar chave'}>{showSecret ? <EyeOff size={16} className="text-[#1DB854]" /> : <Eye size={16} />}</button>
            <button type="button" onClick={() => void copySecret()} className="rounded-lg p-1.5 text-zinc-500 hover:text-white" aria-label="Copiar chave"><Copy size={16} /></button>
          </div>
        </div>
        {showSecret && <p className="text-[10px] text-amber-400">Por segurança, nenhuma chave secreta é embutida ou inventada no frontend.</p>}
      </section>

      <form onSubmit={saveWebhook} className="space-y-3 rounded-2xl border border-[#0D362D] bg-[#0F1A16] p-4">
        <div className="flex items-center gap-2"><Link2 size={15} className="text-[#1DB854]" /><div><h2 className="text-xs font-bold">Endpoint de Notificação</h2><p className="text-[9px] text-zinc-500">Cadastre um destino HTTPS para receber eventos quando a infraestrutura de webhooks estiver conectada.</p></div></div>
        <div className="flex gap-2"><input type="url" value={webhookUrl} onChange={(event) => setWebhookUrl(event.target.value)} placeholder="https://sua-api.com/webhooks/althea" className="min-w-0 flex-1 rounded-xl border border-[#0D362D] bg-[#0B0B0D] px-3 py-2.5 font-mono text-xs text-zinc-200 outline-none focus:border-[#1DB854]/60" /><button type="submit" disabled={saving} className="rounded-xl border border-[#1DB854] bg-[#1DB854] px-3 text-xs font-bold text-black disabled:opacity-50">{saving ? '...' : <Check size={16} />}</button></div>
        <label className="flex items-center justify-between rounded-xl border border-zinc-900 bg-[#0B0B0D] p-3"><span><span className="block text-xs font-bold text-zinc-200">Endpoint ativo</span><span className="block text-[9px] text-zinc-500">Ative somente após cadastrar uma URL HTTPS.</span></span><input type="checkbox" checked={active && Boolean(webhookUrl.trim())} onChange={(event) => setActive(event.target.checked)} disabled={!webhookUrl.trim()} className="h-4 w-4 accent-[#1DB854]" /></label>
      </form>

      <section className="space-y-2"><span className="pl-1 text-[10px] font-bold uppercase tracking-wider text-[#A6A6A6]">Logs de Envio Recentes</span><div className="rounded-xl border border-zinc-900 bg-[#0F1A16]/60 p-4"><div className="flex items-start gap-3"><AlertTriangle size={17} className="mt-0.5 text-zinc-500" /><div><p className="text-xs font-semibold text-zinc-300">Nenhum envio registrado</p><p className="mt-1 text-[10px] leading-relaxed text-zinc-500">Os eventos reais e os códigos HTTP aparecerão aqui quando houver disparos registrados.</p></div></div></div></section>
      {(message || error) && <div className={`flex items-center justify-between rounded-xl border p-3 text-[10px] ${error ? 'border-red-900/40 bg-red-950/20 text-red-300' : 'border-[#1DB854]/30 bg-[#1DB854]/5 text-[#1DB854]'}`} role="status"><span>{error || message}</span><button type="button" onClick={() => { setError(''); setMessage('') }} aria-label="Fechar"><X size={14} /></button></div>}
    </div>
  )
}
