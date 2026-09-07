'use client'

import { ChevronRight, CircleDollarSign, FileText, LogOut, ShieldCheck, UserRound, Building2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import PerfilSettingsPage from '@/app/dashboard/settings/perfil/page'
import EmpresaSettingsPage from '@/app/dashboard/settings/empresa/page'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'

type SubPage = 'menu' | 'perfil' | 'empresa'

const items = [
  ['Minha Empresa', Building2, 'Dados jurídicos, fiscais e cadastrais da operação', 'empresa'],
  ['Financeiro', CircleDollarSign, 'Moeda, taxas e preferências financeiras', 'none'],
  ['Checkout & Domínios', FileText, 'Checkout e domínios da operação', 'none'],
  ['Segurança & Auditoria', ShieldCheck, 'Acesso, segurança e auditoria', 'none'],
] as const

function initials(value: string) { const parts = value.trim().split(/\s+/).filter(Boolean).slice(0, 2); return parts.map((part) => part[0]?.toUpperCase()).join('') || 'U' }

export default function SettingsMobile() {
  const db = useMemo(() => createSupabaseBrowserClient(), [])
  const [currentSubPage, setCurrentSubPage] = useState<SubPage>('menu')
  const [name, setName] = useState(''); const [email, setEmail] = useState(''); const [avatarUrl, setAvatarUrl] = useState(''); const [notice, setNotice] = useState('')

  useEffect(() => { let mounted = true; void db.auth.getUser().then(({ data }) => { if (!mounted || !data.user) return; const metadata = data.user.user_metadata ?? {}; setName(String(metadata.full_name ?? metadata.name ?? '')); setEmail(data.user.email ?? ''); setAvatarUrl(String(metadata.avatar_url ?? metadata.picture ?? '')) }); return () => { mounted = false } }, [db])
  async function logout() { setNotice('Encerrando sessão…'); const { error } = await db.auth.signOut(); if (error) { setNotice(error.message); return }; window.location.assign('/login') }

  if (currentSubPage === 'perfil') return <div className="relative min-h-[500px] space-y-5 pb-32 font-['Space_Grotesk'] text-white"><button type="button" onClick={() => setCurrentSubPage('menu')} className="text-xs font-bold text-zinc-500 hover:text-white">← Voltar</button><PerfilSettingsPage /></div>
  if (currentSubPage === 'empresa') return <div className="relative min-h-[500px] space-y-5 pb-32 font-['Space_Grotesk'] text-white"><button type="button" onClick={() => setCurrentSubPage('menu')} className="text-xs font-bold text-zinc-500 hover:text-white">← Voltar</button><EmpresaSettingsPage /></div>

  return <section className="althea-mobile-settings" aria-label="Configurações mobile"><main className="relative min-h-[500px] space-y-5 pb-32">
    <button type="button" onClick={() => void logout()} className="absolute right-0 top-0 z-50 rounded-xl border border-red-900/40 bg-red-950/40 px-4 py-2 text-xs font-bold text-red-400 transition-all active:scale-95 hover:bg-red-950/60">Sair 🚪</button>
    <header className="pr-24"><h1 className="text-xl font-bold tracking-tight text-white">Configurações</h1><p className="text-xs font-medium text-zinc-500">Gerencie as diretrizes gerais da sua operação</p></header>
    <button type="button" onClick={() => setCurrentSubPage('perfil')} className="flex w-full items-center gap-3 rounded-2xl border border-[#1DB854]/20 bg-[#0F1A16]/40 p-4 text-left transition-all duration-200 active:scale-[0.99] hover:border-[#1DB854]/35"><span className="grid h-14 w-14 shrink-0 place-items-center overflow-hidden rounded-full border border-[#1DB854]/30 bg-[#060608] text-lg font-bold text-[#1DB854]">{avatarUrl?<img src={avatarUrl} alt="Avatar do usuário" className="h-full w-full object-cover" onError={()=>setAvatarUrl('')}/>:initials(name)}</span><span className="min-w-0 flex-1"><strong className="block text-sm font-bold text-white">Meu Perfil</strong><span className="mt-0.5 block truncate text-xs text-zinc-400">{name || 'Usuário'}</span><span className="block truncate text-[10px] text-zinc-600">{email || 'E-mail de acesso'}</span></span><ChevronRight size={20} className="shrink-0 text-zinc-500" /></button>
    <section className="space-y-2 pt-1">{items.map(([label, Icon, desc, target])=><button key={label} type="button" onClick={()=>target==='empresa'?setCurrentSubPage('empresa'):setNotice(`${label}: área pronta para configuração.`)} className="flex w-full items-center justify-between gap-3 rounded-xl border border-zinc-900/60 bg-[#090F11] p-4 text-left transition-all duration-200 active:scale-[0.99] hover:border-zinc-800"><span className="flex min-w-0 items-center gap-3"><span className="amsg-icon"><Icon size={22}/></span><span><strong className="block text-sm font-bold text-zinc-200">{label}</strong><small className="mt-0.5 block text-[11px] text-zinc-500">{desc}</small></span></span><ChevronRight size={20} className="shrink-0 text-zinc-600" /></button>)}</section>
    {notice&&<div className="rounded-xl border border-zinc-900 bg-[#060608] p-3 text-[10px] text-zinc-500" role="status">{notice}</div>}
  </main></section>
}
