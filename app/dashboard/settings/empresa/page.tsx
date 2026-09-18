'use client'

import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { Building2, Check, LockKeyhole, Loader2, RefreshCw, ShieldCheck } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'

type FinancialMetrics = { monthly_billing_cents?: number; tax_withheld_cents?: number; current_tier?: string }
type OperationMetadata = { trade_name?: string; billing_email?: string; state_registration?: string; financial_metrics?: FinancialMetrics }
type BusinessProfile = {
  user_id: string
  document_type: 'CPF' | 'CNPJ'
  document_number: string | null
  legal_name: string | null
  operation_metadata: OperationMetadata
  updated_at: string
}

const EMPTY_METRICS: FinancialMetrics = {}
const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
function metadata(value: unknown): OperationMetadata {
  const raw = object(value)
  const fm = object(raw.financial_metrics)
  return {
    trade_name: typeof raw.trade_name === 'string' ? raw.trade_name : undefined,
    billing_email: typeof raw.billing_email === 'string' ? raw.billing_email : undefined,
    state_registration: typeof raw.state_registration === 'string' ? raw.state_registration : undefined,
    financial_metrics: {
      monthly_billing_cents: typeof fm.monthly_billing_cents === 'number' ? fm.monthly_billing_cents : undefined,
      tax_withheld_cents: typeof fm.tax_withheld_cents === 'number' ? fm.tax_withheld_cents : undefined,
      current_tier: typeof fm.current_tier === 'string' ? fm.current_tier : undefined,
    },
  }
}
function normalizeProfile(row: Record<string, unknown>): BusinessProfile {
  return {
    user_id: String(row.user_id ?? ''),
    document_type: row.document_type === 'CPF' ? 'CPF' : 'CNPJ',
    document_number: typeof row.document_number === 'string' ? row.document_number : null,
    legal_name: typeof row.legal_name === 'string' ? row.legal_name : null,
    operation_metadata: metadata(row.operation_metadata),
    updated_at: String(row.updated_at ?? ''),
  }
}
function formatCurrency(cents: number | undefined) { return typeof cents === 'number' && Number.isFinite(cents) ? new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100) : '—' }
function maskDocument(value: string | null) { const digits = (value ?? '').replace(/\D/g, ''); if (!digits) return ''; if (digits.length === 14) return `***.***.***/${digits.slice(-6, -2)}-${digits.slice(-2)}`; if (digits.length === 11) return `***.***.***-${digits.slice(-2)}`; return `•••• ${digits.slice(-4)}` }
function formatUpdatedAt(value: string) { if (!value) return 'Ainda não sincronizado'; const date = new Date(value); return Number.isNaN(date.getTime()) ? 'Data indisponível' : new Intl.DateTimeFormat('pt-BR', { dateStyle: 'medium', timeStyle: 'short' }).format(date) }

