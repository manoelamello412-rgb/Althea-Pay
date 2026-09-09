'use client'

import { ChangeEvent, FormEvent, useEffect, useMemo, useState } from 'react'
import { Camera, CheckCircle2, MessageSquare, Save } from 'lucide-react'
import { motion } from 'framer-motion'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'

interface ProfileAvatarCustomProps {
  initialName?: string
  initialEmail?: string
  initialAvatarUrl?: string
  onBack?: () => void
  onSaved?: (avatarUrl: string | null) => void
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return 'AP'
  return (parts.length === 1 ? parts[0].slice(0, 2) : `${parts[0][0]}${parts[parts.length - 1][0]}`).toUpperCase()
}

function cacheBusted(url: string): string {
  const separator = url.includes('?') ? '&' : '?'
  return `${url}${separator}v=${Date.now()}`
}

async function compressAvatar(file: File): Promise<File> {
  if (!['image/png', 'image/jpeg'].includes(file.type)) {
    throw new Error('Selecione uma imagem PNG ou JPG.')
  }
  if (file.size > 8 * 1024 * 1024) throw new Error('A imagem deve ter no máximo 8 MB.')
  const bitmap = await createImageBitmap(file)
  const maxSize = 512
  const scale = Math.min(1, maxSize / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(bitmap.width * scale))
  canvas.height = Math.max(1, Math.round(bitmap.height * scale))
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Não foi possível preparar a imagem.')
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', 0.82))
  if (!blob) throw new Error('Não foi possível preparar a imagem.')
  return new File([blob], 'avatar.webp', { type: 'image/webp', lastModified: Date.now() })
}

