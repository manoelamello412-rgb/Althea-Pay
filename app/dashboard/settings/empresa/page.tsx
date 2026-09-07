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
  const [inscricaoMunicipal, setInscricaoMunicipal] = useState('')
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    void (async () => {
      const { data: auth } = await supabase.auth.getUser()
      if (!auth.user || !active) return
      const { data, error: loadError } = await supabase.from('merchant_business_profiles').select('legal_name,document_number,operation_metadata').eq('user_id', auth.user.id).maybeSingle()
      if (!active || loadError || !data) return
      setRazaoSocial(String(data.legal_name ?? ''))
      setCnpj(String(data.document_number ?? ''))
      const metadata = (data.operation_metadata ?? {}) as Record<string, unknown>
      setNomeFantasia(typeof metadata.nome_fantasia === 'string' ? metadata.nome_fantasia : '')
      setInscricaoEstadual(typeof metadata.inscricao_estadual === 'string' ? metadata.inscricao_estadual : '')
      setInscricaoMunicipal(typeof metadata.inscricao_municipal === 'string' ? metadata.inscricao_municipal : '')
    })()
    return () => { active = false }
  }, [supabase])

  async function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setMessage(''); setError('')
    try {
      const { data: auth, error: authError } = await supabase.auth.getUser()
      if (authError || !auth.user) throw authError ?? new Error('Sessão expirada.')
      if (!razaoSocial.trim()) throw new Error('Informe a Razão Social.')
      const cleanCnpj = cnpj.replace(/\D/g, '')
      if (cleanCnpj && cleanCnpj.length !== 14) throw new Error('Informe um CNPJ com 14 dígitos.')
      const result = await supabase.from('merchant_business_profiles').upsert({
        user_id: auth.user.id,
        document_type: 'CNPJ',
        document_number: cleanCnpj || null,
        legal_name: razaoSocial.trim(),
        operation_metadata: {
          nome_fantasia: nomeFantasia.trim(),
          inscricao_estadual: inscricaoEstadual.trim(),
          inscricao_municipal: inscricaoMunicipal.trim(),
        },
      }, { onConflict: 'user_id' })
      if (result.error) throw result.error
      setMessage('Dados da empresa salvos com sucesso.')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível salvar os dados da empresa.')
    } finally { setSaving(false) }
  }

  return <div className="space-y-5 pb-32 font-['Space_Grotesk'] text-left text-white">
    <header className="flex items-start gap-3 pr-24"><span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-[#1DB854]/20 bg-[#0F1A16] text-[#1DB854]"><Building2 size={17}/></span><div><h1 className="text-xl font-bold tracking-tight">Minha Empresa</h1><p className="text-[11px] font-medium text-zinc-500">Gerencie as informações jurídicas, fiscais e contratuais da sua operação.</p></div></header>
    <form onSubmit={handleSave} className="space-y-4">
      <section className="space-y-4 rounded-2xl border border-zinc-900 bg-[#0F1A16]/40 p-4"><div><span className="block text-[10px] font-bold uppercase tracking-wider text-[#1DB854]">Dados Cadastrais</span><p className="mt-1 text-[10px] text-zinc-500">Identificação jurídica e comercial.</p></div><Field label="Razão Social" value={razaoSocial} onChange={setRazaoSocial} placeholder="Razão social da empresa" required/><Field label="Nome Fantasia" value={nomeFantasia} onChange={setNomeFantasia} placeholder="Nome comercial"/></section>
      <section className="space-y-4 rounded-2xl border border-zinc-900 bg-[#0F1A16]/40 p-4"><div><span className="block text-[10px] font-bold uppercase tracking-wider text-[#1DB854]">Faturamento & Impostos</span><p className="mt-1 text-[10px] text-zinc-500">Identificadores fiscais para a operação.</p></div><Field label="CNPJ" value={cnpj} onChange={setCnpj} placeholder="00.000.000/0001-00" inputMode="numeric"/><Field label="Inscrição Estadual" value={inscricaoEstadual} onChange={setInscricaoEstadual} placeholder="Número ou isento"/><Field label="Inscrição Municipal" value={inscricaoMunicipal} onChange={setInscricaoMunicipal} placeholder="Número ou isento"/></section>
      <button disabled={saving} type="submit" className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#1DB854] py-3 text-xs font-bold text-black transition-all duration-200 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60">{saving?<><Loader2 size={14} className="animate-spin"/>Salvando Dados...</>:message?<><Check size={14}/>Dados Salvos</>:'Salvar Dados da Empresa 🏢'}</button>
      {message && <p className="text-center text-[10px] font-medium text-[#1DB854]" role="status">{message}</p>}{error && <p className="rounded-xl border border-red-900/40 bg-red-950/20 p-3 text-[10px] text-red-300" role="alert">{error}</p>}
    </form>
  </div>
}

function Field({label,value,onChange,placeholder,inputMode,required=false}:{label:string;value:string;onChange:(value:string)=>void;placeholder:string;inputMode?:'numeric';required?:boolean}){return <label className="block space-y-1.5"><span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">{label}</span><input required={required} type="text" inputMode={inputMode} value={value} onChange={e=>onChange(e.target.value)} placeholder={placeholder} className="w-full rounded-xl border border-zinc-900 bg-[#060608] p-3 text-xs text-white outline-none transition focus:border-[#1DB854]/40"/></label>}
