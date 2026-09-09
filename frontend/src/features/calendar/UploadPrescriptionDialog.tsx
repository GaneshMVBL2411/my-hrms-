import { useState } from "react"
import { toast } from "sonner"
import { Loader2, FileUp, Paperclip } from "lucide-react"
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

export function UploadPrescriptionDialog({
  open,
  onOpenChange,
  onSuccess,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess?: (title: string) => void
}) {
  const [prescriptionTitle, setPrescriptionTitle] = useState("Prescription: Fever and cold")
  const [patientName, setPatientName] = useState("Ganesh Kumar")
  const [fileName, setFileName] = useState("prescription_rx_sept.pdf")
  const [notes, setNotes] = useState("Standard dosage: Paracetamol 500mg, Cetirizine 10mg twice daily.")
  const [submitting, setSubmitting] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!prescriptionTitle.trim()) {
      toast.error("Please enter prescription title")
      return
    }

    setSubmitting(true)
    setTimeout(() => {
      setSubmitting(false)
      toast.success(`Prescription uploaded: ${prescriptionTitle.trim()}`)
      onSuccess?.(`${prescriptionTitle.trim()} for ${patientName}`)
      onOpenChange(false)
    }, 400)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md rounded-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg font-bold">
            <FileUp className="size-5 text-amber-600" />
            Upload Prescription & Medical Document
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 pt-1">
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold">Prescription Title</Label>
            <Input
              placeholder="e.g. Prescription: Fever and cold, Prescription 20 Jul"
              value={prescriptionTitle}
              onChange={(e) => setPrescriptionTitle(e.target.value)}
              className="rounded-lg"
              autoFocus
            />
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Patient / Member</Label>
              <Input
                placeholder="Patient Name"
                value={patientName}
                onChange={(e) => setPatientName(e.target.value)}
                className="rounded-lg"
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Select File / Rx</Label>
              <div className="flex items-center gap-2">
                <Input
                  type="file"
                  id="rx-file"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0]
                    if (file) setFileName(file.name)
                  }}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="w-full justify-start rounded-lg text-xs"
                  onClick={() => document.getElementById("rx-file")?.click()}
                >
                  <Paperclip className="mr-1.5 size-3.5" />
                  <span className="truncate">{fileName || "Choose Rx PDF / Image"}</span>
                </Button>
              </div>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs font-semibold">Dosage, Instructions & Diagnosis</Label>
            <Textarea
              rows={2}
              placeholder="Medication names, dosage intervals, symptoms..."
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
              className="rounded-lg bg-amber-600 hover:bg-amber-700 text-white font-medium"
            >
              {submitting && <Loader2 className="mr-2 size-4 animate-spin" />}
              Upload Prescription
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