export default function EmpresaSettingsPage() {
  const supabase = useMemo(() => createSupabaseBrowserClient(), [])
  const router = useRouter()
  const [profile, setProfile] = useState<BusinessProfile | null>(null)
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
    setLoading(true); setError('')
    try {
      const { data: auth, error: authError } = await supabase.auth.getUser()
      if (authError || !auth.user) { router.replace('/login'); return }
      const { data, error: queryError } = await supabase
        .from('merchant_business_profiles')
        .select('user_id,document_type,document_number,legal_name,operation_metadata,updated_at')
        .eq('user_id', auth.user.id)
        .maybeSingle()
      if (queryError) throw queryError
      if (signal?.aborted) return
      if (!data) {
        setProfile(null)
        setLegalName('')
        setTradeName('')
        setBillingEmail(auth.user.email ?? '')
        setDocumentId('')
        setStateRegistration('')
        return
      }
      const next = normalizeProfile(data as Record<string, unknown>)
      setProfile(next)
      setLegalName(next.legal_name ?? '')
      setTradeName(next.operation_metadata.trade_name ?? '')
      setBillingEmail(next.operation_metadata.billing_email ?? auth.user.email ?? '')
      setDocumentId(next.document_number ?? '')
      setStateRegistration(next.operation_metadata.state_registration ?? '')
    } catch (cause) {
      if (!signal?.aborted) setError(cause instanceof Error ? cause.message : 'Não foi possível carregar os dados da empresa.')
    } finally { if (!signal?.aborted) setLoading(false) }
  }, [router, supabase])

  useEffect(() => { const controller = new AbortController(); void loadCompany(controller.signal); return () => controller.abort() }, [loadCompany])

  async function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (saving) return
    setSaving(true); setError(''); setMessage('')
    try {
      const { data: auth, error: authError } = await supabase.auth.getUser()
      if (authError || !auth.user) throw authError ?? new Error('Sessão expirada. Faça login novamente.')
      if (!legalName.trim()) throw new Error('Informe a Razão Social.')
      if (!billingEmail.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(billingEmail.trim())) throw new Error('Informe um e-mail fiscal válido.')
      const documentDigits = documentId.replace(/\D/g, '')
      if (![11, 14].includes(documentDigits.length)) throw new Error('Informe um CPF com 11 dígitos ou CNPJ com 14 dígitos.')
      const currentDocument = (profile?.document_number ?? '').replace(/\D/g, '')
      if (currentDocument && currentDocument !== documentDigits) throw new Error('O CPF/CNPJ já homologado é protegido contra alteração.')
      const currentIe = profile?.operation_metadata.state_registration?.trim() ?? ''
      const nextIe = stateRegistration.trim()
      if (currentIe && currentIe !== nextIe) throw new Error('A Inscrição Estadual já homologada é protegida contra alteração.')

      const operationMetadata: OperationMetadata = {
        ...(profile?.operation_metadata ?? {}),
        trade_name: tradeName.trim() || undefined,
        billing_email: billingEmail.trim(),
        state_registration: nextIe || undefined,
        financial_metrics: profile?.operation_metadata.financial_metrics ?? EMPTY_METRICS,
      }
      const payload = {
        user_id: auth.user.id,
        document_type: documentDigits.length === 14 ? 'CNPJ' : 'CPF',
        document_number: documentDigits,
        legal_name: legalName.trim(),
        operation_metadata: operationMetadata,
        updated_at: new Date().toISOString(),
      }
      const { data, error: saveError } = await supabase
        .from('merchant_business_profiles')
        .upsert(payload, { onConflict: 'user_id' })
        .select('user_id,document_type,document_number,legal_name,operation_metadata,updated_at')
        .single()
      if (saveError) throw saveError
      const next = normalizeProfile(data as Record<string, unknown>)
      setProfile(next)
      setLegalName(next.legal_name ?? '')
      setTradeName(next.operation_metadata.trade_name ?? '')
      setBillingEmail(next.operation_metadata.billing_email ?? '')
      setDocumentId(next.document_number ?? '')
      setStateRegistration(next.operation_metadata.state_registration ?? '')
      setMessage('Dados da empresa atualizados com sucesso.')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível salvar os dados da empresa.')
    } finally { setSaving(false) }
  }

  if (loading) return <div className="min-h-64 animate-pulse rounded-2xl border border-white/[.055] bg-[var(--althea-surface)]" />

  const metrics = profile?.operation_metadata.financial_metrics ?? EMPTY_METRICS
  const documentLocked = Boolean((profile?.document_number ?? '').trim())
  const ieLocked = Boolean((profile?.operation_metadata.state_registration ?? '').trim())

  return <div className="w-full space-y-5 text-white">
    <section className="flex flex-col gap-5 border-b border-white/[.055] pb-5 lg:flex-row lg:items-end lg:justify-between">
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-[.2em] text-[var(--althea-brand)]">Organização</p>
        <h1 className="mt-2 text-[30px] font-semibold tracking-[-.04em] text-white sm:text-[34px]">Minha empresa</h1>
        <p className="mt-1 max-w-2xl text-xs leading-5 text-[var(--althea-muted)]">Identidade jurídica, fiscal e operacional usando o cadastro comercial canônico.</p>
      </div>
      <button type="button" onClick={() => router.push('/dashboard/settings')} className="inline-flex h-10 items-center self-start rounded-xl border border-white/[.06] bg-[var(--althea-surface)] px-4 text-[10px] font-semibold text-[var(--althea-muted)] transition hover:text-white lg:self-auto">Configurações</button>
    </section>
    <form onSubmit={handleSave} className="space-y-4">
      <section className="rounded-2xl border border-white/[.055] bg-[var(--althea-surface)] p-4 sm:p-5"><SectionHeading eyebrow="Identidade corporativa" title="Dados cadastrais" description="Informações comerciais utilizadas pela operação." /><div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2"><Field label="Razão Social" value={legalName} onChange={setLegalName} placeholder="Razão social" required /><Field label="Nome Fantasia" value={tradeName} onChange={setTradeName} placeholder="Nome comercial" /><FiscalField label="CNPJ / CPF" value={documentId} locked={documentLocked} placeholder="CPF ou CNPJ" onChange={setDocumentId} /><FiscalField label="Inscrição Estadual" value={stateRegistration} locked={ieLocked} placeholder="Número ou isento" onChange={setStateRegistration} /></div><div className="mt-4"><Field label="E-mail fiscal e de repasses" type="email" value={billingEmail} onChange={setBillingEmail} placeholder="financeiro@empresa.com" required /></div></section>
      <section className="rounded-2xl border border-white/[.055] bg-[var(--althea-surface)] p-4 sm:p-5"><SectionHeading eyebrow="Ledger operacional" title="Faturamento & retenções" description="Indicadores de leitura preservados no perfil operacional." /><div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-3"><Metric label="Faturamento mensal" value={formatCurrency(metrics.monthly_billing_cents)} /><Metric label="Impostos retidos" value={formatCurrency(metrics.tax_withheld_cents)} /><Metric label="Categoria operacional" value={metrics.current_tier ?? '—'} /></div><div className="mt-4 flex items-start gap-3 rounded-xl border border-white/[.045] bg-[var(--althea-bg)] p-3 text-[11px] leading-5 text-zinc-500"><ShieldCheck size={15} className="mt-0.5 shrink-0 text-[var(--althea-brand)]" /><p>Identificadores fiscais ficam protegidos após o primeiro cadastro. Alterações homologadas devem passar por fluxo administrativo específico.</p></div></section>
      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between"><div className="min-h-5 text-[11px]" aria-live="polite">{error && <p className="rounded-xl border border-red-900/40 bg-red-950/20 px-3 py-2 text-red-300" role="alert">{error}</p>}{message && !error && <p className="flex items-center gap-1.5 text-[var(--althea-brand)]" role="status"><Check size={13} />{message}</p>}</div><button type="submit" disabled={saving} className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-[var(--althea-brand)] px-5 text-xs font-bold text-black disabled:opacity-60 sm:w-auto">{saving ? <><Loader2 size={14} className="animate-spin" />Salvando...</> : <><Check size={14} />Salvar dados da empresa</>}</button></div>
    </form>
    <div className="mt-6 flex flex-col gap-2 text-[10px] text-zinc-600 sm:flex-row sm:items-center sm:justify-between"><span className="inline-flex items-center gap-1.5"><LockKeyhole size={12} />Identificadores fiscais protegidos após homologação</span><span>Última atualização: {formatUpdatedAt(profile?.updated_at ?? '')}</span><button type="button" onClick={() => void loadCompany()} className="inline-flex min-h-11 items-center gap-1.5 self-start rounded-lg px-2 text-zinc-500 hover:text-white"><RefreshCw size={12} />Atualizar</button></div>
  </div>
}

