import { redirect } from 'next/navigation'

/**
 * Gateway configuration has one canonical persistence flow in the main
 * settings center. This route remains valid for existing navigation/bookmarks
 * and must never expose a fake client-side save operation.
 */
export default function GatewaysSettingsPage() {
  redirect('/dashboard/settings')
}
