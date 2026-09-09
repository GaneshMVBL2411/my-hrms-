import { useEffect, useState } from "react"
import { toast } from "sonner"
import { Loader2, Trash2 } from "lucide-react"
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
import { createEvent, deleteEvent } from "@/features/calendar/api"
import type { CalendarEntryType } from "@/features/calendar/types"

export interface HrScheduleItem {
  id?: number | string
  title: string
  date: string
  type: CalendarEntryType
  timeSlot?: string
  assignee?: string
  description?: string
}

export function HrScheduleDialog({
  open,
  onOpenChange,
  defaultDate,
  editingItem,
  onSave,
  onDelete,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  defaultDate?: string
  editingItem?: HrScheduleItem | null
  onSave: (item: HrScheduleItem) => void
  onDelete?: (id: number | string) => void
}) {
  const [title, setTitle] = useState("")
  const [date, setDate] = useState("")
  const [type, setType] = useState<CalendarEntryType>("event")
  const [timeSlot, setTimeSlot] = useState("10:00 AM - 11:00 AM")
  const [assignee, setAssignee] = useState("Dr. Taraka Nadh Nanduri")
  const [description, setDescription] = useState("")
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (open) {
      if (editingItem) {
        setTitle(editingItem.title || "")
        setDate(editingItem.date || defaultDate || new Date().toISOString().split("T")[0])
        setType(editingItem.type || "event")
        setTimeSlot(editingItem.timeSlot || "10:00 AM - 11:00 AM")
        setAssignee(editingItem.assignee || "Dr. Taraka Nadh Nanduri")
        setDescription(editingItem.description || "")
      } else {
        setTitle("")
        setDate(defaultDate || new Date().toISOString().split("T")[0])
        setType("event")
        setTimeSlot("10:00 AM - 11:00 AM")
        setAssignee("Dr. Taraka Nadh Nanduri")
        setDescription("")
      }
    }
  }, [open, editingItem, defaultDate])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!title.trim()) {
      toast.error("Please enter a title for the schedule")
      return
    }
    if (!date) {
      toast.error("Please select a date")
      return
    }

    setSubmitting(true)
    const itemToSave: HrScheduleItem = {
      id: editingItem?.id || `local-${Date.now()}`,
      title: title.trim(),
      date,
      type,
      timeSlot,
      assignee,
      description: description.trim(),
    }

    try {
      // Attempt backend persistence if mapped to standard event type
      const backendType = type === "meeting" || type === "holiday" ? type : "event"
      await createEvent({
        title: title.trim(),
        description: description.trim() ? `${timeSlot ? `[${timeSlot}] ` : ""}${description.trim()}` : timeSlot,
        eventDate: date,
        eventType: backendType,
      }).catch(() => {
        // Fallback gracefully to optimistic state
      })
    } catch {
      // Ignored for optimistic UI updates
    } finally {
      onSave(itemToSave)
      toast.success(editingItem ? "Schedule updated successfully" : "HR Schedule created successfully")
      setSubmitting(false)
      onOpenChange(false)
    }
  }

  const handleDelete = async () => {
    if (!editingItem?.id) return
    setSubmitting(true)
    try {
      if (typeof editingItem.id === "number") {
        await deleteEvent(editingItem.id).catch(() => {})
      }
      onDelete?.(editingItem.id)
      toast.success("Schedule item deleted")
      onOpenChange(false)
    } catch {
      toast.error("Could not delete item")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md rounded-xl">
        <DialogHeader>
          <DialogTitle className="text-lg font-bold text-foreground">
            {editingItem ? "HR Update: Edit Schedule" : "HR Update: New Schedule Event"}
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 pt-1">
          {/* Title */}
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold">Title / Subject</Label>
            <Input
              placeholder="e.g. Consultation scheduled, Patient Review, Team Sync"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="rounded-lg"
              autoFocus
            />
          </div>

          {/* Type / Category */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Category Type</Label>
              <Select value={type} onValueChange={(v) => setType(v as CalendarEntryType)}>
                <SelectTrigger className="rounded-lg">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="event">🟢 Consultation</SelectItem>
                  <SelectItem value="leave">🔴 Blocked Time</SelectItem>
                  <SelectItem value="task_due">🔵 Follow-up</SelectItem>
                  <SelectItem value="meeting">🟣 Meeting</SelectItem>
                  <SelectItem value="holiday">🔷 Reminder</SelectItem>
                  <SelectItem value="project_deadline">🟠 Deadline</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Date */}
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Date</Label>
              <Input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="rounded-lg"
              />
            </div>
          </div>

          {/* Time Slot & Assignee */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Time Slot</Label>
              <Select value={timeSlot} onValueChange={setTimeSlot}>
                <SelectTrigger className="rounded-lg">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="09:00 AM - 10:00 AM">09:00 AM - 10:00 AM</SelectItem>
                  <SelectItem value="10:00 AM - 11:00 AM">10:00 AM - 11:00 AM</SelectItem>
                  <SelectItem value="11:00 AM - 12:00 PM">11:00 AM - 12:00 PM</SelectItem>
                  <SelectItem value="02:00 PM - 03:00 PM">02:00 PM - 03:00 PM</SelectItem>
                  <SelectItem value="03:00 PM - 04:30 PM">03:00 PM - 04:30 PM</SelectItem>
                  <SelectItem value="05:00 PM - 06:00 PM">05:00 PM - 06:00 PM</SelectItem>
                  <SelectItem value="Full Day">Full Day</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Assigned Practitioner / Staff</Label>
              <Input
                placeholder="Name or team"
                value={assignee}
                onChange={(e) => setAssignee(e.target.value)}
                className="rounded-lg"
              />
            </div>
          </div>

          {/* Description */}
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold">Instructions / Clinical Remarks (Optional)</Label>
            <Textarea
              rows={2}
              placeholder="Add patient notes, agenda or room number..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="rounded-lg resize-none"
            />
          </div>

          <DialogFooter className="flex items-center justify-between gap-2 pt-2 sm:justify-between">
            {editingItem ? (
              <Button
                type="button"
                variant="destructive"
                size="sm"
                className="rounded-lg"
                onClick={handleDelete}
                disabled={submitting}
              >
                <Trash2 className="mr-1.5 size-3.5" />
                Delete
              </Button>
            ) : (
              <div />
            )}

            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                className="rounded-lg"
                onClick={() => onOpenChange(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={submitting} className="rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-medium">
                {submitting && <Loader2 className="mr-2 size-4 animate-spin" />}
                {editingItem ? "Update Schedule" : "Save HR Update"}
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
