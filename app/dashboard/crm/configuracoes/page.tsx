'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Loader2, Pencil, Plus, RefreshCw, X } from 'lucide-react'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'
import { hasOrganizationCapability, parseOrganizationAccess, type OrganizationAccess } from '@/lib/auth/organization-access'

type Tag = { id: string; name: string; description: string | null; active: boolean }
type QuickReply = { id: string; title: string; body: string; channel: string; active: boolean }
type ChannelAccount = { id: string; channel: string; provider: string; display_name: string | null; external_account_id: string | null; status: 'active' | 'inactive' | 'error'; credentials_ref: string | null; updated_at: string }
type Tab = 'tags' | 'replies' | 'funnelchat' | 'whatsapp' | 'email' | 'channels'
type Editor =
  | { kind: 'tag'; id: string | null; name: string; description: string; active: boolean }
  | { kind: 'reply'; id: string | null; title: string; body: string; channel: string; active: boolean }
  | { kind: 'channel'; id: string; displayName: string; status: 'active' | 'inactive'; label: string }

const CHANNELS: Record<string, string> = { all: 'Todos os canais', funnel_chat: 'Chat do funil', whatsapp: 'WhatsApp', instagram: 'Instagram', messenger: 'Messenger', email: 'E-mail', sms: 'SMS' }
const STATUS: Record<ChannelAccount['status'], [string, string]> = { active: ['Ativa', 'text-emerald-400'], inactive: ['Pausada', 'text-slate-500'], error: ['Com erro', 'text-red-400'] }
const ERRORS: Record<string, string> = { EMAIL_FROM_INVALID: 'Informe um e-mail de remetente válido (ex.: vendas@seudominio.com).', EMAIL_REPLY_TO_INVALID: 'O e-mail de resposta é inválido.', EMAIL_FROM_TAKEN: 'Esse remetente já está cadastrado.', RESEND_API_KEY_INVALID: 'A API key da Resend começa com re_.', RESEND_API_KEY_REQUIRED: 'Informe a API key da Resend.', DISPLAY_NAME_TOO_LONG: 'Nome muito longo.', INFOBIP_BASE_URL_INVALID: 'Use a URL base da sua conta Infobip (ex.: xxxxx.api.infobip.com).', WHATSAPP_NUMBER_INVALID: 'Informe o número do WhatsApp com DDD.', INFOBIP_API_KEY_REQUIRED: 'Informe a API key da Infobip.', FORBIDDEN: 'Seu acesso não permite alterar esta configuração.', NAME_TAKEN: 'Já existe um item com esse nome.', TAG_NAME_INVALID: 'Informe um nome de até 60 caracteres.', QUICK_REPLY_TITLE_INVALID: 'Informe um título de até 80 caracteres.', QUICK_REPLY_BODY_INVALID: 'Informe o texto da resposta (até 4000 caracteres).' }
const messageOf = (cause: unknown) => { const raw = cause && typeof cause === 'object' && 'message' in cause ? String((cause as { message: unknown }).message) : ''; return ERRORS[raw] ?? 'Não foi possível salvar.' }
const input = 'h-10 w-full rounded-xl border border-white/10 bg-white/[.03] px-3 text-sm outline-none focus:border-emerald-500/40'
const label = 'text-[10px] font-bold uppercase tracking-widest text-slate-500'

type WhatsappState = { status: 'connected' | 'connecting' | 'waiting_scan' | 'disconnected'; qr: string | null; code?: string | null; phone: string | null; account_id?: string }

const bridgeError = (code: unknown) => code === 'WHATSAPP_BRIDGE_NOT_CONFIGURED' ? 'Servidor do WhatsApp (Baileys) não configurado. Peça ao administrador para definir WHATSAPP_BRIDGE_URL e WHATSAPP_BRIDGE_TOKEN.'
  : code === 'WHATSAPP_BRIDGE_UNREACHABLE' ? 'Servidor do WhatsApp fora do ar. Tente de novo em alguns minutos.'
  : code === 'INVALID_PHONE' ? 'Número inválido. Use DDD + número, ex. 11999999999.'
  : code === 'FORBIDDEN' ? 'Seu acesso não permite conectar números.' : 'Servidor do WhatsApp indisponível.'

