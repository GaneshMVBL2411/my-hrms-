import { useState, useMemo } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
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
  CalendarDays,
  Calendar as CalendarIcon,
  ChevronLeft,
  ChevronRight,
  Plus,
  Edit2,
  Trash2,
} from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { getCalendar } from "@/features/calendar/api"
import type { CalendarEntry, CalendarEntryType } from "@/features/calendar/types"
import { HrScheduleDialog, type HrScheduleItem } from "@/features/calendar/HrScheduleDialog"
import { toast } from "sonner"

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
  event: "Consultation",
  leave: "Blocked Time",
  task_due: "Follow-up",
  meeting: "Meeting",
  holiday: "Reminder",
  project_deadline: "Deadline",
  birthday: "Birthday",
}

export function ScheduleWidget() {
  const queryClient = useQueryClient()
  const [month, setMonth] = useState(new Date(2026, 8, 1)) // Sep 2026 default
  const [selectedDate, setSelectedDate] = useState<Date>(new Date(2026, 8, 9))

  const [hrModalOpen, setHrModalOpen] = useState(false)
  const [editingItem, setEditingItem] = useState<HrScheduleItem | null>(null)
  const [localEvents, setLocalEvents] = useState<HrScheduleItem[]>([
    {
      id: "ev-1",
      title: "Consultation: Patient Review",
      date: "2026-09-09",
      type: "event",
      timeSlot: "10:30 AM - 11:30 AM",
      assignee: "Dr. Taraka Nadh Nanduri",
    },
    {
      id: "ev-2",
      title: "Shift Review & Standup",
      date: "2026-09-09",
      type: "meeting",
      timeSlot: "02:00 PM - 03:00 PM",
      assignee: "Ganesh Kumar",
    },
  ])

  const { data: entries } = useQuery({
    queryKey: ["calendar", "dashboard-grid", month.getFullYear(), month.getMonth() + 1],
    queryFn: () => getCalendar(month.getFullYear(), month.getMonth() + 1),
  })

  // Merge server and local events
  const mergedEntries = useMemo(() => {
    const list: CalendarEntry[] = [...(entries || [])]
    for (const ev of localEvents) {
      if (!list.some((s) => s.title === ev.title && s.date === ev.date)) {
        list.push({
          date: ev.date,
          type: ev.type,
          title: ev.title,
        })
      }
    }
    return list
  }, [entries, localEvents])

  const gridStart = startOfWeek(startOfMonth(month))
  const gridEnd = endOfWeek(endOfMonth(month))
  const days = eachDayOfInterval({ start: gridStart, end: gridEnd })

  const entriesByDay = (day: Date): CalendarEntry[] =>
    mergedEntries.filter((e) => isSameDay(new Date(e.date), day))

  const selectedEntries = useMemo(() => {
    const dateStr = format(selectedDate, "yyyy-MM-dd")
    const locals = localEvents.filter((e) => e.date === dateStr)
    const servers = (entries || [])
      .filter((e) => isSameDay(new Date(e.date), selectedDate))
      .filter((e) => !locals.some((l) => l.title === e.title))
      .map((e) => ({
        id: `srv-${e.date}-${e.title}`,
        title: e.title,
        date: dateStr,
        type: e.type,
        timeSlot: "Scheduled Event",
        assignee: "Team Member",
      }))
    return [...locals, ...servers]
  }, [selectedDate, localEvents, entries])

  const handleSaveHrSchedule = (item: HrScheduleItem) => {
    setLocalEvents((prev) => {
      const idx = prev.findIndex((p) => p.id === item.id)
      if (idx >= 0) {
        const next = [...prev]
        next[idx] = item
        return next
      }
      return [item, ...prev]
    })
    queryClient.invalidateQueries({ queryKey: ["calendar"] })
  }

  const handleDeleteHrSchedule = (id: number | string) => {
    setLocalEvents((prev) => prev.filter((p) => p.id !== id))
    toast.success("Schedule item removed")
  }

  return (
    <Card className="overflow-hidden rounded-xl border shadow-sm bg-card">
      {/* Calendar Header with Navigation & HR Update button */}
      <CardHeader className="flex flex-row items-center justify-between border-b bg-card px-4 py-3">
        <div className="flex items-center gap-2">
          <CalendarDays className="size-4 text-primary" />
          <CardTitle className="text-base font-semibold text-foreground">My Schedule</CardTitle>
        </div>

        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="default"
            className="h-7 rounded-lg text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white px-2.5"
            onClick={() => {
              setEditingItem(null)
              setHrModalOpen(true)
            }}
          >
            <Plus className="mr-1 size-3.5" />
            HR Update
          </Button>

          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="icon"
              className="size-7 rounded-md"
              onClick={() => setMonth((m) => subMonths(m, 1))}
              title="Previous month"
            >
              <ChevronLeft className="size-3.5" />
            </Button>
            <span className="min-w-[110px] text-center text-xs font-semibold text-foreground">
              {format(month, "MMMM yyyy")}
            </span>
            <Button
              variant="outline"
              size="icon"
              className="size-7 rounded-md"
              onClick={() => setMonth((m) => addMonths(m, 1))}
              title="Next month"
            >
              <ChevronRight className="size-3.5" />
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="p-0">
        {/* 7-Day Header */}
        <div className="grid grid-cols-7 border-b bg-muted/40 text-center text-[11px] font-medium text-muted-foreground">
          {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => (
            <div key={day} className="py-2">
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
                onDoubleClick={() => {
                  setSelectedDate(day)
                  setEditingItem(null)
                  setHrModalOpen(true)
                }}
                className={`group relative flex min-h-[56px] sm:min-h-[64px] flex-col p-1.5 text-left transition-colors hover:bg-muted/50 ${
                  !currentMonth ? "bg-muted/15 text-muted-foreground/35" : "text-foreground"
                } ${
                  isSelected
                    ? "z-10 ring-2 ring-inset ring-blue-500 border-l-2 border-l-blue-600 bg-blue-50/20 dark:bg-blue-950/20"
                    : ""
                }`}
                title="Click to select, double-click for HR Update"
              >
                <div className="flex w-full items-center justify-between">
                  <span
                    className={`text-[11px] font-semibold ${
                      isSelected
                        ? "text-blue-600 font-bold"
                        : today
                        ? "flex size-5 items-center justify-center rounded-full bg-blue-600 text-white font-bold"
                        : currentMonth
                        ? "text-foreground"
                        : "text-muted-foreground/40"
                    }`}
                  >
                    {format(day, "d")}
                  </span>
                  <CalendarIcon
                    className={`size-2.5 ${
                      isSelected
                        ? "text-blue-600"
                        : today
                        ? "text-blue-600"
                        : currentMonth
                        ? "text-muted-foreground/40"
                        : "text-muted-foreground/20"
                    }`}
                  />
                </div>

                {/* Day cell dots */}
                <div className="mt-1 flex flex-wrap gap-1">
                  {dayEntries.slice(0, 3).map((e, idx) => (
                    <span key={idx} className={`size-1.5 rounded-full ${typeDot[e.type]}`} />
                  ))}
                  {dayEntries.length > 3 && (
                    <span className="text-[9px] text-muted-foreground">+{dayEntries.length - 3}</span>
                  )}
                </div>
              </button>
            )
          })}
        </div>

        {/* Category Legend matching reference */}
        <div className="flex flex-wrap items-center gap-x-3.5 gap-y-1.5 border-b bg-card px-4 py-2 text-[11px] text-muted-foreground">
          <span className="flex items-center gap-1 font-medium">
            <span className="size-2 rounded-full bg-emerald-500" />
            Consultations
          </span>
          <span className="flex items-center gap-1 font-medium">
            <span className="size-2 rounded-full bg-rose-500" />
            Blocked Time
          </span>
          <span className="flex items-center gap-1 font-medium">
            <span className="size-2 rounded-full bg-sky-500" />
            Follow-ups
          </span>
          <span className="flex items-center gap-1 font-medium">
            <span className="size-2 rounded-full bg-purple-500" />
            Meetings
          </span>
          <span className="flex items-center gap-1 font-medium">
            <span className="size-2 rounded-full bg-indigo-500" />
            Reminders
          </span>
        </div>

        {/* Selected date quick summary with HR Update actions */}
        <div className="p-3.5">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-foreground">
              {format(selectedDate, "EEEE, MMMM d, yyyy")}
            </p>
            <Button
              size="sm"
              variant="outline"
              className="h-6 rounded-md text-[10px] px-2"
              onClick={() => {
                setEditingItem(null)
                setHrModalOpen(true)
              }}
            >
              <Plus className="mr-1 size-3" />
              Add Item
            </Button>
          </div>

          {selectedEntries.length === 0 ? (
            <p className="mt-1 text-xs text-muted-foreground">No events on this day. Click "+ Add Item" to schedule.</p>
          ) : (
            <div className="mt-2 flex flex-col gap-1.5">
              {selectedEntries.map((e, i) => (
                <div
                  key={i}
                  className="flex items-center justify-between rounded-md border bg-muted/20 px-2.5 py-1.5 text-xs"
                >
                  <div className="flex items-center gap-2">
                    <span className={`size-2 rounded-full ${typeDot[e.type]}`} />
                    <div>
                      <span className="font-medium text-foreground">{e.title}</span>
                      {e.timeSlot && <span className="ml-1.5 text-[10px] text-muted-foreground">({e.timeSlot})</span>}
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5">
                    <Badge variant="outline" className={`text-[10px] ${typeChip[e.type]}`}>
                      {typeLabel[e.type] || e.type}
                    </Badge>
                    <button
                      type="button"
                      onClick={() => {
                        setEditingItem({
                          id: e.id,
                          title: e.title,
                          date: e.date,
                          type: e.type,
                          timeSlot: e.timeSlot,
                          assignee: e.assignee,
                        })
                        setHrModalOpen(true)
                      }}
                      className="p-0.5 text-muted-foreground hover:text-foreground"
                    >
                      <Edit2 className="size-3" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteHrSchedule(e.id || "")}
                      className="p-0.5 text-muted-foreground hover:text-destructive"
                    >
                      <Trash2 className="size-3" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </CardContent>

      <HrScheduleDialog
        open={hrModalOpen}
        onOpenChange={setHrModalOpen}
        defaultDate={format(selectedDate, "yyyy-MM-dd")}
        editingItem={editingItem}
        onSave={handleSaveHrSchedule}
        onDelete={handleDeleteHrSchedule}
      />
    </Card>
  )
}
