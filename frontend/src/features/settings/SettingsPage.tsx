import { useState } from "react"
import { useForm } from "react-hook-form"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { format } from "date-fns"
import { Plus, Pencil, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import {
  deleteDepartment,
  deleteDesignation,
  listDepartments,
  listDesignations,
} from "@/features/employees/api"
import { getCompanySettings, listAuditLogs, listRoles, updateCompanySettings } from "@/features/settings/api"
import { DepartmentFormDialog } from "@/features/settings/DepartmentFormDialog"
import { DesignationFormDialog } from "@/features/settings/DesignationFormDialog"
import { useAuth } from "@/features/auth/AuthContext"
import type { Department, Designation } from "@/features/employees/types"

function CompanyProfileTab() {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const canEdit = user?.role === "founder"

  const { data: settings, isLoading } = useQuery({ queryKey: ["settings", "company"], queryFn: getCompanySettings })
  const { register, handleSubmit, reset } = useForm({
    values: { companyName: settings?.companyName ?? "", address: settings?.address ?? "" },
  })

  const mutation = useMutation({
    mutationFn: (values: { companyName: string; address: string }) =>
      updateCompanySettings({ companyName: values.companyName, address: values.address || undefined }),
    onSuccess: () => {
      toast.success("Company profile updated")
      queryClient.invalidateQueries({ queryKey: ["settings", "company"] })
    },
    onError: () => toast.error("Could not update company profile"),
  })

  if (isLoading) return <Skeleton className="h-40 w-full rounded-md" />

  return (
    <Card className="max-w-lg rounded-md border shadow-none">
      <CardContent className="space-y-4 py-6">
        <div className="space-y-1.5">
          <Label>Company name</Label>
          <Input disabled={!canEdit} {...register("companyName")} />
        </div>
        <div className="space-y-1.5">
          <Label>Address</Label>
          <Input disabled={!canEdit} {...register("address")} />
        </div>
        {canEdit && (
          <Button className="rounded-md" onClick={handleSubmit((v) => mutation.mutate(v))}>
            Save changes
          </Button>
        )}
        {!canEdit && <p className="text-xs text-muted-foreground">Only the Founder can edit company profile.</p>}
        <div>
          <Button type="button" variant="ghost" className="hidden" onClick={() => reset()} />
        </div>
      </CardContent>
    </Card>
  )
}

function DepartmentsTab() {
  const queryClient = useQueryClient()
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<Department | undefined>(undefined)

  const { data: departments, isLoading } = useQuery({ queryKey: ["departments"], queryFn: listDepartments })

  const deleteMutation = useMutation({
    mutationFn: deleteDepartment,
    onSuccess: () => {
      toast.success("Department removed")
      queryClient.invalidateQueries({ queryKey: ["departments"] })
    },
    onError: () => toast.error("Could not remove department"),
  })

  return (
    <div className="flex flex-col gap-3">
      <div className="flex justify-end">
        <Button
          className="rounded-md"
          onClick={() => {
            setEditing(undefined)
            setFormOpen(true)
          }}
        >
          <Plus className="mr-2 size-4" />
          New Department
        </Button>
      </div>
      <div className="overflow-hidden rounded-md border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Description</TableHead>
              <TableHead className="w-20" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && (
              <TableRow>
                <TableCell colSpan={3}>
                  <Skeleton className="h-8 w-full rounded-md" />
                </TableCell>
              </TableRow>
            )}
            {departments?.map((d) => (
              <TableRow key={d.id}>
                <TableCell className="font-medium text-foreground">{d.name}</TableCell>
                <TableCell className="text-muted-foreground">{d.description ?? "—"}</TableCell>
                <TableCell>
                  <div className="flex justify-end gap-1">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => {
                        setEditing(d)
                        setFormOpen(true)
                      }}
                    >
                      <Pencil className="size-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="text-destructive hover:text-destructive"
                      onClick={() => {
                        if (confirm(`Remove "${d.name}"?`)) deleteMutation.mutate(d.id)
                      }}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <DepartmentFormDialog open={formOpen} onOpenChange={setFormOpen} department={editing} />
    </div>
  )
}

function DesignationsTab() {
  const queryClient = useQueryClient()
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<Designation | undefined>(undefined)

  const { data: designations, isLoading } = useQuery({ queryKey: ["designations"], queryFn: listDesignations })

  const deleteMutation = useMutation({
    mutationFn: deleteDesignation,
    onSuccess: () => {
      toast.success("Designation removed")
      queryClient.invalidateQueries({ queryKey: ["designations"] })
    },
    onError: () => toast.error("Could not remove designation"),
  })

  return (
    <div className="flex flex-col gap-3">
      <div className="flex justify-end">
        <Button
          className="rounded-md"
          onClick={() => {
            setEditing(undefined)
            setFormOpen(true)
          }}
        >
          <Plus className="mr-2 size-4" />
          New Designation
        </Button>
      </div>
      <div className="overflow-hidden rounded-md border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Title</TableHead>
              <TableHead>Description</TableHead>
              <TableHead className="w-20" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && (
              <TableRow>
                <TableCell colSpan={3}>
                  <Skeleton className="h-8 w-full rounded-md" />
                </TableCell>
              </TableRow>
            )}
            {designations?.map((d) => (
              <TableRow key={d.id}>
                <TableCell className="font-medium text-foreground">{d.title}</TableCell>
                <TableCell className="text-muted-foreground">{d.description ?? "—"}</TableCell>
                <TableCell>
                  <div className="flex justify-end gap-1">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => {
                        setEditing(d)
                        setFormOpen(true)
                      }}
                    >
                      <Pencil className="size-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="text-destructive hover:text-destructive"
                      onClick={() => {
                        if (confirm(`Remove "${d.title}"?`)) deleteMutation.mutate(d.id)
                      }}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <DesignationFormDialog open={formOpen} onOpenChange={setFormOpen} designation={editing} />
    </div>
  )
}

function RolesTab() {
  const { data: roles, isLoading } = useQuery({ queryKey: ["roles"], queryFn: listRoles })

  if (isLoading) return <Skeleton className="h-40 w-full rounded-md" />

  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
      {roles?.map((role) => (
        <Card key={role.id} className="rounded-md border shadow-none">
          <CardContent className="py-4">
            <h3 className="text-sm font-semibold capitalize text-foreground">{role.name.replace("_", " ")}</h3>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {role.permissions.map((p) => (
                <Badge key={p} variant="outline">
                  {p}
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}

function AuditLogsTab() {
  const [page, setPage] = useState(1)
  const { data, isLoading } = useQuery({
    queryKey: ["audit-logs", page],
    queryFn: () => listAuditLogs({ page, pageSize: 20 }),
  })

  return (
    <div className="flex flex-col gap-3">
      <div className="overflow-hidden rounded-md border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>User</TableHead>
              <TableHead>Action</TableHead>
              <TableHead>Entity</TableHead>
              <TableHead>Date</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && (
              <TableRow>
                <TableCell colSpan={4}>
                  <Skeleton className="h-8 w-full rounded-md" />
                </TableCell>
              </TableRow>
            )}
            {data?.items.map((log) => (
              <TableRow key={log.id}>
                <TableCell>{log.userName ?? "System"}</TableCell>
                <TableCell className="capitalize">{log.action}</TableCell>
                <TableCell>
                  {log.entity}
                  {log.entityId ? ` #${log.entityId}` : ""}
                </TableCell>
                <TableCell>{format(new Date(log.createdAt), "MMM d, yyyy hh:mm a")}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="outline" size="sm" className="rounded-md" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
          Previous
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="rounded-md"
          disabled={(data?.items.length ?? 0) < 20}
          onClick={() => setPage((p) => p + 1)}
        >
          Next
        </Button>
      </div>
    </div>
  )
}

export function SettingsPage() {
  return (
    <div className="flex flex-1 flex-col gap-5">
      <h1 className="text-xl font-semibold text-foreground">Settings</h1>

      <Tabs defaultValue="company">
        <TabsList className="rounded-md">
          <TabsTrigger value="company">Company Profile</TabsTrigger>
          <TabsTrigger value="departments">Departments</TabsTrigger>
          <TabsTrigger value="designations">Designations</TabsTrigger>
          <TabsTrigger value="roles">Roles & Permissions</TabsTrigger>
          <TabsTrigger value="audit">Audit Logs</TabsTrigger>
        </TabsList>

        <TabsContent value="company" className="mt-4">
          <CompanyProfileTab />
        </TabsContent>
        <TabsContent value="departments" className="mt-4">
          <DepartmentsTab />
        </TabsContent>
        <TabsContent value="designations" className="mt-4">
          <DesignationsTab />
        </TabsContent>
        <TabsContent value="roles" className="mt-4">
          <RolesTab />
        </TabsContent>
        <TabsContent value="audit" className="mt-4">
          <AuditLogsTab />
        </TabsContent>
      </Tabs>
    </div>
  )
}