// Pairs one Baileys number like WhatsApp Web: QR code, or a pairing code sent to the phone.
// accountId null = new number; the account is created on the first "Conectar".
function WhatsappConnect({ accountId, name, onChange }: { accountId: string | null; name?: string; onChange: () => void }) {
  const [id, setId] = useState(accountId)
  const [state, setState] = useState<WhatsappState | null>(null)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState('')
  const [phone, setPhone] = useState('')
  const call = useCallback(async (method: 'GET' | 'POST' | 'DELETE', payload?: { phone?: string; name?: string }) => {
    const res = await fetch(`/api/crm/whatsapp${id ? `?account=${id}` : ''}`, { method, cache: 'no-store', ...(method === 'POST' && { headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload ?? {}) }) })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) { setFailure(bridgeError(data.error)); return }
    setFailure(''); setState(data as WhatsappState)
    if (data.account_id && data.account_id !== id) setId(data.account_id)
    if (method !== 'GET' || data.status === 'connected') onChange()
  }, [id, onChange])
  useEffect(() => { if (id) void call('GET') }, [id]) // só ao montar ou trocar de número
  const pairing = state?.status === 'connecting' || state?.status === 'waiting_scan'
  useEffect(() => {
    if (!pairing) return
    const timer = setInterval(() => void call('GET'), 3000)
    return () => clearInterval(timer)
  }, [pairing, call])
  const act = async (method: 'POST' | 'DELETE', payload?: { phone?: string; name?: string }) => { setBusy(true); await call(method, payload); setBusy(false) }

  return <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
    <div className="min-w-0 flex-1">
      <span className={`text-[11px] ${state?.status === 'connected' ? 'text-emerald-400' : 'text-slate-500'}`}>{state?.status === 'connected' ? `Conectado${state.phone ? ` · +${state.phone}` : ''}` : pairing ? (state.code || phone ? 'Aguardando o código no celular' : 'Aguardando leitura do QR') : 'Desconectado'}</span>
      {failure && <p role="alert" className="mt-1 text-xs text-red-400">{failure}</p>}
      {state?.status === 'waiting_scan' && <p className="mt-1 text-xs text-slate-400">No celular: WhatsApp › Aparelhos conectados › Conectar um aparelho{state.code ? ' › Conectar com número de telefone, e digite o código.' : ' e aponte para o QR Code.'}</p>}
      {!pairing && state?.status !== 'connected' && <div className="mt-3 flex max-w-sm gap-2"><input value={phone} onChange={e => setPhone(e.target.value)} inputMode="tel" placeholder="Número com DDD, ex. 11999999999" aria-label="Número do WhatsApp para conectar com código" className={input} /><button type="button" disabled={busy || !phone.replace(/\D/g, '')} onClick={() => void act('POST', { phone, name })} className="h-10 shrink-0 rounded-xl border border-white/10 px-3 text-sm text-slate-300 hover:bg-white/[.06] disabled:opacity-50">Conectar com código</button></div>}
    </div>
    {state?.status === 'waiting_scan' && state.code && <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-5 py-4 text-center"><div className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Código</div><b className="font-mono text-2xl tracking-[.2em] text-emerald-300">{state.code.slice(0, 4)}-{state.code.slice(4)}</b></div>}
    {state?.status === 'waiting_scan' && state.qr && <img src={state.qr} alt="QR Code para conectar o WhatsApp" className="h-44 w-44 rounded-xl bg-white p-2" />}
    {state?.status === 'connecting' && <Loader2 size={18} className="animate-spin text-emerald-400" />}
    {state?.status === 'connected'
      ? <button type="button" disabled={busy} onClick={() => void act('DELETE')} className="h-9 rounded-xl border border-white/10 px-3 text-sm text-slate-300 hover:bg-white/[.06] disabled:opacity-50">Desconectar</button>
      : !pairing && <button type="button" disabled={busy} onClick={() => void act('POST', { name })} className="h-9 rounded-xl bg-emerald-500 px-3 text-sm font-bold text-black hover:bg-emerald-400 disabled:opacity-50">{busy && <Loader2 size={14} className="mr-1 inline animate-spin" />}Conectar por QR Code</button>}
  </div>
}

type WhatsappNumber = { id: string; provider: 'baileys' | 'infobip'; status: string; display_name: string | null; phone: string | null; base_url: string | null; from_number: string | null; has_api_key: boolean; webhook_token: string | null; last_inbound_at: string | null; last_error: string | null }
type Db = ReturnType<typeof createSupabaseBrowserClient>
const when = (iso: string | null) => iso ? new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : 'nunca'

