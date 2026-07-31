import { useEffect } from "react"
import { useForm, Controller } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import axios from "axios"
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
import { createProject, updateProject } from "@/features/projects/api"
import type { Project } from "@/features/projects/types"

const schema = z.object({
  name: z.string().min(1, "Project name is required"),
  description: z.string().optional(),
  techStack: z.string().optional(),
  priority: z.enum(["low", "medium", "high"]),
  status: z.enum(["planning", "active", "on_hold", "completed"]),
  deadline: z.string().optional(),
  progress: z.string(),
})

type FormValues = z.infer<typeof schema>

export function ProjectFormDialog({
  open,
  onOpenChange,
  project,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  project?: Project
}) {
  const isEdit = !!project
  const queryClient = useQueryClient()

  const {
    register,
    control,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { priority: "medium", status: "planning", progress: "0" },
  })

  useEffect(() => {
    if (!open) return
    reset({
      name: project?.name ?? "",
      description: project?.description ?? "",
      techStack: project?.techStack.join(", ") ?? "",
      priority: project?.priority ?? "medium",
      status: project?.status ?? "planning",
      deadline: project?.deadline ?? "",
      progress: String(project?.progress ?? 0),
    })
  }, [open, project, reset])

  const mutation = useMutation({
    mutationFn: (values: FormValues) => {
      const payload = {
        name: values.name,
        description: values.description || undefined,
        techStack: values.techStack
          ? values.techStack.split(",").map((s) => s.trim()).filter(Boolean)
          : undefined,
        priority: values.priority,
        status: values.status,
        deadline: values.deadline || undefined,
        progress: Number(values.progress) || 0,
      }
      return isEdit ? updateProject(project!.id, payload) : createProject(payload)
    },
    onSuccess: () => {
      toast.success(isEdit ? "Project updated" : "Project created")
      queryClient.invalidateQueries({ queryKey: ["projects"] })
      onOpenChange(false)
    },
    onError: (error) => {
      const detail = axios.isAxiosError(error) ? (error.response?.data as { detail?: string })?.detail : undefined
      toast.error(detail ?? "Something went wrong")
    },
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg rounded-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit Project" : "Create Project"}</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit((values) => mutation.mutate(values))} className="space-y-4">
          <div className="space-y-1.5">
            <Label>Project name</Label>
            <Input {...register("name")} />
            {errors.name && <p className="text-xs text-destructive">{errors.name.message}</p>}
          </div>

          <div className="space-y-1.5">
            <Label>Description</Label>
            <Textarea rows={3} {...register("description")} />
          </div>

          <div className="space-y-1.5">
            <Label>Tech stack (comma separated)</Label>
            <Input placeholder="React, FastAPI, PostgreSQL" {...register("techStack")} />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Priority</Label>
              <Controller
                control={control}
                name="priority"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="low">Low</SelectItem>
                      <SelectItem value="medium">Medium</SelectItem>
                      <SelectItem value="high">High</SelectItem>
                    </SelectContent>
                  </Select>
                )}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Status</Label>
              <Controller
                control={control}
                name="status"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="planning">Planning</SelectItem>
                      <SelectItem value="active">Active</SelectItem>
                      <SelectItem value="on_hold">On Hold</SelectItem>
                      <SelectItem value="completed">Completed</SelectItem>
                    </SelectContent>
                  </Select>
                )}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Deadline</Label>
              <Input type="date" {...register("deadline")} />
            </div>
            <div className="space-y-1.5">
              <Label>Progress (%)</Label>
              <Input type="number" min={0} max={100} {...register("progress")} />
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" className="rounded-md" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting} className="rounded-md">
              {isSubmitting && <Loader2 className="mr-2 size-4 animate-spin" />}
              {isEdit ? "Save changes" : "Create project"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
