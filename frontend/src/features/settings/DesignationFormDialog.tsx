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
import { createDesignation, updateDesignation } from "@/features/employees/api"
import type { Designation } from "@/features/employees/types"

interface FormValues {
  title: string
  description: string
}

export function DesignationFormDialog({
  open,
  onOpenChange,
  designation,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  designation?: Designation
}) {
  const isEdit = !!designation
  const queryClient = useQueryClient()

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>()

  useEffect(() => {
    if (!open) return
    reset({ title: designation?.title ?? "", description: designation?.description ?? "" })
  }, [open, designation, reset])

  const mutation = useMutation({
    mutationFn: (values: FormValues) =>
      isEdit
        ? updateDesignation(designation!.id, { title: values.title, description: values.description || undefined })
        : createDesignation({ title: values.title, description: values.description || undefined }),
    onSuccess: () => {
      toast.success(isEdit ? "Designation updated" : "Designation created")
      queryClient.invalidateQueries({ queryKey: ["designations"] })
      onOpenChange(false)
    },
    onError: () => toast.error("Could not save designation"),
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm rounded-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit Designation" : "New Designation"}</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit((values) => mutation.mutate(values))} className="space-y-4">
          <div className="space-y-1.5">
            <Label>Title</Label>
            <Input {...register("title", { required: true })} />
            {errors.title && <p className="text-xs text-destructive">Title is required</p>}
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
