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
import { ChevronLeft, ChevronRight, Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { getCalendar } from "@/features/calendar/api"
import { NewEventDialog } from "@/features/calendar/NewEventDialog"
import { useAuth } from "@/features/auth/AuthContext"
import type { CalendarEntry, CalendarEntryType } from "@/features/calendar/types"

const typeDot: Record<CalendarEntryType, string> = {
  meeting: "bg-primary",
  event: "bg-success",
  holiday: "bg-danger",
  leave: "bg-warning",
  task_due: "bg-muted-foreground",
  project_deadline: "bg-danger",
  birthday: "bg-success",
}

const typeChip: Record<CalendarEntryType, string> = {
  meeting: "bg-primary/15 text-primary",
  event: "bg-success/15 text-success",
  holiday: "bg-danger/15 text-danger",
  leave: "bg-warning/15 text-warning",
  task_due: "bg-muted text-muted-foreground",
  project_deadline: "bg-danger/15 text-danger",
  birthday: "bg-success/15 text-success",
}

const typeLabel: Record<CalendarEntryType, string> = {
  meeting: "Meeting",
  event: "Event",
  holiday: "Holiday",
  leave: "Leave",
  task_due: "Task due",
  project_deadline: "Project deadline",
  birthday: "Birthday",
}

export function CalendarPage() {
  const { user } = useAuth()
  const isManager =
    (user?.role === "founder" || user?.role === "company_admin") || user?.role === "hr_admin" || user?.role === "project_manager" || user?.role === "team_lead"
  const [month, setMonth] = useState(new Date())
  const [selectedDate, setSelectedDate] = useState<Date>(new Date())
  const [newEventOpen, setNewEventOpen] = useState(false)

  const { data: entries } = useQuery({
    queryKey: ["calendar", month.getFullYear(), month.getMonth() + 1],
    queryFn: () => getCalendar(month.getFullYear(), month.getMonth() + 1),
  })

  const gridStart = startOfWeek(startOfMonth(month))
  const gridEnd = endOfWeek(endOfMonth(month))
  const days = eachDayOfInterval({ start: gridStart, end: gridEnd })

  const entriesByDay = (day: Date): CalendarEntry[] =>
    entries?.filter((e) => isSameDay(new Date(e.date), day)) ?? []

  const selectedEntries = entriesByDay(selectedDate)

  return (
    <div className="flex flex-1 flex-col gap-5">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-foreground">Calendar</h1>
        {isManager && (
          <Button className="rounded-md" onClick={() => setNewEventOpen(true)}>
            <Plus className="mr-2 size-4" />
            New Event
          </Button>
        )}
      </div>

      <Card className="rounded-md border shadow-none">
        <CardContent className="flex flex-col gap-3 py-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex-1">
            <p className="text-sm font-semibold text-foreground">{format(selectedDate, "EEEE, MMMM d, yyyy")}</p>
            {selectedEntries.length === 0 ? (
              <p className="mt-1 text-sm text-muted-foreground">No events on this day.</p>
            ) : (
              <div className="mt-2 flex flex-col gap-1.5">
                {selectedEntries.map((e, i) => (
                  <div key={i} className="flex items-center gap-2 text-sm">
                    <span className={`shrink-0 rounded px-1.5 py-0.5 text-xs font-medium ${typeChip[e.type]}`}>
                      {typeLabel[e.type]}
                    </span>
                    <span className="text-foreground">{e.title}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
          {isManager && (
            <Button size="sm" variant="outline" className="rounded-md" onClick={() => setNewEventOpen(true)}>
              <Plus className="mr-2 size-4" />
              Add Event
            </Button>
          )}
        </CardContent>
      </Card>

      <div className="flex items-center justify-between">
        <h2 className="text-lg font-medium text-foreground">{format(month, "MMMM yyyy")}</h2>
        <div className="flex gap-2">
          <Button variant="outline" size="icon" className="rounded-md" onClick={() => setMonth((m) => subMonths(m, 1))}>
            <ChevronLeft className="size-4" />
          </Button>
          <Button variant="outline" size="icon" className="rounded-md" onClick={() => setMonth((m) => addMonths(m, 1))}>
            <ChevronRight className="size-4" />
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-7 gap-px overflow-hidden rounded-md border border-border bg-border">
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
          <div key={d} className="bg-muted py-2 text-center text-xs font-medium text-muted-foreground">
            {d}
          </div>
        ))}
        {days.map((day) => {
          const dayEntries = entriesByDay(day)
          const isSelected = isSameDay(day, selectedDate)
          return (
            <button
              key={day.toISOString()}
              onClick={() => setSelectedDate(day)}
              className={`flex h-24 flex-col items-start gap-1 bg-card p-2 text-left transition-colors hover:bg-muted ${
                !isSameMonth(day, month) ? "text-muted-foreground/40" : "text-foreground"
              } ${isSelected ? "ring-2 ring-inset ring-primary" : ""}`}
            >
              <span
                className={
                  isToday(day)
                    ? "flex size-6 items-center justify-center rounded-full bg-primary text-xs text-primary-foreground"
                    : "text-xs"
                }
              >
                {format(day, "d")}
              </span>
              <div className="flex w-full flex-col gap-0.5 overflow-hidden">
                {dayEntries.slice(0, 2).map((e, i) => (
                  <span
                    key={i}
                    className={`truncate rounded px-1 py-0.5 text-[10px] font-medium ${typeChip[e.type]}`}
                  >
                    {e.title}
                  </span>
                ))}
                {dayEntries.length > 2 && (
                  <span className="text-[10px] text-muted-foreground">+{dayEntries.length - 2} more</span>
                )}
              </div>
            </button>
          )
        })}
      </div>

      <Card className="rounded-md border shadow-none">
        <CardContent className="flex flex-wrap gap-4 py-3 text-xs text-muted-foreground">
          {(Object.keys(typeLabel) as CalendarEntryType[]).map((t) => (
            <span key={t} className="flex items-center gap-1.5">
              <span className={`size-1.5 rounded-full ${typeDot[t]}`} />
              {typeLabel[t]}
            </span>
          ))}
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
