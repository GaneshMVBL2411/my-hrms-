import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { Download, Printer } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Skeleton } from "@/components/ui/skeleton"
import {
  getAttendanceReport,
  getEmployeeReport,
  getLeaveReport,
  getProjectReport,
  getReportingManagerReport,
  getTaskReport,
} from "@/features/reports/api"
import { getSummary, listPayslips } from "@/features/payroll/api"
import { downloadCsv } from "@/lib/csv"

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
]

function ReportToolbar({ onCsv }: { onCsv: () => void }) {
  return (
    <div className="flex justify-end gap-2 print:hidden">
      <Button variant="outline" size="sm" className="rounded-md" onClick={onCsv}>
        <Download className="mr-2 size-4" />
        Download CSV
      </Button>
      <Button variant="outline" size="sm" className="rounded-md" onClick={() => window.print()}>
        <Printer className="mr-2 size-4" />
        Print
      </Button>
    </div>
  )
}

export function ReportsPage() {
  const now = new Date()
  const [year, setYear] = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth() + 1)

  const { data: attendance, isLoading: loadingAttendance } = useQuery({
    queryKey: ["reports", "attendance", year, month],
    queryFn: () => getAttendanceReport(year, month),
  })
  const { data: leaves, isLoading: loadingLeaves } = useQuery({
    queryKey: ["reports", "leaves", year],
    queryFn: () => getLeaveReport(year),
  })
  const { data: payrollSummary } = useQuery({
    queryKey: ["reports", "payroll-summary", year, month],
    queryFn: () => getSummary(month, year),
  })
  const { data: payslips, isLoading: loadingPayroll } = useQuery({
    queryKey: ["reports", "payslips", year, month],
    queryFn: () => listPayslips({ page: 1, pageSize: 100, month, year }),
  })
  const { data: tasks, isLoading: loadingTasks } = useQuery({ queryKey: ["reports", "tasks"], queryFn: getTaskReport })
  const { data: projects, isLoading: loadingProjects } = useQuery({
    queryKey: ["reports", "projects"],
    queryFn: getProjectReport,
  })
  const { data: employees, isLoading: loadingEmployees } = useQuery({
    queryKey: ["reports", "employees"],
    queryFn: getEmployeeReport,
  })
  const { data: managers, isLoading: loadingManagers } = useQuery({
    queryKey: ["reports", "reporting-manager"],
    queryFn: getReportingManagerReport,
  })

  const unassigned = managers?.find((m) => m.managerId === null)?.reports.length ?? 0

  return (
    <div className="flex flex-1 flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold text-foreground">Reports</h1>
        <div className="flex gap-2 print:hidden">
          <Select value={String(month)} onValueChange={(v) => setMonth(Number(v))}>
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
          <Select value={String(year)} onValueChange={(v) => setYear(Number(v))}>
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
      </div>

      <Tabs defaultValue="attendance">
        <TabsList className="rounded-md">
          <TabsTrigger value="attendance">Attendance</TabsTrigger>
          <TabsTrigger value="leaves">Leaves</TabsTrigger>
          <TabsTrigger value="payroll">Payroll</TabsTrigger>
          <TabsTrigger value="tasks">Tasks</TabsTrigger>
          <TabsTrigger value="projects">Projects</TabsTrigger>
          <TabsTrigger value="employees">Employees</TabsTrigger>
          <TabsTrigger value="managers">Reporting Manager</TabsTrigger>
        </TabsList>

        <TabsContent value="attendance" className="mt-4 flex flex-col gap-3">
          <ReportToolbar onCsv={() => downloadCsv(`attendance-${year}-${month}.csv`, attendance ?? [])} />
          <div className="overflow-hidden rounded-md border border-border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Employee</TableHead>
                  <TableHead>Present</TableHead>
                  <TableHead>Absent</TableHead>
                  <TableHead>Half Day</TableHead>
                  <TableHead>Late</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loadingAttendance && (
                  <TableRow>
                    <TableCell colSpan={5}>
                      <Skeleton className="h-8 w-full rounded-md" />
                    </TableCell>
                  </TableRow>
                )}
                {attendance?.map((row) => (
                  <TableRow key={row.employeeId}>
                    <TableCell className="font-medium text-foreground">{row.employeeName}</TableCell>
                    <TableCell>{row.presentDays}</TableCell>
                    <TableCell>{row.absentDays}</TableCell>
                    <TableCell>{row.halfDays}</TableCell>
                    <TableCell>{row.lateCount}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        <TabsContent value="leaves" className="mt-4 flex flex-col gap-3">
          <ReportToolbar onCsv={() => downloadCsv(`leaves-${year}.csv`, leaves ?? [])} />
          <div className="overflow-hidden rounded-md border border-border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Employee</TableHead>
                  <TableHead>Leave Type</TableHead>
                  <TableHead>Allocated</TableHead>
                  <TableHead>Used</TableHead>
                  <TableHead>Remaining</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loadingLeaves && (
                  <TableRow>
                    <TableCell colSpan={5}>
                      <Skeleton className="h-8 w-full rounded-md" />
                    </TableCell>
                  </TableRow>
                )}
                {leaves?.map((row, i) => (
                  <TableRow key={i}>
                    <TableCell className="font-medium text-foreground">{row.employeeName}</TableCell>
                    <TableCell>{row.leaveTypeName}</TableCell>
                    <TableCell>{row.allocatedDays}</TableCell>
                    <TableCell>{row.usedDays}</TableCell>
                    <TableCell>{row.remainingDays}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        <TabsContent value="payroll" className="mt-4 flex flex-col gap-3">
          <ReportToolbar onCsv={() => downloadCsv(`payroll-${year}-${month}.csv`, payslips?.items ?? [])} />
          {payrollSummary && (
            <p className="text-sm text-muted-foreground">
              {payrollSummary.employeeCount} employees paid · Gross ₹{payrollSummary.totalGross.toLocaleString("en-IN")}{" "}
              · Net ₹{payrollSummary.totalNet.toLocaleString("en-IN")}
            </p>
          )}
          <div className="overflow-hidden rounded-md border border-border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Employee</TableHead>
                  <TableHead>Gross Pay</TableHead>
                  <TableHead>Net Pay</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loadingPayroll && (
                  <TableRow>
                    <TableCell colSpan={3}>
                      <Skeleton className="h-8 w-full rounded-md" />
                    </TableCell>
                  </TableRow>
                )}
                {payslips?.items.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="font-medium text-foreground">{p.employeeName}</TableCell>
                    <TableCell>₹{p.grossPay.toLocaleString("en-IN")}</TableCell>
                    <TableCell>₹{p.netPay.toLocaleString("en-IN")}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        <TabsContent value="tasks" className="mt-4 flex flex-col gap-3">
          <ReportToolbar onCsv={() => downloadCsv("tasks-by-assignee.csv", tasks ?? [])} />
          <div className="overflow-hidden rounded-md border border-border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Assignee</TableHead>
                  <TableHead>Assigned</TableHead>
                  <TableHead>In Progress</TableHead>
                  <TableHead>Review</TableHead>
                  <TableHead>Completed</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loadingTasks && (
                  <TableRow>
                    <TableCell colSpan={5}>
                      <Skeleton className="h-8 w-full rounded-md" />
                    </TableCell>
                  </TableRow>
                )}
                {tasks?.map((row, i) => (
                  <TableRow key={i}>
                    <TableCell className="font-medium text-foreground">{row.assigneeName}</TableCell>
                    <TableCell>{row.assigned}</TableCell>
                    <TableCell>{row.inProgress}</TableCell>
                    <TableCell>{row.review}</TableCell>
                    <TableCell>{row.completed}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        <TabsContent value="projects" className="mt-4 flex flex-col gap-3">
          <ReportToolbar onCsv={() => downloadCsv("projects.csv", projects ?? [])} />
          <div className="overflow-hidden rounded-md border border-border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Project</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Priority</TableHead>
                  <TableHead>Progress</TableHead>
                  <TableHead>Members</TableHead>
                  <TableHead>Deadline</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loadingProjects && (
                  <TableRow>
                    <TableCell colSpan={6}>
                      <Skeleton className="h-8 w-full rounded-md" />
                    </TableCell>
                  </TableRow>
                )}
                {projects?.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="font-medium text-foreground">{p.name}</TableCell>
                    <TableCell className="capitalize">{p.status.replace("_", " ")}</TableCell>
                    <TableCell className="capitalize">{p.priority}</TableCell>
                    <TableCell>{p.progress}%</TableCell>
                    <TableCell>{p.memberCount}</TableCell>
                    <TableCell>{p.deadline ?? "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        <TabsContent value="employees" className="mt-4 flex flex-col gap-3">
          <ReportToolbar onCsv={() => downloadCsv("employees-by-department.csv", employees ?? [])} />
          <div className="overflow-hidden rounded-md border border-border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Department</TableHead>
                  <TableHead>Designation</TableHead>
                  <TableHead>Active</TableHead>
                  <TableHead>Inactive</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loadingEmployees && (
                  <TableRow>
                    <TableCell colSpan={4}>
                      <Skeleton className="h-8 w-full rounded-md" />
                    </TableCell>
                  </TableRow>
                )}
                {employees?.map((row, i) => (
                  <TableRow key={i}>
                    <TableCell className="font-medium text-foreground">{row.departmentName}</TableCell>
                    <TableCell>{row.designationTitle}</TableCell>
                    <TableCell>{row.activeCount}</TableCell>
                    <TableCell>{row.inactiveCount}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        <TabsContent value="managers" className="mt-4 flex flex-col gap-3">
          <ReportToolbar
            onCsv={() =>
              downloadCsv(
                "reporting-managers.csv",
                // One line per employee rather than per manager: a spreadsheet
                // cannot filter a nested list, and "who reports to whom" is the
                // question this file gets opened to answer.
                (managers ?? []).flatMap((m) =>
                  m.reports.map((r) => ({
                    employee: r.fullName,
                    employee_department: r.departmentName,
                    employee_status: r.status,
                    reporting_manager: m.managerId ? m.managerName : "",
                    manager_designation: m.managerDesignation,
                  }))
                )
              )
            }
          />
          {unassigned > 0 && (
            <p className="rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-foreground">
              {unassigned} {unassigned === 1 ? "employee has" : "employees have"} no reporting manager. Set one in
              Employees → edit → Reporting manager.
            </p>
          )}
          <div className="flex flex-col gap-3">
            {loadingManagers && <Skeleton className="h-24 w-full rounded-md" />}
            {!loadingManagers && (managers?.length ?? 0) === 0 && (
              <p className="rounded-md border border-border bg-card px-4 py-8 text-center text-sm text-muted-foreground">
                No employees to report on yet.
              </p>
            )}
            {managers?.map((m) => (
              <div key={m.managerId ?? "unassigned"} className="overflow-hidden rounded-md border border-border bg-card">
                <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border px-4 py-3">
                  <div>
                    <p className="font-medium text-foreground">
                      {m.managerName}
                      {m.managerDesignation && (
                        <span className="ml-2 text-sm font-normal text-muted-foreground">{m.managerDesignation}</span>
                      )}
                    </p>
                    <p className="text-xs text-muted-foreground">{m.departmentName}</p>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    <span className="font-semibold text-foreground">{m.teamSize}</span>{" "}
                    {m.teamSize === 1 ? "report" : "reports"}
                    {m.inactiveCount > 0 && ` · ${m.inactiveCount} inactive`}
                  </p>
                </div>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Employee</TableHead>
                      <TableHead>Department</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {m.reports.map((r) => (
                      <TableRow key={r.employeeId}>
                        <TableCell className="font-medium text-foreground">{r.fullName}</TableCell>
                        <TableCell>{r.departmentName}</TableCell>
                        <TableCell className="capitalize text-muted-foreground">{r.status}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ))}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  )
}
