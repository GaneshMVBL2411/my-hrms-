export type Role =
  | "founder"
  // A company_admin owns one tenant and has founder-equivalent reach inside it;
  // the database groups the two together in every RLS helper (see app_is_admin
  // and app_is_hr in neon migration 0001), so the UI must treat them the same.
  | "company_admin"
  | "hr_admin"
  | "project_manager"
  | "team_lead"
  | "employee"
  // Payroll-only role added in migration 0007. It verifies runs and reads bank
  // details, and deliberately has none of hr_admin's reach over people, leave or
  // documents — see app_is_accounts() versus app_is_hr() in 0008.
  | "accounts_manager"

export interface AuthUser {
  id: number
  email: string
  /**
   * What this person may do. For a company-defined role this is the built-in
   * it is based on, which is what every permission check here compares
   * against — a "Recruiter" based on hr_admin reads as hr_admin.
   */
  role: Role
  /**
   * What the role is called, for display. Equal to `role` for a built-in and
   * the company's own name otherwise. Never compare against it.
   */
  roleLabel: string
  fullName: string
  employeeId: number | null
  photoUrl: string | null

  /**
   * The tenant this user belongs to. Null only for a platform super admin, who
   * belongs to no company — which is exactly what distinguishes them.
   */
  companyId: number | null
  companyName: string | null
  companyCode: string | null
  companyLogoUrl: string | null
  /** Brand colours for this tenant; null falls back to the platform palette. */
  primaryColor: string | null
  secondaryColor: string | null
  accentColor: string | null
  isSuperAdmin: boolean
  /** The HRMS modules this company has enabled. Drives the sidebar. */
  modules: string[]
  /** Set while a super admin is inside a customer's account. */
  supportCompanyId: number | null
}
