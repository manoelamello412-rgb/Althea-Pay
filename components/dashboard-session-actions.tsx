'use client'

import { useEffect, useRef, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { LogOut, ShieldCheck } from 'lucide-react'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'
import type { SupabaseClient } from '@supabase/supabase-js'

const AUTH_ROUTES = new Set(['/login', '/forgot-password', '/reset-password'])
type AuthUser = { id: string; email?: string | null; user_metadata?: Record<string, unknown> }

export default function DashboardSessionActions() {
  const pathname = usePathname()
  const router = useRouter()
  const supabaseRef = useRef<SupabaseClient | null>(null)
  const [name, setName] = useState('Althea')
  const [avatarUrl, setAvatarUrl] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (AUTH_ROUTES.has(pathname)) return
    let active = true
    try {
      const supabase = createSupabaseBrowserClient()
      supabaseRef.current = supabase
      void supabase.auth.getUser().then(({ data }: { data: { user: AuthUser | null } }) => {
        if (!active || !data.user) return
        setName(String(data.user.user_metadata?.full_name || data.user.user_metadata?.display_name || data.user.email?.split('@')[0] || 'Althea'))
        setAvatarUrl(String(data.user.user_metadata?.avatar_url || ''))
      })
    } catch {
      supabaseRef.current = null
    }
    return () => { active = false }
  }, [pathname])

  if (AUTH_ROUTES.has(pathname)) return null

  const initials = name.trim().split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]).join('').toUpperCase() || 'AP'

  async function signOut() {
    const supabase = supabaseRef.current
    if (loading || !supabase) return
    setLoading(true)
    try {
      await supabase.auth.signOut()
    } finally {
      router.replace('/login')
      router.refresh()
      setLoading(false)
    }
  }

  return (
    <div className="dashboard-session-actions" aria-label="Sessão da conta">
      <div className="dashboard-session-avatar" aria-hidden="true">
        {avatarUrl ? <img src={avatarUrl} alt="" /> : <span>{initials}</span>}
      </div>
      <div className="dashboard-session-copy">
        <strong>{name}</strong>
        <span><ShieldCheck size={12} /> Sessão segura</span>
      </div>
      <button type="button" onClick={signOut} disabled={loading || !supabaseRef.current} aria-label="Sair da conta" title="Sair da conta">
        <LogOut size={17} />
        <span>{loading ? 'Saindo…' : 'Sair'}</span>
      </button>
    </div>
  )
}
