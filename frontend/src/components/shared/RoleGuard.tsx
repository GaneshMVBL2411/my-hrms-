import { Navigate } from "react-router-dom"
import { useAuth } from "@/features/auth/AuthContext"
import type { Role } from "@/features/auth/types"

export function RoleGuard({ roles, children }: { roles: Role[]; children: React.ReactNode }) {
  const { user } = useAuth()

  if (!user || (!user.isSuperAdmin && !roles.includes(user.role))) {
    return <Navigate to="/dashboard" replace />
  }

  return <>{children}</>
}
