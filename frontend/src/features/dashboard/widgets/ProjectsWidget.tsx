import { useQuery } from "@tanstack/react-query"
import { useNavigate } from "react-router-dom"
import { differenceInCalendarDays } from "date-fns"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { listProjects } from "@/features/projects/api"
import type { Priority, ProjectStatus } from "@/features/projects/types"

const statusTone: Record<ProjectStatus, "success" | "warning" | "secondary" | "default"> = {
  active: "success",
  on_hold: "warning",
  planning: "secondary",
  completed: "default",
}

const priorityTone: Record<Priority, "danger" | "warning" | "secondary"> = {
  high: "danger",
  medium: "warning",
  low: "secondary",
}

export function ProjectsWidget({ employeeId }: { employeeId?: number }) {
  const navigate = useNavigate()

  const { data, isLoading } = useQuery({
    queryKey: ["projects", "mine", employeeId],
    queryFn: () => listProjects({ page: 1, pageSize: 20, memberId: employeeId }),
    enabled: !!employeeId,
  })

  const projects = data?.items ?? []

  return (
    // Fills its grid cell. It sits beside the schedule, which is a whole
    // month tall, so a short card left a void the height of a calendar
    // underneath it. Stretching means the empty state is centred in a
    // full-height card instead of stranded at the top of an empty column.
    <Card className="flex h-full flex-col rounded-md border shadow-none">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base">My Projects</CardTitle>
        <Button variant="ghost" size="sm" className="rounded-md" onClick={() => navigate("/projects")}>
          View all
        </Button>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col">
        {isLoading ? (
          <Skeleton className="h-40 w-full rounded-md" />
        ) : projects.length === 0 ? (
          <p className="flex flex-1 items-center justify-center py-6 text-center text-sm text-muted-foreground">
            You're not assigned to any projects yet.
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {projects.map((project) => {
              const remainingDays = project.deadline
                ? differenceInCalendarDays(new Date(project.deadline), new Date())
                : null
              return (
                <div
                  key={project.id}
                  className="flex cursor-pointer flex-col gap-2 rounded-md border border-border p-3 hover:bg-muted/40"
                  onClick={() => navigate(`/projects/${project.id}`)}
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate text-sm font-medium text-foreground">{project.name}</p>
                    <Badge variant={statusTone[project.status]} className="shrink-0 capitalize">
                      {project.status.replace("_", " ")}
                    </Badge>
                  </div>

                  {project.techStack.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {project.techStack.slice(0, 4).map((tech) => (
                        <Badge key={tech} variant="outline" className="text-[11px]">
                          {tech}
                        </Badge>
                      ))}
                      {project.techStack.length > 4 && (
                        <Badge variant="outline" className="text-[11px]">
                          +{project.techStack.length - 4}
                        </Badge>
                      )}
                    </div>
                  )}

                  <div className="flex items-center gap-2">
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                      <div className="h-full bg-primary" style={{ width: `${project.progress}%` }} />
                    </div>
                    <span className="text-xs text-muted-foreground">{project.progress}%</span>
                  </div>

                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <Badge variant={priorityTone[project.priority]} className="capitalize">
                      {project.priority}
                    </Badge>
                    <span>{project.memberCount} members</span>
                    <span>
                      {project.deadline
                        ? remainingDays !== null && remainingDays >= 0
                          ? `${remainingDays}d left`
                          : "Overdue"
                        : "No deadline"}
                    </span>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
