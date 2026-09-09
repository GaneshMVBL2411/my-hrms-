import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useTheme } from "next-themes"
import { useNavigate } from "react-router-dom"
import { format } from "date-fns"
import { toast } from "sonner"
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"
import {
  Users,
  UserCheck,
  UserX,
  CalendarClock,
  UserPlus,
  CheckCircle2,
  FileText,
  PlusCircle,
  Check,
  X,
  Sparkles,
  Megaphone,
  ArrowRight,
  Briefcase,
  Layers,
} from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { StatCard } from "@/components/shared/StatCard"
import { useAuth } from "@/features/auth/AuthContext"
import { canManageEmployees } from "@/features/auth/permissions"
import { listEmployees } from "@/features/employees/api"
import { getSummary } from "@/features/attendance/api"
import { listTasks } from "@/features/tasks/api"
import { listRequests, approveLeave, rejectLeave } from "@/features/leaves/api"
import { listAnnouncements } from "@/features/announcements/api"
import { EmployeeDashboard } from "@/features/dashboard/EmployeeDashboard"
import { ScheduleWidget } from "@/features/dashboard/widgets/ScheduleWidget"
import { errorMessage } from "@/lib/errors"

export function DashboardPage() {
  const { user } = useAuth()

  if (user?.role === "employee") {
    return <EmployeeDashboard />
  }

  return <OrganizationDashboard />
}

