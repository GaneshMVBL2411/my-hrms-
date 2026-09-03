import type { Role } from "@/features/auth/types"

const EMPLOYEE_MANAGERS: Role[] = ["founder", "company_admin", "hr_admin"]

export function canManageEmployees(role: Role | undefined): boolean {
  return !!role && EMPLOYEE_MANAGERS.includes(role)
}
