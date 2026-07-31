import { supabase } from "@/lib/supabase"
import { unwrap, unwrapVoid, ApiError } from "@/lib/errors"
import { toCamel, definedOnly } from "@/lib/case"
import { likePattern, pageRange } from "@/lib/query"
import type {
  Asset,
  AssetAssignment,
  AssetCreate,
  AssetUpdate,
  PaginatedAssets,
} from "@/features/assets/types"

const COLUMNS = "id, name, category, serial_number, purchase_date, status, notes, created_at, assigned_to_name"

async function getAsset(id: number): Promise<Asset> {
  return unwrap<Asset>(await supabase.from("asset_detail").select(COLUMNS).eq("id", id).single())
}

export async function listAssets(params: {
  page: number
  pageSize: number
  status?: string
  category?: string
  search?: string
}): Promise<PaginatedAssets> {
  const [from, to] = pageRange(params.page, params.pageSize)

  let query = supabase.from("asset_detail").select(COLUMNS, { count: "exact" })
  if (params.status) query = query.eq("status", params.status)
  if (params.category) query = query.eq("category", params.category)
  if (params.search) query = query.ilike("name", likePattern(params.search))

  const { data, error, count } = await query.order("created_at", { ascending: false }).range(from, to)
  if (error) throw new ApiError(error.message, error.code)

  return {
    items: toCamel<Asset[]>(data ?? []),
    total: count ?? 0,
    page: params.page,
    pageSize: params.pageSize,
  }
}

export async function getMyAssets(): Promise<Asset[]> {
  const { data: employeeId, error } = await supabase.rpc("app_employee_id")
  if (error) throw new ApiError(error.message, error.code)
  if (!employeeId) return []

  const assignments = unwrap<{ assetId: number }[]>(
    await supabase
      .from("asset_assignments")
      .select("asset_id")
      .eq("employee_id", employeeId)
      .is("returned_date", null)
  )
  if (assignments.length === 0) return []

  return unwrap<Asset[]>(
    await supabase.from("asset_detail").select(COLUMNS).in("id", assignments.map((a) => a.assetId))
  )
}

export async function getAssetHistory(assetId: number): Promise<AssetAssignment[]> {
  return unwrap<AssetAssignment[]>(
    await supabase
      .from("asset_assignment_detail")
      .select("id, employee_id, employee_name, assigned_date, returned_date, notes")
      .eq("asset_id", assetId)
      .order("assigned_date", { ascending: false })
  )
}

export async function createAsset(payload: AssetCreate): Promise<Asset> {
  const asset = unwrap<{ id: number }>(
    await supabase
      .from("assets")
      .insert(
        definedOnly({
          name: payload.name,
          category: payload.category,
          serial_number: payload.serialNumber,
          purchase_date: payload.purchaseDate,
          notes: payload.notes,
        })
      )
      .select("id")
      .single()
  )
  return getAsset(asset.id)
}

export async function updateAsset(id: number, payload: AssetUpdate): Promise<Asset> {
  unwrapVoid(
    await supabase
      .from("assets")
      .update(
        definedOnly({
          name: payload.name,
          category: payload.category,
          serial_number: payload.serialNumber,
          purchase_date: payload.purchaseDate,
          notes: payload.notes,
          status: payload.status,
        })
      )
      .eq("id", id)
  )
  return getAsset(id)
}

export async function deleteAsset(id: number): Promise<void> {
  unwrapVoid(await supabase.from("assets").delete().eq("id", id))
}

/** Opening an assignment and flipping the asset's status have to happen together. */
export async function assignAsset(id: number, employeeId: number, notes?: string): Promise<Asset> {
  unwrapVoid(
    await supabase.rpc("assign_asset", {
      p_asset_id: id,
      p_employee_id: employeeId,
      p_notes: notes ?? null,
    })
  )
  return getAsset(id)
}

export async function returnAsset(id: number): Promise<Asset> {
  unwrapVoid(await supabase.rpc("return_asset", { p_asset_id: id }))
  return getAsset(id)
}
