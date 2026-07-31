import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { Plus, Trash2, Send } from "lucide-react"
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

  const canManage =
    user?.role === "founder" || user?.role === "hr_admin" || user?.role === "project_manager" || user?.role === "team_lead"

  const { data: task } = useQuery({
    queryKey: ["tasks", taskId],
    queryFn: () => getTask(taskId!),
    enabled: open && !!taskId,
  })

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
  const completedCount = task.checklistItems.filter((i) => i.isDone).length

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-xl overflow-y-auto rounded-md">
        <DialogHeader>
          <DialogTitle>{task.title}</DialogTitle>
        </DialogHeader>

        <div className="space-y-5">
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

          <div className="flex items-center gap-3">
            <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full bg-primary transition-all"
                style={{ width: `${task.progress}%` }}
              />
            </div>
            {isAssignee ? (
              <Select
                value={String(task.progress)}
                onValueChange={(v) => progressMutation.mutate(Number(v))}
              >
                <SelectTrigger className="h-7 w-24 rounded-md text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Array.from({ length: 11 }, (_, i) => i * 10).map((value) => (
                    <SelectItem key={value} value={String(value)}>
                      {value}%
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <span className="w-12 shrink-0 text-right text-xs text-muted-foreground">{task.progress}%</span>
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