function InfobipForm({ db, account, onSaved }: { db: Db; account: WhatsappNumber | null; onSaved: () => void }) {
  const [form, setForm] = useState({ name: account?.display_name ?? '', baseUrl: account?.base_url ?? '', from: account?.from_number ?? '', apiKey: '' })
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState('')
  const [test, setTest] = useState<{ running: boolean; ok?: boolean; message?: string }>({ running: false })
  async function runTest() {
    if (!account) return
    setTest({ running: true })
    const response = await fetch(`/api/crm/whatsapp/test?account=${account.id}`, { method: 'POST', cache: 'no-store' }).catch(() => null)
    const result = response ? await response.json().catch(() => ({})) as { ok?: boolean; message?: string } : {}
    setTest({ running: false, ok: result.ok === true, message: result.message ?? 'Não foi possível testar agora.' })
  }
  async function save() {
    setSaving(true); setNotice('')
    const { error } = await db.rpc('crm_whatsapp_configure', { p_provider: 'infobip', p_base_url: form.baseUrl, p_from_number: form.from, p_api_key: form.apiKey || null, p_account_id: account?.id ?? null, p_display_name: form.name || null })
    setSaving(false)
    if (error) { setNotice(messageOf(error)); return }
    setNotice('Salvo. Agora copie o webhook abaixo e cole no portal da Infobip.'); onSaved()
  }
  return <div className="space-y-3">
    <ol className="list-decimal space-y-0.5 pl-4 text-xs text-slate-400">
      <li>No portal da Infobip, copie a <b>URL base</b> (ex.: xxxxx.api.infobip.com) e crie uma <b>API key</b> com permissão de WhatsApp.</li>
      <li>Preencha os campos abaixo e salve.</li>
      <li>Copie o <b>webhook</b> que aparece depois de salvar.</li>
      <li>No portal da Infobip, cole o webhook em <b>mensagens recebidas</b> e em <b>relatórios de entrega</b> deste número.</li>
      <li>Clique em <b>Testar conexão</b> para conferir a chave e o número.</li>
    </ol>
    <label className="block space-y-1"><span className={label}>Nome do número (ex.: Suporte)</span><input value={form.name} maxLength={120} onChange={event => setForm({ ...form, name: event.target.value })} className={input} /></label>
    <label className="block space-y-1"><span className={label}>URL base da Infobip</span><input value={form.baseUrl} placeholder="xxxxx.api.infobip.com" onChange={event => setForm({ ...form, baseUrl: event.target.value })} className={input} /></label>
    <label className="block space-y-1"><span className={label}>Número do WhatsApp (remetente)</span><input value={form.from} inputMode="tel" placeholder="55 11 99999-0000" onChange={event => setForm({ ...form, from: event.target.value })} className={input} /></label>
    <label className="block space-y-1"><span className={label}>API key</span><input type="password" autoComplete="off" value={form.apiKey} placeholder={account?.has_api_key ? '•••••••• (mantida; preencha para trocar)' : ''} onChange={event => setForm({ ...form, apiKey: event.target.value })} className={input} /></label>
    <button type="button" disabled={saving || !form.baseUrl.trim() || !form.from.trim() || (!form.apiKey.trim() && !account?.has_api_key)} onClick={() => void save()} className="flex h-10 items-center gap-2 rounded-xl bg-emerald-500 px-4 text-sm font-bold text-black hover:bg-emerald-400 disabled:opacity-40">{saving && <Loader2 size={15} className="animate-spin" />} Salvar</button>
    {account && <button type="button" disabled={test.running} onClick={() => void runTest()} className="flex h-10 items-center gap-2 rounded-xl border border-white/10 px-4 text-sm hover:bg-white/[.06] disabled:opacity-40">{test.running && <Loader2 size={14} className="animate-spin" />} Testar conexão</button>}
    {test.message && <p role="status" className={`text-xs ${test.ok ? 'text-emerald-400' : 'text-red-400'}`}>{test.message}</p>}
    {notice && <p role="status" className="text-xs text-slate-400">{notice}</p>}
  </div>
}

// Every WhatsApp number of the organization. Each one is Baileys (QR Code) or Infobip (API);
// conversations remember which number they came through and replies go out through it.
function WhatsappPanel({ db }: { db: Db }) {
  const [numbers, setNumbers] = useState<WhatsappNumber[]>([])
  const [adding, setAdding] = useState<'baileys' | 'infobip' | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const reload = useCallback(() => { void db.rpc('crm_whatsapp_settings').then(({ data }: { data: WhatsappNumber[] | null }) => setNumbers(data ?? [])) }, [db])
  useEffect(reload, [reload])
  const webhookOf = (n: WhatsappNumber) => n.provider === 'infobip' && n.webhook_token ? `${process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, '')}/functions/v1/crm-channel-infobip-webhook?account=${n.id}&token=${n.webhook_token}` : ''

  return <div>
    <div className="flex flex-wrap items-center gap-2 border-b border-white/[.06] px-4 py-4">
      <p className="min-w-0 flex-1 text-sm text-slate-400">Cada número recebe as conversas do suporte e pode ser escolhido como remetente no remarketing. No WhatsApp não há resposta automática: quem responde é a equipe.</p>
      <button type="button" onClick={() => setAdding(adding === 'baileys' ? null : 'baileys')} className="inline-flex h-9 items-center gap-1 rounded-xl border border-white/10 px-3 text-sm hover:bg-white/[.06]"><Plus size={14} /> Número por QR Code</button>
      <button type="button" onClick={() => setAdding(adding === 'infobip' ? null : 'infobip')} className="inline-flex h-9 items-center gap-1 rounded-xl border border-white/10 px-3 text-sm hover:bg-white/[.06]"><Plus size={14} /> Número Infobip</button>
    </div>
    {adding && <div className="border-b border-white/[.06] bg-white/[.02] px-4 py-4">
      <b className="mb-3 block text-sm">{adding === 'baileys' ? 'Novo número por QR Code (Baileys)' : 'Novo número Infobip (API oficial)'}</b>
      {adding === 'baileys' ? <WhatsappConnect accountId={null} onChange={reload} /> : <InfobipForm db={db} account={null} onSaved={() => { setAdding(null); reload() }} />}
    </div>}
    {numbers.length === 0 && !adding && <div className="p-10 text-center text-sm text-slate-600">Nenhum número conectado. Adicione um número por QR Code ou pela Infobip.</div>}
    {numbers.map(n => {
      const webhook = webhookOf(n)
      const [statusLabel, tone] = STATUS[n.status as ChannelAccount['status']] ?? ['—', 'text-slate-500']
      return <div key={n.id} className="border-b border-white/[.06] px-4 py-3 last:border-0">
        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <b className="text-sm">{n.display_name || 'WhatsApp'}</b>
            <span className="ml-2 rounded-full bg-white/[.06] px-2 py-0.5 text-[10px] text-slate-400">{n.provider === 'infobip' ? 'Infobip' : 'QR Code'}</span>
            <span className={`ml-2 text-[11px] ${tone}`}>{statusLabel}</span>
            <p className="truncate text-xs text-slate-500">{n.phone || n.from_number ? `+${n.phone || n.from_number}` : 'sem número'} · última mensagem recebida: {when(n.last_inbound_at)}</p>
            {n.last_error && <p className="truncate text-xs text-red-400">Último erro de envio: {n.last_error}</p>}
          </div>
          <button type="button" aria-expanded={open === n.id} onClick={() => setOpen(open === n.id ? null : n.id)} className="rounded-md p-1.5 text-slate-500 hover:bg-white/5 hover:text-white" aria-label={`Configurar ${n.display_name || 'número'}`}><Pencil size={14} /></button>
        </div>
        {open === n.id && <div className="mt-3 space-y-3">
          {n.provider === 'baileys' ? <WhatsappConnect accountId={n.id} name={n.display_name ?? undefined} onChange={reload} /> : <InfobipForm db={db} account={n} onSaved={reload} />}
          {webhook && <label className="block space-y-1"><span className={label}>Webhook deste número (cole na Infobip)</span><input readOnly value={webhook} onFocus={event => event.currentTarget.select()} className={`${input} text-xs text-slate-400`} /></label>}
        </div>}
      </div>
    })}
  </div>
}

