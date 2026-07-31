import { useEffect } from "react"
import { useForm } from "react-hook-form"
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
import { createDepartment, updateDepartment } from "@/features/employees/api"
import type { Department } from "@/features/employees/types"

interface FormValues {
  name: string
  description: string
}

export function DepartmentFormDialog({
  open,
  onOpenChange,
  department,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  department?: Department
}) {
  const isEdit = !!department
  const queryClient = useQueryClient()

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>()

  useEffect(() => {
    if (!open) return
    reset({ name: department?.name ?? "", description: department?.description ?? "" })
  }, [open, department, reset])

  const mutation = useMutation({
    mutationFn: (values: FormValues) =>
      isEdit
        ? updateDepartment(department!.id, { name: values.name, description: values.description || undefined })
        : createDepartment({ name: values.name, description: values.description || undefined }),
    onSuccess: () => {
      toast.success(isEdit ? "Department updated" : "Department created")
      queryClient.invalidateQueries({ queryKey: ["departments"] })
      onOpenChange(false)
    },
    onError: () => toast.error("Could not save department"),
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm rounded-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit Department" : "New Department"}</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit((values) => mutation.mutate(values))} className="space-y-4">
          <div className="space-y-1.5">
            <Label>Name</Label>
            <Input {...register("name", { required: true })} />
            {errors.name && <p className="text-xs text-destructive">Name is required</p>}
          </div>
          <div className="space-y-1.5">
            <Label>Description (optional)</Label>
            <Input {...register("description")} />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" className="rounded-md" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting} className="rounded-md">
              {isSubmitting && <Loader2 className="mr-2 size-4 animate-spin" />}
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
