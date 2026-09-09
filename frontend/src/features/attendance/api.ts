import { supabase } from "@/lib/supabase"
import { unwrap, ApiError } from "@/lib/errors"
import { toCamel } from "@/lib/case"
import { pageRange } from "@/lib/query"
import type { AttendanceRecord, AttendanceSummary, PaginatedAttendance } from "@/features/attendance/types"

const COLUMNS =
  "id, employee_id, employee_name, date, check_in, check_out, break_minutes, status, working_hours, is_late, check_in_photo_id, check_out_photo_id, check_in_latitude, check_in_longitude, check_in_accuracy_m, check_out_latitude, check_out_longitude, check_out_accuracy_m"

export async function getAttendanceRecord(id: number): Promise<AttendanceRecord> {
  return unwrap<AttendanceRecord>(
    await supabase.from("attendance_detail").select(COLUMNS).eq("id", id).single()
  )
}

export async function checkIn(): Promise<AttendanceRecord> {
  return getAttendanceRecord(unwrap<number>(await supabase.rpc("attendance_check_in")))
}

export async function checkOut(): Promise<AttendanceRecord> {
  return getAttendanceRecord(unwrap<number>(await supabase.rpc("attendance_check_out")))
}

export async function getMyAttendance(year: number, month: number): Promise<AttendanceRecord[]> {
  const start = `${year}-${String(month).padStart(2, "0")}-01`
  const end = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10)

  const { data: employeeId, error } = await supabase.rpc("app_employee_id")
  if (error) throw new ApiError(error.message, error.code)
  if (!employeeId) return []

  return unwrap<AttendanceRecord[]>(
    await supabase
      .from("attendance_detail")
      .select(COLUMNS)
      .eq("employee_id", employeeId)
      .gte("date", start)
      .lte("date", end)
      .order("date")
  )
}

export async function getSummary(date?: string): Promise<AttendanceSummary> {
  return unwrap<AttendanceSummary>(await supabase.rpc("attendance_summary", { p_date: date ?? null }))
}

export async function listAttendance(params: {
  page: number
  pageSize: number
  date?: string
  employeeId?: number
}): Promise<PaginatedAttendance> {
  const [from, to] = pageRange(params.page, params.pageSize)

  let query = supabase.from("attendance_detail").select(COLUMNS, { count: "exact" })
  if (params.date) query = query.eq("date", params.date)
  if (params.employeeId) query = query.eq("employee_id", params.employeeId)

  const { data, error, count } = await query.order("date", { ascending: false }).range(from, to)
  if (error) throw new ApiError(error.message, error.code)

  return {
    items: toCamel<AttendanceRecord[]>(data ?? []),
    total: count ?? 0,
    page: params.page,
    pageSize: params.pageSize,
  }
}
