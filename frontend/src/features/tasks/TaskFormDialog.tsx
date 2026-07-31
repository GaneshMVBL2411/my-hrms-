import { useEffect } from "react"
import { useForm, Controller } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
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
import { Combobox } from "@/components/shared/Combobox"
import { createTask, updateTask } from "@/features/tasks/api"
import { listProjects } from "@/features/projects/api"
import { listEmployees } from "@/features/employees/api"
import type { Task } from "@/features/tasks/types"

const schema = z.object({
  title: z.string().min(1, "Title is required"),
  description: z.string().optional(),
  projectId: z.string().optional(),
  assignedTo: z.string().optional(),
  priority: z.enum(["low", "medium", "high"]),
  dueDate: z.string().optional(),
  status: z.enum(["assigned", "in_progress", "review", "completed"]),
})

type FormValues = z.infer<typeof schema>

export function TaskFormDialog({
  open,
  onOpenChange,
  task,
  defaultProjectId,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  task?: Task
  defaultProjectId?: number
}) {
  const isEdit = !!task
  const queryClient = useQueryClient()

  const { data: projects } = useQuery({
    queryKey: ["projects", "all"],
    queryFn: () => listProjects({ page: 1, pageSize: 100 }),
  })
  const { data: employees } = useQuery({
    queryKey: ["employees", "all"],
    queryFn: () => listEmployees({ page: 1, pageSize: 500 }),
  })

  const {
    register,
    control,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { priority: "medium", status: "assigned" },
  })

  useEffect(() => {
    if (!open) return
    reset({
      title: task?.title ?? "",
      description: task?.description ?? "",
      projectId: task?.projectId ? String(task.projectId) : defaultProjectId ? String(defaultProjectId) : undefined,
      assignedTo: task?.assignedTo ? String(task.assignedTo) : undefined,
      priority: task?.priority ?? "medium",
      dueDate: task?.dueDate ?? "",
      status: task?.status ?? "assigned",
    })
  }, [open, task, defaultProjectId, reset])

  const mutation = useMutation({
    mutationFn: (values: FormValues) => {
      const payload = {
        title: values.title,
        description: values.description || undefined,
        projectId: values.projectId ? Number(values.projectId) : undefined,
        assignedTo: values.assignedTo ? Number(values.assignedTo) : undefined,
        priority: values.priority,
        dueDate: values.dueDate || undefined,
        status: values.status,
      }
      return isEdit ? updateTask(task!.id, payload) : createTask(payload)
    },
    onSuccess: () => {
      toast.success(isEdit ? "Task updated" : "Task created")
      queryClient.invalidateQueries({ queryKey: ["tasks"] })
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
          <DialogTitle>{isEdit ? "Edit Task" : "Create Task"}</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit((values) => mutation.mutate(values))} className="space-y-4">
          <div className="space-y-1.5">
            <Label>Title</Label>
            <Input {...register("title")} />
            {errors.title && <p className="text-xs text-destructive">{errors.title.message}</p>}
          </div>

          <div className="space-y-1.5">
            <Label>Description</Label>
            <Textarea rows={3} {...register("description")} />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Project</Label>
              <Controller
                control={control}
                name="projectId"
                render={({ field }) => (
                  <Combobox
                    value={field.value}
                    onChange={field.onChange}
                    placeholder="No project"
                    searchPlaceholder="Search projects..."
                    emptyText="No projects found."
                    options={(projects?.items ?? []).map((p) => ({ value: String(p.id), label: p.name }))}
                  />
                )}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Assignee</Label>
              <Controller
                control={control}
                name="assignedTo"
                render={({ field }) => (
                  <Combobox
                    value={field.value}
                    onChange={field.onChange}
                    placeholder="Unassigned"
                    searchPlaceholder="Search employees..."
                    emptyText="No employees found."
                    options={(employees?.items ?? []).map((e) => ({ value: String(e.id), label: e.fullName }))}
                  />
                )}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
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
                      <SelectItem value="assigned">Assigned</SelectItem>
                      <SelectItem value="in_progress">In Progress</SelectItem>
                      <SelectItem value="review">Review</SelectItem>
                      <SelectItem value="completed">Completed</SelectItem>
                    </SelectContent>
                  </Select>
                )}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Due date</Label>
              <Input type="date" {...register("dueDate")} />
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" className="rounded-md" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting} className="rounded-md">
              {isSubmitting && <Loader2 className="mr-2 size-4 animate-spin" />}
              {isEdit ? "Save changes" : "Create task"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
