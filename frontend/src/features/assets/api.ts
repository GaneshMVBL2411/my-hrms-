import { apiClient } from "@/lib/apiClient"
import type { Asset, AssetAssignment, AssetCreate, AssetUpdate, PaginatedAssets } from "@/features/assets/types"

export async function listAssets(params: {
  page: number
  pageSize: number
  status?: string
  category?: string
  search?: string
}): Promise<PaginatedAssets> {
  const { data } = await apiClient.get("/assets", { params })
  return data
}

export async function getMyAssets(): Promise<Asset[]> {
  const { data } = await apiClient.get("/assets/mine")
  return data
}

export async function getAssetHistory(assetId: number): Promise<AssetAssignment[]> {
  const { data } = await apiClient.get(`/assets/${assetId}/history`)
  return data
}

export async function createAsset(payload: AssetCreate): Promise<Asset> {
  const { data } = await apiClient.post("/assets", payload)
  return data
}

export async function updateAsset(id: number, payload: AssetUpdate): Promise<Asset> {
  const { data } = await apiClient.patch(`/assets/${id}`, payload)
  return data
}

export async function deleteAsset(id: number): Promise<void> {
  await apiClient.delete(`/assets/${id}`)
}

export async function assignAsset(id: number, employeeId: number, notes?: string): Promise<Asset> {
  const { data } = await apiClient.post(`/assets/${id}/assign`, { employeeId, notes })
  return data
}

export async function returnAsset(id: number): Promise<Asset> {
  const { data } = await apiClient.post(`/assets/${id}/return`)
  return data
}