function OrganizationDashboard() {
  const { user } = useAuth()
  const { resolvedTheme } = useTheme()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const canManage = canManageEmployees(user?.role)

  const primaryHex = resolvedTheme === "dark" ? "#1f7a54" : "#0f4c34"
  const gridHex = resolvedTheme === "dark" ? "#1e293b" : "#e2e8f0"
  const tickHex = resolvedTheme === "dark" ? "#94a3b8" : "#64748b"

  // 1. Employees query
  const { data: employeesData } = useQuery({
    queryKey: ["employees", "dashboard-summary"],
    queryFn: () => listEmployees({ page: 1, pageSize: 500 }),
  })
  const employees = employeesData?.items ?? []
  const totalEmployees = employeesData?.total ?? 0

  // 2. Attendance summary query
  const { data: attendanceSummary } = useQuery({
    queryKey: ["attendance", "summary", "dashboard"],
    queryFn: () => getSummary(),
  })

  // 3. Pending approvals query (leaves waiting for HR decision)
  const { data: pendingLeaves = [], isLoading: loadingPendingLeaves } = useQuery({
    queryKey: ["leaves", "dashboard-pending"],
    queryFn: () => listRequests({ scope: "all", status: "pending" }),
    enabled: canManage,
  })

  // 4. Tasks metrics
  const { data: pendingTasks } = useQuery({
    queryKey: ["tasks", "dashboard-pending"],
    queryFn: () => listTasks({ page: 1, pageSize: 1, status: "in_progress" }),
  })
  const { data: completedTasks } = useQuery({
    queryKey: ["tasks", "dashboard-completed"],
    queryFn: () => listTasks({ page: 1, pageSize: 1, status: "completed" }),
  })

  // 5. Announcements query
  const { data: announcements = [] } = useQuery({
    queryKey: ["announcements", "dashboard-list"],
    queryFn: listAnnouncements,
  })
  const topAnnouncements = announcements.slice(0, 3)

  // Leave approval mutations
  const approveMutation = useMutation({
    mutationFn: (id: number) => approveLeave(id, "Approved from HR Command Center"),
    onSuccess: () => {
      toast.success("Leave request approved")
      queryClient.invalidateQueries({ queryKey: ["leaves"] })
      queryClient.invalidateQueries({ queryKey: ["attendance"] })
    },
    onError: (err) => toast.error(errorMessage(err, "Could not approve leave")),
  })

  const rejectMutation = useMutation({
    mutationFn: (id: number) => rejectLeave(id, "Declined by HR Admin"),
    onSuccess: () => {
      toast.success("Leave request rejected")
      queryClient.invalidateQueries({ queryKey: ["leaves"] })
    },
    onError: (err) => toast.error(errorMessage(err, "Could not reject leave")),
  })

  // Chart data calculations
  const byDepartment = Object.values(
    employees.reduce<Record<string, { name: string; count: number }>>((acc, emp) => {
      const key = emp.departmentName ?? "Unassigned"
      acc[key] ??= { name: key, count: 0 }
      acc[key].count += 1
      return acc
    }, {})
  )

  const byMonth = Object.entries(
    employees.reduce<Record<string, number>>((acc, emp) => {
      if (!emp.joiningDate) return acc
      const key = emp.joiningDate.slice(0, 7)
      acc[key] = (acc[key] ?? 0) + 1
      return acc
    }, {})
  )
    .sort(([a], [b]) => a.localeCompare(b))
    .reduce<{ month: string; total: number }[]>((rows, [month, count], idx) => {
      const prevTotal = idx === 0 ? 0 : rows[idx - 1].total
      rows.push({ month, total: prevTotal + count })
      return rows
    }, [])

  // Recent Joinees (last 4 sorted by joining date desc)
  const recentJoinees = [...employees]
    .filter((e) => e.joiningDate)
    .sort((a, b) => (b.joiningDate || "").localeCompare(a.joiningDate || ""))
    .slice(0, 4)

  // Attendance rate calculation
  const presentCount = attendanceSummary?.present ?? 0
  const absentCount = attendanceSummary?.absent ?? 0
  const onLeaveCount = attendanceSummary?.onLeave ?? 0
  const attendanceRate = totalEmployees > 0 ? Math.round((presentCount / totalEmployees) * 100) : 0

  return (
    <div className="flex flex-1 flex-col gap-6">
      {/* 1. HR Command Header & Action Hub */}
      <div className="rounded-2xl border border-border bg-card p-4 sm:p-6 shadow-xs">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-bold tracking-tight text-foreground sm:text-2xl">
                Welcome back, {user?.fullName?.split(" ")[0] ?? "there"}
              </h1>
              <Badge variant="outline" className="gap-1 border-primary/30 bg-primary/5 text-primary text-xs font-semibold">
                <Sparkles className="size-3" />
                HR Command Center
              </Badge>
            </div>
            <p className="text-xs sm:text-sm text-muted-foreground">
              {format(new Date(), "EEEE, MMMM d, yyyy")} · Pulse snapshot for{" "}
              <strong className="text-foreground">{user?.companyName ?? "your organization"}</strong>
            </p>
          </div>

          {/* HR Quick Actions Bar */}
          {canManage && (
            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                className="rounded-xl shadow-xs gap-1.5"
                onClick={() => navigate("/employees")}
              >
                <UserPlus className="size-4" />
                <span>Add Employee</span>
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="rounded-xl gap-1.5 hover:bg-muted"
                onClick={() => navigate("/documents")}
              >
                <FileText className="size-4" />
                <span>Issue Letter</span>
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="rounded-xl gap-1.5 hover:bg-muted"
                onClick={() => navigate("/tasks")}
              >
                <PlusCircle className="size-4" />
                <span>Create Task</span>
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="rounded-xl gap-1.5 hover:bg-muted"
                onClick={() => navigate("/payroll")}
              >
                <Briefcase className="size-4" />
                <span>Run Payroll</span>
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="rounded-xl gap-1.5 hover:bg-muted"
                onClick={() => navigate("/announcements")}
              >
                <Megaphone className="size-4" />
                <span>Post Notice</span>
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* 2. Workforce Vitals Stat Cards */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <StatCard
          label="Total Headcount"
          value={totalEmployees}
          icon={Users}
          tone="primary"
          to="/employees"
        />
        <StatCard
          label="Present Today"
          value={`${presentCount} (${attendanceRate}%)`}
          icon={UserCheck}
          tone="success"
          to="/attendance"
        />
        <StatCard
          label="On Leave"
          value={onLeaveCount}
          icon={CalendarClock}
          tone="warning"
          to="/leaves"
        />
        <StatCard
          label="Absent"
          value={absentCount}
          icon={UserX}
          tone="danger"
          to="/attendance"
        />
      </div>

      {/* 3. Operational Pulse & Pending Approvals Queue */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Left 2 Cols: Interactive Pending Approvals Queue */}
        <Card className="rounded-2xl border border-border shadow-xs interactive-card lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between pb-3">
            <div>
              <div className="flex items-center gap-2">
                <CardTitle className="text-base font-semibold">Pending Approvals Queue</CardTitle>
                {pendingLeaves.length > 0 && (
                  <Badge variant="warning" className="text-xs font-semibold px-2 py-0.5">
                    {pendingLeaves.length} waiting
                  </Badge>
                )}
              </div>
              <CardDescription className="text-xs">
                Time-off requests requiring your immediate action
              </CardDescription>
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="gap-1 rounded-xl text-xs"
              onClick={() => navigate("/leaves")}
            >
              <span>View all leaves</span>
              <ArrowRight className="size-3.5" />
            </Button>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {loadingPendingLeaves ? (
              <div className="py-8 text-center text-xs text-muted-foreground animate-pulse">
                Loading approval requests…
              </div>
            ) : pendingLeaves.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 text-center">
                <div className="flex size-10 items-center justify-center rounded-full bg-success/10 text-success mb-2">
                  <CheckCircle2 className="size-5" />
                </div>
                <p className="text-sm font-medium text-foreground">All caught up!</p>
                <p className="text-xs text-muted-foreground">There are no pending leave requests to review.</p>
              </div>
            ) : (
              <div className="flex flex-col divide-y divide-border">
                {pendingLeaves.slice(0, 4).map((req) => (
                  <div
                    key={req.id}
                    className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center sm:justify-between first:pt-0 last:pb-0"
                  >
                    <div className="flex items-start gap-3 min-w-0">
                      <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary font-semibold text-xs">
                        {req.employeeName ? req.employeeName.slice(0, 2).toUpperCase() : "EM"}
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="truncate text-sm font-semibold text-foreground">
                            {req.employeeName}
                          </p>
                          <Badge variant="outline" className="text-[11px] font-normal py-0">
                            {req.leaveTypeName}
                          </Badge>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {format(new Date(req.startDate), "MMM d")} - {format(new Date(req.endDate), "MMM d, yyyy")}
                          <span className="font-semibold text-foreground ml-1">· {req.daysCount} {req.daysCount === 1 ? "day" : "days"}</span>
                        </p>
                        {req.reason && (
                          <p className="line-clamp-1 text-xs text-muted-foreground italic mt-0.5">
                            "{req.reason}"
                          </p>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
                      <Button
                        size="sm"
                        className="rounded-xl h-8 px-3 gap-1 bg-success hover:bg-success/90 text-white"
                        disabled={approveMutation.isPending || rejectMutation.isPending}
                        onClick={() => approveMutation.mutate(req.id)}
                      >
                        <Check className="size-3.5" />
                        <span>Approve</span>
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="rounded-xl h-8 px-3 gap-1 hover:bg-destructive/10 hover:text-destructive hover:border-destructive/30"
                        disabled={approveMutation.isPending || rejectMutation.isPending}
                        onClick={() => rejectMutation.mutate(req.id)}
                      >
                        <X className="size-3.5" />
                        <span>Decline</span>
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Right Col: Today's Attendance & Punctuality Breakdown */}
        <Card className="rounded-2xl border border-border shadow-xs interactive-card">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold">Today's Attendance Pulse</CardTitle>
            <CardDescription className="text-xs">Live breakdown across departments</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {/* Visual multi-segment bar */}
            <div className="flex flex-col gap-1.5">
              <div className="flex h-3 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className="bg-success transition-all duration-500"
                  style={{ width: `${totalEmployees > 0 ? (presentCount / totalEmployees) * 100 : 0}%` }}
                  title={`Present: ${presentCount}`}
                />
                <div
                  className="bg-warning transition-all duration-500"
                  style={{ width: `${totalEmployees > 0 ? (onLeaveCount / totalEmployees) * 100 : 0}%` }}
                  title={`On Leave: ${onLeaveCount}`}
                />
                <div
                  className="bg-danger transition-all duration-500"
                  style={{ width: `${totalEmployees > 0 ? (absentCount / totalEmployees) * 100 : 0}%` }}
                  title={`Absent: ${absentCount}`}
                />
              </div>
              <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                <span>{attendanceRate}% Present today</span>
                <span>{totalEmployees} Total staff</span>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="rounded-xl bg-success/10 p-2.5">
                <p className="text-lg font-bold text-success">{presentCount}</p>
                <p className="text-[11px] font-medium text-success/80">Present</p>
              </div>
              <div className="rounded-xl bg-warning/10 p-2.5">
                <p className="text-lg font-bold text-warning">{onLeaveCount}</p>
                <p className="text-[11px] font-medium text-warning/80">On Leave</p>
              </div>
              <div className="rounded-xl bg-danger/10 p-2.5">
                <p className="text-lg font-bold text-danger">{absentCount}</p>
                <p className="text-[11px] font-medium text-danger/80">Absent</p>
              </div>
            </div>

            <div className="border-t border-border pt-3">
              <p className="text-xs font-semibold text-foreground mb-2">Tasks In Pipeline</p>
              <div className="grid grid-cols-2 gap-2">
                <div
                  className="flex items-center justify-between rounded-xl border border-border p-2.5 cursor-pointer hover:bg-muted/50 transition-colors"
                  onClick={() => navigate("/tasks?taskStatus=in_progress")}
                >
                  <span className="text-xs text-muted-foreground">In Progress</span>
                  <Badge variant="warning">{pendingTasks?.total ?? 0}</Badge>
                </div>
                <div
                  className="flex items-center justify-between rounded-xl border border-border p-2.5 cursor-pointer hover:bg-muted/50 transition-colors"
                  onClick={() => navigate("/tasks?taskStatus=completed")}
                >
                  <span className="text-xs text-muted-foreground">Completed</span>
                  <Badge variant="success">{completedTasks?.total ?? 0}</Badge>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* 4. Analytics: Department Breakdown & Headcount Growth */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card className="rounded-2xl border border-border shadow-xs interactive-card">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-base font-semibold">Employees by Department</CardTitle>
                <CardDescription className="text-xs">Headcount distribution by team</CardDescription>
              </div>
              <Layers className="size-4 text-muted-foreground" />
            </div>
          </CardHeader>
          <CardContent className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={byDepartment} barCategoryGap={20}>
                <CartesianGrid vertical={false} stroke={gridHex} />
                <XAxis
                  dataKey="name"
                  tickLine={false}
                  axisLine={false}
                  tick={{ fill: tickHex, fontSize: 12 }}
                />
                <YAxis
                  allowDecimals={false}
                  tickLine={false}
                  axisLine={false}
                  tick={{ fill: tickHex, fontSize: 12 }}
                  width={28}
                />
                <Tooltip
                  cursor={{ fill: gridHex, opacity: 0.4 }}
                  contentStyle={{
                    borderRadius: 8,
                    border: "1px solid var(--border)",
                    backgroundColor: "var(--card)",
                    color: "var(--foreground)",
                    boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
                  }}
                />
                <Bar dataKey="count" name="Employees" fill={primaryHex} radius={[6, 6, 0, 0]} maxBarSize={28} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card className="rounded-2xl border border-border shadow-xs interactive-card">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-base font-semibold">Headcount Growth</CardTitle>
                <CardDescription className="text-xs">Cumulative team growth over time</CardDescription>
              </div>
              <Sparkles className="size-4 text-muted-foreground" />
            </div>
          </CardHeader>
          <CardContent className="h-72">
            {byMonth.length > 1 ? (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={byMonth}>
                  <CartesianGrid vertical={false} stroke={gridHex} />
                  <XAxis dataKey="month" tickLine={false} axisLine={false} tick={{ fill: tickHex, fontSize: 12 }} />
                  <YAxis
                    allowDecimals={false}
                    tickLine={false}
                    axisLine={false}
                    tick={{ fill: tickHex, fontSize: 12 }}
                    width={28}
                  />
                  <Tooltip
                    contentStyle={{
                      borderRadius: 8,
                      border: "1px solid var(--border)",
                      backgroundColor: "var(--card)",
                      color: "var(--foreground)",
                      boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
                    }}
                  />
                  <Line
                    type="monotone"
                    dataKey="total"
                    name="Total employees"
                    stroke={primaryHex}
                    strokeWidth={2.5}
                    dot={{ r: 4, fill: primaryHex, strokeWidth: 2, stroke: "var(--card)" }}
                    activeDot={{ r: 6, fill: primaryHex }}
                  />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                Not enough joining-date data yet to chart growth.
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* 5. My Schedule & Interactive Calendar */}
      <ScheduleWidget />

      {/* 6. Recent Joinees & Company Noticeboard */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Recent Joinees */}
        <Card className="rounded-2xl border border-border shadow-xs interactive-card">
          <CardHeader className="flex flex-row items-center justify-between pb-3">
            <div>
              <CardTitle className="text-base font-semibold">Recent Joinees</CardTitle>
              <CardDescription className="text-xs">New members welcomed to the organization</CardDescription>
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="gap-1 rounded-xl text-xs"
              onClick={() => navigate("/employees")}
            >
              <span>Directory</span>
              <ArrowRight className="size-3.5" />
            </Button>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {recentJoinees.length === 0 ? (
              <p className="py-6 text-center text-xs text-muted-foreground">No recent join records.</p>
            ) : (
              recentJoinees.map((emp) => (
                <div
                  key={emp.id}
                  className="flex items-center justify-between rounded-xl border border-border p-3 hover:bg-muted/40 transition-colors cursor-pointer"
                  onClick={() => navigate(`/employees/${emp.id}`)}
                >
                  <div className="flex items-center gap-3">
                    <Avatar className="size-10 rounded-xl">
                      <AvatarImage src={emp.photoUrl ?? undefined} />
                      <AvatarFallback className="rounded-xl text-xs font-semibold">
                        {(emp.fullName || emp.employeeCode || "EM").slice(0, 2).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <div>
                      <p className="text-sm font-semibold text-foreground">{emp.fullName}</p>
                      <p className="text-xs text-muted-foreground">
                        {emp.designationTitle ?? "Member"} · {emp.departmentName ?? "Team"}
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    <Badge variant="outline" className="text-[11px] font-medium">
                      Joined {emp.joiningDate ? format(new Date(emp.joiningDate), "MMM yyyy") : "Recently"}
                    </Badge>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        {/* Company Noticeboard */}
        <Card className="rounded-2xl border border-border shadow-xs interactive-card">
          <CardHeader className="flex flex-row items-center justify-between pb-3">
            <div>
              <CardTitle className="text-base font-semibold">Company Noticeboard</CardTitle>
              <CardDescription className="text-xs">Important circulars & team announcements</CardDescription>
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="gap-1 rounded-xl text-xs"
              onClick={() => navigate("/announcements")}
            >
              <span>View all</span>
              <ArrowRight className="size-3.5" />
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
    </div>
  )
}
