import { useState } from "react"
import { Users, Calendar, Phone, Mail, Clock } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"

const SAMPLE_PATIENTS = [
  {
    id: 1,
    name: "Ganesh Kumar",
    mrn: "PT-2026-001",
    status: "Active",
    lastVisit: "Today at 10:36 AM",
    nextSchedule: "Tomorrow, 10:00 AM",
    phone: "+91 98765 43210",
    email: "ganesh@company.com",
  },
  {
    id: 2,
    name: "Tarak",
    mrn: "PT-2026-002",
    status: "Active",
    lastVisit: "Today at 10:43 AM",
    nextSchedule: "Sep 11, 02:00 PM",
    phone: "+91 98765 43211",
    email: "tarak@company.com",
  },
  {
    id: 3,
    name: "Bhavya Sri",
    mrn: "PT-2026-003",
    status: "Active",
    lastVisit: "Today at 10:56 AM",
    nextSchedule: "Sep 12, 11:30 AM",
    phone: "+91 98765 43212",
    email: "bhavya@company.com",
  },
  {
    id: 4,
    name: "Dr. Taraka Nadh Nanduri",
    mrn: "DOC-2026-001",
    status: "Lead Practitioner",
    lastVisit: "Active Consultation",
    nextSchedule: "Sep 14, 09:00 AM",
    phone: "+91 98765 43213",
    email: "taraka@jeeva.tech",
  },
  {
    id: 5,
    name: "Rajesh Varma",
    mrn: "PT-2026-004",
    status: "Pending Consent",
    lastVisit: "3 days ago",
    nextSchedule: "Sep 15, 03:00 PM",
    phone: "+91 98765 43214",
    email: "rajesh@company.com",
  },
  {
    id: 6,
    name: "Ananya Rao",
    mrn: "PT-2026-005",
    status: "Follow-up",
    lastVisit: "1 week ago",
    nextSchedule: "Sep 18, 10:00 AM",
    phone: "+91 98765 43215",
    email: "ananya@company.com",
  },
]

export function ViewPatientsDialog({
  open,
  onOpenChange,
  onScheduleForPatient,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onScheduleForPatient?: (patientName: string) => void
}) {
  const [search, setSearch] = useState("")

  const filtered = SAMPLE_PATIENTS.filter(
    (p) =>
      p.name.toLowerCase().includes(search.toLowerCase()) ||
      p.mrn.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg rounded-xl">
        <DialogHeader>
          <div className="flex items-center justify-between">
            <DialogTitle className="flex items-center gap-2 text-lg font-bold">
              <Users className="size-5 text-sky-600" />
              Patients & Team Roster ({SAMPLE_PATIENTS.length})
            </DialogTitle>
          </div>
        </DialogHeader>

        <div className="space-y-3 pt-1">
          <input
            type="text"
            placeholder="Search patients or team members..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
          />

          <div className="max-h-[380px] space-y-2.5 overflow-y-auto pr-1">
            {filtered.map((patient) => (
              <div
                key={patient.id}
                className="flex items-start justify-between rounded-xl border border-border/80 bg-card p-3 transition-colors hover:border-sky-500/50 hover:bg-muted/40"
              >
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold text-foreground">{patient.name}</span>
                    <Badge variant="outline" className="text-[10px] font-medium">
                      {patient.mrn}
                    </Badge>
                    <span
                      className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
                        patient.status === "Active" || patient.status === "Lead Practitioner"
                          ? "bg-emerald-500/10 text-emerald-600"
                          : "bg-amber-500/10 text-amber-600"
                      }`}
                    >
                      {patient.status}
                    </span>
                  </div>

                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <Clock className="size-3 text-muted-foreground/70" />
                      Last: {patient.lastVisit}
                    </span>
                    <span className="flex items-center gap-1">
                      <Calendar className="size-3 text-sky-600" />
                      Next: {patient.nextSchedule}
                    </span>
                  </div>

                  <div className="flex items-center gap-3 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <Phone className="size-3 text-muted-foreground/70" />
                      {patient.phone}
                    </span>
                    <span className="flex items-center gap-1">
                      <Mail className="size-3 text-muted-foreground/70" />
                      {patient.email}
                    </span>
                  </div>
                </div>

                <Button
                  size="sm"
                  variant="outline"
                  className="rounded-lg text-xs font-semibold hover:bg-sky-500 hover:text-white dark:hover:bg-sky-600"
                  onClick={() => {
                    onOpenChange(false)
                    onScheduleForPatient?.(patient.name)
                  }}
                >
                  Schedule
                </Button>
              </div>
            ))}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