type EmailAccount = { id: string; status: string; display_name: string | null; from_email: string | null; from_name: string | null; reply_to: string | null; has_api_key: boolean; last_error: string | null }

function ResendForm({ db, account, onSaved }: { db: Db; account: EmailAccount | null; onSaved: () => void }) {
  const [form, setForm] = useState({ name: account?.from_name ?? '', from: account?.from_email ?? '', replyTo: account?.reply_to ?? '', apiKey: '' })
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState('')
  const [test, setTest] = useState<{ running: boolean; ok?: boolean; message?: string }>({ running: false })
  async function runTest() {
    if (!account) return
    setTest({ running: true })
    const response = await fetch(`/api/crm/email/test?account=${account.id}`, { method: 'POST', cache: 'no-store' }).catch(() => null)
    const result = response ? await response.json().catch(() => ({})) as { ok?: boolean; message?: string } : {}
    setTest({ running: false, ok: result.ok === true, message: result.message ?? 'Não foi possível testar agora.' })
  }
  async function save() {
    setSaving(true); setNotice('')
    const { error } = await db.rpc('crm_email_configure', { p_from_email: form.from, p_from_name: form.name || null, p_reply_to: form.replyTo || null, p_api_key: form.apiKey || null, p_account_id: account?.id ?? null, p_display_name: form.name || null })
    setSaving(false)
    if (error) { setNotice(messageOf(error)); return }
    setForm({ ...form, apiKey: '' })
    setNotice(account ? 'Salvo.' : 'Salvo. Abra a conta e clique em Enviar e-mail de teste.'); onSaved()
  }
  return <div className="space-y-3">
    <ol className="list-decimal space-y-0.5 pl-4 text-xs text-slate-400">
      <li>Na Resend, em <b>Domains</b>, adicione e verifique o domínio do remetente (registros DNS).</li>
      <li>Em <b>API Keys</b>, crie uma chave com permissão de envio (começa com re_).</li>
      <li>Preencha abaixo, salve e envie um e-mail de teste para você.</li>
    </ol>
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="block space-y-1"><span className={label}>Nome do remetente</span><input value={form.name} maxLength={80} placeholder="Althea Pay" onChange={event => setForm({ ...form, name: event.target.value })} className={input} /></label>
      <label className="block space-y-1"><span className={label}>E-mail do remetente</span><input type="email" value={form.from} maxLength={254} placeholder="vendas@seudominio.com" onChange={event => setForm({ ...form, from: event.target.value })} className={input} /></label>
      <label className="block space-y-1"><span className={label}>Responder para (opcional)</span><input type="email" value={form.replyTo} maxLength={254} placeholder="suporte@seudominio.com" onChange={event => setForm({ ...form, replyTo: event.target.value })} className={input} /></label>
      <label className="block space-y-1"><span className={label}>API key da Resend</span><input type="password" autoComplete="off" value={form.apiKey} placeholder={account?.has_api_key ? '•••••••• (mantida; preencha para trocar)' : 're_...'} onChange={event => setForm({ ...form, apiKey: event.target.value })} className={input} /></label>
    </div>
    <div className="flex flex-wrap gap-2">
      <button type="button" disabled={saving || !form.from.trim() || (!form.apiKey.trim() && !account?.has_api_key)} onClick={() => void save()} className="flex h-10 items-center gap-2 rounded-xl bg-emerald-500 px-4 text-sm font-bold text-black hover:bg-emerald-400 disabled:opacity-40">{saving && <Loader2 size={15} className="animate-spin" />} Salvar</button>
      {account && <button type="button" disabled={test.running} onClick={() => void runTest()} className="flex h-10 items-center gap-2 rounded-xl border border-white/10 px-4 text-sm hover:bg-white/[.06] disabled:opacity-40">{test.running && <Loader2 size={14} className="animate-spin" />} Enviar e-mail de teste</button>}
    </div>
    {test.message && <p role="status" className={`text-xs ${test.ok ? 'text-emerald-400' : 'text-red-400'}`}>{test.message}</p>}
    {notice && <p role="status" className="text-xs text-slate-400">{notice}</p>}
  </div>
}

