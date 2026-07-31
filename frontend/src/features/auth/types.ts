export type Role = "founder" | "hr_admin" | "project_manager" | "team_lead" | "employee"

export interface AuthUser {
  id: number
  email: string
  role: Role
  fullName: string
  employeeId: number | null
  photoUrl: string | null
}
