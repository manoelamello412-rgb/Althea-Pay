'use client'

import { useRouter } from 'next/navigation'
import { ConfigTabRecuperacao } from '@/components/config-tab-recuperacao'

export default function RecuperacaoSettingsPage() {
  const router = useRouter()
  return <ConfigTabRecuperacao onBack={() => router.push('/dashboard/settings')} />
}