export function ProfileAvatarCustom({ initialName = '', initialEmail = '', initialAvatarUrl = '', onSaved }: ProfileAvatarCustomProps) {
  const supabase = useMemo(() => createSupabaseBrowserClient(), [])
  const [userName, setUserName] = useState(initialName)
  const [userEmail, setUserEmail] = useState(initialEmail)
  const [avatarUrl, setAvatarUrl] = useState(initialAvatarUrl)
  const [whatsappAvatarUrl, setWhatsappAvatarUrl] = useState('')
  const [syncWhatsapp, setSyncWhatsapp] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [isSyncing, setIsSyncing] = useState(false)
  const [isUploading, setIsUploading] = useState(false)
  const [saveSuccess, setSaveSuccess] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    setUserName(initialName)
    setUserEmail(initialEmail)
    setAvatarUrl(initialAvatarUrl)
  }, [initialName, initialEmail, initialAvatarUrl])

  useEffect(() => {
    let active = true
    void supabase.auth.getUser().then(({ data, error: authError }) => {
      if (!active || authError || !data.user) return
      const metadata = data.user.user_metadata as Record<string, unknown>
      const whatsapp = [metadata.whatsapp_avatar_url, metadata.whatsapp_profile_picture, metadata.whatsapp_avatar]
        .find((value): value is string => typeof value === 'string' && value.length > 0) ?? ''
      setWhatsappAvatarUrl(whatsapp)
      if (!initialAvatarUrl && typeof metadata.avatar_url === 'string') setAvatarUrl(metadata.avatar_url)
      if (!initialName) setUserName(typeof metadata.display_name === 'string' ? metadata.display_name : typeof metadata.name === 'string' ? metadata.name : '')
      if (!initialEmail) setUserEmail(data.user.email ?? '')
      setSyncWhatsapp(metadata.avatar_source === 'whatsapp')
    })
    return () => { active = false }
  }, [initialAvatarUrl, initialEmail, initialName, supabase])

  async function handleSyncWhatsappAvatar(): Promise<void> {
    setIsSyncing(true)
    setError('')
    try {
      const { data, error: authError } = await supabase.auth.getUser()
      if (authError || !data.user) throw authError ?? new Error('Sessão expirada.')
      const metadata = data.user.user_metadata as Record<string, unknown>
      const whatsapp = [metadata.whatsapp_avatar_url, metadata.whatsapp_profile_picture, metadata.whatsapp_avatar]
        .find((value): value is string => typeof value === 'string' && value.length > 0) ?? ''
      if (!whatsapp) throw new Error('A foto do WhatsApp ainda não foi recebida pelo webhook do provedor.')
      setWhatsappAvatarUrl(whatsapp)
      setAvatarUrl(cacheBusted(whatsapp))
      setSyncWhatsapp(true)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível sincronizar a foto do WhatsApp.')
    } finally {
      setIsSyncing(false)
    }
  }

  async function handleUpload(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setIsUploading(true)
    setError('')
    try {
      const optimized = await compressAvatar(file)
      const { data: auth, error: authError } = await supabase.auth.getUser()
      if (authError || !auth.user) throw authError ?? new Error('Sessão expirada.')
      const path = `${auth.user.id}/avatar-${Date.now()}.webp`
      const upload = await supabase.storage.from('avatars').upload(path, optimized, { contentType: 'image/webp', cacheControl: '3600', upsert: false })
      if (upload.error) throw upload.error
      const signed = await supabase.storage.from('avatars').createSignedUrl(path, 60 * 60 * 24 * 30)
      if (signed.error || !signed.data?.signedUrl) throw signed.error ?? new Error('Não foi possível criar a URL segura.')
      setAvatarUrl(signed.data.signedUrl)
      setSyncWhatsapp(false)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Falha no upload do avatar.')
    } finally {
      setIsUploading(false)
    }
  }

  async function handleSaveChanges(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    setIsSaving(true)
    setSaveSuccess(false)
    setError('')
    try {
      const { data: auth, error: authError } = await supabase.auth.getUser()
      if (authError || !auth.user) throw authError ?? new Error('Sessão expirada.')
      const nextAvatar = syncWhatsapp && whatsappAvatarUrl ? cacheBusted(whatsappAvatarUrl) : avatarUrl || null
      const { error: updateError } = await supabase.auth.updateUser({
        data: {
          display_name: userName.trim(),
          avatar_url: nextAvatar,
          avatar_source: syncWhatsapp ? 'whatsapp' : 'upload',
          avatar_updated_at: new Date().toISOString(),
        },
      })
      if (updateError) throw updateError
      try { window.sessionStorage.removeItem('althea-profile-cache') } catch {}
      try { window.localStorage.removeItem('althea-profile-cache') } catch {}
      window.dispatchEvent(new CustomEvent('althea:profile-updated', { detail: { avatarUrl: nextAvatar } }))
      setAvatarUrl(nextAvatar ?? '')
      setSaveSuccess(true)
      onSaved?.(nextAvatar)
      window.setTimeout(() => setSaveSuccess(false), 2500)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível salvar o perfil.')
    } finally {
      setIsSaving(false)
    }
  }

  const displayAvatar = syncWhatsapp && whatsappAvatarUrl ? avatarUrl || whatsappAvatarUrl : avatarUrl

  return (
    <form onSubmit={(event) => void handleSaveChanges(event)} className="w-full flex flex-col gap-4 text-white">
      <div className="bg-[#0E1110] rounded-2xl p-6 flex flex-col items-center justify-center text-center gap-4 overflow-hidden">
        <div className="relative">
          {displayAvatar ? (
            <img src={displayAvatar} alt="Avatar do usuário" className="h-24 w-24 rounded-full object-cover" />
          ) : (
            <div className="h-24 w-24 rounded-full bg-[#131C18] flex items-center justify-center font-black text-2xl text-[#1D8B54]" aria-label={`Iniciais de ${userName}`}>
              {initials(userName)}
            </div>
          )}
          <label className="absolute bottom-0 right-0 h-8 w-8 bg-[#1D8B54] hover:bg-[#15663D] transition-colors rounded-full flex items-center justify-center cursor-pointer shadow-lg outline-none" aria-label="Alterar foto">
            <Camera className="h-4 w-4 text-white" />
            <input type="file" accept="image/png,image/jpeg" onChange={(event) => void handleUpload(event)} disabled={isUploading} className="hidden" />
          </label>
        </div>

        <div>
          <h3 className="text-sm font-bold text-white">{userName || 'Seu perfil'}</h3>
          <p className="text-[11px] text-slate-500 font-mono mt-0.5">{userEmail}</p>
        </div>

        <motion.button whileTap={{ scale: 0.96 }} type="button" onClick={() => void handleSyncWhatsappAvatar()} disabled={isSyncing} className="mt-1 h-9 px-4 bg-[#111312] hover:bg-[#171A19] transition-colors text-slate-300 rounded-xl flex items-center gap-2 text-xs font-bold border-none cursor-pointer outline-none disabled:opacity-50">
          <MessageSquare className="h-4 w-4 text-[#1D8B54]" />
          <span>{isSyncing ? 'Sincronizando…' : 'Sincronizar WhatsApp'}</span>
        </motion.button>
      </div>

      <div className="bg-[#0E1110] rounded-2xl p-4 flex flex-col gap-4">
        <label className="flex flex-col gap-1.5 text-[10px] font-bold text-slate-400 uppercase tracking-wider pl-1">
          Nome Completo
          <input type="text" value={userName} onChange={(event) => setUserName(event.target.value)} className="bg-[#070708] border-none outline-none rounded-xl px-3 py-3 text-xs text-slate-200 font-medium normal-case tracking-normal" required />
        </label>
        <label className="flex flex-col gap-1.5 text-[10px] font-bold text-slate-400 uppercase tracking-wider pl-1">
          E-mail Institucional
          <input type="email" value={userEmail} readOnly className="bg-[#070708] border-none outline-none rounded-xl px-3 py-3 text-xs text-slate-400 font-mono normal-case tracking-normal cursor-not-allowed" />
        </label>
        {error && <p className="text-xs text-red-400" role="alert">{error}</p>}
      </div>

      <motion.button whileTap={{ scale: 0.97 }} type="submit" disabled={isSaving || isUploading} className={`h-11 w-full rounded-xl font-bold text-xs flex items-center justify-center gap-2 border transition-all cursor-pointer outline-none mt-1 ${saveSuccess ? 'bg-[#1D8B54]/20 border-[#1D8B54] text-[#1D8B54]' : 'bg-[#1D8B54] border-[#1D8B54] text-white disabled:opacity-40'}`}>
        {isSaving ? <div className="h-3.5 w-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : saveSuccess ? <><CheckCircle2 className="h-4 w-4" /><span>Identidade Visual Salva!</span></> : <><Save className="h-4 w-4" /><span>Salvar Alterações de Perfil</span></>}
      </motion.button>
    </form>
  )
}
