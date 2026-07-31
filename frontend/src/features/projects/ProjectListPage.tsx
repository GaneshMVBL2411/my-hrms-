import { useState } from "react"
import { useSearchParams, useNavigate } from "react-router-dom"
import { useQuery } from "@tanstack/react-query"
import { Plus, Search, ChevronLeft, ChevronRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { listProjects } from "@/features/projects/api"
import { ProjectFormDialog } from "@/features/projects/ProjectFormDialog"
import { useAuth } from "@/features/auth/AuthContext"
import type { Priority, ProjectStatus } from "@/features/projects/types"

const PAGE_SIZE = 10

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

export function ProjectListPage() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const [formOpen, setFormOpen] = useState(false)

  const page = Number(searchParams.get("page") ?? "1")
  const search = searchParams.get("q") ?? ""
  const status = searchParams.get("status") ?? undefined

  const canManage = user?.role === "founder" || user?.role === "hr_admin" || user?.role === "project_manager"

  const { data, isLoading } = useQuery({
    queryKey: ["projects", { page, search, status }],
    queryFn: () => listProjects({ page, pageSize: PAGE_SIZE, search: search || undefined, status }),
  })

  const updateParam = (key: string, value: string | undefined) => {
    const next = new URLSearchParams(searchParams)
    if (value) next.set(key, value)
    else next.delete(key)
    if (key !== "page") next.set("page", "1")
    setSearchParams(next)
  }

  const total = data?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  return (
    <div className="flex flex-1 flex-col gap-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Projects</h1>
          <p className="text-sm text-muted-foreground">{total} projects</p>
        </div>
        {canManage && (
          <Button className="rounded-md" onClick={() => setFormOpen(true)}>
            <Plus className="mr-2 size-4" />
            New Project
          </Button>
        )}
      </div>

      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            defaultValue={search}
            placeholder="Search projects..."
            className="rounded-md pl-9"
            onChange={(e) => updateParam("q", e.target.value || undefined)}
          />
        </div>
        <Select value={status ?? "all"} onValueChange={(v) => updateParam("status", v === "all" ? undefined : v)}>
          <SelectTrigger className="w-full rounded-md sm:w-48">
            <SelectValue placeholder="All statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="planning">Planning</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="on_hold">On Hold</SelectItem>
            <SelectItem value="completed">Completed</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="overflow-hidden rounded-md border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Project</TableHead>
              <TableHead>Priority</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Progress</TableHead>
              <TableHead>Deadline</TableHead>
              <TableHead>Members</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading &&
              Array.from({ length: 4 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell colSpan={6}>
                    <Skeleton className="h-8 w-full rounded-md" />
                  </TableCell>
                </TableRow>
              ))}

            {!isLoading && data?.items.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="py-12 text-center text-sm text-muted-foreground">
                  No projects yet.
                </TableCell>
              </TableRow>
            )}

            {!isLoading &&
              data?.items.map((project) => (
                <TableRow
                  key={project.id}
                  className="cursor-pointer"
                  onClick={() => navigate(`/projects/${project.id}`)}
                >
                  <TableCell className="font-medium text-foreground">{project.name}</TableCell>
                  <TableCell>
                    <Badge variant={priorityTone[project.priority]} className="capitalize">
                      {project.priority}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant={statusTone[project.status]} className="capitalize">
                      {project.status.replace("_", " ")}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 w-24 overflow-hidden rounded-full bg-muted">
                        <div className="h-full bg-primary" style={{ width: `${project.progress}%` }} />
                      </div>
                      <span className="text-xs text-muted-foreground">{project.progress}%</span>
                    </div>
                  </TableCell>
                  <TableCell>{project.deadline ?? "—"}</TableCell>
                  <TableCell>{project.memberCount}</TableCell>
                </TableRow>
              ))}
          </TableBody>
        </Table>
      </div>

      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Page {page} of {totalPages}
        </p>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="icon"
            className="rounded-md"
            disabled={page <= 1}
            onClick={() => updateParam("page", String(page - 1))}
          >
            <ChevronLeft className="size-4" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="rounded-md"
            disabled={page >= totalPages}
            onClick={() => updateParam("page", String(page + 1))}
          >
            <ChevronRight className="size-4" />
          </Button>
        </div>
      </div>

      <ProjectFormDialog open={formOpen} onOpenChange={setFormOpen} />
    </div>
  )
}
