import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { Download, Loader2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { downloadAttendanceReport } from "@/features/attendance/api"
import { inAppShell } from "@/lib/appShell"
import { EmployeePicker } from "@/features/attendance/EmployeePicker"
import { listBranches, listDepartments, listEmployees } from "@/features/employees/api"

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
]

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
  const [month, setMonth] = useState(now.getMonth() + 1)
  const [year, setYear] = useState(now.getFullYear())
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

  const download = async () => {
    setBusy(true)
    try {
      if (scope === "mine") {
        await downloadAttendanceReport({
          month,
          year,
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
          month,
          year,
          employeeIds: picked,
          departmentId: department === ALL ? null : Number(department),
          branchId: branch === ALL ? null : Number(branch),
          filename: [name, branchName && name !== branchName ? branchName : null].filter(Boolean).join("_"),
        })
      }
      // In the app the file is saved by the app, which says so itself when it
      // lands. Claiming it here produced the exact bug this fixes: a green
      // "downloaded" and no file anywhere on the phone.
      toast.success(
        inAppShell()
          ? `${MONTHS[month - 1]} ${year} attendance — saving to your phone…`
          : `${MONTHS[month - 1]} ${year} attendance downloaded`
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
          Summary, day by day, and the month's holidays — office hours 09:30 AM to 06:30 PM.
          {scope === "team" && " Pick an office, a department, any number of people — or leave it on all."}
        </p>
      </CardContent>
    </Card>
  )
}
