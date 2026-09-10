import { supabase } from "@/lib/supabase"
import { unwrap } from "@/lib/errors"

/**
 * The platform tier — what the HRMS owner sees, as opposed to what a client
 * company sees.
 *
 * Every call goes through a database function that re-checks
 * app_is_platform_user() for itself. A company admin who found these endpoints
 * gets a 403 from Postgres, not from a check in this file.
 */

export interface CompanyOverview {
  id: number
  name: string
  code: string
  status: "trial" | "active" | "suspended" | "inactive"
  onboardingStatus: string
  email: string | null
  phone: string | null
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
  enabledModules: string[]
  plan: string | null
  subscriptionId: number | null
  monthlyPrice: number | null
  billingCycle: "monthly" | "quarterly" | "annual" | null
  paymentStatus: "verified" | "pending" | "waived" | "failed" | null
  paymentReference: string | null
  paymentNotes: string | null
  startDate: string | null
  endDate: string | null
  adminEmail: string | null
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
  totalMrr?: number
  pendingPayments?: number
}

export interface SubscriptionPlan {
  id: number
  name: string
  description: string | null
  employeeLimit: number | null
  storageMb: number | null
  priceAmount: number | null
  priceCurrency: string
  defaultModules: string[]
}

export interface CreateCompanyInput {
  name: string
  code: string
  adminEmail: string
  adminName: string
  adminPassword: string
  planId?: number
  monthlyPrice?: number | null
  billingCycle?: string
  paymentStatus?: "verified" | "pending" | "waived" | "failed"
  paymentReference?: string
  paymentNotes?: string
  modules?: string[]
  phone?: string
  country?: string
  primaryColor?: string
}

export interface CreateCompanyResult {
  companyId: number
  code: string
  name: string
  status: string
  adminEmail: string
  adminName: string
  employeeId: number
}

export interface UpdateSubscriptionInput {
  companyId: number
  planId?: number
  status?: string
  monthlyPrice?: number | null
  billingCycle?: string
  paymentStatus?: string
  paymentReference?: string
  paymentNotes?: string
  endDate?: string | null
}

export async function listCompanies(): Promise<CompanyOverview[]> {
  return unwrap<CompanyOverview[]>(await supabase.rpc("platform_company_overview"))
}

export async function getPlatformSummary(): Promise<PlatformSummary> {
  return unwrap<PlatformSummary>(await supabase.rpc("platform_summary"))
}

export async function listSubscriptionPlans(): Promise<SubscriptionPlan[]> {
  return unwrap<SubscriptionPlan[]>(await supabase.rpc("platform_subscription_plans"))
}

export async function createCompany(input: CreateCompanyInput): Promise<CreateCompanyResult> {
  return unwrap<CreateCompanyResult>(
    await supabase.rpc("platform_create_company", {
      p_name: input.name,
      p_code: input.code,
      p_admin_email: input.adminEmail,
      p_admin_name: input.adminName,
      p_admin_password: input.adminPassword,
      p_plan_id: input.planId ?? null,
      p_monthly_price: input.monthlyPrice ?? null,
      p_billing_cycle: input.billingCycle ?? "monthly",
      p_payment_status: input.paymentStatus ?? "verified",
      p_payment_reference: input.paymentReference ?? null,
      p_payment_notes: input.paymentNotes ?? null,
      p_modules: input.modules ?? null,
      p_phone: input.phone ?? null,
      p_country: input.country ?? "India",
      p_primary_color: input.primaryColor ?? "#0F4C34",
    })
  )
}

export async function updateCompanySubscription(input: UpdateSubscriptionInput): Promise<void> {
  unwrap(
    await supabase.rpc("platform_update_subscription", {
      p_company_id: input.companyId,
      p_plan_id: input.planId ?? null,
      p_status: input.status ?? null,
      p_monthly_price: input.monthlyPrice ?? null,
      p_billing_cycle: input.billingCycle ?? null,
      p_payment_status: input.paymentStatus ?? null,
      p_payment_reference: input.paymentReference ?? null,
      p_payment_notes: input.paymentNotes ?? null,
      p_end_date: input.endDate ?? null,
    })
  )
}

export async function updateCompanyModules(companyId: number, modules: string[]): Promise<void> {
  unwrap(
    await supabase.rpc("platform_update_company_modules", {
      p_company_id: companyId,
      p_modules: modules,
    })
  )
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
