import { useEffect } from "react"
import { useForm, Controller } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import axios from "axios"
import { toast } from "sonner"
import { Loader2 } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  createEmployee,
  listDepartments,
  listDesignations,
  updateEmployee,
} from "@/features/employees/api"
import type { Employee } from "@/features/employees/types"

const roles = [
  { value: "founder", label: "Founder" },
  { value: "hr_admin", label: "HR Admin" },
  { value: "project_manager", label: "Project Manager" },
  { value: "team_lead", label: "Team Lead" },
  { value: "employee", label: "Employee" },
]

const statuses = [
  { value: "active", label: "Active" },
  { value: "inactive", label: "Inactive" },
  { value: "on_notice", label: "On Notice" },
  { value: "exited", label: "Exited" },
]

const optionalPattern = (pattern: RegExp, message: string) =>
  z
    .string()
    .optional()
    .refine((v) => !v || pattern.test(v), message)

const baseSchema = {
  email: z.string().email("Enter a valid email"),
  firstName: z.string().min(1, "First name is required"),
  lastName: z.string().min(1, "Last name is required"),
  phone: z.string().optional(),
  address: z.string().optional(),
  dob: z.string().optional(),
  gender: z.enum(["male", "female", "other"]).optional(),
  departmentId: z.string().optional(),
  designationId: z.string().optional(),
  joiningDate: z.string().optional(),
  status: z.enum(["active", "inactive", "on_notice", "exited"]),
  role: z.string().min(1, "Role is required"),
  panNumber: optionalPattern(/^[A-Za-z]{5}[0-9]{4}[A-Za-z]$/i, "Invalid PAN format (e.g. ABCDE1234F)"),
  aadhaarNumber: optionalPattern(/^\d{12}$/, "Aadhaar must be 12 digits"),
  bankAccountNumber: z.string().optional(),
  bankIfsc: optionalPattern(/^[A-Za-z]{4}0[A-Za-z0-9]{6}$/i, "Invalid IFSC format (e.g. HDFC0001234)"),
  bankName: z.string().optional(),
}

const formSchema = z.object({ ...baseSchema, password: z.string().optional() })

type FormValues = z.infer<typeof formSchema>

