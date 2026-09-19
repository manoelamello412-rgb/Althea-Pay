/* eslint-disable react-hooks/preserve-manual-memoization */
'use client'
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Check, CheckCheck, ChevronLeft, Inbox, MessageCircle, RefreshCw, Search, Send, UserRound } from 'lucide-react'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { createRequestGuard, eventBelongsToConversation, mergeRows } from '@/lib/crm/frontend-state'
import { resolveRecoveryEventResponse } from '@/lib/crm/recovery-context'
import { hasOrganizationCapability, parseOrganizationAccess, type OrganizationAccess } from '@/lib/auth/organization-access'

type Json=Record<string,unknown>
type Conversation={id:string;organization_id:string;user_id:string;funnel_id:string|null;product_id:string|null;transaction_id:string|null;buyer_name:string|null;buyer_email:string|null;status:string;assigned_to:string|null;metadata:Json;public_token?:string|null;last_message_at:string|null;unread_count:number;created_at:string;updated_at:string;priority?:string;primary_channel?:string;customer_id?:string|null;customer_whatsapp?:string|null;checkout_status?:string;last_message_direction?:string|null}
type Message={id:string;conversation_id:string;organization_id:string;user_id:string;direction:'inbound'|'outbound';channel:string;body:string;metadata:Json;created_at:string;sender_id?:string|null;client_message_id?:string|null;external_message_id?:string|null}
type Event={id:string;transaction_id:string|null;status:string;error_reason:string|null;buyer_email?:string|null;buyer_name?:string|null;payload?:Json;received_at:string}
type Funnel={id:string;nome:string}
type Product={id:string;name:string|null;data:Json|null}
type Agent={id:string;name:string;status:string}
type Team={id:string;name:string;active:boolean}
type Cursor={updated_at:string;id:string}
type MessageCursor={created_at:string;id:string}
type Customer360=Json & {profile?:Json;aggregates?:Json;scores?:Json;conversations?:unknown[];messages?:unknown[];notes?:unknown[];tags?:unknown[];sales?:unknown[];checkouts?:unknown[];payment_attempts?:unknown[];events?:unknown[]}
type RealtimeState='connecting'|'connected'|'reconnecting'|'disconnected'|'synchronized'
const text=(v:unknown)=>typeof v==='string'&&v.trim()?v.trim():typeof v==='number'||typeof v==='boolean'?String(v):null
const obj=(v:unknown):Json=>v&&typeof v==='object'&&!Array.isArray(v)?v as Json:{}
const pick=(p:Json|null|undefined,keys:string[])=>{const r=obj(p);for(const k of keys){const v=text(r[k]);if(v)return v}for(const parent of ['customer','buyer']){const n=obj(r[parent]);for(const k of keys){const v=text(n[k]);if(v)return v}}return null}
const initials=(v:string)=>v.split(/\s+/).filter(Boolean).slice(0,2).map(x=>x[0]?.toUpperCase()??'').join('')||'?'
const time=(v:string|null|undefined)=>{if(!v)return'—';const d=new Date(v);return Number.isNaN(d.getTime())?'—':d.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})}

