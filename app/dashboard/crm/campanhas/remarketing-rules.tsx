'use client'

import { useCallback, useEffect, useState } from 'react'
import { Loader2, Pencil, Plus, Trash2, X } from 'lucide-react'
import type { createSupabaseBrowserClient } from '@/lib/supabase/client'

type Db = ReturnType<typeof createSupabaseBrowserClient>
type Account = { id: string; channel: string; provider: string; display_name: string | null; status: string }
type Funnel = { id: string; nome: string }
type Rule = {
  id: string; funnel_id: string | null; trigger_event: 'payment_pending' | 'checkout_abandoned'; channel: 'email' | 'whatsapp'
  channel_account_id: string; delay_minutes: number; email_subject: string | null; body: string; button_text: string | null; button_url: string | null; active: boolean
}
type Draft = Omit<Rule, 'id' | 'delay_minutes'> & { id: string | null; delay: string; unit: 'min' | 'h' }

const TRIGGERS = { payment_pending: 'Pagamento pendente (PIX gerado e não pago)', checkout_abandoned: 'Checkout abandonado' }
const VARS = '{nome} {primeiro_nome} {email} {telefone} {link} {valor} {produto}'
const input = 'h-10 w-full rounded-xl border border-white/10 bg-black/20 px-3 text-sm outline-none focus:border-emerald-500/50'

const delayLabel = (minutes: number) => minutes % 60 === 0 ? `${minutes / 60} h` : `${minutes} min`
const ERRORS: [string, string][] = [
  ['REMARKETING_SUBJECT_REQUIRED', 'E-mail precisa de assunto.'],
  ['REMARKETING_BUTTON_URL_INVALID', 'O link do botão precisa ser {link} ou começar com https://.'],
  ['REMARKETING_ACCOUNT_INVALID', 'Escolha uma conta remetente do mesmo canal.'],
  ['REMARKETING_DELAY_INVALID', 'O tempo vai de 1 minuto a 7 dias.'],
  ['FORBIDDEN', 'Sem permissão para gerenciar automações.'],
]
const errorText = (message: string) => ERRORS.find(([code]) => message.includes(code))?.[1] ?? 'Não foi possível salvar a regra.'

