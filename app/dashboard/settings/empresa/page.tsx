'use client'

import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { Building2, Check, LockKeyhole, Loader2, RefreshCw, ShieldCheck } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'

type FinancialMetrics = {
  monthly_billing_cents?: number
  tax_withheld_cents?: number
  current_tier?: string
}

type TenantDetails = {
  id: string
  user_id: string
  legal_name: string
  trade_name: string
  document_id: string | null
  state_registration: string | null
  billing_email: string | null
  financial_metrics: FinancialMetrics
  updated_at: string
}

const EMPTY_METRICS: FinancialMetrics = {
  monthly_billing_cents: 0,
  tax_withheld_cents: 0,
  current_tier: 'Standard',
}

function asMetrics(value: unknown): FinancialMetrics {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return EMPTY_METRICS
  const raw = value as Record<string, unknown>
  return {
    monthly_billing_cents: typeof raw.monthly_billing_cents === 'number' ? raw.monthly_billing_cents : 0,
    tax_withheld_cents: typeof raw.tax_withheld_cents === 'number' ? raw.tax_withheld_cents : 0,
    current_tier: typeof raw.current_tier === 'string' && raw.current_tier.trim() ? raw.current_tier : 'Standard',
  }
}

function normalizeTenant(row: Record<string, unknown>): TenantDetails {
  return {
    id: String(row.id ?? ''),
    user_id: String(row.user_id ?? ''),
    legal_name: String(row.legal_name ?? ''),
    trade_name: String(row.trade_name ?? ''),
    document_id: typeof row.document_id === 'string' ? row.document_id : null,
    state_registration: typeof row.state_registration === 'string' ? row.state_registration : null,
    billing_email: typeof row.billing_email === 'string' ? row.billing_email : null,
    financial_metrics: asMetrics(row.financial_metrics),
    updated_at: String(row.updated_at ?? ''),
  }
}

function formatCurrency(cents: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100)
}

function maskDocument(value: string | null): string {
  const digits = (value ?? '').replace(/\D/g, '')
  if (!digits) return ''
  if (digits.length === 14) return `***.***.***/${digits.slice(-6, -2)}-${digits.slice(-2)}`
  if (digits.length === 11) return `***.***.***-${digits.slice(-2)}`
  return `•••• ${digits.slice(-4)}`
}

function formatUpdatedAt(value: string): string {
  if (!value) return 'Ainda não sincronizado'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Data indisponível'
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'medium', timeStyle: 'short' }).format(date)
}

