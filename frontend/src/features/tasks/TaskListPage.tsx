import { useState } from "react"
import { useSearchParams } from "react-router-dom"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { Plus, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { deleteTask, listTasks } from "@/features/tasks/api"
import { TaskFormDialog } from "@/features/tasks/TaskFormDialog"
import { TaskDetailDialog } from "@/features/tasks/TaskDetailDialog"
import { useAuth } from "@/features/auth/AuthContext"
import type { Priority, TaskStatus } from "@/features/tasks/types"

const PAGE_SIZE = 20

const statusTone: Record<TaskStatus, "secondary" | "warning" | "default" | "success" | "danger"> = {
  todo: "secondary",
  to_do: "secondary",
  assigned: "secondary",
  in_progress: "warning",
  review: "default",
  completed: "success",
  on_hold: "warning",
  cancelled: "danger",
}

const priorityTone: Record<Priority, "danger" | "warning" | "secondary"> = {
  high: "danger",
  medium: "warning",
  low: "secondary",
}

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

export function TaskListPage({ projectId, embedded = false }: { projectId?: number; embedded?: boolean }) {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const [searchParams, setSearchParams] = useSearchParams()
  const [formOpen, setFormOpen] = useState(false)
  const [selectedTaskId, setSelectedTaskId] = useState<number | null>(null)

  const statusFilter = searchParams.get("taskStatus") ?? undefined
  const isManagerTier =
    (user?.role === "founder" || user?.role === "company_admin") || user?.role === "hr_admin" || user?.role === "project_manager" || user?.role === "team_lead"

  const { data, isLoading } = useQuery({
    queryKey: ["tasks", { projectId, statusFilter }],
    queryFn: () =>
      listTasks({
        page: 1,
        pageSize: PAGE_SIZE,
        projectId,
        status: statusFilter,
        sortBy: "dueDate",
        sortDir: "asc",
      }),
  })

  const deleteMutation = useMutation({
    mutationFn: deleteTask,
    onSuccess: () => {
      toast.success("Task deleted")
      queryClient.invalidateQueries({ queryKey: ["tasks"] })
    },
    onError: () => toast.error("Could not delete task"),
  })

  const updateStatusParam = (value: string | undefined) => {
    const next = new URLSearchParams(searchParams)
    if (value) next.set("taskStatus", value)
    else next.delete("taskStatus")
    setSearchParams(next)
  }

  return (
    <div className={embedded ? "flex flex-col gap-4" : "flex flex-1 flex-col gap-5"}>
      <div className="flex items-center justify-between">
        {!embedded && (
          <div>
            <h1 className="text-xl font-semibold text-foreground">Tasks</h1>
            <p className="text-sm text-muted-foreground">{data?.total ?? 0} tasks</p>
          </div>
        )}
        <div className="flex items-center gap-2">
          <Select value={statusFilter ?? "all"} onValueChange={(v) => updateStatusParam(v === "all" ? undefined : v)}>
            <SelectTrigger className="w-32 sm:w-40 rounded-xl">
              <SelectValue placeholder="All statuses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="todo">To Do</SelectItem>
              <SelectItem value="in_progress">In Progress</SelectItem>
              <SelectItem value="review">Review</SelectItem>
              <SelectItem value="completed">Completed</SelectItem>
              <SelectItem value="on_hold">On Hold</SelectItem>
              <SelectItem value="cancelled">Cancelled</SelectItem>
            </SelectContent>
          </Select>
          {isManagerTier && (
            <Button className="rounded-xl shadow-xs" onClick={() => setFormOpen(true)}>
              <Plus className="mr-2 size-4" />
              New Task
            </Button>
          )}
        </div>
      </div>

      <div className="overflow-x-auto touch-pan-x rounded-xl border border-border bg-card shadow-2xs">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Task</TableHead>
              {!projectId && <TableHead>Project</TableHead>}
              <TableHead>Assignee</TableHead>
              <TableHead>Priority</TableHead>
              <TableHead>Due Date</TableHead>
              <TableHead>Progress</TableHead>
              <TableHead>Status</TableHead>
              {isManagerTier && <TableHead className="w-12" />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && (
              <TableRow>
                <TableCell colSpan={8}>
                  <Skeleton className="h-8 w-full rounded-md" />
                </TableCell>
              </TableRow>
            )}
            {!isLoading && (data?.items.length ?? 0) === 0 && (
              <TableRow>
                <TableCell colSpan={8} className="py-8 text-center text-sm text-muted-foreground">
                  No tasks found.
                </TableCell>
              </TableRow>
            )}
            {data?.items.map((task) => (
              <TableRow key={task.id} className="cursor-pointer" onClick={() => setSelectedTaskId(task.id)}>
                <TableCell className="font-medium text-foreground">
                  <div>
                    <span>{task.title}</span>
                    {task.creatorName && (
                      <span className="block text-[11px] font-normal text-muted-foreground">
                        by {task.creatorName} ({formatRole(task.creatorRole)})
                      </span>
                    )}
                  </div>
                </TableCell>
                {!projectId && (
                  <TableCell>
                    <div>
                      <span>{task.projectName ?? "—"}</span>
                      {task.projectName && task.projectProgress !== null && task.projectProgress !== undefined && (
                        <span className="block text-[11px] text-muted-foreground">
                          {task.projectProgress}% overall
                        </span>
                      )}
                    </div>
                  </TableCell>
                )}
                <TableCell>{task.assigneeName ?? "Unassigned"}</TableCell>
                <TableCell>
                  <Badge variant={priorityTone[task.priority]} className="capitalize">
                    {task.priority}
                  </Badge>
                </TableCell>
                <TableCell>{task.dueDate ?? "—"}</TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <div className="h-1.5 w-16 overflow-hidden rounded-full bg-muted">
                      <div className="h-full bg-primary" style={{ width: `${task.progress}%` }} />
                    </div>
                    <span className="text-xs text-muted-foreground">{task.progress}%</span>
                  </div>
                </TableCell>
                <TableCell>
                  <Badge variant={statusTone[task.status]} className="capitalize">
                    {task.status.replace("_", " ")}
                  </Badge>
                </TableCell>
                {isManagerTier && (
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="text-destructive hover:text-destructive"
                      onClick={() => {
                        if (confirm(`Delete task "${task.title}"?`)) deleteMutation.mutate(task.id)
                      }}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <TaskFormDialog open={formOpen} onOpenChange={setFormOpen} defaultProjectId={projectId} />
      <TaskDetailDialog taskId={selectedTaskId} open={!!selectedTaskId} onOpenChange={(open) => !open && setSelectedTaskId(null)} />
    </div>
  )
}
