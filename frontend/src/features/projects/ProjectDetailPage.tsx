import { useState } from "react"
import { useParams, useNavigate } from "react-router-dom"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { ArrowLeft, Pencil, UserPlus, X } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { getProject, addMember, removeMember } from "@/features/projects/api"
import { listEmployees } from "@/features/employees/api"
import { ProjectFormDialog } from "@/features/projects/ProjectFormDialog"
import { TaskListPage } from "@/features/tasks/TaskListPage"
import { useAuth } from "@/features/auth/AuthContext"
import type { Priority, ProjectStatus } from "@/features/projects/types"
import { errorMessage } from "@/lib/errors"

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

export function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const projectId = Number(id)
  const [editOpen, setEditOpen] = useState(false)
  const [selectedEmployee, setSelectedEmployee] = useState<string>("")

  const canManage = (user?.role === "founder" || user?.role === "company_admin") || user?.role === "hr_admin" || user?.role === "project_manager"

  const { data: project, isLoading } = useQuery({
    queryKey: ["projects", projectId],
    queryFn: () => getProject(projectId),
    enabled: Number.isFinite(projectId),
  })

  const { data: employees } = useQuery({
    queryKey: ["employees", "all"],
    queryFn: () => listEmployees({ page: 1, pageSize: 500 }),
    enabled: canManage,
  })

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["projects", projectId] })

  const addMemberMutation = useMutation({
    mutationFn: (employeeId: number) => addMember(projectId, employeeId),
    onSuccess: () => {
      toast.success("Member added")
      setSelectedEmployee("")
      invalidate()
    },
    onError: (error) => {
      toast.error(errorMessage(error, "Could not add member"))
    },
  })

  const removeMemberMutation = useMutation({
    mutationFn: (employeeId: number) => removeMember(projectId, employeeId),
    onSuccess: () => {
      toast.success("Member removed")
      invalidate()
    },
  })

  if (isLoading || !project) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-40 rounded-md" />
        <Skeleton className="h-48 w-full rounded-md" />
      </div>
    )
  }

  const availableEmployees = employees?.items.filter(
    (e) => !project.members.some((m) => m.employeeId === e.id)
  )

  return (
    <div className="flex flex-1 flex-col gap-5">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" className="rounded-md" onClick={() => navigate("/projects")}>
          <ArrowLeft className="size-4" />
        </Button>
        <h1 className="text-xl font-semibold text-foreground">{project.name}</h1>
      </div>

      <Card className="rounded-md border shadow-none">
        <CardContent className="flex flex-col gap-4 py-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={priorityTone[project.priority]} className="capitalize">
              {project.priority}
            </Badge>
            <Badge variant={statusTone[project.status]} className="capitalize">
              {project.status.replace("_", " ")}
            </Badge>
            {project.deadline && (
              <span className="text-sm text-muted-foreground">Due {project.deadline}</span>
            )}
            <span className="text-sm text-muted-foreground">{project.progress}% complete</span>
          </div>
          {canManage && (
            <Button variant="outline" className="rounded-md" onClick={() => setEditOpen(true)}>
              <Pencil className="mr-2 size-4" />
              Edit
            </Button>
          )}
        </CardContent>
      </Card>

      <Tabs defaultValue="overview">
        <TabsList className="rounded-md">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="members">Members</TabsTrigger>
          <TabsTrigger value="tasks">Tasks</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-4">
          <Card className="rounded-md border shadow-none">
            <CardContent className="space-y-4 py-6">
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Description</p>
                <p className="mt-1 text-sm text-foreground">{project.description ?? "No description provided."}</p>
              </div>
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Tech Stack</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {project.techStack.length > 0 ? (
                    project.techStack.map((tech) => (
                      <Badge key={tech} variant="outline">
                        {tech}
                      </Badge>
                    ))
                  ) : (
                    <span className="text-sm text-muted-foreground">Not specified</span>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="members" className="mt-4">
          <Card className="rounded-md border shadow-none">
            <CardContent className="space-y-3 py-6">
              {canManage && (
                <div className="flex gap-2">
                  <Select value={selectedEmployee} onValueChange={setSelectedEmployee}>
                    <SelectTrigger className="w-full max-w-xs rounded-md">
                      <SelectValue placeholder="Select employee to add" />
                    </SelectTrigger>
                    <SelectContent>
                      {availableEmployees?.map((e) => (
                        <SelectItem key={e.id} value={String(e.id)}>
                          {e.fullName}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    variant="outline"
                    className="rounded-md"
                    disabled={!selectedEmployee}
                    onClick={() => addMemberMutation.mutate(Number(selectedEmployee))}
                  >
                    <UserPlus className="mr-2 size-4" />
                    Add
                  </Button>
                </div>
              )}

              <div className="divide-y divide-border">
                {project.members.length === 0 && (
                  <p className="py-4 text-sm text-muted-foreground">No members assigned yet.</p>
                )}
                {project.members.map((m) => (
                  <div key={m.employeeId} className="flex items-center justify-between py-2.5">
                    <div className="flex items-center gap-3">
                      <Avatar className="size-8">
                        <AvatarImage src={m.photoUrl ?? undefined} />
                        <AvatarFallback className="text-xs">{m.employeeName.slice(0, 2).toUpperCase()}</AvatarFallback>
                      </Avatar>
                      <div>
                        <p className="text-sm font-medium text-foreground">{m.employeeName}</p>
                        {m.roleInProject && <p className="text-xs text-muted-foreground">{m.roleInProject}</p>}
                      </div>
                    </div>
                    {canManage && (
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        className="text-muted-foreground hover:text-destructive"
                        onClick={() => removeMemberMutation.mutate(m.employeeId)}
                      >
                        <X className="size-3.5" />
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="tasks" className="mt-4">
          <TaskListPage projectId={project.id} embedded />
        </TabsContent>
      </Tabs>

      <ProjectFormDialog open={editOpen} onOpenChange={setEditOpen} project={project} />
    </div>
  )
}
