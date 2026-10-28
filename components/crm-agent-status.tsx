'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'
import {
  hasOrganizationCapability,
  parseOrganizationAccess,
} from '@/lib/auth/organization-access'

type AgentStatus = 'available' | 'busy' | 'offline'

type Agent = {
  id: string
  name: string
  status: AgentStatus
  member_user_id: string
}

const OPTIONS: {
  status: AgentStatus
  label: string
  activeClass: string
}[] = [
  {
    status: 'available',
    label: 'Disponível',
    activeClass:
      'border-emerald-400/40 bg-emerald-400/10 text-emerald-300',
  },
  {
    status: 'busy',
    label: 'Ocupado',
    activeClass:
      'border-amber-400/40 bg-amber-400/10 text-amber-300',
  },
  {
    status: 'offline',
    label: 'Offline',
    activeClass:
      'border-slate-400/30 bg-white/[.06] text-slate-300',
  },
]

export function CrmAgentStatus() {
  const db = useMemo(() => createSupabaseBrowserClient(), [])
  const [visible, setVisible] = useState(false)
  const [agent, setAgent] = useState<Agent | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')

    try {
      const userResult = await db.auth.getUser()

      if (userResult.error || !userResult.data.user) {
        throw new Error('Sessão expirada.')
      }

      const accessResult = await db.rpc(
        'organization_my_access_v1',
        { p_organization_id: null },
      )

      if (accessResult.error) {
        throw accessResult.error
      }

      const access = parseOrganizationAccess(accessResult.data)

      if (
        !access ||
        !hasOrganizationCapability(access, 'can_reply_chats')
      ) {
        setVisible(false)
        return
      }

      setVisible(true)

      const agentResult = await db
        .from('crm_agents')
        .select('id,name,status,member_user_id')
        .eq('organization_id', access.organization_id)
        .eq('member_user_id', userResult.data.user.id)
        .maybeSingle()

      if (agentResult.error) {
        throw agentResult.error
      }

      if (!agentResult.data) {
        throw new Error('Seu atendente ainda não está cadastrado.')
      }

      setAgent(agentResult.data as Agent)
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Não foi possível carregar sua disponibilidade.',
      )
    } finally {
      setLoading(false)
    }
  }, [db])

  useEffect(() => {
    void load()
  }, [load])

  async function changeStatus(status: AgentStatus) {
    if (!agent || saving || status === agent.status) return

    setSaving(true)
    setError('')

    const result = await db.rpc(
      'crm_my_agent_status_set',
      { p_status: status },
    )

    setSaving(false)

    if (result.error) {
      setError(
        result.error.message ||
          'Não foi possível alterar sua disponibilidade.',
      )
      return
    }

    const updated = result.data as Agent
    setAgent(updated)
  }

  if (!visible && !loading) return null

  return (
    <section className="mx-3 mt-3 rounded-2xl border border-white/10 bg-[#0B0F0D] px-4 py-3 text-slate-100 lg:mx-7">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="text-[10px] font-black uppercase tracking-[.2em] text-slate-500">
            Atendimento humano
          </div>

          <div className="mt-0.5 flex items-center gap-2 text-sm">
            {loading ? (
              <>
                <Loader2
                  size={14}
                  className="animate-spin text-emerald-400"
                />
                Carregando disponibilidade
              </>
            ) : (
              <>
                <span
                  className={`h-2 w-2 rounded-full ${
                    agent?.status === 'available'
                      ? 'bg-emerald-400'
                      : agent?.status === 'busy'
                        ? 'bg-amber-400'
                        : 'bg-slate-500'
                  }`}
                />
                <b>{agent?.name ?? 'Atendente'}</b>
              </>
            )}
          </div>
        </div>

        {!loading && agent && (
          <div
            className="flex flex-wrap gap-1.5"
            role="radiogroup"
            aria-label="Minha disponibilidade"
          >
            {OPTIONS.map(option => {
              const selected = agent.status === option.status

              return (
                <button
                  key={option.status}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  disabled={saving}
                  onClick={() => void changeStatus(option.status)}
                  className={`rounded-xl border px-3 py-2 text-xs font-bold transition disabled:opacity-50 ${
                    selected
                      ? option.activeClass
                      : 'border-white/10 text-slate-500 hover:bg-white/[.04] hover:text-slate-300'
                  }`}
                >
                  {option.label}
                </button>
              )
            })}
          </div>
        )}
      </div>

      {error && (
        <p
          role="alert"
          className="mt-2 text-xs text-red-300"
        >
          {error}
        </p>
      )}
    </section>
  )
}
