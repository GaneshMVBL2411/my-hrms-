import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { Eye, Play, Pencil } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { generateBulk, getSummary, listPayslips } from "@/features/payroll/api"
import { listEmployees } from "@/features/employees/api"
import { PayslipView } from "@/features/payroll/PayslipView"
import { SalaryStructureFormDialog } from "@/features/payroll/SalaryStructureFormDialog"
import { useAuth } from "@/features/auth/AuthContext"

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
]

function money(value: number) {
  return `₹${value.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`
}

export function PayrollPage() {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const isManager = (user?.role === "founder" || user?.role === "company_admin") || user?.role === "hr_admin"
  const now = new Date()
  const [runMonth, setRunMonth] = useState(now.getMonth() + 1)
  const [runYear, setRunYear] = useState(now.getFullYear())
  const [viewPayslipId, setViewPayslipId] = useState<number | null>(null)
  const [structureEmployee, setStructureEmployee] = useState<{ id: number; name: string } | null>(null)

  // Filtered by employee explicitly, not left to row level security.
  //
  // RLS narrows this to the caller's own rows for an ordinary employee, which
  // made the omission invisible — but HR may read the whole company, so for
  // them "My Payslips" listed everyone's, truncated at the page size. The
  // section has to mean the same thing whoever is signed in.
  const { data: myPayslips, isLoading: loadingMine } = useQuery({
    queryKey: ["payslips", "mine", user?.employeeId],
    queryFn: () => listPayslips({ page: 1, pageSize: 24, employeeId: user!.employeeId! }),
    // A super admin has no employee record, so there is nothing of their own
    // to show and the query would filter on undefined.
    enabled: !!user?.employeeId,
  })

  const { data: employees } = useQuery({
    queryKey: ["employees", "all"],
    queryFn: () => listEmployees({ page: 1, pageSize: 500 }),
    enabled: isManager,
  })

  const { data: runPayslips, isLoading: loadingRun } = useQuery({
    queryKey: ["payslips", "run", runMonth, runYear],
    queryFn: () => listPayslips({ page: 1, pageSize: 100, month: runMonth, year: runYear }),
    enabled: isManager,
  })

  const { data: summary } = useQuery({
    queryKey: ["payroll", "summary", runMonth, runYear],
    queryFn: () => getSummary(runMonth, runYear),
    enabled: isManager,
  })

  const generateMutation = useMutation({
    mutationFn: () => generateBulk(runMonth, runYear),
    onSuccess: (result) => {
      toast.success(`Generated ${result.length} payslip(s)`)
      queryClient.invalidateQueries({ queryKey: ["payslips"] })
      queryClient.invalidateQueries({ queryKey: ["payroll"] })
    },
    onError: () => toast.error("Could not generate payroll"),
  })

  return (
    <div className="flex flex-1 flex-col gap-6">
      <h1 className="text-xl font-semibold text-foreground">Payroll</h1>

      {isManager && (
        <section className="flex flex-col gap-4">
          <h2 className="text-sm font-semibold text-foreground">Payroll Run</h2>

          <div className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1.5">
              <span className="text-xs text-muted-foreground">Month</span>
              <Select value={String(runMonth)} onValueChange={(v) => setRunMonth(Number(v))}>
                <SelectTrigger className="w-40 rounded-md">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MONTHS.map((m, i) => (
                    <SelectItem key={m} value={String(i + 1)}>
                      {m}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <span className="text-xs text-muted-foreground">Year</span>
              <Select value={String(runYear)} onValueChange={(v) => setRunYear(Number(v))}>
                <SelectTrigger className="w-28 rounded-md">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[now.getFullYear() - 1, now.getFullYear(), now.getFullYear() + 1].map((y) => (
                    <SelectItem key={y} value={String(y)}>
                      {y}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button className="rounded-md" disabled={generateMutation.isPending} onClick={() => generateMutation.mutate()}>
              <Play className="mr-2 size-4" />
              Generate Payroll
            </Button>
          </div>

          {summary && (
            <div className="grid grid-cols-2 gap-2.5 sm:gap-3 sm:grid-cols-4">
              <Card className="rounded-xl border shadow-xs interactive-card">
                <CardContent className="py-4">
                  <p className="text-xs text-muted-foreground">Employees Paid</p>
                  <p className="mt-1 text-lg font-semibold text-foreground">{summary.employeeCount}</p>
                </CardContent>
              </Card>
              <Card className="rounded-xl border shadow-xs interactive-card">
                <CardContent className="py-4">
                  <p className="text-xs text-muted-foreground">Total Payout</p>
                  <p className="mt-1 text-lg font-semibold text-foreground">{money(summary.totalNet)}</p>
                </CardContent>
              </Card>
              <Card className="rounded-xl border shadow-xs interactive-card">
                <CardContent className="py-4">
                  <p className="text-xs text-muted-foreground">Total Deductions</p>
                  <p className="mt-1 text-lg font-semibold text-foreground">{money(summary.totalDeductions)}</p>
                </CardContent>
              </Card>
              <Card className="rounded-xl border shadow-xs interactive-card">
                <CardContent className="py-4">
                  <p className="text-xs text-muted-foreground">Total Gross</p>
                  <p className="mt-1 text-lg font-semibold text-foreground">{money(summary.totalGross)}</p>
                </CardContent>
              </Card>
            </div>
          )}

          <div className="overflow-x-auto touch-pan-x rounded-xl border border-border bg-card shadow-2xs">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Employee</TableHead>
                  <TableHead>Gross Pay</TableHead>
                  <TableHead>Net Pay</TableHead>
                  <TableHead className="w-12" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {loadingRun && (
                  <TableRow>
                    <TableCell colSpan={4}>
                      <Skeleton className="h-8 w-full rounded-md" />
                    </TableCell>
                  </TableRow>
                )}
                {!loadingRun && (runPayslips?.items.length ?? 0) === 0 && (
                  <TableRow>
                    <TableCell colSpan={4} className="py-8 text-center text-sm text-muted-foreground">
                      No payslips generated for this month yet.
                    </TableCell>
                  </TableRow>
                )}
                {runPayslips?.items.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="font-medium text-foreground">{p.employeeName}</TableCell>
                    <TableCell>{money(p.grossPay)}</TableCell>
                    <TableCell>{money(p.netPay)}</TableCell>
                    <TableCell>
                      <Button variant="ghost" size="icon-sm" onClick={() => setViewPayslipId(p.id)}>
                        <Eye className="size-3.5" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </section>
      )}

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-foreground">My Payslips</h2>
        <div className="overflow-x-auto touch-pan-x rounded-xl border border-border bg-card shadow-2xs">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Period</TableHead>
                <TableHead>Gross Pay</TableHead>
                <TableHead>Deductions</TableHead>
                <TableHead>Net Pay</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {loadingMine && (
                <TableRow>
                  <TableCell colSpan={5}>
                    <Skeleton className="h-8 w-full rounded-md" />
                  </TableCell>
                </TableRow>
              )}
              {!loadingMine && (myPayslips?.items.length ?? 0) === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="py-8 text-center text-sm text-muted-foreground">
                    No payslips generated yet.
                  </TableCell>
                </TableRow>
              )}
              {myPayslips?.items.map((p) => (
                <TableRow key={p.id}>
                  <TableCell>
                    {MONTHS[p.month - 1]} {p.year}
                  </TableCell>
                  <TableCell>{money(p.grossPay)}</TableCell>
                  <TableCell>{money(p.grossPay - p.netPay)}</TableCell>
                  <TableCell className="font-medium text-foreground">{money(p.netPay)}</TableCell>
                  <TableCell>
                    <Button variant="ghost" size="icon-sm" onClick={() => setViewPayslipId(p.id)}>
                      <Eye className="size-3.5" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </section>

      {isManager && (
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold text-foreground">Salary Structures</h2>
          <div className="overflow-hidden rounded-md border border-border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Employee</TableHead>
                  <TableHead>Department</TableHead>
                  <TableHead className="w-12" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {employees?.items.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell className="font-medium text-foreground">{e.fullName}</TableCell>
                    <TableCell>{e.departmentName ?? "—"}</TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => setStructureEmployee({ id: e.id, name: e.fullName })}
                      >
                        <Pencil className="size-3.5" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </section>
      )}

      <PayslipView payslipId={viewPayslipId} open={!!viewPayslipId} onOpenChange={(open) => !open && setViewPayslipId(null)} />
      <SalaryStructureFormDialog
        employeeId={structureEmployee?.id ?? null}
        employeeName={structureEmployee?.name ?? ""}
        open={!!structureEmployee}
        onOpenChange={(open) => !open && setStructureEmployee(null)}
      />
    </div>
  )
}
