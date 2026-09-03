import { useAuth } from "@/features/auth/AuthContext"
import { DashboardPage } from "@/features/dashboard/DashboardPage"
import { PlatformDashboard } from "@/features/platform/PlatformDashboard"

/**
 * Decides which dashboard /dashboard actually is.
 *
 * A platform admin with no support session open belongs to no company, so the
 * ordinary HRMS dashboard can only ever show them zeros — which is what it did.
 * They get the company list instead.
 *
 * Once they enter a company the session resolves to that tenant, and the normal
 * dashboard is exactly right: the point of support mode is to see what the
 * customer sees.
 */
export function PlatformHome() {
  const { user } = useAuth()

  if (user?.isSuperAdmin && !user.supportCompanyId) return <PlatformDashboard />
  return <DashboardPage />
}
