import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { format } from "date-fns"
import { useAuthedFile } from "@/lib/useAuthedFile"
import { LogIn, LogOut, Clock, Camera, MapPin, ExternalLink, Loader2 } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Skeleton } from "@/components/ui/skeleton"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { checkIn, checkOut, getMyAttendance, getSummary, listAttendance } from "@/features/attendance/api"
import { BiometricPunch } from "@/features/attendance/BiometricPunch"
import { useAuth } from "@/features/auth/AuthContext"
import type { AttendanceStatus } from "@/features/attendance/types"
import { errorMessage } from "@/lib/errors"

const statusTone: Record<AttendanceStatus, "success" | "warning" | "danger" | "secondary"> = {
  present: "success",
  half_day: "warning",
  on_leave: "secondary",
  absent: "danger",
}

function formatTime(value: string | null) {
  return value ? format(new Date(value), "hh:mm a") : "—"
}

/**
 * The enlarged selfie in the dialog.
 *
 * Its own component only so it can hold the hook — the dialog around it is
 * rendered inside a branch, and a hook cannot live there.
 */
function PreviewImage({ photoId }: { photoId: string }) {
  const { url, failed } = useAuthedFile(photoId)

  if (failed) {
    return (
      <div className="flex size-full flex-col items-center justify-center gap-2 text-muted-foreground">
        <Camera className="size-6" />
        <p className="text-xs">That photo could not be loaded.</p>
      </div>
    )
  }
  if (!url) {
    return (
      <div className="flex size-full items-center justify-center">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    )
  }
  return <img src={url} alt="Check-in photo" className="size-full object-cover" />
}

function PhotoCell({
  photoId,
  name,
  time,
  lat,
  lng,
  onOpen,
}: {
  photoId: string | null | undefined
  name: string
  time: string | null
  lat?: number | string | null
  lng?: number | string | null
  onOpen: (info: { photoId: string; title: string; subtitle?: string; location?: string }) => void
}) {
  const { url, failed } = useAuthedFile(photoId)
  if (!photoId) {
    return (
      <div className="flex items-center gap-1.5 text-muted-foreground/60">
        <Camera className="size-3.5" />
        <span className="text-xs">—</span>
      </div>
    )
  }

  const numLat = lat != null && lat !== "" ? Number(lat) : NaN
  const numLng = lng != null && lng !== "" ? Number(lng) : NaN
  const hasCoords = !isNaN(numLat) && !isNaN(numLng)

  return (
    <button
      type="button"
      onClick={() =>
        onOpen({
          photoId,
          title: `${name} — Biometric Check In`,
          subtitle: time ? `Time: ${time}` : undefined,
          location: hasCoords ? `${numLat.toFixed(5)}, ${numLng.toFixed(5)}` : undefined,
        })
      }
      className="group relative flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-full border-2 border-border bg-muted shadow-xs transition-transform hover:scale-110 hover:border-primary focus:outline-hidden focus:ring-2 focus:ring-ring"
      title="Click to view biometric check-in selfie"
    >
      {/* Nothing is drawn until the bytes are in hand — an <img> with no src
          shows a broken-image glyph, which is what this looked like before. */}
      {url && !failed && <img src={url} alt={name} className="size-full object-cover" />}
      {failed && <Camera className="size-3.5 text-muted-foreground/60" />}
      <div className="absolute inset-0 flex items-center justify-center bg-black/30 opacity-0 transition-opacity group-hover:opacity-100">
        <Camera className="size-3 text-white" />
      </div>
    </button>
  )
}

