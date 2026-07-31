import { apiClient } from "@/lib/apiClient"
import type { AttendanceRecord, AttendanceSummary, PaginatedAttendance } from "@/features/attendance/types"

export async function checkIn(): Promise<AttendanceRecord> {
  const { data } = await apiClient.post("/attendance/check-in")
  return data
}

export async function checkOut(): Promise<AttendanceRecord> {
  const { data } = await apiClient.post("/attendance/check-out")
  return data
}

export async function getMyAttendance(year: number, month: number): Promise<AttendanceRecord[]> {
  const { data } = await apiClient.get("/attendance/me", { params: { year, month } })
  return data
}

export async function getSummary(date?: string): Promise<AttendanceSummary> {
  const { data } = await apiClient.get("/attendance/summary", { params: date ? { date } : {} })
  return data
}

export async function listAttendance(params: {
  page: number
  pageSize: number
  date?: string
  employeeId?: number
}): Promise<PaginatedAttendance> {
  const { data } = await apiClient.get("/attendance", { params })
  return data
}
