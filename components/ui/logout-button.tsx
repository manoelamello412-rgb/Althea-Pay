'use client'

import { useCallback, useState } from 'react'
import { LogOut, Loader2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'

function clearClientAuthArtifacts(): void {
  try {
    window.sessionStorage.clear()

    const localStorageKeys: string[] = []
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index)
      if (key && (key.startsWith('sb-') || key.toLowerCase().includes('supabase'))) {
        localStorageKeys.push(key)
      }
    }

    for (const key of localStorageKeys) {
      window.localStorage.removeItem(key)
    }
  } catch (error) {
    console.warn('Não foi possível limpar todos os artefatos locais de autenticação.', error)
  }
}

export default function LogoutButton() {
  const router = useRouter()
  const [isPending, setIsPending] = useState(false)

  const handleSignOut = useCallback(async () => {
    if (isPending) return

    setIsPending(true)
    const supabase = createSupabaseBrowserClient()

    try {
      const { error } = await supabase.auth.signOut({ scope: 'global' })
      if (error) {
        console.error('Falha na invalidação da sessão no Supabase:', error)
      }
    } catch (error) {
      console.error('Falha no pipeline de desautenticação:', error)
    } finally {
      clearClientAuthArtifacts()
      router.replace('/login')
      router.refresh()
    }
  }, [isPending, router])

  return (
    <button
      type="button"
      onClick={() => void handleSignOut()}
      disabled={isPending}
      aria-label="Sair da plataforma"
      title="Encerrar sessão"
      className="inline-flex h-8 items-center justify-center gap-2 rounded-lg border border-[#191921] bg-[#0B0B0F] px-3 text-xs font-medium text-[#F43F5E] transition-all duration-150 hover:border-[#2A2A32] hover:bg-[#121217] hover:text-[#F43F5E] active:bg-[#191921] disabled:cursor-not-allowed disabled:opacity-50 focus:outline-none focus:ring-1 focus:ring-[#F43F5E]/40 select-none"
    >
      {isPending ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2.5} aria-hidden="true" />
      ) : (
        <LogOut className="h-3.5 w-3.5" strokeWidth={2.5} aria-hidden="true" />
      )}
      <span>{isPending ? 'Saindo…' : 'Sair'}</span>
    </button>
  )
}
