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
import { useAuth } from "@/features/auth/AuthContext"
import type { LeaveStatus } from "@/features/leaves/types"
import { errorMessage } from "@/lib/errors"

const statusTone: Record<LeaveStatus, "success" | "warning" | "danger"> = {
  approved: "success",
  pending: "warning",
  rejected: "danger",
}

export function LeavesPage() {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const isApprover = user?.role === "founder" || user?.role === "hr_admin"
  const [applyOpen, setApplyOpen] = useState(false)

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

  const approveMutation = useMutation({
    mutationFn: approveLeave,
    onSuccess: () => {
      toast.success("Leave approved")
      invalidate()
    },
    onError: () => toast.error("Could not approve leave"),
  })

  const rejectMutation = useMutation({
    mutationFn: rejectLeave,
    onSuccess: () => {
      toast.success("Leave rejected")
      invalidate()
    },
    onError: () => toast.error("Could not reject leave"),
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
        {!isApprover && (
          <Button className="rounded-md" onClick={() => setApplyOpen(true)}>
            <Plus className="mr-2 size-4" />
            Apply Leave
          </Button>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {loadingBalances &&
          Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-20 w-full rounded-md" />)}
        {balances?.map((b) => (
          <Card key={b.id} className="rounded-md border shadow-none">
            <CardContent className="py-4">
              <p className="text-xs text-muted-foreground">{b.leaveTypeName}</p>
              <p className="mt-1 text-lg font-semibold text-foreground">
                {b.remainingDays}
                <span className="text-sm font-normal text-muted-foreground"> / {b.allocatedDays} days</span>
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Tabs defaultValue={isApprover ? "approvals" : "mine"}>
        <TabsList className="rounded-md">
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
        </TabsList>

        <TabsContent value="mine" className="mt-4">
          <div className="overflow-hidden rounded-md border border-border bg-card">
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
            <div className="overflow-hidden rounded-md border border-border bg-card">
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
                            onClick={() => approveMutation.mutate(r.id)}
                          >
                            <Check className="size-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            className="text-destructive hover:text-destructive"
                            onClick={() => rejectMutation.mutate(r.id)}
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
      </Tabs>

      <ApplyLeaveDialog open={applyOpen} onOpenChange={setApplyOpen} />
    </div>
  )
}
