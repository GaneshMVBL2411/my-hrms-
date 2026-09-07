import { useEffect, useState } from "react"
import { useForm, Controller } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { Loader2, X, Paperclip } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { createTask, updateTask } from "@/features/tasks/api"
import { listProjects } from "@/features/projects/api"
import { listEmployees } from "@/features/employees/api"
import type { Task, TaskStatus } from "@/features/tasks/types"
import { errorMessage } from "@/lib/errors"

const schema = z.object({
  isActive: z.boolean(),
  title: z.string().min(1, "Title is required"),
  projectId: z.string().min(1, "Project is required"),
  projectStage: z.string().min(1, "Project Stage is required"),
  taskManagers: z.array(z.number()),
  taskMembers: z.array(z.number()),
  status: z.enum(["todo", "to_do", "assigned", "in_progress", "review", "completed", "on_hold", "cancelled"]),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  dueDate: z.string().optional(),
  taskFileName: z.string().optional(),
  taskFileUrl: z.string().optional(),
  description: z.string().min(1, "Description is required"),
})

type FormValues = {
  isActive: boolean
  title: string
  projectId: string
  projectStage: string
  taskManagers: number[]
  taskMembers: number[]
  status: TaskStatus
  startDate?: string
  endDate?: string
  dueDate?: string
  taskFileName?: string
  taskFileUrl?: string
  description: string
}

const PROJECT_STAGES = ["Todo", "In Progress", "Code Review", "Testing", "Deployment", "Done"]

const STATUS_OPTIONS: { value: TaskStatus; label: string }[] = [
  { value: "todo", label: "To Do" },
  { value: "in_progress", label: "In Progress" },
  { value: "review", label: "Review" },
  { value: "completed", label: "Completed" },
  { value: "on_hold", label: "On Hold" },
  { value: "cancelled", label: "Cancelled" },
]

