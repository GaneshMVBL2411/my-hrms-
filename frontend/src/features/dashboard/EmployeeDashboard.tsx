import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { format } from "date-fns"
import { useNavigate } from "react-router-dom"
import { CalendarClock, CalendarCheck, Clock, FolderKanban, Wallet, Users, LogIn, LogOut, FileText, Laptop, ListChecks } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { StatCard } from "@/components/shared/StatCard"
import { useAuth } from "@/features/auth/AuthContext"
import { getMyAttendance } from "@/features/attendance/api"
import { getBalance } from "@/features/leaves/api"
import { listProjects } from "@/features/projects/api"
import { listEmployees, getEmployee } from "@/features/employees/api"
import { listPayslips } from "@/features/payroll/api"
import { listAnnouncements } from "@/features/announcements/api"
import { listTasks } from "@/features/tasks/api"
import { ApplyLeaveDialog } from "@/features/leaves/ApplyLeaveDialog"
import { ScheduleWidget } from "@/features/dashboard/widgets/ScheduleWidget"
import { TaskKanbanWidget } from "@/features/dashboard/widgets/TaskKanbanWidget"
import { ProjectsWidget } from "@/features/dashboard/widgets/ProjectsWidget"
import { AttendanceWidget } from "@/features/dashboard/widgets/AttendanceWidget"
import { LeaveWidget } from "@/features/dashboard/widgets/LeaveWidget"
import { TaskInsightsWidget } from "@/features/dashboard/widgets/TaskInsightsWidget"
import { ProfileSummaryCard } from "@/features/dashboard/widgets/ProfileSummaryCard"

import { usePunchCapture } from "@/features/attendance/usePunchCapture"

function greeting(hour: number) {
  if (hour < 12) return "Good Morning"
  if (hour < 17) return "Good Afternoon"
  return "Good Evening"
}

