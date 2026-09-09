import { useState } from "react"
import { toast } from "sonner"
import { Loader2, CheckCircle2 } from "lucide-react"
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

export function RequestConsentDialog({
  open,
  onOpenChange,
  onSuccess,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess?: (title: string) => void
}) {
  const [patientName, setPatientName] = useState("")
  const [consentType, setConsentType] = useState("treatment")
  const [effectiveDate, setEffectiveDate] = useState(() => new Date().toISOString().split("T")[0])
  const [notes, setNotes] = useState("")
  const [submitting, setSubmitting] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!patientName.trim()) {
      toast.error("Please enter the patient or employee name")
      return
    }

    setSubmitting(true)
    setTimeout(() => {
      setSubmitting(false)
      toast.success(`Consent request registered for ${patientName.trim()}`)
      onSuccess?.(`Consent request registered for ${patientName.trim()}`)
      setPatientName("")
      setNotes("")
      onOpenChange(false)
    }, 400)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md rounded-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg font-bold">
            <CheckCircle2 className="size-5 text-emerald-600" />
            Request Consent / Approval
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 pt-1">
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold">Patient / Team Member Name</Label>
            <Input
              placeholder="e.g. Ganesh Kumar, Bhavya Sri, Tarak"
              value={patientName}
              onChange={(e) => setPatientName(e.target.value)}
              className="rounded-lg"
              autoFocus
            />
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Consent Type</Label>
              <Select value={consentType} onValueChange={setConsentType}>
                <SelectTrigger className="rounded-lg">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="treatment">Clinical Consultation Consent</SelectItem>
                  <SelectItem value="procedure">Medical Procedure Consent</SelectItem>
                  <SelectItem value="telehealth">Telehealth & Remote Review</SelectItem>
                  <SelectItem value="leave">Leave / Absence Authorization</SelectItem>
                  <SelectItem value="records">Medical Records Release</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Effective Date</Label>
              <Input
                type="date"
                value={effectiveDate}
                onChange={(e) => setEffectiveDate(e.target.value)}
                className="rounded-lg"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs font-semibold">Consent Terms & Clinical Reason</Label>
            <Textarea
              rows={2}
              placeholder="Specify scope of authorization or symptoms..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="rounded-lg resize-none"
            />
          </div>

          <DialogFooter className="flex items-center justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              className="rounded-lg"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={submitting}
              className="rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-medium"
            >
              {submitting && <Loader2 className="mr-2 size-4 animate-spin" />}
              Submit Request
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
