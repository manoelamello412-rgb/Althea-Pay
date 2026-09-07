'use client'

import { useState } from 'react'
import { Check, Globe2 } from 'lucide-react'

export default function FunilDominioSettingsPage(){
 const [domain,setDomain]=useState('')
 const [funnel,setFunnel]=useState('')
 const [saving,setSaving]=useState(false)
 const [message,setMessage]=useState('')
 function save(e:React.FormEvent){e.preventDefault();setSaving(true);setMessage('');window.setTimeout(()=>{setSaving(false);setMessage('Configuração preparada. O domínio só será publicado após uma integração DNS real.')},400)}
 return <div className="space-y-5 pb-32 font-['Space_Grotesk'] text-white"><header className="flex items-start gap-3"><span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-[#1DB854]/20 bg-[#0F1A16] text-[#1DB854]"><Globe2 size={17}/></span><div><h1 className="text-xl font-bold">Funil e Domínio</h1><p className="text-[11px] text-zinc-500">URLs, domínios e infraestrutura dos funis.</p></div></header><form onSubmit={save} className="space-y-4 rounded-2xl border border-zinc-900 bg-[#0F1A16]/40 p-4"><label className="block space-y-1.5"><span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">Funil</span><input required value={funnel} onChange={e=>setFunnel(e.target.value)} placeholder="Nome do funil" className="w-full rounded-xl border border-zinc-900 bg-[#060608] p-3 text-xs text-white outline-none focus:border-[#1DB854]/40"/></label><label className="block space-y-1.5"><span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">Domínio</span><input required value={domain} onChange={e=>setDomain(e.target.value)} placeholder="checkout.seudominio.com.br" className="w-full rounded-xl border border-zinc-900 bg-[#060608] p-3 text-xs text-white outline-none focus:border-[#1DB854]/40"/></label><button disabled={saving} className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#1DB854] py-3 text-xs font-bold text-black disabled:opacity-60">{saving?'Salvando...':message?<><Check size={14}/>Configuração salva</>:'Salvar Configuração'}</button>{message&&<p className="text-[10px] text-[#1DB854]">{message}</p>}</form></div>
}
