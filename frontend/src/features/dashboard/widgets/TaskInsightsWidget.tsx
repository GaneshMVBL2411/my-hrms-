import { useQuery } from "@tanstack/react-query"
import { useTheme } from "next-themes"
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"
import { addDays, startOfWeek } from "date-fns"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { listTasks } from "@/features/tasks/api"
import { getMyAttendance } from "@/features/attendance/api"
import type { TaskStatus } from "@/features/tasks/types"

const STATUS_LABEL: Record<TaskStatus, string> = {
  assigned: "Assigned",
  in_progress: "In Progress",
  review: "Review",
  completed: "Completed",
}

export function TaskInsightsWidget({ employeeId }: { employeeId?: number }) {
  const { resolvedTheme } = useTheme()
  const now = new Date()
  const primaryHex = resolvedTheme === "dark" ? "#1f7a54" : "#0f4c34"
  const gridHex = resolvedTheme === "dark" ? "#1e293b" : "#e2e8f0"
  const tickHex = resolvedTheme === "dark" ? "#94a3b8" : "#64748b"

  const { data: taskData } = useQuery({
    queryKey: ["tasks", "kanban-mine", employeeId],
    queryFn: () => listTasks({ page: 1, pageSize: 100, assignedTo: employeeId, sortBy: "dueDate", sortDir: "asc" }),
    enabled: !!employeeId,
  })

  const { data: attendance } = useQuery({
    queryKey: ["attendance", "me", now.getFullYear(), now.getMonth() + 1],
    queryFn: () => getMyAttendance(now.getFullYear(), now.getMonth() + 1),
  })

  const statusCounts = (Object.keys(STATUS_LABEL) as TaskStatus[]).map((status) => ({
    status: STATUS_LABEL[status],
    count: (taskData?.items ?? []).filter((t) => t.status === status).length,
  }))

  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
  const weeks: { week: string; present: number }[] = []
  for (let i = 0; i < 5; i++) {
    const weekStart = addDays(startOfWeek(monthStart, { weekStartsOn: 1 }), i * 7)
    const weekEnd = addDays(weekStart, 6)
    if (weekStart.getMonth() !== now.getMonth() && weekEnd.getMonth() !== now.getMonth()) continue

    const present = (attendance ?? []).filter((r) => {
      const d = new Date(r.date)
      return d >= weekStart && d <= weekEnd && (r.status === "present" || r.status === "half_day")
    }).length
    weeks.push({ week: `Week ${i + 1}`, present })
  }

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <Card className="rounded-md border shadow-none">
        <CardHeader>
          <CardTitle className="text-base">My Tasks by Status</CardTitle>
        </CardHeader>
        <CardContent className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={statusCounts}>
              <CartesianGrid vertical={false} stroke={gridHex} />
              <XAxis dataKey="status" tickLine={false} axisLine={false} tick={{ fill: tickHex, fontSize: 12 }} />
              <YAxis
                allowDecimals={false}
                tickLine={false}
                axisLine={false}
                tick={{ fill: tickHex, fontSize: 12 }}
                width={24}
              />
              <Tooltip
                cursor={{ fill: gridHex, opacity: 0.4 }}
                contentStyle={{ borderRadius: 4, border: "1px solid var(--border)", boxShadow: "none" }}
              />
              <Bar dataKey="count" name="Tasks" fill={primaryHex} radius={[4, 4, 0, 0]} maxBarSize={32} />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <Card className="rounded-md border shadow-none">
        <CardHeader>
          <CardTitle className="text-base">Attendance This Month</CardTitle>
        </CardHeader>
        <CardContent className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={weeks}>
              <CartesianGrid vertical={false} stroke={gridHex} />
              <XAxis dataKey="week" tickLine={false} axisLine={false} tick={{ fill: tickHex, fontSize: 12 }} />
              <YAxis
                allowDecimals={false}
                tickLine={false}
                axisLine={false}
                tick={{ fill: tickHex, fontSize: 12 }}
                width={24}
              />
              <Tooltip
                cursor={{ fill: gridHex, opacity: 0.4 }}
                contentStyle={{ borderRadius: 4, border: "1px solid var(--border)", boxShadow: "none" }}
              />
              <Bar dataKey="present" name="Present days" fill={primaryHex} radius={[4, 4, 0, 0]} maxBarSize={32} />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
    </div>
  )
}
