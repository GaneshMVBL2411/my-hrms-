import { useMemo, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { Download } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { listRequests } from "@/features/leaves/api"
import { listEmployees } from "@/features/employees/api"
import { statusTone, type LeaveRequest, type LeaveStatus } from "@/features/leaves/types"
import { downloadCsv } from "@/lib/csv"

/** `YYYY-MM` for the current month, which is what `<input type="month">` wants. */
function currentMonth() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`
}

/** The first and last dates of a `YYYY-MM` value, both inclusive. */
function monthRange(month: string) {
  const [year, monthNumber] = month.split("-").map(Number)
  // Day 0 of the next month is the last day of this one, leap years included.
  const lastDay = new Date(year, monthNumber, 0).getDate()
  return { from: `${month}-01`, to: `${month}-${String(lastDay).padStart(2, "0")}` }
}

/**
 * Every employee's leave, for HR. The Reports tab already totals the year's
 * balances per person; what it cannot answer is who was actually off in a given
 * month and why, which is the question asked when a month is being closed.
 */
export function AllLeavesPanel() {
  const [month, setMonth] = useState(currentMonth)
  const [employeeId, setEmployeeId] = useState<string>("all")
  const [status, setStatus] = useState<string>("all")

  const range = month ? monthRange(month) : undefined

  const { data: employees } = useQuery({
    queryKey: ["employees", "picker"],
    queryFn: () => listEmployees({ page: 1, pageSize: 500 }),
  })

  const { data: requests, isLoading } = useQuery({
    queryKey: ["leaves", "requests", "all", month, employeeId, status],
    queryFn: () =>
      listRequests({
        scope: "all",
        employeeId: employeeId === "all" ? undefined : Number(employeeId),
        status: status === "all" ? undefined : (status as LeaveStatus),
        from: range?.from,
        to: range?.to,
      }),
  })

  const rows = useMemo(() => requests ?? [], [requests])

  // Only approved leave is time actually taken; pending is still a proposal.
  const approvedDays = rows
    .filter((r) => r.status === "approved")
    .reduce((total, r) => total + Number(r.daysCount), 0)
  const pendingCount = rows.filter((r) => r.status === "pending").length

  /** The "employee wise" cut: one line per person for whatever is on screen. */
  const byEmployee = useMemo(() => {
    const totals = new Map<string, { name: string; days: number; requests: number }>()
    for (const r of rows) {
      if (r.status === "rejected") continue
      const entry = totals.get(r.employeeName) ?? { name: r.employeeName, days: 0, requests: 0 }
      entry.days += Number(r.daysCount)
      entry.requests += 1
      totals.set(r.employeeName, entry)
    }
    return [...totals.values()].sort((a, b) => b.days - a.days)
  }, [rows])

  const exportCsv = () => {
    const flat = rows.map((r: LeaveRequest) => ({
      employee: r.employeeName,
      leave_type: r.leaveTypeName,
      start_date: r.startDate,
      end_date: r.endDate,
      days: r.daysCount,
      status: r.status,
      reason: r.reason ?? "",
      decided_by: r.decidedByName ?? "",
      decision_note: r.decisionNote ?? "",
    }))
    downloadCsv(`leaves-${month || "all"}${employeeId === "all" ? "" : `-employee-${employeeId}`}.csv`, flat)
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="leave-month" className="text-xs text-muted-foreground">
            Month
          </Label>
          <Input
            id="leave-month"
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            className="w-44 rounded-md"
          />
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Employee</Label>
          <Select value={employeeId} onValueChange={setEmployeeId}>
            <SelectTrigger className="w-56 rounded-md">
              <SelectValue placeholder="All employees" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All employees</SelectItem>
              {employees?.items.map((e) => (
                <SelectItem key={e.id} value={String(e.id)}>
                  {e.fullName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Status</Label>
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="w-40 rounded-md">
              <SelectValue placeholder="All statuses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="approved">Approved</SelectItem>
              <SelectItem value="rejected">Rejected</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="ml-auto flex items-end gap-2">
          {month && (
            <Button variant="ghost" className="rounded-md" onClick={() => setMonth("")}>
              All months
            </Button>
          )}
          <Button variant="outline" className="rounded-md" onClick={exportCsv} disabled={rows.length === 0}>
            <Download className="mr-2 size-4" />
            Export CSV
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: "Requests", value: rows.length },
          { label: "Days approved", value: approvedDays },
          { label: "Pending", value: pendingCount },
          { label: "Employees", value: byEmployee.length },
        ].map((stat) => (
          <Card key={stat.label} className="rounded-md border shadow-none">
            <CardContent className="py-4">
              <p className="text-xs text-muted-foreground">{stat.label}</p>
              <p className="mt-1 text-lg font-semibold text-foreground">{stat.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {employeeId === "all" && byEmployee.length > 0 && (
        <div className="rounded-md border border-border bg-card px-4 py-3">
          <p className="mb-2 text-xs font-medium text-muted-foreground">
            By employee{month ? ` — ${month}` : ""} (rejected requests excluded)
          </p>
          <div className="flex flex-wrap gap-2">
            {byEmployee.map((e) => (
              <span
                key={e.name}
                className="rounded-md border border-border px-2.5 py-1 text-xs text-muted-foreground"
              >
                {e.name}
                <span className="ml-1.5 font-semibold text-foreground">
                  {e.days} {e.days === 1 ? "day" : "days"}
                </span>
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="overflow-hidden rounded-md border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Employee</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Dates</TableHead>
              <TableHead>Days</TableHead>
              <TableHead>Reason</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Decided by</TableHead>
              <TableHead>Note</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && (
              <TableRow>
                <TableCell colSpan={8}>
                  <Skeleton className="h-8 w-full rounded-md" />
                </TableCell>
              </TableRow>
            )}
            {!isLoading && rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={8} className="py-8 text-center text-sm text-muted-foreground">
                  No leave records match these filters.
                </TableCell>
              </TableRow>
            )}
            {rows.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="font-medium text-foreground">{r.employeeName}</TableCell>
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
                <TableCell className="text-muted-foreground">{r.decidedByName ?? "—"}</TableCell>
                <TableCell className="max-w-56 truncate text-muted-foreground" title={r.decisionNote ?? undefined}>
                  {r.decisionNote ?? "—"}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