// E-mail senders (Resend). Each one shows up in "Enviar de" for campaigns and remarketing rules.
function EmailPanel({ db }: { db: Db }) {
  const [accounts, setAccounts] = useState<EmailAccount[]>([])
  const [adding, setAdding] = useState(false)
  const [open, setOpen] = useState<string | null>(null)
  const reload = useCallback(() => { void db.rpc('crm_email_settings').then(({ data }: { data: EmailAccount[] | null }) => setAccounts(data ?? [])) }, [db])
  useEffect(reload, [reload])
  return <div>
    <div className="flex flex-wrap items-center gap-2 border-b border-white/[.06] px-4 py-4">
      <p className="min-w-0 flex-1 text-sm text-slate-400">Remetentes de e-mail pela Resend. Cada um pode ser escolhido em campanhas e no remarketing automático. Os textos e o visual ficam em <b>Campanhas &gt; Templates</b>.</p>
      <button type="button" onClick={() => setAdding(!adding)} className="inline-flex h-9 items-center gap-1 rounded-xl border border-white/10 px-3 text-sm hover:bg-white/[.06]"><Plus size={14} /> Remetente Resend</button>
    </div>
    {adding && <div className="border-b border-white/[.06] bg-white/[.02] px-4 py-4"><b className="mb-3 block text-sm">Novo remetente (Resend)</b><ResendForm db={db} account={null} onSaved={() => { setAdding(false); reload() }} /></div>}
    {accounts.length === 0 && !adding && <div className="p-10 text-center text-sm text-slate-600">Nenhum remetente de e-mail. Adicione um para enviar remarketing por e-mail.</div>}
    {accounts.map(account => {
      const [statusLabel, tone] = STATUS[account.status as ChannelAccount['status']] ?? ['—', 'text-slate-500']
      return <div key={account.id} className="border-b border-white/[.06] px-4 py-3 last:border-0">
        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <b className="text-sm">{account.from_name || account.display_name || 'E-mail'}</b>
            <span className="ml-2 rounded-full bg-white/[.06] px-2 py-0.5 text-[10px] text-slate-400">Resend</span>
            <span className={`ml-2 text-[11px] ${tone}`}>{statusLabel}</span>
            <p className="truncate text-xs text-slate-500">{account.from_email}{account.reply_to ? ` · responde para ${account.reply_to}` : ''}</p>
            {account.last_error && <p className="truncate text-xs text-red-400">Último erro de envio: {account.last_error}</p>}
          </div>
          <button type="button" aria-expanded={open === account.id} onClick={() => setOpen(open === account.id ? null : account.id)} className="rounded-md p-1.5 text-slate-500 hover:bg-white/5 hover:text-white" aria-label={`Configurar ${account.from_email ?? 'remetente'}`}><Pencil size={14} /></button>
        </div>
        {open === account.id && <div className="mt-3"><ResendForm key={account.id} db={db} account={account} onSaved={reload} /></div>}
      </div>
    })}
  </div>
}

const FLOW_FIELDS: [string, string, string][] = [
  ['welcome', 'Boas-vindas (primeira mensagem do cliente)', 'Use {nome} e {funil}. Mostre as opções 1, 2 e 3.'],
  ['status', 'Opção 1 · status do pagamento', '{status} vira: aprovado, aguardando pagamento, não aprovado…'],
  ['receipt_prompt', 'Opção 2 · pedir comprovante', ''],
  ['receipt_received', 'Comprovante recebido', 'Depois disso a conversa vai para a equipe.'],
  ['human', 'Opção 3 · falar com atendente', 'Depois disso o automático para e a conversa fica Pendente.'],
  ['fallback', 'Quando não entender a resposta', ''],
]

