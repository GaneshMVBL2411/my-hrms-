import { useQuery } from "@tanstack/react-query"
import { format } from "date-fns"
import { CalendarClock, Cake, Flag, PartyPopper, ListChecks, CalendarDays } from "lucide-react"
import type { LucideIcon } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { getCalendar } from "@/features/calendar/api"
import type { CalendarEntryType } from "@/features/calendar/types"

const typeIcon: Record<CalendarEntryType, LucideIcon> = {
  meeting: CalendarClock,
  event: PartyPopper,
  holiday: CalendarDays,
  leave: CalendarClock,
  task_due: ListChecks,
  project_deadline: Flag,
  birthday: Cake,
}

const typeLabel: Record<CalendarEntryType, string> = {
  meeting: "Meeting",
  event: "Event",
  holiday: "Holiday",
  leave: "Leave",
  task_due: "Task Due",
  project_deadline: "Deadline",
  birthday: "Birthday",
}

export function ScheduleWidget() {
  const now = new Date()
  const todayStr = format(now, "yyyy-MM-dd")

  const { data: entries, isLoading } = useQuery({
    queryKey: ["calendar", "dashboard", now.getFullYear(), now.getMonth() + 1],
    queryFn: () => getCalendar(now.getFullYear(), now.getMonth() + 1),
  })

  const todayEntries = (entries ?? []).filter((e) => e.date === todayStr)
  const upcoming = (entries ?? [])
    .filter((e) => e.date > todayStr)
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, 5)

  return (
    <Card className="rounded-md border shadow-none">
      <CardHeader>
        <CardTitle className="text-base">Today's Schedule</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
          {!isLoading && todayEntries.length === 0 && (
            <p className="text-sm text-muted-foreground">Nothing on your schedule today.</p>
          )}
          {todayEntries.map((entry, i) => {
            const Icon = typeIcon[entry.type]
            return (
              <div key={i} className="flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm">
                <Icon className="size-4 shrink-0 text-primary" />
                <span className="flex-1 text-foreground">{entry.title}</span>
                <Badge variant="outline">{typeLabel[entry.type]}</Badge>
              </div>
            )
          })}
        </div>

        {upcoming.length > 0 && (
          <div>
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Upcoming this month
            </p>
            <div className="flex flex-col gap-1.5">
              {upcoming.map((entry, i) => (
                <div key={i} className="flex items-center justify-between text-xs">
                  <span className="truncate text-foreground">{entry.title}</span>
                  <span className="shrink-0 text-muted-foreground">{format(new Date(entry.date), "MMM d")}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
