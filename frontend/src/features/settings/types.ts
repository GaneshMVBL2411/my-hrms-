export interface CompanySettings {
  id: number
  companyName: string
  address: string | null
  logoUrl: string | null
  updatedAt: string
}

export interface CompanySettingsUpdate {
  companyName: string
  address?: string
  logoUrl?: string
}

export interface RoleInfo {
  id: number
  name: string
  description: string | null
  permissions: string[]
}

export interface AuditLogEntry {
  id: number
  userId: number | null
  userName: string | null
  action: string
  entity: string
  entityId: number | null
  createdAt: string
}

export interface PaginatedAuditLogs {
  items: AuditLogEntry[]
  total: number
  page: number
  pageSize: number
}
