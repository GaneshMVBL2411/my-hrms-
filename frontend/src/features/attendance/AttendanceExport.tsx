import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { Download, Loader2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { downloadAttendanceReport, previewAttendance } from "@/features/attendance/api"
import { AttendancePreviewTable } from "@/features/attendance/AttendancePreviewTable"
import { inAppShell } from "@/lib/appShell"
import { EmployeePicker } from "@/features/attendance/EmployeePicker"
import { listBranches, listDepartments, listEmployees } from "@/features/employees/api"

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
]

/** "2026-09-16" for a Date, in local time — toISOString would shift the day. */
function iso(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`
}

function monthStart(date: Date): string {
  return iso(new Date(date.getFullYear(), date.getMonth(), 1))
}

function monthEnd(date: Date): string {
  return iso(new Date(date.getFullYear(), date.getMonth() + 1, 0))
}

/** "August 2026", "10–20 August 2026", "17 August 2026" — the same names the sheet uses. */
function periodLabel(from: string, to: string): string {
  if (!from || !to || from > to) return "—"
  const day = (d: string) => String(Number(d.slice(8, 10)))
  const month = (d: string) => MONTHS[Number(d.slice(5, 7)) - 1]
  const year = (d: string) => d.slice(0, 4)
  if (from === to) return `${day(from)} ${month(from)} ${year(from)}`
  if (from.slice(0, 7) === to.slice(0, 7)) {
    const whole = from.slice(8, 10) === "01" && to === monthEnd(new Date(`${from}T00:00:00`))
    return whole ? `${month(from)} ${year(from)}` : `${day(from)}–${day(to)} ${month(from)} ${year(from)}`
  }
  return `${day(from)} ${month(from)} – ${day(to)} ${month(to)} ${year(to)}`
}

/** "Everything" as a select value — a sentinel, because a Select needs a string. */
const ALL = "all"

/**
 * The attendance export, for whichever month and whichever people.
 *
 * HR gets a department filter and a multiple-choice employee picker, because
 * "one or all" is not how the question arrives: it is usually a handful of
 * people, or one team. Whatever is picked, the workbook is the same three
 * sheets — summary, day by day, holidays — since the totals only mean
 * anything next to the days that produce them.
 */
export function AttendanceExport({ scope, employeeId }: { scope: "mine" | "team"; employeeId?: number | null }) {
  const now = new Date()
  // Defaults to this month, which is what most exports are; either end can
  // then be moved to any day, including onto the other to get a single one.
  const [from, setFrom] = useState(() => monthStart(now))
  const [to, setTo] = useState(() => monthEnd(now))
  const [department, setDepartment] = useState<string>(ALL)
  const [branch, setBranch] = useState<string>(ALL)
  const [picked, setPicked] = useState<number[]>([])
  const [busy, setBusy] = useState(false)

  const { data: employees } = useQuery({
    queryKey: ["employees", "all"],
    queryFn: () => listEmployees({ page: 1, pageSize: 500 }),
    enabled: scope === "team",
  })

  const { data: departments } = useQuery({
    queryKey: ["departments"],
    queryFn: listDepartments,
    enabled: scope === "team",
  })

  const { data: branches } = useQuery({
    queryKey: ["branches"],
    queryFn: listBranches,
    enabled: scope === "team",
  })

  // The picker lists the department's people once one is chosen, so the two
  // controls read as one narrowing rather than as two competing filters.
  const inDepartment = (employees?.items ?? [])
    .filter((e) => department === ALL || e.departmentId === Number(department))
    .filter((e) => branch === ALL || e.branchId === Number(branch))

  const departmentName = departments?.find((d) => d.id === Number(department))?.name
  const branchName = branches?.find((b) => b.id === Number(branch))?.name

  // The same request the download will make, read as JSON so the numbers can
  // be checked before a file is asked for. Re-runs on every change of dates
  // or selection, which is what makes it a preview rather than a report.
  const selection = {
    from,
    to,
    employeeIds: scope === "mine" ? (employeeId ? [employeeId] : []) : picked,
    departmentId: scope === "mine" || department === ALL ? null : Number(department),
    branchId: scope === "mine" || branch === ALL ? null : Number(branch),
  }
  const valid = Boolean(from && to && from <= to)
  const {
    data: preview,
    isFetching: previewing,
    error: previewError,
  } = useQuery({
    queryKey: ["attendance", "preview", selection],
    queryFn: () => previewAttendance(selection),
    enabled: valid && (scope === "team" || Boolean(employeeId)),
    // A 403 or an empty selection is an answer, not a blip worth retrying.
    retry: false,
    placeholderData: (previous) => previous,
  })

  const download = async () => {
    if (!from || !to || from > to) {
      toast.error("Pick a start date on or before the end date")
      return
    }
    setBusy(true)
    try {
      if (scope === "mine") {
        await downloadAttendanceReport({
          from,
          to,
          employeeIds: employeeId ? [employeeId] : [],
          filename: "Mine",
        })
      } else {
        const name =
          picked.length === 1
            ? inDepartment.find((e) => e.id === picked[0])?.fullName
            : picked.length > 1
              ? `${picked.length}_Employees`
              : departmentName ?? branchName ?? "All_Employees"
        await downloadAttendanceReport({
          from,
          to,
          employeeIds: picked,
          departmentId: department === ALL ? null : Number(department),
          branchId: branch === ALL ? null : Number(branch),
          filename: [name, branchName && name !== branchName ? branchName : null].filter(Boolean).join("_"),
        })
      }
      // In the app the file is saved by the app, which says so itself when it
      // lands. Claiming it here produced the exact bug this fixes: a green
      // "downloaded" and no file anywhere on the phone.
      const period = periodLabel(from, to)
      toast.success(
        inAppShell() ? `${period} attendance — saving to your phone…` : `${period} attendance downloaded`
      )
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
          <span className="text-xs text-muted-foreground">From</span>
          <Input
            type="date"
            value={from}
            max={to || undefined}
            onChange={(e) => setFrom(e.target.value)}
            className="w-40 rounded-md"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <span className="text-xs text-muted-foreground">To</span>
          <Input
            type="date"
            value={to}
            min={from || undefined}
            onChange={(e) => setTo(e.target.value)}
            className="w-40 rounded-md"
          />
        </div>

        {/* The whole-month case is most of them, so it stays one tap. */}
        <div className="flex flex-col gap-1.5">
          <span className="text-xs text-muted-foreground">Quick</span>
          <div className="flex gap-1">
            <Button
              variant="outline"
              className="rounded-md"
              onClick={() => {
                setFrom(monthStart(now))
                setTo(monthEnd(now))
              }}
            >
              This month
            </Button>
            <Button
              variant="outline"
              className="rounded-md"
              onClick={() => {
                const last = new Date(now.getFullYear(), now.getMonth() - 1, 1)
                setFrom(monthStart(last))
                setTo(monthEnd(last))
              }}
            >
              Last month
            </Button>
          </div>
        </div>

        {scope === "team" && (
          <>
            <div className="flex flex-col gap-1.5">
              <span className="text-xs text-muted-foreground">Office</span>
              <Select
                value={branch}
                onValueChange={(v) => {
                  setBranch(v)
                  setPicked([])
                }}
              >
                <SelectTrigger className="w-44 rounded-md">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>All offices</SelectItem>
                  {branches?.map((b) => (
                    <SelectItem key={b.id} value={String(b.id)}>
                      {b.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-1.5">
              <span className="text-xs text-muted-foreground">Department</span>
              <Select
                value={department}
                onValueChange={(v) => {
                  setDepartment(v)
                  // Names ticked in another department would silently widen
                  // the report past the one now showing.
                  setPicked([])
                }}
              >
                <SelectTrigger className="w-48 rounded-md">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>All departments</SelectItem>
                  {departments?.map((d) => (
                    <SelectItem key={d.id} value={String(d.id)}>
                      {d.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-1.5">
              <span className="text-xs text-muted-foreground">Employees</span>
              <EmployeePicker employees={inDepartment} selected={picked} onChange={setPicked} disabled={busy} />
            </div>
          </>
        )}

        <Button className="rounded-md" disabled={busy} onClick={download}>
          {busy ? <Loader2 className="mr-2 size-4 animate-spin" /> : <Download className="mr-2 size-4" />}
          Download Excel
        </Button>

        <p className="w-full text-xs text-muted-foreground sm:w-auto sm:flex-1 sm:text-right">
          <span className="font-medium text-foreground">{periodLabel(from, to)}</span> — summary, day by day, and
          the holidays in it. Office hours 09:30 AM to 06:30 PM.
          {scope === "team" && " Pick an office, a department, any number of people — or leave it on all."}
        </p>
      </CardContent>

      <CardContent className="border-t border-border pt-4">
        <AttendancePreviewTable
          preview={preview}
          loading={previewing}
          error={previewError as Error | null}
        />
      </CardContent>
    </Card>
  )
}
