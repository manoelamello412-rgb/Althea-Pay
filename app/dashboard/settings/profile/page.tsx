'use client'

import { useEffect, useMemo, useState } from 'react'
import { ChevronLeft, Save, Sparkles } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { ProfileAvatarCustom } from '@/components/profile-avatar-custom'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'

type Gender = 'F' | 'M' | ''

export default function ProfileSettingsPage() {
  const router = useRouter()
  const supabase = useMemo(() => createSupabaseBrowserClient(), [])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [avatarUrl, setAvatarUrl] = useState('')
  const [gender, setGender] = useState<Gender>('')
  const [feedback, setFeedback] = useState('')

  useEffect(() => {
    let active = true
    void (async () => {
      const { data, error } = await supabase.auth.getUser()
      if (!active) return
      if (error || !data.user) {
        router.replace('/login')
        return
      }
      const metadata = data.user.user_metadata as Record<string, unknown>
      const { data: profile } = await supabase.from('profiles').select('display_name,full_name,avatar_url,gender').eq('id', data.user.id).maybeSingle()
      if (!active) return
      setName(String(profile?.display_name || profile?.full_name || metadata.display_name || metadata.name || ''))
      setEmail(data.user.email ?? '')
      setAvatarUrl(String(profile?.avatar_url || metadata.avatar_url || ''))
      setGender(profile?.gender === 'F' || profile?.gender === 'M' ? profile.gender : metadata.gender === 'F' || metadata.gender === 'M' ? metadata.gender : '')
      setLoading(false)
    })()
    return () => { active = false }
  }, [router, supabase])

  async function saveGender() {
    if (!gender) {
      setFeedback('Selecione Feminino ou Masculino para definir a saudação.')
      return
    }
    setSaving(true)
    setFeedback('')
    try {
      const { data: auth, error: authError } = await supabase.auth.getUser()
      if (authError || !auth.user) throw authError ?? new Error('Sessão não autorizada.')
      const { error } = await supabase.from('profiles').update({ gender }).eq('id', auth.user.id)
      if (error) throw error
      const { error: metadataError } = await supabase.auth.updateUser({ data: { gender } })
      if (metadataError) throw metadataError
      setFeedback('Preferência de saudação salva.')
    } catch (cause) {
      setFeedback(cause instanceof Error ? cause.message : 'Não foi possível salvar a preferência.')
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <main className="settings-shell"><div className="settings-loading">Carregando perfil…</div></main>

  return (
    <main className="settings-shell">
      <header className="settings-header">
        <div>
          <span className="settings-kicker"><Sparkles size={14} /> PERFIL</span>
          <h1>Personalização de Perfil</h1>
          <p>Gerencie sua identidade, avatar e preferência de saudação.</p>
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

        <section className="settings-card settings-main-card">
          <div>
            <span className="settings-kicker">SAUDAÇÃO</span>
            <h2>Como devemos falar com você?</h2>
            <p>Essa preferência é persistida no seu perfil e usada para definir “Seja bem-vinda” ou “Seja bem-vindo” no painel.</p>
          </div>
          <label className="mt-5 block text-sm font-semibold">
            Sexo
            <select value={gender} onChange={(event) => setGender(event.target.value as Gender)} className="mt-2 w-full rounded-xl border border-white/10 bg-[#0F1A16] px-3 py-3 text-white outline-none focus:border-[#1DB854]">
              <option value="" disabled>Selecione</option>
              <option value="F">Feminino</option>
              <option value="M">Masculino</option>
            </select>
          </label>
          <button type="button" disabled={saving} onClick={() => void saveGender()} className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-xl bg-[#1DB854] px-5 text-sm font-bold text-[#07110c] disabled:opacity-60">
            <Save size={16} /> {saving ? 'Salvando...' : 'Salvar preferência'}
          </button>
          {feedback && <p className="mt-3 text-sm text-[#A6A6A6]" role="status">{feedback}</p>}
        </section>
      </section>
    </main>
  )
}
