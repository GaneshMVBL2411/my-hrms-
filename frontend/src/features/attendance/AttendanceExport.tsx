import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { Download, Loader2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { downloadAttendanceReport } from "@/features/attendance/api"
import { listEmployees } from "@/features/employees/api"

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
]

/** "All employees" as a select value — a sentinel, because a Select needs a string. */
const EVERYONE = "all"

/**
 * The attendance export, for whichever month someone needs it for.
 *
 * HR gets the employee picker as well, and with it the three reports people
 * actually ask for: one person's month, everyone's month side by side, and
 * every day of it. They are one workbook with three sheets rather than three
 * downloads, because the totals only make sense next to the days that produce
 * them.
 */
export function AttendanceExport({ scope, employeeId }: { scope: "mine" | "team"; employeeId?: number | null }) {
  const now = new Date()
  const [month, setMonth] = useState(now.getMonth() + 1)
  const [year, setYear] = useState(now.getFullYear())
  const [who, setWho] = useState<string>(EVERYONE)
  const [busy, setBusy] = useState(false)

  const { data: employees } = useQuery({
    queryKey: ["employees", "all"],
    queryFn: () => listEmployees({ page: 1, pageSize: 500 }),
    enabled: scope === "team",
  })

  const download = async () => {
    setBusy(true)
    try {
      const target = scope === "mine" ? employeeId ?? null : who === EVERYONE ? null : Number(who)
      const name =
        scope === "team" && who !== EVERYONE
          ? employees?.items.find((e) => e.id === Number(who))?.fullName
          : undefined
      await downloadAttendanceReport({ month, year, employeeId: target, filename: name })
      toast.success(`${MONTHS[month - 1]} ${year} attendance downloaded`)
    } catch (error) {
      toast.error((error as Error).message || "Could not build the report")
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card className="rounded-xl border shadow-xs">
      <CardContent className="flex flex-wrap items-end gap-3 py-4">
        <div className="flex flex-col gap-1.5">
          <span className="text-xs text-muted-foreground">Month</span>
          <Select value={String(month)} onValueChange={(v) => setMonth(Number(v))}>
            <SelectTrigger className="w-36 rounded-md">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MONTHS.map((m, i) => (
                <SelectItem key={m} value={String(i + 1)}>
                  {m}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-1.5">
          <span className="text-xs text-muted-foreground">Year</span>
          <Select value={String(year)} onValueChange={(v) => setYear(Number(v))}>
            <SelectTrigger className="w-28 rounded-md">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[now.getFullYear() - 1, now.getFullYear(), now.getFullYear() + 1].map((y) => (
                <SelectItem key={y} value={String(y)}>
                  {y}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {scope === "team" && (
          <div className="flex flex-col gap-1.5">
            <span className="text-xs text-muted-foreground">Employees</span>
            <Select value={who} onValueChange={setWho}>
              <SelectTrigger className="w-64 rounded-md">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={EVERYONE}>All employees</SelectItem>
                {employees?.items.map((e) => (
                  <SelectItem key={e.id} value={String(e.id)}>
                    {e.fullName} · {e.employeeCode}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        <Button className="rounded-md" disabled={busy} onClick={download}>
          {busy ? <Loader2 className="mr-2 size-4 animate-spin" /> : <Download className="mr-2 size-4" />}
          Download Excel
        </Button>

        <p className="w-full text-xs text-muted-foreground sm:w-auto sm:flex-1 sm:text-right">
          Summary, day by day, and the month's holidays — office hours 09:30 AM to 06:30 PM.
        </p>
      </CardContent>
    </Card>
  )
}
