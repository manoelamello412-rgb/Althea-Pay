import { Suspense } from 'react'
import { Loader2 } from 'lucide-react'
import JourneyClient from './journey-client'

function Loading() {
  return <div className="grid min-h-[320px] place-items-center text-white"><Loader2 className="h-6 w-6 animate-spin text-[var(--althea-brand)]" /></div>
}

export default async function FunnelJourneyPage({ searchParams }: { searchParams: Promise<{ funnel?: string }> }) {
  const params = await searchParams
  const funnelId = params.funnel ?? ''
  return <Suspense fallback={<Loading />}><JourneyClient funnelId={funnelId} /></Suspense>
}
