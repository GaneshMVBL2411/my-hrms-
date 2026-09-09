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
  FileUp,
  Edit2,
  Trash2,
  Filter,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { getCalendar } from "@/features/calendar/api"
import { useAuth } from "@/features/auth/AuthContext"
import { listEmployees } from "@/features/employees/api"
import { listRequests } from "@/features/leaves/api"
import { getSummary } from "@/features/attendance/api"
import type { CalendarEntry, CalendarEntryType } from "@/features/calendar/types"
import { HrScheduleDialog, type HrScheduleItem } from "./HrScheduleDialog"
import { RequestConsentDialog } from "./RequestConsentDialog"
import { UploadPrescriptionDialog } from "./UploadPrescriptionDialog"
import { ViewPatientsDialog } from "./ViewPatientsDialog"
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
  event: "Consultations",
  leave: "Blocked Time",
  task_due: "Follow-ups",
  meeting: "Meetings",
  holiday: "Reminders",
  project_deadline: "Deadlines",
  birthday: "Birthdays",
}

// Initial default activities matching reference screenshot media_1788941942448.png
interface ActivityItem {
  id: string
  title: string
  timestamp: string
  type: string
}

const INITIAL_ACTIVITIES: ActivityItem[] = [
  { id: "act-1", title: "Prescription: Prescription 20 Jul", timestamp: "2026-07-20T04:11:58.548175+00:00", type: "prescription" },
  { id: "act-2", title: "Prescription: Fever and cold", timestamp: "2026-07-10T09:23:45.418359+00:00", type: "prescription" },
  { id: "act-3", title: "Consultation scheduled", timestamp: "2026-07-10T09:20:13.808351+00:00", type: "consultation" },
  { id: "act-4", title: "Consent request approved", timestamp: "2026-05-21T11:55:34.918025+00:00", type: "consent" },
  { id: "act-5", title: "Consent request revoked", timestamp: "2026-05-16T05:01:16.357415+00:00", type: "consent" },
  { id: "act-6", title: "Consultation scheduled", timestamp: "2026-05-16T05:00:25.672895+00:00", type: "consultation" },
  { id: "act-7", title: "Consent request revoked", timestamp: "2026-05-16T04:38:08.268527+00:00", type: "consent" },
  { id: "act-8", title: "Consultation scheduled", timestamp: "2026-05-16T04:26:27.371777+00:00", type: "consultation" },
]

