'use client'

import { ChevronLeft, ExternalLink, Mail, Phone, RefreshCcw, ShieldAlert } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
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

function ReadOnlyToggle({ checked, label }: { checked: boolean; label: string }) {
  return (
    <span
      role="switch"
      aria-checked={checked}
      aria-readonly="true"
      aria-label={label}
      className={`flex h-6 w-11 shrink-0 items-center rounded-full p-0.5 ${checked ? 'justify-end bg-[#1DB854]' : 'justify-start border border-[#0D362D] bg-[#0B0B0D]'}`}
    >
      <span className="h-5 w-5 rounded-full bg-white shadow-md" />
    </span>
  )
}

export function ConfigTabRecuperacao({ onBack }: { onBack: () => void }) {
  const supabase = useMemo(() => createSupabaseBrowserClient(), [])
  const router = useRouter()
  const [settings, setSettings] = useState<RecoverySettings>(DEFAULTS)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let mounted = true

    async function load() {
      setLoading(true)
      setError('')
      const { data: auth, error: authError } = await supabase.auth.getUser()
      if (authError || !auth.user) {
        if (mounted) {
          setError('Sessão expirada.')
          setLoading(false)
        }
        return
      }

      const { data, error: settingsError } = await supabase
        .from('platform_settings')
        .select('data')
        .eq('user_id', auth.user.id)
        .maybeSingle()

      if (!mounted) return
      if (settingsError) setError(settingsError.message)

      const recovery = data?.data && typeof data.data === 'object'
        ? (data.data as Record<string, unknown>).recovery
        : null

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

  const automationRows = [
    ['cartAutomation', 'Carrinho Abandonado', 'Disparos após 15 minutos de inatividade'],
    ['pixAutomation', 'PIX Expirado', 'Lembrete após expiração do pagamento'],
    ['boletoAutomation', 'Boleto sem Pagamento', 'Notificação antes do vencimento'],
  ] as const

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

      {loading ? (
        <div className="animate-pulse space-y-3">
          <div className="h-5 w-48 rounded bg-[#0F1A16]" />
          <div className="h-28 rounded-2xl bg-[#0F1A16]" />
          <div className="h-32 rounded-2xl bg-[#0F1A16]" />
        </div>
      ) : (
        <>
          <section className="rounded-2xl border border-amber-500/20 bg-amber-500/[0.06] p-4">
            <div className="flex items-start gap-3">
              <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-300" />
              <div>
                <h2 className="text-sm font-bold text-amber-100">Preferências antigas preservadas, mas não operacionais</h2>
                <p className="mt-1 text-[11px] leading-5 text-amber-100/65">
                  Estes valores existem em <code>platform_settings.recovery</code>, porém o motor real de automação não os consome atualmente. Para não simular uma automação inexistente, esta tela fica somente leitura até o contrato backend ser conectado.
                </p>
              </div>
            </div>
          </section>

          <section className="space-y-2">
            <span className="pl-1 text-[10px] font-bold uppercase tracking-wider text-[#A6A6A6]">Preferências registradas</span>
            <div className="rounded-2xl border border-[#0D362D] bg-[#0F1A16] p-4">
              {automationRows.map(([key, title, description], index) => {
                const checked = settings[key]
                return (
                  <div key={key} className={`flex items-center justify-between gap-3 ${index ? 'mt-4 border-t border-[#0D362D]/40 pt-4' : ''}`}>
                    <div>
                      <span className="block text-xs font-bold text-white">{title}</span>
                      <span className="mt-0.5 block text-[10px] text-[#A6A6A6]">{description}</span>
                      <span className="mt-1 block text-[9px] font-semibold uppercase tracking-wider text-amber-300/80">
                        {checked ? 'Registrado como ativo · sem efeito operacional' : 'Registrado como inativo'}
                      </span>
                    </div>
                    <ReadOnlyToggle checked={checked} label={`${title}: somente leitura`} />
                  </div>
                )
              })}
            </div>
          </section>

          <section className="space-y-2">
            <span className="pl-1 text-[10px] font-bold uppercase tracking-wider text-[#A6A6A6]">Remetentes registrados</span>
            <div className="space-y-4 rounded-2xl border border-[#0D362D] bg-[#0F1A16] p-4">
              <div className="rounded-xl border border-[#0D362D] bg-[#0B0B0D] px-3 py-2.5">
                <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-300"><Mail className="h-3 w-3 text-[#1DB854]" />E-mail de disparo</span>
                <p className="mt-1 break-all text-xs text-slate-400">{settings.senderEmail || 'Não configurado'}</p>
              </div>
              <div className="rounded-xl border border-[#0D362D] bg-[#0B0B0D] px-3 py-2.5">
                <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-300"><Phone className="h-3 w-3 text-[#1DB854]" />WhatsApp (API)</span>
                <p className="mt-1 text-xs text-slate-400">{settings.senderWhatsapp || 'Não configurado'}</p>
              </div>
            </div>
          </section>

          <button
            type="button"
            onClick={() => router.push('/dashboard/crm/recovery')}
            className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-[#1DB854] px-4 text-xs font-bold text-black transition hover:brightness-110"
          >
            Abrir Central de Recuperação real <ExternalLink className="h-4 w-4" />
          </button>
        </>
      )}

      {error && <div className="rounded-xl border border-red-900/40 bg-red-950/20 p-3 text-[10px] text-red-300" role="alert">{error}</div>}
    </div>
  )
}
