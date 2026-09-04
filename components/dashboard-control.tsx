'use client'

import DashboardMobileModern from './dashboard-mobile-modern'
import { MobileHeaderDashboard } from './mobile-header-dashboard'

export default function DashboardControl() {
  return (
    <div className="bg-[#0B0B0D] [&>section>div>header]:hidden [&>section>div>header+div]:hidden">
      <MobileHeaderDashboard />
      <DashboardMobileModern />
    </div>
  )
}
