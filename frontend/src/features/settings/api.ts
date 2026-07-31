import { apiClient } from "@/lib/apiClient"
import type {
  CompanySettings,
  CompanySettingsUpdate,
  PaginatedAuditLogs,
  RoleInfo,
} from "@/features/settings/types"

export async function getCompanySettings(): Promise<CompanySettings | null> {
  const { data } = await apiClient.get("/settings/company")
  return data
}

export async function updateCompanySettings(payload: CompanySettingsUpdate): Promise<CompanySettings> {
  const { data } = await apiClient.put("/settings/company", payload)
  return data
}

export async function listRoles(): Promise<RoleInfo[]> {
  const { data } = await apiClient.get("/roles")
  return data
}

export async function listAuditLogs(params: {
  page: number
  pageSize: number
  entity?: string
  action?: string
}): Promise<PaginatedAuditLogs> {
  const { data } = await apiClient.get("/audit-logs", { params })
  return data
}
