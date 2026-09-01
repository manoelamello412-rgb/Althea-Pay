'use client'

import { FormEvent, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ALTHEA_PAY } from '@/lib/althea'
import { BrandKit, hydrateAltheaBrand } from '@/components/brand-kit'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'

type Row = { id: string; data?: Record<string, unknown>; created_at?: string; [key: string]: unknown }
type Module = 'Visão geral' | 'Funis' | 'Produtos' | 'Gateways' | 'Vendas' | 'Clientes' | 'Chats' | 'Analytics' | 'Integrações' | 'Configurações'
const nav: Module[] = ['Visão geral','Funis','Produtos','Gateways','Vendas','Clientes','Chats','Analytics','Integrações','Configurações']
const tableMap: Partial<Record<Module,string>> = { Produtos:'products', Gateways:'gateways', Vendas:'sales', Clientes:'clients', Chats:'chats' }
const labels: Record<string,string> = { products:'Produtos', gateways:'Gateways', sales:'Vendas', clients:'Clientes', chats:'Chats' }

export default function DashboardPage() {
  const router = useRouter()
  const [active,setActive]=useState<Module>('Visão geral')
  const [userId,setUserId]=useState('')
  const [email,setEmail]=useState('')
  const [fullName,setFullName]=useState('')
  const [rows,setRows]=useState<Row[]>([])
  const [funnels,setFunnels]=useState<Row[]>([])
  const [counts,setCounts]=useState<Record<string,number>>({})
  const [json,setJson]=useState('{\n  "nome": "",\n  "descricao": ""\n}')
  const [funnelName,setFunnelName]=useState('')
  const [funnelUrl,setFunnelUrl]=useState('')
  const [funnelStatus,setFunnelStatus]=useState('draft')
  const [saving,setSaving]=useState(false)
  const [loading,setLoading]=useState(true)
  const [message,setMessage]=useState('')
  const [error,setError]=useState('')
  const supabase=useMemo(()=>createSupabaseBrowserClient(),[])

  useEffect(()=>{ hydrateAltheaBrand() },[])

  async function loadAll() {
    if (!supabase) { setError('Supabase não configurado.'); setLoading(false); return }
    setLoading(true); setError('')
    const {data:{user}}=await supabase.auth.getUser()
    if (!user) { router.replace('/login'); return }
    setUserId(user.id); setEmail(user.email || '')
    const profile=await supabase.from('profiles').select('full_name').eq('id',user.id).maybeSingle()
    setFullName(profile.data?.full_name || user.user_metadata?.full_name || '')
    const [f,p,g,s,c,ch]=await Promise.all([
      supabase.from('funnels').select('id,nome,url,status,created_at,last_communication').order('created_at',{ascending:false}),
      supabase.from('products').select('id,data,created_at').order('created_at',{ascending:false}),
      supabase.from('gateways').select('id,data,created_at').order('created_at',{ascending:false}),
      supabase.from('sales').select('id,data,created_at').order('created_at',{ascending:false}),
      supabase.from('clients').select('id,data,created_at').order('created_at',{ascending:false}),
      supabase.from('chats').select('id,data,created_at').order('created_at',{ascending:false}),
    ])
    const first=[f,p,g,s,c,ch].find(x=>x.error)
    if(first?.error) setError(first.error.message)
    setFunnels((f.data||[]) as Row[])
    setCounts({ funnels:f.data?.length||0, products:p.data?.length||0, gateways:g.data?.length||0, sales:s.data?.length||0, clients:c.data?.length||0, chats:ch.data?.length||0 })
    const activeTable=tableMap[active]
    if(activeTable) setRows((({products:p,gateways:g,sales:s,clients:c,chats:ch} as Record<string,any>)[activeTable]?.data||[]) as Row[])
    setLoading(false)
  }

  useEffect(()=>{ loadAll() },[active])

  async function createFunnel(e:FormEvent){
    e.preventDefault(); if(!supabase||!userId) return
    setSaving(true); setError(''); setMessage('')
    const {error}=await supabase.from('funnels').insert({id:`ANT-${Date.now()}`,nome:funnelName,url:funnelUrl||null,status:funnelStatus,user_id:userId})
    if(error) setError(error.message); else { setMessage('Funil criado com sucesso.'); setFunnelName(''); setFunnelUrl(''); await loadAll() }
    setSaving(false)
  }

  async function createGeneric(e:FormEvent){
    e.preventDefault(); if(!supabase||!userId||!tableMap[active]) return
    setSaving(true); setError(''); setMessage('')
    let data:Record<string,unknown>
    try { data=JSON.parse(json) } catch { setError('O JSON informado é inválido.'); setSaving(false); return }
    const table=tableMap[active]!
    const {error}=await supabase.from(table).insert({id:`${table.slice(0,3).toUpperCase()}-${Date.now()}`,data,user_id:userId})
    if(error) setError(error.message); else { setMessage(`${labels[table]} criado com sucesso.`); setJson('{\n  "nome": "",\n  "descricao": ""\n}'); await loadAll() }
    setSaving(false)
  }

  async function deleteRow(table:string,id:string){
    if(!supabase) return
    if(!confirm('Excluir este registro?')) return
    const {error}=await supabase.from(table).delete().eq('id',id)
    if(error) setError(error.message); else { setMessage('Registro excluído.'); await loadAll() }
  }

  async function saveProfile(e:FormEvent){
    e.preventDefault(); if(!supabase||!userId) return
    setSaving(true); const {error}=await supabase.from('profiles').update({full_name:fullName,updated_at:new Date().toISOString()}).eq('id',userId)
    if(error) setError(error.message); else setMessage('Configurações salvas.'); setSaving(false)
  }

  async function logout(){ if(!supabase) return; await supabase.auth.signOut(); router.replace('/login'); router.refresh() }

  const descriptions:Record<Module,string>={
    'Visão geral':'Seu centro de controle operacional, conectado ao Supabase.',
    'Funis':'Crie, acompanhe e remova seus funis conectados.',
    'Produtos':'Gerencie os produtos associados à sua operação.',
    'Gateways':'Cadastre e acompanhe configurações de gateways.',
    'Vendas':'Visualize e gerencie registros de vendas.',
    'Clientes':'Centralize os registros dos seus clientes.',
    'Chats':'Acompanhe os registros de atendimento e conversas.',
    'Analytics':'Indicadores calculados diretamente dos dados disponíveis.',
    'Integrações':'Base de integrações pronta para endpoints e webhooks.',
    'Configurações':'Perfil, conta e identidade visual da Althea Pay.'
  }

  return <main className="althea-app">
    <aside className="althea-sidebar"><div className="althea-brand">{ALTHEA_PAY.name}<span>{ALTHEA_PAY.tagline}</span></div><nav className="althea-nav">{nav.map(item=><button key={item} className={active===item?'active':''} onClick={()=>{setActive(item);setMessage('');setError('')}}>{item}</button>)}</nav><button className="auth-switch sidebar-logout" onClick={logout}>Sair da conta</button></aside>
    <section className="althea-main">
      <header className="althea-header"><div><div className="althea-kicker">{ALTHEA_PAY.tagline}</div><h1>{active}</h1><p>{descriptions[active]}</p></div><div className="althea-status">● {loading?'Sincronizando':'Conta protegida'}</div></header>
      {error&&<div className="auth-error" role="alert">{error}</div>}{message&&<div className="auth-message" role="status">{message}</div>}
      <div className="althea-metrics">{[['Funis','funnels'],['Produtos','products'],['Gateways','gateways'],['Vendas','sales'],['Clientes','clients'],['Chats','chats']].map(([label,key])=><article className="althea-card" key={key}><span>{label}</span><strong>{loading?'—':counts[key]||0}</strong><small>Dados da conta autenticada</small></article>)}</div>
      {active==='Visão geral'&&<><section className="althea-card althea-panel"><div className="panel-heading"><div><span>OPERAÇÃO</span><h2>Funis conectados</h2></div><button className="primary" onClick={()=>setActive('Funis')}>+ Novo funil</button></div>{funnels.length===0?<div className="empty-state"><strong>Nenhum funil disponível</strong><p>Crie o primeiro funil para sua conta. O RLS impede acesso a dados de outros usuários.</p></div>:funnels.map(f=><div className="funnel-row" key={f.id}><div><strong>{String(f.nome)}</strong><small>{String(f.url||'Sem URL')}</small></div><span className="althea-pill">{String(f.status||'draft')}</span></div>)}</section><section className="althea-card althea-panel"><div className="panel-heading"><div><span>RESUMO</span><h2>Saúde da operação</h2></div></div><div className="empty-state"><strong>Autenticação e banco ativos</strong><p>Você está operando dentro do seu espaço protegido. Os módulos abaixo gravam registros usando o usuário autenticado.</p></div></section></>}
      {active==='Funis'&&<><section className="althea-card althea-panel"><div className="panel-heading"><div><span>NOVO FUNIL</span><h2>Conectar funil</h2></div></div><form className="auth-form" onSubmit={createFunnel}><label>Nome<input value={funnelName} onChange={e=>setFunnelName(e.target.value)} required placeholder="Meu funil"/></label><label>URL<input type="url" value={funnelUrl} onChange={e=>setFunnelUrl(e.target.value)} placeholder="https://..."/></label><label>Status<select value={funnelStatus} onChange={e=>setFunnelStatus(e.target.value)}><option value="draft">Rascunho</option><option value="active">Ativo</option><option value="paused">Pausado</option><option value="archived">Arquivado</option></select></label><button className="primary" disabled={saving}>{saving?'Salvando...':'Criar funil'}</button></form></section><List table="funnels" rows={funnels} onDelete={deleteRow}/></>}
      {tableMap[active]&&<section className="althea-card althea-panel"><div className="panel-heading"><div><span>REGISTROS</span><h2>{labels[tableMap[active]!]}</h2></div></div><form className="auth-form" onSubmit={createGeneric}><label>Dados do registro (JSON)<textarea value={json} onChange={e=>setJson(e.target.value)} rows={8}/></label><button className="primary" disabled={saving}>{saving?'Salvando...':`Criar ${labels[tableMap[active]!]}`}</button></form><List table={tableMap[active]!} rows={rows} onDelete={deleteRow}/></section>}
      {active==='Analytics'&&<section className="althea-card althea-panel"><div className="panel-heading"><div><span>ANALYTICS</span><h2>Indicadores</h2></div></div><div className="analytics-grid">{Object.entries(counts).map(([k,v])=><article className="althea-card" key={k}><span>{k}</span><strong>{v}</strong><small>Contagem atual</small></article>)}</div></section>}
      {active==='Integrações'&&<section className="althea-card althea-panel"><div className="panel-heading"><div><span>INTEGRAÇÕES</span><h2>Conectividade</h2></div></div><div className="empty-state"><strong>Arquitetura pronta</strong><p>O projeto já possui Supabase e Edge Functions. Credenciais secretas devem permanecer no servidor.</p></div></section>}
      {active==='Configurações'&&<><section className="althea-card althea-panel"><div className="panel-heading"><div><span>PERFIL</span><h2>Configurações da conta</h2></div></div><form className="auth-form" onSubmit={saveProfile}><label>E-mail<input value={email} disabled/></label><label>Nome<input value={fullName} onChange={e=>setFullName(e.target.value)} placeholder="Seu nome"/></label><button className="primary" disabled={saving}>{saving?'Salvando...':'Salvar configurações'}</button></form></section><BrandKit/></>}
    </section>
  </main>
}

function List({table,rows,onDelete}:{table:string;rows:Row[];onDelete:(table:string,id:string)=>void}){ if(!rows.length) return <div className="empty-state"><strong>Nenhum registro</strong><p>Crie um registro acima para começar.</p></div>; return <div className="records">{rows.map(row=><article className="record" key={row.id}><div><strong>{row.id}</strong><small>{row.created_at?new Date(row.created_at).toLocaleString('pt-BR'):''}</small><pre>{JSON.stringify(row.data||row,null,2)}</pre></div><button className="danger" onClick={()=>onDelete(table,row.id)}>Excluir</button></article>)}</div> }
