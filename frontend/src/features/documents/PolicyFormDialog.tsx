import { useEffect } from "react"
import { useForm } from "react-hook-form"
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
import { createPolicy, updatePolicy } from "@/features/documents/api"
import type { Policy } from "@/features/documents/types"

const schema = z.object({
  title: z.string().min(1, "Title is required"),
  content: z.string().min(1, "Content is required"),
})

type FormValues = z.infer<typeof schema>

export function PolicyFormDialog({
  open,
  onOpenChange,
  policy,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  policy?: Policy
}) {
  const isEdit = !!policy
  const queryClient = useQueryClient()

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(schema) })

  useEffect(() => {
    if (!open) return
    reset({ title: policy?.title ?? "", content: policy?.content ?? "" })
  }, [open, policy, reset])

  const mutation = useMutation({
    mutationFn: (values: FormValues) => (isEdit ? updatePolicy(policy!.id, values) : createPolicy(values)),
    onSuccess: () => {
      toast.success(isEdit ? "Policy updated" : "Policy created")
      queryClient.invalidateQueries({ queryKey: ["policies"] })
      onOpenChange(false)
    },
    onError: () => toast.error("Could not save policy"),
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg rounded-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit Policy" : "New Policy"}</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit((values) => mutation.mutate(values))} className="space-y-4">
          <div className="space-y-1.5">
            <Label>Title</Label>
            <Input {...register("title")} />
            {errors.title && <p className="text-xs text-destructive">{errors.title.message}</p>}
          </div>

          <div className="space-y-1.5">
            <Label>Content</Label>
            <Textarea rows={8} {...register("content")} />
            {errors.content && <p className="text-xs text-destructive">{errors.content.message}</p>}
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
