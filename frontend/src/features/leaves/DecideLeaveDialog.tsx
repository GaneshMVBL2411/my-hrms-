import { useEffect, useState } from "react"
import { Loader2 } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import type { LeaveRequest } from "@/features/leaves/types"

/** Matches decision_note's column width, so nothing is silently truncated. */
const MAX = 500
const MIN_REASON = 10

/**
 * Where a leave decision gets its reason.
 *
 * Refusing leave without a word is how "why was mine rejected?" ends up being
 * asked in person days later, which is exactly the conversation this is meant
 * to save. So a refusal requires a note; an approval offers one, because "take
 * Friday too, it's a long weekend" is worth passing on but nobody should be
 * made to type it.
 *
 * The requirement lives here rather than in the database: it is a rule about
 * how this company answers people, and a future importer or script should not
 * be blocked by it.
 */
export function DecideLeaveDialog({
  request,
  approve,
  open,
  onOpenChange,
  onConfirm,
  pending,
}: {
  request: LeaveRequest | null
  approve: boolean
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: (note: string) => void
  pending: boolean
}) {
  const [note, setNote] = useState("")
  const [touched, setTouched] = useState(false)

  // A note is about one request; carrying it to the next one would attach the
  // wrong reason to the wrong person.
  useEffect(() => {
    if (open) {
      setNote("")
      setTouched(false)
    }
  }, [open, request?.id])

  const trimmed = note.trim()
  const tooShort = !approve && trimmed.length < MIN_REASON
  const showError = touched && tooShort

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{approve ? "Approve leave" : "Reject leave"}</DialogTitle>
          <DialogDescription>
            {request && (
              <>
                {request.employeeName} · {request.leaveTypeName} · {request.startDate} → {request.endDate} (
                {request.daysCount} {Number(request.daysCount) === 1 ? "day" : "days"})
              </>
            )}
          </DialogDescription>
        </DialogHeader>

        {request?.reason && (
          <div className="rounded-md border border-border bg-muted/40 px-3 py-2">
            <p className="text-xs text-muted-foreground">Their reason</p>
            <p className="mt-0.5 text-sm text-foreground">{request.reason}</p>
          </div>
        )}

        <div className="space-y-1.5">
          <Label htmlFor="decision-note">
            {approve ? "Note (optional)" : "Why are you rejecting this?"}
          </Label>
          <Textarea
            id="decision-note"
            value={note}
            maxLength={MAX}
            rows={4}
            autoFocus
            onChange={(e) => setNote(e.target.value)}
            onBlur={() => setTouched(true)}
            placeholder={
              approve
                ? "Anything they should know — cover arrangements, handover, dates confirmed."
                : "Two people are already off that week. Could you take the following Monday instead?"
            }
            aria-invalid={showError}
          />
          <div className="flex justify-between text-xs text-muted-foreground">
            <span className={showError ? "text-destructive" : undefined}>
              {showError
                ? `Please give at least ${MIN_REASON} characters — they will read this.`
                : approve
                  ? "They will see this on their request."
                  : "They will see this on their request, so write it to them."}
            </span>
            <span>
              {note.length}/{MAX}
            </span>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button
            variant={approve ? "default" : "destructive"}
            disabled={pending || tooShort}
            onClick={() => {
              setTouched(true)
              if (tooShort) return
              onConfirm(trimmed)
            }}
          >
            {pending && <Loader2 className="mr-2 size-4 animate-spin" />}
            {approve ? "Approve" : "Reject"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
