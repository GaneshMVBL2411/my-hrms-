import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  isToday,
  startOfMonth,
  startOfWeek,
  subMonths,
} from "date-fns"
import {
  Calendar as CalendarIcon,
  ChevronLeft,
  ChevronRight,
  Plus,
  Users,
  Clock,
  CheckCircle2,
  CalendarCheck2,
  Activity,
  CalendarDays,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { getCalendar } from "@/features/calendar/api"
import { NewEventDialog } from "@/features/calendar/NewEventDialog"
import { useAuth } from "@/features/auth/AuthContext"
import { listEmployees } from "@/features/employees/api"
import { listRequests } from "@/features/leaves/api"
import { getSummary } from "@/features/attendance/api"
import type { CalendarEntry, CalendarEntryType } from "@/features/calendar/types"

const typeDot: Record<CalendarEntryType, string> = {
  meeting: "bg-purple-500",
  event: "bg-emerald-500",
  holiday: "bg-indigo-500",
  leave: "bg-rose-500",
  task_due: "bg-sky-500",
  project_deadline: "bg-amber-500",
  birthday: "bg-pink-500",
}

const typeChip: Record<CalendarEntryType, string> = {
  meeting: "bg-purple-500/15 text-purple-700 dark:text-purple-300 border-purple-200 dark:border-purple-800",
  event: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800",
  holiday: "bg-indigo-500/15 text-indigo-700 dark:text-indigo-300 border-indigo-200 dark:border-indigo-800",
  leave: "bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-200 dark:border-rose-800",
  task_due: "bg-sky-500/15 text-sky-700 dark:text-sky-300 border-sky-200 dark:border-sky-800",
  project_deadline: "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800",
  birthday: "bg-pink-500/15 text-pink-700 dark:text-pink-300 border-pink-200 dark:border-pink-800",
}

const typeLabel: Record<CalendarEntryType, string> = {
  meeting: "Meetings",
  event: "Consultations / Events",
  holiday: "Reminders / Holidays",
  leave: "Blocked Time / Leaves",
  task_due: "Follow-ups / Tasks",
  project_deadline: "Project Deadlines",
  birthday: "Birthdays",
}

export function CalendarPage() {
  const { user } = useAuth()
  const isManager =
    user?.role === "founder" ||
    user?.role === "company_admin" ||
    user?.role === "hr_admin" ||
    user?.role === "project_manager" ||
    user?.role === "team_lead"

  const [month, setMonth] = useState(new Date())
  const [selectedDate, setSelectedDate] = useState<Date>(new Date())
  const [newEventOpen, setNewEventOpen] = useState(false)

  // 1. Calendar events query
  const { data: entries } = useQuery({
    queryKey: ["calendar", month.getFullYear(), month.getMonth() + 1],
    queryFn: () => getCalendar(month.getFullYear(), month.getMonth() + 1),
  })

  // 2. Overview Stats queries matching reference image
  const { data: employeesData } = useQuery({
    queryKey: ["employees", "calendar-stats"],
    queryFn: () => listEmployees({ page: 1, pageSize: 1 }),
  })
  const totalEmployees = employeesData?.total ?? 6

  const { data: pendingLeaves = [] } = useQuery({
    queryKey: ["leaves", "calendar-stats-pending"],
    queryFn: () => listRequests({ scope: "all", status: "pending" }),
  })
  const pendingCount = pendingLeaves.length

  const { data: attendanceSummary } = useQuery({
    queryKey: ["attendance", "calendar-stats-summary"],
    queryFn: () => getSummary(),
  })
  const activeCount = attendanceSummary?.present ?? 2
  const scheduleCount = entries?.length ?? 28

  const gridStart = startOfWeek(startOfMonth(month))
  const gridEnd = endOfWeek(endOfMonth(month))
  const days = eachDayOfInterval({ start: gridStart, end: gridEnd })

  const entriesByDay = (day: Date): CalendarEntry[] =>
    entries?.filter((e) => isSameDay(new Date(e.date), day)) ?? []

  const selectedEntries = entriesByDay(selectedDate)

  return (
    <div className="flex flex-1 flex-col gap-6 p-1 md:p-2">
      {/* Welcome Header */}
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            Welcome back, {user?.email?.split("@")[0] || "Team Member"}
          </h1>
          <p className="text-sm text-muted-foreground">Here's your schedule and operations overview</p>
        </div>
        {isManager && (
          <Button className="rounded-md shadow-sm" onClick={() => setNewEventOpen(true)}>
            <Plus className="mr-2 size-4" />
            New Event
          </Button>
        )}
      </div>

      {/* 4 Stat Overview Cards matching reference image */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {/* Card 1: Total Team */}
        <Card className="rounded-xl border shadow-sm transition-all hover:shadow">
          <CardContent className="flex items-center justify-between p-4">
            <div>
              <p className="text-xs font-medium text-muted-foreground">Total Team Members</p>
              <p className="mt-1 text-2xl font-bold text-foreground">{totalEmployees}</p>
            </div>
            <div className="flex size-10 items-center justify-center rounded-xl bg-sky-500/10 text-sky-600 dark:text-sky-400">
              <Users className="size-5" />
            </div>
          </CardContent>
        </Card>

        {/* Card 2: Pending Requests */}
        <Card className="rounded-xl border shadow-sm transition-all hover:shadow">
          <CardContent className="flex items-center justify-between p-4">
            <div>
              <p className="text-xs font-medium text-muted-foreground">Pending Requests</p>
              <p className="mt-1 text-2xl font-bold text-foreground">{pendingCount}</p>
            </div>
            <div className="flex size-10 items-center justify-center rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-400">
              <Clock className="size-5" />
            </div>
          </CardContent>
        </Card>

        {/* Card 3: Active On-Duty */}
        <Card className="rounded-xl border shadow-sm transition-all hover:shadow">
          <CardContent className="flex items-center justify-between p-4">
            <div>
              <p className="text-xs font-medium text-muted-foreground">Active On-Duty</p>
              <p className="mt-1 text-2xl font-bold text-foreground">{activeCount}</p>
            </div>
            <div className="flex size-10 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
              <CheckCircle2 className="size-5" />
            </div>
          </CardContent>
        </Card>

        {/* Card 4: Schedule */}
        <Card className="rounded-xl border shadow-sm transition-all hover:shadow">
          <CardContent className="flex items-center justify-between p-4">
            <div>
              <p className="text-xs font-medium text-muted-foreground">Schedule</p>
              <p className="mt-1 text-2xl font-bold text-foreground">{scheduleCount}</p>
            </div>
            <div className="flex size-10 items-center justify-center rounded-xl bg-indigo-500/10 text-indigo-600 dark:text-indigo-400">
              <CalendarCheck2 className="size-5" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* "My Schedule" Main Calendar Section */}
      <Card className="overflow-hidden rounded-xl border shadow-sm">
        {/* Calendar Card Header */}
        <div className="flex flex-wrap items-center justify-between border-b bg-card px-5 py-4">
          <div className="flex items-center gap-2">
            <CalendarDays className="size-5 text-primary" />
            <h2 className="text-base font-semibold text-foreground">My Schedule</h2>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="icon"
              className="size-8 rounded-lg"
              onClick={() => setMonth((m) => subMonths(m, 1))}
              title="Previous month"
            >
              <ChevronLeft className="size-4" />
            </Button>
            <span className="min-w-[130px] text-center text-sm font-semibold text-foreground">
              {format(month, "MMMM yyyy")}
            </span>
            <Button
              variant="outline"
              size="icon"
              className="size-8 rounded-lg"
              onClick={() => setMonth((m) => addMonths(m, 1))}
              title="Next month"
            >
              <ChevronRight className="size-4" />
            </Button>
          </div>
        </div>

        {/* 7-Day Header */}
        <div className="grid grid-cols-7 border-b bg-muted/40 text-center text-xs font-medium text-muted-foreground">
          {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => (
            <div key={day} className="py-2.5">
              {day}
            </div>
          ))}
        </div>

        {/* 7-Day Month Grid */}
        <div className="grid grid-cols-7 divide-x divide-y border-b bg-card">
          {days.map((day) => {
            const dayEntries = entriesByDay(day)
            const isSelected = isSameDay(day, selectedDate)
            const currentMonth = isSameMonth(day, month)
            const today = isToday(day)

            return (
              <button
                key={day.toISOString()}
                type="button"
                onClick={() => setSelectedDate(day)}
                className={`group relative flex min-h-[85px] sm:min-h-[105px] flex-col p-2 text-left transition-colors hover:bg-muted/50 ${
                  !currentMonth ? "bg-muted/15 text-muted-foreground/35" : "text-foreground"
                } ${
                  isSelected
                    ? "z-10 ring-2 ring-inset ring-blue-500 bg-blue-50/20 dark:bg-blue-950/20"
                    : ""
                }`}
              >
                {/* Top row of day cell: Day Number & Calendar Icon */}
                <div className="flex w-full items-center justify-between">
                  <span
                    className={`text-xs font-semibold ${
                      today
                        ? "flex size-6 items-center justify-center rounded-full bg-blue-600 text-white font-bold"
                        : currentMonth
                        ? "text-foreground"
                        : "text-muted-foreground/40"
                    }`}
                  >
                    {format(day, "d")}
                  </span>
                  <CalendarIcon
                    className={`size-3.5 ${
                      today
                        ? "text-blue-600"
                        : currentMonth
                        ? "text-muted-foreground/40 group-hover:text-muted-foreground"
                        : "text-muted-foreground/20"
                    }`}
                  />
                </div>

                {/* Day cell events */}
                <div className="mt-1.5 flex w-full flex-1 flex-col gap-1 overflow-hidden">
                  {dayEntries.slice(0, 2).map((e, idx) => (
                    <div
                      key={idx}
                      className={`truncate rounded px-1.5 py-0.5 text-[10px] font-medium border ${typeChip[e.type]}`}
                      title={e.title}
                    >
                      {e.title}
                    </div>
                  ))}
                  {dayEntries.length > 2 && (
                    <span className="text-[10px] font-medium text-muted-foreground">
                      +{dayEntries.length - 2} more
                    </span>
                  )}
                </div>
              </button>
            )
          })}
        </div>

        {/* Color-Coded Category Legend matching reference image */}
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 bg-card px-5 py-3.5 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5 font-medium">
            <span className="size-2.5 rounded-full bg-emerald-500 ring-2 ring-emerald-500/20" />
            Consultations
          </span>
          <span className="flex items-center gap-1.5 font-medium">
            <span className="size-2.5 rounded-full bg-rose-500 ring-2 ring-rose-500/20" />
            Blocked Time
          </span>
          <span className="flex items-center gap-1.5 font-medium">
            <span className="size-2.5 rounded-full bg-sky-500 ring-2 ring-sky-500/20" />
            Follow-ups
          </span>
          <span className="flex items-center gap-1.5 font-medium">
            <span className="size-2.5 rounded-full bg-purple-500 ring-2 ring-purple-500/20" />
            Meetings
          </span>
          <span className="flex items-center gap-1.5 font-medium">
            <span className="size-2.5 rounded-full bg-indigo-500 ring-2 ring-indigo-500/20" />
            Reminders
          </span>
        </div>
      </Card>

      {/* Selected Day Agenda Detail */}
      <Card className="rounded-xl border shadow-sm">
        <CardHeader className="flex flex-row items-center justify-between border-b pb-4">
          <div>
            <CardTitle className="text-base font-semibold">
              Agenda for {format(selectedDate, "EEEE, MMMM d, yyyy")}
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              {selectedEntries.length} {selectedEntries.length === 1 ? "item" : "items"} scheduled
            </p>
          </div>
          {isManager && (
            <Button
              size="sm"
              variant="outline"
              className="rounded-lg"
              onClick={() => setNewEventOpen(true)}
            >
              <Plus className="mr-1.5 size-3.5" />
              Add Event
            </Button>
          )}
        </CardHeader>
        <CardContent className="pt-4">
          {selectedEntries.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-6 text-center text-sm text-muted-foreground">
              <CalendarIcon className="size-8 text-muted-foreground/30 mb-2" />
              <p>No scheduled appointments or blocked times on this date.</p>
            </div>
          ) : (
            <div className="grid gap-2.5 sm:grid-cols-2">
              {selectedEntries.map((e, i) => (
                <div
                  key={i}
                  className="flex items-center justify-between rounded-lg border bg-card/60 p-3 text-sm shadow-xs"
                >
                  <div className="flex items-center gap-3">
                    <span className={`size-2.5 rounded-full ${typeDot[e.type]}`} />
                    <div>
                      <p className="font-medium text-foreground">{e.title}</p>
                      <p className="text-xs text-muted-foreground capitalize">
                        {typeLabel[e.type] || e.type.replace(/_/g, " ")}
                      </p>
                    </div>
                  </div>
                  <Badge variant="outline" className={typeChip[e.type]}>
                    {typeLabel[e.type]?.split("/")[0]?.trim() || "Event"}
                  </Badge>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Recent Activity Section matching reference image */}
      <Card className="rounded-xl border shadow-sm">
        <CardHeader className="border-b pb-3">
          <CardTitle className="text-base font-semibold">Recent Activity</CardTitle>
          <p className="text-xs text-muted-foreground">Latest updates in your schedule & practice</p>
        </CardHeader>
        <CardContent className="divide-y p-0">
          {(entries ?? [])
            .slice(0, 6)
            .map((entry, idx) => (
              <div key={idx} className="flex items-center gap-3 px-5 py-3 transition-colors hover:bg-muted/30">
                <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                  <Activity className="size-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="truncate text-sm font-medium text-foreground">{entry.title}</p>
                  <p className="text-xs text-muted-foreground">
                    Scheduled on {format(new Date(entry.date), "MMMM d, yyyy")}
                  </p>
                </div>
                <Badge variant="outline" className="text-xs">
                  {typeLabel[entry.type]?.split("/")[0]?.trim() || "Active"}
                </Badge>
              </div>
            ))}
          {(!entries || entries.length === 0) && (
            <div className="py-6 text-center text-sm text-muted-foreground">
              No recent activity recorded yet.
            </div>
          )}
        </CardContent>
      </Card>

      <NewEventDialog
        open={newEventOpen}
        onOpenChange={setNewEventOpen}
        defaultDate={format(selectedDate, "yyyy-MM-dd")}
      />
    </div>
  )
}
