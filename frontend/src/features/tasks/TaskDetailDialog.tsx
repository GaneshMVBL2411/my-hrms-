import { useState, useEffect } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { Plus, Trash2, Send, FolderKanban, User, Calendar } from "lucide-react"
import { format } from "date-fns"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Combobox } from "@/components/shared/Combobox"
import {
  getTask,
  addChecklistItem,
  toggleChecklistItem,
  deleteChecklistItem,
  addComment,
  updateTask,
} from "@/features/tasks/api"
import { listProjects } from "@/features/projects/api"
import { listEmployees } from "@/features/employees/api"
import { useAuth } from "@/features/auth/AuthContext"
import type { Priority, TaskStatus } from "@/features/tasks/types"

const NONE_VALUE = "none"

function formatRole(role?: string | null) {
  if (!role) return "Manager"
  const map: Record<string, string> = {
    founder: "Founder",
    company_admin: "Admin",
    hr_admin: "HR Admin",
    project_manager: "Project Manager",
    team_lead: "Team Lead",
    employee: "Employee",
  }
  return map[role] || role.split("_").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ")
}

const priorityTone: Record<Priority, "danger" | "warning" | "secondary"> = {
  high: "danger",
  medium: "warning",
  low: "secondary",
}

export function TaskDetailDialog({
  taskId,
  open,
  onOpenChange,
}: {
  taskId: number | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const [newItem, setNewItem] = useState("")
  const [newComment, setNewComment] = useState("")
  const [manualProgress, setManualProgress] = useState<string>("")

  const canManage =
    (user?.role === "founder" || user?.role === "company_admin") || user?.role === "hr_admin" || user?.role === "project_manager" || user?.role === "team_lead"

  const { data: task } = useQuery({
    queryKey: ["tasks", taskId],
    queryFn: () => getTask(taskId!),
    enabled: open && !!taskId,
  })

  useEffect(() => {
    if (task) {
      setManualProgress(String(task.progress ?? 0))
    }
  }, [task?.id, task?.progress])

  const { data: projects } = useQuery({
    queryKey: ["projects", "all"],
    queryFn: () => listProjects({ page: 1, pageSize: 100 }),
    enabled: open && canManage,
  })
  const { data: employees } = useQuery({
    queryKey: ["employees", "all"],
    queryFn: () => listEmployees({ page: 1, pageSize: 500 }),
    enabled: open && canManage,
  })

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["tasks"] })
  }

  const statusMutation = useMutation({
    mutationFn: (status: TaskStatus) => updateTask(taskId!, { status }),
    onSuccess: () => {
      toast.success("Status updated")
      invalidate()
    },
    onError: () => toast.error("Could not update status"),
  })

  const progressMutation = useMutation({
    mutationFn: (progress: number) => updateTask(taskId!, { progress }),
    onSuccess: () => {
      toast.success("Progress updated")
      invalidate()
    },
    onError: () => toast.error("Could not update progress"),
  })

  const assigneeMutation = useMutation({
    mutationFn: (assignedTo: number | null) => updateTask(taskId!, { assignedTo }),
    onSuccess: () => {
      toast.success("Assignee updated")
      invalidate()
    },
    onError: () => toast.error("Could not update assignee"),
  })

  const projectMutation = useMutation({
    mutationFn: (projectId: number | null) => updateTask(taskId!, { projectId }),
    onSuccess: () => {
      toast.success("Project updated")
      invalidate()
    },
    onError: () => toast.error("Could not update project"),
  })

  const priorityMutation = useMutation({
    mutationFn: (priority: Priority) => updateTask(taskId!, { priority }),
    onSuccess: () => {
      toast.success("Priority updated")
      invalidate()
    },
    onError: () => toast.error("Could not update priority"),
  })

  const addItemMutation = useMutation({
    mutationFn: () => addChecklistItem(taskId!, newItem),
    onSuccess: () => {
      setNewItem("")
      invalidate()
    },
  })

  const toggleItemMutation = useMutation({
    mutationFn: toggleChecklistItem,
    onSuccess: invalidate,
  })

  const deleteItemMutation = useMutation({
    mutationFn: deleteChecklistItem,
    onSuccess: invalidate,
  })

  const addCommentMutation = useMutation({
    mutationFn: () => addComment(taskId!, newComment),
    onSuccess: () => {
      setNewComment("")
      invalidate()
    },
  })

  if (!task) return null

  const isAssignee = !!user?.employeeId && task.assignedTo === user.employeeId
  const canUpdateProgress = isAssignee || canManage
  const completedCount = task.checklistItems.filter((i) => i.isDone).length

  const applyProgress = (val: number) => {
    const clamped = Math.max(0, Math.min(100, Math.round(val)))
    setManualProgress(String(clamped))
    if (clamped !== task.progress) {
      progressMutation.mutate(clamped)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-xl overflow-y-auto rounded-md">
        <DialogHeader>
          <DialogTitle>{task.title}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Creator & Creation Date */}
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/60 bg-muted/30 px-3 py-2 text-xs">
            <div className="flex items-center gap-2 text-muted-foreground">
              <User className="size-3.5 text-primary" />
              <span>
                Created by <strong className="font-semibold text-foreground">{task.creatorName || "Manager"}</strong>
                {task.creatorRole && (
                  <span className="ml-1.5 inline-flex items-center rounded-sm bg-muted px-1.5 py-0.5 text-[10px] font-medium text-foreground">
                    {formatRole(task.creatorRole)}
                  </span>
                )}
              </span>
            </div>
            {task.createdAt && (
              <div className="flex items-center gap-1.5 text-muted-foreground">
                <Calendar className="size-3.5" />
                <span>{format(new Date(task.createdAt), "MMM d, yyyy")}</span>
              </div>
            )}
          </div>

          {/* Overall Project & Progress */}
          {task.projectName && (
            <div className="rounded-lg border border-border/70 bg-card p-3 space-y-2">
              <div className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-1.5 font-medium text-foreground">
                  <FolderKanban className="size-4 text-primary" />
                  <span>Overall Project: <strong className="text-foreground">{task.projectName}</strong></span>
                </div>
                <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                  {task.projectProgress ?? 0}% completed
                </span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full bg-emerald-500 transition-all duration-300"
                  style={{ width: `${Math.min(100, Math.max(0, task.projectProgress ?? 0))}%` }}
                />
              </div>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            {canManage ? (
              <Select value={task.priority} onValueChange={(v) => priorityMutation.mutate(v as Priority)}>
                <SelectTrigger className="h-7 w-28 rounded-md text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">Low</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                </SelectContent>
              </Select>
            ) : (
              <Badge variant={priorityTone[task.priority]} className="capitalize">
                {task.priority}
              </Badge>
            )}
            <Select value={task.status} onValueChange={(v) => statusMutation.mutate(v as TaskStatus)}>
              <SelectTrigger className="h-7 w-40 rounded-md text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="assigned">Assigned</SelectItem>
                <SelectItem value="in_progress">In Progress</SelectItem>
                <SelectItem value="review">Review</SelectItem>
                <SelectItem value="completed">Completed</SelectItem>
              </SelectContent>
            </Select>
            {task.dueDate && <span className="text-xs text-muted-foreground">Due {task.dueDate}</span>}
          </div>

          {/* Work Completed / Task Progress */}
          <div className="space-y-2 rounded-lg border border-border/70 bg-card p-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-foreground">Work Completed</span>
              <span className="text-xs font-bold text-primary">{task.progress}%</span>
            </div>

            <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full bg-primary transition-all duration-300"
                style={{ width: `${task.progress}%` }}
              />
            </div>

            {canUpdateProgress && (
              <div className="space-y-2 pt-1">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="flex items-center gap-1">
                    <span className="text-xs text-muted-foreground">Manual %:</span>
                    <Input
                      type="number"
                      min={0}
                      max={100}
                      value={manualProgress}
                      onChange={(e) => setManualProgress(e.target.value)}
                      onBlur={() => {
                        const num = Number(manualProgress)
                        if (!Number.isNaN(num)) applyProgress(num)
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          const num = Number(manualProgress)
                          if (!Number.isNaN(num)) applyProgress(num)
                        }
                      }}
                      className="h-7 w-16 text-center text-xs"
                    />
                    <Button
                      type="button"
                      size="xs"
                      variant="secondary"
                      className="h-7 px-2 text-xs"
                      onClick={() => {
                        const num = Number(manualProgress)
                        if (!Number.isNaN(num)) applyProgress(num)
                      }}
                    >
                      Update
                    </Button>
                  </div>

                  <div className="ml-auto flex items-center gap-1">
                    <Button
                      type="button"
                      size="xs"
                      variant="outline"
                      className="h-7 px-2 text-xs"
                      onClick={() => applyProgress((task.progress ?? 0) - 10)}
                      disabled={(task.progress ?? 0) <= 0}
                    >
                      -10%
                    </Button>
                    <Button
                      type="button"
                      size="xs"
                      variant="outline"
                      className="h-7 px-2 text-xs"
                      onClick={() => applyProgress((task.progress ?? 0) + 10)}
                      disabled={(task.progress ?? 0) >= 100}
                    >
                      +10%
                    </Button>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                  <span className="mr-1 text-[11px] text-muted-foreground">Quick:</span>
                  {[0, 25, 50, 75, 100].map((preset) => (
                    <Button
                      key={preset}
                      type="button"
                      size="xs"
                      variant={task.progress === preset ? "default" : "outline"}
                      className="h-6 px-2 text-[11px]"
                      onClick={() => applyProgress(preset)}
                    >
                      {preset}%
                    </Button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {task.description && <p className="text-sm text-muted-foreground">{task.description}</p>}

          <div className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
            <div>
              <p className="mb-1 text-xs text-muted-foreground">Project</p>
              {canManage ? (
                <Combobox
                  value={task.projectId ? String(task.projectId) : NONE_VALUE}
                  onChange={(v) => projectMutation.mutate(v === NONE_VALUE ? null : Number(v))}
                  placeholder="No project"
                  searchPlaceholder="Search projects..."
                  emptyText="No projects found."
                  options={[
                    { value: NONE_VALUE, label: "No project" },
                    ...(projects?.items ?? []).map((p) => ({ value: String(p.id), label: p.name })),
                  ]}
                />
              ) : (
                <p className="text-foreground">{task.projectName ?? "—"}</p>
              )}
            </div>
            <div>
              <p className="mb-1 text-xs text-muted-foreground">Assignee</p>
              {canManage ? (
                <Combobox
                  value={task.assignedTo ? String(task.assignedTo) : NONE_VALUE}
                  onChange={(v) => assigneeMutation.mutate(v === NONE_VALUE ? null : Number(v))}
                  placeholder="Unassigned"
                  searchPlaceholder="Search employees..."
                  emptyText="No employees found."
                  options={[
                    { value: NONE_VALUE, label: "Unassigned" },
                    ...(employees?.items ?? []).map((e) => ({ value: String(e.id), label: e.fullName })),
                  ]}
                />
              ) : (
                <p className="text-foreground">{task.assigneeName ?? "Unassigned"}</p>
              )}
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-foreground">
                Checklist ({completedCount}/{task.checklistItems.length})
              </p>
            </div>
            <div className="mt-2 space-y-1.5">
              {task.checklistItems.map((item) => (
                <div key={item.id} className="flex items-center gap-2">
                  <Checkbox checked={item.isDone} onCheckedChange={() => toggleItemMutation.mutate(item.id)} />
                  <span className={item.isDone ? "flex-1 text-sm text-muted-foreground line-through" : "flex-1 text-sm text-foreground"}>
                    {item.label}
                  </span>
                  {canManage && (
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      className="text-muted-foreground hover:text-destructive"
                      onClick={() => deleteItemMutation.mutate(item.id)}
                    >
                      <Trash2 className="size-3" />
                    </Button>
                  )}
                </div>
              ))}
            </div>
            <div className="mt-2 flex gap-2">
              <Input
                value={newItem}
                onChange={(e) => setNewItem(e.target.value)}
                placeholder="Add checklist item"
                className="h-8 rounded-md text-sm"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && newItem.trim()) addItemMutation.mutate()
                }}
              />
              <Button
                size="icon-sm"
                variant="outline"
                className="rounded-md"
                disabled={!newItem.trim()}
                onClick={() => addItemMutation.mutate()}
              >
                <Plus className="size-4" />
              </Button>
            </div>
          </div>

          <div>
            <p className="text-sm font-medium text-foreground">Comments</p>
            <div className="mt-2 space-y-3">
              {task.comments.length === 0 && <p className="text-sm text-muted-foreground">No comments yet.</p>}
              {task.comments.map((c) => (
                <div key={c.id} className="rounded-md border border-border p-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-foreground">{c.userName}</span>
                    <span className="text-xs text-muted-foreground">{format(new Date(c.createdAt), "MMM d, hh:mm a")}</span>
                  </div>
                  <p className="mt-1 text-sm text-foreground">{c.body}</p>
                </div>
              ))}
            </div>
            <div className="mt-2 flex gap-2">
              <Input
                value={newComment}
                onChange={(e) => setNewComment(e.target.value)}
                placeholder="Write a comment..."
                className="h-8 rounded-md text-sm"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && newComment.trim()) addCommentMutation.mutate()
                }}
              />
              <Button
                size="icon-sm"
                variant="outline"
                className="rounded-md"
                disabled={!newComment.trim()}
                onClick={() => addCommentMutation.mutate()}
              >
                <Send className="size-4" />
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
