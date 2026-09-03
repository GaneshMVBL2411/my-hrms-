import { supabase } from "@/lib/supabase"
import { unwrap } from "@/lib/errors"
import type {
  AttendanceReportRow,
  EmployeeReportRow,
  LeaveReportRow,
  ProjectReportRow,
  ReportingManagerRow,
  TaskReportRow,
} from "@/features/reports/types"

// Every report aggregates across the whole company, so each one is a SECURITY
// DEFINER function that re-checks for an HR role before it reads anything.

export async function getAttendanceReport(year: number, month: number): Promise<AttendanceReportRow[]> {
  return unwrap<AttendanceReportRow[]>(
    await supabase.rpc("report_attendance", { p_year: year, p_month: month })
  )
}

export async function getLeaveReport(year: number): Promise<LeaveReportRow[]> {
  return unwrap<LeaveReportRow[]>(await supabase.rpc("report_leaves", { p_year: year }))
}

export async function getTaskReport(): Promise<TaskReportRow[]> {
  return unwrap<TaskReportRow[]>(await supabase.rpc("report_tasks"))
}

export async function getProjectReport(): Promise<ProjectReportRow[]> {
  return unwrap<ProjectReportRow[]>(await supabase.rpc("report_projects"))
}

export async function getEmployeeReport(): Promise<EmployeeReportRow[]> {
  return unwrap<EmployeeReportRow[]>(await supabase.rpc("report_employees"))
}

export async function getReportingManagerReport(): Promise<ReportingManagerRow[]> {
  return unwrap<ReportingManagerRow[]>(await supabase.rpc("report_reporting_manager"))
}
