'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Copy, Loader2, Mic, Pencil, Plus, RefreshCw, X } from 'lucide-react'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'
import { hasOrganizationCapability, parseOrganizationAccess, type OrganizationAccess } from '@/lib/auth/organization-access'

type Channel = 'whatsapp' | 'email' | 'sms'
type Template = { id: string; name: string; channel: Channel; trigger_event: string | null; subject: string | null; body: string; variables: string[]; whatsapp_template_name: string | null; language: string; active: boolean; whatsapp_header_type: string | null; whatsapp_header_url: string | null; whatsapp_buttons: WaButton[] | null; whatsapp_template_data: Record<string, unknown> | null }
type SegmentDefinition = { tag_ids?: string[]; checkout_status?: string[]; last_activity_days?: number }
type Segment = { id: string; name: string; description: string | null; definition: SegmentDefinition; active: boolean }
type ContactList = { id: string; name: string }
type Campaign = { id: string; name: string; channel_account_id: string; template_id: string | null; message: string | null; segment_id: string | null; list_id: string | null; audio_path: string | null; status: 'draft' | 'scheduled' | 'enqueued' | 'cancelled'; scheduled_at: string | null; enqueued_at: string | null; recipient_count: number }
type Metrics = { campaign_id: string; queued: number; sent: number; delivered: number; read: number; failed: number; opted_out: number }
type Account = { id: string; channel: string; provider: string; display_name: string | null; status: string }
type Tag = { id: string; name: string }
type Tab = 'campaigns' | 'links' | 'templates' | 'segments'
type CheckoutLink = { id: string; funnel_id: string; name: string; price: number; currency: string; status: string; created_at: string }
type Funnel = { id: string; nome: string }
type WaButton = { type: keyof typeof WA_BUTTONS; parameter: string }
// Infobip send API (templateData): header types and send-time buttons; the value hint says what each one takes.
const WA_HEADERS: Record<string, [string, string]> = { IMAGE: ['Imagem', 'https://... (jpg/png)'], VIDEO: ['Vídeo', 'https://... (mp4)'], DOCUMENT: ['Documento', 'https://... (pdf)'], GIF: ['GIF', 'https://... (mp4)'], TEXT: ['Texto', 'Valor do {{1}} do cabeçalho'], LOCATION: ['Localização', 'latitude,longitude'] }
const WA_BUTTONS = { QUICK_REPLY: ['Resposta rápida', 'Payload devolvido no toque'], URL: ['Link dinâmico', 'Final do link, no lugar do {{1}}'], COPY_CODE: ['Copiar código', 'Código do cupom'], FLOW: ['Flow', 'flowToken (opcional)'], VOICE_CALL: ['Ligação', 'callContextPayload (opcional)'], CATALOG: ['Catálogo', 'ID do produto da miniatura (opcional)'], MULTI_PRODUCT: ['Vários produtos', 'ID do produto da miniatura (opcional)'] } as const
const waHeaderValid = (type: string, value: string) => !type || (['IMAGE', 'VIDEO', 'DOCUMENT', 'GIF'].includes(type) ? /^(https:\/\/\S+|\{\{\d+\}\})$/.test(value) : type === 'LOCATION' ? /^\s*-?\d+(\.\d+)?\s*,\s*-?\d+(\.\d+)?\s*$/.test(value) : !!value)
const waDataValid = (raw: string) => { if (!raw.trim()) return true; try { const v = JSON.parse(raw); return !!v && typeof v === 'object' && !Array.isArray(v) } catch { return false } }
type Editor =
  | { kind: 'campaign'; id: string | null; name: string; accountId: string; templateId: string; message: string; target: 'list' | 'segment'; segmentId: string; listId: string; audioPath: string; uploading: boolean }
  | { kind: 'template'; id: string | null; name: string; channel: Channel; subject: string; body: string; variables: string[]; waName: string; language: string; headerType: string; headerUrl: string; buttons: WaButton[]; waData: string; recovery: boolean; active: boolean }
  | { kind: 'segment'; id: string | null; name: string; description: string; tagIds: string[]; checkout: string[]; days: string; active: boolean }
  | { kind: 'schedule'; id: string; name: string; at: string }
  | { kind: 'link'; id: null; name: string; funnelId: string; price: string }

const CHANNELS: Record<string, string> = { whatsapp: 'WhatsApp', email: 'E-mail', sms: 'SMS' }
const VARIABLES: Record<string, string> = { nome: 'Nome', primeiro_nome: 'Primeiro nome', email: 'E-mail', telefone: 'Telefone', link: 'Link do checkout', valor: 'Valor', produto: 'Produto' }
// {chave} placeholders of the campaign text (private.crm_render_named).
const MESSAGE_VARIABLES = ['nome', 'primeiro_nome', 'email', 'telefone', 'link', 'valor', 'produto'] as const
const CHECKOUT: Record<string, string> = { respondendo_quiz: 'Respondendo quiz', no_checkout: 'Sem checkout', parado_no_caixa: 'Parado no caixa', cartao_recusado: 'Cartão recusado', pago: 'Pago' }
const STATUS: Record<Campaign['status'], [string, string]> = { draft: ['Rascunho', 'text-slate-400'], scheduled: ['Agendada', 'text-amber-300'], enqueued: ['Disparada', 'text-emerald-400'], cancelled: ['Cancelada', 'text-slate-600'] }
const ERRORS: Record<string, string> = {
  FORBIDDEN: 'Seu acesso não permite alterar campanhas.', NAME_TAKEN: 'Já existe um item com esse nome.', TEMPLATE_INVALID: 'Revise o template: e-mail exige assunto.',
  SEGMENT_DEFINITION_INVALID: 'Revise os filtros do segmento.', SEGMENT_NAME_INVALID: 'Informe um nome de até 80 caracteres.', CAMPAIGN_REFERENCES_INVALID: 'Conta, template e lista/segmento precisam ser da organização e do mesmo canal.', CAMPAIGN_AUDIO_INVALID: 'Áudio só pode ser enviado no WhatsApp.',
  CAMPAIGN_CONTENT_REQUIRED: 'Escreva a mensagem da campanha ou escolha um template.', CHECKOUT_LINK_PRICE_INVALID: 'Informe um valor maior que zero, com até 2 casas decimais.', FUNNEL_OFFER_NOT_FOUND: 'Este funil não tem oferta principal ativa para gerar o link.', FUNNEL_NOT_FOUND: 'Funil não encontrado.',
  CAMPAIGN_STATUS_CONFLICT: 'A campanha mudou de estado, ou a conta/template está inativo. Atualize a página.', CAMPAIGN_NOT_EDITABLE: 'Só rascunhos podem ser editados.', CAMPAIGN_ENQUEUE_FAILED: 'Não foi possível montar a fila de envio. Tente de novo.', SEND_NOW_FAILED: 'Não foi possível enviar agora. Tente de novo.', UNAUTHORIZED: 'Sessão expirada. Entre de novo.',
}
const messageOf = (cause: unknown) => { const raw = cause && typeof cause === 'object' && 'message' in cause ? String((cause as { message: unknown }).message) : ''; return ERRORS[raw] ?? 'Não foi possível salvar.' }
const input = 'h-10 w-full rounded-xl border border-white/10 bg-white/[.03] px-3 text-sm outline-none focus:border-emerald-500/40'
const label = 'text-[10px] font-bold uppercase tracking-widest text-slate-500'
const toggle = (list: string[], value: string) => list.includes(value) ? list.filter(item => item !== value) : [...list, value]
// "1.234,56" and "47,90" (pt-BR) or "47.90"
const priceOf = (value: string) => Number(value.includes(',') ? value.replace(/\./g, '').replace(',', '.') : value)
const checkoutUrl = (link: CheckoutLink) => `${typeof window === 'undefined' ? '' : window.location.origin}/checkout/${encodeURIComponent(link.funnel_id)}?offer=${link.id}`
const localNow = () => { const d = new Date(Date.now() + 10 * 60_000); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16) }

