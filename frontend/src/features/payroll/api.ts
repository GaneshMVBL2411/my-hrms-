import { apiClient } from "@/lib/apiClient"
import type { PaginatedPayslips, Payslip, PayrollSummary, SalaryStructure, SalaryStructureUpsert } from "@/features/payroll/types"

export async function getMyStructure(): Promise<SalaryStructure | null> {
  const { data } = await apiClient.get("/payroll/structure/me")
  return data
}

export async function getStructure(employeeId: number): Promise<SalaryStructure | null> {
  const { data } = await apiClient.get(`/payroll/structure/${employeeId}`)
  return data
}

export async function upsertStructure(employeeId: number, payload: SalaryStructureUpsert): Promise<SalaryStructure> {
  const { data } = await apiClient.put(`/payroll/structure/${employeeId}`, payload)
  return data
}

export async function listPayslips(params: {
  page: number
  pageSize: number
  employeeId?: number
  month?: number
  year?: number
}): Promise<PaginatedPayslips> {
  const { data } = await apiClient.get("/payroll/payslips", { params })
  return data
}

export async function getPayslip(id: number): Promise<Payslip> {
  const { data } = await apiClient.get(`/payroll/payslips/${id}`)
  return data
}

export async function generatePayslip(employeeId: number, month: number, year: number): Promise<Payslip> {
  const { data } = await apiClient.post("/payroll/payslips/generate", { employeeId, month, year })
  return data
}

export async function generateBulk(month: number, year: number): Promise<Payslip[]> {
  const { data } = await apiClient.post("/payroll/payslips/generate-bulk", { month, year })
  return data
}

export async function getSummary(month: number, year: number): Promise<PayrollSummary> {
  const { data } = await apiClient.get("/payroll/reports/summary", { params: { month, year } })
  return data
}