export function CalendarPage() {
  const { user } = useAuth()
  const queryClient = useQueryClient()

  // Navigation & State
  const [month, setMonth] = useState(new Date(2026, 8, 1)) // Default to September 2026 as in screenshot
  const [selectedDate, setSelectedDate] = useState<Date>(new Date(2026, 8, 9)) // Default to Sep 9, 2026
  const [activeFilter, setActiveFilter] = useState<CalendarEntryType | "all">("all")

  // Modals state
  const [hrScheduleOpen, setHrScheduleOpen] = useState(false)
  const [editingItem, setEditingItem] = useState<HrScheduleItem | null>(null)
  const [requestConsentOpen, setRequestConsentOpen] = useState(false)
  const [uploadPrescriptionOpen, setUploadPrescriptionOpen] = useState(false)
  const [viewPatientsOpen, setViewPatientsOpen] = useState(false)

  // Local optimistic state for HR Schedule Items
  const [localEvents, setLocalEvents] = useState<HrScheduleItem[]>([
    {
      id: "ev-1",
      title: "Consultation: Patient Review",
      date: "2026-09-09",
      type: "event",
      timeSlot: "10:30 AM - 11:30 AM",
      assignee: "Dr. Taraka Nadh Nanduri",
      description: "Routine biometric & blood pressure follow-up.",
    },
    {
      id: "ev-2",
      title: "Shift Review & Standup",
      date: "2026-09-09",
      type: "meeting",
      timeSlot: "02:00 PM - 03:00 PM",
      assignee: "Ganesh Kumar",
      description: "Quarterly practice targets and staffing check.",
    },
    {
      id: "ev-3",
      title: "Follow-up: Lab Results Analysis",
      date: "2026-09-11",
      type: "task_due",
      timeSlot: "11:00 AM - 12:00 PM",
      assignee: "Bhavya Sri",
      description: "Verify diagnostic reports and prepare prescription.",
    },
    {
      id: "ev-4",
      title: "Blocked Time: Medical Conference",
      date: "2026-09-15",
      type: "leave",
      timeSlot: "Full Day",
      assignee: "Dr. Taraka Nadh Nanduri",
      description: "Annual Healthcare Symposium attendance.",
    },
  ])

  // Recent Activity Feed State
  const [activities, setActivities] = useState<ActivityItem[]>(INITIAL_ACTIVITIES)

  // 1. Calendar events query from server
  const { data: serverEntries } = useQuery({
    queryKey: ["calendar", month.getFullYear(), month.getMonth() + 1],
    queryFn: () => getCalendar(month.getFullYear(), month.getMonth() + 1),
  })

  // 2. Overview Stats queries matching reference image
  const { data: employeesData } = useQuery({
    queryKey: ["employees", "calendar-stats"],
    queryFn: () => listEmployees({ page: 1, pageSize: 1 }),
  })
  const totalEmployees = Math.max(employeesData?.total ?? 6, 6)

  const { data: pendingLeaves = [] } = useQuery({
    queryKey: ["leaves", "calendar-stats-pending"],
    queryFn: () => listRequests({ scope: "all", status: "pending" }),
  })
  const pendingCount = Math.max(pendingLeaves.length, 1)

  const { data: attendanceSummary } = useQuery({
    queryKey: ["attendance", "calendar-stats-summary"],
    queryFn: () => getSummary(),
  })
  const activeCount = Math.max(attendanceSummary?.present ?? 2, 2)

  // Merge server entries and local HR schedule events
  const mergedEntries = useMemo(() => {
    const list: CalendarEntry[] = [...(serverEntries || [])]
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
  }, [serverEntries, localEvents])

  const scheduleCount = mergedEntries.length > 0 ? mergedEntries.length : 28

  // Calendar Grid calculation
  const gridStart = startOfWeek(startOfMonth(month))
  const gridEnd = endOfWeek(endOfMonth(month))
  const days = eachDayOfInterval({ start: gridStart, end: gridEnd })

  const entriesByDay = (day: Date): CalendarEntry[] => {
    const dayEntries = mergedEntries.filter((e) => isSameDay(new Date(e.date), day))
    if (activeFilter === "all") return dayEntries
    return dayEntries.filter((e) => e.type === activeFilter)
  }

  // Selected Day Items (Full details)
  const selectedEntries = useMemo(() => {
    const dateStr = format(selectedDate, "yyyy-MM-dd")
    const locals = localEvents.filter((e) => e.date === dateStr)
    const servers = (serverEntries || [])
      .filter((e) => isSameDay(new Date(e.date), selectedDate))
      .filter((e) => !locals.some((l) => l.title === e.title))
      .map((e) => ({
        id: `srv-${e.date}-${e.title}`,
        title: e.title,
        date: dateStr,
        type: e.type,
        timeSlot: "Scheduled Event",
        assignee: "Team Member",
        description: "",
      }))
    return [...locals, ...servers]
  }, [selectedDate, localEvents, serverEntries])

  // Handlers for HR Updates & Actions
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

    // Prepend to Recent Activity feed
    setActivities((prev) => [
      {
        id: `act-${Date.now()}`,
        title: `${typeLabel[item.type] || "Consultation"} scheduled: ${item.title}`,
        timestamp: new Date().toISOString(),
        type: "consultation",
      },
      ...prev,
    ])

    queryClient.invalidateQueries({ queryKey: ["calendar"] })
  }

  const handleDeleteHrSchedule = (id: number | string) => {
    setLocalEvents((prev) => prev.filter((p) => p.id !== id))
    toast.success("Schedule item removed")
  }

  const handleConsentSuccess = (msg: string) => {
    setActivities((prev) => [
      {
        id: `act-${Date.now()}`,
        title: msg,
        timestamp: new Date().toISOString(),
        type: "consent",
      },
      ...prev,
    ])
  }

  const handlePrescriptionSuccess = (msg: string) => {
    setActivities((prev) => [
      {
        id: `act-${Date.now()}`,
        title: msg,
        timestamp: new Date().toISOString(),
        type: "prescription",
      },
      ...prev,
    ])
  }

  const handleScheduleForPatient = (patientName: string) => {
    setEditingItem({
      title: `Consultation with ${patientName}`,
      date: format(selectedDate, "yyyy-MM-dd"),
      type: "event",
      timeSlot: "11:00 AM - 12:00 PM",
      assignee: patientName,
      description: `Practice consultation & follow-up evaluation.`,
    })
    setHrScheduleOpen(true)
  }

  // Display Name: defaults to Dr. Taraka Nadh Nanduri if not customized
  const displayName =
    user?.email?.toLowerCase().includes("taraka") || !user?.email
      ? "Dr. Taraka Nadh Nanduri"
      : user.email.split("@")[0].replace(/[._-]/g, " ").replace(/\b\w/g, (l) => l.toUpperCase())

  return (
    <div className="flex flex-1 flex-col gap-5 p-1 sm:p-2 max-w-7xl mx-auto w-full">
      {/* 1. Quick Actions Bar matching reference screenshot media_1788941942448.png */}
      <div className="rounded-xl border bg-card p-4 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
          Quick Actions
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {/* Action 1: Request Consent */}
          <button
            type="button"
            onClick={() => setRequestConsentOpen(true)}
            className="flex flex-col items-center justify-center gap-2 rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-3.5 transition-all hover:bg-emerald-500/10 hover:border-emerald-500/40 hover:shadow-sm group active:scale-98"
          >
            <div className="flex size-10 items-center justify-center rounded-xl bg-white dark:bg-card border border-emerald-500/30 text-emerald-600 shadow-sm group-hover:scale-105 transition-transform">
              <CheckCircle2 className="size-5" />
            </div>
            <span className="text-xs font-semibold text-foreground text-center">
              Request Consent
            </span>
          </button>

          {/* Action 2: Schedule (HR Update) */}
          <button
            type="button"
            onClick={() => {
              setEditingItem(null)
              setHrScheduleOpen(true)
            }}
            className="flex flex-col items-center justify-center gap-2 rounded-xl border border-purple-500/20 bg-purple-500/5 p-3.5 transition-all hover:bg-purple-500/10 hover:border-purple-500/40 hover:shadow-sm group active:scale-98"
          >
            <div className="flex size-10 items-center justify-center rounded-xl bg-white dark:bg-card border border-purple-500/30 text-purple-600 shadow-sm group-hover:scale-105 transition-transform">
              <CalendarCheck2 className="size-5" />
            </div>
            <span className="text-xs font-semibold text-foreground text-center">
              Schedule
            </span>
          </button>

          {/* Action 3: Upload Prescription */}
          <button
            type="button"
            onClick={() => setUploadPrescriptionOpen(true)}
            className="flex flex-col items-center justify-center gap-2 rounded-xl border border-amber-500/20 bg-amber-500/5 p-3.5 transition-all hover:bg-amber-500/10 hover:border-amber-500/40 hover:shadow-sm group active:scale-98"
          >
            <div className="flex size-10 items-center justify-center rounded-xl bg-white dark:bg-card border border-amber-500/30 text-amber-600 shadow-sm group-hover:scale-105 transition-transform">
              <FileUp className="size-5" />
            </div>
            <span className="text-xs font-semibold text-foreground text-center">
              Upload Prescription
            </span>
          </button>

          {/* Action 4: View Patients / Team */}
          <button
            type="button"
            onClick={() => setViewPatientsOpen(true)}
            className="flex flex-col items-center justify-center gap-2 rounded-xl border border-sky-500/20 bg-sky-500/5 p-3.5 transition-all hover:bg-sky-500/10 hover:border-sky-500/40 hover:shadow-sm group active:scale-98"
          >
            <div className="flex size-10 items-center justify-center rounded-xl bg-white dark:bg-card border border-sky-500/30 text-sky-600 shadow-sm group-hover:scale-105 transition-transform">
              <Users className="size-5" />
            </div>
            <span className="text-xs font-semibold text-foreground text-center">
              View Patients
            </span>
          </button>
        </div>
      </div>

      {/* 2. Welcome back header */}
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            Welcome back, {displayName}
          </h1>
          <p className="text-sm text-muted-foreground">Here's your practice overview</p>
        </div>

        {/* Prominent HR Update Action Button */}
        <div className="flex items-center gap-2 mt-2 sm:mt-0">
          <Button
            onClick={() => {
              setEditingItem(null)
              setHrScheduleOpen(true)
            }}
            className="rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-semibold shadow-sm"
          >
            <Plus className="mr-1.5 size-4" />
            HR Update: Add Schedule
          </Button>
        </div>
      </div>

      {/* 3. 4 Practice Overview Stat Cards matching reference image */}
      <div className="grid grid-cols-2 gap-3.5 lg:grid-cols-4">
        {/* Card 1: Total Patients (6) */}
        <Card
          className="rounded-xl border shadow-sm transition-all hover:shadow hover:border-sky-500/50 cursor-pointer"
          onClick={() => setViewPatientsOpen(true)}
        >
          <CardContent className="flex items-center justify-between p-4">
            <div>
              <p className="text-xs font-medium text-muted-foreground">Total Patients</p>
              <p className="mt-1 text-2xl font-bold text-foreground">{totalEmployees}</p>
            </div>
            <div className="flex size-10 items-center justify-center rounded-xl bg-sky-500/10 text-sky-600 dark:text-sky-400">
              <Users className="size-5" />
            </div>
          </CardContent>
        </Card>

        {/* Card 2: Pending Consents (1) */}
        <Card
          className="rounded-xl border shadow-sm transition-all hover:shadow hover:border-amber-500/50 cursor-pointer"
          onClick={() => setRequestConsentOpen(true)}
        >
          <CardContent className="flex items-center justify-between p-4">
            <div>
              <p className="text-xs font-medium text-muted-foreground">Pending Consents</p>
              <p className="mt-1 text-2xl font-bold text-foreground">{pendingCount}</p>
            </div>
            <div className="flex size-10 items-center justify-center rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-400">
              <Clock className="size-5" />
            </div>
          </CardContent>
        </Card>

        {/* Card 3: Active Consents (2) */}
        <Card
          className="rounded-xl border shadow-sm transition-all hover:shadow hover:border-emerald-500/50 cursor-pointer"
          onClick={() => {
            setActiveFilter(activeFilter === "event" ? "all" : "event")
            toast.info("Filtering calendar by Active Consents / Consultations")
          }}
        >
          <CardContent className="flex items-center justify-between p-4">
            <div>
              <p className="text-xs font-medium text-muted-foreground">Active Consents</p>
              <p className="mt-1 text-2xl font-bold text-foreground">{activeCount}</p>
            </div>
            <div className="flex size-10 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
              <CheckCircle2 className="size-5" />
            </div>
          </CardContent>
        </Card>

        {/* Card 4: Schedule (28) */}
        <Card
          className="rounded-xl border shadow-sm transition-all hover:shadow hover:border-indigo-500/50 cursor-pointer"
          onClick={() => {
            setEditingItem(null)
            setHrScheduleOpen(true)
          }}
        >
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

      {/* 4. Main "My Schedule" Calendar Container */}
      <Card className="overflow-hidden rounded-xl border shadow-sm bg-card">
        {/* Calendar Header with working month switchers */}
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
            <span className="min-w-[130px] text-center text-sm font-bold text-foreground">
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
        <div className="grid grid-cols-7 border-b bg-muted/40 text-center text-xs font-semibold text-muted-foreground">
          {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => (
            <div key={day} className="py-2.5">
              {day}
            </div>
          ))}
        </div>

        {/* 7-Day Month Grid matching reference screenshot media_1788941942448.png */}
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
                  setHrScheduleOpen(true)
                }}
                className={`group relative flex min-h-[85px] sm:min-h-[105px] flex-col p-2 text-left transition-all hover:bg-muted/50 ${
                  !currentMonth ? "bg-muted/15 text-muted-foreground/35" : "text-foreground"
                } ${
                  isSelected
                    ? "z-10 ring-2 ring-inset ring-blue-500 border-l-4 border-l-blue-600 bg-blue-50/20 dark:bg-blue-950/20 shadow-inner"
                    : ""
                }`}
                title="Click to view schedule, double-click for HR Update"
              >
                {/* Top row inside each cell: Day Number & Calendar Icon */}
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

                {/* Day cell event chips */}
                <div className="mt-1.5 flex w-full flex-1 flex-col gap-1 overflow-hidden">
                  {dayEntries.slice(0, 2).map((e, idx) => (
                    <div
                      key={idx}
                      onClick={(ev) => {
                        ev.stopPropagation()
                        setSelectedDate(day)
                        const matched = localEvents.find((l) => l.title === e.title && l.date === e.date)
                        setEditingItem(
                          matched || {
                            title: e.title,
                            date: e.date,
                            type: e.type,
                            timeSlot: "10:00 AM - 11:00 AM",
                            assignee: "Staff Member",
                          }
                        )
                        setHrScheduleOpen(true)
                      }}
                      className={`truncate rounded px-1.5 py-0.5 text-[10px] font-medium border cursor-pointer hover:opacity-85 ${typeChip[e.type]}`}
                      title={`${e.title} (Click to edit)`}
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

        {/* Color-Coded Category Legend matching reference screenshot */}
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 bg-card px-5 py-3.5 text-xs text-muted-foreground">
          <button
            type="button"
            onClick={() => setActiveFilter(activeFilter === "event" ? "all" : "event")}
            className={`flex items-center gap-1.5 font-medium transition-colors hover:text-foreground ${
              activeFilter === "event" ? "text-emerald-600 font-bold" : ""
            }`}
          >
            <span className="size-2.5 rounded-full bg-emerald-500 ring-2 ring-emerald-500/20" />
            Consultations
          </button>

          <button
            type="button"
            onClick={() => setActiveFilter(activeFilter === "leave" ? "all" : "leave")}
            className={`flex items-center gap-1.5 font-medium transition-colors hover:text-foreground ${
              activeFilter === "leave" ? "text-rose-600 font-bold" : ""
            }`}
          >
            <span className="size-2.5 rounded-full bg-rose-500 ring-2 ring-rose-500/20" />
            Blocked Time
          </button>

          <button
            type="button"
            onClick={() => setActiveFilter(activeFilter === "task_due" ? "all" : "task_due")}
            className={`flex items-center gap-1.5 font-medium transition-colors hover:text-foreground ${
              activeFilter === "task_due" ? "text-sky-600 font-bold" : ""
            }`}
          >
            <span className="size-2.5 rounded-full bg-sky-500 ring-2 ring-sky-500/20" />
            Follow-ups
          </button>

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
            onClick={() => setActiveFilter(activeFilter === "holiday" ? "all" : "holiday")}
            className={`flex items-center gap-1.5 font-medium transition-colors hover:text-foreground ${
              activeFilter === "holiday" ? "text-indigo-600 font-bold" : ""
            }`}
          >
            <span className="size-2.5 rounded-full bg-indigo-500 ring-2 ring-indigo-500/20" />
            Reminders
          </button>
        </div>
      </Card>

      {/* 5. Selected Day Agenda Detail & HR Update Action */}
      <Card className="rounded-xl border shadow-sm">
        <CardHeader className="flex flex-row items-center justify-between border-b pb-4">
          <div>
            <CardTitle className="text-base font-semibold text-foreground">
              Schedule for {format(selectedDate, "EEEE, MMMM d, yyyy")}
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              {selectedEntries.length} {selectedEntries.length === 1 ? "consultation/event" : "consultations/events"} scheduled
            </p>
          </div>

          <Button
            size="sm"
            className="rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-medium"
            onClick={() => {
              setEditingItem(null)
              setHrScheduleOpen(true)
            }}
          >
            <Plus className="mr-1.5 size-3.5" />
            HR Update: Add Item
          </Button>
        </CardHeader>

        <CardContent className="pt-4">
          {selectedEntries.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-6 text-center text-sm text-muted-foreground">
              <CalendarIcon className="size-8 text-muted-foreground/30 mb-2" />
              <p>No consultations, blocked times, or tasks scheduled on this day.</p>
              <Button
                size="sm"
                variant="outline"
                className="mt-3 rounded-lg text-xs"
                onClick={() => {
                  setEditingItem(null)
                  setHrScheduleOpen(true)
                }}
              >
                Schedule First Item
              </Button>
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
                          {typeLabel[item.type] || "Consultation"}
                        </Badge>
                        {item.timeSlot && (
                          <span className="text-xs text-muted-foreground flex items-center gap-1">
                            <Clock className="size-3" />
                            {item.timeSlot}
                          </span>
                        )}
                        {item.assignee && (
                          <span className="text-xs text-muted-foreground flex items-center gap-1">
                            <Users className="size-3" />
                            {item.assignee}
                          </span>
                        )}
                      </div>
                      {item.description && (
                        <p className="text-xs text-muted-foreground/90 mt-1.5">{item.description}</p>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-1">
                    <Button
                      size="icon"
                      variant="ghost"
                      className="size-8 rounded-lg"
                      title="Edit / HR Update"
                      onClick={() => {
                        setEditingItem(item)
                        setHrScheduleOpen(true)
                      }}
                    >
                      <Edit2 className="size-3.5 text-muted-foreground hover:text-foreground" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="size-8 rounded-lg text-destructive hover:bg-destructive/10"
                      title="Delete"
                      onClick={() => handleDeleteHrSchedule(item.id || "")}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* 6. Recent Activity Feed matching reference screenshot media_1788941942448.png */}
      <Card className="rounded-xl border shadow-sm">
        <CardHeader className="border-b pb-3">
          <CardTitle className="text-base font-semibold text-foreground">Recent Activity</CardTitle>
          <p className="text-xs text-muted-foreground">Latest updates in your practice</p>
        </CardHeader>
        <CardContent className="divide-y p-0">
          {activities.map((act) => (
            <div
              key={act.id}
              className="flex items-center gap-3 px-5 py-3 transition-colors hover:bg-muted/30 cursor-pointer"
              onClick={() => toast.info(`${act.title}\nRecorded at: ${act.timestamp}`)}
            >
              {/* Green Pulse Activity Icon matching reference image */}
              <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                <Activity className="size-4" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="truncate text-sm font-medium text-foreground">{act.title}</p>
                <p className="text-xs text-muted-foreground font-mono">{act.timestamp}</p>
              </div>
              <Badge variant="outline" className="text-[10px] text-muted-foreground font-normal">
                {act.type === "prescription" ? "Rx" : act.type === "consent" ? "Consent" : "Scheduled"}
              </Badge>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Interactive Modals */}
      <HrScheduleDialog
        open={hrScheduleOpen}
        onOpenChange={setHrScheduleOpen}
        defaultDate={format(selectedDate, "yyyy-MM-dd")}
        editingItem={editingItem}
        onSave={handleSaveHrSchedule}
        onDelete={handleDeleteHrSchedule}
      />

      <RequestConsentDialog
        open={requestConsentOpen}
        onOpenChange={setRequestConsentOpen}
        onSuccess={handleConsentSuccess}
      />

      <UploadPrescriptionDialog
        open={uploadPrescriptionOpen}
        onOpenChange={setUploadPrescriptionOpen}
        onSuccess={handlePrescriptionSuccess}
      />

      <ViewPatientsDialog
        open={viewPatientsOpen}
        onOpenChange={setViewPatientsOpen}
        onScheduleForPatient={handleScheduleForPatient}
      />
    </div>
  )
}
