import { Suspense } from 'react'
import { Loader2 } from 'lucide-react'
import JourneyClient from './journey-client'

function Loading() {
  return <main className="min-h-screen grid place-items-center bg-[#020203] text-white"><Loader2 className="h-6 w-6 animate-spin text-emerald-400" /></main>
}

export default async function FunnelJourneyPage({ searchParams }: { searchParams: Promise<{ funnel?: string }> }) {
  const params = await searchParams
  const funnelId = params.funnel ?? ''
  return <Suspense fallback={<Loading />}><JourneyClient funnelId={funnelId} /></Suspense>
}
