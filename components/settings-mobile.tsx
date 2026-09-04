'use client'

import { ChevronRight, CircleDollarSign, FileText, LogOut, ShieldCheck, UserRound } from 'lucide-react'
import { useMemo, useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'

const items=[['Conta & Equipe',UserRound,'Dados da conta e membros'],['Financeiro',CircleDollarSign,'Moeda, taxas e preferências financeiras'],['Checkout & Domínios',FileText,'Checkout e domínios da operação'],['Segurança & Auditoria',ShieldCheck,'Acesso, segurança e auditoria']] as const
export default function SettingsMobile(){
 const db=useMemo(()=>createSupabaseBrowserClient(),[]);const [active,setActive]=useState('configuracoes');const [notice,setNotice]=useState('')
 const go=(page:string)=>{setActive(page);window.dispatchEvent(new CustomEvent('althea-mobile-page',{detail:page}))}
 async function logout(){if(!db)return;setNotice('Encerrando sessão…');const {error}=await db.auth.signOut();if(error){setNotice(error.message);return}window.location.assign('/login')}
 if(active!=='configuracoes')return null
 return <section className="althea-mobile-settings" aria-label="Configurações mobile"><header className="amsg-header"><img src="/althea-logo.png" alt="Althea Pay"/><button type="button" aria-label="Mais opções">⋮</button></header><main className="amsg-content"><h1>Configurações</h1><p>Ajustes da conta</p><section className="amsg-list">{items.map(([label,Icon,desc])=><button key={label} type="button" onClick={()=>setNotice(`${label}: área pronta para configuração.`)}><span className="amsg-icon"><Icon size={22}/></span><span><strong>{label}</strong><small>{desc}</small></span><ChevronRight size={20}/></button>)}<button type="button" className="amsg-logout" onClick={()=>void logout()}><span className="amsg-icon"><LogOut size={22}/></span><strong>Sair da Conta</strong><ChevronRight size={20}/></button></section>{notice&&<div className="amsg-notice" role="status">{notice}</div>}</main><nav className="amsg-bottom-nav">{[['dashboard','Dashboard'],['vendas','Vendas'],['funis','Funis/Chat'],['gateways','Gateways'],['configuracoes','Config']].map(([k,l])=><button key={k} type="button" className={active===k?'active':''} onClick={()=>go(k)}><span>{k==='dashboard'?'⌂':k==='vendas'?'▥':k==='funis'?'▢':k==='gateways'?'◇':'⚙'}</span><small>{l}</small></button>)}</nav></section>
}
