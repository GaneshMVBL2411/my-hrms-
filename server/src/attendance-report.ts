import ExcelJS from "exceljs"
import type { PoolClient } from "pg"
import { loadCompanyHeader, MONTHS, type CompanyHeader } from "./payslip-pdf.js"

/**
 * The month's attendance, as a workbook HR can open in Excel.
 *
 * Three questions are asked of this report and it answers all three from one
 * query: how did one person do, how did everyone do side by side, and what
 * did every day look like. So the workbook has three sheets — Summary, Daily,
 * Holidays — and the only choice the caller makes is whether to scope it to
 * one employee or to the whole company.
 *
 * Everything is computed here rather than in SQL because the arithmetic is
 * calendar arithmetic: which days were working days, which of those someone
 * was on approved leave for, what a day is worth in hours. That is far
 * clearer as a loop over dates than as a window function, and it is the part
 * most likely to need changing when the company's week or hours change.
 */

// ---------------------------------------------------------------- the rules

/** The working day, as the company defines it. */
export const OFFICE = {
  start: "09:30",
  end: "18:30",
  label: "09:30 AM to 06:30 PM",
  /** 09:30 to 18:30 inclusive of the lunch break, which is what a day is paid as. */
  hoursPerDay: 9,
  /** 0 = Sunday. Saturday and Sunday are not working days. */
  weekend: [0, 6],
  /**
   * Punches are stored in UTC; the office is not. Every time in this report
   * is rendered in this zone and lateness is judged against it — but the
   * database decides what the zone is, through office_time_zone(), which the
   * view and the punch functions use too. This is only the fallback for a
   * database that predates migration 0042.
   */
  timeZone: "Asia/Kolkata",
} as const

// ---------------------------------------------------------------- the data

interface EmployeeRow {
  id: number
  employee_code: string
  full_name: string
  department_name: string | null
  branch_name: string | null
  designation_title: string | null
  joining_date: string | null
  status: string
}

interface AttendanceRow {
  employee_id: number
  date: string
  check_in: Date | null
  check_out: Date | null
  break_minutes: number
  status: string
}

interface LeaveRow {
  employee_id: number
  start_date: string
  end_date: string
  leave_type: string | null
}

interface HolidayRow {
  title: string
  event_date: string
  description: string | null
  /** Null for a holiday the whole company observes. */
  branch_name: string | null
}

export interface ReportScope {
  month: number
  year: number
  /**
   * Who the report covers. Both null means the whole company; either one set
   * narrows it, and `employeeIds` wins where both are given — a named list is
   * more specific than the department it happens to come from.
   */
  employeeIds: number[] | null
  departmentId: number | null
  /** One office, or every office when null. */
  branchId: number | null
}

interface ReportData {
  company: CompanyHeader
  /** The department the report was scoped to, when it was scoped to one. */
  departmentName: string | null
  /** The branch it was scoped to, likewise. */
  branchName: string | null
  /** The office's own zone, as the database has it. */
  zone: string
  employees: EmployeeRow[]
  attendance: AttendanceRow[]
  leaves: LeaveRow[]
  holidays: HolidayRow[]
}

/**
 * Reads everything the workbook needs, under the caller's session.
 *
 * Dates come back as text on purpose. A `date` column arrives as a JavaScript
 * Date at local midnight, which in a zone east of UTC is the previous day —
 * the difference between "1 September" and "31 August" in every total below.
 */
