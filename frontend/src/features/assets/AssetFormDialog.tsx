import { useEffect } from "react"
import { useForm, Controller } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { useMutation, useQueryClient } from "@tanstack/react-query"
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
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { createAsset, updateAsset } from "@/features/assets/api"
import type { Asset } from "@/features/assets/types"
import { errorMessage } from "@/lib/errors"

const categories = ["laptop", "monitor", "keyboard", "mouse", "mobile", "accessory", "other"] as const

const schema = z.object({
  name: z.string().min(1, "Name is required"),
  category: z.enum(categories),
  serialNumber: z.string().optional(),
  purchaseDate: z.string().optional(),
  notes: z.string().optional(),
})

type FormValues = z.infer<typeof schema>

export function AssetFormDialog({
  open,
  onOpenChange,
  asset,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  asset?: Asset
}) {
  const isEdit = !!asset
  const queryClient = useQueryClient()

  const {
    register,
    control,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: { category: "laptop" } })

  useEffect(() => {
    if (!open) return
    reset({
      name: asset?.name ?? "",
      category: asset?.category ?? "laptop",
      serialNumber: asset?.serialNumber ?? "",
      purchaseDate: asset?.purchaseDate ?? "",
      notes: asset?.notes ?? "",
    })
  }, [open, asset, reset])

  const mutation = useMutation({
    mutationFn: (values: FormValues) => {
      const payload = {
        name: values.name,
        category: values.category,
        serialNumber: values.serialNumber || undefined,
        purchaseDate: values.purchaseDate || undefined,
        notes: values.notes || undefined,
      }
      return isEdit ? updateAsset(asset!.id, payload) : createAsset(payload)
    },
    onSuccess: () => {
      toast.success(isEdit ? "Asset updated" : "Asset added")
      queryClient.invalidateQueries({ queryKey: ["assets"] })
      onOpenChange(false)
    },
    onError: (error) => {
      toast.error(errorMessage(error, "Something went wrong"))
    },
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md rounded-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit Asset" : "Add Asset"}</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit((values) => mutation.mutate(values))} className="space-y-4">
          <div className="space-y-1.5">
            <Label>Name</Label>
            <Input placeholder="MacBook Pro 14&quot;" {...register("name")} />
            {errors.name && <p className="text-xs text-destructive">{errors.name.message}</p>}
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Category</Label>
              <Controller
                control={control}
                name="category"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {categories.map((c) => (
                        <SelectItem key={c} value={c} className="capitalize">
                          {c}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Serial number</Label>
              <Input {...register("serialNumber")} />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Purchase date</Label>
            <Input type="date" {...register("purchaseDate")} />
          </div>

          <div className="space-y-1.5">
            <Label>Notes</Label>
            <Textarea rows={2} {...register("notes")} />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" className="rounded-md" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting} className="rounded-md">
              {isSubmitting && <Loader2 className="mr-2 size-4 animate-spin" />}
              {isEdit ? "Save changes" : "Add asset"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
