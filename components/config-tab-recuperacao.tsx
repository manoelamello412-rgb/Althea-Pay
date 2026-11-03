'use client'

import { ChevronLeft, ExternalLink, Loader2, RefreshCcw } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'

// The cart switch is the real one read by enqueue_checkout_recovery_events. Texts, delays, channels and senders
// live in the remarketing rules (CRM > Campanhas > Remarketing automático).
export function ConfigTabRecuperacao({ onBack }: { onBack: () => void }) {
  const supabase = useMemo(() => createSupabaseBrowserClient(), [])
  const router = useRouter()
  const [cart, setCart] = useState(false)
  const [canEdit, setCanEdit] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    void supabase.rpc('recovery_settings_v1').then(({ data, error: loadError }: { data: { cart_automation?: boolean; can_edit?: boolean } | null; error: unknown }) => {
      if (loadError) setError('Não foi possível carregar a configuração.')
      else { setCart(data?.cart_automation === true); setCanEdit(data?.can_edit === true) }
      setLoading(false)
    })
  }, [supabase])

  async function toggle() {
    const next = !cart
    setSaving(true); setMessage(''); setError('')
    const { error: saveError } = await supabase.rpc('recovery_settings_set_v1', { p_cart_automation: next })
    setSaving(false)
    if (saveError) { setError(saveError.message === 'FORBIDDEN' ? 'Só quem gerencia automações pode alterar.' : 'Não foi possível salvar.'); return }
    setCart(next)
    setMessage(next ? 'Recuperação de carrinho ligada.' : 'Recuperação de carrinho desligada.')
  }

  return (
    <div className="w-full space-y-4 pb-32 font-['Space_Grotesk'] text-white">
      <div className="flex items-center justify-between border-b border-[#0D362D]/30 pb-2">
        <button type="button" onClick={onBack} className="flex items-center gap-1.5 text-xs font-bold text-[#A6A6A6] transition-colors hover:text-white">
          <ChevronLeft className="h-4 w-4 text-[#1DB854]" />Voltar
        </button>
        <div className="flex items-center gap-1.5">
          <RefreshCcw className="h-3.5 w-3.5 text-[#1DB854]" />
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-200">Recuperação</span>
        </div>
      </div>

      {loading ? <div className="h-28 animate-pulse rounded-2xl bg-[#0F1A16]" /> : <>
        <section className="rounded-2xl border border-[#0D362D] bg-[#0F1A16] p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <span className="block text-xs font-bold text-white">Recuperação de carrinho abandonado</span>
              <span className="mt-0.5 block text-[10px] leading-4 text-[#A6A6A6]">Mensagem padrão por e-mail/SMS para quem abandonou o checkout e aceitou contato. Se existir uma regra de checkout abandonado em Remarketing automático, ela substitui esta mensagem.</span>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={cart}
              aria-label="Recuperação de carrinho abandonado"
              disabled={!canEdit || saving}
              onClick={() => void toggle()}
              className={`flex h-6 w-11 shrink-0 items-center rounded-full p-0.5 transition disabled:opacity-50 ${cart ? 'justify-end bg-[#1DB854]' : 'justify-start border border-[#0D362D] bg-[#0B0B0D]'}`}
            >
              {saving ? <Loader2 className="mx-auto h-4 w-4 animate-spin" /> : <span className="h-5 w-5 rounded-full bg-white shadow-md" />}
            </button>
          </div>
          {!canEdit && <p className="mt-3 text-[10px] text-amber-300/80">Somente leitura: alterar exige permissão de gerenciar automações.</p>}
        </section>

        <section className="rounded-2xl border border-[#0D362D] bg-[#0F1A16] p-4 text-[11px] leading-5 text-[#A6A6A6]">
          Pagamento pendente (PIX gerado e não pago), tempos de espera, texto, botão, remetente de e-mail e número de WhatsApp são configurados nas regras de remarketing.
          <button type="button" onClick={() => router.push('/dashboard/crm/campanhas?tab=remarketing')} className="mt-3 flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-[#1DB854] px-4 text-xs font-bold text-black transition hover:brightness-110">
            Abrir Remarketing automático <ExternalLink className="h-4 w-4" />
          </button>
        </section>
      </>}

      {message && <div className="rounded-xl border border-[#1DB854]/20 bg-[#1DB854]/5 p-3 text-[10px] text-[#1DB854]" role="status">{message}</div>}
      {error && <div className="rounded-xl border border-red-900/40 bg-red-950/20 p-3 text-[10px] text-red-300" role="alert">{error}</div>}
    </div>
  )
}
