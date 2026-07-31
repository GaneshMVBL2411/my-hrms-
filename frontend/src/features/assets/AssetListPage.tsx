import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { Plus, Search, UserPlus, Undo2, Trash2, Laptop } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { deleteAsset, getMyAssets, listAssets, returnAsset } from "@/features/assets/api"
import { AssetFormDialog } from "@/features/assets/AssetFormDialog"
import { AssignAssetDialog } from "@/features/assets/AssignAssetDialog"
import { useAuth } from "@/features/auth/AuthContext"
import type { Asset, AssetStatus } from "@/features/assets/types"
import { errorMessage } from "@/lib/errors"

const PAGE_SIZE = 10

const statusTone: Record<AssetStatus, "success" | "warning" | "secondary" | "danger"> = {
  available: "success",
  assigned: "warning",
  maintenance: "secondary",
  retired: "danger",
}

export function AssetListPage() {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const isManager = user?.role === "founder" || user?.role === "hr_admin"
  const [search, setSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState<string | undefined>(undefined)
  const [formOpen, setFormOpen] = useState(false)
  const [assignAsset_, setAssignAsset] = useState<Asset | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ["assets", "all", { search, statusFilter }],
    queryFn: () => listAssets({ page: 1, pageSize: PAGE_SIZE, search: search || undefined, status: statusFilter }),
    enabled: isManager,
  })

  const { data: myAssets, isLoading: loadingMine } = useQuery({
    queryKey: ["assets", "mine"],
    queryFn: getMyAssets,
  })

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["assets"] })

  const returnMutation = useMutation({
    mutationFn: returnAsset,
    onSuccess: () => {
      toast.success("Asset returned")
      invalidate()
    },
    onError: (error) => {
      toast.error(errorMessage(error, "Could not return asset"))
    },
  })

  const deleteMutation = useMutation({
    mutationFn: deleteAsset,
    onSuccess: () => {
      toast.success("Asset removed")
      invalidate()
    },
    onError: () => toast.error("Could not remove asset"),
  })

  return (
    <div className="flex flex-1 flex-col gap-5">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-foreground">Assets</h1>
        {isManager && (
          <Button className="rounded-md" onClick={() => setFormOpen(true)}>
            <Plus className="mr-2 size-4" />
            Add Asset
          </Button>
        )}
      </div>

      <Tabs defaultValue={isManager ? "all" : "mine"}>
        <TabsList className="rounded-md">
          {isManager && <TabsTrigger value="all">All Assets</TabsTrigger>}
          <TabsTrigger value="mine">My Assets</TabsTrigger>
        </TabsList>

        {isManager && (
          <TabsContent value="all" className="mt-4 flex flex-col gap-4">
            <div className="flex flex-col gap-3 sm:flex-row">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Search assets..."
                  className="rounded-md pl-9"
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              <Select value={statusFilter ?? "all"} onValueChange={(v) => setStatusFilter(v === "all" ? undefined : v)}>
                <SelectTrigger className="w-full rounded-md sm:w-48">
                  <SelectValue placeholder="All statuses" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All statuses</SelectItem>
                  <SelectItem value="available">Available</SelectItem>
                  <SelectItem value="assigned">Assigned</SelectItem>
                  <SelectItem value="maintenance">Maintenance</SelectItem>
                  <SelectItem value="retired">Retired</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="overflow-hidden rounded-md border border-border bg-card">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Asset</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead>Serial No.</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Assigned To</TableHead>
                    <TableHead className="w-24" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading && (
                    <TableRow>
                      <TableCell colSpan={6}>
                        <Skeleton className="h-8 w-full rounded-md" />
                      </TableCell>
                    </TableRow>
                  )}
                  {!isLoading && (data?.items.length ?? 0) === 0 && (
                    <TableRow>
                      <TableCell colSpan={6} className="py-8 text-center text-sm text-muted-foreground">
                        No assets yet.
                      </TableCell>
                    </TableRow>
                  )}
                  {data?.items.map((asset) => (
                    <TableRow key={asset.id}>
                      <TableCell className="font-medium text-foreground">{asset.name}</TableCell>
                      <TableCell className="capitalize">{asset.category}</TableCell>
                      <TableCell>{asset.serialNumber ?? "—"}</TableCell>
                      <TableCell>
                        <Badge variant={statusTone[asset.status]} className="capitalize">
                          {asset.status}
                        </Badge>
                      </TableCell>
                      <TableCell>{asset.assignedToName ?? "—"}</TableCell>
                      <TableCell>
                        <div className="flex justify-end gap-1">
                          {asset.status === "available" && (
                            <Button variant="ghost" size="icon-sm" onClick={() => setAssignAsset(asset)}>
                              <UserPlus className="size-3.5" />
                            </Button>
                          )}
                          {asset.status === "assigned" && (
                            <Button variant="ghost" size="icon-sm" onClick={() => returnMutation.mutate(asset.id)}>
                              <Undo2 className="size-3.5" />
                            </Button>
                          )}
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            className="text-destructive hover:text-destructive"
                            onClick={() => {
                              if (confirm(`Remove ${asset.name}?`)) deleteMutation.mutate(asset.id)
                            }}
                          >
                            <Trash2 className="size-3.5" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </TabsContent>
        )}

        <TabsContent value="mine" className="mt-4">
          {loadingMine && <Skeleton className="h-24 w-full rounded-md" />}
          {!loadingMine && (myAssets?.length ?? 0) === 0 && (
            <p className="py-8 text-center text-sm text-muted-foreground">No assets currently assigned to you.</p>
          )}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {myAssets?.map((asset) => (
              <Card key={asset.id} className="rounded-md border shadow-none">
                <CardContent className="flex items-center gap-3 py-4">
                  <div className="flex size-9 items-center justify-center rounded-md bg-primary/10 text-primary">
                    <Laptop className="size-4" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-foreground">{asset.name}</p>
                    <p className="text-xs capitalize text-muted-foreground">{asset.category}</p>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>
      </Tabs>

      <AssetFormDialog open={formOpen} onOpenChange={setFormOpen} />
      <AssignAssetDialog asset={assignAsset_} open={!!assignAsset_} onOpenChange={(open) => !open && setAssignAsset(null)} />
    </div>
  )
}