export default function EmpresaSettingsPage() {
  const supabase = useMemo(() => createSupabaseBrowserClient(), [])
  const router = useRouter()
  const [tenant, setTenant] = useState<TenantDetails | null>(null)
  const [legalName, setLegalName] = useState('')
  const [tradeName, setTradeName] = useState('')
  const [billingEmail, setBillingEmail] = useState('')
  const [documentId, setDocumentId] = useState('')
  const [stateRegistration, setStateRegistration] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  const loadCompany = useCallback(async (signal?: AbortSignal) => {
    setLoading(true)
    setError('')
    try {
      const { data: auth, error: authError } = await supabase.auth.getUser()
      if (authError || !auth.user) {
        router.replace('/login')
        return
      }

      const { data, error: queryError } = await supabase
        .from('tenant_details')
        .select('id,user_id,legal_name,trade_name,document_id,state_registration,billing_email,financial_metrics,updated_at')
        .eq('user_id', auth.user.id)
        .maybeSingle()

      if (queryError) throw queryError
      if (signal?.aborted) return

      if (!data) {
        const initial: TenantDetails = {
          id: '',
          user_id: auth.user.id,
          legal_name: '',
          trade_name: '',
          document_id: null,
          state_registration: null,
          billing_email: auth.user.email ?? null,
          financial_metrics: EMPTY_METRICS,
          updated_at: '',
        }
        setTenant(initial)
        setLegalName('')
        setTradeName('')
        setBillingEmail(auth.user.email ?? '')
        setDocumentId('')
        setStateRegistration('')
        return
      }

      const next = normalizeTenant(data as Record<string, unknown>)
      setTenant(next)
      setLegalName(next.legal_name)
      setTradeName(next.trade_name)
      setBillingEmail(next.billing_email ?? auth.user.email ?? '')
      setDocumentId(next.document_id ?? '')
      setStateRegistration(next.state_registration ?? '')
    } catch (cause) {
      if (!signal?.aborted) setError(cause instanceof Error ? cause.message : 'Não foi possível carregar os dados da empresa.')
    } finally {
      if (!signal?.aborted) setLoading(false)
    }
  }, [router, supabase])

  useEffect(() => {
    const controller = new AbortController()
    void loadCompany(controller.signal)
    return () => controller.abort()
  }, [loadCompany])

  async function handleSave(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    if (saving || !tenant) return
    setSaving(true)
    setError('')
    setMessage('')

    try {
      const { data: auth, error: authError } = await supabase.auth.getUser()
      if (authError || !auth.user) throw authError ?? new Error('Sessão expirada. Faça login novamente.')
      if (!legalName.trim()) throw new Error('Informe a Razão Social.')
      if (!billingEmail.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(billingEmail.trim())) throw new Error('Informe um e-mail fiscal válido.')

      const documentDigits = documentId.replace(/\D/g, '')
      if (documentDigits && documentDigits.length !== 11 && documentDigits.length !== 14) throw new Error('O CPF deve ter 11 dígitos ou o CNPJ deve ter 14 dígitos.')
      const currentDocumentDigits = (tenant.document_id ?? '').replace(/\D/g, '')
      if (currentDocumentDigits && documentDigits !== currentDocumentDigits) throw new Error('O CNPJ/CPF já homologado é protegido contra alteração.')

      const currentIe = (tenant.state_registration ?? '').trim()
      const nextIe = stateRegistration.trim()
      if (currentIe && nextIe !== currentIe) throw new Error('A Inscrição Estadual já homologada é protegida contra alteração.')

      const attempt = async () => supabase.rpc('upsert_tenant_details', {
        p_legal_name: legalName.trim(),
        p_trade_name: tradeName.trim(),
        p_billing_email: billingEmail.trim(),
        p_document_id: documentDigits || null,
        p_state_registration: nextIe || null,
      })

      let result = await attempt()
      if (result.error?.code === '23505') {
        await new Promise((resolve) => setTimeout(resolve, 150))
        result = await attempt()
      }
      if (result.error) throw result.error
      if (!result.data) throw new Error('A empresa foi salva, mas o registro retornado está indisponível.')

      const next = normalizeTenant(result.data as unknown as Record<string, unknown>)
      setTenant(next)
      setLegalName(next.legal_name)
      setTradeName(next.trade_name)
      setBillingEmail(next.billing_email ?? '')
      setDocumentId(next.document_id ?? '')
      setStateRegistration(next.state_registration ?? '')
      setMessage('Dados da empresa atualizados com sucesso.')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível salvar os dados da empresa.')
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <CompanySkeleton />

  const metrics = tenant?.financial_metrics ?? EMPTY_METRICS
  const documentLocked = Boolean((tenant?.document_id ?? '').trim())
  const ieLocked = Boolean((tenant?.state_registration ?? '').trim())

  return (
    <div className="min-h-full pb-32 font-['Space_Grotesk'] text-white">
      <header className="mb-6 flex items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-[#191921] bg-[#0b0b0f] text-[#1DB854]"><Building2 size={18} /></div>
          <div className="min-w-0"><h1 className="text-xl font-bold tracking-tight">Minha Empresa</h1><p className="mt-1 max-w-2xl text-xs leading-5 text-zinc-500">Gestão centralizada da identidade jurídica, fiscal e de faturamento da operação.</p></div>
        </div>
        <button type="button" onClick={() => router.push('/dashboard/settings')} className="min-h-11 shrink-0 rounded-xl border border-[#191921] bg-[#0b0b0f] px-3 text-xs font-semibold text-zinc-300 transition hover:border-zinc-700 hover:text-white">Voltar</button>
      </header>

      <form onSubmit={handleSave} className="space-y-4">
        <section className="rounded-2xl border border-[#191921] bg-[#0b0b0f] p-4 sm:p-5">
          <SectionHeading eyebrow="Identidade corporativa" title="Dados cadastrais" description="Informações comerciais utilizadas pela operação." />
          <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2">
            <Field label="Razão Social" value={legalName} onChange={setLegalName} placeholder="Razão social" required />
            <Field label="Nome Fantasia" value={tradeName} onChange={setTradeName} placeholder="Nome comercial" />
            <FiscalField label="CNPJ / CPF" value={documentId} locked={documentLocked} placeholder="Informe o documento homologado" onChange={setDocumentId} />
            <FiscalField label="Inscrição Estadual" value={stateRegistration} locked={ieLocked} placeholder="Número ou isento" onChange={setStateRegistration} />
          </div>
          <div className="mt-4"><Field label="E-mail fiscal e de repasses" type="email" value={billingEmail} onChange={setBillingEmail} placeholder="financeiro@empresa.com" required /></div>
        </section>

        <section className="rounded-2xl border border-[#191921] bg-[#0b0b0f] p-4 sm:p-5">
          <SectionHeading eyebrow="Ledger operacional" title="Faturamento & retenções" description="Indicadores consolidados pelas engines financeiras. Somente leitura." />
          <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-3"><Metric label="Faturamento mensal" value={formatCurrency(metrics.monthly_billing_cents ?? 0)} /><Metric label="Impostos retidos" value={formatCurrency(metrics.tax_withheld_cents ?? 0)} /><Metric label="Categoria operacional" value={metrics.current_tier ?? 'Standard'} /></div>
          <div className="mt-4 flex items-start gap-3 rounded-xl border border-[#191921] bg-[#060608] p-3 text-[11px] leading-5 text-zinc-500"><ShieldCheck size={15} className="mt-0.5 shrink-0 text-[#1DB854]" /><p>Os indicadores são somente leitura. Alterações de enquadramento fiscal ou identidade homologada exigem revisão documental e não podem ser realizadas por este painel.</p></div>
        </section>

        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-h-5 text-[11px]" aria-live="polite">{error && <p className="rounded-xl border border-red-900/40 bg-red-950/20 px-3 py-2 text-red-300" role="alert">{error}</p>}{message && !error && <p className="flex items-center gap-1.5 text-[#1DB854]" role="status"><Check size={13} />{message}</p>}</div>
          <button type="submit" disabled={saving || !tenant} className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-[#1DB854] px-5 text-xs font-bold text-black transition hover:brightness-105 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto">{saving ? <><Loader2 size={14} className="animate-spin" />Salvando...</> : <><Check size={14} />Salvar dados da empresa</>}</button>
        </div>
      </form>

      <div className="mt-6 flex flex-col gap-2 text-[10px] text-zinc-600 sm:flex-row sm:items-center sm:justify-between"><span className="inline-flex items-center gap-1.5"><LockKeyhole size={12} />Identificadores fiscais protegidos após homologação</span><span>Última atualização: {formatUpdatedAt(tenant?.updated_at ?? '')}</span><button type="button" onClick={() => void loadCompany()} className="inline-flex min-h-11 items-center gap-1.5 self-start rounded-lg px-2 text-zinc-500 hover:text-white"><RefreshCw size={12} />Atualizar</button></div>
    </div>
  )
}

function SectionHeading({ eyebrow, title, description }: { eyebrow: string; title: string; description: string }) {
  return <div><span className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#1DB854]">{eyebrow}</span><h2 className="mt-1 text-sm font-semibold text-white">{title}</h2><p className="mt-1 text-[11px] text-zinc-500">{description}</p></div>
}

function Field({ label, value, onChange, placeholder, type = 'text', required = false }: { label: string; value: string; onChange: (value: string) => void; placeholder: string; type?: 'text' | 'email'; required?: boolean }) {
  return <label className="block space-y-1.5"><span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">{label}</span><input required={required} type={type} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} className="min-h-11 w-full rounded-xl border border-[#191921] bg-[#060608] px-3 text-xs text-white outline-none transition placeholder:text-zinc-700 focus:border-[#1DB854]/50" /></label>
}

function FiscalField({ label, value, locked, placeholder, onChange }: { label: string; value: string; locked: boolean; placeholder: string; onChange: (value: string) => void }) {
  if (!locked) return <Field label={label} value={value} onChange={onChange} placeholder={placeholder} />
  return <div className="space-y-1.5"><span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">{label}</span><div className="flex min-h-11 items-center justify-between gap-3 rounded-xl border border-[#191921] bg-[#060608] px-3 text-xs text-zinc-500"><span className="truncate font-mono">{maskDocument(value) || 'Homologado'}</span><span className="inline-flex shrink-0 items-center gap-1 text-[9px] uppercase tracking-wider text-zinc-600"><LockKeyhole size={11} />Protegido</span></div></div>
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="rounded-xl border border-[#191921] bg-[#060608] p-4"><span className="block text-[10px] uppercase tracking-wider text-zinc-600">{label}</span><strong className="mt-2 block truncate text-sm font-semibold text-zinc-200">{value}</strong></div>
}

function CompanySkeleton() {
  return <div className="min-h-full space-y-5 pb-32" aria-busy="true" aria-label="Carregando Minha Empresa"><div className="h-10 w-64 animate-pulse rounded-xl bg-[#0b0b0f]" /><div className="rounded-2xl border border-[#191921] bg-[#0b0b0f] p-5"><div className="h-4 w-40 animate-pulse rounded bg-[#191921]" /><div className="mt-5 grid gap-4 md:grid-cols-2"><div className="h-11 animate-pulse rounded-xl bg-[#191921]" /><div className="h-11 animate-pulse rounded-xl bg-[#191921]" /><div className="h-11 animate-pulse rounded-xl bg-[#191921]" /><div className="h-11 animate-pulse rounded-xl bg-[#191921]" /></div></div><div className="rounded-2xl border border-[#191921] bg-[#0b0b0f] p-5"><div className="grid gap-3 sm:grid-cols-3"><div className="h-20 animate-pulse rounded-xl bg-[#191921]" /><div className="h-20 animate-pulse rounded-xl bg-[#191921]" /><div className="h-20 animate-pulse rounded-xl bg-[#191921]" /></div></div></div>
}
