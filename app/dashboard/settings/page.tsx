'use client'

import { ChangeEvent, FormEvent, useEffect, useMemo, useState } from 'react'
import { Check, Eye, EyeOff, KeyRound, LogOut, ShieldCheck, Upload, UserRound, Building2, Sparkles } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'

type Tab = 'profile' | 'security' | 'business'
type GatewayName = 'stripe' | 'asaas' | 'mercado_pago'
type Credential = { id: string; gateway_name: string; is_active: boolean; priority_order: number; metadata: Record<string, unknown> }
type BusinessProfile = { document_type: 'CNPJ' | 'CPF'; document_number: string; legal_name: string; operation_metadata: string }
type PasswordStrength = { score: number; label: string; requirements: { length: boolean; upper: boolean; lower: boolean; number: boolean; symbol: boolean } }

const GATEWAYS: Array<{ value: GatewayName; label: string }> = [
  { value: 'stripe', label: 'Stripe' },
  { value: 'asaas', label: 'Asaas' },
  { value: 'mercado_pago', label: 'Mercado Pago' },
]

function getStrength(value: string): PasswordStrength {
  const requirements = {
    length: value.length >= 12,
    upper: /[A-Z]/.test(value),
    lower: /[a-z]/.test(value),
    number: /\d/.test(value),
    symbol: /[^A-Za-z0-9]/.test(value),
  }
  const score = Object.values(requirements).filter(Boolean).length
  const label = score <= 2 ? 'Fraca' : score === 3 ? 'Moderada' : score === 4 ? 'Forte' : 'Excelente'
  return { score, label, requirements }
}

async function compressAvatar(file: File): Promise<File> {
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
  if (!blob) throw new Error('Não foi possível comprimir a imagem.')
  return new File([blob], 'avatar.webp', { type: 'image/webp', lastModified: Date.now() })
}

function clearLocalSessionCookies(): void {
  if (typeof document === 'undefined') return
  const cookies = document.cookie.split(';')
  for (const cookie of cookies) {
    const name = cookie.split('=')[0]?.trim()
    if (name) document.cookie = `${name}=; Max-Age=0; Path=/; SameSite=Lax`
  }
  try { window.localStorage.clear() } catch {}
  try { window.sessionStorage.clear() } catch {}
}

