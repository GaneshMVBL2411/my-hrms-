import { useMemo } from "react"
import { Plus } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet"
import { Skeleton } from "@/components/ui/skeleton"
import { statusTone, type LeaveBalance, type LeaveRequest } from "@/features/leaves/types"

interface LeaveTypeDetailSheetProps {
  /** The clicked balance card, or null when the panel is closed. */
  balance: LeaveBalance | null
  /** Every request of the signed-in employee; filtered to this type here. */
  requests: LeaveRequest[]
  isLoading: boolean
  onOpenChange: (open: boolean) => void
  onApply: (leaveTypeId: number) => void
}

/**
 * The breakdown behind one balance card: how the allocation has been spent, and
 * every request of that type. The cards only ever had room for two numbers, so
 * the history — the part that explains *why* the remaining figure is what it is
 * — had nowhere to live until now.
 */
export function LeaveTypeDetailSheet({
  balance,
  requests,
  isLoading,
  onOpenChange,
  onApply,
}: LeaveTypeDetailSheetProps) {
  const history = useMemo(
    () => (balance ? requests.filter((r) => r.leaveTypeId === balance.leaveTypeId) : []),
    [balance, requests]
  )

  const allocated = Number(balance?.allocatedDays ?? 0)
  const used = Number(balance?.usedDays ?? 0)
  const remaining = Number(balance?.remainingDays ?? 0)
  // Only approved leave spends the balance, so a pending request is shown
  // separately rather than folded into the bar — it is not yet a deduction.
  const pendingDays = history
    .filter((r) => r.status === "pending")
    .reduce((total, r) => total + Number(r.daysCount), 0)
  const usedPercent = allocated > 0 ? Math.min(100, (used / allocated) * 100) : 0

  return (
    <Sheet open={balance !== null} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="max-w-md overflow-y-auto p-0">
        <div className="border-b border-border px-6 py-5">
          <SheetTitle className="text-base">{balance?.leaveTypeName}</SheetTitle>
          <SheetDescription className="text-xs">Your balance and history for {balance?.year}</SheetDescription>
        </div>

        <div className="space-y-6 px-6 py-5">
          <div>
            <p className="text-3xl font-semibold text-foreground">
              {remaining}
              <span className="text-base font-normal text-muted-foreground"> / {allocated} days left</span>
            </p>

            <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${usedPercent}%` }} />
            </div>

            <div className="mt-3 grid grid-cols-3 gap-3 text-center">
              {[
                { label: "Allocated", value: allocated },
                { label: "Used", value: used },
                { label: "Remaining", value: remaining },
              ].map((stat) => (
                <div key={stat.label} className="rounded-md border border-border py-2">
                  <p className="text-sm font-semibold text-foreground">{stat.value}</p>
                  <p className="text-xs text-muted-foreground">{stat.label}</p>
                </div>
              ))}
            </div>

            {pendingDays > 0 && (
              <p className="mt-3 text-xs text-muted-foreground">
                {pendingDays} {pendingDays === 1 ? "day" : "days"} awaiting approval — not deducted yet.
              </p>
            )}
          </div>

          <Button
            className="w-full rounded-md"
            onClick={() => balance && onApply(balance.leaveTypeId)}
            disabled={remaining <= 0}
          >
            <Plus className="mr-2 size-4" />
            {remaining > 0 ? `Apply for ${balance?.leaveTypeName}` : "No days remaining"}
          </Button>

          <div>
            <p className="mb-2 text-xs font-medium text-muted-foreground">History</p>

            {isLoading && <Skeleton className="h-16 w-full rounded-md" />}

            {!isLoading && history.length === 0 && (
              <p className="rounded-md border border-dashed border-border py-8 text-center text-sm text-muted-foreground">
                No {balance?.leaveTypeName.toLowerCase()} taken yet.
              </p>
            )}

            <ul className="space-y-2">
              {history.map((r) => (
                <li key={r.id} className="rounded-md border border-border px-3 py-2.5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm text-foreground">
                        {r.startDate} → {r.endDate}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {r.daysCount} {Number(r.daysCount) === 1 ? "day" : "days"}
                      </p>
                    </div>
                    <Badge variant={statusTone[r.status]} className="shrink-0 capitalize">
                      {r.status}
                    </Badge>
                  </div>

                  {r.reason && <p className="mt-1.5 text-xs text-muted-foreground">{r.reason}</p>}

                  {r.decidedByName && (
                    <p className="mt-1.5 text-xs text-muted-foreground">
                      {r.status === "approved" ? "Approved" : "Rejected"} by {r.decidedByName}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}
