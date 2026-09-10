import { format } from "date-fns"
import {
  CreditCard,
  Layers,
  LogIn,
  Users,
  Clock,
  CheckCircle2,
  Mail,
  Phone,
  Calendar,
} from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { type CompanyOverview } from "@/features/platform/api"

const ALL_MODULES = [
  { id: "employees", name: "Employees" },
  { id: "attendance", name: "Attendance" },
  { id: "leaves", name: "Leaves" },
  { id: "payroll", name: "Payroll" },
  { id: "projects", name: "Projects" },
  { id: "tasks", name: "Tasks" },
  { id: "company_bank", name: "Bank Details" },
  { id: "assets", name: "Assets" },
  { id: "recruitment", name: "Recruitment" },
  { id: "documents", name: "Documents" },
  { id: "calendar", name: "Calendar" },
  { id: "announcements", name: "Announcements" },
  { id: "messages", name: "Messages" },
  { id: "reports", name: "Reports" },
  { id: "settings", name: "Settings" },
]

export function CompanyDetailDialog({
  company,
  open,
  onOpenChange,
  onEnter,
  onManageBilling,
  onManageModules,
  entering,
}: {
  company: CompanyOverview | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onEnter: (company: CompanyOverview) => void
  onManageBilling: (company: CompanyOverview) => void
  onManageModules: (company: CompanyOverview) => void
  entering?: boolean
}) {
  if (!company) return null

  const feeDisplay =
    company.monthlyPrice !== null && company.monthlyPrice !== undefined
      ? `₹${Number(company.monthlyPrice).toLocaleString()}/mo`
      : "Custom / Negotiated"

  const limit = company.employeeLimit || 50
  const usedPct = Math.min(100, Math.round((company.employees / limit) * 100))

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto rounded-2xl p-6">
        <DialogHeader>
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-3.5">
              <div
                className="flex size-12 shrink-0 items-center justify-center rounded-2xl text-white font-bold text-base shadow-sm"
                style={{ background: company.primaryColor ?? "var(--primary)" }}
              >
                {company.name.slice(0, 2).toUpperCase()}
              </div>
              <div>
                <DialogTitle className="text-lg font-bold text-foreground flex items-center gap-2">
                  <span>{company.name}</span>
                  <Badge variant="outline" className="font-mono text-xs font-bold">
                    {company.code}
                  </Badge>
                </DialogTitle>
                <DialogDescription className="text-xs text-muted-foreground flex items-center gap-2 mt-0.5">
                  <span>{company.country ?? "India"}</span>
                  {company.registeredOn && (
                    <span>· Registered {format(new Date(company.registeredOn), "MMM yyyy")}</span>
                  )}
                </DialogDescription>
              </div>
            </div>

            <div className="flex flex-col items-end gap-1">
              <Badge
                variant={
                  company.status === "active"
                    ? "success"
                    : company.status === "trial"
                    ? "warning"
                    : "secondary"
                }
                className="capitalize text-xs font-semibold"
              >
                {company.status}
              </Badge>
              {company.supportOpen && (
                <Badge variant="warning" className="text-[10px] gap-1">
                  Support Active
                </Badge>
              )}
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-4 pt-2">
          {/* Quick Metrics Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
            <div className="rounded-xl border border-border bg-muted/30 p-2.5">
              <p className="text-[11px] font-medium text-muted-foreground">Active Staff</p>
              <p className="text-base font-bold text-foreground mt-0.5">
                {company.employees} <span className="text-xs font-normal text-muted-foreground">/ {company.employeeLimit ?? "∞"}</span>
              </p>
              {company.employeeLimit && (
                <div className="h-1 w-full overflow-hidden rounded-full bg-muted mt-1.5">
                  <div
                    className={`h-full rounded-full ${
                      usedPct > 90 ? "bg-danger" : usedPct > 75 ? "bg-warning" : "bg-primary"
                    }`}
                    style={{ width: `${usedPct}%` }}
                  />
                </div>
              )}
            </div>

            <div className="rounded-xl border border-border bg-muted/30 p-2.5">
              <p className="text-[11px] font-medium text-muted-foreground">Total Users</p>
              <p className="text-base font-bold text-foreground mt-0.5">{company.users}</p>
              <p className="text-[10px] text-muted-foreground mt-0.5">Signed-in accounts</p>
            </div>

            <div className="rounded-xl border border-border bg-muted/30 p-2.5">
              <p className="text-[11px] font-medium text-muted-foreground">Payslips</p>
              <p className="text-base font-bold text-foreground mt-0.5">{company.payslips}</p>
              <p className="text-[10px] text-muted-foreground mt-0.5">Generated to date</p>
            </div>

            <div className="rounded-xl border border-border bg-muted/30 p-2.5">
              <p className="text-[11px] font-medium text-muted-foreground">Pending Leaves</p>
              <p className="text-base font-bold text-foreground mt-0.5">{company.pendingLeave}</p>
              <p className="text-[10px] text-muted-foreground mt-0.5">Awaiting decision</p>
            </div>
          </div>

          {/* Subscription & Payment Section */}
          <div className="rounded-xl border border-border bg-card p-3.5 space-y-2.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <CreditCard className="size-4 text-primary" />
                <span className="text-xs font-bold text-foreground">Subscription & Billing</span>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-6 text-xs text-primary px-2"
                onClick={() => {
                  onOpenChange(false)
                  onManageBilling(company)
                }}
              >
                Edit Billing
              </Button>
            </div>

            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="flex flex-col gap-0.5">
                <span className="text-[11px] text-muted-foreground">Plan Tier</span>
                <span className="font-semibold text-foreground capitalize">
                  {company.plan ?? "Standard Plan"}
                </span>
              </div>

              <div className="flex flex-col gap-0.5">
                <span className="text-[11px] text-muted-foreground">Subscription Fee</span>
                <span className="font-semibold text-foreground font-mono">{feeDisplay}</span>
              </div>

              <div className="flex flex-col gap-0.5">
                <span className="text-[11px] text-muted-foreground">Payment Verification</span>
                <div>
                  {company.paymentStatus === "verified" ? (
                    <Badge variant="success" className="gap-1 text-[10px] font-semibold">
                      <CheckCircle2 className="size-3" />
                      Verified
                    </Badge>
                  ) : company.paymentStatus === "pending" ? (
                    <Badge variant="warning" className="gap-1 text-[10px] font-semibold">
                      <Clock className="size-3" />
                      Pending Verification
                    </Badge>
                  ) : company.paymentStatus === "waived" ? (
                    <Badge variant="outline" className="text-[10px]">
                      Waived
                    </Badge>
                  ) : (
                    <Badge variant="danger" className="text-[10px]">
                      Past Due
                    </Badge>
                  )}
                </div>
              </div>

              <div className="flex flex-col gap-0.5">
                <span className="text-[11px] text-muted-foreground">Payment Reference</span>
                <span className="font-mono text-foreground truncate">
                  {company.paymentReference || "—"}
                </span>
              </div>
            </div>

            {company.paymentNotes && (
              <p className="text-[11px] text-muted-foreground bg-muted/40 p-2 rounded-lg">
                <strong>Notes:</strong> {company.paymentNotes}
              </p>
            )}
          </div>

          {/* Contact & Administration */}
          <div className="rounded-xl border border-border bg-card p-3.5 space-y-2">
            <div className="flex items-center gap-2">
              <Users className="size-4 text-primary" />
              <span className="text-xs font-bold text-foreground">Company Administration</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
              <div className="flex items-center gap-2 text-muted-foreground">
                <Mail className="size-3.5 text-primary/70 shrink-0" />
                <span className="text-foreground font-medium truncate">
                  {company.adminEmail || company.email || "No email registered"}
                </span>
              </div>

              {company.phone && (
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Phone className="size-3.5 text-primary/70 shrink-0" />
                  <span className="text-foreground font-medium">{company.phone}</span>
                </div>
              )}

              <div className="flex items-center gap-2 text-muted-foreground">
                <Clock className="size-3.5 text-primary/70 shrink-0" />
                <span>
                  Last Sign-In:{" "}
                  <strong className="text-foreground">
                    {company.lastSignIn ? format(new Date(company.lastSignIn), "MMM d, yyyy") : "Never"}
                  </strong>
                </span>
              </div>

              <div className="flex items-center gap-2 text-muted-foreground">
                <Calendar className="size-3.5 text-primary/70 shrink-0" />
                <span>
                  Created:{" "}
                  <strong className="text-foreground">
                    {format(new Date(company.createdAt), "MMM d, yyyy")}
                  </strong>
                </span>
              </div>
            </div>
          </div>

          {/* Enabled Modules */}
          <div className="rounded-xl border border-border bg-card p-3.5 space-y-2.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Layers className="size-4 text-primary" />
                <span className="text-xs font-bold text-foreground">
                  Enabled Feature Modules ({company.modules ?? 0} active)
                </span>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-6 text-xs text-primary px-2"
                onClick={() => {
                  onOpenChange(false)
                  onManageModules(company)
                }}
              >
                Configure
              </Button>
            </div>

            <div className="flex flex-wrap gap-1.5">
              {ALL_MODULES.map((m) => {
                const isEnabled = company.enabledModules?.includes(m.id)
                return (
                  <span
                    key={m.id}
                    className={`inline-flex items-center gap-1 rounded-lg px-2 py-0.5 text-[11px] font-medium border ${
                      isEnabled
                        ? "bg-primary/10 text-primary border-primary/25 font-semibold"
                        : "bg-muted/40 text-muted-foreground border-border/50 line-through opacity-60"
                    }`}
                  >
                    {m.name}
                  </span>
                )
              })}
            </div>
          </div>
        </div>

        {/* Dialog Actions */}
        <DialogFooter className="pt-3 border-t border-border flex flex-col sm:flex-row items-center justify-between gap-2">
          <div className="flex items-center gap-2 w-full sm:w-auto">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="rounded-xl h-8 px-3 text-xs gap-1.5"
              onClick={() => {
                onOpenChange(false)
                onManageBilling(company)
              }}
            >
              <CreditCard className="size-3.5" />
              <span>Billing</span>
            </Button>

            <Button
              type="button"
              variant="outline"
              size="sm"
              className="rounded-xl h-8 px-3 text-xs gap-1.5"
              onClick={() => {
                onOpenChange(false)
                onManageModules(company)
              }}
            >
              <Layers className="size-3.5" />
              <span>Modules</span>
            </Button>
          </div>

          <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="rounded-xl h-8 px-3 text-xs"
              onClick={() => onOpenChange(false)}
            >
              Close
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={entering}
              onClick={() => onEnter(company)}
              className="rounded-xl h-8 px-4 text-xs gap-1.5 font-semibold"
            >
              <LogIn className="size-3.5" />
              <span>{entering ? "Entering..." : "Enter Support Session"}</span>
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
