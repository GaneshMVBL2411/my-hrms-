export interface SalaryStructure {
  id: number
  employeeId: number
  employeeName: string
  basic: number
  hra: number
  specialAllowance: number
  pfPercent: number
  esiPercent: number
  effectiveFrom: string
}

export interface SalaryStructureUpsert {
  basic: number
  hra: number
  specialAllowance: number
  pfPercent: number
  esiPercent: number
  effectiveFrom: string
}

export interface Payslip {
  id: number
  employeeId: number
  employeeName: string
  employeeCode: string
  designationTitle: string | null
  departmentName: string | null
  joiningDate: string | null
  month: number
  year: number
  basic: number
  hra: number
  specialAllowance: number
  grossPay: number
  pfDeduction: number
  esiDeduction: number
  professionalTax: number
  netPay: number
  generatedAt: string
}

export interface PayrollSummary {
  month: number
  year: number
  employeeCount: number
  totalGross: number
  totalDeductions: number
  totalNet: number
}

export interface PaginatedPayslips {
  items: Payslip[]
  total: number
  page: number
  pageSize: number
}
