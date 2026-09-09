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
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Plus,
  Filter,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { getCalendar } from "@/features/calendar/api"
import { NewEventDialog } from "@/features/calendar/NewEventDialog"
import { useAuth } from "@/features/auth/AuthContext"
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
  event: "Events",
  leave: "Leaves",
  task_due: "Tasks",
  holiday: "Holidays",
  project_deadline: "Deadlines",
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

  // Dynamic current date
  const [month, setMonth] = useState(() => new Date())
  const [selectedDate, setSelectedDate] = useState<Date>(() => new Date())
  const [newEventOpen, setNewEventOpen] = useState(false)
  const [activeFilter, setActiveFilter] = useState<CalendarEntryType | "all">("all")

  // Real calendar events query from database
  const { data: entries } = useQuery({
    queryKey: ["calendar", month.getFullYear(), month.getMonth() + 1],
    queryFn: () => getCalendar(month.getFullYear(), month.getMonth() + 1),
  })

  // Calculate calendar grid days
  const gridStart = startOfWeek(startOfMonth(month))
  const gridEnd = endOfWeek(endOfMonth(month))
  const days = eachDayOfInterval({ start: gridStart, end: gridEnd })

  const entriesByDay = (day: Date): CalendarEntry[] => {
    const dayEntries = entries?.filter((e) => isSameDay(new Date(e.date), day)) ?? []
    if (activeFilter === "all") return dayEntries
    return dayEntries.filter((e) => e.type === activeFilter)
  }

  const selectedEntries = entriesByDay(selectedDate)

  return (
    <div className="flex flex-1 flex-col gap-6 p-1 sm:p-2 max-w-7xl mx-auto w-full">
      {/* Calendar Header with Title, Month Switcher and Add Event */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">My Schedule</h1>
          <p className="text-sm text-muted-foreground">View scheduled events, meetings, leaves, and deadlines</p>
        </div>

        <div className="flex items-center gap-2">
          {isManager && (
            <Button
              className="rounded-lg shadow-sm bg-blue-600 hover:bg-blue-700 text-white font-semibold"
              onClick={() => setNewEventOpen(true)}
            >
              <Plus className="mr-1.5 size-4" />
              New Event
            </Button>
          )}
        </div>
      </div>

      {/* Main "My Schedule" Calendar Template matching reference screenshot */}
      <Card className="overflow-hidden rounded-xl border shadow-sm bg-card">
        {/* Calendar Header with Navigation Controls */}
        <div className="flex flex-wrap items-center justify-between border-b bg-card px-5 py-3.5">
          <div className="flex items-center gap-2">
            <CalendarDays className="size-5 text-primary" />
            <h2 className="text-base font-semibold text-foreground">My Schedule</h2>
            {activeFilter !== "all" && (
              <Badge variant="secondary" className="text-xs flex items-center gap-1">
                <Filter className="size-3" />
                Filtered: {typeLabel[activeFilter]}
                <button
                  type="button"
                  onClick={() => setActiveFilter("all")}
                  className="ml-1 text-muted-foreground hover:text-foreground font-bold"
                >
                  ×
                </button>
              </Badge>
            )}
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
            <span className="min-w-[140px] text-center text-sm font-bold text-foreground">
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

        {/* 7-Day Column Headers: Sun, Mon, Tue, Wed, Thu, Fri, Sat */}
        <div className="grid grid-cols-7 border-b bg-muted/40 text-center text-xs font-semibold text-muted-foreground">
          {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => (
            <div key={day} className="py-2.5">
              {day}
            </div>
          ))}
        </div>

        {/* 7-Day Month Grid matching reference screenshot template */}
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
                className={`group relative flex min-h-[85px] sm:min-h-[105px] flex-col p-2 text-left transition-all hover:bg-muted/50 ${
                  !currentMonth ? "bg-muted/15 text-muted-foreground/35" : "text-foreground"
                } ${
                  isSelected
                    ? "z-10 ring-2 ring-inset ring-blue-500 border-l-4 border-l-blue-600 bg-blue-50/20 dark:bg-blue-950/20 shadow-inner"
                    : ""
                }`}
              >
                {/* Top row of day cell: Day Number & Calendar Icon */}
                <div className="flex w-full items-center justify-between">
                  <span
                    className={`text-xs font-semibold ${
                      isSelected
                        ? "text-blue-600 dark:text-blue-400 font-bold text-sm"
                        : today
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
                      isSelected
                        ? "text-blue-600"
                        : today
                        ? "text-blue-600"
                        : currentMonth
                        ? "text-muted-foreground/40 group-hover:text-muted-foreground"
                        : "text-muted-foreground/20"
                    }`}
                  />
                </div>

                {/* Day cell event chips from real API data */}
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

        {/* Color-Coded Category Legend matching reference screenshot template */}
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 bg-card px-5 py-3.5 text-xs text-muted-foreground">
          <button
            type="button"
            onClick={() => setActiveFilter(activeFilter === "meeting" ? "all" : "meeting")}
            className={`flex items-center gap-1.5 font-medium transition-colors hover:text-foreground ${
              activeFilter === "meeting" ? "text-purple-600 font-bold" : ""
            }`}
          >
            <span className="size-2.5 rounded-full bg-purple-500 ring-2 ring-purple-500/20" />
            Meetings
          </button>

          <button
            type="button"
            onClick={() => setActiveFilter(activeFilter === "event" ? "all" : "event")}
            className={`flex items-center gap-1.5 font-medium transition-colors hover:text-foreground ${
              activeFilter === "event" ? "text-emerald-600 font-bold" : ""
            }`}
          >
            <span className="size-2.5 rounded-full bg-emerald-500 ring-2 ring-emerald-500/20" />
            Events
          </button>

          <button
            type="button"
            onClick={() => setActiveFilter(activeFilter === "leave" ? "all" : "leave")}
            className={`flex items-center gap-1.5 font-medium transition-colors hover:text-foreground ${
              activeFilter === "leave" ? "text-rose-600 font-bold" : ""
            }`}
          >
            <span className="size-2.5 rounded-full bg-rose-500 ring-2 ring-rose-500/20" />
            Leaves
          </button>

          <button
            type="button"
            onClick={() => setActiveFilter(activeFilter === "task_due" ? "all" : "task_due")}
            className={`flex items-center gap-1.5 font-medium transition-colors hover:text-foreground ${
              activeFilter === "task_due" ? "text-sky-600 font-bold" : ""
            }`}
          >
            <span className="size-2.5 rounded-full bg-sky-500 ring-2 ring-sky-500/20" />
            Tasks
          </button>

          <button
            type="button"
            onClick={() => setActiveFilter(activeFilter === "holiday" ? "all" : "holiday")}
            className={`flex items-center gap-1.5 font-medium transition-colors hover:text-foreground ${
              activeFilter === "holiday" ? "text-indigo-600 font-bold" : ""
            }`}
          >
            <span className="size-2.5 rounded-full bg-indigo-500 ring-2 ring-indigo-500/20" />
            Holidays
          </button>

          <button
            type="button"
            onClick={() => setActiveFilter(activeFilter === "project_deadline" ? "all" : "project_deadline")}
            className={`flex items-center gap-1.5 font-medium transition-colors hover:text-foreground ${
              activeFilter === "project_deadline" ? "text-amber-600 font-bold" : ""
            }`}
          >
            <span className="size-2.5 rounded-full bg-amber-500 ring-2 ring-amber-500/20" />
            Deadlines
          </button>
        </div>
      </Card>

      {/* Selected Day Agenda Detail */}
      <Card className="rounded-xl border shadow-sm">
        <CardHeader className="flex flex-row items-center justify-between border-b pb-4">
          <div>
            <CardTitle className="text-base font-semibold text-foreground">
              Schedule for {format(selectedDate, "EEEE, MMMM d, yyyy")}
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              {selectedEntries.length} {selectedEntries.length === 1 ? "event" : "events"} scheduled
            </p>
          </div>

          {isManager && (
            <Button
              size="sm"
              className="rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-medium"
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
              <p>No events, meetings, or leaves scheduled on this day.</p>
              {isManager && (
                <Button
                  size="sm"
                  variant="outline"
                  className="mt-3 rounded-lg text-xs"
                  onClick={() => setNewEventOpen(true)}
                >
                  Create Event
                </Button>
              )}
            </div>
          ) : (
            <div className="space-y-2.5">
              {selectedEntries.map((item, idx) => (
                <div
                  key={idx}
                  className="flex items-start justify-between rounded-xl border p-3.5 transition-colors hover:bg-muted/30"
                >
                  <div className="flex items-start gap-3">
                    <span className={`mt-1.5 size-2.5 rounded-full ${typeDot[item.type]}`} />
                    <div>
                      <p className="text-sm font-bold text-foreground">{item.title}</p>
                      <div className="flex flex-wrap items-center gap-2 mt-1">
                        <Badge variant="outline" className={`text-xs ${typeChip[item.type]}`}>
                          {typeLabel[item.type] || item.type}
                        </Badge>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Real Event Creation Dialog connected to database */}
      <NewEventDialog
        open={newEventOpen}
        onOpenChange={setNewEventOpen}
        defaultDate={format(selectedDate, "yyyy-MM-dd")}
      />
    </div>
  )
}
