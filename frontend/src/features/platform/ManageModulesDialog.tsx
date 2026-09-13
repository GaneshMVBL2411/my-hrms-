import { useState, useEffect } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { Layers, RefreshCw } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { updateCompanyModules, type CompanyOverview } from "@/features/platform/api"
import { errorMessage } from "@/lib/errors"
import { useAuth } from "@/features/auth/AuthContext"

const ALL_MODULES = [
  { id: "employees", name: "Employees & Directory", desc: "Staff records, org hierarchy and directory" },
  { id: "attendance", name: "Attendance Tracking", desc: "Check-in/out, biometric and location verification" },
  { id: "leaves", name: "Leave Management", desc: "Leave applications, balances and approval workflows" },
  { id: "payroll", name: "Payroll & Payslips", desc: "Salary calculation, allowances, deductions and payslips" },
  { id: "projects", name: "Projects & Milestones", desc: "Project boards and milestone planning" },
  { id: "tasks", name: "Tasks & Checklists", desc: "Task tracking and checklist items" },
  { id: "company_bank", name: "Company Bank Details", desc: "Bank payout accounts and statutory numbers" },
  { id: "assets", name: "Asset Management", desc: "Hardware, laptops and equipment assignment" },
  { id: "recruitment", name: "Recruitment Pipeline", desc: "Job openings and candidate interview tracking" },
  { id: "documents", name: "Document Vault", desc: "Letters, policies and company document storage" },
  { id: "calendar", name: "Events & Calendar", desc: "Official holidays and company event schedules" },
  { id: "announcements", name: "Announcements", desc: "Company-wide broadcasts and notices" },
  { id: "messages", name: "Workforce Messaging", desc: "Direct workforce messaging and team conversations" },
  { id: "reports", name: "Analytics & Reports", desc: "Audit logs, attendance, task and payroll reports" },
  { id: "settings", name: "Company Settings", desc: "Company profile, branding, and role configurations" },
]

export function ManageModulesDialog({
  company,
  open,
  onOpenChange,
}: {
  company: CompanyOverview | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { refreshUser } = useAuth()
  const queryClient = useQueryClient()
  const [selectedModules, setSelectedModules] = useState<string[]>([])

  useEffect(() => {
    if (company) {
      setSelectedModules(company.enabledModules ?? [])
    }
  }, [company])

  const toggleModule = (id: string) => {
    setSelectedModules((prev) =>
      prev.includes(id) ? prev.filter((m) => m !== id) : [...prev, id]
    )
  }

  const mutation = useMutation({
    mutationFn: () => {
      if (!company) throw new Error("No company selected")
      return updateCompanyModules(company.id, selectedModules)
    },
    onSuccess: async () => {
      toast.success(`Module permissions updated for ${company?.name}`)
      queryClient.invalidateQueries({ queryKey: ["platform"] })
      queryClient.invalidateQueries({ queryKey: ["companies"] })
      await refreshUser()
      onOpenChange(false)
    },
    onError: (err) => {
      toast.error(errorMessage(err, "Failed to update module permissions"))
    },
  })

  if (!company) return null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl max-h-[85vh] overflow-y-auto rounded-2xl p-6">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <div className="flex size-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Layers className="size-5" />
            </div>
            <div>
              <DialogTitle className="text-base font-bold">Manage Module Access</DialogTitle>
              <DialogDescription className="text-xs">
                Configure enabled feature modules for {company.name} ({company.code})
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-4 pt-2">
          <div className="flex items-center justify-between border-b border-border pb-2">
            <span className="text-xs text-muted-foreground font-medium">
              Active: <strong className="text-foreground">{selectedModules.length}</strong> of {ALL_MODULES.length} modules
            </span>
            <div className="flex items-center gap-1.5">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 text-xs px-2"
                onClick={() => setSelectedModules(ALL_MODULES.map((m) => m.id))}
              >
                Enable All
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 text-xs px-2 text-muted-foreground"
                onClick={() => setSelectedModules([])}
              >
                Disable All
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {ALL_MODULES.map((m) => {
              const isChecked = selectedModules.includes(m.id)
              return (
                <div
                  key={m.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => toggleModule(m.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault()
                      toggleModule(m.id)
                    }
                  }}
                  className={`flex items-start gap-2.5 p-2.5 rounded-xl border transition-all cursor-pointer select-none active:scale-[0.99] ${
                    isChecked
                      ? "border-primary bg-primary/10 shadow-2xs font-semibold"
                      : "border-border bg-card hover:bg-muted/30"
                  }`}
                >
                  <Checkbox
                    checked={isChecked}
                    onCheckedChange={() => {
                      // Handled by card onClick to avoid double-toggle
                    }}
                    className="mt-0.5 pointer-events-none"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-semibold text-foreground truncate">{m.name}</p>
                    <p className="text-[10px] text-muted-foreground line-clamp-1">{m.desc}</p>
                  </div>
                </div>
              )
            })}
          </div>

          <DialogFooter className="pt-3 border-t border-border">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="rounded-xl h-8 px-4"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={mutation.isPending}
              onClick={() => mutation.mutate()}
              className="rounded-xl h-8 px-5 gap-1.5 font-semibold"
            >
              {mutation.isPending && <RefreshCw className="size-3.5 animate-spin" />}
              <span>Save Module Permissions</span>
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  )
}
