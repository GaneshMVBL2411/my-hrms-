import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { format } from "date-fns"
import { useNavigate } from "react-router-dom"
import { CalendarClock, CalendarCheck, Clock, FolderKanban, Wallet } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { StatCard } from "@/components/shared/StatCard"
import { useAuth } from "@/features/auth/AuthContext"
import { getMyAttendance } from "@/features/attendance/api"
import { getBalance } from "@/features/leaves/api"
import { listProjects } from "@/features/projects/api"
import { listPayslips } from "@/features/payroll/api"
import { listAnnouncements } from "@/features/announcements/api"
import { ApplyLeaveDialog } from "@/features/leaves/ApplyLeaveDialog"
import { ScheduleWidget } from "@/features/dashboard/widgets/ScheduleWidget"
import { TaskKanbanWidget } from "@/features/dashboard/widgets/TaskKanbanWidget"
import { ProjectsWidget } from "@/features/dashboard/widgets/ProjectsWidget"
import { AttendanceWidget } from "@/features/dashboard/widgets/AttendanceWidget"
import { LeaveWidget } from "@/features/dashboard/widgets/LeaveWidget"
import { TaskInsightsWidget } from "@/features/dashboard/widgets/TaskInsightsWidget"
import { ProfileSummaryCard } from "@/features/dashboard/widgets/ProfileSummaryCard"

function greeting(hour: number) {
  if (hour < 12) return "Good Morning"
  if (hour < 17) return "Good Afternoon"
  return "Good Evening"
}

export function EmployeeDashboard() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const now = new Date()
  const employeeId = user?.employeeId ?? undefined
  const [applyLeaveOpen, setApplyLeaveOpen] = useState(false)

  const { data: myAttendance } = useQuery({
    queryKey: ["attendance", "me", now.getFullYear(), now.getMonth() + 1],
    queryFn: () => getMyAttendance(now.getFullYear(), now.getMonth() + 1),
  })
  const today = myAttendance?.find((r) => r.date === format(now, "yyyy-MM-dd"))
  const presentDays = myAttendance?.filter((r) => r.status === "present" || r.status === "half_day").length ?? 0

  const { data: balances } = useQuery({ queryKey: ["leaves", "balance"], queryFn: getBalance })
  const remainingLeaves = balances?.reduce((sum, b) => sum + b.remainingDays, 0) ?? 0

  const { data: myProjects } = useQuery({
    queryKey: ["projects", "mine", employeeId],
    queryFn: () => listProjects({ page: 1, pageSize: 20, memberId: employeeId }),
    enabled: !!employeeId,
  })

  const { data: latestPayslip } = useQuery({
    queryKey: ["payslips", "dashboard-latest", employeeId],
    queryFn: () => listPayslips({ page: 1, pageSize: 1, employeeId }),
    enabled: !!employeeId,
  })
  const payslip = latestPayslip?.items[0]

  const { data: announcements } = useQuery({ queryKey: ["announcements", "dashboard"], queryFn: listAnnouncements })
  const topAnnouncements = (announcements ?? []).slice(0, 4)

  return (
    <div className="flex flex-1 flex-col gap-6">
      <div className="flex flex-col gap-3 border-b border-border pb-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm text-muted-foreground">
            {greeting(now.getHours())}, {user?.fullName?.split(" ")[0] ?? "there"}
          </p>
          <h1 className="text-xl font-semibold text-foreground">{format(now, "EEEE, MMMM d, yyyy")}</h1>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" className="rounded-md" onClick={() => setApplyLeaveOpen(true)}>
            Apply Leave
          </Button>
          <Button variant="outline" size="sm" className="rounded-md" onClick={() => navigate("/payroll")}>
            View Payslips
          </Button>
          <Button variant="outline" size="sm" className="rounded-md" onClick={() => navigate("/documents")}>
            My Documents
          </Button>
          <Button variant="outline" size="sm" className="rounded-md" onClick={() => navigate("/assets")}>
            My Assets
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        <StatCard
          label="Today"
          value={today?.checkIn ? (today.checkOut ? "Checked out" : "Checked in") : "Not clocked in"}
          icon={Clock}
          tone={today?.checkIn ? "success" : "warning"}
        />
        <StatCard
          label="Working Hours Today"
          value={today?.workingHours != null ? `${today.workingHours}h` : "—"}
          icon={Clock}
          tone="primary"
        />
        <StatCard label="Present Days (Month)" value={presentDays} icon={CalendarCheck} tone="primary" />
        <StatCard label="Leave Balance" value={remainingLeaves} icon={CalendarClock} tone="success" />
        <StatCard label="Assigned Projects" value={myProjects?.total ?? 0} icon={FolderKanban} tone="primary" />
        <StatCard
          label="Latest Net Pay"
          value={payslip ? `₹${payslip.netPay.toLocaleString("en-IN")}` : "—"}
          icon={Wallet}
          tone="success"
        />
      </div>

      <TaskKanbanWidget employeeId={employeeId} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <ProjectsWidget employeeId={employeeId} />
        </div>
        <ScheduleWidget />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <AttendanceWidget />
        </div>
        <LeaveWidget onApplyLeave={() => setApplyLeaveOpen(true)} />
      </div>

      <TaskInsightsWidget employeeId={employeeId} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <ProfileSummaryCard />

        <Card className="rounded-md border shadow-none lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">Announcements</CardTitle>
            <Button variant="ghost" size="sm" className="rounded-md" onClick={() => navigate("/announcements")}>
              View all
            </Button>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {topAnnouncements.length === 0 && (
              <p className="py-6 text-center text-sm text-muted-foreground">No announcements yet.</p>
            )}
            {topAnnouncements.map((a) => (
              <div
                key={a.id}
                className="flex items-start justify-between gap-2 rounded-md border border-border px-3 py-2"
              >
                <div>
                  <p className="text-sm font-medium text-foreground">{a.title}</p>
                  <p className="line-clamp-1 text-xs text-muted-foreground">{a.body}</p>
                </div>
                {a.pinned && <Badge variant="warning">Pinned</Badge>}
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <ApplyLeaveDialog open={applyLeaveOpen} onOpenChange={setApplyLeaveOpen} />
    </div>
  )
}
