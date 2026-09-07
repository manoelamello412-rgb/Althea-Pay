'use client'

import { useEffect, useState, type FormEvent } from 'react'
import { Building2, Check, Loader2 } from 'lucide-react'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'

export default function EmpresaSettingsPage() {
  const supabase = createSupabaseBrowserClient()
  const [razaoSocial, setRazaoSocial] = useState('')
  const [nomeFantasia, setNomeFantasia] = useState('')
  const [cnpj, setCnpj] = useState('')
  const [inscricaoEstadual, setInscricaoEstadual] = useState('')
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    void (async () => {
      const { data: auth } = await supabase.auth.getUser()
      if (!auth.user || !active) return
      const { data, error: loadError } = await supabase
        .from('merchant_business_profiles')
        .select('legal_name,document_number,operation_metadata')
        .eq('user_id', auth.user.id)
        .maybeSingle()
      if (!active || loadError || !data) return
      setRazaoSocial(String(data.legal_name ?? ''))
      setCnpj(String(data.document_number ?? ''))
      const metadata = (data.operation_metadata ?? {}) as Record<string, unknown>
      setNomeFantasia(typeof metadata.nome_fantasia === 'string' ? metadata.nome_fantasia : '')
      setInscricaoEstadual(typeof metadata.inscricao_estadual === 'string' ? metadata.inscricao_estadual : '')
    })()
    return () => { active = false }
  }, [supabase])

  async function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving(true); setMessage(''); setError('')
    try {
      const { data: auth, error: authError } = await supabase.auth.getUser()
      if (authError || !auth.user) throw authError ?? new Error('Sessão expirada.')
      if (!razaoSocial.trim()) throw new Error('Informe a Razão Social.')
      const result = await supabase.from('merchant_business_profiles').upsert({
        user_id: auth.user.id,
        document_type: 'CNPJ',
        document_number: cnpj.trim(),
        legal_name: razaoSocial.trim(),
        operation_metadata: { nome_fantasia: nomeFantasia.trim(), inscricao_estadual: inscricaoEstadual.trim() },
      }, { onConflict: 'user_id' })
      if (result.error) throw result.error
      setMessage('Dados da empresa salvos com sucesso.')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível salvar os dados da empresa.')
    } finally { setSaving(false) }
  }

  return (
    <div className="space-y-5 pb-32 font-['Space_Grotesk'] text-left text-white">
      <header className="flex items-start gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-[#1DB854]/20 bg-[#0F1A16] text-[#1DB854]"><Building2 size={17} /></span>
        <div><h1 className="text-xl font-bold tracking-tight">Minha Empresa</h1><p className="text-[11px] font-medium text-zinc-500">Gerencie as informações jurídicas e fiscais da sua operação.</p></div>
      </header>
      <form onSubmit={handleSave} className="space-y-4">
        <section className="space-y-4 rounded-2xl border border-zinc-900 bg-[#0F1A16]/40 p-4">
          <span className="block text-[10px] font-bold uppercase tracking-wider text-[#1DB854]">Dados Cadastrais</span>
          <label className="block space-y-1.5"><span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">Razão Social</span><input required value={razaoSocial} onChange={e=>setRazaoSocial(e.target.value)} placeholder="Razão social da empresa" className="w-full rounded-xl border border-zinc-900 bg-[#060608] p-3 text-xs text-white outline-none focus:border-[#1DB854]/40" /></label>
          <label className="block space-y-1.5"><span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">Nome Fantasia</span><input value={nomeFantasia} onChange={e=>setNomeFantasia(e.target.value)} placeholder="Nome comercial" className="w-full rounded-xl border border-zinc-900 bg-[#060608] p-3 text-xs text-white outline-none focus:border-[#1DB854]/40" /></label>
        </section>
        <section className="space-y-4 rounded-2xl border border-zinc-900 bg-[#0F1A16]/40 p-4">
          <span className="block text-[10px] font-bold uppercase tracking-wider text-[#1DB854]">Faturamento & Impostos</span>
          <label className="block space-y-1.5"><span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">CNPJ</span><input inputMode="numeric" value={cnpj} onChange={e=>setCnpj(e.target.value)} placeholder="00.000.000/0001-00" className="w-full rounded-xl border border-zinc-900 bg-[#060608] p-3 text-xs text-white outline-none focus:border-[#1DB854]/40" /></label>
          <label className="block space-y-1.5"><span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">Inscrição Estadual/Municipal</span><input value={inscricaoEstadual} onChange={e=>setInscricaoEstadual(e.target.value)} placeholder="Número ou isento" className="w-full rounded-xl border border-zinc-900 bg-[#060608] p-3 text-xs text-white outline-none focus:border-[#1DB854]/40" /></label>
        </section>
        <button disabled={saving} type="submit" className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#1DB854] py-3 text-xs font-bold text-black transition-all active:scale-[0.98] disabled:opacity-60">{saving?<><Loader2 size={14} className="animate-spin"/>Salvando...</>:message?<><Check size={14}/>Dados Salvos</>:'Salvar Dados da Empresa'}</button>
        {message && <p className="text-center text-[10px] text-[#1DB854]" role="status">{message}</p>}
        {error && <p className="rounded-xl border border-red-900/40 bg-red-950/20 p-3 text-[10px] text-red-400" role="alert">{error}</p>}
      </form>
    </div>
  )
}
