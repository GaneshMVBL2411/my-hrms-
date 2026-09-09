export type AttendanceStatus = "present" | "absent" | "half_day" | "on_leave"

export interface AttendanceRecord {
  id: number
  employeeId: number
  employeeName: string
  date: string
  checkIn: string | null
  checkOut: string | null
  breakMinutes: number
  status: AttendanceStatus
  workingHours: number | null
  isLate: boolean
  checkInPhotoId?: string | null
  checkOutPhotoId?: string | null
  checkInLatitude?: number | null
  checkInLongitude?: number | null
  checkInAccuracyM?: number | null
  checkOutLatitude?: number | null
  checkOutLongitude?: number | null
  checkOutAccuracyM?: number | null
}

export interface AttendanceSummary {
  date: string
  present: number
  absent: number
  onLeave: number
  halfDay: number
  totalEmployees: number
}

export interface PaginatedAttendance {
  items: AttendanceRecord[]
  total: number
  page: number
  pageSize: number
}
