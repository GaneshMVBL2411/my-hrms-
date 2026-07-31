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
      </Tabs>
    </div>
  )
}
