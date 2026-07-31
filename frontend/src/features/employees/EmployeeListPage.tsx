import { useState } from "react"
import { useSearchParams, useNavigate } from "react-router-dom"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import axios from "axios"
import { toast } from "sonner"
import { Plus, Search, ArrowUpDown, Trash2, Pencil, ChevronLeft, ChevronRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { deleteEmployee, listDepartments, listEmployees } from "@/features/employees/api"
import { EmployeeFormDialog } from "@/features/employees/EmployeeFormDialog"
import { useAuth } from "@/features/auth/AuthContext"
import { canManageEmployees } from "@/features/auth/permissions"
import type { EmployeeStatus } from "@/features/employees/types"

const PAGE_SIZE = 10

const statusTone: Record<EmployeeStatus, "success" | "warning" | "danger" | "secondary"> = {
  active: "success",
  on_notice: "warning",
  inactive: "secondary",
  exited: "danger",
}

export function EmployeeListPage() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [searchParams, setSearchParams] = useSearchParams()
  const [formOpen, setFormOpen] = useState(false)

  const page = Number(searchParams.get("page") ?? "1")
  const search = searchParams.get("q") ?? ""
  const departmentId = searchParams.get("departmentId") ?? undefined
  const sortBy = searchParams.get("sortBy") ?? "fullName"
  const sortDir = (searchParams.get("sortDir") as "asc" | "desc") ?? "asc"

  const { data: departments = [] } = useQuery({ queryKey: ["departments"], queryFn: listDepartments })

  const { data, isLoading } = useQuery({
    queryKey: ["employees", { page, search, departmentId, sortBy, sortDir }],
    queryFn: () =>
      listEmployees({
        page,
        pageSize: PAGE_SIZE,
        search: search || undefined,
        departmentId: departmentId ? Number(departmentId) : undefined,
        sortBy,
        sortDir,
      }),
  })

  const deleteMutation = useMutation({
    mutationFn: deleteEmployee,
    onSuccess: () => {
      toast.success("Employee removed")
      queryClient.invalidateQueries({ queryKey: ["employees"] })
    },
    onError: (error) => {
      const detail = axios.isAxiosError(error) ? (error.response?.data as { detail?: string })?.detail : undefined
      toast.error(detail ?? "Could not remove employee")
    },
  })

  const updateParam = (key: string, value: string | undefined) => {
    const next = new URLSearchParams(searchParams)
    if (value) next.set(key, value)
    else next.delete(key)
    if (key !== "page") next.set("page", "1")
    setSearchParams(next)
  }

  const toggleSort = (column: string) => {
    if (sortBy === column) {
      updateParam("sortDir", sortDir === "asc" ? "desc" : "asc")
    } else {
      const next = new URLSearchParams(searchParams)
      next.set("sortBy", column)
      next.set("sortDir", "asc")
      next.set("page", "1")
      setSearchParams(next)
    }
  }

  const total = data?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const canManage = canManageEmployees(user?.role)

  return (
    <div className="flex flex-1 flex-col gap-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Employees</h1>
          <p className="text-sm text-muted-foreground">{total} team members</p>
        </div>
        {canManage && (
          <Button className="rounded-md" onClick={() => setFormOpen(true)}>
            <Plus className="mr-2 size-4" />
            Add Employee
          </Button>
        )}
      </div>

      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            defaultValue={search}
            placeholder="Search by name, email or employee code..."
            className="rounded-md pl-9"
            onChange={(e) => updateParam("q", e.target.value || undefined)}
          />
        </div>
        <Select value={departmentId ?? "all"} onValueChange={(v) => updateParam("departmentId", v === "all" ? undefined : v)}>
          <SelectTrigger className="w-full rounded-md sm:w-56">
            <SelectValue placeholder="All departments" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All departments</SelectItem>
            {departments.map((d) => (
              <SelectItem key={d.id} value={String(d.id)}>
                {d.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="overflow-hidden rounded-md border border-border bg-card shadow-none">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>
                <button className="flex items-center gap-1" onClick={() => toggleSort("fullName")}>
                  Employee <ArrowUpDown className="size-3.5" />
                </button>
              </TableHead>
              {canManage && <TableHead>Department</TableHead>}
              <TableHead>Designation</TableHead>
              {canManage && <TableHead>Address</TableHead>}
              {canManage && (
                <TableHead>
                  <button className="flex items-center gap-1" onClick={() => toggleSort("joiningDate")}>
                    Joined <ArrowUpDown className="size-3.5" />
                  </button>
                </TableHead>
              )}
              {canManage && <TableHead>Status</TableHead>}
              {canManage && <TableHead className="w-24 text-right">Actions</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading &&
              Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell colSpan={canManage ? 7 : 2}>
                    <Skeleton className="h-8 w-full rounded-lg" />
                  </TableCell>
                </TableRow>
              ))}

            {!isLoading && data?.items.length === 0 && (
              <TableRow>
                <TableCell colSpan={canManage ? 7 : 2} className="py-12 text-center text-sm text-muted-foreground">
                  No employees match your filters.
                </TableCell>
              </TableRow>
            )}

            {!isLoading &&
              data?.items.map((emp) => (
                <TableRow
                  key={emp.id}
                  className="cursor-pointer"
                  onClick={() => navigate(`/employees/${emp.id}`)}
                >
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <Avatar className="size-8">
                        <AvatarImage src={emp.photoUrl ?? undefined} />
                        <AvatarFallback className="text-xs">
                          {emp.fullName.slice(0, 2).toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                      <div>
                        <p className="text-sm font-medium text-foreground">{emp.fullName}</p>
                        <p className="text-xs text-muted-foreground">{emp.email}</p>
                      </div>
                    </div>
                  </TableCell>
                  {canManage && <TableCell>{emp.departmentName ?? "—"}</TableCell>}
                  <TableCell>{emp.designationTitle ?? "—"}</TableCell>
                  {canManage && (
                    <TableCell className="max-w-56 truncate" title={emp.address ?? undefined}>
                      {emp.address ?? "—"}
                    </TableCell>
                  )}
                  {canManage && <TableCell>{emp.joiningDate ?? "—"}</TableCell>}
                  {canManage && (
                    <TableCell>
                      <Badge variant={statusTone[emp.status]} className="capitalize">
                        {emp.status.replace("_", " ")}
                      </Badge>
                    </TableCell>
                  )}
                  {canManage && (
                    <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                      <div className="flex justify-end gap-1">
                        <Button variant="ghost" size="icon-sm" onClick={() => navigate(`/employees/${emp.id}`)}>
                          <Pencil className="size-3.5" />
                        </Button>
                        {emp.id !== user?.employeeId && (
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            className="text-destructive hover:text-destructive"
                            onClick={() => {
                              if (confirm(`Remove ${emp.fullName}?`)) deleteMutation.mutate(emp.id)
                            }}
                          >
                            <Trash2 className="size-3.5" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  )}
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

      <EmployeeFormDialog open={formOpen} onOpenChange={setFormOpen} />
    </div>
  )
}
