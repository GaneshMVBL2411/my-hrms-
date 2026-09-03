import { supabase } from "@/lib/supabase"
import { unwrap } from "@/lib/errors"

/**
 * The platform tier — what the HRMS owner sees, as opposed to what a client
 * company sees.
 *
 * Every call goes through a database function that re-checks
 * app_is_super_admin() for itself. A company admin who found these endpoints
 * gets a 403 from Postgres, not from a check in this file.
 */

export interface CompanyOverview {
  id: number
  name: string
  code: string
  status: "trial" | "active" | "suspended" | "inactive"
  onboardingStatus: string
  email: string | null
  country: string | null
  industry: string | null
  logoUrl: string | null
  primaryColor: string | null
  registeredOn: string | null
  employeeLimit: number | null
  createdAt: string
  employees: number
  users: number
  payslips: number
  pendingLeave: number
  modules: number
  plan: string | null
  /** Null means nobody there has ever signed in — a stalled onboarding. */
  lastSignIn: string | null
  supportOpen: boolean
}

export interface PlatformSummary {
  companies: number
  activeCompanies: number
  inactiveCompanies: number
  employees: number
  subscriptions: number
  openSupport: number
}

export async function listCompanies(): Promise<CompanyOverview[]> {
  return unwrap<CompanyOverview[]>(await supabase.rpc("platform_company_overview"))
}

export async function getPlatformSummary(): Promise<PlatformSummary> {
  return unwrap<PlatformSummary>(await supabase.rpc("platform_summary"))
}

/**
 * Enters a company. From this point the super admin's session resolves to that
 * tenant and they see exactly what a user there would — no more, and with a row
 * in support_sessions recording it.
 */
export async function startSupport(companyId: number, reason?: string): Promise<number> {
  return unwrap<number>(
    await supabase.rpc("start_support_session", {
      p_company_id: companyId,
      p_reason: reason ?? null,
    })
  )
}

export async function endSupport(): Promise<number> {
  return unwrap<number>(await supabase.rpc("end_support_session"))
}
