import { redirect } from 'next/navigation'

export default function NewFunnelPage() {
  redirect('/dashboard/funil?create=1')
}
