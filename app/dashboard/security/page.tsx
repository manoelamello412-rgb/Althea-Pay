'use client'

import { useEffect, useMemo, useState } from 'react'
import { CheckCircle2, KeyRound, LockKeyhole, ShieldCheck, Smartphone } from 'lucide-react'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'

type Factor = { id: string; name: string; status: string }

export default function SecurityPage() {
  const supabase = useMemo(() => createSupabaseBrowserClient(), [])
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [factors, setFactors] = useState<Factor[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    async function load() {
      const { data, error } = await supabase.auth.getUser()
      if (error || !data.user) { router.replace('/login'); return }
      const result = await supabase.auth.mfa.listFactors()
      if (cancelled) return
      setEmail(data.user.email ?? '')
      if (!result.error) setFactors((result.data.totp ?? []).map(factor => ({ id: factor.id, name: factor.friendly_name ?? 'Authenticator TOTP', status: factor.status })))
      setLoading(false)
    }
    void load()
    return () => { cancelled = true }
  }, [router, supabase])

  if (loading) return <main className="min-h-screen bg-[#070A09] px-4 py-8 text-slate-100"><div className="mx-auto max-w-5xl text-sm text-slate-500">Verificando segurança da sessão…</div></main>

  const verified = factors.some(factor => factor.status === 'verified')

  return <main className="min-h-screen bg-[#070A09] px-4 py-6 text-slate-100 lg:px-8">
    <div className="mx-auto max-w-[1200px]">
      <header className="mb-8"><div className="mb-2 flex items-center gap-2 text-[10px] font-black uppercase tracking-[.28em] text-emerald-400"><ShieldCheck size={14} /> ALTHEA PAY // SEGURANÇA</div><h1 className="text-3xl font-black tracking-tight">Segurança da conta</h1><p className="mt-2 text-sm text-slate-500">Visão operacional da autenticação. A gestão completa de senha e MFA permanece centralizada em Configurações.</p></header>
      <section className="grid gap-4 md:grid-cols-3"><article className="rounded-2xl border border-white/10 bg-white/[.025] p-5"><LockKeyhole size={19} className="mb-5 text-emerald-400" /><span className="text-[10px] uppercase tracking-widest text-slate-600">Sessão</span><b className="mt-2 block text-sm">Autenticada</b><p className="mt-1 truncate text-xs text-slate-500">{email || 'Conta autenticada'}</p></article><article className="rounded-2xl border border-white/10 bg-white/[.025] p-5"><Smartphone size={19} className="mb-5 text-emerald-400" /><span className="text-[10px] uppercase tracking-widest text-slate-600">MFA TOTP</span><b className="mt-2 block text-sm">{verified ? 'Ativo e verificado' : 'Não configurado'}</b><p className="mt-1 text-xs text-slate-500">{factors.length} fator(es) cadastrado(s).</p></article><article className="rounded-2xl border border-white/10 bg-white/[.025] p-5"><KeyRound size={19} className="mb-5 text-emerald-400" /><span className="text-[10px] uppercase tracking-widest text-slate-600">Credenciais</span><b className="mt-2 block text-sm">Protegidas pelo Auth</b><p className="mt-1 text-xs text-slate-500">Nenhuma senha é exibida ou armazenada nesta interface.</p></article></section>
      <section className="mt-5 rounded-2xl border border-white/10 bg-white/[.02] p-5"><div className="mb-5 flex items-center gap-2"><CheckCircle2 size={17} className={verified ? 'text-emerald-400' : 'text-slate-600'} /><h2 className="font-bold">Fatores de autenticação</h2></div>{factors.length ? <div className="space-y-2">{factors.map(factor => <div key={factor.id} className="flex items-center justify-between rounded-xl border border-white/[.06] px-4 py-3"><span className="text-sm">{factor.name}</span><span className="text-xs uppercase tracking-wider text-emerald-400">{factor.status}</span></div>)}</div> : <p className="text-sm text-slate-500">Nenhum fator TOTP está cadastrado. Ative MFA em Configurações → Segurança.</p>}</section>
      <a href="/dashboard/settings" className="mt-5 inline-flex rounded-xl border border-white/10 bg-white/[.03] px-4 py-3 text-sm font-semibold transition hover:bg-white/[.06]">Abrir Configurações de Segurança</a>
    </div>
  </main>
}
