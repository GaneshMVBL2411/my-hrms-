import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { Plus, Check, X } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Skeleton } from "@/components/ui/skeleton"
import { getBalance, listRequests, approveLeave, rejectLeave, cancelLeave } from "@/features/leaves/api"
import { ApplyLeaveDialog } from "@/features/leaves/ApplyLeaveDialog"
import { LeaveTypeDetailSheet } from "@/features/leaves/LeaveTypeDetailSheet"
import { AllLeavesPanel } from "@/features/leaves/AllLeavesPanel"
import { DecideLeaveDialog } from "@/features/leaves/DecideLeaveDialog"
import { useAuth } from "@/features/auth/AuthContext"
import { statusTone, type LeaveBalance, type LeaveRequest } from "@/features/leaves/types"
import { errorMessage } from "@/lib/errors"

export function LeavesPage() {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const isApprover = (user?.role === "founder" || user?.role === "company_admin") || user?.role === "hr_admin"
  const [applyOpen, setApplyOpen] = useState(false)
  const [applyTypeId, setApplyTypeId] = useState<number | undefined>()
  const [selectedBalance, setSelectedBalance] = useState<LeaveBalance | null>(null)
  // Which request is being decided, and which way. Held together so the dialog
  // can never open asking "why are you rejecting?" about an approval.
  const [deciding, setDeciding] = useState<{ request: LeaveRequest; approve: boolean } | null>(null)

  const { data: balances, isLoading: loadingBalances } = useQuery({
    queryKey: ["leaves", "balance"],
    queryFn: getBalance,
  })

  const { data: myRequests, isLoading: loadingMine } = useQuery({
    queryKey: ["leaves", "requests", "mine"],
    queryFn: () => listRequests({ scope: "mine" }),
  })

  const { data: pendingRequests, isLoading: loadingPending } = useQuery({
    queryKey: ["leaves", "requests", "pending"],
    queryFn: () => listRequests({ scope: "all", status: "pending" }),
    enabled: isApprover,
  })

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["leaves"] })

  const decideMutation = useMutation({
    mutationFn: ({ id, approve, note }: { id: number; approve: boolean; note: string }) =>
      approve ? approveLeave(id, note) : rejectLeave(id, note),
    onSuccess: (_data, variables) => {
      toast.success(variables.approve ? "Leave approved" : "Leave rejected — they will see your note")
      setDeciding(null)
      invalidate()
    },
    onError: (error, variables) =>
      toast.error(errorMessage(error, `Could not ${variables.approve ? "approve" : "reject"} leave`)),
  })

  const cancelMutation = useMutation({
    mutationFn: cancelLeave,
    onSuccess: () => {
      toast.success("Leave request cancelled")
      invalidate()
    },
    onError: (error) => {
      toast.error(errorMessage(error, "Could not cancel request"))
    },
  })

  return (
    <div className="flex flex-1 flex-col gap-5">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-foreground">Leaves</h1>
        {/* Approvers are employees too: the balance cards below are their own,
            and `apply_leave` only ever asks for a linked employee profile. */}
        <Button className="rounded-xl shadow-xs" onClick={() => setApplyOpen(true)}>
          <Plus className="mr-2 size-4" />
          Apply Leave
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-2.5 sm:gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {loadingBalances &&
          Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-20 w-full rounded-xl" />)}
        {/* A real button, not a click handler on the Card: the cards are the
            only way into the per-type history, so they have to be reachable by
            keyboard and announced as actionable. */}
        {balances?.map((b) => (
          <Card key={b.id} className="rounded-xl border shadow-xs transition-all duration-300 interactive-card hover:border-primary/50">
            <CardContent className="p-0">
              <button
                type="button"
                onClick={() => setSelectedBalance(b)}
                aria-label={`${b.leaveTypeName}: ${b.remainingDays} of ${b.allocatedDays} days remaining`}
                className="w-full cursor-pointer rounded-xl px-4 py-3.5 sm:px-5 sm:py-4 text-left select-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              >
                <p className="text-xs text-muted-foreground truncate">{b.leaveTypeName}</p>
                <p className="mt-1 text-base sm:text-lg font-bold text-foreground">
                  {b.remainingDays}
                  <span className="text-xs sm:text-sm font-normal text-muted-foreground"> / {b.allocatedDays} d</span>
                </p>
              </button>
            </CardContent>
          </Card>
        ))}
      </div>

      <Tabs defaultValue={isApprover ? "approvals" : "mine"}>
        <TabsList className="rounded-xl">
          <TabsTrigger value="mine">My Leaves</TabsTrigger>
          {isApprover && (
            <TabsTrigger value="approvals" className="gap-1.5">
              Approvals
              {(pendingRequests?.length ?? 0) > 0 && (
                <Badge variant="warning" className="h-5 min-w-5 justify-center px-1">
                  {pendingRequests?.length}
                </Badge>
              )}
            </TabsTrigger>
          )}
          {isApprover && <TabsTrigger value="all">All Leaves</TabsTrigger>}
        </TabsList>

        <TabsContent value="mine" className="mt-4">
          <div className="overflow-x-auto touch-pan-x rounded-xl border border-border bg-card shadow-2xs">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Type</TableHead>
                  <TableHead>Dates</TableHead>
                  <TableHead>Days</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-20" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {loadingMine && (
                  <TableRow>
                    <TableCell colSpan={6}>
                      <Skeleton className="h-8 w-full rounded-md" />
                    </TableCell>
                  </TableRow>
                )}
                {!loadingMine && (myRequests?.length ?? 0) === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="py-8 text-center text-sm text-muted-foreground">
                      No leave requests yet.
                    </TableCell>
                  </TableRow>
                )}
                {myRequests?.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>{r.leaveTypeName}</TableCell>
                    <TableCell>
                      {r.startDate} → {r.endDate}
                    </TableCell>
                    <TableCell>{r.daysCount}</TableCell>
                    <TableCell className="max-w-48 truncate text-muted-foreground">{r.reason ?? "—"}</TableCell>
                    <TableCell>
                      <Badge variant={statusTone[r.status]} className="capitalize">
                        {r.status}
                      </Badge>
                      {r.decisionNote && (
                        <p className="mt-1 max-w-64 text-xs leading-snug text-muted-foreground">
                          <span className="font-medium text-foreground">
                            {r.decidedByName ? `${r.decidedByName}: ` : ""}
                          </span>
                          {r.decisionNote}
                        </p>
                      )}
                    </TableCell>
                    <TableCell>
                      {r.status === "pending" && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-destructive hover:text-destructive"
                          onClick={() => cancelMutation.mutate(r.id)}
                        >
                          Cancel
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        {isApprover && (
          <TabsContent value="approvals" className="mt-4">
            <div className="overflow-x-auto touch-pan-x rounded-xl border border-border bg-card shadow-2xs">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Employee</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Dates</TableHead>
                    <TableHead>Days</TableHead>
                    <TableHead>Reason</TableHead>
                    <TableHead className="w-32">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loadingPending && (
                    <TableRow>
                      <TableCell colSpan={6}>
                        <Skeleton className="h-8 w-full rounded-md" />
                      </TableCell>
                    </TableRow>
                  )}
                  {!loadingPending && (pendingRequests?.length ?? 0) === 0 && (
                    <TableRow>
                      <TableCell colSpan={6} className="py-8 text-center text-sm text-muted-foreground">
                        No pending requests.
                      </TableCell>
                    </TableRow>
                  )}
                  {pendingRequests?.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell>{r.employeeName}</TableCell>
                      <TableCell>{r.leaveTypeName}</TableCell>
                      <TableCell>
                        {r.startDate} → {r.endDate}
                      </TableCell>
                      <TableCell>{r.daysCount}</TableCell>
                      <TableCell className="max-w-48 truncate text-muted-foreground">{r.reason ?? "—"}</TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            className="text-success hover:text-success"
                            onClick={() => setDeciding({ request: r, approve: true })}
                          >
                            <Check className="size-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            className="text-destructive hover:text-destructive"
                            onClick={() => setDeciding({ request: r, approve: false })}
                          >
                            <X className="size-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </TabsContent>
        )}
        {isApprover && (
          <TabsContent value="all" className="mt-4">
            <AllLeavesPanel />
          </TabsContent>
        )}
      </Tabs>

      <DecideLeaveDialog
        request={deciding?.request ?? null}
        approve={deciding?.approve ?? true}
        open={deciding !== null}
        onOpenChange={(next) => !next && setDeciding(null)}
        pending={decideMutation.isPending}
        onConfirm={(note) =>
          deciding && decideMutation.mutate({ id: deciding.request.id, approve: deciding.approve, note })
        }
      />

      <LeaveTypeDetailSheet
        balance={selectedBalance}
        requests={myRequests ?? []}
        isLoading={loadingMine}
        onOpenChange={(open) => !open && setSelectedBalance(null)}
        onApply={(leaveTypeId) => {
          // Hand off to the dialog with the type already chosen, and close the
          // panel behind it — two stacked overlays trap focus in the wrong one.
          setSelectedBalance(null)
          setApplyTypeId(leaveTypeId)
          setApplyOpen(true)
        }}
      />

      <ApplyLeaveDialog
        open={applyOpen}
        onOpenChange={(open) => {
          setApplyOpen(open)
          if (!open) setApplyTypeId(undefined)
        }}
        defaultLeaveTypeId={applyTypeId}
      />
    </div>
  )
}
