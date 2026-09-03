import { useMutation, useQueryClient } from "@tanstack/react-query"
import { LifeBuoy, X } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { useAuth } from "@/features/auth/AuthContext"
import { endSupport } from "@/features/platform/api"
import { errorMessage } from "@/lib/errors"

/**
 * Shown whenever a platform admin is inside a customer's account.
 *
 * The point is that it is impossible to forget. Someone acting inside another
 * company's HRMS, seeing their real employees and real payroll, should never be
 * a state you can drift into and lose track of — every screen carries this bar
 * until the session is closed.
 *
 * Deliberately loud, and deliberately not dismissible.
 */
export function SupportBanner() {
  const { user } = useAuth()
  const queryClient = useQueryClient()

  const leave = useMutation({
    mutationFn: endSupport,
    onSuccess: () => {
      toast.success("Support session closed")
      // Everything cached was fetched as the customer; none of it is the
      // platform admin's to see once the session ends.
      queryClient.clear()
      window.location.href = "/dashboard"
    },
    onError: (error) => toast.error(errorMessage(error, "Could not close the session")),
  })

  if (!user?.isSuperAdmin || !user.supportCompanyId) return null

  return (
    <div
      role="status"
      className="flex items-center justify-between gap-3 bg-warning px-4 py-2 text-warning-foreground"
    >
      <div className="flex min-w-0 items-center gap-2 text-sm">
        <LifeBuoy className="size-4 shrink-0" />
        <span className="font-semibold uppercase tracking-wide">Support mode</span>
        <span className="truncate">
          You are inside <strong>{user.companyName}</strong>. Everything you do here is recorded against
          your account.
        </span>
      </div>

      <Button
        size="sm"
        variant="outline"
        className="shrink-0 rounded-md bg-transparent"
        disabled={leave.isPending}
        onClick={() => leave.mutate()}
      >
        <X className="mr-1.5 size-3.5" />
        Exit
      </Button>
    </div>
  )
}
