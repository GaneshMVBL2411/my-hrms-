import { useQuery } from "@tanstack/react-query"
import { useTheme } from "next-themes"
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
import { Users, UserCheck, UserX, CalendarClock, UserPlus, ListChecks, CheckCircle2 } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { StatCard } from "@/components/shared/StatCard"
import { useAuth } from "@/features/auth/AuthContext"
import { canManageEmployees } from "@/features/auth/permissions"
import { listEmployees } from "@/features/employees/api"
import { getSummary } from "@/features/attendance/api"
import { listTasks } from "@/features/tasks/api"
import { useNavigate } from "react-router-dom"
import { EmployeeDashboard } from "@/features/dashboard/EmployeeDashboard"

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
  // Project managers and team leads share this dashboard but cannot hire, so
  // the shortcut is HR-only — same rule the employee list and profile use.
  const canManage = canManageEmployees(user?.role)
  const primaryHex = resolvedTheme === "dark" ? "#1f7a54" : "#0f4c34"
  const gridHex = resolvedTheme === "dark" ? "#1e293b" : "#e2e8f0"
  const tickHex = resolvedTheme === "dark" ? "#94a3b8" : "#64748b"

  const { data } = useQuery({
    queryKey: ["employees", "dashboard-summary"],
    queryFn: () => listEmployees({ page: 1, pageSize: 500 }),
  })

  const { data: attendanceSummary } = useQuery({
    queryKey: ["attendance", "summary", "dashboard"],
    queryFn: () => getSummary(),
  })

  const { data: pendingTasks } = useQuery({
    queryKey: ["tasks", "dashboard-pending"],
    queryFn: () => listTasks({ page: 1, pageSize: 1, status: "in_progress" }),
  })

  const { data: completedTasks } = useQuery({
    queryKey: ["tasks", "dashboard-completed"],
    queryFn: () => listTasks({ page: 1, pageSize: 1, status: "completed" }),
  })

  const employees = data?.items ?? []
  const totalEmployees = data?.total ?? 0

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

  return (
    <div className="flex flex-1 flex-col gap-6">
      <div className="flex flex-col gap-3 border-b border-border pb-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm text-muted-foreground">Welcome back,</p>
          <h1 className="text-xl font-semibold text-foreground">{user?.fullName ?? "there"}</h1>
        </div>
        {canManage && (
          <Button className="rounded-md" onClick={() => navigate("/employees")}>
            <UserPlus className="mr-2 size-4" />
            Add Employee
          </Button>
        )}
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Total Employees" value={totalEmployees} icon={Users} tone="primary" />
        <StatCard label="Present Today" value={attendanceSummary?.present ?? "—"} icon={UserCheck} tone="success" />
        <StatCard label="On Leave" value={attendanceSummary?.onLeave ?? "—"} icon={CalendarClock} tone="warning" />
        <StatCard label="Absent" value={attendanceSummary?.absent ?? "—"} icon={UserX} tone="danger" />
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <StatCard label="Tasks In Progress" value={pendingTasks?.total ?? "—"} icon={ListChecks} tone="warning" />
        <StatCard label="Tasks Completed" value={completedTasks?.total ?? "—"} icon={CheckCircle2} tone="success" />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card className="rounded-md border shadow-none">
          <CardHeader>
            <CardTitle className="text-base">Employees by department</CardTitle>
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
                  contentStyle={{ borderRadius: 4, border: "1px solid var(--border)", boxShadow: "none" }}
                />
                <Bar dataKey="count" name="Employees" fill={primaryHex} radius={[4, 4, 0, 0]} maxBarSize={24} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card className="rounded-md border shadow-none">
          <CardHeader>
            <CardTitle className="text-base">Headcount growth</CardTitle>
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
                  <Tooltip contentStyle={{ borderRadius: 4, border: "1px solid var(--border)", boxShadow: "none" }} />
                  <Line
                    type="monotone"
                    dataKey="total"
                    name="Total employees"
                    stroke={primaryHex}
                    strokeWidth={2}
                    dot={{ r: 4, fill: primaryHex, strokeWidth: 2, stroke: "var(--card)" }}
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
    </div>
  )
}