export function RemarketingRules({ db, organizationId, accounts, funnels, canManage }: { db: Db; organizationId: string; accounts: Account[]; funnels: Funnel[]; canManage: boolean }) {
  const [rules, setRules] = useState<Rule[]>([])
  const [loading, setLoading] = useState(true)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    const { data, error: loadError } = await db.from('crm_remarketing_rules')
      .select('id,funnel_id,trigger_event,channel,channel_account_id,delay_minutes,email_subject,body,button_text,button_url,active')
      .eq('organization_id', organizationId).order('trigger_event').order('delay_minutes')
    setLoading(false)
    if (loadError) { setError('Não foi possível carregar as regras.'); return }
    setRules((data ?? []) as Rule[])
  }, [db, organizationId])
  useEffect(() => { void load() }, [load])

  const senders = (channel: string) => accounts.filter(account => account.channel === channel)
  const accountName = (id: string) => { const account = accounts.find(item => item.id === id); return account ? account.display_name || `${account.channel} · ${account.provider}` : '—' }
  const blank = (): Draft => ({ id: null, funnel_id: null, trigger_event: 'payment_pending', channel: 'whatsapp', channel_account_id: senders('whatsapp')[0]?.id ?? '', delay: '5', unit: 'min', email_subject: null, body: 'Olá, {primeiro_nome}! Seu pagamento de {valor} ainda está pendente.', button_text: 'Finalizar pagamento', button_url: '{link}', active: true })
  const edit = (rule: Rule): Draft => ({ ...rule, delay: String(rule.delay_minutes % 60 === 0 ? rule.delay_minutes / 60 : rule.delay_minutes), unit: rule.delay_minutes % 60 === 0 ? 'h' : 'min' })

  async function save() {
    if (!draft) return
    setSaving(true); setError('')
    const { error: saveError } = await db.rpc('crm_remarketing_rule_save', {
      p_id: draft.id, p_trigger_event: draft.trigger_event, p_channel: draft.channel, p_channel_account_id: draft.channel_account_id,
      p_delay_minutes: Math.round(Number(draft.delay) * (draft.unit === 'h' ? 60 : 1)), p_body: draft.body,
      p_email_subject: draft.channel === 'email' ? draft.email_subject : null, p_button_text: draft.button_text || null,
      p_button_url: draft.button_text ? draft.button_url || '{link}' : null, p_funnel_id: draft.funnel_id || null, p_active: draft.active,
    })
    setSaving(false)
    if (saveError) { setError(errorText(saveError.message ?? '')); return }
    setDraft(null); await load()
  }

  async function remove(rule: Rule) {
    if (!window.confirm('Apagar esta regra? Mensagens ainda não enviadas por ela deixam de sair.')) return
    const { error: deleteError } = await db.rpc('crm_remarketing_rule_delete', { p_id: rule.id })
    if (deleteError) { setError('Não foi possível apagar a regra.'); return }
    await load()
  }

  const set = (patch: Partial<Draft>) => setDraft(current => current && { ...current, ...patch })
  const invalid = !draft || !draft.channel_account_id || !draft.body.trim() || !(Number(draft.delay) > 0) || (draft.channel === 'email' && !draft.email_subject?.trim())

  return <div>
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[.06] px-4 py-3">
      <p className="text-xs text-slate-500">Mensagens automáticas depois que o checkout fica pendente ou é abandonado. Param sozinhas quando o pagamento é aprovado.</p>
      {canManage && <button type="button" onClick={() => setDraft(blank())} className="inline-flex h-9 items-center gap-2 rounded-xl bg-emerald-500 px-3 text-sm font-bold text-black hover:bg-emerald-400"><Plus size={15} /> Nova regra</button>}
    </div>
    {error && <div role="alert" className="m-4 rounded-xl border border-red-500/20 bg-red-500/[.06] px-4 py-3 text-sm text-red-300">{error}</div>}
    {loading ? <div className="flex min-h-32 items-center justify-center gap-2 text-slate-500"><Loader2 size={16} className="animate-spin text-emerald-400" /> Carregando</div>
      : rules.length ? rules.map(rule => <div key={rule.id} className="flex items-start gap-3 border-b border-white/[.06] px-4 py-3 last:border-0">
        <div className="min-w-0 flex-1">
          <b className="text-sm">{rule.channel === 'email' ? 'E-mail' : 'WhatsApp'} · {delayLabel(rule.delay_minutes)} depois · {TRIGGERS[rule.trigger_event]}</b>
          {!rule.active && <span className="ml-2 rounded-full bg-white/[.06] px-2 py-0.5 text-[10px] text-slate-500">inativa</span>}
          <p className="mt-0.5 text-xs text-slate-500">De {accountName(rule.channel_account_id)} · {rule.funnel_id ? funnels.find(funnel => funnel.id === rule.funnel_id)?.nome ?? rule.funnel_id : 'Todos os funis'}</p>
          <p className="mt-1 line-clamp-2 text-xs text-slate-400">{rule.body}</p>
        </div>
        {canManage && <><button type="button" aria-label="Editar regra" onClick={() => setDraft(edit(rule))} className="rounded-md p-1.5 text-slate-500 hover:bg-white/5 hover:text-white"><Pencil size={14} /></button>
          <button type="button" aria-label="Apagar regra" onClick={() => void remove(rule)} className="rounded-md p-1.5 text-slate-500 hover:bg-white/5 hover:text-red-300"><Trash2 size={14} /></button></>}
      </div>)
      : <div className="p-10 text-center text-sm text-slate-600">Nenhuma regra. Sem regra, vale o aviso padrão de pagamento pendente por WhatsApp após 5 minutos.</div>}

    {draft && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setDraft(null)}>
      <div role="dialog" aria-modal="true" aria-label="Regra de remarketing" onClick={event => event.stopPropagation()} className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-white/10 bg-[#0b0f0d] p-5">
        <div className="mb-4 flex items-center justify-between"><h2 className="font-bold">{draft.id ? 'Editar regra' : 'Nova regra'}</h2><button type="button" aria-label="Fechar" onClick={() => setDraft(null)} className="rounded-md p-1 hover:bg-white/5"><X size={16} /></button></div>
        <div className="space-y-3 text-sm">
          <label className="block">Quando<select className={input} value={draft.trigger_event} onChange={event => set({ trigger_event: event.target.value as Draft['trigger_event'] })}>{Object.entries(TRIGGERS).map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
          <div className="flex gap-2">
            <label className="block flex-1">Esperar<input type="number" min={1} className={input} value={draft.delay} onChange={event => set({ delay: event.target.value })} /></label>
            <label className="block w-32">Unidade<select className={input} value={draft.unit} onChange={event => set({ unit: event.target.value as Draft['unit'] })}><option value="min">minutos</option><option value="h">horas</option></select></label>
          </div>
          <label className="block">Funil<select className={input} value={draft.funnel_id ?? ''} onChange={event => set({ funnel_id: event.target.value || null })}><option value="">Todos os funis</option>{funnels.map(funnel => <option key={funnel.id} value={funnel.id}>{funnel.nome}</option>)}</select></label>
          <label className="block">Canal<select className={input} value={draft.channel} onChange={event => { const channel = event.target.value as Draft['channel']; set({ channel, channel_account_id: senders(channel)[0]?.id ?? '' }) }}><option value="whatsapp">WhatsApp</option><option value="email">E-mail</option></select></label>
          <label className="block">Enviar de<select className={input} value={draft.channel_account_id} onChange={event => set({ channel_account_id: event.target.value })}><option value="">Escolha a conta</option>{senders(draft.channel).map(account => <option key={account.id} value={account.id}>{account.display_name || account.provider}{account.status !== 'active' ? ' (inativa)' : ''}</option>)}</select></label>
          {!senders(draft.channel).length && <p className="text-xs text-amber-300">Nenhuma conta de {draft.channel === 'email' ? 'e-mail' : 'WhatsApp'}. Cadastre em CRM &gt; Configurações &gt; {draft.channel === 'email' ? 'E-mail' : 'WhatsApp'}.</p>}
          {draft.channel === 'email' && <>
            <p className="text-xs text-slate-500">O e-mail sai pela Resend com o remetente da conta escolhida. O domínio desse remetente precisa estar verificado na Resend, senão o envio falha.</p>
            <label className="block">Assunto<input className={input} maxLength={200} value={draft.email_subject ?? ''} onChange={event => set({ email_subject: event.target.value })} /></label>
          </>}
          {draft.channel === 'whatsapp' && draft.trigger_event === 'checkout_abandoned' && <p className="text-xs text-slate-500">Checkout abandonado só recebe se o cliente aceitou contato no checkout.</p>}
          <label className="block">Mensagem<textarea rows={5} maxLength={4000} className={`${input} h-auto py-2`} value={draft.body} onChange={event => set({ body: event.target.value })} /></label>
          <p className="text-xs text-slate-500">Variáveis: {VARS}</p>
          <div className="flex gap-2">
            <label className="block flex-1">Texto do botão<input className={input} maxLength={60} placeholder="Sem botão" value={draft.button_text ?? ''} onChange={event => set({ button_text: event.target.value })} /></label>
            <label className="block flex-1">Link do botão<input className={input} maxLength={500} value={draft.button_url ?? ''} placeholder="{link}" onChange={event => set({ button_url: event.target.value })} /></label>
          </div>
          <label className="flex items-center gap-2"><input type="checkbox" checked={draft.active} onChange={event => set({ active: event.target.checked })} /> Ativa</label>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={() => setDraft(null)} className="h-10 rounded-xl border border-white/10 px-4 text-sm hover:bg-white/[.06]">Cancelar</button>
          <button type="button" disabled={invalid || saving} onClick={() => void save()} className="h-10 rounded-xl bg-emerald-500 px-4 text-sm font-bold text-black hover:bg-emerald-400 disabled:opacity-40">{saving ? 'Salvando…' : 'Salvar'}</button>
        </div>
      </div>
    </div>}
  </div>
}
