'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowDown, ArrowUp, Kanban, ListTodo, Loader2, MessageCircle, Phone, Plus, RefreshCw, Settings2, Trash2, UserRound, X } from 'lucide-react'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'
import { hasOrganizationCapability, parseOrganizationAccess, type OrganizationAccess } from '@/lib/auth/organization-access'
import { CrmCallDialog, OUTCOME_LABEL, type Outcome } from '@/components/crm-call-dialog'

type Json = Record<string, unknown>
type StageKind = 'open' | 'won' | 'lost'
type Pipeline = { id: string; name: string; is_default: boolean }
type Stage = { id: string; pipeline_id: string; name: string; position: number; kind: StageKind }
type Card = {
  id: string; pipeline_id: string; stage_id: string; client_id: string; version: number; stage_entered_at: string; owner_id: string | null
  name: string | null; email: string | null; phone: string | null; tags: string[]; open_tasks: number; late_tasks: number; next_task_due_at: string | null
  last_interaction_at: string | null; last_call_outcome: Outcome | null; conversation_id: string | null; next_callback_at: string | null
}
type Member = { user_id: string; name: string | null }
type Client = { id: string; data: Json | null; created_at: string }
type DraftStage = { id?: string; name: string; kind: StageKind }

const DEFAULT_STAGES: DraftStage[] = [
  { name: 'Novo lead', kind: 'open' },
  { name: 'Em contato', kind: 'open' },
  { name: 'Negociação', kind: 'open' },
  { name: 'Ganho', kind: 'won' },
  { name: 'Perdido', kind: 'lost' },
]
const KIND_LABEL: Record<StageKind, string> = { open: 'Em andamento', won: 'Ganho', lost: 'Perdido' }
const KIND_TONE: Record<StageKind, string> = { open: 'text-slate-400', won: 'text-emerald-400', lost: 'text-red-400' }
const ERRORS: Record<string, string> = {
  FORBIDDEN: 'Seu acesso não permite esta ação.',
  CARD_VERSION_CONFLICT: 'Outro membro moveu este card agora. O quadro foi atualizado.',
  STAGE_NOT_EMPTY: 'Mova os cards antes de remover uma etapa que ainda tem clientes.',
  OPEN_STAGE_REQUIRED: 'O pipeline precisa de pelo menos uma etapa "Em andamento".',
  STAGES_REQUIRED: 'Informe de 1 a 20 etapas.',
  STAGE_NAME_REQUIRED: 'Toda etapa precisa de nome.',
  PIPELINE_NAME_REQUIRED: 'Informe o nome do pipeline.',
  OWNER_NOT_MEMBER: 'O responsável precisa ser membro da organização.',
  CARD_NOT_FOUND: 'Este card não existe mais. O quadro foi atualizado.',
}

const obj = (value: unknown): Json => value && typeof value === 'object' && !Array.isArray(value) ? value as Json : {}
const text = (value: unknown) => typeof value === 'string' ? value.trim() : ''
const pick = (data: Json, keys: string[]) => { for (const key of keys) { const value = text(data[key]); if (value) return value } for (const parent of ['customer', 'buyer', 'profile']) { const nested = obj(data[parent]); for (const key of keys) { const value = text(nested[key]); if (value) return value } } return '' }
const nameOf = (client?: Client) => pick(obj(client?.data), ['name', 'full_name', 'nome', 'customer_name']) || 'Cliente sem nome'
const contactOf = (client?: Client) => pick(obj(client?.data), ['email', 'buyer_email', 'customer_email']) || pick(obj(client?.data), ['phone', 'whatsapp', 'mobile'])
const when = (value: string) => new Date(value).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
const since = (value: string) => { const days = Math.floor((Date.now() - new Date(value).getTime()) / 86_400_000); return days <= 0 ? 'hoje' : days === 1 ? '1 dia' : `${days} dias` }
const ago = (value: string) => { const minutes = Math.floor((Date.now() - new Date(value).getTime()) / 60_000); return minutes < 60 ? `${Math.max(minutes, 0)} min` : minutes < 1440 ? `${Math.floor(minutes / 60)} h` : `${Math.floor(minutes / 1440)} d` }
const messageOf = (cause: unknown) => { const raw = cause && typeof cause === 'object' && 'message' in cause ? String((cause as { message: unknown }).message) : ''; return ERRORS[raw] ?? 'Não foi possível concluir a operação.' }

