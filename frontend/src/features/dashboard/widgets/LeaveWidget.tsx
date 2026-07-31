import { useQuery } from "@tanstack/react-query"
import { useNavigate } from "react-router-dom"
import { format, addMonths } from "date-fns"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { getBalance, listRequests } from "@/features/leaves/api"
import { getCalendar } from "@/features/calendar/api"

export function LeaveWidget({ onApplyLeave }: { onApplyLeave: () => void }) {
  const navigate = useNavigate()
  const now = new Date()
  const nextMonth = addMonths(now, 1)

  const { data: balances } = useQuery({ queryKey: ["leaves", "balance"], queryFn: getBalance })
  const { data: myRequests } = useQuery({
    queryKey: ["leaves", "requests", "mine"],
    queryFn: () => listRequests({ scope: "mine" }),
  })

  const { data: calendarThis } = useQuery({
    queryKey: ["calendar", "dashboard", now.getFullYear(), now.getMonth() + 1],
    queryFn: () => getCalendar(now.getFullYear(), now.getMonth() + 1),
  })
  const { data: calendarNext } = useQuery({
    queryKey: ["calendar", "dashboard", nextMonth.getFullYear(), nextMonth.getMonth() + 1],
    queryFn: () => getCalendar(nextMonth.getFullYear(), nextMonth.getMonth() + 1),
  })

  const todayStr = format(now, "yyyy-MM-dd")
  const upcomingHolidays = [...(calendarThis ?? []), ...(calendarNext ?? [])]
    .filter((e) => e.type === "holiday" && e.date >= todayStr)
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, 4)

  const remainingLeaves = balances?.reduce((sum, b) => sum + b.remainingDays, 0) ?? 0
  const appliedDays =
    myRequests?.filter((r) => r.status !== "rejected").reduce((sum, r) => sum + r.daysCount, 0) ?? 0
  const pendingCount = myRequests?.filter((r) => r.status === "pending").length ?? 0

  return (
    <Card className="rounded-md border shadow-none">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base">Leaves</CardTitle>
        <Button variant="ghost" size="sm" className="rounded-md" onClick={() => navigate("/leaves")}>
          View all
        </Button>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="rounded-md bg-muted/50 py-2">
            <p className="text-lg font-semibold text-foreground">{remainingLeaves}</p>
            <p className="text-[11px] text-muted-foreground">Available</p>
          </div>
          <div className="rounded-md bg-muted/50 py-2">
            <p className="text-lg font-semibold text-foreground">{appliedDays}</p>
            <p className="text-[11px] text-muted-foreground">Applied</p>
          </div>
          <div className="rounded-md bg-muted/50 py-2">
            <p className="text-lg font-semibold text-foreground">{pendingCount}</p>
            <p className="text-[11px] text-muted-foreground">Pending</p>
          </div>
        </div>

        {upcomingHolidays.length > 0 && (
          <div>
            <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Upcoming Holidays
            </p>
            <div className="flex flex-col gap-1">
              {upcomingHolidays.map((h, i) => (
                <div key={i} className="flex items-center justify-between text-xs">
                  <span className="truncate text-foreground">{h.title}</span>
                  <span className="shrink-0 text-muted-foreground">{format(new Date(h.date), "MMM d")}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        <Button size="sm" className="rounded-md" onClick={onApplyLeave}>
          Apply Leave
        </Button>
      </CardContent>
    </Card>
  )
}