// Automatic replies of the funnel chat (never on WhatsApp). One default flow plus optional per-funnel overrides.
// Empty fields fall back to the platform text.
function FunnelChatFlowPanel({ db, organizationId, canEdit }: { db: Db; organizationId: string; canEdit: boolean }) {
  const [funnels, setFunnels] = useState<{ id: string; nome: string }[]>([])
  const [funnelId, setFunnelId] = useState('')
  const [enabled, setEnabled] = useState(true)
  const [texts, setTexts] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState('')
  useEffect(() => { void db.from('funnels').select('id,nome').eq('organization_id', organizationId).is('deleted_at', null).order('nome').then(({ data }: { data: { id: string; nome: string }[] | null }) => setFunnels(data ?? [])) }, [db, organizationId])
  useEffect(() => {
    setNotice('')
    let query = db.from('crm_funnel_chat_flows').select('enabled,texts').eq('organization_id', organizationId)
    query = funnelId ? query.eq('funnel_id', funnelId) : query.is('funnel_id', null)
    void query.maybeSingle().then(({ data }: { data: { enabled: boolean; texts: Record<string, string> } | null }) => { setEnabled(data?.enabled ?? true); setTexts(data?.texts ?? {}) })
  }, [db, organizationId, funnelId])
  async function save() {
    setSaving(true); setNotice('')
    const { error } = await db.rpc('crm_funnel_chat_flow_save', { p_funnel_id: funnelId || null, p_enabled: enabled, p_texts: texts })
    setSaving(false)
    setNotice(error ? (error.message === 'TEXT_TOO_LONG' ? 'Cada texto pode ter até 2000 caracteres.' : messageOf(error)) : 'Salvo. Vale para as próximas mensagens.')
  }
  return <div className="space-y-4 px-4 py-4">
    <p className="text-sm text-slate-400">Quando o cliente escreve no <b>chat do funil</b>, o atendimento automático responde com um menu (1, 2, 3). Ao escolher <b>falar com atendente</b>, enviar comprovante, ou quando alguém da equipe responde, o automático para. As respostas automáticas aparecem no CRM com a etiqueta “Automática”. <b>No WhatsApp não há resposta automática.</b></p>
    <div className="flex flex-wrap items-end gap-3">
      <label className="block min-w-56 space-y-1"><span className={label}>Funil</span><select value={funnelId} onChange={event => setFunnelId(event.target.value)} className={`${input} bg-[#0b100e]`}><option value="">Padrão (todos os funis)</option>{funnels.map(f => <option key={f.id} value={f.id}>{f.nome}</option>)}</select></label>
      <label className="flex h-10 items-center gap-2 text-sm"><input type="checkbox" checked={enabled} disabled={!canEdit} onChange={event => setEnabled(event.target.checked)} className="accent-emerald-500" /> Respostas automáticas ligadas</label>
    </div>
    {FLOW_FIELDS.map(([key, title, hint]) => <label key={key} className="block space-y-1"><span className={label}>{title}</span><textarea value={texts[key] ?? ''} disabled={!canEdit} maxLength={2000} rows={key === 'welcome' || key === 'fallback' ? 5 : 2} placeholder="Texto padrão da plataforma" onChange={event => setTexts({ ...texts, [key]: event.target.value })} className="w-full rounded-xl border border-white/10 bg-white/[.03] px-3 py-2 text-sm outline-none focus:border-emerald-500/40 disabled:opacity-60" />{hint && <span className="text-[11px] text-slate-500">{hint}</span>}</label>)}
    {canEdit ? <button type="button" disabled={saving} onClick={() => void save()} className="flex h-10 items-center gap-2 rounded-xl bg-emerald-500 px-4 text-sm font-bold text-black hover:bg-emerald-400 disabled:opacity-40">{saving && <Loader2 size={15} className="animate-spin" />} Salvar</button> : <p className="text-xs text-slate-500">Somente leitura: alterar exige a permissão de gerenciar automações.</p>}
    {notice && <p role="status" className="text-xs text-slate-400">{notice}</p>}
  </div>
}

