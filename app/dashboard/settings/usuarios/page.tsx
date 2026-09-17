'use client'

import Link from 'next/link'
import { ShieldCheck, Users, UsersRound } from 'lucide-react'

export default function UsuariosSettingsPage() {
  return (
    <div className="space-y-5 pb-32 font-['Space_Grotesk'] text-white">
      <header className="flex items-start gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-[#1DB854]/20 bg-[#0F1A16] text-[#1DB854]"><Users size={17}/></span>
        <div><h1 className="text-xl font-bold">Usuários</h1><p className="text-[11px] text-zinc-500">Membros e níveis de acesso persistidos na organização.</p></div>
      </header>

      <section className="rounded-2xl border border-zinc-900 bg-[#0F1A16]/40 p-5">
        <div className="flex items-start gap-3">
          <ShieldCheck className="mt-0.5 shrink-0 text-[#1DB854]" size={18}/>
          <div>
            <h2 className="text-sm font-bold">Gestão segura de equipe</h2>
            <p className="mt-1 text-xs leading-5 text-zinc-500">
              A ALTHEA exibe somente vínculos reais da organização. Convites e alterações de papel não são simulados: enquanto não houver uma operação de backend específica para essas ações, esta tela não apresenta controles que fingem executá-las.
            </p>
          </div>
        </div>
        <Link href="/dashboard/members" className="mt-5 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-[#1DB854] px-4 text-xs font-bold text-black transition hover:brightness-110">
          <UsersRound size={15}/> Ver membros e acessos reais
        </Link>
      </section>

      <div className="rounded-xl border border-zinc-900 bg-[#060608] p-3 text-[10px] leading-relaxed text-zinc-500">
        Para habilitar convites no futuro, use uma operação autenticada de backend que crie/convide o usuário e aplique o papel da organização com auditoria e RLS. Nenhum convite é fabricado no navegador.
      </div>
    </div>
  )
}
