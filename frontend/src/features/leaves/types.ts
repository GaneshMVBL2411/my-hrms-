export type LeaveStatus = "pending" | "approved" | "rejected"

/** Shared so the list and the detail panel never drift into different colours. */
export const statusTone: Record<LeaveStatus, "success" | "warning" | "danger"> = {
  approved: "success",
  pending: "warning",
  rejected: "danger",
}

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
  /** Why HR approved or turned it down, in their words. Shown to the employee. */
  decisionNote: string | null
  createdAt: string
}

export interface LeaveRequestCreate {
  leaveTypeId: number
  startDate: string
  endDate: string
  reason?: string
}
