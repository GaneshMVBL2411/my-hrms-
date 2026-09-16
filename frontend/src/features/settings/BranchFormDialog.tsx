import { useEffect } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { createBranch, updateBranch } from "@/features/employees/api"
import type { Branch } from "@/features/employees/types"

const schema = z.object({
  name: z.string().min(2, "Give the office a name"),
  // Shown in the attendance sheet, where the column is narrow.
  code: z.string().max(20, "Keep it short — BLR, HYD").optional(),
  address: z.string().max(500).optional(),
  city: z.string().max(100).optional(),
  state: z.string().max(100).optional(),
})

type FormValues = z.infer<typeof schema>

/** Adds an office, or renames one. The same dialog does both. */
export function BranchFormDialog({
  open,
  onOpenChange,
  branch,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  branch?: Branch
}) {
  const queryClient = useQueryClient()
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(schema) })

  useEffect(() => {
    if (!open) return
    reset({
      name: branch?.name ?? "",
      code: branch?.code ?? "",
      address: branch?.address ?? "",
      city: branch?.city ?? "",
      state: branch?.state ?? "",
    })
  }, [open, branch, reset])

  const save = useMutation({
    mutationFn: (values: FormValues) =>
      branch ? updateBranch(branch.id, values) : createBranch(values).then(() => undefined),
    onSuccess: () => {
      toast.success(branch ? "Office updated" : "Office added")
      queryClient.invalidateQueries({ queryKey: ["branches"] })
      onOpenChange(false)
    },
    onError: (error: Error) => toast.error(error.message || "Could not save the office"),
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-md sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{branch ? "Edit office" : "New office"}</DialogTitle>
        </DialogHeader>

        <form className="flex flex-col gap-4" onSubmit={handleSubmit((v) => save.mutate(v))}>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="flex flex-col gap-1.5 sm:col-span-2">
              <Label htmlFor="branch-name">Name</Label>
              <Input id="branch-name" placeholder="Bengaluru" className="rounded-md" {...register("name")} />
              {errors.name && <p className="text-xs text-danger">{errors.name.message}</p>}
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="branch-code">Short code</Label>
              <Input id="branch-code" placeholder="BLR" className="rounded-md" {...register("code")} />
              {errors.code && <p className="text-xs text-danger">{errors.code.message}</p>}
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="branch-address">Address</Label>
            <Input id="branch-address" placeholder="Plot 12, Hitech City" className="rounded-md" {...register("address")} />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="branch-city">City</Label>
              <Input id="branch-city" className="rounded-md" {...register("city")} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="branch-state">State</Label>
              <Input id="branch-state" className="rounded-md" {...register("state")} />
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" className="rounded-md" disabled={isSubmitting || save.isPending}>
              {branch ? "Save" : "Add office"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
