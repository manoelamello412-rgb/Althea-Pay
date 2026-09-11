import { redirect } from 'next/navigation'

// Mobile CRM route intentionally delegates to the canonical CRM surface.
export default function CRMChatMobilePage() {
  redirect('/dashboard/crm')
}