export default function KanbanPage() {
  const db = useMemo(() => createSupabaseBrowserClient(), [])
  const [access, setAccess] = useState<OrganizationAccess | null>(null)
  const [pipelines, setPipelines] = useState<Pipeline[]>([])
  const [pipelineId, setPipelineId] = useState('')
  const [stages, setStages] = useState<Stage[]>([])
  const [cards, setCards] = useState<Card[]>([])
  const [members, setMembers] = useState<Member[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [dragging, setDragging] = useState('')
  const [editor, setEditor] = useState<{ id: string | null; name: string; isDefault: boolean; stages: DraftStage[] } | null>(null)
  const [saving, setSaving] = useState(false)
  const [adding, setAdding] = useState(false)
  const [candidates, setCandidates] = useState<Client[]>([])
  const [search, setSearch] = useState('')
  const [call, setCall] = useState<Card | null>(null)

  const canConfigure = hasOrganizationCapability(access, 'can_manage_funnels')
  const canMove = hasOrganizationCapability(access, 'can_view_customers') && hasOrganizationCapability(access, 'can_reply_chats')
  const canView = hasOrganizationCapability(access, 'can_view_customers')

  const load = useCallback(async (preferred?: string) => {
    setLoading(true); setError('')
    try {
      const accessResult = await db.rpc('organization_my_access_v1', { p_organization_id: null })
      if (accessResult.error) throw accessResult.error
      const current = parseOrganizationAccess(accessResult.data)
      setAccess(current)
      if (!current) { setPipelines([]); return }
      const pipelineResult = await db.from('crm_pipelines').select('id,name,is_default').eq('organization_id', current.organization_id).order('created_at')
      if (pipelineResult.error) throw pipelineResult.error
      const list = (pipelineResult.data ?? []) as Pipeline[]
      setPipelines(list)
      const active = list.find(item => item.id === preferred) ?? list.find(item => item.is_default) ?? list[0]
      setPipelineId(active?.id ?? '')
      if (!active) { setStages([]); setCards([]); return }
      const [stageResult, boardResult] = await Promise.all([
        db.from('crm_stages').select('id,pipeline_id,name,position,kind').eq('pipeline_id', active.id).order('position'),
        hasOrganizationCapability(current, 'can_view_customers')
          ? db.rpc('crm_board_v1', { p_pipeline_id: active.id })
          : Promise.resolve({ data: null, error: null }),
      ])
      if (stageResult.error) throw stageResult.error
      if (boardResult.error) throw boardResult.error
      const board = obj(boardResult.data)
      setStages((stageResult.data ?? []) as Stage[])
      setCards((Array.isArray(board.cards) ? board.cards : []) as Card[])
      setMembers((Array.isArray(board.members) ? board.members : []) as Member[])
    } catch (cause) {
      console.error('[ALTHEA-KANBAN]', cause)
      setError('Não foi possível carregar o Kanban.')
    } finally { setLoading(false) }
  }, [db])

  useEffect(() => { void load() }, [load])

  useEffect(() => {
    if (!pipelineId) return
    const channel = db.channel(`kanban-${pipelineId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'crm_pipeline_cards', filter: `pipeline_id=eq.${pipelineId}` }, () => void load(pipelineId))
      .subscribe()
    return () => { void db.removeChannel(channel) }
  }, [db, load, pipelineId])

  async function move(card: Card, stageId: string) {
    if (!canMove || card.stage_id === stageId) return
    setError(''); setNotice('')
    setCards(current => current.map(item => item.id === card.id ? { ...item, stage_id: stageId, stage_entered_at: new Date().toISOString() } : item))
    const result = await db.rpc('crm_card_move', { p_card_id: card.id, p_stage_id: stageId, p_expected_version: card.version })
    if (result.error) { setError(messageOf(result.error)); await load(pipelineId); return }
    const saved = result.data as Card
    setCards(current => current.map(item => item.id === card.id ? { ...item, stage_id: saved.stage_id, version: saved.version, stage_entered_at: saved.stage_entered_at } : item))
  }

  async function assign(card: Card, ownerId: string) {
    if (!canMove || (card.owner_id ?? '') === ownerId) return
    setError(''); setNotice('')
    const result = await db.rpc('crm_card_assign', { p_card_id: card.id, p_owner_id: ownerId || null, p_expected_version: card.version })
    if (result.error) { setError(messageOf(result.error)); await load(pipelineId); return }
    const saved = result.data as Card
    setCards(current => current.map(item => item.id === card.id ? { ...item, owner_id: saved.owner_id, version: saved.version } : item))
  }

  async function savePipeline() {
    if (!editor) return
    setSaving(true); setError('')
    const result = await db.rpc('crm_pipeline_save', { p_pipeline_id: editor.id, p_name: editor.name, p_stages: editor.stages.map(stage => ({ ...(stage.id ? { id: stage.id } : {}), name: stage.name, kind: stage.kind })), p_is_default: editor.isDefault })
    setSaving(false)
    if (result.error) { setError(messageOf(result.error)); return }
    setEditor(null)
    setNotice(editor.isDefault ? 'Pipeline salvo. Novos clientes entram automaticamente na primeira etapa.' : 'Pipeline salvo.')
    await load(text(obj(obj(result.data).pipeline).id))
  }

  async function openAdd() {
    if (!access) return
    setAdding(true); setSearch('')
    const result = await db.from('clients').select('id,data,created_at').eq('organization_id', access.organization_id).order('created_at', { ascending: false }).limit(500)
    if (result.error) { setError('Não foi possível carregar os clientes.'); setAdding(false); return }
    const inPipeline = new Set(cards.map(card => card.client_id))
    setCandidates(((result.data ?? []) as Client[]).filter(client => !inPipeline.has(client.id)))
  }

  async function addClient(client: Client) {
    const result = await db.rpc('crm_card_add', { p_pipeline_id: pipelineId, p_client_id: client.id, p_stage_id: null })
    if (result.error) { setError(messageOf(result.error)); return }
    setCandidates(current => current.filter(item => item.id !== client.id))
    await load(pipelineId)
  }

  const memberName = (id: string | null) => id ? members.find(member => member.user_id === id)?.name || `Membro ${id.slice(0, 6)}` : 'Sem responsável'

  const pipeline = pipelines.find(item => item.id === pipelineId)
  const filtered = candidates.filter(client => !search.trim() || [nameOf(client), contactOf(client), client.id].join(' ').toLowerCase().includes(search.trim().toLowerCase())).slice(0, 50)
  const editStages = (update: (stages: DraftStage[]) => DraftStage[]) => setEditor(current => current && { ...current, stages: update(current.stages) })

  return <main className="min-h-screen bg-[#070A09] px-4 py-6 text-slate-100 lg:px-8">
    <div className="mx-auto max-w-[1800px]">
      <header className="mb-6 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div><div className="mb-2 text-[10px] font-black uppercase tracking-[.28em] text-emerald-400">ALTHEA PAY // KANBAN</div><h1 className="text-3xl font-black tracking-tight">Kanban</h1><p className="mt-1 text-sm text-slate-500">Etapa comercial de cada cliente. Toda mudança fica na auditoria.</p></div>
        <div className="flex flex-wrap items-center gap-2">
          {pipelines.length > 1 && <select aria-label="Pipeline" value={pipelineId} onChange={event => void load(event.target.value)} className="h-10 rounded-xl border border-white/10 bg-[#0b100e] px-3 text-sm">{pipelines.map(item => <option key={item.id} value={item.id}>{item.name}{item.is_default ? ' (padrão)' : ''}</option>)}</select>}
          {canMove && pipeline && <button type="button" onClick={() => void openAdd()} className="inline-flex h-10 items-center gap-2 rounded-xl bg-emerald-500 px-4 text-sm font-bold text-black hover:bg-emerald-400"><Plus size={15} /> Adicionar cliente</button>}
          {canConfigure && pipeline && <button type="button" onClick={() => setEditor({ id: pipeline.id, name: pipeline.name, isDefault: pipeline.is_default, stages: stages.map(stage => ({ id: stage.id, name: stage.name, kind: stage.kind })) })} className="inline-flex h-10 items-center gap-2 rounded-xl border border-white/10 bg-white/[.03] px-4 text-sm font-semibold hover:bg-white/[.06]"><Settings2 size={15} /> Etapas</button>}
          {canConfigure && <button type="button" onClick={() => setEditor({ id: null, name: '', isDefault: pipelines.length === 0, stages: DEFAULT_STAGES })} className="inline-flex h-10 items-center gap-2 rounded-xl border border-white/10 bg-white/[.03] px-4 text-sm font-semibold hover:bg-white/[.06]"><Plus size={15} /> Novo pipeline</button>}
          <button type="button" onClick={() => void load(pipelineId)} disabled={loading} aria-label="Atualizar" className="inline-flex h-10 items-center rounded-xl border border-white/10 bg-white/[.03] px-3 hover:bg-white/[.06] disabled:opacity-50"><RefreshCw size={15} className={loading ? 'animate-spin' : ''} /></button>
        </div>
      </header>

      {error && <div role="alert" className="mb-4 rounded-xl border border-red-500/20 bg-red-500/[.06] px-4 py-3 text-sm text-red-300">{error}</div>}
      {notice && <div role="status" className="mb-4 rounded-xl border border-emerald-500/20 bg-emerald-500/[.06] px-4 py-3 text-sm text-emerald-300">{notice}</div>}

      {loading && !pipelines.length ? <div className="flex min-h-64 items-center justify-center gap-2 text-slate-500"><Loader2 className="animate-spin text-emerald-400" size={20} /> Carregando Kanban</div>
        : !pipeline ? <div className="flex min-h-64 flex-col items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/[.02] text-center"><Kanban size={26} className="text-slate-600" /><strong>Nenhum pipeline criado</strong><p className="max-w-md text-sm text-slate-500">{canConfigure ? 'Crie o primeiro pipeline. Marcado como padrão, ele recebe automaticamente cada cliente novo vindo dos funis, do gateway e do chat.' : 'Peça a um gestor para criar o pipeline da operação.'}</p></div>
        : !canView ? <div className="rounded-2xl border border-white/10 bg-white/[.02] p-8 text-center text-sm text-slate-500">Seu acesso não inclui visualizar clientes.</div>
        : <div className="flex gap-3 overflow-x-auto pb-4">{stages.map(stage => {
          const stageCards = cards.filter(card => card.stage_id === stage.id)
          return <section key={stage.id} aria-label={stage.name} onDragOver={event => { if (canMove && dragging) event.preventDefault() }} onDrop={event => { event.preventDefault(); const card = cards.find(item => item.id === dragging); setDragging(''); if (card) void move(card, stage.id) }} className="flex w-72 shrink-0 flex-col rounded-2xl border border-white/10 bg-white/[.02]">
            <header className="flex items-center justify-between border-b border-white/[.06] px-4 py-3"><div><h2 className="text-sm font-bold">{stage.name}</h2><span className={`text-[10px] uppercase tracking-widest ${KIND_TONE[stage.kind]}`}>{KIND_LABEL[stage.kind]}</span></div><span className="rounded-full bg-white/[.06] px-2 py-0.5 text-xs text-slate-400">{stageCards.length}</span></header>
            <div className="flex min-h-40 flex-col gap-2 p-2">{stageCards.map(card => {
              const name = card.name || 'Cliente sem nome'
              return <article key={card.id} draggable={canMove} onDragStart={() => setDragging(card.id)} onDragEnd={() => setDragging('')} className={`rounded-xl border border-white/[.08] bg-[#0b100e] p-3 ${canMove ? 'cursor-grab active:cursor-grabbing' : ''} ${dragging === card.id ? 'opacity-40' : ''}`}>
                <b className="block truncate text-sm">{name}</b>
                <span className="block truncate pt-0.5 text-xs text-slate-500">{card.email || card.phone || card.client_id}</span>
                {card.tags.length > 0 && <div className="mt-1.5 flex flex-wrap gap-1">{card.tags.slice(0, 4).map(tag => <span key={tag} className="rounded-full bg-white/[.06] px-2 py-0.5 text-[10px] text-slate-300">{tag}</span>)}{card.tags.length > 4 && <span className="text-[10px] text-slate-500">+{card.tags.length - 4}</span>}</div>}
                <div className="mt-1.5 space-y-0.5 text-[10px]">
                  {card.next_callback_at && <span className={`block ${new Date(card.next_callback_at) <= new Date() ? 'text-red-400' : 'text-amber-400'}`}>retornar {when(card.next_callback_at)}</span>}
                  {card.open_tasks > 0 && <span className={`flex items-center gap-1 ${card.late_tasks ? 'text-red-400' : 'text-slate-400'}`}><ListTodo size={11} /> {card.open_tasks} tarefa{card.open_tasks > 1 ? 's' : ''}{card.late_tasks ? ` · ${card.late_tasks} atrasada${card.late_tasks > 1 ? 's' : ''}` : card.next_task_due_at ? ` · até ${when(card.next_task_due_at)}` : ''}</span>}
                  <span className="block text-slate-600">{card.last_interaction_at ? `última interação há ${ago(card.last_interaction_at)}${card.last_call_outcome ? ` · ${OUTCOME_LABEL[card.last_call_outcome]}` : ''}` : 'sem interação registrada'}</span>
                </div>
                {canMove ? <select aria-label={`Responsável por ${name}`} value={card.owner_id ?? ''} onChange={event => void assign(card, event.target.value)} className="mt-2 w-full rounded-md border border-white/10 bg-transparent px-1 py-0.5 text-[10px] text-slate-400"><option value="" className="bg-[#0b100e]">Sem responsável</option>{members.map(member => <option key={member.user_id} value={member.user_id} className="bg-[#0b100e]">{member.name || `Membro ${member.user_id.slice(0, 6)}`}</option>)}</select>
                  : <span className="mt-2 block text-[10px] text-slate-500">{memberName(card.owner_id)}</span>}
                <div className="mt-2 flex items-center justify-between gap-1"><span className="text-[10px] text-slate-600">na etapa há {since(card.stage_entered_at)}</span>
                  <span className="ml-auto flex items-center">
                    {card.conversation_id && <a href={`/dashboard/crm?conversation=${card.conversation_id}`} aria-label={`Abrir conversa de ${name}`} className="rounded-md p-1 text-slate-500 hover:bg-white/5 hover:text-emerald-400"><MessageCircle size={13} /></a>}
                    {card.conversation_id && <a href={`/dashboard/crm/customer-360?conversation=${card.conversation_id}`} aria-label={`Abrir cliente 360 de ${name}`} className="rounded-md p-1 text-slate-500 hover:bg-white/5 hover:text-emerald-400"><UserRound size={13} /></a>}
                    {canMove && <button type="button" onClick={() => setCall(card)} aria-label={`Registrar ligação para ${name}`} className="rounded-md p-1 text-slate-500 hover:bg-white/5 hover:text-emerald-400"><Phone size={13} /></button>}
                  </span>
                </div>
                {canMove && <select aria-label={`Mover ${name} para`} value={card.stage_id} onChange={event => void move(card, event.target.value)} className="mt-1 w-full rounded-md border border-white/10 bg-transparent px-1 py-0.5 text-[10px] text-slate-400">{stages.map(option => <option key={option.id} value={option.id} className="bg-[#0b100e]">{option.name}</option>)}</select>}
              </article>
            })}{!stageCards.length && <p className="px-2 py-6 text-center text-xs text-slate-600">Sem clientes nesta etapa</p>}</div>
          </section>
        })}</div>}
    </div>

    {editor && <div role="dialog" aria-modal="true" aria-label="Configurar pipeline" className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 backdrop-blur-sm md:items-center md:p-6" onClick={event => { if (event.currentTarget === event.target) setEditor(null) }}>
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-t-3xl border border-white/10 bg-[#0b100e] p-6 md:rounded-3xl">
        <div className="mb-5 flex items-center justify-between"><h2 className="text-lg font-black">{editor.id ? 'Etapas do pipeline' : 'Novo pipeline'}</h2><button type="button" onClick={() => setEditor(null)} aria-label="Fechar" className="rounded-lg p-2 text-slate-500 hover:bg-white/5"><X size={18} /></button></div>
        <label className="mb-4 block space-y-1"><span className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Nome</span><input value={editor.name} onChange={event => setEditor({ ...editor, name: event.target.value })} maxLength={80} placeholder="Ex.: Vendas" className="h-10 w-full rounded-xl border border-white/10 bg-white/[.03] px-3 text-sm outline-none focus:border-emerald-500/40" /></label>
        <div className="space-y-2">{editor.stages.map((stage, index) => <div key={stage.id ?? `new-${index}`} className="flex items-center gap-2">
          <input aria-label={`Etapa ${index + 1}`} value={stage.name} maxLength={60} onChange={event => editStages(list => list.map((item, i) => i === index ? { ...item, name: event.target.value } : item))} className="h-9 min-w-0 flex-1 rounded-lg border border-white/10 bg-white/[.03] px-3 text-sm outline-none focus:border-emerald-500/40" />
          <select aria-label={`Tipo da etapa ${index + 1}`} value={stage.kind} onChange={event => editStages(list => list.map((item, i) => i === index ? { ...item, kind: event.target.value as StageKind } : item))} className="h-9 rounded-lg border border-white/10 bg-[#0b100e] px-2 text-xs">{(Object.keys(KIND_LABEL) as StageKind[]).map(kind => <option key={kind} value={kind}>{KIND_LABEL[kind]}</option>)}</select>
          <button type="button" aria-label="Subir etapa" disabled={index === 0} onClick={() => editStages(list => { const next = [...list]; [next[index - 1], next[index]] = [next[index], next[index - 1]]; return next })} className="rounded-md p-1.5 text-slate-500 hover:bg-white/5 disabled:opacity-30"><ArrowUp size={14} /></button>
          <button type="button" aria-label="Descer etapa" disabled={index === editor.stages.length - 1} onClick={() => editStages(list => { const next = [...list]; [next[index + 1], next[index]] = [next[index], next[index + 1]]; return next })} className="rounded-md p-1.5 text-slate-500 hover:bg-white/5 disabled:opacity-30"><ArrowDown size={14} /></button>
          <button type="button" aria-label="Remover etapa" disabled={editor.stages.length === 1} onClick={() => editStages(list => list.filter((_, i) => i !== index))} className="rounded-md p-1.5 text-slate-500 hover:bg-white/5 hover:text-red-400 disabled:opacity-30"><Trash2 size={14} /></button>
        </div>)}</div>
        {editor.stages.length < 20 && <button type="button" onClick={() => editStages(list => [...list, { name: '', kind: 'open' }])} className="mt-2 inline-flex items-center gap-1 text-xs text-emerald-400 hover:text-emerald-300"><Plus size={13} /> Adicionar etapa</button>}
        <label className="mt-5 flex items-start gap-3 rounded-xl border border-white/10 p-3"><input type="checkbox" checked={editor.isDefault} onChange={event => setEditor({ ...editor, isDefault: event.target.checked })} className="mt-0.5 accent-emerald-500" /><span><b className="block text-sm">Pipeline padrão</b><span className="text-xs text-slate-500">Clientes novos entram sozinhos na primeira etapa em andamento.</span></span></label>
        <button type="button" onClick={() => void savePipeline()} disabled={saving || !editor.name.trim() || editor.stages.some(stage => !stage.name.trim())} className="mt-5 flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-emerald-500 text-sm font-bold text-black hover:bg-emerald-400 disabled:opacity-40">{saving && <Loader2 size={15} className="animate-spin" />} Salvar</button>
      </div>
    </div>}

    {adding && <div role="dialog" aria-modal="true" aria-label="Adicionar cliente" className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 backdrop-blur-sm md:items-center md:p-6" onClick={event => { if (event.currentTarget === event.target) setAdding(false) }}>
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-t-3xl border border-white/10 bg-[#0b100e] p-6 md:rounded-3xl">
        <div className="mb-4 flex items-center justify-between"><h2 className="text-lg font-black">Adicionar ao {pipeline?.name}</h2><button type="button" onClick={() => setAdding(false)} aria-label="Fechar" className="rounded-lg p-2 text-slate-500 hover:bg-white/5"><X size={18} /></button></div>
        <input value={search} onChange={event => setSearch(event.target.value)} placeholder="Buscar nome, e-mail, telefone ou ID..." className="mb-3 h-10 w-full rounded-xl border border-white/10 bg-white/[.03] px-3 text-sm outline-none focus:border-emerald-500/40" />
        <div className="space-y-1">{filtered.map(client => <button key={client.id} type="button" onClick={() => void addClient(client)} className="flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left hover:bg-white/[.04]"><span className="min-w-0"><b className="block truncate text-sm">{nameOf(client)}</b><span className="block truncate text-xs text-slate-500">{contactOf(client) || client.id}</span></span><Plus size={15} className="shrink-0 text-emerald-400" /></button>)}{!filtered.length && <p className="py-6 text-center text-sm text-slate-500">Nenhum cliente fora deste pipeline.</p>}</div>
      </div>
    </div>}

    {call && <CrmCallDialog clientId={call.client_id} cardId={call.id} onClose={() => setCall(null)} onLogged={() => { setCall(null); setNotice('Ligação registrada.'); void load(pipelineId) }} />}
  </main>
}