async function loadReport(client: PoolClient, scope: ReportScope): Promise<ReportData> {
  const first = `${scope.year}-${String(scope.month).padStart(2, "0")}-01`

  // Row level security narrows all of this to the caller's company, and to
  // the caller themselves when they are not HR, so the only filtering here is
  // the filtering the report asked for.
  //
  // The employees are resolved first and everything else is fetched for that
  // list of ids. One shape for one employee, forty, or a department, instead
  // of a different query per case — which is how the single-employee version
  // ended up repeating its filter three times.
  const where: string[] = []
  const params: unknown[] = []
  if (scope.employeeIds?.length) {
    params.push(scope.employeeIds)
    where.push(`e.id = any($${params.length}::int[])`)
  } else if (scope.departmentId !== null) {
    params.push(scope.departmentId)
    where.push(`e.department_id = $${params.length}`)
  }
  // A branch narrows any of the above rather than replacing it: "Engineering
  // in Hyderabad" is a question people ask, and two filters that cancelled
  // each other out would answer it wrongly and silently.
  if (scope.branchId !== null) {
    params.push(scope.branchId)
    where.push(`e.branch_id = $${params.length}`)
  }

  const employees = await client.query<EmployeeRow>(
    `select e.id, e.employee_code, e.full_name, d.name as department_name,
            b.name as branch_name, g.title as designation_title,
            e.joining_date::text, e.status::text
       from public.employees e
       left join public.departments d on d.id = e.department_id
       left join public.branches b on b.id = e.branch_id
       left join public.designations g on g.id = e.designation_id
      ${where.length ? `where ${where.join(" and ")}` : ""}
      order by e.employee_code, e.full_name`,
    params
  )

  const ids = employees.rows.map((e) => e.id)

  const attendance = await client.query<AttendanceRow>(
    `select a.employee_id, a.date::text, a.check_in, a.check_out, a.break_minutes, a.status::text
       from public.attendance_records a
      where a.date >= $1::date and a.date < ($1::date + interval '1 month')
        and a.employee_id = any($2::int[])
      order by a.date, a.employee_id`,
    [first, ids]
  )

  const leaves = await client.query<LeaveRow>(
    `select r.employee_id, r.start_date::text, r.end_date::text, t.name as leave_type
       from public.leave_requests r
       left join public.leave_types t on t.id = r.leave_type_id
      where r.status = 'approved'
        and r.start_date < ($1::date + interval '1 month')
        and r.end_date >= $1::date
        and r.employee_id = any($2::int[])`,
    [first, ids]
  )

  // A holiday with no branch belongs to the whole company; one with a branch
  // belongs to that office only, which is the case this exists for — a
  // regional festival that is a working day at the other office.
  const holidays = await client.query<HolidayRow>(
    `select c.title, c.event_date::text, c.description, b.name as branch_name
       from public.company_events c
       left join public.branches b on b.id = c.branch_id
      where c.event_type = 'holiday'
        and c.event_date >= $1::date and c.event_date < ($1::date + interval '1 month')
        and (c.branch_id is null or $2::int is null or c.branch_id = $2::int)
      order by c.event_date`,
    [first, scope.branchId]
  )

  const zone = await client
    .query<{ zone: string }>("select public.office_time_zone() as zone")
    .then((r) => r.rows[0]?.zone || OFFICE.timeZone)
    .catch(() => OFFICE.timeZone)

  const departmentName =
    scope.departmentId === null || scope.employeeIds?.length
      ? null
      : await client
          .query<{ name: string }>("select name from public.departments where id = $1", [scope.departmentId])
          .then((r) => r.rows[0]?.name ?? null)
          .catch(() => null)

  const branchName =
    scope.branchId === null
      ? null
      : await client
          .query<{ name: string }>("select name from public.branches where id = $1", [scope.branchId])
          .then((r) => r.rows[0]?.name ?? null)
          .catch(() => null)

  return {
    company: await loadCompanyHeader(client),
    departmentName,
    branchName,
    zone,
    employees: employees.rows,
    attendance: attendance.rows,
    leaves: leaves.rows,
    holidays: holidays.rows,
  }
}

// ------------------------------------------------------------ the calendar

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]

/** "2026-09-04" → 4 September 2026, as a date with no time and no zone to get wrong. */
function asDate(text: string): Date {
  const [y, m, d] = text.slice(0, 10).split("-").map(Number)
  return new Date(Date.UTC(y!, (m ?? 1) - 1, d ?? 1))
}

function iso(date: Date): string {
  return date.toISOString().slice(0, 10)
}

