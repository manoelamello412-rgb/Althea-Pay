'use client'

import { useState } from 'react'
import { Check, UserPlus, Users } from 'lucide-react'

export default function UsuariosSettingsPage() {
  const [email, setEmail] = useState('')
  const [role, setRole] = useState('operador')
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')

  function invite(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving(true)
    setMessage('')
    window.setTimeout(() => {
      setSaving(false)
      setMessage('Convite preparado. O envio real será ativado quando o módulo de equipe estiver conectado.')
      setEmail('')
    }, 400)
  }

  return <div className="space-y-5 pb-32 font-['Space_Grotesk'] text-white">
    <header className="flex items-start gap-3"><span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-[#1DB854]/20 bg-[#0F1A16] text-[#1DB854]"><Users size={17}/></span><div><h1 className="text-xl font-bold">Usuários</h1><p className="text-[11px] text-zinc-500">Controle de equipe, convites e níveis de acesso.</p></div></header>
    <section className="rounded-2xl border border-zinc-900 bg-[#0F1A16]/40 p-4"><div className="mb-4"><span className="text-[10px] font-bold uppercase tracking-wider text-[#1DB854]">Adicionar usuário</span></div><form onSubmit={invite} className="space-y-3"><input required type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="E-mail do usuário" className="w-full rounded-xl border border-zinc-900 bg-[#060608] p-3 text-xs text-white outline-none focus:border-[#1DB854]/40"/><select value={role} onChange={e=>setRole(e.target.value)} className="w-full rounded-xl border border-zinc-900 bg-[#060608] p-3 text-xs text-white outline-none"><option value="administrador">Administrador</option><option value="operador">Operador</option><option value="leitura">Somente leitura</option></select><button disabled={saving} className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#1DB854] py-3 text-xs font-bold text-black disabled:opacity-60">{saving?'Preparando convite...':message?<><Check size={14}/>Convite preparado</>:<><UserPlus size={14}/>Adicionar usuário</>}</button></form>{message&&<p className="mt-3 text-[10px] text-[#1DB854]">{message}</p>}</section>
    <div className="rounded-xl border border-zinc-900 bg-[#060608] p-3 text-[10px] leading-relaxed text-zinc-500">Nenhum membro é inventado. Quando a equipe estiver cadastrada, esta área exibirá os usuários reais e suas permissões.</div>
  </div>
}
