import { Navigate, Outlet, useLocation } from "react-router-dom"
import { useAuth } from "@/features/auth/AuthContext"
import { Skeleton } from "@/components/ui/skeleton"

export function ProtectedRoute() {
  const { user, isLoading } = useAuth()
  const location = useLocation()

  if (isLoading) {
    return (
      <div className="flex h-svh w-full items-center justify-center bg-background">
        <Skeleton className="h-10 w-48 rounded-md" />
      </div>
    )
  }

  if (!user) {
    return <Navigate to="/login" state={{ from: location }} replace />
  }

  return <Outlet />
}
