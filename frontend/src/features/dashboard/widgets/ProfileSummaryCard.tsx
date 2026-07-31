import { useQuery } from "@tanstack/react-query"
import { useNavigate } from "react-router-dom"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { getEmployee } from "@/features/employees/api"
import { useAuth } from "@/features/auth/AuthContext"

export function ProfileSummaryCard() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const employeeId = user?.employeeId ?? undefined

  const { data: employee } = useQuery({
    queryKey: ["employees", "detail", employeeId],
    queryFn: () => getEmployee(employeeId!),
    enabled: !!employeeId,
  })

  const initials = (user?.fullName ?? "?").slice(0, 2).toUpperCase()

  return (
    <Card className="rounded-md border shadow-none">
      <CardHeader>
        <CardTitle className="text-base">My Profile</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex items-center gap-3">
          <Avatar className="size-14">
            <AvatarImage src={user?.photoUrl ?? undefined} />
            <AvatarFallback>{initials}</AvatarFallback>
          </Avatar>
          <div>
            <p className="font-medium text-foreground">{user?.fullName}</p>
            <p className="text-xs text-muted-foreground">{employee?.employeeCode}</p>
          </div>
        </div>

        <dl className="grid grid-cols-2 gap-y-1.5 text-xs">
          <dt className="text-muted-foreground">Designation</dt>
          <dd className="truncate text-right text-foreground">{employee?.designationTitle ?? "—"}</dd>
          <dt className="text-muted-foreground">Department</dt>
          <dd className="truncate text-right text-foreground">{employee?.departmentName ?? "—"}</dd>
          <dt className="text-muted-foreground">Reporting Manager</dt>
          <dd className="truncate text-right text-foreground">{employee?.reportingManagerName ?? "—"}</dd>
          <dt className="text-muted-foreground">Experience</dt>
          <dd className="truncate text-right text-foreground">
            {employee?.experienceYears != null ? `${employee.experienceYears} yrs` : "—"}
          </dd>
          <dt className="text-muted-foreground">Phone</dt>
          <dd className="truncate text-right text-foreground">{employee?.phone ?? "—"}</dd>
          <dt className="text-muted-foreground">Email</dt>
          <dd className="truncate text-right text-foreground">{user?.email}</dd>
        </dl>

        {employee?.skills && employee.skills.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {employee.skills.map((skill) => (
              <Badge key={skill} variant="outline" className="text-[11px]">
                {skill}
              </Badge>
            ))}
          </div>
        )}

        <Button variant="outline" size="sm" className="rounded-md" onClick={() => navigate("/profile")}>
          Edit Profile
        </Button>
      </CardContent>
    </Card>
  )
}
