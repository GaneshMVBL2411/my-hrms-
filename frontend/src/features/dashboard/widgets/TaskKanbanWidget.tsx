import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { useNavigate } from "react-router-dom"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { TaskDetailDialog } from "@/features/tasks/TaskDetailDialog"
import { listTasks } from "@/features/tasks/api"
import type { Priority, TaskStatus, TaskSummary } from "@/features/tasks/types"

const COLUMNS: { status: TaskStatus; label: string }[] = [
  { status: "assigned", label: "Assigned" },
  { status: "in_progress", label: "In Progress" },
  { status: "review", label: "Review" },
  { status: "completed", label: "Completed" },
]

const priorityTone: Record<Priority, "danger" | "warning" | "secondary"> = {
  high: "danger",
  medium: "warning",
  low: "secondary",
}

export function TaskKanbanWidget({ employeeId }: { employeeId?: number }) {
  const navigate = useNavigate()
  const [selectedTaskId, setSelectedTaskId] = useState<number | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ["tasks", "kanban-mine", employeeId],
    queryFn: () => listTasks({ page: 1, pageSize: 100, assignedTo: employeeId, sortBy: "dueDate", sortDir: "asc" }),
    enabled: !!employeeId,
  })

  const tasks = data?.items ?? []
  const byStatus = (status: TaskStatus): TaskSummary[] => tasks.filter((t) => t.status === status)

  return (
    <Card className="rounded-md border shadow-none">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base">My Tasks</CardTitle>
        <Button variant="ghost" size="sm" className="rounded-md" onClick={() => navigate("/tasks")}>
          View all
        </Button>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-48 w-full rounded-md" />
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {COLUMNS.map((col) => {
              const columnTasks = byStatus(col.status)
              return (
                <div key={col.status} className="flex flex-col gap-2 rounded-md bg-muted/40 p-2">
                  <div className="flex items-center justify-between px-1">
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      {col.label}
                    </p>
                    <Badge variant="outline">{columnTasks.length}</Badge>
                  </div>
                  {columnTasks.length === 0 && (
                    <p className="px-1 py-3 text-center text-xs text-muted-foreground">No tasks</p>
                  )}
                  {columnTasks.slice(0, 3).map((task) => (
                    <div
                      key={task.id}
                      className="cursor-pointer rounded-md border border-border bg-card px-2.5 py-2 hover:bg-muted/50"
                      onClick={() => setSelectedTaskId(task.id)}
                    >
                      <p className="line-clamp-2 text-xs font-medium text-foreground">{task.title}</p>
                      <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                        {task.projectName ?? "No project"}
                      </p>
                      <div className="mt-1.5 flex items-center gap-1.5">
                        <div className="h-1 flex-1 overflow-hidden rounded-full bg-muted">
                          <div className="h-full bg-primary" style={{ width: `${task.progress}%` }} />
                        </div>
                        <span className="text-[11px] text-muted-foreground">{task.progress}%</span>
                      </div>
                      <div className="mt-1.5 flex items-center justify-between">
                        <Badge variant={priorityTone[task.priority]} className="capitalize">
                          {task.priority}
                        </Badge>
                        <span className="text-[11px] text-muted-foreground">{task.dueDate ?? "—"}</span>
                      </div>
                    </div>
                  ))}
                  {columnTasks.length > 3 && (
                    <button
                      className="text-center text-[11px] text-muted-foreground hover:text-foreground"
                      onClick={() => navigate("/tasks")}
                    >
                      +{columnTasks.length - 3} more
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </CardContent>

      <TaskDetailDialog
        taskId={selectedTaskId}
        open={!!selectedTaskId}
        onOpenChange={(open) => !open && setSelectedTaskId(null)}
      />
    </Card>
  )
}