export default function SettingsPage() {
  const supabase = useMemo(() => createSupabaseBrowserClient(), [])
  const router = useRouter()
  const [tab, setTab] = useState<Tab>('profile')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [email, setEmail] = useState('')
  const [avatarUrl, setAvatarUrl] = useState('')
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showCurrent, setShowCurrent] = useState(false)
  const [showNew, setShowNew] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [factors, setFactors] = useState<Array<{ id: string; friendly_name: string | null; status: string }>>([])
  const [enrollingFactor, setEnrollingFactor] = useState<{ id: string; qr: string; secret: string; challengeId: string } | null>(null)
  const [mfaCode, setMfaCode] = useState('')
  const [business, setBusiness] = useState<BusinessProfile>({ document_type: 'CNPJ', document_number: '', legal_name: '', operation_metadata: '{}' })
  const [credentials, setCredentials] = useState<Credential[]>([])
  const [credentialGateway, setCredentialGateway] = useState<GatewayName>('stripe')
  const [credentialKey, setCredentialKey] = useState('')
  const [credentialActive, setCredentialActive] = useState(true)
  const [credentialPriority, setCredentialPriority] = useState('1')
  const [uploadingAvatar, setUploadingAvatar] = useState(false)

  const strength = useMemo(() => getStrength(newPassword), [newPassword])

  useEffect(() => {
    let cancelled = false
    async function load(): Promise<void> {
      setLoading(true)
      setError('')
      const { data: auth, error: authError } = await supabase.auth.getUser()
      if (authError || !auth.user) {
        router.replace('/login')
        return
      }
      const user = auth.user
      const metadata = user.user_metadata as Record<string, unknown>
      if (cancelled) return
      setDisplayName(typeof metadata.display_name === 'string' ? metadata.display_name : typeof metadata.name === 'string' ? metadata.name : '')
      setEmail(user.email ?? '')
      setAvatarUrl(typeof metadata.avatar_url === 'string' ? metadata.avatar_url : '')
      const [businessResult, credentialsResult, factorsResult] = await Promise.all([
        supabase.from('merchant_business_profiles').select('document_type,document_number,legal_name,operation_metadata').eq('user_id', user.id).maybeSingle(),
        supabase.from('user_gateway_credentials').select('id,gateway_name,is_active,priority_order,metadata').eq('user_id', user.id).order('priority_order', { ascending: true }),
        supabase.auth.mfa.listFactors(),
      ])
      if (cancelled) return
      if (businessResult.data) {
        setBusiness({
          document_type: businessResult.data.document_type === 'CPF' ? 'CPF' : 'CNPJ',
          document_number: String(businessResult.data.document_number ?? ''),
          legal_name: String(businessResult.data.legal_name ?? ''),
          operation_metadata: JSON.stringify(businessResult.data.operation_metadata ?? {}, null, 2),
        })
      }
      if (!credentialsResult.error && credentialsResult.data) setCredentials(credentialsResult.data as Credential[])
      if (!factorsResult.error) setFactors((factorsResult.data.totp ?? []).map((factor) => ({ id: factor.id, friendly_name: factor.friendly_name, status: factor.status })))
      if (businessResult.error && businessResult.error.code !== 'PGRST116') setError(`Negócio: ${businessResult.error.message}`)
      setLoading(false)
    }
    void load()
    return () => { cancelled = true }
  }, [router, supabase])

  async function saveProfile(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    setSaving(true); setError(''); setMessage('')
    try {
      const { error: updateError } = await supabase.auth.updateUser({
        email: email.trim(),
        data: { display_name: displayName.trim(), avatar_url: avatarUrl.trim() || null },
      })
      if (updateError) throw updateError
      setMessage('Perfil atualizado com segurança.')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível salvar o perfil.')
    } finally { setSaving(false) }
  }

  async function uploadAvatar(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.target.files?.[0]
    if (!file) return
    setUploadingAvatar(true); setError(''); setMessage('')
    try {
      if (!file.type.startsWith('image/')) throw new Error('Selecione uma imagem válida.')
      const optimized = await compressAvatar(file)
      const { data: auth, error: authError } = await supabase.auth.getUser()
      if (authError || !auth.user) throw authError ?? new Error('Sessão expirada.')
      const path = `${auth.user.id}/avatar-${Date.now()}.webp`
      const upload = await supabase.storage.from('avatars').upload(path, optimized, { contentType: 'image/webp', cacheControl: '3600', upsert: false })
      if (upload.error) throw upload.error
      const signed = await supabase.storage.from('avatars').createSignedUrl(path, 60 * 60 * 24 * 30)
      if (signed.error || !signed.data?.signedUrl) throw signed.error ?? new Error('Não foi possível criar a URL segura.')
      const update = await supabase.auth.updateUser({ data: { avatar_url: signed.data.signedUrl } })
      if (update.error) throw update.error
      setAvatarUrl(signed.data.signedUrl)
      setMessage('Avatar atualizado.')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Falha no upload do avatar.')
    } finally { setUploadingAvatar(false); event.target.value = '' }
  }

  async function changePassword(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault(); setSaving(true); setError(''); setMessage('')
    try {
      if (!currentPassword) throw new Error('Informe a senha atual.')
      if (strength.score < 5) throw new Error('A nova senha precisa cumprir todos os requisitos.')
      if (newPassword !== confirmPassword) throw new Error('A confirmação da nova senha não coincide.')
      const { data: auth, error: authError } = await supabase.auth.getUser()
      if (authError || !auth.user?.email) throw authError ?? new Error('Sessão expirada.')
      const reauth = await supabase.auth.signInWithPassword({ email: auth.user.email, password: currentPassword })
      if (reauth.error) throw new Error('Senha atual inválida.')
      const update = await supabase.auth.updateUser({ password: newPassword })
      if (update.error) throw update.error
      setCurrentPassword(''); setNewPassword(''); setConfirmPassword(''); setMessage('Senha alterada. As sessões ativas permanecem protegidas pela política de autenticação.')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível alterar a senha.')
    } finally { setSaving(false) }
  }

  async function beginMfa(): Promise<void> {
    setError(''); setMessage('')
    try {
      const result = await supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'Althea Pay Authenticator' })
      if (result.error || !result.data) throw result.error ?? new Error('Não foi possível iniciar o MFA.')
      const challenge = await supabase.auth.mfa.challenge({ factorId: result.data.id })
      if (challenge.error) throw challenge.error
      setEnrollingFactor({ id: result.data.id, qr: result.data.totp.qr_code, secret: result.data.totp.secret, challengeId: challenge.data.id })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível ativar o MFA.')
    }
  }

  async function verifyMfa(): Promise<void> {
    if (!enrollingFactor) return
    setError(''); setMessage('')
    try {
      const result = await supabase.auth.mfa.verify({ factorId: enrollingFactor.id, challengeId: enrollingFactor.challengeId, code: mfaCode.trim() })
      if (result.error) throw result.error
      const listed = await supabase.auth.mfa.listFactors()
      if (listed.error) throw listed.error
      setFactors((listed.data.totp ?? []).map((factor) => ({ id: factor.id, friendly_name: factor.friendly_name, status: factor.status })))
      setEnrollingFactor(null); setMfaCode(''); setMessage('MFA TOTP ativado com sucesso.')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Código MFA inválido.')
    }
  }

  async function disableMfa(factorId: string): Promise<void> {
    setError(''); setMessage('')
    try {
      const result = await supabase.auth.mfa.unenroll({ factorId })
      if (result.error) throw result.error
      setFactors((current) => current.filter((factor) => factor.id !== factorId))
      setMessage('Fator MFA removido.')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível remover o fator MFA.')
    }
  }

  async function saveBusiness(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault(); setSaving(true); setError(''); setMessage('')
    try {
      let operationMetadata: Record<string, unknown>
      try { operationMetadata = JSON.parse(business.operation_metadata) as Record<string, unknown> } catch { throw new Error('Metadados da operação precisam ser JSON válido.') }
      const { data: auth, error: authError } = await supabase.auth.getUser()
      if (authError || !auth.user) throw authError ?? new Error('Sessão expirada.')
      const result = await supabase.from('merchant_business_profiles').upsert({ user_id: auth.user.id, document_type: business.document_type, document_number: business.document_number.trim(), legal_name: business.legal_name.trim(), operation_metadata: operationMetadata }, { onConflict: 'user_id' })
      if (result.error) throw result.error
      setMessage('Dados da operação salvos.')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível salvar o negócio.')
    } finally { setSaving(false) }
  }

  async function saveCredential(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault(); setSaving(true); setError(''); setMessage('')
    try {
      if (credentialKey.trim().length < 8) throw new Error('A chave de API precisa ter pelo menos 8 caracteres.')
      const priority = Number(credentialPriority)
      if (!Number.isInteger(priority) || priority < 1) throw new Error('A prioridade precisa ser um inteiro positivo.')
      const result = await supabase.rpc('upsert_gateway_credential', { p_gateway_name: credentialGateway, p_api_key: credentialKey.trim(), p_metadata: { source: 'settings', configured_at: new Date().toISOString() }, p_is_active: credentialActive, p_priority_order: priority })
      if (result.error) throw result.error
      setCredentialKey('')
      const refreshed = await supabase.from('user_gateway_credentials').select('id,gateway_name,is_active,priority_order,metadata').order('priority_order', { ascending: true })
      if (refreshed.error) throw refreshed.error
      setCredentials((refreshed.data ?? []) as Credential[])
      setMessage(`${GATEWAYS.find((gateway) => gateway.value === credentialGateway)?.label ?? credentialGateway} configurado sem expor a chave ao navegador.`)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível salvar a credencial.')
    } finally { setSaving(false) }
  }

  async function toggleCredential(credential: Credential): Promise<void> {
    setError(''); setMessage('')
    const result = await supabase.from('user_gateway_credentials').update({ is_active: !credential.is_active }).eq('id', credential.id)
    if (result.error) setError(result.error.message)
    else setCredentials((current) => current.map((item) => item.id === credential.id ? { ...item, is_active: !item.is_active } : item))
  }

  async function logout(): Promise<void> {
    setError(''); setMessage('')
    try {
      const result = await supabase.auth.signOut()
      if (result.error) throw result.error
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Falha ao encerrar a sessão.')
    } finally {
      clearLocalSessionCookies()
      router.replace('/login')
    }
  }

  const tabs: Array<{ id: Tab; label: string; icon: typeof UserRound }> = [
    { id: 'profile', label: 'Perfil', icon: UserRound },
    { id: 'security', label: 'Segurança', icon: ShieldCheck },
    { id: 'business', label: 'Organização / Negócio', icon: Building2 },
  ]

  if (loading) return <main className="settings-shell"><div className="settings-loading">Carregando central de configurações…</div></main>

  return (
    <main className="settings-shell">
      <header className="settings-header">
        <div><span className="settings-kicker"><Sparkles size={14} /> ALTHEA CONTROL CENTER</span><h1>Configurações</h1><p>Identidade, segurança e infraestrutura da sua operação em um único centro de controle.</p></div>
        <button className="settings-logout" type="button" onClick={() => void logout()}><LogOut size={17} /> Sair</button>
      </header>
      <nav className="settings-tabs" aria-label="Configurações">
        {tabs.map(({ id, label, icon: Icon }) => <button key={id} className={tab === id ? 'settings-tab active' : 'settings-tab'} type="button" onClick={() => { setTab(id); setError(''); setMessage('') }}><Icon size={17} />{label}</button>)}
      </nav>
      {message && <div className="settings-message" role="status"><Check size={17} />{message}</div>}
      {error && <div className="settings-error" role="alert">{error}</div>}

      {tab === 'profile' && <section className="settings-grid">
        <form className="settings-card settings-main-card" onSubmit={(event) => void saveProfile(event)}>
          <div className="settings-card-heading"><div><span>IDENTIDADE</span><h2>Seu perfil</h2></div><UserRound size={20} /></div>
          <div className="avatar-row"><div className="avatar-preview">{avatarUrl ? <img src={avatarUrl} alt="Avatar" /> : <UserRound size={34} />}</div><div><strong>Imagem de perfil</strong><p>WebP otimizado, até 512px, enviado ao bucket privado de avatares.</p><label className="settings-secondary-button"><Upload size={16} />{uploadingAvatar ? 'Otimizando…' : 'Trocar avatar'}<input hidden type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => void uploadAvatar(event)} disabled={uploadingAvatar} /></label></div></div>
          <label>Nome de exibição<input value={displayName} onChange={(event) => setDisplayName(event.target.value)} autoComplete="name" /></label>
          <label>E-mail<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" /></label>
          <label>Avatar URL<input value={avatarUrl} onChange={(event) => setAvatarUrl(event.target.value)} placeholder="https://…" /></label>
          <button className="settings-primary-button" type="submit" disabled={saving}>{saving ? 'Salvando…' : 'Salvar perfil'}</button>
        </form>
        <aside className="settings-card settings-side-card"><span>STATUS DA CONTA</span><div className="status-dot"><i /> Sessão autenticada</div><p>As alterações de perfil são aplicadas pelo Supabase Auth. Credenciais nunca são armazenadas no frontend.</p><div className="settings-mini-stat"><strong>AUTH</strong><span>Supabase Auth</span></div><div className="settings-mini-stat"><strong>MFA</strong><span>{factors.length ? 'Protegido' : 'Não configurado'}</span></div></aside>
      </section>}

      {tab === 'security' && <section className="settings-grid">
        <form className="settings-card settings-main-card" onSubmit={(event) => void changePassword(event)}>
          <div className="settings-card-heading"><div><span>CREDENCIAIS</span><h2>Alterar senha</h2></div><KeyRound size={20} /></div>
          {[[showCurrent, setShowCurrent, 'Senha atual', currentPassword, setCurrentPassword], [showNew, setShowNew, 'Nova senha', newPassword, setNewPassword], [showConfirm, setShowConfirm, 'Confirme a nova senha', confirmPassword, setConfirmPassword]].map(([shown, setShown, label, value, setter]) => <label key={label as string}>{label as string}<span className="password-input"><input type={shown as boolean ? 'text' : 'password'} value={value as string} onChange={(event) => (setter as (value: string) => void)(event.target.value)} autoComplete="new-password" /><button type="button" onClick={() => (setShown as (value: boolean) => void)(!(shown as boolean))} aria-label="Alternar visibilidade">{shown as boolean ? <EyeOff size={16} /> : <Eye size={16} />}</button></span></label>)}
          <div className="password-meter"><div className="password-meter-track"><i style={{ width: `${strength.score * 20}%` }} /></div><strong>{strength.label}</strong></div>
          <ul className="password-rules">{Object.entries({ length: '12+ caracteres', upper: 'Letra maiúscula', lower: 'Letra minúscula', number: 'Número', symbol: 'Símbolo' }).map(([key, label]) => <li key={key} className={strength.requirements[key as keyof typeof strength.requirements] ? 'ok' : ''}><Check size={14} />{label}</li>)}</ul>
          <button className="settings-primary-button" type="submit" disabled={saving}>Atualizar senha</button>
        </form>
        <section className="settings-card settings-main-card">
          <div className="settings-card-heading"><div><span>AUTENTICAÇÃO FORTE</span><h2>2FA / MFA</h2></div><ShieldCheck size={20} /></div>
          <p className="settings-description">Use um autenticador TOTP para elevar a sessão a AAL2 e proteger ações sensíveis.</p>
          {factors.map((factor) => <div className="mfa-factor" key={factor.id}><div><strong>{factor.friendly_name ?? 'Authenticator'}</strong><span>{factor.status === 'verified' ? 'Verificado' : factor.status}</span></div><button className="settings-danger-button" type="button" onClick={() => void disableMfa(factor.id)}>Remover</button></div>)}
          {!factors.length && !enrollingFactor && <button className="settings-primary-button" type="button" onClick={() => void beginMfa()}>Ativar autenticador</button>}
          {enrollingFactor && <div className="mfa-enroll"><img src={`data:image/svg+xml;utf8,${encodeURIComponent(enrollingFactor.qr)}`} alt="QR Code para autenticação" /><p>Escaneie no seu autenticador e informe o código de 6 dígitos.</p><code>{enrollingFactor.secret}</code><input inputMode="numeric" pattern="[0-9]{6}" maxLength={6} value={mfaCode} onChange={(event) => setMfaCode(event.target.value.replace(/\D/g, ''))} placeholder="000000" /><button className="settings-primary-button" type="button" onClick={() => void verifyMfa()} disabled={mfaCode.length !== 6}>Verificar e ativar</button></div>}
        </section>
      </section>}

      {tab === 'business' && <section className="settings-grid">
        <form className="settings-card settings-main-card" onSubmit={(event) => void saveBusiness(event)}>
          <div className="settings-card-heading"><div><span>ORGANIZAÇÃO</span><h2>Dados da operação</h2></div><Building2 size={20} /></div>
          <div className="settings-two-columns"><label>Documento<select value={business.document_type} onChange={(event) => setBusiness((current) => ({ ...current, document_type: event.target.value === 'CPF' ? 'CPF' : 'CNPJ' }))}><option value="CNPJ">CNPJ</option><option value="CPF">CPF</option></select></label><label>Número<input value={business.document_number} onChange={(event) => setBusiness((current) => ({ ...current, document_number: event.target.value }))} /></label></div>
          <label>Razão Social<input value={business.legal_name} onChange={(event) => setBusiness((current) => ({ ...current, legal_name: event.target.value }))} /></label>
          <label>Metadados da operação<textarea rows={9} value={business.operation_metadata} onChange={(event) => setBusiness((current) => ({ ...current, operation_metadata: event.target.value }))} spellCheck={false} /></label>
          <button className="settings-primary-button" type="submit" disabled={saving}>Salvar operação</button>
        </form>
        <section className="settings-card settings-main-card">
          <div className="settings-card-heading"><div><span>PROVIDER VAULT</span><h2>Credenciais externas</h2></div><KeyRound size={20} /></div>
          <form className="credential-form" onSubmit={(event) => void saveCredential(event)}><label>Provedor<select value={credentialGateway} onChange={(event) => setCredentialGateway(event.target.value as GatewayName)}>{GATEWAYS.map((gateway) => <option key={gateway.value} value={gateway.value}>{gateway.label}</option>)}</select></label><label>Chave de API<input type="password" value={credentialKey} onChange={(event) => setCredentialKey(event.target.value)} placeholder="Nunca exibida depois de salvar" autoComplete="new-password" /></label><div className="settings-two-columns"><label>Prioridade<input type="number" min="1" step="1" value={credentialPriority} onChange={(event) => setCredentialPriority(event.target.value)} /></label><label className="toggle-field">Ativo<input type="checkbox" checked={credentialActive} onChange={(event) => setCredentialActive(event.target.checked)} /></label></div><button className="settings-primary-button" type="submit" disabled={saving}><KeyRound size={16} />Criptografar e salvar</button></form>
          <div className="credential-list">{credentials.map((credential) => <div className="credential-item" key={credential.id}><div><strong>{GATEWAYS.find((gateway) => gateway.value === credential.gateway_name)?.label ?? credential.gateway_name}</strong><span>Prioridade {credential.priority_order} · segredo protegido</span></div><button className={credential.is_active ? 'credential-active' : 'credential-inactive'} type="button" onClick={() => void toggleCredential(credential)}>{credential.is_active ? 'Ativo' : 'Inativo'}</button></div>)}{!credentials.length && <p className="settings-empty">Nenhum provedor configurado.</p>}</div>
        </section>
      </section>}
    </main>
  )
}