/** Every date in the month, as text, in order. */
function datesInMonth(month: number, year: number): string[] {
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate()
  return Array.from({ length: days }, (_, i) => `${year}-${String(month).padStart(2, "0")}-${String(i + 1).padStart(2, "0")}`)
}

function isWeekend(date: string): boolean {
  return (OFFICE.weekend as readonly number[]).includes(asDate(date).getUTCDay())
}

function dayName(date: string): string {
  return DAY_NAMES[asDate(date).getUTCDay()]!
}

/** Every date someone is on approved leave for, within the month. */
function leaveDates(leaves: LeaveRow[], employeeId: number, month: string[]): Set<string> {
  const out = new Set<string>()
  for (const leave of leaves) {
    if (leave.employee_id !== employeeId) continue
    for (let d = asDate(leave.start_date); iso(d) <= leave.end_date.slice(0, 10); d.setUTCDate(d.getUTCDate() + 1)) {
      const text = iso(d)
      if (month.includes(text)) out.add(text)
    }
  }
  return out
}

// -------------------------------------------------------------- formatting

function timeInOffice(value: Date | null, zone: string): string {
  if (!value) return "—"
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: zone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  }).format(value)
}

/** Minutes past midnight in the office's own zone — for judging lateness. */
function minutesInOffice(value: Date, zone: string): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: zone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(value)
  const [h, m] = parts.split(":").map(Number)
  return (h ?? 0) * 60 + (m ?? 0)
}

const OFFICE_START_MINUTES = Number(OFFICE.start.slice(0, 2)) * 60 + Number(OFFICE.start.slice(3))

function hoursBetween(row: AttendanceRow): number | null {
  if (!row.check_in || !row.check_out) return null
  const raw = (row.check_out.getTime() - row.check_in.getTime()) / 3_600_000 - (row.break_minutes || 0) / 60
  return raw > 0 ? Math.round(raw * 100) / 100 : 0
}

// ----------------------------------------------------------------- totals

export interface EmployeeTotals {
  employee: EmployeeRow
  workingDays: number
  present: number
  halfDays: number
  leaves: number
  absent: number
  hours: number
  expectedHours: number
  late: number
  missingCheckOut: number
}

function totalsFor(
  employee: EmployeeRow,
  data: ReportData,
  month: string[],
  workingDays: string[]
): EmployeeTotals {
  const rows = data.attendance.filter((r) => r.employee_id === employee.id)
  const byDate = new Map(rows.map((r) => [r.date.slice(0, 10), r]))
  const onLeave = leaveDates(data.leaves, employee.id, month)

  // Someone who joined mid-month is not absent for the days before they
  // joined, and their expected hours should not include them either.
  const joined = employee.joining_date?.slice(0, 10) ?? null
  const countable = workingDays.filter((d) => !joined || d >= joined)

  let present = 0
  let halfDays = 0
  let leaves = 0
  let hours = 0
  let late = 0
  let missingCheckOut = 0

  for (const date of countable) {
    const row = byDate.get(date)
    if (row?.status === "half_day") halfDays++
    else if (row?.status === "on_leave" || onLeave.has(date)) leaves++
    else if (row && row.status !== "absent") present++
  }

  // Hours and punctuality are counted from every record in the month, not
  // only the working days: someone who came in on a Saturday worked those
  // hours, and the sheet would be wrong to drop them.
  for (const row of rows) {
    const worked = hoursBetween(row)
    if (worked !== null) hours += worked
    else if (row.check_in) missingCheckOut++
    if (row.check_in && minutesInOffice(row.check_in, data.zone) > OFFICE_START_MINUTES) late++
  }

  const absent = Math.max(countable.length - present - halfDays - leaves, 0)

  return {
    employee,
    workingDays: countable.length,
    present,
    halfDays,
    leaves,
    absent,
    hours: Math.round(hours * 100) / 100,
    expectedHours: countable.length * OFFICE.hoursPerDay,
    late,
    missingCheckOut,
  }
}

// ----------------------------------------------------------------- drawing

