import { apiClient } from "@/lib/apiClient"
import type {
  AttendanceReportRow,
  EmployeeReportRow,
  LeaveReportRow,
  ProjectReportRow,
  TaskReportRow,
} from "@/features/reports/types"

export async function getAttendanceReport(year: number, month: number): Promise<AttendanceReportRow[]> {
  const { data } = await apiClient.get("/reports/attendance", { params: { year, month } })
  return data
}

export async function getLeaveReport(year: number): Promise<LeaveReportRow[]> {
  const { data } = await apiClient.get("/reports/leaves", { params: { year } })
  return data
}

export async function getTaskReport(): Promise<TaskReportRow[]> {
  const { data } = await apiClient.get("/reports/tasks")
  return data
}

export async function getProjectReport(): Promise<ProjectReportRow[]> {
  const { data } = await apiClient.get("/reports/projects")
  return data
}

export async function getEmployeeReport(): Promise<EmployeeReportRow[]> {
  const { data } = await apiClient.get("/reports/employees")
  return data
}
