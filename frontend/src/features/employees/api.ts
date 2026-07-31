import { supabase } from "@/lib/supabase"
import { unwrap, unwrapVoid, ApiError } from "@/lib/errors"
import { toCamel, definedOnly } from "@/lib/case"
import { invokeAdmin } from "@/lib/adminApi"
import { likePattern, logAudit, pageRange } from "@/lib/query"
import type {
  Department,
  Designation,
  Employee,
  EmployeeFormValues,
  EmployeeListParams,
  PaginatedResponse,
  EmployeeSummary,
} from "@/features/employees/types"

const SUMMARY_COLUMNS =
  "id, employee_code, full_name, email, phone, address, photo_url, department_id, " +
  "department_name, designation_id, designation_title, status, joining_date"

const SORT_COLUMNS: Record<string, string> = {
  fullName: "full_name",
  firstName: "first_name",
  joiningDate: "joining_date",
  employeeCode: "employee_code",
  status: "status",
}

/** The columns that live on `employees` — email, password and role are handled separately. */
function toEmployeeRow(values: Partial<EmployeeFormValues>) {
  return definedOnly({
    first_name: values.firstName,
    last_name: values.lastName,
    phone: values.phone,
    address: values.address,
    dob: values.dob,
    gender: values.gender,
    department_id: values.departmentId,
    designation_id: values.designationId,
    reporting_manager_id: values.reportingManagerId,
    joining_date: values.joiningDate,
    skills: values.skills,
    experience_years: values.experienceYears,
    pan_number: values.panNumber,
    aadhaar_number: values.aadhaarNumber,
    bank_account_number: values.bankAccountNumber,
    bank_ifsc: values.bankIfsc,
    bank_name: values.bankName,
    status: values.status,
  })
}

export async function listEmployees(params: EmployeeListParams): Promise<PaginatedResponse<EmployeeSummary>> {
  const [from, to] = pageRange(params.page, params.pageSize)

  let query = supabase.from("employee_directory").select(SUMMARY_COLUMNS, { count: "exact" })

  if (params.search) {
    const pattern = likePattern(params.search)
    query = query.or(`full_name.ilike.${pattern},email.ilike.${pattern},employee_code.ilike.${pattern}`)
  }
  if (params.departmentId) query = query.eq("department_id", params.departmentId)
  if (params.designationId) query = query.eq("designation_id", params.designationId)
  if (params.status) query = query.eq("status", params.status)

  const column = SORT_COLUMNS[params.sortBy ?? "fullName"] ?? "full_name"
  const { data, error, count } = await query
    .order(column, { ascending: params.sortDir !== "desc" })
    .range(from, to)

  if (error) throw new ApiError(error.message, error.code)

  return {
    items: toCamel<EmployeeSummary[]>(data ?? []),
    total: count ?? 0,
    page: params.page,
    pageSize: params.pageSize,
  }
}

/** PAN / Aadhaar / bank details come back only for HR and for the employee themselves. */
export async function getEmployee(id: number): Promise<Employee> {
  return unwrap<Employee>(await supabase.rpc("get_employee_detail", { p_id: id }))
}

export async function createEmployee(values: EmployeeFormValues): Promise<Employee> {
  const { employeeId } = await invokeAdmin<{ employeeId: number }>({
    action: "create",
    email: values.email,
    password: values.password,
    role: values.role,
    employee: toEmployeeRow(values),
  })

  logAudit("create", "employee", employeeId)
  return getEmployee(employeeId)
}

export async function updateEmployee(id: number, values: Partial<EmployeeFormValues>): Promise<Employee> {
  const row = toEmployeeRow(values)
  if (Object.keys(row).length > 0) {
    unwrapVoid(await supabase.from("employees").update(row).eq("id", id))
  }

  // The role lives on `users`, which the employee form has no direct write access to.
  if (values.role) {
    unwrapVoid(await supabase.rpc("set_employee_role", { p_employee_id: id, p_role: values.role }))
  }

  logAudit("update", "employee", id)
  return getEmployee(id)
}

/** Soft delete: marks the profile inactive and disables the login, in one transaction. */
export async function deleteEmployee(id: number): Promise<void> {
  unwrapVoid(await supabase.rpc("deactivate_employee", { p_id: id }))
  logAudit("deactivate", "employee", id)
}

export async function uploadEmployeePhoto(id: number, file: File): Promise<{ photo_url: string }> {
  const extension = file.name.split(".").pop() ?? "jpg"
  const path = `employees/${id}/photo.${extension}`

  const { error } = await supabase.storage
    .from("hrms-files")
    .upload(path, file, { upsert: true, contentType: file.type || undefined })
  if (error) throw new ApiError(error.message)

  const {
    data: { publicUrl },
  } = supabase.storage.from("hrms-files").getPublicUrl(path)

  // The path is stable across re-uploads, so without a cache buster the browser
  // keeps showing the previous photo.
  const photoUrl = `${publicUrl}?v=${Date.now()}`
  unwrapVoid(await supabase.from("employees").update({ photo_url: photoUrl }).eq("id", id))

  return { photo_url: photoUrl }
}

export async function listDepartments(): Promise<Department[]> {
  return unwrap<Department[]>(await supabase.from("departments").select("id, name, description").order("name"))
}

export async function createDepartment(payload: { name: string; description?: string }): Promise<Department> {
  return unwrap<Department>(
    await supabase.from("departments").insert(payload).select("id, name, description").single()
  )
}

export async function updateDepartment(
  id: number,
  payload: { name?: string; description?: string }
): Promise<Department> {
  return unwrap<Department>(
    await supabase
      .from("departments")
      .update(definedOnly(payload))
      .eq("id", id)
      .select("id, name, description")
      .single()
  )
}

export async function deleteDepartment(id: number): Promise<void> {
  unwrapVoid(await supabase.from("departments").delete().eq("id", id))
}

export async function listDesignations(): Promise<Designation[]> {
  return unwrap<Designation[]>(
    await supabase.from("designations").select("id, title, description").order("title")
  )
}

export async function createDesignation(payload: { title: string; description?: string }): Promise<Designation> {
  return unwrap<Designation>(
    await supabase.from("designations").insert(payload).select("id, title, description").single()
  )
}

export async function updateDesignation(
  id: number,
  payload: { title?: string; description?: string }
): Promise<Designation> {
  return unwrap<Designation>(
    await supabase
      .from("designations")
      .update(definedOnly(payload))
      .eq("id", id)
      .select("id, title, description")
      .single()
  )
}

export async function deleteDesignation(id: number): Promise<void> {
  unwrapVoid(await supabase.from("designations").delete().eq("id", id))
}