export function EmployeeFormDialog({
  open,
  onOpenChange,
  employee,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  employee?: Employee
}) {
  const isEdit = !!employee
  const queryClient = useQueryClient()

  const { data: departments = [] } = useQuery({ queryKey: ["departments"], queryFn: listDepartments })
  const { data: designations = [] } = useQuery({ queryKey: ["designations"], queryFn: listDesignations })

  const {
    register,
    control,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { status: "active", role: "employee" },
  })

  useEffect(() => {
    if (!open) return
    reset({
      email: employee?.email ?? "",
      firstName: employee?.firstName ?? "",
      lastName: employee?.lastName ?? "",
      phone: employee?.phone ?? "",
      address: employee?.address ?? "",
      dob: employee?.dob ?? "",
      gender: employee?.gender ?? undefined,
      departmentId: employee?.departmentId ? String(employee.departmentId) : undefined,
      designationId: employee?.designationId ? String(employee.designationId) : undefined,
      joiningDate: employee?.joiningDate ?? "",
      status: employee?.status ?? "active",
      role: "employee",
      password: "",
      panNumber: employee?.panNumber ?? "",
      aadhaarNumber: employee?.aadhaarNumber ?? "",
      bankAccountNumber: employee?.bankAccountNumber ?? "",
      bankIfsc: employee?.bankIfsc ?? "",
      bankName: employee?.bankName ?? "",
    })
  }, [open, employee, reset])

  const mutation = useMutation({
    mutationFn: (values: FormValues) => {
      const payload = {
        email: values.email,
        password: values.password || undefined,
        firstName: values.firstName,
        lastName: values.lastName,
        phone: values.phone || undefined,
        address: values.address || undefined,
        dob: values.dob || undefined,
        gender: values.gender || undefined,
        departmentId: values.departmentId ? Number(values.departmentId) : undefined,
        designationId: values.designationId ? Number(values.designationId) : undefined,
        joiningDate: values.joiningDate || undefined,
        status: values.status,
        role: values.role,
        panNumber: values.panNumber ? values.panNumber.toUpperCase() : undefined,
        aadhaarNumber: values.aadhaarNumber || undefined,
        bankAccountNumber: values.bankAccountNumber || undefined,
        bankIfsc: values.bankIfsc ? values.bankIfsc.toUpperCase() : undefined,
        bankName: values.bankName || undefined,
      }
      return isEdit ? updateEmployee(employee!.id, payload) : createEmployee(payload)
    },
    onSuccess: () => {
      toast.success(isEdit ? "Employee updated" : "Employee added")
      queryClient.invalidateQueries({ queryKey: ["employees"] })
      onOpenChange(false)
    },
    onError: (error) => {
      const detail = axios.isAxiosError(error) ? (error.response?.data as { detail?: string })?.detail : undefined
      toast.error(detail ?? "Something went wrong. Please check the form and try again.")
    },
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto rounded-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit Employee" : "Add Employee"}</DialogTitle>
        </DialogHeader>

        <form
          onSubmit={handleSubmit((values) => {
            if (!isEdit && (!values.password || values.password.length < 8)) {
              setError("password", { message: "Minimum 8 characters" })
              return
            }
            mutation.mutate(values)
          })}
          className="space-y-4"
          autoComplete="off"
        >
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>First name</Label>
              <Input {...register("firstName")} />
              {errors.firstName && <p className="text-xs text-destructive">{errors.firstName.message}</p>}
            </div>
            <div className="space-y-1.5">
              <Label>Last name</Label>
              <Input {...register("lastName")} />
              {errors.lastName && <p className="text-xs text-destructive">{errors.lastName.message}</p>}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Email</Label>
            <Input type="email" disabled={isEdit} autoComplete="off" {...register("email")} />
            {errors.email && <p className="text-xs text-destructive">{errors.email.message}</p>}
          </div>

          {!isEdit && (
            <div className="space-y-1.5">
              <Label>Temporary password</Label>
              <Input type="password" autoComplete="new-password" {...register("password")} />
              {errors.password && <p className="text-xs text-destructive">{errors.password.message}</p>}
            </div>
          )}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Phone</Label>
              <Input {...register("phone")} />
            </div>
            <div className="space-y-1.5">
              <Label>Joining date</Label>
              <Input type="date" {...register("joiningDate")} />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Address</Label>
            <Textarea rows={2} {...register("address")} />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Date of birth</Label>
              <Input type="date" {...register("dob")} />
            </div>
            <div className="space-y-1.5">
              <Label>Gender</Label>
              <Controller
                control={control}
                name="gender"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Select gender" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="male">Male</SelectItem>
                      <SelectItem value="female">Female</SelectItem>
                      <SelectItem value="other">Other</SelectItem>
                    </SelectContent>
                  </Select>
                )}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Department</Label>
              <Controller
                control={control}
                name="departmentId"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Select department" />
                    </SelectTrigger>
                    <SelectContent>
                      {departments.map((d) => (
                        <SelectItem key={d.id} value={String(d.id)}>
                          {d.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Designation</Label>
              <Controller
                control={control}
                name="designationId"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Select designation" />
                    </SelectTrigger>
                    <SelectContent>
                      {designations.map((d) => (
                        <SelectItem key={d.id} value={String(d.id)}>
                          {d.title}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Role</Label>
              <Controller
                control={control}
                name="role"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {roles.map((r) => (
                        <SelectItem key={r.value} value={r.value}>
                          {r.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Status</Label>
              <Controller
                control={control}
                name="status"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {statuses.map((s) => (
                        <SelectItem key={s.value} value={s.value}>
                          {s.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </div>
          </div>

          <div className="space-y-3 border-t border-border pt-4">
            <p className="text-sm font-medium text-foreground">Identity &amp; Bank Details</p>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>PAN number</Label>
                <Input placeholder="ABCDE1234F" {...register("panNumber")} />
                {errors.panNumber && <p className="text-xs text-destructive">{errors.panNumber.message}</p>}
              </div>
              <div className="space-y-1.5">
                <Label>Aadhaar number</Label>
                <Input placeholder="123456789012" {...register("aadhaarNumber")} />
                {errors.aadhaarNumber && <p className="text-xs text-destructive">{errors.aadhaarNumber.message}</p>}
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Bank name</Label>
              <Input {...register("bankName")} />
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Bank account number</Label>
                <Input {...register("bankAccountNumber")} />
              </div>
              <div className="space-y-1.5">
                <Label>Bank IFSC code</Label>
                <Input placeholder="HDFC0001234" {...register("bankIfsc")} />
                {errors.bankIfsc && <p className="text-xs text-destructive">{errors.bankIfsc.message}</p>}
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" className="rounded-md" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting} className="rounded-md">
              {isSubmitting && <Loader2 className="mr-2 size-4 animate-spin" />}
              {isEdit ? "Save changes" : "Add employee"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