export default function CrmCampanhasPage() {
  const db = useMemo(() => createSupabaseBrowserClient(), [])
  const [access, setAccess] = useState<OrganizationAccess | null>(null)
  const [tab, setTab] = useState<Tab>('campaigns')
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [metrics, setMetrics] = useState<Record<string, Metrics>>({})
  const [templates, setTemplates] = useState<Template[]>([])
  const [segments, setSegments] = useState<Segment[]>([])
  const [lists, setLists] = useState<ContactList[]>([])
  const [accounts, setAccounts] = useState<Account[]>([])
  const [tags, setTags] = useState<Tag[]>([])
  const [links, setLinks] = useState<CheckoutLink[]>([])
  const [funnels, setFunnels] = useState<Funnel[]>([])
  const [copied, setCopied] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [editor, setEditor] = useState<Editor | null>(null)
  const [audience, setAudience] = useState<number | null>(null)
  const [saving, setSaving] = useState(false)
  const canManage = hasOrganizationCapability(access, 'can_manage_automations')

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const accessResult = await db.rpc('organization_my_access_v1', { p_organization_id: null })
      if (accessResult.error) throw accessResult.error
      const current = parseOrganizationAccess(accessResult.data)
      setAccess(current)
      if (!current) return
      const org = current.organization_id
      const [campaignResult, templateResult, segmentResult, accountResult, tagResult, listResult, linkResult, funnelResult] = await Promise.all([
        db.from('crm_campaigns').select('id,name,channel_account_id,template_id,message,segment_id,list_id,audio_path,status,scheduled_at,enqueued_at,recipient_count').eq('organization_id', org).order('created_at', { ascending: false }).limit(100),
        db.from('crm_message_templates').select('id,name,channel,trigger_event,subject,body,variables,whatsapp_template_name,language,active,whatsapp_header_type,whatsapp_header_url,whatsapp_buttons,whatsapp_template_data').eq('organization_id', org).order('name'),
        db.from('crm_segments').select('id,name,description,definition,active').eq('organization_id', org).order('name'),
        hasOrganizationCapability(current, 'can_manage_integrations') || hasOrganizationCapability(current, 'can_manage_automations')
          ? db.from('crm_channel_accounts').select('id,channel,provider,display_name,status').eq('organization_id', org).in('channel', ['whatsapp', 'email', 'sms'])
          : Promise.resolve({ data: [], error: null }),
        db.from('crm_tags').select('id,name').eq('organization_id', org).eq('active', true).order('name'),
        db.from('crm_contact_lists').select('id,name').eq('organization_id', org).order('name'),
        db.from('funnel_offers').select('id,funnel_id,name,price,currency,status,created_at').eq('organization_id', org).eq('offer_type', 'remarketing').order('created_at', { ascending: false }),
        db.from('funnels').select('id,nome').eq('organization_id', org).is('deleted_at', null).order('nome'),
      ])
      for (const result of [campaignResult, templateResult, segmentResult, accountResult, tagResult, listResult, linkResult, funnelResult]) if (result.error) throw result.error
      setLinks((linkResult.data ?? []) as CheckoutLink[])
      setFunnels((funnelResult.data ?? []) as Funnel[])
      setLists((listResult.data ?? []) as ContactList[])
      const list = (campaignResult.data ?? []) as Campaign[]
      setCampaigns(list)
      setTemplates((templateResult.data ?? []) as Template[])
      setSegments((segmentResult.data ?? []) as Segment[])
      setAccounts((accountResult.data ?? []) as Account[])
      setTags((tagResult.data ?? []) as Tag[])
      if (list.length) {
        const metricResult = await db.rpc('crm_campaign_metrics', { p_campaign_ids: list.map(item => item.id) })
        if (metricResult.error) throw metricResult.error
        setMetrics(Object.fromEntries(((metricResult.data ?? []) as Metrics[]).map(row => [row.campaign_id, row])))
      }
    } catch (cause) {
      console.error('[ALTHEA-CRM-CAMPAIGNS]', cause)
      setError('Não foi possível carregar as campanhas.')
    } finally { setLoading(false) }
  }, [db])

  useEffect(() => { void load() }, [load])

  const campaignChannel = editor?.kind === 'campaign' ? accounts.find(account => account.id === editor.accountId)?.channel : undefined
  const campaignAccount = editor?.kind === 'campaign' ? accounts.find(account => account.id === editor.accountId) : undefined
  const campaignSegment = editor?.kind === 'campaign' && editor.target === 'segment' ? editor.segmentId : ''
  const campaignList = editor?.kind === 'campaign' && editor.target === 'list' ? editor.listId : ''
  useEffect(() => {
    setAudience(null)
    if (!campaignChannel || (!campaignSegment && !campaignList)) return
    let live = true
    const count = campaignList
      ? db.rpc('crm_list_audience_count', { p_list_id: campaignList, p_channel: campaignChannel })
      : db.rpc('crm_segment_audience_count', { p_segment_id: campaignSegment, p_channel: campaignChannel })
    void count.then(({ data, error: countError }: { data: number | null; error: unknown }) => { if (live && !countError) setAudience(Number(data ?? 0)) })
    return () => { live = false }
  }, [db, campaignChannel, campaignSegment, campaignList])

  // Audio goes to the organization's folder in the private crm-campaign-media bucket.
  async function uploadAudio(file: File) {
    if (editor?.kind !== 'campaign' || !access) return
    if (file.size > 16 * 1024 * 1024) { setError('O áudio pode ter no máximo 16 MB.'); return }
    const ext = (file.name.split('.').pop() ?? 'mp3').toLowerCase().replace(/[^a-z0-9]/g, '') || 'mp3'
    const path = `${access.organization_id}/${crypto.randomUUID()}.${ext}`
    setEditor({ ...editor, uploading: true }); setError('')
    const { error: uploadError } = await db.storage.from('crm-campaign-media').upload(path, file, { contentType: file.type || undefined })
    if (uploadError) { setError('Não foi possível enviar o áudio. Use .ogg, .mp3 ou .m4a.'); setEditor({ ...editor, uploading: false }); return }
    setEditor({ ...editor, uploading: false, audioPath: path })
  }

  async function run(call: Promise<{ error: unknown }>) {
    setSaving(true); setError('')
    const result = await call
    setSaving(false)
    if (result.error) { setError(messageOf(result.error)); return }
    setEditor(null)
    await load()
  }

  function save() {
    if (!editor) return
    if (editor.kind === 'campaign') return run(db.rpc('crm_campaign_save', { p_id: editor.id, p_name: editor.name, p_channel_account_id: editor.accountId, p_template_id: editor.templateId || null, p_segment_id: editor.target === 'segment' ? editor.segmentId : null, p_list_id: editor.target === 'list' ? editor.listId : null, p_audio_path: campaignChannel === 'whatsapp' ? editor.audioPath || null : null, p_message: editor.message.trim() || null }))
    if (editor.kind === 'link') return run(db.rpc('crm_checkout_link_create', { p_funnel_id: editor.funnelId, p_price: priceOf(editor.price), p_name: editor.name.trim() || null }))
    if (editor.kind === 'template') return run(db.rpc('crm_template_save', { p_id: editor.id, p_name: editor.name, p_channel: editor.channel, p_body: editor.body.trim() || `Template ${editor.waName.trim()}`, p_variables: editor.variables, p_subject: editor.channel === 'email' ? editor.subject : null, p_whatsapp_template_name: editor.channel === 'whatsapp' ? editor.waName : null, p_language: editor.language, p_trigger_event: editor.recovery ? (editor.channel === 'whatsapp' ? 'payment_pending' : 'checkout_abandoned') : null, p_active: editor.active, p_whatsapp_header_type: editor.channel === 'whatsapp' && editor.waName.trim() && editor.headerType ? editor.headerType : null, p_whatsapp_header_url: editor.channel === 'whatsapp' && editor.waName.trim() && editor.headerType ? editor.headerUrl.trim() : null, p_whatsapp_buttons: editor.channel === 'whatsapp' && editor.waName.trim() && editor.buttons.length ? editor.buttons.map(button => ({ ...button, parameter: button.parameter.trim() })) : null, p_whatsapp_template_data: editor.channel === 'whatsapp' && editor.waName.trim() && editor.waData.trim() ? JSON.parse(editor.waData) : null }))
    if (editor.kind === 'segment') {
      const definition: SegmentDefinition = { ...(editor.tagIds.length ? { tag_ids: editor.tagIds } : {}), ...(editor.checkout.length ? { checkout_status: editor.checkout } : {}), ...(editor.days ? { last_activity_days: Number(editor.days) } : {}) }
      return run(db.rpc('crm_segment_save', { p_id: editor.id, p_name: editor.name, p_definition: definition, p_description: editor.description, p_active: editor.active }))
    }
    return run(db.rpc('crm_campaign_set_status', { p_id: editor.id, p_status: 'scheduled', p_scheduled_at: new Date(editor.at).toISOString() }))
  }

  const sendNow = (campaign: Campaign) => {
    if (!window.confirm(`Enviar a campanha "${campaign.name}" agora?`)) return
    void run(fetch('/api/crm/campaigns/send-now', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: campaign.id }) })
      .then(async res => res.ok ? { error: null } : { error: { message: ((await res.json().catch(() => ({}))) as { error?: string }).error ?? 'SEND_NOW_FAILED' } }))
  }

  const setStatus = (campaign: Campaign, status: 'draft' | 'cancelled') => {
    if (status === 'cancelled' && !window.confirm(`Cancelar a campanha "${campaign.name}"?`)) return
    void run(db.rpc('crm_campaign_set_status', { p_id: campaign.id, p_status: status }))
  }

  const setLinkActive = (link: CheckoutLink, active: boolean) => {
    if (!active && !window.confirm(`Pausar o link "${link.name}"? Quem abrir o link verá o checkout indisponível.`)) return
    void run(db.rpc('crm_checkout_link_set_active', { p_offer_id: link.id, p_active: active }))
  }
  const copyLink = (link: CheckoutLink) => { void navigator.clipboard?.writeText(checkoutUrl(link)).then(() => { setCopied(link.id); setTimeout(() => setCopied(''), 1500) }) }

  const nameOf = <T extends { id: string; name: string }>(list: T[], id: string) => list.find(item => item.id === id)?.name ?? '—'
  const accountName = (account?: Account) => account ? account.display_name || `${CHANNELS[account.channel] ?? account.channel} · ${account.provider}` : '—'
  const tabs: [Tab, string, number][] = [['campaigns', 'Campanhas', campaigns.length], ['links', 'Links de checkout', links.length], ['templates', 'Templates', templates.length], ['segments', 'Segmentos', segments.length]]
  const empty = (text: string) => <div className="p-10 text-center text-sm text-slate-600">{text}</div>
  const editButton = (name: string, onClick: () => void) => <button type="button" aria-label={`Editar ${name}`} onClick={onClick} className="rounded-md p-1.5 text-slate-500 hover:bg-white/5 hover:text-white"><Pencil size={14} /></button>
  const inactive = (active: boolean) => !active && <span className="ml-2 rounded-full bg-white/[.06] px-2 py-0.5 text-[10px] text-slate-500">inativo</span>
  const small = 'rounded-lg border border-white/10 px-2.5 py-1 text-xs hover:bg-white/[.06] disabled:opacity-40'
  const newEditor = (): Editor => tab === 'links' ? { kind: 'link', id: null, name: '', funnelId: funnels[0]?.id ?? '', price: '' }
    : tab === 'campaigns' ? { kind: 'campaign', id: null, name: '', accountId: '', templateId: '', message: '', target: 'list', segmentId: '', listId: '', audioPath: '', uploading: false }
    : tab === 'templates' ? { kind: 'template', id: null, name: '', channel: 'whatsapp', subject: '', body: '', variables: [], waName: '', language: 'pt_BR', headerType: '', headerUrl: '', buttons: [], waData: '', recovery: false, active: true }
      : { kind: 'segment', id: null, name: '', description: '', tagIds: [], checkout: [], days: '', active: true }
  const invalid = !editor ? true
    : editor.kind === 'link' ? !editor.funnelId || !(priceOf(editor.price) > 0)
    : editor.kind === 'campaign' ? !editor.name.trim() || !editor.accountId || !(editor.templateId || editor.message.trim()) || editor.uploading || !(editor.target === 'list' ? editor.listId : editor.segmentId)
      : editor.kind === 'template' ? (editor.channel === 'whatsapp' && !!editor.waName.trim() && (!waHeaderValid(editor.headerType, editor.headerUrl.trim()) || !waDataValid(editor.waData))) || !editor.name.trim() || (!editor.body.trim() && !(editor.channel === 'whatsapp' && editor.waName.trim())) || (editor.channel === 'email' && !editor.subject.trim())
        : editor.kind === 'segment' ? !editor.name.trim()
          : !editor.at

  return <main className="min-h-screen bg-[#070A09] px-4 py-6 text-slate-100 lg:px-8">
    <div className="mx-auto max-w-4xl">
      <header className="mb-6 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div><div className="mb-2 text-[10px] font-black uppercase tracking-[.28em] text-emerald-400">ALTHEA PAY // CRM</div><h1 className="text-3xl font-black tracking-tight">Campanhas</h1><p className="mt-1 text-sm text-slate-500">Remarketing por WhatsApp, e-mail e SMS. Contatos que pediram para sair nunca recebem.</p></div>
        <div className="flex gap-2">
          {canManage && <button type="button" onClick={() => setEditor(newEditor())} className="inline-flex h-10 items-center gap-2 rounded-xl bg-emerald-500 px-4 text-sm font-bold text-black hover:bg-emerald-400"><Plus size={15} /> {tab === 'campaigns' ? 'Nova campanha' : tab === 'links' ? 'Novo link' : tab === 'templates' ? 'Novo template' : 'Novo segmento'}</button>}
          <button type="button" onClick={() => void load()} disabled={loading} aria-label="Atualizar" className="inline-flex h-10 items-center rounded-xl border border-white/10 bg-white/[.03] px-3 hover:bg-white/[.06] disabled:opacity-50"><RefreshCw size={15} className={loading ? 'animate-spin' : ''} /></button>
        </div>
      </header>

      <div role="tablist" aria-label="Seção" className="mb-4 flex flex-wrap gap-1">{tabs.map(([id, name, count]) => <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)} className={`rounded-lg px-3 py-1.5 text-sm ${tab === id ? 'bg-white/[.08] text-white' : 'text-slate-500 hover:text-slate-300'}`}>{name} <span className="text-slate-600">{count}</span></button>)}</div>
      {error && <div role="alert" className="mb-4 rounded-xl border border-red-500/20 bg-red-500/[.06] px-4 py-3 text-sm text-red-300">{error}</div>}
      {!canManage && !loading && <p className="mb-4 text-xs text-slate-500">Somente leitura: criar e disparar campanhas exige a permissão de gerenciar automações.</p>}

      <section className="overflow-hidden rounded-2xl border border-white/10 bg-white/[.02]">
        {loading ? <div className="flex min-h-40 items-center justify-center gap-2 text-slate-500"><Loader2 size={18} className="animate-spin text-emerald-400" /> Carregando</div>
          : tab === 'campaigns' ? (campaigns.length ? campaigns.map(campaign => {
            const [statusLabel, tone] = STATUS[campaign.status]
            const m = metrics[campaign.id]
            return <div key={campaign.id} className="border-b border-white/[.06] px-4 py-3 last:border-0">
              <div className="flex items-center gap-3">
                <div className="min-w-0 flex-1"><b className="text-sm">{campaign.name}</b><span className={`ml-2 text-[11px] ${tone}`}>{statusLabel}</span>
                  <p className="truncate text-xs text-slate-500">{accountName(accounts.find(account => account.id === campaign.channel_account_id))} · {campaign.message ? `"${campaign.message.slice(0, 40)}${campaign.message.length > 40 ? '…' : ''}"` : ''}{campaign.message && campaign.template_id ? ' + ' : ''}{campaign.template_id ? `template ${nameOf(templates, campaign.template_id)}` : ''} · {campaign.list_id ? `lista ${nameOf(lists, campaign.list_id)}` : nameOf(segments, campaign.segment_id ?? '')}{campaign.audio_path ? ' · com áudio' : ''}{campaign.scheduled_at && campaign.status === 'scheduled' ? ` · ${new Date(campaign.scheduled_at).toLocaleString('pt-BR')}` : ''}</p></div>
                {canManage && campaign.status === 'draft' && <>{editButton(campaign.name, () => setEditor({ kind: 'campaign', id: campaign.id, name: campaign.name, accountId: campaign.channel_account_id, templateId: campaign.template_id ?? '', message: campaign.message ?? '', target: campaign.list_id ? 'list' : 'segment', segmentId: campaign.segment_id ?? '', listId: campaign.list_id ?? '', audioPath: campaign.audio_path ?? '', uploading: false }))}<button type="button" className={`${small} border-emerald-500/40 text-emerald-200`} disabled={saving} onClick={() => sendNow(campaign)}>Enviar agora</button><button type="button" className={small} disabled={saving} onClick={() => setEditor({ kind: 'schedule', id: campaign.id, name: campaign.name, at: localNow() })}>Agendar</button></>}
                {canManage && campaign.status === 'scheduled' && <button type="button" className={small} disabled={saving} onClick={() => setStatus(campaign, 'draft')}>Voltar a rascunho</button>}
                {canManage && (campaign.status === 'draft' || campaign.status === 'scheduled') && <button type="button" className={`${small} text-red-300`} disabled={saving} onClick={() => setStatus(campaign, 'cancelled')}>Cancelar</button>}
              </div>
              {campaign.status === 'enqueued' && m && <dl className="mt-2 grid grid-cols-3 gap-2 text-center text-xs sm:grid-cols-6">{([['Contatos', campaign.recipient_count], ['Na fila', m.queued], ['Enviadas', m.sent], ['Entregues', m.delivered], ['Lidas', m.read], ['Falhas', m.failed + m.opted_out]] as [string, number][]).map(([name, value]) => <div key={name} className="rounded-lg bg-white/[.03] px-2 py-1.5"><dt className="text-slate-500">{name}</dt><dd className="font-bold tabular-nums">{value}</dd></div>)}</dl>}
            </div>
          }) : empty('Nenhuma campanha. Monte uma lista em Clientes (ou um segmento) e crie a campanha com a sua mensagem.'))
          : tab === 'links' ? (links.length ? links.map(link => <div key={link.id} className="flex flex-wrap items-center gap-3 border-b border-white/[.06] px-4 py-3 last:border-0">
              <div className="min-w-0 flex-1"><b className="text-sm">{link.name}</b><span className="ml-2 text-sm font-bold text-emerald-300">{new Intl.NumberFormat('pt-BR', { style: 'currency', currency: link.currency || 'BRL' }).format(Number(link.price))}</span>{link.status !== 'active' && <span className="ml-2 rounded-full bg-white/[.06] px-2 py-0.5 text-[10px] text-slate-500">pausado</span>}
                <p className="truncate text-xs text-slate-500">{funnels.find(funnel => funnel.id === link.funnel_id)?.nome ?? link.funnel_id} · {checkoutUrl(link)}</p></div>
              <button type="button" className={`${small} inline-flex items-center gap-1`} onClick={() => copyLink(link)}><Copy size={12} /> {copied === link.id ? 'Copiado' : 'Copiar link'}</button>
              {canManage && <button type="button" className={small} disabled={saving} onClick={() => setLinkActive(link, link.status !== 'active')}>{link.status === 'active' ? 'Pausar' : 'Ativar'}</button>}
            </div>) : empty('Nenhum link. Gere um link de checkout com o valor da condição comercial e use-o na mensagem da campanha.'))
          : tab === 'templates' ? (templates.length ? templates.map(template => <div key={template.id} className="flex items-start gap-3 border-b border-white/[.06] px-4 py-3 last:border-0"><div className="min-w-0 flex-1"><b className="text-sm">{template.name}</b>{inactive(template.active)}<span className="ml-2 text-[11px] text-slate-500">{CHANNELS[template.channel]}{template.whatsapp_template_name ? ` · ${template.whatsapp_template_name}` : ''}</span>{template.trigger_event && <span className="ml-2 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] text-emerald-300">{template.trigger_event === 'payment_pending' ? 'pagamento pendente' : 'recuperação de carrinho'}</span>}<p className="mt-0.5 line-clamp-2 whitespace-pre-wrap text-xs text-slate-500">{template.body}</p></div>{canManage && editButton(template.name, () => setEditor({ kind: 'template', id: template.id, name: template.name, channel: template.channel, subject: template.subject ?? '', body: template.body, variables: template.variables, waName: template.whatsapp_template_name ?? '', language: template.language, headerType: template.whatsapp_header_type ?? '', headerUrl: template.whatsapp_header_url ?? '', buttons: template.whatsapp_buttons ?? [], waData: template.whatsapp_template_data ? JSON.stringify(template.whatsapp_template_data, null, 2) : '', recovery: template.trigger_event !== null, active: template.active }))}</div>) : empty('Nenhum template ainda.'))
          : segments.length ? segments.map(segment => <div key={segment.id} className="flex items-center gap-3 border-b border-white/[.06] px-4 py-3 last:border-0"><div className="min-w-0 flex-1"><b className="text-sm">{segment.name}</b>{inactive(segment.active)}<p className="truncate text-xs text-slate-500">{[segment.definition.tag_ids?.length ? `etiquetas: ${segment.definition.tag_ids.map(id => nameOf(tags, id)).join(', ')}` : '', segment.definition.checkout_status?.length ? `checkout: ${segment.definition.checkout_status.map(s => CHECKOUT[s] ?? s).join(', ')}` : '', segment.definition.last_activity_days ? `ativos nos últimos ${segment.definition.last_activity_days} dias` : ''].filter(Boolean).join(' · ') || 'todos os contatos'}</p></div>{canManage && editButton(segment.name, () => setEditor({ kind: 'segment', id: segment.id, name: segment.name, description: segment.description ?? '', tagIds: segment.definition.tag_ids ?? [], checkout: segment.definition.checkout_status ?? [], days: segment.definition.last_activity_days ? String(segment.definition.last_activity_days) : '', active: segment.active }))}</div>) : empty('Nenhum segmento. Segmentos filtram contatos por etiqueta, situação do checkout e atividade recente.')}
      </section>
    </div>

    {editor && <div role="dialog" aria-modal="true" aria-label="Editar" className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 backdrop-blur-sm md:items-center md:p-6" onClick={event => { if (event.currentTarget === event.target) setEditor(null) }}>
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-t-3xl border border-white/10 bg-[#0b100e] p-6 md:rounded-3xl">
        <div className="mb-5 flex items-center justify-between"><h2 className="text-lg font-black">{editor.kind === 'schedule' ? `Agendar "${editor.name}"` : editor.kind === 'link' ? 'Novo link de checkout' : `${editor.id ? 'Editar' : 'Novo'} ${editor.kind === 'campaign' ? 'campanha' : editor.kind === 'template' ? 'template' : 'segmento'}`}</h2><button type="button" onClick={() => setEditor(null)} aria-label="Fechar" className="rounded-lg p-2 text-slate-500 hover:bg-white/5"><X size={18} /></button></div>
        <div className="space-y-3">
          {editor.kind === 'campaign' && <>
            <label className="block space-y-1"><span className={label}>Nome</span><input value={editor.name} maxLength={120} onChange={event => setEditor({ ...editor, name: event.target.value })} className={input} /></label>
            <label className="block space-y-1"><span className={label}>Conta de envio</span><select value={editor.accountId} onChange={event => setEditor({ ...editor, accountId: event.target.value, templateId: '' })} className={`${input} bg-[#0b100e]`}><option value="">Selecione</option>{accounts.filter(account => account.status === 'active').map(account => <option key={account.id} value={account.id}>{accountName(account)}</option>)}</select></label>
            <label className="block space-y-1"><span className={label}>Mensagem da campanha</span><textarea value={editor.message} maxLength={4000} rows={5} placeholder="Oi {primeiro_nome}! Liberamos uma condição especial pra você: {link}" onChange={event => setEditor({ ...editor, message: event.target.value })} className="w-full rounded-xl border border-white/10 bg-white/[.03] px-3 py-2 text-sm outline-none focus:border-emerald-500/40" /></label>
            <div className="flex flex-wrap gap-1.5">{MESSAGE_VARIABLES.map(key => <button key={key} type="button" onClick={() => setEditor({ ...editor, message: `${editor.message}{${key}}` })} className="rounded-full border border-white/10 px-2.5 py-1 text-xs text-slate-400 hover:border-emerald-500/40">{`{${key}}`}</button>)}
              {links.some(link => link.status === 'active') && <select value="" onChange={event => { const link = links.find(item => item.id === event.target.value); if (link) setEditor({ ...editor, message: `${editor.message}${editor.message && !/\s$/.test(editor.message) ? ' ' : ''}${checkoutUrl(link)}` }) }} className="rounded-full border border-emerald-500/30 bg-[#0b100e] px-2.5 py-1 text-xs text-emerald-200"><option value="">+ Link de checkout</option>{links.filter(link => link.status === 'active').map(link => <option key={link.id} value={link.id}>{link.name} · {Number(link.price).toFixed(2).replace('.', ',')}</option>)}</select>}</div>
            <p className="text-[11px] text-slate-500">Cada contato recebe o texto com os dados dele. {'{link}'}, {'{valor}'} e {'{produto}'} vêm do último checkout do contato; para um valor fixo, insira um link de checkout.</p>
            <label className="block space-y-1"><span className={label}>{campaignChannel === 'whatsapp' ? 'Template aprovado do WhatsApp (quando a Meta exigir)' : 'Template (opcional)'}</span><select value={editor.templateId} disabled={!campaignChannel} onChange={event => setEditor({ ...editor, templateId: event.target.value })} className={`${input} bg-[#0b100e]`}><option value="">{editor.message.trim() ? 'Nenhum: enviar a mensagem da campanha' : 'Selecione'}</option>{templates.filter(template => template.active && template.channel === campaignChannel).map(template => <option key={template.id} value={template.id}>{template.name}</option>)}</select></label>
            {campaignAccount?.provider === 'infobip' && <p className="text-[11px] leading-5 text-amber-300">API oficial (Infobip): a Meta só entrega fora da janela de 24h com template aprovado. Com template escolhido, sai o template aprovado (a mensagem acima fica só como registro); sem template, a mensagem chega apenas a quem falou com você nas últimas 24h.</p>}
            <fieldset className="space-y-1"><legend className={label}>Enviar para</legend>
              <div className="flex gap-1.5">{([['list', 'Lista de clientes'], ['segment', 'Segmento']] as const).map(([id, name]) => <button key={id} type="button" aria-pressed={editor.target === id} onClick={() => setEditor({ ...editor, target: id })} className={`rounded-full border px-3 py-1 text-xs ${editor.target === id ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200' : 'border-white/10 text-slate-400'}`}>{name}</button>)}</div>
            </fieldset>
            {editor.target === 'list'
              ? <label className="block space-y-1"><span className={label}>Lista</span><select value={editor.listId} onChange={event => setEditor({ ...editor, listId: event.target.value })} className={`${input} bg-[#0b100e]`}><option value="">Selecione</option>{lists.map(list => <option key={list.id} value={list.id}>{list.name}</option>)}</select>{!lists.length && <span className="block text-[11px] text-slate-500">Monte uma lista em Clientes: selecione os clientes e use &quot;Adicionar à lista&quot;.</span>}</label>
              : <label className="block space-y-1"><span className={label}>Segmento</span><select value={editor.segmentId} onChange={event => setEditor({ ...editor, segmentId: event.target.value })} className={`${input} bg-[#0b100e]`}><option value="">Selecione</option>{segments.filter(segment => segment.active).map(segment => <option key={segment.id} value={segment.id}>{segment.name}</option>)}</select></label>}
            {campaignChannel === 'whatsapp' && <div className="space-y-1"><span className={label}>Áudio (opcional, enviado antes do texto)</span>
              {campaignAccount?.provider === 'infobip'
                ? <p className="text-[11px] text-amber-300">A Infobip não entrega áudio em campanhas (fora da janela de 24h só template aprovado). Use o Baileys para enviar áudio.</p>
                : editor.audioPath
                  ? <div className="flex items-center gap-2 text-xs text-slate-300"><Mic size={14} className="text-emerald-400" /> {editor.audioPath.split('/').pop()}<button type="button" onClick={() => setEditor({ ...editor, audioPath: '' })} className="text-slate-500 hover:text-white">remover</button></div>
                  : <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-dashed border-white/15 px-3 py-2.5 text-xs text-slate-400 hover:border-emerald-500/40">{editor.uploading ? <Loader2 size={14} className="animate-spin" /> : <Mic size={14} />} {editor.uploading ? 'Enviando…' : 'Escolher arquivo (.ogg vira mensagem de voz; .mp3/.m4a vão como áudio)'}<input type="file" accept="audio/ogg,audio/mpeg,audio/mp4,audio/x-m4a,audio/aac,audio/wav,audio/webm,.ogg,.opus,.mp3,.m4a" className="sr-only" disabled={editor.uploading} onChange={event => { const file = event.target.files?.[0]; if (file) void uploadAudio(file) }} /></label>}
            </div>}
            {audience !== null && <p className="text-xs text-slate-400"><b className="text-white">{audience}</b> contato(s) alcançáveis hoje neste canal, sem contar quem pediu para sair.{campaignChannel === 'whatsapp' && audience > 1 ? ` Os envios saem com 20 a 60 s de intervalo (cerca de ${Math.ceil(audience * 40 / 60)} min no total).` : ''}</p>}
          </>}
          {editor.kind === 'template' && <>
            <label className="block space-y-1"><span className={label}>Nome</span><input value={editor.name} maxLength={80} onChange={event => setEditor({ ...editor, name: event.target.value })} className={input} /></label>
            <label className="block space-y-1"><span className={label}>Canal</span><select value={editor.channel} onChange={event => setEditor({ ...editor, channel: event.target.value as Channel })} className={`${input} bg-[#0b100e]`}>{Object.entries(CHANNELS).map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
            {editor.channel === 'whatsapp' && <div className="grid grid-cols-[1fr_7rem] gap-2"><label className="block space-y-1"><span className={label}>Template aprovado (só Infobip, opcional)</span><input value={editor.waName} placeholder="carrinho_abandonado" onChange={event => setEditor({ ...editor, waName: event.target.value.toLowerCase() })} className={input} /></label><label className="block space-y-1"><span className={label}>Idioma</span><input value={editor.language} onChange={event => setEditor({ ...editor, language: event.target.value })} className={input} /></label></div>}
            {editor.channel === 'whatsapp' && editor.waName.trim() && <p className="text-[11px] leading-5 text-slate-500">O envio segue o template aprovado na Infobip (mídia, botões, carrossel, oferta, com os exemplos aprovados). Preencha abaixo só o que quiser trocar; use {'{{1}}'}, {'{{2}}'}… para usar as variáveis.</p>}
            {editor.channel === 'whatsapp' && editor.waName.trim() && <div className="grid grid-cols-[8rem_1fr] gap-2"><label className="block space-y-1"><span className={label}>Cabeçalho</span><select value={editor.headerType} onChange={event => setEditor({ ...editor, headerType: event.target.value })} className={`${input} bg-[#0b100e]`}><option value="">Automático</option>{Object.entries(WA_HEADERS).map(([id, [name]]) => <option key={id} value={id}>{name}</option>)}</select></label>{editor.headerType && <label className="block space-y-1"><span className={label}>Valor</span><input value={editor.headerUrl} placeholder={WA_HEADERS[editor.headerType]?.[1]} onChange={event => setEditor({ ...editor, headerUrl: event.target.value })} className={input} /></label>}</div>}
            {editor.channel === 'whatsapp' && editor.waName.trim() && <fieldset className="space-y-2"><legend className={label}>Botões, na ordem aprovada (vazio = automático)</legend>
              {editor.buttons.map((button, index) => <div key={index} className="grid grid-cols-[9rem_1fr_auto] gap-2">
                <select value={button.type} onChange={event => setEditor({ ...editor, buttons: editor.buttons.map((b, i) => i === index ? { ...b, type: event.target.value as WaButton['type'] } : b) })} className={`${input} bg-[#0b100e]`}>{Object.entries(WA_BUTTONS).map(([id, [name]]) => <option key={id} value={id}>{name}</option>)}</select>
                <input value={button.parameter} placeholder={WA_BUTTONS[button.type][1]} onChange={event => setEditor({ ...editor, buttons: editor.buttons.map((b, i) => i === index ? { ...b, parameter: event.target.value } : b) })} className={input} />
                <button type="button" onClick={() => setEditor({ ...editor, buttons: editor.buttons.filter((_, i) => i !== index) })} aria-label="Remover botão" className="rounded-lg border border-white/10 px-3 text-xs text-slate-400 hover:text-red-300">✕</button>
              </div>)}
              {editor.buttons.length < 10 && <button type="button" onClick={() => setEditor({ ...editor, buttons: [...editor.buttons, { type: 'QUICK_REPLY', parameter: '' }] })} className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-slate-300 hover:bg-white/[.05]">+ Botão</button>}
            </fieldset>}
            {editor.channel === 'whatsapp' && editor.waName.trim() && <details className="rounded-xl border border-white/10 px-3 py-2" open={!!editor.waData.trim()}><summary className="cursor-pointer text-xs text-slate-400">Avançado: templateData da Infobip (JSON)</summary><textarea value={editor.waData} rows={6} spellCheck={false} placeholder={'{ "carousel": { "cards": [ { "header": { "type": "IMAGE", "mediaUrl": "https://..." } } ] }, "limitedTimeOffer": { "expirationTime": "2026-12-31T23:59:00Z" } }'} onChange={event => setEditor({ ...editor, waData: event.target.value })} className={`mt-2 w-full rounded-xl border bg-white/[.03] px-3 py-2 font-mono text-xs outline-none ${waDataValid(editor.waData) ? 'border-white/10' : 'border-red-500/50'}`} /><p className="mt-1 text-[11px] text-slate-500">Chaves do templateData (carousel, limitedTimeOffer, orderStatus, header, buttons…) exatamente como a API de envio da Infobip; substituem o automático.</p></details>}
            {editor.channel === 'email' && <label className="block space-y-1"><span className={label}>Assunto</span><input value={editor.subject} maxLength={200} onChange={event => setEditor({ ...editor, subject: event.target.value })} className={input} /></label>}
            <label className="block space-y-1"><span className={label}>{editor.channel === 'whatsapp' && editor.waName.trim() ? 'Texto (opcional: a Infobip envia o template aprovado)' : 'Texto'}</span><textarea value={editor.body} maxLength={4000} rows={5} onChange={event => setEditor({ ...editor, body: event.target.value })} className="w-full rounded-xl border border-white/10 bg-white/[.03] px-3 py-2 text-sm outline-none focus:border-emerald-500/40" /></label>
            <fieldset className="space-y-1"><legend className={label}>Variáveis, na ordem {'{{1}}'}, {'{{2}}'}…</legend>
              <div className="flex flex-wrap gap-1.5">{Object.entries(VARIABLES).map(([key, name]) => { const position = editor.variables.indexOf(key); return <button key={key} type="button" aria-pressed={position >= 0} onClick={() => setEditor({ ...editor, variables: toggle(editor.variables, key) })} className={`rounded-full border px-2.5 py-1 text-xs ${position >= 0 ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200' : 'border-white/10 text-slate-400'}`}>{position >= 0 ? `{{${position + 1}}} ` : ''}{name}</button> })}</div>
              <p className="text-[11px] text-slate-500">Link, valor e produto vêm do último checkout do contato. Para um link fixo, escreva-o direto no texto.</p>
            </fieldset>
            <label className="flex items-center gap-3"><input type="checkbox" checked={editor.recovery} onChange={event => setEditor({ ...editor, recovery: event.target.checked })} className="accent-emerald-500" /><span className="text-sm">{editor.channel === 'whatsapp' ? 'Usar na mensagem de pagamento pendente (após 5 min)' : 'Usar na recuperação de carrinho abandonado'} <span className="block text-xs text-slate-500">Um template ativo por canal. Sem ele, é usado o texto padrão. Na Infobip, fora da janela de 24h só template aprovado é entregue.</span></span></label>
          </>}
          {editor.kind === 'segment' && <>
            <label className="block space-y-1"><span className={label}>Nome</span><input value={editor.name} maxLength={80} onChange={event => setEditor({ ...editor, name: event.target.value })} className={input} /></label>
            <label className="block space-y-1"><span className={label}>Descrição</span><input value={editor.description} maxLength={500} onChange={event => setEditor({ ...editor, description: event.target.value })} className={input} /></label>
            <fieldset className="space-y-1"><legend className={label}>Com alguma destas etiquetas</legend><div className="flex flex-wrap gap-1.5">{tags.length ? tags.map(tag => <button key={tag.id} type="button" aria-pressed={editor.tagIds.includes(tag.id)} onClick={() => setEditor({ ...editor, tagIds: toggle(editor.tagIds, tag.id) })} className={`rounded-full border px-2.5 py-1 text-xs ${editor.tagIds.includes(tag.id) ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200' : 'border-white/10 text-slate-400'}`}>{tag.name}</button>) : <span className="text-xs text-slate-600">Nenhuma etiqueta ativa.</span>}</div></fieldset>
            <fieldset className="space-y-1"><legend className={label}>Situação do checkout</legend><div className="flex flex-wrap gap-1.5">{Object.entries(CHECKOUT).map(([key, name]) => <button key={key} type="button" aria-pressed={editor.checkout.includes(key)} onClick={() => setEditor({ ...editor, checkout: toggle(editor.checkout, key) })} className={`rounded-full border px-2.5 py-1 text-xs ${editor.checkout.includes(key) ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200' : 'border-white/10 text-slate-400'}`}>{name}</button>)}</div></fieldset>
            <label className="block space-y-1"><span className={label}>Ativos nos últimos (dias)</span><input type="number" min={1} max={3650} value={editor.days} onChange={event => setEditor({ ...editor, days: event.target.value })} className={input} /></label>
          </>}
          {editor.kind === 'link' && <>
            <label className="block space-y-1"><span className={label}>Funil</span><select value={editor.funnelId} onChange={event => setEditor({ ...editor, funnelId: event.target.value })} className={`${input} bg-[#0b100e]`}><option value="">Selecione</option>{funnels.map(funnel => <option key={funnel.id} value={funnel.id}>{funnel.nome}</option>)}</select></label>
            <label className="block space-y-1"><span className={label}>Valor (R$)</span><input value={editor.price} inputMode="decimal" placeholder="47,90" onChange={event => setEditor({ ...editor, price: event.target.value.replace(/[^\d.,]/g, '') })} className={input} /></label>
            <label className="block space-y-1"><span className={label}>Nome (opcional)</span><input value={editor.name} maxLength={120} placeholder="Ex.: Remarketing outubro 47,90" onChange={event => setEditor({ ...editor, name: event.target.value })} className={input} /></label>
            <p className="text-xs text-slate-500">O link abre o checkout do funil com este valor, cobrado pelo servidor: o cliente não consegue alterar o preço. Pause o link para encerrar a condição.</p>
          </>}
          {editor.kind === 'schedule' && <>
            <label className="block space-y-1"><span className={label}>Disparar em</span><input type="datetime-local" value={editor.at} onChange={event => setEditor({ ...editor, at: event.target.value })} className={input} /></label>
            <p className="text-xs text-slate-500">A lista de contatos é montada no momento do disparo. Até lá dá para voltar a rascunho ou cancelar.</p>
          </>}
          {(editor.kind === 'template' || editor.kind === 'segment') && <label className="flex items-center gap-3"><input type="checkbox" checked={editor.active} onChange={event => setEditor({ ...editor, active: event.target.checked })} className="accent-emerald-500" /><span className="text-sm">Ativo</span></label>}
        </div>
        <button type="button" onClick={() => void save()} disabled={saving || invalid} className="mt-5 flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-emerald-500 text-sm font-bold text-black hover:bg-emerald-400 disabled:opacity-40">{saving && <Loader2 size={15} className="animate-spin" />} {editor.kind === 'schedule' ? 'Agendar disparo' : editor.kind === 'link' ? 'Gerar link' : 'Salvar'}</button>
      </div>
    </div>}
  </main>
}
