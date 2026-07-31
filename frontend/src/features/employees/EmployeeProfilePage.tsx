import { useRef, useState } from "react"
import { useParams, useNavigate } from "react-router-dom"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { ArrowLeft, Camera, Mail, Phone, MapPin, Cake, Briefcase, Pencil } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ComingSoon } from "@/components/shared/ComingSoon"
import { getEmployee, uploadEmployeePhoto } from "@/features/employees/api"
import { EmployeeFormDialog } from "@/features/employees/EmployeeFormDialog"
import { useAuth } from "@/features/auth/AuthContext"
import { canManageEmployees } from "@/features/auth/permissions"
import type { EmployeeStatus } from "@/features/employees/types"

const statusTone: Record<EmployeeStatus, "success" | "warning" | "danger" | "secondary"> = {
  active: "success",
  on_notice: "warning",
  inactive: "secondary",
  exited: "danger",
}

export function EmployeeProfilePage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [editOpen, setEditOpen] = useState(false)

  const employeeId = Number(id)

  const { data: employee, isLoading } = useQuery({
    queryKey: ["employees", employeeId],
    queryFn: () => getEmployee(employeeId),
    enabled: Number.isFinite(employeeId),
  })

  const photoMutation = useMutation({
    mutationFn: (file: File) => uploadEmployeePhoto(employeeId, file),
    onSuccess: () => {
      toast.success("Photo updated")
      queryClient.invalidateQueries({ queryKey: ["employees", employeeId] })
    },
    onError: () => toast.error("Could not upload photo"),
  })

  const canManage = canManageEmployees(user?.role)

  if (isLoading || !employee) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-40 rounded-lg" />
        <Skeleton className="h-48 w-full rounded-md" />
      </div>
    )
  }

  return (
    <div className="flex flex-1 flex-col gap-5">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" className="rounded-md" onClick={() => navigate("/employees")}>
          <ArrowLeft className="size-4" />
        </Button>
        <h1 className="text-xl font-semibold text-foreground">Employee Profile</h1>
      </div>

      <Card className="rounded-md border shadow-none">
        <CardContent className="flex flex-col gap-6 py-6 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-4">
            <div className="relative">
              <Avatar className="size-20">
                <AvatarImage src={employee.photoUrl ?? undefined} />
                <AvatarFallback className="text-lg">
                  {employee.fullName.slice(0, 2).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              {canManage && (
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="absolute -bottom-1 -right-1 flex size-7 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-none"
                  aria-label="Change photo"
                >
                  <Camera className="size-3.5" />
                </button>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  if (file) photoMutation.mutate(file)
                }}
              />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-foreground">{employee.fullName}</h2>
              <p className="text-sm text-muted-foreground">
                {employee.designationTitle ?? "—"} · {employee.departmentName ?? "—"}
              </p>
              <div className="mt-2 flex items-center gap-2">
                <Badge variant={statusTone[employee.status]} className="capitalize">
                  {employee.status.replace("_", " ")}
                </Badge>
                <span className="text-xs text-muted-foreground">{employee.employeeCode}</span>
              </div>
            </div>
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
          <TabsTrigger value="employment">Employment</TabsTrigger>
          <TabsTrigger value="documents">Documents</TabsTrigger>
          <TabsTrigger value="attendance">Attendance</TabsTrigger>
          <TabsTrigger value="leaves">Leaves</TabsTrigger>
          <TabsTrigger value="performance">Performance</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-4">
          <Card className="rounded-md border shadow-none">
            <CardContent className="grid grid-cols-1 gap-5 py-6 sm:grid-cols-2">
              <InfoRow icon={Mail} label="Email" value={employee.email} />
              <InfoRow icon={Phone} label="Phone" value={employee.phone ?? "—"} />
              <InfoRow icon={MapPin} label="Address" value={employee.address ?? "—"} />
              <InfoRow icon={Cake} label="Date of birth" value={employee.dob ?? "—"} />
              <InfoRow
                icon={Briefcase}
                label="Reporting manager"
                value={employee.reportingManagerName ?? "—"}
              />
              <InfoRow
                icon={Briefcase}
                label="Experience"
                value={employee.experienceYears != null ? `${employee.experienceYears} years` : "—"}
              />
              <div className="sm:col-span-2">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Skills</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {employee.skills.length > 0 ? (
                    employee.skills.map((skill) => (
                      <Badge key={skill} variant="outline">
                        {skill}
                      </Badge>
                    ))
                  ) : (
                    <span className="text-sm text-muted-foreground">No skills recorded</span>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="employment" className="mt-4 flex flex-col gap-4">
          <Card className="rounded-md border shadow-none">
            <CardContent className="grid grid-cols-1 gap-5 py-6 sm:grid-cols-2">
              <InfoRow icon={Briefcase} label="Employee code" value={employee.employeeCode} />
              <InfoRow icon={Briefcase} label="Department" value={employee.departmentName ?? "—"} />
              <InfoRow icon={Briefcase} label="Designation" value={employee.designationTitle ?? "—"} />
              <InfoRow icon={Briefcase} label="Joining date" value={employee.joiningDate ?? "—"} />
            </CardContent>
          </Card>

          {canManage && (
            <Card className="rounded-md border shadow-none">
              <CardContent className="py-6">
                <p className="mb-4 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Identity &amp; Bank Details
                </p>
                <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                  <InfoRow icon={Briefcase} label="PAN number" value={employee.panNumber ?? "—"} />
                  <InfoRow icon={Briefcase} label="Aadhaar number" value={employee.aadhaarNumber ?? "—"} />
                  <InfoRow icon={Briefcase} label="Bank name" value={employee.bankName ?? "—"} />
                  <InfoRow icon={Briefcase} label="Bank account number" value={employee.bankAccountNumber ?? "—"} />
                  <InfoRow icon={Briefcase} label="Bank IFSC code" value={employee.bankIfsc ?? "—"} />
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="documents" className="mt-4">
          <ComingSoon title="Document management" />
        </TabsContent>
        <TabsContent value="attendance" className="mt-4">
          <ComingSoon title="Attendance history" />
        </TabsContent>
        <TabsContent value="leaves" className="mt-4">
          <ComingSoon title="Leave history" />
        </TabsContent>
        <TabsContent value="performance" className="mt-4">
          <ComingSoon title="Performance history" />
        </TabsContent>
      </Tabs>

      <EmployeeFormDialog open={editOpen} onOpenChange={setEditOpen} employee={employee} />
    </div>
  )
}

function InfoRow({ icon: Icon, label, value }: { icon: typeof Mail; label: string; value: string }) {
  return (
    <div className="flex items-start gap-3">
      <div className="flex size-9 items-center justify-center rounded-md bg-muted text-muted-foreground">
        <Icon className="size-4" />
      </div>
      <div>
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
        <p className="text-sm text-foreground">{value}</p>
      </div>
    </div>
  )
}
