import { supabase } from "@/lib/supabase"
import { unwrap, unwrapVoid, ApiError } from "@/lib/errors"
import { toCamel } from "@/lib/case"
import { pageRange } from "@/lib/query"
import type {
  AuditLogEntry,
  CompanySettings,
  CompanySettingsUpdate,
  PaginatedAuditLogs,
  RoleInfo,
} from "@/features/settings/types"

const SETTINGS_COLUMNS = "id, company_name, address, logo_url, updated_at"

export async function getCompanySettings(): Promise<CompanySettings | null> {
  return unwrap<CompanySettings | null>(
    await supabase.from("company_settings").select(SETTINGS_COLUMNS).limit(1).maybeSingle()
  )
}

export async function updateCompanySettings(payload: CompanySettingsUpdate): Promise<CompanySettings> {
  unwrapVoid(
    await supabase.rpc("upsert_company_settings", {
      p_company_name: payload.companyName,
      p_address: payload.address ?? null,
      p_logo_url: payload.logoUrl ?? null,
    })
  )
  return (await getCompanySettings())!
}

export async function listRoles(): Promise<RoleInfo[]> {
  const rows = unwrap<
    { id: number; name: string; description: string | null; rolePermissions: { permission: { code: string } | null }[] }[]
  >(
    await supabase
      .from("roles")
      .select("id, name, description, role_permissions(permission:permissions(code))")
      .order("name")
  )

  return rows.map(({ rolePermissions, ...role }) => ({
    ...role,
    permissions: rolePermissions.map((rp) => rp.permission?.code).filter((code): code is string => !!code),
  }))
}

export async function listAuditLogs(params: {
  page: number
  pageSize: number
  entity?: string
  action?: string
}): Promise<PaginatedAuditLogs> {
  const [from, to] = pageRange(params.page, params.pageSize)

  let query = supabase
    .from("audit_log_detail")
    .select("id, user_id, user_name, action, entity, entity_id, created_at", { count: "exact" })

  if (params.entity) query = query.eq("entity", params.entity)
  if (params.action) query = query.eq("action", params.action)

  const { data, error, count } = await query.order("created_at", { ascending: false }).range(from, to)
  if (error) throw new ApiError(error.message, error.code)

  return {
    items: toCamel<AuditLogEntry[]>(data ?? []),
    total: count ?? 0,
    page: params.page,
    pageSize: params.pageSize,
  }
}
