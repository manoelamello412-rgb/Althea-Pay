'use client'

import { useEffect, useMemo, useState } from 'react'
import { ChevronLeft, Sparkles } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { ProfileAvatarCustom } from '@/components/profile-avatar-custom'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'

export default function ProfileSettingsPage() {
  const router = useRouter()
  const supabase = useMemo(() => createSupabaseBrowserClient(), [])
  const [loading, setLoading] = useState(true)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [avatarUrl, setAvatarUrl] = useState('')

  useEffect(() => {
    let active = true
    void supabase.auth.getUser().then(({ data, error }) => {
      if (!active) return
      if (error || !data.user) {
        router.replace('/login')
        return
      }
      const metadata = data.user.user_metadata as Record<string, unknown>
      setName(typeof metadata.display_name === 'string' ? metadata.display_name : typeof metadata.name === 'string' ? metadata.name : '')
      setEmail(data.user.email ?? '')
      setAvatarUrl(typeof metadata.avatar_url === 'string' ? metadata.avatar_url : '')
      setLoading(false)
    })
    return () => { active = false }
  }, [router, supabase])

  if (loading) return <main className="settings-shell"><div className="settings-loading">Carregando perfil…</div></main>

  return (
    <main className="settings-shell">
      <header className="settings-header">
        <div>
          <span className="settings-kicker"><Sparkles size={14} /> ALTHEA CONTROL CENTER</span>
          <h1>Personalização de Perfil</h1>
          <p>Gerencie sua identidade visual, avatar e sincronização com o WhatsApp.</p>
        </div>
        <button className="settings-logout" type="button" onClick={() => router.back()}>
          <ChevronLeft size={17} /> Voltar
        </button>
      </header>

      <section className="settings-grid">
        <div className="settings-card settings-main-card">
          <ProfileAvatarCustom
            initialName={name}
            initialEmail={email}
            initialAvatarUrl={avatarUrl}
            onSaved={(nextAvatar) => setAvatarUrl(nextAvatar ?? '')}
          />
        </div>
      </section>
    </main>
  )
}