export function EmployeeDashboard() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const { punch, isPending, dialog } = usePunchCapture()
  const now = new Date()
  const todayStr = format(now, "yyyy-MM-dd")
  const employeeId = user?.employeeId ?? undefined
  const [applyLeaveOpen, setApplyLeaveOpen] = useState(false)

  // 1. Employee personal profile
  const { data: employeeDetail } = useQuery({
    queryKey: ["employees", "detail", employeeId],
    queryFn: () => getEmployee(employeeId!),
    enabled: !!employeeId,
  })

  // 2. Attendance query
  const { data: myAttendance } = useQuery({
    queryKey: ["attendance", "me", now.getFullYear(), now.getMonth() + 1],
    queryFn: () => getMyAttendance(now.getFullYear(), now.getMonth() + 1),
  })
  const today = myAttendance?.find((r) => r.date === todayStr)
  const presentDays = myAttendance?.filter((r) => r.status === "present" || r.status === "half_day").length ?? 0

  // Check in/out mutations

  // 3. Leave Balances
  const { data: balances } = useQuery({ queryKey: ["leaves", "balance"], queryFn: getBalance })
  /**
   * Coerced, not trusted to already be a number.
   *
   * `remainingDays` is typed number and arrives as a string: it is a Postgres
   * `numeric`, and pg returns those as strings because a double cannot hold
   * every value the type can. `sum + b.remainingDays` therefore concatenated
   * rather than added, and the card read "012.010.015." — three balances laid
   * end to end and overflowing its own tile.
   */
  const remainingLeaves =
    balances?.reduce((sum, b) => sum + (Number(b.remainingDays) || 0), 0) ?? 0

  // 4. Projects
  const { data: myProjects } = useQuery({
    queryKey: ["projects", "mine", employeeId],
    queryFn: () => listProjects({ page: 1, pageSize: 20, memberId: employeeId }),
    enabled: !!employeeId,
  })

  // 5. Tasks
  const { data: myTasks } = useQuery({
    queryKey: ["tasks", "employee-active", employeeId],
    queryFn: () => listTasks({ page: 1, pageSize: 50, assignedTo: employeeId }),
    enabled: !!employeeId,
  })
  const inProgressTasksCount = myTasks?.items.filter((t) => t.status === "in_progress").length ?? 0

  // 6. Payslip
  const { data: latestPayslip } = useQuery({
    queryKey: ["payslips", "dashboard-latest", employeeId],
    queryFn: () => listPayslips({ page: 1, pageSize: 1, employeeId }),
    enabled: !!employeeId,
  })
  const payslip = latestPayslip?.items[0]

  // 7. Announcements
  const { data: announcements } = useQuery({ queryKey: ["announcements", "dashboard"], queryFn: listAnnouncements })
  const topAnnouncements = (announcements ?? []).slice(0, 3)

  // 8. Team count
  const { data: team } = useQuery({
    queryKey: ["employees", "team-count"],
    queryFn: () => listEmployees({ page: 1, pageSize: 1 }),
  })

  const initials = (user?.fullName ?? "EM")
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase()

  const workingHoursToday = today?.workingHours ?? 0
  const hoursProgress = Math.min(100, Math.round((workingHoursToday / 8) * 100))

  return (
    <div className="flex flex-1 flex-col gap-6">
      {/* 1. Personal Hero Hub Card */}
      <div className="rounded-2xl border border-border bg-card p-4 sm:p-6 shadow-xs">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
          {/* Employee Identity & Greeting */}
          <div className="flex items-center gap-4">
            <Avatar className="size-16 rounded-2xl border-2 border-primary/20 shadow-xs">
              <AvatarImage src={user?.photoUrl ?? undefined} alt={user?.fullName} />
              <AvatarFallback className="rounded-2xl text-base font-bold bg-primary/10 text-primary">
                {initials}
              </AvatarFallback>
            </Avatar>

            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-xl font-bold tracking-tight text-foreground sm:text-2xl">
                  {greeting(now.getHours())}, {user?.fullName?.split(" ")[0] ?? "there"}
                </h1>
                {employeeDetail?.employeeCode && (
                  <Badge variant="outline" className="text-xs font-mono font-medium">
                    {employeeDetail.employeeCode}
                  </Badge>
                )}
              </div>
              <p className="text-xs sm:text-sm text-muted-foreground">
                {employeeDetail?.designationTitle ?? "Team Member"} · {employeeDetail?.departmentName ?? (user?.companyName ?? "HRMS")}
              </p>
            </div>
          </div>

          {/* Real-time Attendance & Quick Punch Clock */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 bg-muted/40 p-3 rounded-2xl border border-border">
            <div className="flex flex-col gap-1 pr-0 sm:pr-4 sm:border-r border-border">
              <div className="flex items-center gap-2">
                <span
                  className={`size-2.5 rounded-full ${
                    today?.checkIn ? (today.checkOut ? "bg-muted-foreground" : "bg-success animate-pulse") : "bg-warning"
                  }`}
                />
                <span className="text-xs font-semibold text-foreground">
                  {today?.checkIn
                    ? today.checkOut
                      ? `Checked out at ${format(new Date(today.checkOut), "hh:mm a")}`
                      : `Checked in at ${format(new Date(today.checkIn), "hh:mm a")}`
                    : "Not clocked in today"}
                </span>
              </div>
              <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                <span>{workingHoursToday > 0 ? `${workingHoursToday}h logged` : "0.0h logged"}</span>
                <span>·</span>
                <span>{hoursProgress}% of 8h standard</span>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Button
                size="sm"
                className="rounded-xl h-9 px-4 gap-1.5 shadow-xs"
                disabled={!!today?.checkIn || isPending}
                onClick={() => punch("in")}
              >
                <LogIn className="size-4" />
                <span>Clock In</span>
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="rounded-xl h-9 px-4 gap-1.5 hover:bg-muted"
                disabled={!today?.checkIn || !!today?.checkOut || isPending}
                onClick={() => punch("out")}
              >
                <LogOut className="size-4" />
                <span>Clock Out</span>
              </Button>
            </div>
          </div>
        </div>

        {/* Self-Service Quick Action Hub */}
        <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-border pt-4">
          <Button
            size="sm"
            variant="outline"
            className="rounded-xl gap-1.5 hover:bg-primary/10 hover:text-primary hover:border-primary/30"
            onClick={() => setApplyLeaveOpen(true)}
          >
            <CalendarClock className="size-4" />
            <span>Apply Leave</span>
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="rounded-xl gap-1.5 hover:bg-muted"
            onClick={() => navigate("/payroll")}
          >
            <Wallet className="size-4" />
            <span>View Payslips</span>
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="rounded-xl gap-1.5 hover:bg-muted"
            onClick={() => navigate("/documents")}
          >
            <FileText className="size-4" />
            <span>My Documents & Letters</span>
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="rounded-xl gap-1.5 hover:bg-muted"
            onClick={() => navigate("/assets")}
          >
            <Laptop className="size-4" />
            <span>My Assets</span>
          </Button>
        </div>
      </div>

      {/* 2. Personal Vitals KPI Stat Cards */}
      {/* Four across, not seven. Seven left roughly 130px a card, which is
          narrower than "Present Days (Month)" and is why every label was
          showing as four letters and an ellipsis. */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
        <StatCard
          label="Today's Hours"
          value={workingHoursToday > 0 ? `${workingHoursToday}h` : "—"}
          icon={Clock}
          tone={today?.checkIn ? "success" : "warning"}
          to="/attendance"
        />
        <StatCard
          label="Present Days (Month)"
          value={presentDays}
          icon={CalendarCheck}
          tone="primary"
          to="/attendance"
        />
        <StatCard
          label="Available Leave Days"
          value={remainingLeaves}
          icon={CalendarClock}
          tone="success"
          to="/leaves"
        />
        <StatCard
          label="Assigned Projects"
          value={myProjects?.total ?? 0}
          icon={FolderKanban}
          tone="primary"
          to="/projects"
        />
        <StatCard
          label="Active Tasks"
          value={inProgressTasksCount}
          icon={ListChecks}
          tone="warning"
          to="/tasks"
        />
        <StatCard
          label="Latest Net Pay"
          value={payslip ? `₹${payslip.netPay.toLocaleString("en-IN")}` : "—"}
          icon={Wallet}
          tone="success"
          to="/payroll"
        />
        <StatCard
          label="Team Directory"
          value={team?.total ?? "—"}
          icon={Users}
          tone="primary"
          to="/employees"
        />
      </div>

      {/* 3. Task Kanban Workspace */}
      <TaskKanbanWidget employeeId={employeeId} />

      {/* 4. Projects & Schedule */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <ProjectsWidget employeeId={employeeId} />
        </div>
        <ScheduleWidget />
      </div>

      {/* 5. Attendance & Leave Hub */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <AttendanceWidget />
        </div>
        <LeaveWidget onApplyLeave={() => setApplyLeaveOpen(true)} />
      </div>

      {/* 6. Task Insights & Profile + Noticeboard */}
      <TaskInsightsWidget employeeId={employeeId} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <ProfileSummaryCard />

        <Card className="rounded-2xl border border-border shadow-xs interactive-card lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between pb-3">
            <div>
              <CardTitle className="text-base font-semibold">Company Announcements</CardTitle>
              <CardDescription className="text-xs">Latest updates and news from management</CardDescription>
            </div>
            <Button variant="ghost" size="sm" className="rounded-xl text-xs" onClick={() => navigate("/announcements")}>
              View all
            </Button>
          </CardHeader>
          <CardContent className="flex flex-col gap-2.5">
            {topAnnouncements.length === 0 ? (
              <p className="py-6 text-center text-xs text-muted-foreground">No circulars posted yet.</p>
            ) : (
              topAnnouncements.map((a) => (
                <div
                  key={a.id}
                  className="flex items-start justify-between gap-3 rounded-xl border border-border p-3 hover:bg-muted/40 transition-colors"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-foreground truncate">{a.title}</p>
                    <p className="line-clamp-2 text-xs text-muted-foreground mt-0.5">{a.body}</p>
                  </div>
                  {a.pinned && (
                    <Badge variant="warning" className="shrink-0 text-[10px]">
                      Pinned
                    </Badge>
                  )}
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      {/* Leave Application Dialog */}
      <ApplyLeaveDialog open={applyLeaveOpen} onOpenChange={setApplyLeaveOpen} />
      {/* The camera. Renders only while a punch is being taken. */}
      {dialog}
    </div>
  )
}
