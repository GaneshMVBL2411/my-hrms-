import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { format } from "date-fns"
import { Plus } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { getCandidate, addInterview, updateCandidate, updateInterview } from "@/features/recruitment/api"
import type { CandidateStatus, InterviewOutcome } from "@/features/recruitment/types"

const statusTone: Record<CandidateStatus, "secondary" | "warning" | "default" | "success" | "danger"> = {
  applied: "secondary",
  interview_scheduled: "warning",
  interviewed: "default",
  offered: "success",
  joined: "success",
  rejected: "danger",
}

export function CandidateDetailDialog({
  candidateId,
  open,
  onOpenChange,
}: {
  candidateId: number | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const queryClient = useQueryClient()
  const [interviewDate, setInterviewDate] = useState("")

  const { data: candidate } = useQuery({
    queryKey: ["candidates", candidateId],
    queryFn: () => getCandidate(candidateId!),
    enabled: open && !!candidateId,
  })

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["candidates"] })

  const statusMutation = useMutation({
    mutationFn: (status: CandidateStatus) => updateCandidate(candidateId!, { status }),
    onSuccess: () => {
      toast.success("Status updated")
      invalidate()
    },
  })

  const addInterviewMutation = useMutation({
    mutationFn: () => addInterview(candidateId!, { scheduledAt: new Date(interviewDate).toISOString() }),
    onSuccess: () => {
      setInterviewDate("")
      toast.success("Interview scheduled")
      invalidate()
    },
    onError: () => toast.error("Could not schedule interview"),
  })

  const outcomeMutation = useMutation({
    mutationFn: ({ id, outcome }: { id: number; outcome: InterviewOutcome }) => updateInterview(id, { outcome }),
    onSuccess: invalidate,
  })

  if (!candidate) return null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-xl overflow-y-auto rounded-md">
        <DialogHeader>
          <DialogTitle>{candidate.fullName}</DialogTitle>
        </DialogHeader>

        <div className="space-y-5">
          <div className="flex flex-wrap items-center gap-2">
            <Select value={candidate.status} onValueChange={(v) => statusMutation.mutate(v as CandidateStatus)}>
              <SelectTrigger className="h-7 w-44 rounded-md text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="applied">Applied</SelectItem>
                <SelectItem value="interview_scheduled">Interview Scheduled</SelectItem>
                <SelectItem value="interviewed">Interviewed</SelectItem>
                <SelectItem value="offered">Offered</SelectItem>
                <SelectItem value="joined">Joined</SelectItem>
                <SelectItem value="rejected">Rejected</SelectItem>
              </SelectContent>
            </Select>
            <Badge variant={statusTone[candidate.status]} className="capitalize">
              {candidate.status.replace("_", " ")}
            </Badge>
          </div>

          <div className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
            <div>
              <p className="text-xs text-muted-foreground">Email</p>
              <p className="text-foreground">{candidate.email}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Phone</p>
              <p className="text-foreground">{candidate.phone ?? "—"}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Source</p>
              <p className="text-foreground">{candidate.source ?? "—"}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Applied for</p>
              <p className="text-foreground">{candidate.appliedDesignationTitle ?? "—"}</p>
            </div>
          </div>

          {candidate.notes && (
            <div>
              <p className="text-xs text-muted-foreground">Notes</p>
              <p className="text-sm text-foreground">{candidate.notes}</p>
            </div>
          )}

          <div>
            <p className="text-sm font-medium text-foreground">Interviews</p>
            <div className="mt-2 space-y-2">
              {candidate.interviews.length === 0 && (
                <p className="text-sm text-muted-foreground">No interviews scheduled yet.</p>
              )}
              {candidate.interviews.map((i) => (
                <div key={i.id} className="flex items-center justify-between rounded-md border border-border p-2.5">
                  <div>
                    <p className="text-sm text-foreground">{format(new Date(i.scheduledAt), "MMM d, yyyy hh:mm a")}</p>
                    {i.notes && <p className="text-xs text-muted-foreground">{i.notes}</p>}
                  </div>
                  <Select
                    value={i.outcome}
                    onValueChange={(v) => outcomeMutation.mutate({ id: i.id, outcome: v as InterviewOutcome })}
                  >
                    <SelectTrigger className="h-7 w-28 rounded-md text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="pending">Pending</SelectItem>
                      <SelectItem value="pass">Pass</SelectItem>
                      <SelectItem value="fail">Fail</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              ))}
            </div>
            <div className="mt-2 flex gap-2">
              <Input
                type="datetime-local"
                value={interviewDate}
                onChange={(e) => setInterviewDate(e.target.value)}
                className="h-8 rounded-md text-sm"
              />
              <Button
                size="icon-sm"
                variant="outline"
                className="rounded-md"
                disabled={!interviewDate}
                onClick={() => addInterviewMutation.mutate()}
              >
                <Plus className="size-4" />
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
