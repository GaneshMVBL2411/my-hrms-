import { apiClient } from "@/lib/apiClient"
import type {
  Department,
  Designation,
  Employee,
  EmployeeFormValues,
  EmployeeListParams,
  PaginatedResponse,
  EmployeeSummary,
} from "@/features/employees/types"

export async function listEmployees(params: EmployeeListParams): Promise<PaginatedResponse<EmployeeSummary>> {
  const { data } = await apiClient.get("/employees", { params })
  return data
}

export async function getEmployee(id: number): Promise<Employee> {
  const { data } = await apiClient.get(`/employees/${id}`)
  return data
}

export async function createEmployee(values: EmployeeFormValues): Promise<Employee> {
  const { data } = await apiClient.post("/employees", values)
  return data
}

export async function updateEmployee(id: number, values: Partial<EmployeeFormValues>): Promise<Employee> {
  const { data } = await apiClient.patch(`/employees/${id}`, values)
  return data
}

export async function deleteEmployee(id: number): Promise<void> {
  await apiClient.delete(`/employees/${id}`)
}

export async function uploadEmployeePhoto(id: number, file: File): Promise<{ photo_url: string }> {
  const formData = new FormData()
  formData.append("file", file)
  const { data } = await apiClient.post(`/employees/${id}/photo`, formData, {
    headers: { "Content-Type": "multipart/form-data" },
  })
  return data
}

export async function listDepartments(): Promise<Department[]> {
  const { data } = await apiClient.get("/departments")
  return data
}

export async function createDepartment(payload: { name: string; description?: string }): Promise<Department> {
  const { data } = await apiClient.post("/departments", payload)
  return data
}

export async function updateDepartment(
  id: number,
  payload: { name?: string; description?: string }
): Promise<Department> {
  const { data } = await apiClient.patch(`/departments/${id}`, payload)
  return data
}

export async function deleteDepartment(id: number): Promise<void> {
  await apiClient.delete(`/departments/${id}`)
}

export async function listDesignations(): Promise<Designation[]> {
  const { data } = await apiClient.get("/designations")
  return data
}

export async function createDesignation(payload: { title: string; description?: string }): Promise<Designation> {
  const { data } = await apiClient.post("/designations", payload)
  return data
}

export async function updateDesignation(
  id: number,
  payload: { title?: string; description?: string }
): Promise<Designation> {
  const { data } = await apiClient.patch(`/designations/${id}`, payload)
  return data
}

export async function deleteDesignation(id: number): Promise<void> {
  await apiClient.delete(`/designations/${id}`)
}