const BRAND = "FF0F4C34"
const TINT = "FFEAF0EC"
const RULE = "FFD9E3DD"

function titleRow(sheet: ExcelJS.Worksheet, text: string, span: number, size = 14): ExcelJS.Row {
  const row = sheet.addRow([text])
  sheet.mergeCells(row.number, 1, row.number, span)
  row.getCell(1).font = { bold: true, size, color: { argb: BRAND } }
  row.height = size + 8
  return row
}

function labelRow(sheet: ExcelJS.Worksheet, label: string, value: string | number, span: number): void {
  const row = sheet.addRow([label, value])
  row.getCell(1).font = { color: { argb: "FF5A6B62" } }
  row.getCell(2).font = { bold: true }
  sheet.mergeCells(row.number, 2, row.number, span)
}

function headerRow(sheet: ExcelJS.Worksheet, labels: string[]): void {
  const row = sheet.addRow(labels)
  row.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: BRAND } }
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: TINT } }
    cell.border = { bottom: { style: "thin", color: { argb: RULE } } }
    cell.alignment = { vertical: "middle" }
  })
  row.height = 20
}

export function reportFilename(scope: ReportScope, who: string): string {
  const period = `${MONTHS[scope.month - 1] ?? scope.month}_${scope.year}`
  return `Attendance_${who.replace(/[^A-Za-z0-9]+/g, "_")}_${period}.xlsx`
}

/**
 * Builds the workbook and returns it as bytes, plus the name to save it as.
 *
 * Three sheets, in the order someone reads them: what the month came to, what
 * each day was, and which days the office was closed.
 */
