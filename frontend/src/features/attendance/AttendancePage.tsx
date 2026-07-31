import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import axios from "axios"
import { format } from "date-fns"
import { LogIn, LogOut, Clock } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Skeleton } from "@/components/ui/skeleton"
import { checkIn, checkOut, getMyAttendance, getSummary, listAttendance } from "@/features/attendance/api"
import { useAuth } from "@/features/auth/AuthContext"
import type { AttendanceStatus } from "@/features/attendance/types"

const statusTone: Record<AttendanceStatus, "success" | "warning" | "danger" | "secondary"> = {
  present: "success",
  half_day: "warning",
  on_leave: "secondary",
  absent: "danger",
}

function formatTime(value: string | null) {
  return value ? format(new Date(value), "hh:mm a") : "—"
}

export function AttendancePage() {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const now = new Date()
  const isManager = user?.role === "founder" || user?.role === "hr_admin"
  const [teamDate, setTeamDate] = useState(format(now, "yyyy-MM-dd"))

  const { data: myAttendance, isLoading: loadingMine } = useQuery({
    queryKey: ["attendance", "me", now.getFullYear(), now.getMonth() + 1],
    queryFn: () => getMyAttendance(now.getFullYear(), now.getMonth() + 1),
  })

  const today = myAttendance?.find((r) => r.date === format(now, "yyyy-MM-dd"))

  const checkInMutation = useMutation({
    mutationFn: checkIn,
    onSuccess: () => {
      toast.success("Checked in")
      queryClient.invalidateQueries({ queryKey: ["attendance"] })
    },
    onError: (error) => {
      const detail = axios.isAxiosError(error) ? (error.response?.data as { detail?: string })?.detail : undefined
      toast.error(detail ?? "Could not check in")
    },
  })

  const checkOutMutation = useMutation({
    mutationFn: checkOut,
    onSuccess: () => {
      toast.success("Checked out")
      queryClient.invalidateQueries({ queryKey: ["attendance"] })
    },
    onError: (error) => {
      const detail = axios.isAxiosError(error) ? (error.response?.data as { detail?: string })?.detail : undefined
      toast.error(detail ?? "Could not check out")
    },
  })

  const { data: teamData, isLoading: loadingTeam } = useQuery({
    queryKey: ["attendance", "team", teamDate],
    queryFn: () => listAttendance({ page: 1, pageSize: 100, date: teamDate }),
    enabled: isManager,
  })

  const { data: summary } = useQuery({
    queryKey: ["attendance", "summary", teamDate],
    queryFn: () => getSummary(teamDate),
    enabled: isManager,
  })

  return (
    <div className="flex flex-1 flex-col gap-5">
      <h1 className="text-xl font-semibold text-foreground">Attendance</h1>

      <Tabs defaultValue="mine">
        <TabsList className="rounded-md">
          <TabsTrigger value="mine">My Attendance</TabsTrigger>
          {isManager && <TabsTrigger value="team">Team</TabsTrigger>}
        </TabsList>

        <TabsContent value="mine" className="mt-4 flex flex-col gap-4">
          <Card className="rounded-md border shadow-none">
            <CardContent className="flex flex-col items-start justify-between gap-4 py-5 sm:flex-row sm:items-center">
              <div>
                <p className="text-sm text-muted-foreground">{format(now, "EEEE, MMMM d, yyyy")}</p>
                <div className="mt-1 flex items-center gap-4 text-sm">
                  <span className="flex items-center gap-1 text-foreground">
                    <Clock className="size-4 text-muted-foreground" /> In: {formatTime(today?.checkIn ?? null)}
                  </span>
                  <span className="flex items-center gap-1 text-foreground">
                    <Clock className="size-4 text-muted-foreground" /> Out: {formatTime(today?.checkOut ?? null)}
                  </span>
                </div>
              </div>
              <div className="flex gap-2">
                <Button
                  className="rounded-md"
                  disabled={!!today?.checkIn || checkInMutation.isPending}
                  onClick={() => checkInMutation.mutate()}
                >
                  <LogIn className="mr-2 size-4" />
                  Check In
                </Button>
                <Button
                  variant="outline"
                  className="rounded-md"
                  disabled={!today?.checkIn || !!today?.checkOut || checkOutMutation.isPending}
                  onClick={() => checkOutMutation.mutate()}
                >
                  <LogOut className="mr-2 size-4" />
                  Check Out
                </Button>
              </div>
            </CardContent>
          </Card>

          <div className="overflow-hidden rounded-md border border-border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Check In</TableHead>
                  <TableHead>Check Out</TableHead>
                  <TableHead>Working Hours</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loadingMine && (
                  <TableRow>
                    <TableCell colSpan={5}>
                      <Skeleton className="h-8 w-full rounded-md" />
                    </TableCell>
                  </TableRow>
                )}
                {!loadingMine && (myAttendance?.length ?? 0) === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="py-8 text-center text-sm text-muted-foreground">
                      No attendance records yet this month.
                    </TableCell>
                  </TableRow>
                )}
                {myAttendance
                  ?.slice()
                  .reverse()
                  .map((r) => (
                    <TableRow key={r.id}>
                      <TableCell>{r.date}</TableCell>
                      <TableCell>{formatTime(r.checkIn)}</TableCell>
                      <TableCell>{formatTime(r.checkOut)}</TableCell>
                      <TableCell>{r.workingHours != null ? `${r.workingHours} hrs` : "—"}</TableCell>
                      <TableCell>
                        <Badge variant={statusTone[r.status]} className="capitalize">
                          {r.status.replace("_", " ")}
                        </Badge>
                        {r.isLate && (
                          <Badge variant="warning" className="ml-1">
                            Late
                          </Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        {isManager && (
          <TabsContent value="team" className="mt-4 flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-4">
              <Input
                type="date"
                value={teamDate}
                onChange={(e) => setTeamDate(e.target.value)}
                className="w-48 rounded-md"
              />
              {summary && (
                <div className="flex gap-4 text-sm text-muted-foreground">
                  <span>
                    Present <b className="text-foreground">{summary.present}</b>
                  </span>
                  <span>
                    Absent <b className="text-foreground">{summary.absent}</b>
                  </span>
                  <span>
                    On Leave <b className="text-foreground">{summary.onLeave}</b>
                  </span>
                </div>
              )}
            </div>

            <div className="overflow-hidden rounded-md border border-border bg-card">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Employee</TableHead>
                    <TableHead>Check In</TableHead>
                    <TableHead>Check Out</TableHead>
                    <TableHead>Working Hours</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loadingTeam && (
                    <TableRow>
                      <TableCell colSpan={5}>
                        <Skeleton className="h-8 w-full rounded-md" />
                      </TableCell>
                    </TableRow>
                  )}
                  {!loadingTeam && (teamData?.items.length ?? 0) === 0 && (
                    <TableRow>
                      <TableCell colSpan={5} className="py-8 text-center text-sm text-muted-foreground">
                        No one has checked in for this date yet.
                      </TableCell>
                    </TableRow>
                  )}
                  {teamData?.items.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell>{r.employeeName}</TableCell>
                      <TableCell>{formatTime(r.checkIn)}</TableCell>
                      <TableCell>{formatTime(r.checkOut)}</TableCell>
                      <TableCell>{r.workingHours != null ? `${r.workingHours} hrs` : "—"}</TableCell>
                      <TableCell>
                        <Badge variant={statusTone[r.status]} className="capitalize">
                          {r.status.replace("_", " ")}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </TabsContent>
        )}
      </Tabs>
    </div>
  )
}