function MultiEmployeeSelect({
  selectedIds,
  onChange,
  employees,
  placeholder = "Select employee...",
}: {
  selectedIds: number[]
  onChange: (ids: number[]) => void
  employees: Array<{ id: number; fullName: string; employeeCode?: string }>
  placeholder?: string
}) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState("")

  const filtered = employees.filter((e) => {
    if (selectedIds.includes(e.id)) return false
    if (!search.trim()) return true
    const s = search.toLowerCase()
    return (
      e.fullName.toLowerCase().includes(s) ||
      (e.employeeCode && e.employeeCode.toLowerCase().includes(s))
    )
  })

  return (
    <div className="relative">
      <div
        className="min-h-[42px] max-h-[88px] overflow-y-auto w-full rounded-md border border-input bg-background p-1.5 flex flex-wrap items-center gap-1.5 focus-within:ring-2 focus-within:ring-[#e54f38] focus-within:border-transparent text-sm cursor-text transition-all"
        onClick={() => setOpen(true)}
      >
        {selectedIds.map((id) => {
          const emp = employees.find((e) => e.id === id)
          const code = emp?.employeeCode || `PEP${id}`
          const label = emp ? `${emp.fullName} (${code})` : `Employee #${id}`
          return (
            <span
              key={id}
              className="inline-flex items-center gap-1 px-2 py-0.5 bg-muted text-foreground text-xs rounded border border-border font-medium shadow-2xs"
            >
              <button
                type="button"
                onClick={(ev) => {
                  ev.stopPropagation()
                  onChange(selectedIds.filter((item) => item !== id))
                }}
                className="text-muted-foreground hover:text-foreground mr-0.5 text-[10px] leading-none"
                title="Remove"
              >
                ✕
              </button>
              {label}
            </span>
          )
        })}

        <button
          type="button"
          onClick={(ev) => {
            ev.stopPropagation()
            setOpen(!open)
          }}
          className="text-xs text-muted-foreground hover:text-foreground px-1.5 py-0.5 rounded flex items-center gap-1 ml-auto"
        >
          <span className="text-muted-foreground/60">{selectedIds.length === 0 ? placeholder : "+ Add"}</span>
        </button>
      </div>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute left-0 right-0 top-full mt-1 z-50 bg-popover text-popover-foreground rounded-md border border-border shadow-lg max-h-48 overflow-y-auto p-1">
            <input
              type="text"
              className="w-full px-2 py-1.5 text-xs border-b border-border bg-transparent outline-none mb-1 text-foreground placeholder:text-muted-foreground"
              placeholder="Search by name or code..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              autoFocus
            />
            {filtered.length === 0 ? (
              <div className="px-3 py-2 text-xs text-muted-foreground">No matching employees found.</div>
            ) : (
              filtered.slice(0, 25).map((emp) => {
                const code = emp.employeeCode || `PEP${emp.id}`
                return (
                  <div
                    key={emp.id}
                    onClick={() => {
                      onChange([...selectedIds, emp.id])
                      setSearch("")
                    }}
                    className="px-2.5 py-1.5 text-xs rounded hover:bg-accent hover:text-accent-foreground cursor-pointer flex items-center justify-between"
                  >
                    <span className="font-medium">{emp.fullName}</span>
                    <span className="text-[11px] text-muted-foreground font-mono">({code})</span>
                  </div>
                )
              })
            )}
          </div>
        </>
      )}
    </div>
  )
}

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
  const [fileName, setFileName] = useState<string>("")

  const { data: projects } = useQuery({
    queryKey: ["projects", "all"],
    queryFn: () => listProjects({ page: 1, pageSize: 100 }),
  })
  const { data: employees } = useQuery({
    queryKey: ["employees", "all"],
    queryFn: () => listEmployees({ page: 1, pageSize: 500 }),
  })

  const employeeItems = employees?.items ?? []

  const {
    register,
    control,
    handleSubmit,
    reset,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema) as any,
    defaultValues: {
      isActive: true,
      title: "",
      projectId: "",
      projectStage: "Todo",
      status: "todo",
      taskManagers: [],
      taskMembers: [],
      description: "",
    },
  })

  useEffect(() => {
    if (!open) return
    reset({
      isActive: task?.isActive ?? true,
      title: task?.title ?? "",
      description: task?.description ?? "",
      projectId: task?.projectId ? String(task.projectId) : defaultProjectId ? String(defaultProjectId) : "",
      projectStage: task?.projectStage ?? "Todo",
      taskManagers: task?.taskManagers ?? [],
      taskMembers: task?.taskMembers ?? (task?.assignedTo ? [task.assignedTo] : []),
      status: (task?.status as any) ?? "todo",
      startDate: task?.startDate ?? "",
      endDate: task?.endDate ?? task?.dueDate ?? "",
      taskFileName: task?.taskFileName ?? "",
      taskFileUrl: task?.taskFileUrl ?? "",
    })
    setFileName(task?.taskFileName ?? "")
  }, [open, task, defaultProjectId, reset])

  const mutation = useMutation({
    mutationFn: (values: FormValues) => {
      const payload = {
        isActive: values.isActive,
        title: values.title,
        description: values.description,
        projectId: values.projectId ? Number(values.projectId) : undefined,
        projectStage: values.projectStage,
        taskManagers: values.taskManagers,
        taskMembers: values.taskMembers,
        assignedTo: values.taskMembers[0] ?? values.taskManagers[0] ?? undefined,
        status: values.status,
        startDate: values.startDate || undefined,
        endDate: values.endDate || undefined,
        dueDate: values.endDate || undefined,
        taskFileName: fileName || values.taskFileName || undefined,
      }
      return isEdit ? updateTask(task!.id, payload) : createTask(payload)
    },
    onSuccess: () => {
      toast.success(isEdit ? "Task updated" : "Task created")
      queryClient.invalidateQueries({ queryKey: ["tasks"] })
      onOpenChange(false)
    },
    onError: (error) => {
      toast.error(errorMessage(error, "Something went wrong"))
    },
  })

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      setFileName(file.name)
      setValue("taskFileName", file.name)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl sm:max-w-3xl rounded-xl p-0 overflow-hidden border border-border shadow-2xl bg-card">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border bg-background">
          <DialogTitle className="text-lg font-bold text-foreground">
            {isEdit ? "Edit Task" : "Create Task"}
          </DialogTitle>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="rounded-full p-1 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            <X className="size-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit((values) => mutation.mutate(values))} className="p-6 space-y-5">
          {/* Row 1: Is Active & Title */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 items-start">
            <div className="space-y-2">
              <Label className="text-xs font-semibold text-foreground tracking-wide">
                Is Active
              </Label>
              <Controller
                control={control}
                name="isActive"
                render={({ field }) => (
                  <div className="pt-1">
                    <button
                      type="button"
                      role="switch"
                      aria-checked={field.value}
                      onClick={() => field.onChange(!field.value)}
                      className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-[#e54f38] focus:ring-offset-2 ${
                        field.value ? "bg-[#e54f38]" : "bg-gray-300 dark:bg-gray-700"
                      }`}
                    >
                      <span
                        aria-hidden="true"
                        className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-md ring-0 transition duration-200 ease-in-out ${
                          field.value ? "translate-x-5" : "translate-x-0"
                        }`}
                      />
                    </button>
                  </div>
                )}
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-foreground tracking-wide">
                Title <span className="text-red-500">*</span>
              </Label>
              <Input
                {...register("title")}
                placeholder="e.g. Asset Module"
                className="h-10 rounded-md border-input focus-visible:ring-[#e54f38]"
              />
              {errors.title && <p className="text-xs text-destructive">{errors.title.message}</p>}
            </div>
          </div>

          {/* Row 2: Project & Project Stage */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 items-start">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-foreground tracking-wide">
                Project <span className="text-red-500">*</span>
              </Label>
              <Controller
                control={control}
                name="projectId"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger className="h-10 w-full rounded-md border-input focus:ring-[#e54f38]">
                      <SelectValue placeholder="Select Project" />
                    </SelectTrigger>
                    <SelectContent>
                      {(projects?.items ?? []).map((p) => (
                        <SelectItem key={p.id} value={String(p.id)}>
                          {p.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
              {errors.projectId && <p className="text-xs text-destructive">{errors.projectId.message}</p>}
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-foreground tracking-wide">
                Project Stage <span className="text-red-500">*</span>
              </Label>
              <Controller
                control={control}
                name="projectStage"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger className="h-10 w-full rounded-md border-input focus:ring-[#e54f38]">
                      <SelectValue placeholder="Select Stage" />
                    </SelectTrigger>
                    <SelectContent>
                      {PROJECT_STAGES.map((stage) => (
                        <SelectItem key={stage} value={stage}>
                          {stage}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
              {errors.projectStage && <p className="text-xs text-destructive">{errors.projectStage.message}</p>}
            </div>
          </div>

          {/* Row 3: Task Managers & Task Members */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 items-start">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-foreground tracking-wide">
                Task Managers
              </Label>
              <Controller
                control={control}
                name="taskManagers"
                render={({ field }) => (
                  <MultiEmployeeSelect
                    selectedIds={field.value ?? []}
                    onChange={field.onChange}
                    employees={employeeItems}
                    placeholder="Choose managers..."
                  />
                )}
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-foreground tracking-wide">
                Task Members
              </Label>
              <Controller
                control={control}
                name="taskMembers"
                render={({ field }) => (
                  <MultiEmployeeSelect
                    selectedIds={field.value ?? []}
                    onChange={field.onChange}
                    employees={employeeItems}
                    placeholder="Choose members..."
                  />
                )}
              />
            </div>
          </div>

          {/* Row 4: Status & Start Date */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 items-start">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-foreground tracking-wide">
                Status <span className="text-red-500">*</span>
              </Label>
              <Controller
                control={control}
                name="status"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger className="h-10 w-full rounded-md border-input focus:ring-[#e54f38]">
                      <SelectValue placeholder="Select Status" />
                    </SelectTrigger>
                    <SelectContent>
                      {STATUS_OPTIONS.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
              {errors.status && <p className="text-xs text-destructive">{errors.status.message}</p>}
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-foreground tracking-wide">
                Start Date
              </Label>
              <div className="relative">
                <Input
                  type="date"
                  {...register("startDate")}
                  className="h-10 rounded-md border-input focus-visible:ring-[#e54f38]"
                />
              </div>
            </div>
          </div>

          {/* Row 5: End Date & Task File */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 items-start">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-foreground tracking-wide">
                End Date
              </Label>
              <div className="relative">
                <Input
                  type="date"
                  {...register("endDate")}
                  className="h-10 rounded-md border-input focus-visible:ring-[#e54f38]"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-foreground tracking-wide">
                Task File
              </Label>
              <div className="flex items-center gap-2 pt-1">
                <label className="inline-flex items-center justify-center px-3 py-2 border border-input rounded-md bg-muted/70 hover:bg-muted text-xs font-medium text-foreground cursor-pointer shadow-2xs transition-colors">
                  <Paperclip className="size-3.5 mr-1.5 text-muted-foreground" />
                  Choose File
                  <input
                    type="file"
                    className="hidden"
                    onChange={handleFileSelect}
                  />
                </label>
                <span className="text-xs text-muted-foreground truncate max-w-[170px]" title={fileName}>
                  {fileName || "No file chosen"}
                </span>
                {fileName && (
                  <button
                    type="button"
                    onClick={() => {
                      setFileName("")
                      setValue("taskFileName", "")
                    }}
                    className="text-xs text-destructive hover:underline ml-auto"
                  >
                    Clear
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Row 6: Description */}
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold text-foreground tracking-wide">
              Description <span className="text-red-500">*</span>
            </Label>
            <Textarea
              rows={4}
              {...register("description")}
              placeholder="Asset Management System is a key feature of our HRMS that enables employees to request and manage assets..."
              className="rounded-md border-input min-h-[110px] resize-y focus-visible:ring-[#e54f38] text-sm leading-relaxed"
            />
            {errors.description && <p className="text-xs text-destructive">{errors.description.message}</p>}
          </div>

          {/* Footer Save Button */}
          <div className="flex justify-end pt-2">
            <Button
              type="submit"
              disabled={isSubmitting}
              className="bg-[#e54f38] hover:bg-[#cf422d] active:bg-[#b83824] text-white font-medium px-7 py-2.5 rounded-md shadow-sm transition-all"
            >
              {isSubmitting && <Loader2 className="mr-2 size-4 animate-spin" />}
              Save
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

