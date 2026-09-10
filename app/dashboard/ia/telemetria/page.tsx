'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import IaraMetricsDashboard from '@/client/IaraMetricsDashboard'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'

export default function IaraTelemetryRoute() {
  const router = useRouter()

  useEffect(() => {
    const db = createSupabaseBrowserClient()
    void db.auth.getUser().then(({ data }) => {
      if (!data.user) router.replace('/login')
    })
  }, [router])

  return <IaraMetricsDashboard />
}
