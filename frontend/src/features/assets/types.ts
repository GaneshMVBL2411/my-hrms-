export type AssetCategory = "laptop" | "monitor" | "keyboard" | "mouse" | "mobile" | "accessory" | "other"
export type AssetStatus = "available" | "assigned" | "retired" | "maintenance"

export interface Asset {
  id: number
  name: string
  category: AssetCategory
  serialNumber: string | null
  purchaseDate: string | null
  status: AssetStatus
  notes: string | null
  createdAt: string
  assignedToName: string | null
}

export interface AssetAssignment {
  id: number
  employeeId: number
  employeeName: string
  assignedDate: string
  returnedDate: string | null
  notes: string | null
}

export interface AssetCreate {
  name: string
  category: AssetCategory
  serialNumber?: string
  purchaseDate?: string
  notes?: string
}

export type AssetUpdate = Partial<AssetCreate> & { status?: AssetStatus }

export interface PaginatedAssets {
  items: Asset[]
  total: number
  page: number
  pageSize: number
}
