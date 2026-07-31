import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import {
  format,
  startOfMonth,
  endOfMonth,
  eachDayOfInterval,
  isWeekend,
  isFuture,
  startOfWeek,
  endOfWeek,
  isWithinInterval,
} from "date-fns"
import { LogIn, LogOut, Clock } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { checkIn, checkOut, getMyAttendance } from "@/features/attendance/api"
import type { AttendanceStatus } from "@/features/attendance/types"
import { errorMessage } from "@/lib/errors"

const statusColor: Record<AttendanceStatus, string> = {
  present: "bg-success",
  half_day: "bg-warning",
  on_leave: "bg-secondary",
  absent: "bg-danger",
}

function formatTime(value: string | null) {
  return value ? format(new Date(value), "hh:mm a") : "—"
}

function formatErrorDetail(error: unknown, fallback: string) {
  return errorMessage(error, fallback)
}

export function AttendanceWidget() {
  const queryClient = useQueryClient()
  const now = new Date()
  const todayStr = format(now, "yyyy-MM-dd")

  const { data: myAttendance } = useQuery({
    queryKey: ["attendance", "me", now.getFullYear(), now.getMonth() + 1],
    queryFn: () => getMyAttendance(now.getFullYear(), now.getMonth() + 1),
  })

  const today = myAttendance?.find((r) => r.date === todayStr)
  const byDate = new Map((myAttendance ?? []).map((r) => [r.date, r]))

  const weekStart = startOfWeek(now, { weekStartsOn: 1 })
  const weekEnd = endOfWeek(now, { weekStartsOn: 1 })
  const weekPresent = (myAttendance ?? []).filter(
    (r) =>
      (r.status === "present" || r.status === "half_day") &&
      isWithinInterval(new Date(r.date), { start: weekStart, end: weekEnd })
  ).length
  const monthPresent = (myAttendance ?? []).filter((r) => r.status === "present" || r.status === "half_day").length

  const checkInMutation = useMutation({
    mutationFn: checkIn,
    onSuccess: () => {
      toast.success("Checked in")
      queryClient.invalidateQueries({ queryKey: ["attendance"] })
    },
    onError: (error) => toast.error(formatErrorDetail(error, "Could not check in")),
  })

  const checkOutMutation = useMutation({
    mutationFn: checkOut,
    onSuccess: () => {
      toast.success("Checked out")
      queryClient.invalidateQueries({ queryKey: ["attendance"] })
    },
    onError: (error) => toast.error(formatErrorDetail(error, "Could not check out")),
  })

  const monthDays = eachDayOfInterval({ start: startOfMonth(now), end: endOfMonth(now) })

  return (
    <Card className="rounded-md border shadow-none">
      <CardHeader>
        <CardTitle className="text-base">Attendance</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-4 text-sm">
            <span className="flex items-center gap-1 text-foreground">
              <Clock className="size-4 text-muted-foreground" /> In: {formatTime(today?.checkIn ?? null)}
            </span>
            <span className="flex items-center gap-1 text-foreground">
              <Clock className="size-4 text-muted-foreground" /> Out: {formatTime(today?.checkOut ?? null)}
            </span>
          </div>
          <div className="flex gap-2">
            <Button
              size="sm"
              className="rounded-md"
              disabled={!!today?.checkIn || checkInMutation.isPending}
              onClick={() => checkInMutation.mutate()}
            >
              <LogIn className="mr-2 size-4" />
              Check In
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="rounded-md"
              disabled={!today?.checkIn || !!today?.checkOut || checkOutMutation.isPending}
              onClick={() => checkOutMutation.mutate()}
            >
              <LogOut className="mr-2 size-4" />
              Check Out
            </Button>
          </div>
        </div>

        <div className="flex items-center gap-4 text-xs text-muted-foreground">
          <span>
            This week: <b className="text-foreground">{weekPresent}</b> days present
          </span>
          <span>
            This month: <b className="text-foreground">{monthPresent}</b> days present
          </span>
        </div>

        <div>
          <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {format(now, "MMMM")} overview
          </p>
          <div className="flex flex-wrap gap-1">
            {monthDays.map((day) => {
              const key = format(day, "yyyy-MM-dd")
              const record = byDate.get(key)
              const future = isFuture(day) && key !== todayStr
              const colorClass = future
                ? "bg-muted"
                : record
                  ? statusColor[record.status]
                  : "bg-muted"
              const label = record
                ? record.status.replace("_", " ")
                : future
                  ? "Upcoming"
                  : isWeekend(day)
                    ? "Weekend"
                    : "No record"
              return (
                <Tooltip key={key}>
                  <TooltipTrigger asChild>
                    <div className={`size-3.5 rounded-sm ${colorClass}`} />
                  </TooltipTrigger>
                  <TooltipContent>
                    {format(day, "MMM d")}: {label}
                  </TooltipContent>
                </Tooltip>
              )
            })}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