export default function CRMPage(){
 const supabase=useMemo(()=>createSupabaseBrowserClient(),[])
 const [uid,setUid]=useState(''),[access,setAccess]=useState<OrganizationAccess|null>(null),[conversations,setConversations]=useState<Conversation[]>([]),[messages,setMessages]=useState<Message[]>([]),[events,setEvents]=useState<Event[]>([]),[funnels,setFunnels]=useState<Funnel[]>([]),[products,setProducts]=useState<Product[]>([]),[agents,setAgents]=useState<Agent[]>([]),[teams,setTeams]=useState<Team[]>([]),[selectedId,updateSelectedId]=useState<string|null>(null),[selectedRecord,setSelectedRecord]=useState<Conversation|null>(null),[query,setQuery]=useState(''),[filter,setFilter]=useState<'all'|'unread'|'open'|'pending'|'closed'>('all'),[draft,setDraft]=useState(''),[loading,setLoading]=useState(true),[loadingMore,setLoadingMore]=useState(false),[loadingMessages,setLoadingMessages]=useState(false),[loadingMoreMessages,setLoadingMoreMessages]=useState(false),[sending,setSending]=useState(false),[rt,setRt]=useState<RealtimeState>('connecting'),[error,setError]=useState(''),[loading360,setLoading360]=useState(false),[assigning,setAssigning]=useState(false),[customer360,setCustomer360]=useState<Customer360|null>(null),[hasMoreConversations,setHasMoreConversations]=useState(false),[hasMoreMessages,setHasMoreMessages]=useState(false),[conversationTotal,setConversationTotal]=useState(0)
 const selectedIdRef = useRef<string|null>(null)
 const conversationsRef = useRef<Conversation[]>([])
 const selectedRecordRef = useRef<Conversation|null>(null)
 const conversationCursor = useRef<Cursor|null>(null)
 const messageCursor = useRef<MessageCursor|null>(null)
 const loadedPages = useRef(1)
 const requests = useRef(createRequestGuard())
 const reconciling = useRef(false)
 const organizationId=access?.organization_id??''
 const canViewChats=hasOrganizationCapability(access,'can_view_chats')
 const canReplyChats=hasOrganizationCapability(access,'can_reply_chats')
 const canViewValues=hasOrganizationCapability(access,'can_view_values')
 const canViewCustomers=hasOrganizationCapability(access,'can_view_customers')
 const canManageGateways=hasOrganizationCapability(access,'can_manage_gateways')
 useEffect(() => { conversationsRef.current = conversations }, [conversations])
 useEffect(() => () => { requests.current.invalidate() }, [])

 const setSelectedId = useCallback((id: string|null, record?: Conversation) => {
   if (selectedIdRef.current === id) return
   requests.current.invalidate('messages', 'events', 'customer', 'link', 'send')
   selectedIdRef.current = id
   selectedRecordRef.current = record ?? conversationsRef.current.find(c => c.id === id) ?? null
   setSelectedRecord(selectedRecordRef.current)
   messageCursor.current = null
   setMessages([]); setEvents([]); setCustomer360(null); setDraft(''); setSending(false)
   setHasMoreMessages(false); setLoadingMoreMessages(false); setLoadingMessages(Boolean(id)); setLoading360(Boolean(id))
   updateSelectedId(id)
 }, [])

 const loadConversations = useCallback(async (reset = true, silent = false, refresh = false) => {
   const current = requests.current.begin('conversations')
   if (!silent) setLoading(reset)
   try {
     const pages = refresh ? loadedPages.current : 1
     let cursor: Cursor|null = reset ? null : conversationCursor.current
     let items: Conversation[] = [], hasMore = false, total = 0, fetched = 0
     for (let page = 0; page < pages; page++) {
       const r = await supabase.rpc('crm_multicrm_conversations_page', {
         p_limit: 50, p_cursor_updated_at: cursor?.updated_at ?? null, p_cursor_id: cursor?.id ?? null,
         p_query: query.trim() || null, p_filter: filter, p_agent_id: null, p_team_id: null, p_priority: null,
       })
       if (!current()) return false
       if (r.error) throw r.error
       const data = obj(r.data), next = obj(data.next_cursor)
       items = mergeRows(items, Array.isArray(data.items) ? data.items as Conversation[] : [])
       cursor = next.updated_at && next.id ? { updated_at: String(next.updated_at), id: String(next.id) } : null
       hasMore = Boolean(data.has_more); total = Number(data.total_count ?? items.length); fetched++
       if (!hasMore || !cursor) break
     }
     if (!current()) return false
     setConversations(xs => reset ? items : mergeRows(xs, items))
     conversationCursor.current = cursor
     loadedPages.current = reset ? fetched : loadedPages.current + fetched
     setHasMoreConversations(hasMore); setConversationTotal(total)
     return true
   } catch (cause) {
     if (current()) setError(cause instanceof Error ? cause.message : String((cause as Json)?.message ?? 'Falha ao carregar conversas.'))
     return false
   } finally { if (current()) setLoading(false) }
 }, [filter, query, supabase])

 const loadMessages = useCallback(async (conversationId: string, reset = true, refresh = false) => {
   const valid = requests.current.begin('messages')
   const current = () => valid() && selectedIdRef.current === conversationId
   const cursor = reset ? null : messageCursor.current
   try {
     const r = await supabase.rpc('crm_multicrm_messages_page', { p_conversation_id: conversationId, p_limit: 100, p_cursor_created_at: cursor?.created_at ?? null, p_cursor_id: cursor?.id ?? null })
     if (!current()) return false
     if (r.error) throw r.error
     const data = obj(r.data), next = obj(data.next_cursor)
     const items = (Array.isArray(data.items) ? data.items as Message[] : []).filter(m => m.conversation_id === conversationId)
     setMessages(xs => mergeRows(reset && !refresh ? [] : xs, items).sort((a,b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()))
     if (!refresh) {
       messageCursor.current = next.created_at && next.id ? { created_at: String(next.created_at), id: String(next.id) } : null
       setHasMoreMessages(Boolean(data.has_more))
     }
     return true
   } catch (cause) {
     if (current()) setError(String((cause as Json)?.message ?? 'Falha ao carregar mensagens.'))
     return false
   } finally { if (current()) setLoadingMessages(false) }
 }, [supabase])

 const loadEvents = useCallback(async (c: Conversation|null) => {
   const valid = requests.current.begin('events')
   if (!c || selectedIdRef.current !== c.id) return
   if (!c.transaction_id || !organizationId || !canViewValues) { setEvents([]); return }
   try {
     const columns=canViewCustomers
       ? 'id,transaction_id,status,error_reason,buyer_email,buyer_name,payload,received_at'
       : 'id,transaction_id,status,error_reason,received_at'
     const r = await supabase.from('crm_webhook_events').select(columns).eq('organization_id',organizationId).eq('transaction_id',c.transaction_id).order('received_at',{ascending:false}).limit(50)
     if (!valid() || selectedIdRef.current !== c.id) return
     if (r.error) throw r.error
     const rows=(r.data??[]).map(row=>({...row,buyer_email:canViewCustomers?text((row as Json).buyer_email):null,buyer_name:canViewCustomers?text((row as Json).buyer_name):null,payload:canViewCustomers?obj((row as Json).payload):{}})) as Event[]
     setEvents(rows.filter(event => eventBelongsToConversation(event,c)))
   } catch (cause) { if (valid() && selectedIdRef.current === c.id) setError(String((cause as Json)?.message ?? 'Falha ao carregar eventos.')) }
 }, [supabase,organizationId,canViewValues,canViewCustomers])

 const load = useCallback(async (silent=false) => {
   const current = requests.current.begin('workspace')
   const a=await supabase.auth.getUser()
   if (!current()) return false
   if(a.error||!a.data.user){setError('Sessão expirada.');setLoading(false);return false}
   const id=a.data.user.id;setUid(id)
   const accessResult=await supabase.rpc('organization_my_access_v1',{p_organization_id:null})
   if(!current())return false
   if(accessResult.error)throw accessResult.error
   const effectiveAccess=parseOrganizationAccess(accessResult.data)
   if(!effectiveAccess){setError('Não foi possível carregar suas permissões.');setLoading(false);return false}
   setAccess(effectiveAccess)
   if(!effectiveAccess.capabilities.can_view_chats){setError('Seu acesso não permite visualizar o CRM.');setLoading(false);return false}
   const org=effectiveAccess.organization_id
   const[c,f,p,ag,tm]=await Promise.all([
     loadConversations(true,silent),
     supabase.from('funnels').select('id,nome').eq('organization_id',org).is('deleted_at',null),
     supabase.from('products').select('id,name').eq('organization_id',org),
     supabase.from('crm_agents').select('id,name,status').eq('organization_id',org).order('name'),
     supabase.from('crm_teams').select('id,name,active').eq('organization_id',org).eq('active',true).order('name')
   ])
   if(!current()||!c)return false
   if(!f.error)setFunnels((f.data??[]) as Funnel[]);if(!p.error)setProducts((p.data??[]) as Product[]);if(!ag.error)setAgents((ag.data??[]) as Agent[]);if(!tm.error)setTeams((tm.data??[]) as Team[])
   return true
 }, [loadConversations,supabase])
 useEffect(() => {
   let active = true
   void load().catch(() => { if (active) setError('Falha ao carregar o CRM.') })
   return () => { active = false; requests.current.invalidate('workspace','conversations') }
 }, [load])

 useEffect(() => {
   if (!uid || !access || !canViewChats) return
   const params = new URLSearchParams(window.location.search)
   const requested = params.get('conversation')?.trim(), recovery = params.get('recovery_event')?.trim()
   if (!requested && !recovery) return
   const current = requests.current.begin('link')
   const controller = new AbortController()
   const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
   void (async () => {
     if ((requested && !uuid.test(requested)) || (recovery && !uuid.test(recovery))) throw new Error('Contexto de conversa inválido.')
     let conversationId = requested
     if (recovery) {
       // Revalidate recovery links, including old event-only URLs, against the
       // canonical contract. Never let a URL hint override unlinked/ambiguous.
       const response = await fetch('/api/crm/recovery/opportunities?days=30', { cache: 'no-store', signal: controller.signal })
       const body: unknown = await response.json()
       if (!current()) return
       if (!response.ok) throw new Error('Não foi possível validar o contexto de recuperação. Tente novamente.')
       const context = resolveRecoveryEventResponse(body,recovery)
       if (context.status !== 'resolved') throw new Error(context.message)
       conversationId = context.conversationId
     }
     let row=conversationsRef.current.find(item=>item.id===conversationId)??null
     let cursor:Cursor|null=null
     for(let page=0;!row&&page<20;page++){
       const result=await supabase.rpc('crm_multicrm_conversations_page',{
         p_limit:100,
         p_cursor_updated_at:cursor?.updated_at??null,
         p_cursor_id:cursor?.id??null,
         p_query:null,
         p_filter:'all',
         p_agent_id:null,
         p_team_id:null,
         p_priority:null,
       })
       if(!current())return
       if(result.error)throw result.error
       const data=obj(result.data),items=Array.isArray(data.items)?data.items as Conversation[]:[]
       row=items.find(item=>item.id===conversationId)??null
       const next=obj(data.next_cursor)
       cursor=next.updated_at&&next.id?{updated_at:String(next.updated_at),id:String(next.id)}:null
       if(!data.has_more||!cursor)break
     }
     if (!row) throw new Error('Esta conversa não está disponível dentro do seu acesso operacional atual.')
     setConversations(xs => mergeRows(xs,[row!])); setSelectedId(row.id,row)
   })().catch(cause => { if (current()) setError(String(cause?.message ?? 'Falha ao abrir o contexto de recuperação.')) })
   return () => { requests.current.invalidate('link'); controller.abort() }
 }, [supabase,uid,access,canViewChats,setSelectedId])

 const activeRecord = conversations.find(c => c.id === selectedId) ?? selectedRecord
 useEffect(() => { selectedRecordRef.current = activeRecord }, [activeRecord])
 useEffect(() => {
   if (!selectedId) return
   const current = requests.current.begin('customer')
   void loadMessages(selectedId,true)
   const record=conversationsRef.current.find(item=>item.id===selectedId)??selectedRecordRef.current
   const canUseLegacy360=Boolean(record&&record.user_id===uid&&canViewCustomers)
   if(!canUseLegacy360){setCustomer360(null);setLoading360(false);return()=>{requests.current.invalidate('messages','customer')}}
   setLoading360(true)
   void supabase.rpc('crm_customer_360',{p_conversation_id:selectedId}).then(r => {
     if (!current() || selectedIdRef.current !== selectedId) return
     if (r.error) { setCustomer360(null) }
     else setCustomer360((r.data??null) as Customer360|null)
   }).catch(() => { if (current()) setCustomer360(null) })
     .finally(() => { if (current()) setLoading360(false) })
   return () => { requests.current.invalidate('messages','customer') }
 }, [selectedId,loadMessages,supabase,uid,canViewCustomers])
 const activeTransaction = activeRecord?.transaction_id
 useEffect(() => {
   void loadEvents(selectedRecordRef.current)
   return () => { requests.current.invalidate('events') }
 }, [selectedId,activeTransaction,loadEvents])
 const unread = activeRecord?.unread_count ?? 0
 useEffect(() => {
   if (!selectedId || unread <= 0 || !canReplyChats) return
   let cancelled = false
   void supabase.rpc('crm_operator_mark_read',{p_conversation_id:selectedId}).then(r => {
     if (cancelled) return
     if (r.error) setError(r.error.message)
     else setConversations(xs => xs.map(x => x.id === selectedId ? {...x,unread_count:0} : x))
   })
   return () => { cancelled = true }
 }, [selectedId,unread,supabase,canReplyChats])

 const reconcile = useCallback(async () => {
   if (!uid || !access || !canViewChats || reconciling.current) return false
   reconciling.current = true
   const current = requests.current.begin('reconcile')
   setRt('reconnecting')
   try {
     const ok = await loadConversations(true,true,true)
     if (!current()) return false
     const c = selectedRecordRef.current
     if (c) await Promise.all([loadMessages(c.id,true,true),loadEvents(c)])
     if (ok && current()) setRt('synchronized')
     return ok
   } finally { reconciling.current = false }
 }, [uid,access,canViewChats,loadConversations,loadMessages,loadEvents])
 const reconcileRef = useRef(reconcile)
 useEffect(() => { reconcileRef.current = reconcile }, [reconcile])
 useEffect(() => {
   if (!uid || !organizationId || !canViewChats) return
   let disposed = false, timer: ReturnType<typeof setTimeout>|undefined
   const refresh = () => { if (disposed) return; clearTimeout(timer); timer=setTimeout(() => { void reconcileRef.current() },150) }
   const channel = supabase.channel(`crm:${organizationId}`)
   channel.on('postgres_changes',{event:'*',schema:'public',table:'crm_conversations',filter:`organization_id=eq.${organizationId}`},p => {
     if (disposed) return
     if (p.eventType === 'DELETE' && selectedIdRef.current === String(p.old.id)) setSelectedId(null)
     refresh()
   })
   channel.on('postgres_changes',{event:'*',schema:'public',table:'crm_messages',filter:`organization_id=eq.${organizationId}`},p => {
     if (disposed) return
     if (p.eventType === 'DELETE') { setMessages(xs => xs.filter(m => m.id !== String(p.old.id))); return }
     const row = p.new as Message
     if (row.conversation_id !== selectedIdRef.current) return
     setMessages(xs => mergeRows(xs,[row]).sort((a,b) => new Date(a.created_at).getTime()-new Date(b.created_at).getTime()))
   })
   if(canViewValues&&canViewCustomers){
     channel.on('postgres_changes',{event:'*',schema:'public',table:'crm_webhook_events',filter:`organization_id=eq.${organizationId}`},p => {
       if (disposed) return
       if (p.eventType === 'DELETE') { setEvents(xs => xs.filter(x => x.id !== String(p.old.id))); return }
       const row = p.new as Event
       setEvents(xs => {
         const retained = xs.filter(x => x.id !== row.id)
         return eventBelongsToConversation(row,selectedRecordRef.current) ? mergeRows(retained,[row]).sort((a,b) => new Date(b.received_at).getTime()-new Date(a.received_at).getTime()) : retained
       })
     })
   }
   setRt('connecting')
   channel.subscribe(status => {
     if (disposed) return
     if (status === 'SUBSCRIBED') { setRt('connected'); refresh() }
     else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') setRt('reconnecting')
     else if (status === 'CLOSED') setRt('disconnected')
   })
   const polling=access?.role==='owner'?undefined:window.setInterval(refresh,5000)
   const offline = () => setRt('disconnected')
   window.addEventListener('online',refresh);window.addEventListener('offline',offline)
   return () => {
     disposed=true;clearTimeout(timer);if(polling)window.clearInterval(polling);requests.current.invalidate('reconcile')
     window.removeEventListener('online',refresh);window.removeEventListener('offline',offline)
     void supabase.removeChannel(channel)
   }
 }, [supabase,uid,organizationId,canViewChats,canViewValues,canViewCustomers,access?.role,setSelectedId])
 const funnelMap=useMemo(()=>new Map(funnels.map(x=>[x.id,x.nome])),[funnels]),productMap=useMemo(()=>new Map(products.map(x=>[x.id,x.name||pick(x.data,['name','nome','product_name'])||x.id])),[products]),agentMap=useMemo(()=>new Map(agents.map(x=>[x.id,x.name])),[agents]),latest=useMemo(()=>{const m=new Map<string,Message>();for(const x of messages){const old=m.get(x.conversation_id);if(!old||new Date(x.created_at).getTime()>new Date(old.created_at).getTime())m.set(x.conversation_id,x)}return m},[messages]),selected=activeRecord,selectedMessages=useMemo(()=>selected?[...messages.filter(m=>m.conversation_id===selected.id)].sort((a,b)=>new Date(a.created_at).getTime()-new Date(b.created_at).getTime()):[],[messages,selected]),selectedEvent=selected?events.find(event=>eventBelongsToConversation(event,selected))??null:null,profile=useMemo(()=>{const p={...obj(selected?.metadata),...obj(selectedEvent?.payload),...obj(obj(customer360?.profile).conversation)},customer=obj(obj(customer360?.profile).customer);return{name:selected?.buyer_name||selectedEvent?.buyer_name||pick(customer,['name','nome','full_name'])||pick(p,['name','nome','full_name','customer_name'])||'Cliente',email:selected?.buyer_email||selectedEvent?.buyer_email||pick(customer,['email','buyer_email','customer_email'])||pick(p,['email','buyer_email','customer_email']),phone:selected?.customer_whatsapp||pick(customer,['whatsapp','phone','mobile'])||pick(p,['whatsapp','phone','mobile']),funnel:selected?.funnel_id?funnelMap.get(selected.funnel_id)??selected.funnel_id:pick(p,['funnel_name','funnel']),product:selected?.product_id?productMap.get(selected.product_id)??selected.product_id:pick(p,['product_name','product'])}},[customer360,funnelMap,productMap,selected,selectedEvent]),aggregates=obj(customer360?.aggregates),scores=obj(customer360?.scores)
 async function moreC(){if(!hasMoreConversations||loadingMore)return;setLoadingMore(true);await loadConversations(false,true);setLoadingMore(false)}
 async function moreM(){if(!selected||!hasMoreMessages||loadingMoreMessages)return;setLoadingMoreMessages(true);await loadMessages(selected.id,false);setLoadingMoreMessages(false)}
 async function assign(agentId:string|null,teamId:string|null,priority:string|null){if(!selected||assigning||!canReplyChats)return;setAssigning(true);try{const r=await supabase.rpc('crm_assign_conversation',{p_conversation_id:selected.id,p_agent_id:agentId,p_team_id:teamId,p_priority:priority});if(r.error)throw r.error;await loadConversations(true,true,true)}catch(x){setError(x instanceof Error?x.message:'Falha ao atribuir conversa.')}finally{setAssigning(false)}}
 async function send(e:FormEvent){e.preventDefault();if(!selected||!draft.trim()||sending||selected.status==='closed'||!canReplyChats)return;const current=requests.current.begin('send');setSending(true);try{const r=await supabase.rpc('crm_operator_send_message',{p_conversation_id:selected.id,p_body:draft.trim(),p_client_message_id:`${crypto.randomUUID()}-${Date.now()}`});if(r.error||!r.data)throw r.error??new Error('Mensagem não enviada.');const row=r.data as unknown as Message;if(current()&&selectedIdRef.current===selected.id){setMessages(xs=>mergeRows(xs,[row]).sort((a,b)=>new Date(a.created_at).getTime()-new Date(b.created_at).getTime()));setDraft('')}}catch(x){if(current())setError(x instanceof Error?x.message:'Falha ao enviar.')}finally{if(current())setSending(false)}}
 async function status(next:'open'|'pending'|'closed'){if(!selected||!canReplyChats)return;const r=await supabase.rpc('crm_operator_set_status',{p_conversation_id:selected.id,p_status:next});if(r.error){setError(r.error.message);return}await loadConversations(true,true,true)}
 const rtLabel={connecting:'CONECTANDO',connected:'REALTIME ATIVO',reconnecting:'RECONCILIANDO',disconnected:'DESCONECTADO',synchronized:'SINCRONIZADO'}[rt]
 const counts:Array<[string,unknown]>=[['Conversas',aggregates.conversations],['Vendas',aggregates.sales_count],['Checkouts',aggregates.checkout_count],['Pagamentos',aggregates.payment_attempts],['Notas',aggregates.notes_count]]
 return <div className="min-h-screen bg-[#070A09] text-slate-100"><header className="mb-4 rounded-2xl border border-white/[.07] bg-[#0B0F0D] p-3"><div className="flex flex-col gap-3 lg:flex-row lg:items-center"><div className="flex shrink-0 items-center gap-2 text-[9px] font-black uppercase tracking-widest text-slate-600"><i className={`h-1.5 w-1.5 rounded-full ${rt==='connected'||rt==='synchronized'?'bg-[#1DB854]':rt==='disconnected'?'bg-rose-400':'bg-amber-400'}`}/>{rtLabel}{access&&<span className="rounded-full border border-white/10 px-2 py-1 text-[8px] text-slate-500">{access.role} · {access.operational_history_hours}h</span>}</div><div className="flex min-w-0 flex-1 items-center gap-2 rounded-xl border border-white/10 bg-white/[.025] px-3 py-2"><Search size={15} className="shrink-0 text-slate-600"/><input value={query} onChange={e=>setQuery(e.target.value)} onKeyDown={e=>{if(e.key==='Enter')void loadConversations(true)}} placeholder="Buscar cliente, mensagem, funil..." className="min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-slate-600"/></div><div className="flex flex-wrap items-center gap-1.5">{access?.role==='owner'?<><a href="/dashboard/crm/intelligence" className="rounded-lg border border-white/[.07] px-2.5 py-2 text-[9px] font-bold text-slate-400 transition hover:border-[#1DB854]/20 hover:text-[#63e08a]">INTELIGÊNCIA</a><a href="/dashboard/crm/recovery" className="rounded-lg border border-white/[.07] px-2.5 py-2 text-[9px] font-bold text-slate-400 transition hover:border-[#1DB854]/20 hover:text-[#63e08a]">RECUPERAÇÃO</a><a href="/dashboard/crm/observability" className="rounded-lg border border-white/[.07] px-2.5 py-2 text-[9px] font-bold text-slate-400 transition hover:border-[#1DB854]/20 hover:text-[#63e08a]">OBSERVABILIDADE</a></>:<span className="rounded-lg border border-white/[.05] px-2.5 py-2 text-[9px] font-bold text-slate-700">MÓDULOS AVANÇADOS RESTRITOS</span>}<Button type="button" variant="ghost" size="icon" onClick={()=>void reconcile()} aria-label="Sincronizar CRM" title="Sincronizar CRM"><RefreshCw size={16} className={loading?'animate-spin':''}/></Button></div></div></header><main className="mx-auto max-w-[1700px] px-3 py-5 lg:px-7"><div className="mb-4 flex flex-wrap items-end justify-between gap-3"><h1 className="mt-1 text-3xl font-black">Multi-CRM</h1><div className="flex gap-2 overflow-x-auto">{(['all','unread','open','pending','closed'] as const).map(x=><Button key={x} type="button" variant={filter===x?'default':'ghost'} size="sm" className="shrink-0 rounded-full" onClick={()=>{setFilter(x)}}>{x==='all'?'Todas':x==='unread'?'Não lidas':x==='open'?'Abertas':x==='pending'?'Pendentes':'Encerradas'} {x==='all'&&conversationTotal>0&&<span className="ml-1 opacity-60">{conversationTotal}</span>}</Button>)}</div></div>{error&&<div className="mb-4 rounded-xl border border-rose-500/20 bg-rose-500/10 p-3 text-xs text-rose-200">{error}</div>}<section className="grid min-h-[calc(100vh-180px)] overflow-hidden rounded-[24px] border border-white/10 bg-[#0B0F0D] lg:grid-cols-[340px_minmax(0,1fr)_320px]"><aside className={`${selected?'hidden lg:block':''} border-r border-white/10 bg-[#090C0B]`}><div className="border-b border-white/10 p-4"><div className="text-[10px] font-black uppercase tracking-widest text-slate-500">Conversas reais · {conversationTotal}</div><div className="mt-3 flex items-center gap-2 rounded-xl border border-white/10 px-3 py-2 md:hidden"><Search size={14} className="text-slate-600"/><input value={query} onChange={e=>setQuery(e.target.value)} onKeyDown={e=>{if(e.key==='Enter')void loadConversations(true)}} placeholder="Buscar..." className="w-full bg-transparent text-xs outline-none"/></div></div><div className="overflow-y-auto">{loading?<div className="space-y-2 p-3">{[1,2,3,4].map(x=><div key={x} className="h-20 animate-pulse rounded-xl bg-white/[.03]"/>)}</div>:conversations.length===0?<div className="p-10 text-center text-sm text-slate-600"><Inbox className="mx-auto mb-3" size={28}/>Nenhuma conversa real.</div>:<>{conversations.map(c=>{const name=c.buyer_name||c.buyer_email||c.customer_whatsapp||'Cliente';return <Button key={c.id} type="button" variant="ghost" onClick={()=>setSelectedId(c.id)} className={`h-auto min-h-[96px] w-full justify-start rounded-none border-b border-white/[.06] p-4 text-left ${selected?.id===c.id?'bg-[#102218]':'hover:bg-white/[.025]'}`}><div className="flex w-full gap-3"><div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/[.05] text-xs font-black">{initials(name)}</div><div className="min-w-0 flex-1"><div className="flex justify-between gap-2"><b className="truncate text-sm">{name}</b><span className="text-[9px] text-slate-600">{time(c.last_message_at||c.updated_at)}</span></div><div className="mt-1 truncate text-[9px] uppercase tracking-wider text-slate-600">{funnelMap.get(c.funnel_id??'')??'Sem funil'} · {c.primary_channel??'funnel_chat'}</div><p className="mt-1 truncate text-xs text-slate-500">{latest.get(c.id)?.body??'Sem mensagens nesta página'}</p></div>{c.unread_count>0&&<span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-[#1DB854] px-1 text-[9px] font-black text-black">{c.unread_count}</span>}</div></Button>})}{hasMoreConversations&&<div className="p-3"><Button type="button" variant="ghost" className="w-full" disabled={loadingMore} onClick={()=>void moreC()}>{loadingMore?'Carregando...':'Carregar mais conversas'}</Button></div>}</>}</div></aside><div className={`${selected?'':'hidden lg:block'} min-w-0`}>{selected?<><div className="flex h-16 items-center justify-between border-b border-white/10 px-4"><div className="flex min-w-0 items-center gap-3"><Button type="button" variant="ghost" size="icon" onClick={()=>setSelectedId(null)} className="lg:hidden" aria-label="Voltar para conversas" title="Voltar para conversas"><ChevronLeft size={18}/></Button><div className="flex h-9 w-9 items-center justify-center rounded-full bg-[#12351F] text-xs font-black text-[#1DB854]">{initials(profile.name)}</div><div className="min-w-0"><b className="block truncate text-sm">{profile.name}</b><span className="block truncate text-[9px] text-slate-600">{profile.email??profile.phone??'Sem contato identificado'}</span></div></div><select disabled={!canReplyChats} value={selected.status} onChange={e=>void status(e.target.value as 'open'|'pending'|'closed')} className="rounded-xl border border-white/10 bg-[#090C0B] px-3 py-2 text-[10px] font-bold uppercase text-slate-300 disabled:cursor-not-allowed disabled:opacity-50"><option value="open">Aberta</option><option value="pending">Pendente</option><option value="closed">Encerrada</option></select></div><div className="min-h-[500px] space-y-3 overflow-y-auto p-4 lg:p-7">{hasMoreMessages&&<Button type="button" variant="ghost" disabled={loadingMoreMessages} onClick={()=>void moreM()} className="mx-auto flex">{loadingMoreMessages?'Carregando...':'Carregar mensagens anteriores'}</Button>}{loadingMessages&&selectedMessages.length===0?<div className="flex min-h-80 items-center justify-center text-sm text-slate-600">Carregando mensagens...</div>:selectedMessages.length===0?<div className="flex min-h-80 items-center justify-center text-center text-sm text-slate-600"><div><MessageCircle className="mx-auto mb-3" size={30}/>Nenhuma mensagem registrada.</div></div>:selectedMessages.map(m=>{const md=obj(m.metadata),delivery=text(md.delivery_status)||text(md.status),provider=text(md.provider_message_id);return <div key={m.id} className={`flex ${m.direction==='outbound'?'justify-end':'justify-start'}`}><div className={`max-w-[82%] rounded-2xl px-4 py-3 ${m.direction==='outbound'?'bg-[#12351F]':'bg-white/[.045]'}`}><div className="whitespace-pre-wrap text-sm leading-6">{m.body}</div><div className="mt-1 flex justify-end gap-1 text-[9px] text-slate-600">{m.channel} · {time(m.created_at)} {m.direction==='outbound'&&(delivery==='failed'?<span>Falhou</span>:delivery==='sent'||provider||m.external_message_id?<CheckCheck size={11}/>:<Check size={11}/>)}</div></div></div>})}</div><form onSubmit={send} className="border-t border-white/10 p-3"><div className="flex items-end gap-2 rounded-2xl border border-white/10 p-2"><textarea value={draft} onChange={e=>setDraft(e.target.value)} disabled={sending||selected.status==='closed'||!canReplyChats} rows={2} maxLength={10000} placeholder={!canReplyChats?'Seu acesso é somente leitura':selected.status==='closed'?'Conversa encerrada':'Escreva uma mensagem...'} className="flex-1 resize-none bg-transparent p-2 text-sm outline-none placeholder:text-slate-600"/><Button type="submit" variant="default" size="icon" disabled={!draft.trim()||sending||selected.status==='closed'||!canReplyChats} aria-label="Enviar mensagem" title="Enviar mensagem"><Send size={16}/></Button></div></form></>:<div className="flex min-h-[600px] items-center justify-center text-sm text-slate-600"><div><MessageCircle className="mx-auto mb-3" size={36}/>Selecione uma conversa.</div></div>}</div><aside className={`${selected?'block':'hidden lg:block'} border-l border-white/10 bg-[#090C0B] p-5`}><div className="flex items-center gap-2 text-[9px] font-black uppercase tracking-widest text-[#1DB854]"><UserRound size={13}/> Customer 360</div>{selected&&<><div className="mt-3 grid grid-cols-3 gap-1.5">{canViewCustomers&&selected.user_id===uid?<a href={`/dashboard/crm/customer-360?conversation=${encodeURIComponent(selected.id)}`} className="rounded-lg border border-white/[.07] px-2 py-2 text-center text-[8px] font-bold text-slate-400 transition hover:border-[#1DB854]/20 hover:text-[#63e08a]">360 COMPLETO</a>:<span className="rounded-lg border border-white/[.05] px-2 py-2 text-center text-[8px] font-bold text-slate-700">360 BLOQUEADO</span>}{canReplyChats&&selected.user_id===uid?<a href={`/dashboard/crm/actions?conversation=${encodeURIComponent(selected.id)}`} className="rounded-lg border border-white/[.07] px-2 py-2 text-center text-[8px] font-bold text-slate-400 transition hover:border-[#1DB854]/20 hover:text-[#63e08a]">PRÓXIMA AÇÃO</a>:<span className="rounded-lg border border-white/[.05] px-2 py-2 text-center text-[8px] font-bold text-slate-700">SOMENTE LEITURA</span>}{canReplyChats&&selected.user_id===uid?<a href={`/dashboard/crm/ai-agent?conversation=${encodeURIComponent(selected.id)}`} className="rounded-lg border border-white/[.07] px-2 py-2 text-center text-[8px] font-bold text-slate-400 transition hover:border-[#1DB854]/20 hover:text-[#63e08a]">AGENTE</a>:<span className="rounded-lg border border-white/[.05] px-2 py-2 text-center text-[8px] font-bold text-slate-700">AGENTE BLOQUEADO</span>}</div><div className="mt-5 rounded-2xl border border-white/10 p-4"><b className="text-lg">{profile.name}</b><div className="mt-2 space-y-1 text-xs text-slate-500"><div>{profile.email??'E-mail não identificado'}</div><div>{profile.phone??'WhatsApp não identificado'}</div></div></div><div className="mt-4 space-y-2 rounded-2xl border border-white/10 p-4 text-xs"><div className="flex justify-between"><span className="text-slate-600">Funil</span><b>{profile.funnel??'—'}</b></div><div className="flex justify-between"><span className="text-slate-600">Produto</span><b className="truncate pl-4">{profile.product??'—'}</b></div><div className="flex justify-between"><span className="text-slate-600">Checkout</span><b>{selected.checkout_status??'—'}</b></div><div className="flex justify-between"><span className="text-slate-600">Prioridade</span><select disabled={assigning||!canReplyChats} value={selected.priority??'normal'} onChange={e=>void assign(selected.assigned_to,null,e.target.value)} className="bg-transparent text-right text-xs"><option value="low">Baixa</option><option value="normal">Normal</option><option value="high">Alta</option></select></div><div className="flex justify-between"><span className="text-slate-600">Agente</span><select disabled={assigning||!canReplyChats} value={selected.assigned_to??''} onChange={e=>void assign(e.target.value||null,null,selected.priority??'normal')} className="max-w-[150px] truncate bg-transparent text-right text-xs"><option value="">Não atribuído</option>{agents.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</select></div><div className="flex justify-between"><span className="text-slate-600">Equipe</span><select disabled={assigning||!canReplyChats} value={String(obj(selected.metadata).team_id??'')} onChange={e=>void assign(selected.assigned_to,e.target.value||null,selected.priority??'normal')} className="max-w-[150px] truncate bg-transparent text-right text-xs"><option value="">Sem equipe</option>{teams.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}</select></div></div><div className="mt-4 rounded-2xl border border-white/10 p-4"><div className="text-[9px] uppercase tracking-widest text-slate-600">Customer 360 real</div>{loading360?<div className="mt-3 h-12 animate-pulse rounded-xl bg-white/[.03]"/>:<><div className="mt-3 grid grid-cols-2 gap-2">{counts.map(([label,value])=><div key={label} className="rounded-xl bg-white/[.025] p-2"><div className="text-[9px] text-slate-600">{label}</div><b>{text(value)??'0'}</b></div>)}</div><div className="mt-3 grid grid-cols-3 gap-2"><div className="rounded-xl bg-white/[.025] p-2"><div className="text-[8px] text-slate-600">Engajamento</div><b>{text(scores.engagement_score)??'0'}</b></div><div className="rounded-xl bg-white/[.025] p-2"><div className="text-[8px] text-slate-600">Conversão</div><b>{text(scores.conversion_score)??'0'}</b></div><div className="rounded-xl bg-white/[.025] p-2"><div className="text-[8px] text-slate-600">Recuperação</div><b>{text(scores.recovery_score)??'0'}</b></div></div></>}</div>{canViewValues&&selectedEvent&&<div className="mt-4 rounded-2xl border border-white/10 p-4"><div className="text-[9px] uppercase tracking-widest text-slate-600">Último evento</div><b className="mt-2 block uppercase">{selectedEvent.status}</b>{selectedEvent.error_reason&&<p className="mt-1 text-xs text-rose-300">{selectedEvent.error_reason}</p>}</div>}</>}</aside></section></main></div>
}
