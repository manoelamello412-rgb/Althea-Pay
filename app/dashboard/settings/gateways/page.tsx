'use client'

import { useState } from 'react'
import { Check, Network } from 'lucide-react'

const providers=[['stripe','Stripe'],['asaas','Asaas'],['mercado_pago','Mercado Pago']] as const

export default function GatewaysSettingsPage(){
 const [provider,setProvider]=useState<(typeof providers)[number][0]>('stripe')
 const [priority,setPriority]=useState('1')
 const [active,setActive]=useState(true)
 const [saving,setSaving]=useState(false)
 const [message,setMessage]=useState('')
 function save(e:React.FormEvent){e.preventDefault();setSaving(true);setMessage('');window.setTimeout(()=>{setSaving(false);setMessage('Preferências preparadas. As credenciais reais permanecem protegidas até a conexão do provedor.')},400)}
 return <div className="space-y-5 pb-32 font-['Space_Grotesk'] text-white"><header className="flex items-start gap-3"><span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-[#1DB854]/20 bg-[#0F1A16] text-[#1DB854]"><Network size={17}/></span><div><h1 className="text-xl font-bold">Gateways</h1><p className="text-[11px] text-zinc-500">Provedores, prioridades e configurações de pagamento.</p></div></header><form onSubmit={save} className="space-y-4 rounded-2xl border border-zinc-900 bg-[#0F1A16]/40 p-4"><label className="block space-y-1.5"><span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">Provedor</span><select value={provider} onChange={e=>setProvider(e.target.value as typeof provider)} className="w-full rounded-xl border border-zinc-900 bg-[#060608] p-3 text-xs text-white outline-none">{providers.map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></label><label className="block space-y-1.5"><span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">Prioridade</span><input type="number" min="1" step="1" value={priority} onChange={e=>setPriority(e.target.value)} className="w-full rounded-xl border border-zinc-900 bg-[#060608] p-3 text-xs text-white outline-none"/></label><label className="flex items-center justify-between rounded-xl border border-zinc-900 bg-[#060608] p-3"><span><strong className="block text-xs">Gateway ativo</strong><small className="text-[10px] text-zinc-500">Disponível para a operação quando conectado.</small></span><input type="checkbox" checked={active} onChange={e=>setActive(e.target.checked)} className="h-4 w-4 accent-[#1DB854]"/></label><button disabled={saving} className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#1DB854] py-3 text-xs font-bold text-black disabled:opacity-60">{saving?'Salvando...':message?<><Check size={14}/>Preferências salvas</>:'Salvar Preferências'}</button>{message&&<p className="text-[10px] text-[#1DB854]">{message}</p>}</form></div>
}
