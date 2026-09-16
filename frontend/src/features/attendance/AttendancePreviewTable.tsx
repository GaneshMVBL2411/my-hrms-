import { Loader2 } from "lucide-react"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import type { AttendancePreview } from "@/features/attendance/api"

/**
 * What the download would contain, on screen first.
 *
 * The Summary sheet and nothing else: the day-by-day rows are a file rather
 * than a page, and what someone checks before exporting is whether it is the
 * right people over the right days, and whether the hours look sane.
 *
 * Fed by the same server function that builds the workbook, so a number read
 * here is the number that lands in the file.
 */
export function AttendancePreviewTable({
  preview,
  loading,
  error,
}: {
  preview?: AttendancePreview
  loading: boolean
  error?: Error | null
}) {
  if (error) {
    return (
      <p className="rounded-md border border-border bg-card px-4 py-6 text-center text-sm text-muted-foreground">
        {error.message || "That selection could not be read."}
      </p>
    )
  }

  if (loading && !preview) {
    return (
      <div className="flex flex-col gap-2 rounded-md border border-border bg-card p-4">
        <Skeleton className="h-5 w-56 rounded-md" />
        <Skeleton className="h-24 w-full rounded-md" />
      </div>
    )
  }

  if (!preview) return null

  const short = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2))

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-foreground">
          {preview.period} · {preview.scopeLabel}
          {loading && <Loader2 className="ml-2 inline size-3.5 animate-spin text-muted-foreground" />}
        </h3>
        <p className="text-xs text-muted-foreground">
          {preview.workingDays} working days · {preview.holidays.length} holiday
          {preview.holidays.length === 1 ? "" : "s"} · {short(preview.totals.hours)} of{" "}
          {short(preview.totals.expectedHours)} hours
          {preview.totals.overtime > 0 && ` · ${short(preview.totals.overtime)} overtime`}
        </p>
      </div>

      {preview.holidays.length > 0 && (
        <p className="text-xs text-muted-foreground">
          Holidays:{" "}
          {preview.holidays
            .map((h) => `${h.title} (${h.date}${h.branch ? `, ${h.branch}` : ""})`)
            .join(" · ")}
        </p>
      )}

      <div className="overflow-x-auto touch-pan-x rounded-md border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Employee</TableHead>
              <TableHead className="text-right">Days</TableHead>
              <TableHead className="text-right">Present</TableHead>
              <TableHead className="text-right">Leave</TableHead>
              <TableHead className="text-right">Absent</TableHead>
              <TableHead className="text-right">Hours</TableHead>
              <TableHead className="text-right">Expected</TableHead>
              <TableHead className="text-right">Overtime</TableHead>
              <TableHead className="text-right">Late</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {preview.rows.map((r) => (
              <TableRow key={r.employeeId}>
                <TableCell>
                  <span className="font-medium text-foreground">{r.employeeName}</span>
                  <span className="ml-2 text-xs text-muted-foreground">{r.employeeCode}</span>
                  {r.branchName && <span className="ml-2 text-xs text-muted-foreground">· {r.branchName}</span>}
                </TableCell>
                <TableCell className="text-right">{r.workingDays}</TableCell>
                <TableCell className="text-right">{r.present + (r.halfDays ? r.halfDays * 0.5 : 0)}</TableCell>
                <TableCell className="text-right">{r.leaves}</TableCell>
                <TableCell className={`text-right ${r.absent > 0 ? "font-semibold text-danger" : ""}`}>
                  {r.absent}
                </TableCell>
                <TableCell className="text-right font-medium text-foreground">{short(r.hours)}</TableCell>
                <TableCell className="text-right text-muted-foreground">{short(r.expectedHours)}</TableCell>
                <TableCell className={`text-right ${r.overtime > 0 ? "font-semibold text-warning" : "text-muted-foreground"}`}>
                  {short(r.overtime)}
                </TableCell>
                <TableCell className="text-right text-muted-foreground">{r.late}</TableCell>
              </TableRow>
            ))}
            {preview.rows.length > 1 && (
              <TableRow className="bg-muted/40">
                <TableCell className="font-semibold text-foreground">Total</TableCell>
                <TableCell className="text-right font-semibold">
                  {preview.rows.reduce((a, r) => a + r.workingDays, 0)}
                </TableCell>
                <TableCell className="text-right font-semibold">{preview.totals.present}</TableCell>
                <TableCell className="text-right font-semibold">{preview.totals.leaves}</TableCell>
                <TableCell className="text-right font-semibold">{preview.totals.absent}</TableCell>
                <TableCell className="text-right font-semibold">{short(preview.totals.hours)}</TableCell>
                <TableCell className="text-right font-semibold">{short(preview.totals.expectedHours)}</TableCell>
                <TableCell className="text-right font-semibold">{short(preview.totals.overtime)}</TableCell>
                <TableCell />
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <p className="text-xs text-muted-foreground">
        This is the Summary sheet of the download. The file also has every day, with its own overtime, and the
        holidays. Overtime counts hours past a full day, and every hour worked on a weekend or a holiday.
      </p>
    </div>
  )
}