function SectionHeading({ eyebrow, title, description }: { eyebrow: string; title: string; description: string }) { return <div><span className="text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--althea-brand)]">{eyebrow}</span><h2 className="mt-1 text-sm font-semibold text-white">{title}</h2><p className="mt-1 text-[11px] text-zinc-500">{description}</p></div> }
function Field({ label, value, onChange, placeholder, type = 'text', required = false }: { label: string; value: string; onChange: (value: string) => void; placeholder: string; type?: 'text' | 'email'; required?: boolean }) { return <label className="block space-y-1.5"><span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">{label}</span><input required={required} type={type} value={value} onChange={event => onChange(event.target.value)} placeholder={placeholder} className="min-h-11 w-full rounded-xl border border-white/[.045] bg-[var(--althea-bg)] px-3 text-xs text-white outline-none placeholder:text-zinc-700 focus:border-[#1DB854]/50" /></label> }
function FiscalField({ label, value, locked, placeholder, onChange }: { label: string; value: string; locked: boolean; placeholder: string; onChange: (value: string) => void }) { if (!locked) return <Field label={label} value={value} onChange={onChange} placeholder={placeholder} />; return <div className="space-y-1.5"><span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">{label}</span><div className="flex min-h-11 items-center justify-between gap-3 rounded-xl border border-white/[.045] bg-[var(--althea-bg)] px-3 text-xs text-zinc-500"><span className="truncate font-mono">{maskDocument(value) || 'Homologado'}</span><span className="inline-flex shrink-0 items-center gap-1 text-[9px] uppercase tracking-wider text-zinc-600"><LockKeyhole size={11} />Protegido</span></div></div> }
function Metric({ label, value }: { label: string; value: string }) { return <div className="rounded-xl border border-white/[.045] bg-[var(--althea-bg)] p-3"><span className="text-[9px] font-bold uppercase tracking-wider text-zinc-600">{label}</span><strong className="mt-2 block text-sm text-zinc-200">{value}</strong></div> }
