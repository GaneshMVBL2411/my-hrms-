import { supabase } from "@/lib/supabase"
import { unwrap, ApiError } from "@/lib/errors"
import { toCamel } from "@/lib/case"
import { pageRange } from "@/lib/query"
import type {
  PaginatedPayslips,
  Payslip,
  PayrollSummary,
  SalaryStructure,
  SalaryStructureUpsert,
} from "@/features/payroll/types"

const STRUCTURE_COLUMNS =
  "id, employee_id, employee_name, basic, hra, special_allowance, pf_percent, esi_percent, effective_from"

const PAYSLIP_COLUMNS =
  "id, employee_id, employee_name, employee_code, designation_title, department_name, joining_date, " +
  "month, year, basic, hra, special_allowance, gross_pay, pf_deduction, esi_deduction, " +
  "professional_tax, net_pay, generated_at"

export async function getStructure(employeeId: number): Promise<SalaryStructure | null> {
  return unwrap<SalaryStructure | null>(
    await supabase
      .from("salary_structure_detail")
      .select(STRUCTURE_COLUMNS)
      .eq("employee_id", employeeId)
      .maybeSingle()
  )
}

export async function getMyStructure(): Promise<SalaryStructure | null> {
  const { data: employeeId, error } = await supabase.rpc("app_employee_id")
  if (error) throw new ApiError(error.message, error.code)
  if (!employeeId) return null
  return getStructure(employeeId)
}

export async function upsertStructure(
  employeeId: number,
  payload: SalaryStructureUpsert
): Promise<SalaryStructure> {
  const { error } = await supabase.from("salary_structures").upsert(
    {
      employee_id: employeeId,
      basic: payload.basic,
      hra: payload.hra,
      special_allowance: payload.specialAllowance,
      pf_percent: payload.pfPercent,
      esi_percent: payload.esiPercent,
      effective_from: payload.effectiveFrom,
    },
    { onConflict: "employee_id" }
  )
  if (error) throw new ApiError(error.message, error.code)

  return (await getStructure(employeeId))!
}

export async function listPayslips(params: {
  page: number
  pageSize: number
  employeeId?: number
  month?: number
  year?: number
}): Promise<PaginatedPayslips> {
  const [from, to] = pageRange(params.page, params.pageSize)

  // Employees only ever see their own payslips — enforced by row level security,
  // so no extra scoping is needed here.
  let query = supabase.from("payslip_detail").select(PAYSLIP_COLUMNS, { count: "exact" })
  if (params.employeeId) query = query.eq("employee_id", params.employeeId)
  if (params.month) query = query.eq("month", params.month)
  if (params.year) query = query.eq("year", params.year)

  const { data, error, count } = await query
    .order("year", { ascending: false })
    .order("month", { ascending: false })
    .range(from, to)

  if (error) throw new ApiError(error.message, error.code)

  return {
    items: toCamel<Payslip[]>(data ?? []),
    total: count ?? 0,
    page: params.page,
    pageSize: params.pageSize,
  }
}

export async function getPayslip(id: number): Promise<Payslip> {
  return unwrap<Payslip>(await supabase.from("payslip_detail").select(PAYSLIP_COLUMNS).eq("id", id).single())
}

export async function generatePayslip(employeeId: number, month: number, year: number): Promise<Payslip> {
  const id = unwrap<number>(
    await supabase.rpc("generate_payslip", {
      p_employee_id: employeeId,
      p_month: month,
      p_year: year,
    })
  )
  return getPayslip(id)
}

export async function generateBulk(month: number, year: number): Promise<Payslip[]> {
  const ids = unwrap<number[]>(
    await supabase.rpc("generate_payslips_bulk", { p_month: month, p_year: year })
  )
  if (ids.length === 0) return []

  return unwrap<Payslip[]>(await supabase.from("payslip_detail").select(PAYSLIP_COLUMNS).in("id", ids))
}

export async function getSummary(month: number, year: number): Promise<PayrollSummary> {
  return unwrap<PayrollSummary>(await supabase.rpc("payroll_summary", { p_month: month, p_year: year }))
}