export default function CrmConfiguracoesPage() {
  const db = useMemo(() => createSupabaseBrowserClient(), [])
  const [access, setAccess] = useState<OrganizationAccess | null>(null)
  const [tab, setTab] = useState<Tab>('tags')
  const [tags, setTags] = useState<Tag[]>([])
  const [replies, setReplies] = useState<QuickReply[]>([])
  const [channels, setChannels] = useState<ChannelAccount[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [editor, setEditor] = useState<Editor | null>(null)
  const [saving, setSaving] = useState(false)
  const canConfigure = hasOrganizationCapability(access, 'can_manage_automations')
  const canIntegrations = hasOrganizationCapability(access, 'can_manage_integrations')

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const accessResult = await db.rpc('organization_my_access_v1', { p_organization_id: null })
      if (accessResult.error) throw accessResult.error
      const current = parseOrganizationAccess(accessResult.data)
      setAccess(current)
      if (!current) return
      const org = current.organization_id
      const [tagResult, replyResult, channelResult] = await Promise.all([
        db.from('crm_tags').select('id,name,description,active').eq('organization_id', org).order('name'),
        db.from('crm_quick_replies').select('id,title,body,channel,active').eq('organization_id', org).order('title'),
        hasOrganizationCapability(current, 'can_manage_integrations')
          ? db.from('crm_channel_accounts').select('id,channel,provider,display_name,external_account_id,status,credentials_ref,updated_at').eq('organization_id', org).order('channel')
          : Promise.resolve({ data: [], error: null }),
      ])
      for (const result of [tagResult, replyResult, channelResult]) if (result.error) throw result.error
      setTags((tagResult.data ?? []) as Tag[])
      setReplies((replyResult.data ?? []) as QuickReply[])
      setChannels((channelResult.data ?? []) as ChannelAccount[])
    } catch (cause) {
      console.error('[ALTHEA-CRM-CONFIG]', cause)
      setError('Não foi possível carregar as configurações do CRM.')
    } finally { setLoading(false) }
  }, [db])

  useEffect(() => { void load() }, [load])

  async function save() {
    if (!editor) return
    setSaving(true); setError('')
    const result = editor.kind === 'tag'
      ? await db.rpc('crm_tag_save', { p_id: editor.id, p_name: editor.name, p_description: editor.description, p_active: editor.active })
      : editor.kind === 'reply'
        ? await db.rpc('crm_quick_reply_save', { p_id: editor.id, p_title: editor.title, p_body: editor.body, p_channel: editor.channel, p_active: editor.active })
        : await db.rpc('crm_channel_account_update', { p_id: editor.id, p_display_name: editor.displayName, p_status: editor.status })
    setSaving(false)
    if (result.error) { setError(messageOf(result.error)); return }
    setEditor(null)
    await load()
  }

  const tabs: [Tab, string, number][] = [['tags', 'Etiquetas', tags.length], ['replies', 'Respostas rápidas', replies.length], ['funnelchat', 'Chat do funil', 0], ...(canIntegrations ? [['whatsapp', 'WhatsApp', channels.filter(account => account.channel === 'whatsapp').length], ['email', 'E-mail', channels.filter(account => account.channel === 'email').length], ['channels', 'Outros canais', channels.filter(account => account.channel !== 'whatsapp').length]] as [Tab, string, number][] : [])]
  const empty = (text: string) => <div className="p-10 text-center text-sm text-slate-600">{text}</div>
  const editButton = (name: string, onClick: () => void) => <button type="button" aria-label={`Editar ${name}`} onClick={onClick} className="rounded-md p-1.5 text-slate-500 hover:bg-white/5 hover:text-white"><Pencil size={14} /></button>
  const inactive = (active: boolean) => !active && <span className="ml-2 rounded-full bg-white/[.06] px-2 py-0.5 text-[10px] text-slate-500">inativa</span>
  const canAdd = tab === 'tags' || tab === 'replies' ? canConfigure : false

  return <main className="min-h-screen bg-[#070A09] px-4 py-6 text-slate-100 lg:px-8">
    <div className="mx-auto max-w-4xl">
      <header className="mb-6 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div><div className="mb-2 text-[10px] font-black uppercase tracking-[.28em] text-emerald-400">ALTHEA PAY // CRM</div><h1 className="text-3xl font-black tracking-tight">Configurações do CRM</h1><p className="mt-1 text-sm text-slate-500">Etiquetas, respostas rápidas e canais conectados da organização.</p></div>
        <div className="flex gap-2">
          {canAdd && <button type="button" onClick={() => setEditor(tab === 'tags' ? { kind: 'tag', id: null, name: '', description: '', active: true } : { kind: 'reply', id: null, title: '', body: '', channel: 'all', active: true })} className="inline-flex h-10 items-center gap-2 rounded-xl bg-emerald-500 px-4 text-sm font-bold text-black hover:bg-emerald-400"><Plus size={15} /> {tab === 'tags' ? 'Nova etiqueta' : 'Nova resposta'}</button>}
          <button type="button" onClick={() => void load()} disabled={loading} aria-label="Atualizar" className="inline-flex h-10 items-center rounded-xl border border-white/10 bg-white/[.03] px-3 hover:bg-white/[.06] disabled:opacity-50"><RefreshCw size={15} className={loading ? 'animate-spin' : ''} /></button>
        </div>
      </header>

      <div role="tablist" aria-label="Seção" className="mb-4 flex flex-wrap gap-1">{tabs.map(([id, name, count]) => <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)} className={`rounded-lg px-3 py-1.5 text-sm ${tab === id ? 'bg-white/[.08] text-white' : 'text-slate-500 hover:text-slate-300'}`}>{name} {id !== 'funnelchat' && <span className="text-slate-600">{count}</span>}</button>)}</div>
      {error && <div role="alert" className="mb-4 rounded-xl border border-red-500/20 bg-red-500/[.06] px-4 py-3 text-sm text-red-300">{error}</div>}
      {!canConfigure && (tab === 'tags' || tab === 'replies') && !loading && <p className="mb-4 text-xs text-slate-500">Somente leitura: alterar etiquetas e respostas exige a permissão de gerenciar automações.</p>}

      <section className="overflow-hidden rounded-2xl border border-white/10 bg-white/[.02]">
        {loading ? <div className="flex min-h-40 items-center justify-center gap-2 text-slate-500"><Loader2 size={18} className="animate-spin text-emerald-400" /> Carregando</div>
          : tab === 'tags' ? (tags.length ? tags.map(tag => <div key={tag.id} className="flex items-center gap-3 border-b border-white/[.06] px-4 py-3 last:border-0"><div className="min-w-0 flex-1"><b className="text-sm">{tag.name}</b>{inactive(tag.active)}{tag.description && <p className="truncate text-xs text-slate-500">{tag.description}</p>}</div>{canConfigure && editButton(tag.name, () => setEditor({ kind: 'tag', id: tag.id, name: tag.name, description: tag.description ?? '', active: tag.active }))}</div>) : empty('Nenhuma etiqueta. Etiquetas organizam conversas por assunto ou perfil.'))
          : tab === 'replies' ? (replies.length ? replies.map(reply => <div key={reply.id} className="flex items-start gap-3 border-b border-white/[.06] px-4 py-3 last:border-0"><div className="min-w-0 flex-1"><b className="text-sm">{reply.title}</b>{inactive(reply.active)}<span className="ml-2 text-[11px] text-slate-500">{CHANNELS[reply.channel] ?? reply.channel}</span><p className="mt-0.5 line-clamp-2 whitespace-pre-wrap text-xs text-slate-500">{reply.body}</p></div>{canConfigure && editButton(reply.title, () => setEditor({ kind: 'reply', id: reply.id, title: reply.title, body: reply.body, channel: reply.channel, active: reply.active }))}</div>) : empty('Nenhuma resposta rápida. Cadastre textos que a equipe envia com frequência.'))
          : tab === 'funnelchat' ? (access ? <FunnelChatFlowPanel db={db} organizationId={access.organization_id} canEdit={canConfigure} /> : null)
          : tab === 'whatsapp' ? <WhatsappPanel db={db} />
          : tab === 'email' ? <EmailPanel db={db} />
          : channels.filter(account => account.channel !== 'whatsapp').length ? channels.filter(account => account.channel !== 'whatsapp').map(account => { const [statusLabel, tone] = STATUS[account.status]; const name = account.display_name || `${CHANNELS[account.channel] ?? account.channel} · ${account.provider}`; return <div key={account.id} className="flex items-center gap-3 border-b border-white/[.06] px-4 py-3 last:border-0"><div className="min-w-0 flex-1"><b className="text-sm">{name}</b><span className={`ml-2 text-[11px] ${tone}`}>{statusLabel}</span><p className="truncate text-xs text-slate-500">{CHANNELS[account.channel] ?? account.channel} · {account.provider}{account.external_account_id ? ` · ${account.external_account_id}` : ''} · {account.credentials_ref ? 'credencial configurada' : 'sem credencial'}</p></div>{editButton(name, () => setEditor({ kind: 'channel', id: account.id, displayName: account.display_name ?? '', status: account.status === 'active' ? 'active' : 'inactive', label: name }))}</div> }) : empty('Nenhum outro canal conectado. A conexão de e-mail e SMS é feita pela equipe Althea.')}
      </section>
    </div>

    {editor && <div role="dialog" aria-modal="true" aria-label="Editar" className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 backdrop-blur-sm md:items-center md:p-6" onClick={event => { if (event.currentTarget === event.target) setEditor(null) }}>
      <div className="w-full max-w-lg rounded-t-3xl border border-white/10 bg-[#0b100e] p-6 md:rounded-3xl">
        <div className="mb-5 flex items-center justify-between"><h2 className="text-lg font-black">{editor.kind === 'tag' ? (editor.id ? 'Editar etiqueta' : 'Nova etiqueta') : editor.kind === 'reply' ? (editor.id ? 'Editar resposta' : 'Nova resposta') : editor.label}</h2><button type="button" onClick={() => setEditor(null)} aria-label="Fechar" className="rounded-lg p-2 text-slate-500 hover:bg-white/5"><X size={18} /></button></div>
        <div className="space-y-3">
          {editor.kind === 'tag' && <>
            <label className="block space-y-1"><span className={label}>Nome</span><input value={editor.name} maxLength={60} onChange={event => setEditor({ ...editor, name: event.target.value })} className={input} /></label>
            <label className="block space-y-1"><span className={label}>Descrição</span><input value={editor.description} maxLength={500} onChange={event => setEditor({ ...editor, description: event.target.value })} className={input} /></label>
          </>}
          {editor.kind === 'reply' && <>
            <label className="block space-y-1"><span className={label}>Título</span><input value={editor.title} maxLength={80} onChange={event => setEditor({ ...editor, title: event.target.value })} className={input} /></label>
            <label className="block space-y-1"><span className={label}>Texto</span><textarea value={editor.body} maxLength={4000} rows={5} onChange={event => setEditor({ ...editor, body: event.target.value })} className="w-full rounded-xl border border-white/10 bg-white/[.03] px-3 py-2 text-sm outline-none focus:border-emerald-500/40" /></label>
            <label className="block space-y-1"><span className={label}>Canal</span><select value={editor.channel} onChange={event => setEditor({ ...editor, channel: event.target.value })} className={`${input} bg-[#0b100e]`}>{Object.entries(CHANNELS).map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
          </>}
          {editor.kind === 'channel' && <>
            <label className="block space-y-1"><span className={label}>Nome de exibição</span><input value={editor.displayName} maxLength={120} onChange={event => setEditor({ ...editor, displayName: event.target.value })} className={input} /></label>
            <label className="flex items-center gap-3"><input type="checkbox" checked={editor.status === 'active'} onChange={event => setEditor({ ...editor, status: event.target.checked ? 'active' : 'inactive' })} className="accent-emerald-500" /><span className="text-sm">Conta ativa <span className="block text-xs text-slate-500">Pausada, a conta não envia mensagens: automações, recuperação de checkout e envios do CRM param.</span></span></label>
          </>}
          {editor.kind !== 'channel' && <label className="flex items-center gap-3"><input type="checkbox" checked={editor.active} onChange={event => setEditor({ ...editor, active: event.target.checked })} className="accent-emerald-500" /><span className="text-sm">Ativa</span></label>}
        </div>
        <button type="button" onClick={() => void save()} disabled={saving || (editor.kind === 'tag' && !editor.name.trim()) || (editor.kind === 'reply' && (!editor.title.trim() || !editor.body.trim()))} className="mt-5 flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-emerald-500 text-sm font-bold text-black hover:bg-emerald-400 disabled:opacity-40">{saving && <Loader2 size={15} className="animate-spin" />} Salvar</button>
      </div>
    </div>}
  </main>
}