function LocationCell({
  lat,
  lng,
  accuracy,
}: {
  lat?: number | string | null
  lng?: number | string | null
  accuracy?: number | string | null
}) {
  const numLat = lat != null && lat !== "" ? Number(lat) : NaN
  const numLng = lng != null && lng !== "" ? Number(lng) : NaN
  const numAcc = accuracy != null && accuracy !== "" ? Number(accuracy) : null

  if (isNaN(numLat) || isNaN(numLng)) {
    return <span className="text-muted-foreground">—</span>
  }

  const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${numLat},${numLng}`

  return (
    <a
      href={mapsUrl}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/20 transition-colors"
      title={`Open in Google Maps (${numLat}, ${numLng})`}
    >
      <MapPin className="size-3 text-emerald-600 dark:text-emerald-400 shrink-0" />
      <span className="font-mono text-[11px]">
        {numLat.toFixed(4)}, {numLng.toFixed(4)}
      </span>
      {numAcc != null && !isNaN(numAcc) && (
        <span className="text-[10px] text-muted-foreground">(±{Math.round(numAcc)}m)</span>
      )}
      <ExternalLink className="size-2.5 opacity-60 ml-0.5" />
    </a>
  )
}

export function AttendancePage() {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const now = new Date()
  const isManager = (user?.role === "founder" || user?.role === "company_admin") || user?.role === "hr_admin"
  const [teamDate, setTeamDate] = useState(format(now, "yyyy-MM-dd"))
  const [previewPhoto, setPreviewPhoto] = useState<{
    photoId: string
    title: string
    subtitle?: string
    location?: string
  } | null>(null)

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
      toast.error(errorMessage(error, "Could not check in"))
    },
  })

  const checkOutMutation = useMutation({
    mutationFn: checkOut,
    onSuccess: () => {
      toast.success("Checked out")
      queryClient.invalidateQueries({ queryKey: ["attendance"] })
    },
    onError: (error) => {
      toast.error(errorMessage(error, "Could not check out"))
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
          <Card className="rounded-xl border shadow-xs interactive-card">
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
                  className="rounded-xl shadow-xs"
                  disabled={!!today?.checkIn || checkInMutation.isPending}
                  onClick={() => checkInMutation.mutate()}
                >
                  <LogIn className="mr-2 size-4" />
                  Check In
                </Button>
                <Button
                  variant="outline"
                  className="rounded-xl"
                  disabled={!today?.checkIn || !!today?.checkOut || checkOutMutation.isPending}
                  onClick={() => checkOutMutation.mutate()}
                >
                  <LogOut className="mr-2 size-4" />
                  Check Out
                </Button>
              </div>
            </CardContent>
          </Card>

          <BiometricPunch today={today} />

          <div className="overflow-x-auto touch-pan-x rounded-xl border border-border bg-card shadow-2xs">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Photo</TableHead>
                  <TableHead>Check In</TableHead>
                  <TableHead>Login Place</TableHead>
                  <TableHead>Check Out</TableHead>
                  <TableHead>Working Hours</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loadingMine && (
                  <TableRow>
                    <TableCell colSpan={7}>
                      <Skeleton className="h-8 w-full rounded-md" />
                    </TableCell>
                  </TableRow>
                )}
                {!loadingMine && (myAttendance?.length ?? 0) === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} className="py-8 text-center text-sm text-muted-foreground">
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
                      <TableCell>
                        <PhotoCell
                          photoId={r.checkInPhotoId}
                          name={user?.email?.split("@")[0] || "Me"}
                          time={formatTime(r.checkIn)}
                          lat={r.checkInLatitude}
                          lng={r.checkInLongitude}
                          onOpen={setPreviewPhoto}
                        />
                      </TableCell>
                      <TableCell>{formatTime(r.checkIn)}</TableCell>
                      <TableCell>
                        <LocationCell
                          lat={r.checkInLatitude}
                          lng={r.checkInLongitude}
                          accuracy={r.checkInAccuracyM}
                        />
                      </TableCell>
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

            <div className="overflow-x-auto touch-pan-x rounded-xl border border-border bg-card shadow-2xs">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Employee</TableHead>
                    <TableHead>Photo</TableHead>
                    <TableHead>Check In</TableHead>
                    <TableHead>Login Place</TableHead>
                    <TableHead>Check Out</TableHead>
                    <TableHead>Working Hours</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loadingTeam && (
                    <TableRow>
                      <TableCell colSpan={7}>
                        <Skeleton className="h-8 w-full rounded-md" />
                      </TableCell>
                    </TableRow>
                  )}
                  {!loadingTeam && (teamData?.items.length ?? 0) === 0 && (
                    <TableRow>
                      <TableCell colSpan={7} className="py-8 text-center text-sm text-muted-foreground">
                        No one has checked in for this date yet.
                      </TableCell>
                    </TableRow>
                  )}
                  {teamData?.items.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="font-medium">{r.employeeName}</TableCell>
                      <TableCell>
                        <PhotoCell
                          photoId={r.checkInPhotoId}
                          name={r.employeeName}
                          time={formatTime(r.checkIn)}
                          lat={r.checkInLatitude}
                          lng={r.checkInLongitude}
                          onOpen={setPreviewPhoto}
                        />
                      </TableCell>
                      <TableCell>{formatTime(r.checkIn)}</TableCell>
                      <TableCell>
                        <LocationCell
                          lat={r.checkInLatitude}
                          lng={r.checkInLongitude}
                          accuracy={r.checkInAccuracyM}
                        />
                      </TableCell>
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

      {/* Selfie Photo Preview Dialog */}
      {previewPhoto && (
        <Dialog open onOpenChange={(open) => !open && setPreviewPhoto(null)}>
          <DialogContent className="max-w-md rounded-2xl p-6">
            <DialogHeader>
              <DialogTitle className="text-base font-semibold">{previewPhoto.title}</DialogTitle>
              {previewPhoto.subtitle && (
                <p className="text-xs text-muted-foreground">{previewPhoto.subtitle}</p>
              )}
            </DialogHeader>
            <div className="relative mt-2 overflow-hidden rounded-xl border border-border bg-black/5 aspect-square">
              <PreviewImage photoId={previewPhoto.photoId} />
            </div>
            {previewPhoto.location && (
              <div className="mt-3 flex items-center justify-between rounded-lg border border-border bg-muted/50 p-2.5 text-xs">
                <div className="flex items-center gap-1.5 text-muted-foreground">
                  <MapPin className="size-3.5 text-emerald-500 shrink-0" />
                  <span>
                    Login Place: <b className="text-foreground font-mono">{previewPhoto.location}</b>
                  </span>
                </div>
                <a
                  href={`https://www.google.com/maps/search/?api=1&query=${previewPhoto.location}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-medium text-primary hover:underline flex items-center gap-1 shrink-0"
                >
                  Map <ExternalLink className="size-3" />
                </a>
              </div>
            )}
          </DialogContent>
        </Dialog>
      )}
    </div>
  )
}
