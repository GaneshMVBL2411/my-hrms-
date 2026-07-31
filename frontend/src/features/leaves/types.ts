export type LeaveStatus = "pending" | "approved" | "rejected"

export interface LeaveType {
  id: number
  name: string
  defaultDaysPerYear: number
}

export interface LeaveBalance {
  id: number
  leaveTypeId: number
  leaveTypeName: string
  year: number
  allocatedDays: number
  usedDays: number
  remainingDays: number
}

export interface LeaveRequest {
  id: number
  employeeId: number
  employeeName: string
  leaveTypeId: number
  leaveTypeName: string
  startDate: string
  endDate: string
  daysCount: number
  reason: string | null
  status: LeaveStatus
  decidedByName: string | null
  decidedAt: string | null
  createdAt: string
}

export interface LeaveRequestCreate {
  leaveTypeId: number
  startDate: string
  endDate: string
  reason?: string
}
