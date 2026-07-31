export type Gender = "male" | "female" | "other"
export type EmployeeStatus = "active" | "inactive" | "on_notice" | "exited"

export interface Department {
  id: number
  name: string
  description?: string | null
}

export interface Designation {
  id: number
  title: string
  description?: string | null
}

export interface EmployeeSummary {
  id: number
  employeeCode: string
  fullName: string
  email: string
  phone: string | null
  address: string | null
  photoUrl: string | null
  departmentId: number | null
  departmentName: string | null
  designationId: number | null
  designationTitle: string | null
  status: EmployeeStatus
  joiningDate: string | null
}

export interface Employee extends EmployeeSummary {
  firstName: string
  lastName: string
  dob: string | null
  gender: Gender | null
  reportingManagerId: number | null
  reportingManagerName: string | null
  skills: string[]
  experienceYears: number | null
  panNumber: string | null
  aadhaarNumber: string | null
  bankAccountNumber: string | null
  bankIfsc: string | null
  bankName: string | null
  createdAt: string
  role: string
}

export interface EmployeeListParams {
  page: number
  pageSize: number
  search?: string
  departmentId?: number
  designationId?: number
  status?: EmployeeStatus
  sortBy?: string
  sortDir?: "asc" | "desc"
}

export interface PaginatedResponse<T> {
  items: T[]
  total: number
  page: number
  pageSize: number
}

export interface EmployeeFormValues {
  email: string
  password?: string
  firstName: string
  lastName: string
  phone?: string
  address?: string
  dob?: string
  gender?: Gender
  departmentId?: number
  designationId?: number
  reportingManagerId?: number
  joiningDate?: string
  skills?: string[]
  experienceYears?: number
  panNumber?: string
  aadhaarNumber?: string
  bankAccountNumber?: string
  bankIfsc?: string
  bankName?: string
  status: EmployeeStatus
  role: string
}
