export interface AttendanceReportRow {
  employeeId: number
  employeeName: string
  presentDays: number
  absentDays: number
  halfDays: number
  lateCount: number
}

export interface LeaveReportRow {
  employeeId: number
  employeeName: string
  leaveTypeName: string
  allocatedDays: number
  usedDays: number
  remainingDays: number
}

export interface TaskReportRow {
  assigneeId: number | null
  assigneeName: string
  assigned: number
  inProgress: number
  review: number
  completed: number
}

export interface ProjectReportRow {
  id: number
  name: string
  status: string
  priority: string
  progress: number
  memberCount: number
  deadline: string | null
}

export interface EmployeeReportRow {
  departmentName: string
  designationTitle: string
  activeCount: number
  inactiveCount: number
}

/**
 * One manager with the people who report to them. Anyone with no reporting
 * line is grouped under a single "Unassigned" row, which is usually the row
 * this report is opened to find.
 */
export interface ReportingManagerRow {
  managerId: number | null
  managerName: string
  managerDesignation: string
  departmentName: string
  teamSize: number
  inactiveCount: number
  reports: {
    employeeId: number
    fullName: string
    status: string
    departmentName: string
  }[]
}
