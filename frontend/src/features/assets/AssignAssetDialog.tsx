import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { Loader2 } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { assignAsset } from "@/features/assets/api"
import { listEmployees } from "@/features/employees/api"
import type { Asset } from "@/features/assets/types"
import { errorMessage } from "@/lib/errors"

export function AssignAssetDialog({
  asset,
  open,
  onOpenChange,
}: {
  asset: Asset | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const queryClient = useQueryClient()
  const [employeeId, setEmployeeId] = useState("")

  const { data: employees } = useQuery({
    queryKey: ["employees", "all"],
    queryFn: () => listEmployees({ page: 1, pageSize: 500 }),
    enabled: open,
  })

  const mutation = useMutation({
    mutationFn: () => assignAsset(asset!.id, Number(employeeId)),
    onSuccess: () => {
      toast.success("Asset assigned")
      queryClient.invalidateQueries({ queryKey: ["assets"] })
      setEmployeeId("")
      onOpenChange(false)
    },
    onError: (error) => {
      toast.error(errorMessage(error, "Could not assign asset"))
    },
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm rounded-md">
        <DialogHeader>
          <DialogTitle>Assign {asset?.name}</DialogTitle>
        </DialogHeader>

        <div className="space-y-1.5">
          <Label>Employee</Label>
          <Select value={employeeId} onValueChange={setEmployeeId}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Select employee" />
            </SelectTrigger>
            <SelectContent>
              {employees?.items.map((e) => (
                <SelectItem key={e.id} value={String(e.id)}>
                  {e.fullName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" className="rounded-md" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            disabled={!employeeId || mutation.isPending}
            className="rounded-md"
            onClick={() => mutation.mutate()}
          >
            {mutation.isPending && <Loader2 className="mr-2 size-4 animate-spin" />}
            Assign
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