export async function buildAttendanceWorkbook(
  client: PoolClient,
  scope: ReportScope
): Promise<{ buffer: Buffer; filename: string } | null> {
  const data = await loadReport(client, scope)
  if (data.employees.length === 0) return null

  const month = datesInMonth(scope.month, scope.year)
  const holidayDates = new Set(data.holidays.map((h) => h.event_date.slice(0, 10)))
  const workingDays = month.filter((d) => !isWeekend(d) && !holidayDates.has(d))
  const period = `${MONTHS[scope.month - 1] ?? scope.month} ${scope.year}`

  // What to call this report, on the sheet and in the file name. A list of
  // one is still a list as far as the query is concerned, but to whoever
  // opens it it is that person's month, so it is named after them.
  const single = data.employees.length === 1 ? data.employees[0]! : null
  const branchSuffix = data.branchName ? ` · ${data.branchName}` : ""
  const scopeLabel = single
    ? `${single.full_name} (${single.employee_code})`
    : data.departmentName
      ? `${data.departmentName} — ${data.employees.length} employees`
      : scope.employeeIds?.length
        ? `${data.employees.length} selected employees${branchSuffix}`
        : `All employees${branchSuffix}`
  const scopeName = single
    ? single.full_name
    : data.departmentName
      ? data.departmentName
      : scope.employeeIds?.length
        ? `${data.employees.length}_Employees`
        : data.branchName ?? "All_Employees"

  const totals = data.employees.map((e) => totalsFor(e, data, month, workingDays))
  const sum = (pick: (t: EmployeeTotals) => number) => totals.reduce((a, t) => a + pick(t), 0)

  const book = new ExcelJS.Workbook()
  book.creator = data.company.name
  book.created = new Date()

  // ----------------------------------------------------------- Summary
  const summary = book.addWorksheet("Summary", { views: [{ state: "frozen", ySplit: 0 }] })
  summary.columns = [
    { width: 14 }, { width: 26 }, { width: 18 }, { width: 16 }, { width: 13 },
    { width: 10 }, { width: 11 }, { width: 10 }, { width: 10 }, { width: 13 },
    { width: 14 }, { width: 13 }, { width: 13 }, { width: 16 },
  ]

  titleRow(summary, data.company.name, 14, 16)
  if (data.company.address) {
    const row = summary.addRow([data.company.address])
    summary.mergeCells(row.number, 1, row.number, 14)
    row.getCell(1).font = { color: { argb: "FF5A6B62" }, size: 10 }
  }
  titleRow(summary, `Attendance Report — ${period}`, 14, 13)
  summary.addRow([])

  labelRow(summary, "Scope", scopeLabel, 6)
  labelRow(summary, "Office", data.branchName ?? "All offices", 6)
  labelRow(summary, "Office hours", `${OFFICE.label}  ·  ${OFFICE.hoursPerDay.toFixed(2)} hours per day`, 6)
  labelRow(summary, "Working week", "Monday to Friday (Saturday and Sunday off)", 6)
  labelRow(summary, "Generated", new Intl.DateTimeFormat("en-IN", { timeZone: data.zone, dateStyle: "medium", timeStyle: "short" }).format(new Date()), 6)
  summary.addRow([])

  // The four figures the report exists to give, before any detail.
  titleRow(summary, "Month at a glance", 14, 12)
  labelRow(summary, "1. Total working days", workingDays.length, 4)
  labelRow(summary, "2. Total leaves", single ? sum((t) => t.leaves) : `${sum((t) => t.leaves)} day(s) across ${data.employees.length} employees`, 4)
  labelRow(summary, "3. Festival holidays", data.holidays.length === 0 ? "0 — none recorded for this month" : `${data.holidays.length} (see Holidays sheet)`, 4)
  labelRow(summary, "4. Total working hours", `${sum((t) => t.hours).toFixed(2)} of ${sum((t) => t.expectedHours).toFixed(2)} expected`, 4)
  summary.addRow([])

  headerRow(summary, [
    "Employee code", "Employee name", "Department", "Office", "Working days",
    "Present", "Half days", "Leaves", "Absent", "Total hours",
    "Expected hours", "Difference", "Late arrivals", "No check-out",
  ])

  for (const t of totals) {
    const row = summary.addRow([
      t.employee.employee_code,
      t.employee.full_name,
      t.employee.department_name ?? "—",
      t.employee.branch_name ?? "—",
      t.workingDays,
      t.present,
      t.halfDays,
      t.leaves,
      t.absent,
      t.hours,
      t.expectedHours,
      Math.round((t.hours - t.expectedHours) * 100) / 100,
      t.late,
      t.missingCheckOut,
    ])
    row.getCell(10).numFmt = "0.00"
    row.getCell(11).numFmt = "0.00"
    row.getCell(12).numFmt = "0.00"
    // A shortfall is the number someone is looking for; colour is the fastest
    // way to find it in a sheet of forty rows.
    row.getCell(12).font = { color: { argb: t.hours < t.expectedHours ? "FFB42318" : "FF107569" } }
    if (t.absent > 0) row.getCell(9).font = { color: { argb: "FFB42318" }, bold: true }
  }

  if (totals.length > 1) {
    const row = summary.addRow([
      "", "TOTAL", "", "", sum((t) => t.workingDays), sum((t) => t.present), sum((t) => t.halfDays),
      sum((t) => t.leaves), sum((t) => t.absent), Math.round(sum((t) => t.hours) * 100) / 100,
      sum((t) => t.expectedHours), Math.round((sum((t) => t.hours) - sum((t) => t.expectedHours)) * 100) / 100,
      sum((t) => t.late), sum((t) => t.missingCheckOut),
    ])
    row.eachCell((cell) => {
      cell.font = { bold: true }
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: TINT } }
    })
    row.getCell(10).numFmt = "0.00"
    row.getCell(11).numFmt = "0.00"
    row.getCell(12).numFmt = "0.00"
  }

  summary.addRow([])
  const note = summary.addRow([
    "Working days exclude weekends and the holidays listed on the Holidays sheet, and start from a joining date that falls inside the month. " +
      "Hours are counted only for days with both a check-in and a check-out; the \"No check-out\" column counts the rest.",
  ])
  summary.mergeCells(note.number, 1, note.number, 14)
  note.getCell(1).font = { size: 9, color: { argb: "FF5A6B62" }, italic: true }
  note.getCell(1).alignment = { wrapText: true }
  note.height = 28

  // ------------------------------------------------------------- Daily
  const daily = book.addWorksheet("Daily", { views: [{ state: "frozen", ySplit: 1 }] })
  daily.columns = [
    { width: 13 }, { width: 12 }, { width: 14 }, { width: 26 }, { width: 16 },
    { width: 12 }, { width: 12 }, { width: 12 }, { width: 11 }, { width: 13 },
    { width: 9 },
  ]
  headerRow(daily, [
    "Date", "Day", "Employee code", "Employee name", "Office", "Status",
    "Check in", "Check out", "Break (min)", "Working hours", "Late",
  ])

  // Every working day for every employee in scope, whether or not a punch
  // exists — a month of absences is the thing an attendance report must show,
  // and a sheet of only the days someone turned up cannot show it.
  for (const date of month) {
    for (const employee of data.employees) {
      const row = data.attendance.find((r) => r.employee_id === employee.id && r.date.slice(0, 10) === date)
      const weekend = isWeekend(date)
      const holiday = holidayDates.has(date)
      const joinedLater = employee.joining_date ? date < employee.joining_date.slice(0, 10) : false
      if (!row && (weekend || holiday || joinedLater)) continue

      const onLeave = leaveDates(data.leaves, employee.id, [date]).has(date)
      // A closed day is a closed day. Attendance rows are seeded for every
      // date, so a holiday someone did not work carries a stored "absent"
      // that would otherwise read as a black mark against them; the stored
      // status only wins once there is a punch to back it up.
      const closed = weekend ? "weekend" : holiday ? "holiday" : null
      const status = closed && !row?.check_in ? closed : row?.status ?? (onLeave ? "on_leave" : "absent")
      const worked = row ? hoursBetween(row) : null
      const line = daily.addRow([
        date,
        dayName(date),
        employee.employee_code,
        employee.full_name,
        employee.branch_name ?? "—",
        status.replace(/_/g, " "),
        timeInOffice(row?.check_in ?? null, data.zone),
        timeInOffice(row?.check_out ?? null, data.zone),
        row?.break_minutes ?? 0,
        worked ?? "",
        row?.check_in && minutesInOffice(row.check_in, data.zone) > OFFICE_START_MINUTES ? "Yes" : "",
      ])
      line.getCell(10).numFmt = "0.00"
      if (status === "absent") line.getCell(6).font = { color: { argb: "FFB42318" }, bold: true }
      if (status === "on_leave") line.getCell(6).font = { color: { argb: "FF9A6700" } }
      if (line.getCell(11).value === "Yes") line.getCell(11).font = { color: { argb: "FF9A6700" } }
    }
  }
  daily.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: 11 } }

  // ---------------------------------------------------------- Holidays
  const sheet = book.addWorksheet("Holidays")
  sheet.columns = [{ width: 13 }, { width: 12 }, { width: 34 }, { width: 18 }, { width: 40 }]
  headerRow(sheet, ["Date", "Day", "Festival / Holiday", "Office", "Notes"])
  if (data.holidays.length === 0) {
    const row = sheet.addRow(["No festival holidays are recorded for this month."])
    sheet.mergeCells(row.number, 1, row.number, 5)
    row.getCell(1).font = { italic: true, color: { argb: "FF5A6B62" } }
    const how = sheet.addRow(["Add them in the portal under Calendar, as events of type \"holiday\"; they are then excluded from working days here."])
    sheet.mergeCells(how.number, 1, how.number, 5)
    how.getCell(1).font = { size: 9, color: { argb: "FF5A6B62" } }
  } else {
    for (const h of data.holidays) {
      sheet.addRow([
        h.event_date.slice(0, 10),
        dayName(h.event_date),
        h.title,
        h.branch_name ?? "All offices",
        h.description ?? "",
      ])
    }
  }

  const arrayBuffer = await book.xlsx.writeBuffer()
  return {
    buffer: Buffer.from(arrayBuffer as ArrayBuffer),
    filename: reportFilename(scope, scopeName),
  }
}
