import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { format } from "date-fns"
import { toast } from "sonner"
import {
  Building2,
  Users,
  CreditCard,
  LifeBuoy,
  LogIn,
  AlertTriangle,
  Search,
  ShieldCheck,
  Plus,
  Layers,
  CheckCircle2,
  Clock,
} from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import {
  listCompanies,
  getPlatformSummary,
  startSupport,
  type CompanyOverview,
} from "@/features/platform/api"
import { CreateCompanyDialog } from "@/features/platform/CreateCompanyDialog"
import { ManageSubscriptionDialog } from "@/features/platform/ManageSubscriptionDialog"
import { ManageModulesDialog } from "@/features/platform/ManageModulesDialog"
import { CompanyDetailDialog } from "@/features/platform/CompanyDetailDialog"
import { errorMessage } from "@/lib/errors"

const statusTone: Record<CompanyOverview["status"], "success" | "warning" | "danger" | "secondary"> = {
  active: "success",
  trial: "warning",
  suspended: "danger",
  inactive: "secondary",
}

type CardFilterType = "all" | "active" | "subscriptions" | "pending"

export function PlatformDashboard() {
  const queryClient = useQueryClient()
  const [search, setSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState<string>("all")
  const [cardFilter, setCardFilter] = useState<CardFilterType>("all")

  // Modal dialog states
  const [createDialogOpen, setCreateDialogOpen] = useState(false)
  const [subscriptionCompany, setSubscriptionCompany] = useState<CompanyOverview | null>(null)
  const [modulesCompany, setModulesCompany] = useState<CompanyOverview | null>(null)
  const [detailCompany, setDetailCompany] = useState<CompanyOverview | null>(null)

  const { data: summary } = useQuery({ queryKey: ["platform", "summary"], queryFn: getPlatformSummary })
  const { data: companies = [], isLoading } = useQuery({
    queryKey: ["platform", "companies"],
    queryFn: listCompanies,
  })

  const enter = useMutation({
    mutationFn: ({ id, name }: { id: number; name: string }) =>
      startSupport(id, `Support session opened from the platform console for ${name}`),
    onSuccess: () => {
      toast.success("Verified support session opened")
      queryClient.clear()
      window.location.href = "/dashboard"
    },
    onError: (error) => toast.error(errorMessage(error, "Could not open support session")),
  })

  // Card filter toggling
  const handleCardClick = (type: CardFilterType) => {
    if (cardFilter === type && statusFilter !== "all") {
      setCardFilter("all")
      setStatusFilter("all")
    } else {
      setCardFilter(type)
      if (type === "all") {
        setStatusFilter("all")
      } else if (type === "active") {
        setStatusFilter("active")
      } else {
        setStatusFilter("all")
      }
    }
  }

  const filtered = companies.filter((c) => {
    const matchesSearch = `${c.name} ${c.code} ${c.email ?? ""} ${c.adminEmail ?? ""}`
      .toLowerCase()
      .includes(search.toLowerCase())
    const matchesStatus = statusFilter === "all" || c.status === statusFilter

    let matchesCard = true
    if (cardFilter === "subscriptions") {
      matchesCard = Boolean(c.plan || c.monthlyPrice)
    } else if (cardFilter === "pending") {
      matchesCard = c.paymentStatus === "pending"
    }

    return matchesSearch && matchesStatus && matchesCard
  })

  return (
    <div className="flex flex-1 flex-col gap-6">
      {/* 1. Super Admin Platform Header */}
      <div className="rounded-2xl border border-border bg-card p-4 sm:p-6 shadow-xs">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-bold tracking-tight text-foreground sm:text-2xl">
                Platform Control Center
              </h1>
              <Badge variant="outline" className="gap-1.5 border-primary/30 bg-primary/5 text-primary text-xs font-semibold py-0.5">
                <span className="size-2 rounded-full bg-success animate-pulse" />
                <span>Super Admin</span>
              </Badge>
            </div>
            <p className="text-xs sm:text-sm text-muted-foreground">
              Multi-tenant company onboarding, flexible subscription pricing, payment verification & module access
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 self-start sm:self-center">
            <Button
              onClick={() => setCreateDialogOpen(true)}
              className="rounded-xl h-9 px-4 gap-2 font-semibold shadow-xs"
            >
              <Plus className="size-4" />
              <span>Onboard New Company</span>
            </Button>

            <div className="hidden lg:flex items-center gap-2 rounded-xl border border-border bg-muted/40 px-3 py-1.5 text-xs text-muted-foreground">
              <ShieldCheck className="size-4 text-success" />
              <span>PostgreSQL Connected</span>
              <span className="text-foreground font-semibold">· 99.9% Uptime</span>
            </div>
          </div>
        </div>
      </div>

      {/* 2. Platform Interactive Telemetry Cards (Clicking any card enables instant filtering) */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        {/* Card 1: Total Tenants */}
        <Card
          role="button"
          tabIndex={0}
          onClick={() => handleCardClick("all")}
          className={`rounded-2xl border shadow-xs interactive-card cursor-pointer select-none transition-all ${
            cardFilter === "all" && statusFilter === "all"
              ? "border-primary/60 ring-2 ring-primary/20 bg-primary/5"
              : "border-border hover:border-primary/40"
          }`}
        >
          <CardContent className="flex items-center justify-between p-4 sm:p-5">
            <div>
              <p className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                <span>Total Tenants</span>
                {cardFilter === "all" && statusFilter === "all" && (
                  <span className="size-1.5 rounded-full bg-primary" />
                )}
              </p>
              <p className="mt-1 text-2xl font-bold text-foreground">{summary?.companies ?? 0}</p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                <span className="font-semibold text-success">{summary?.activeCompanies ?? 0}</span> active accounts
              </p>
            </div>
            <div className="flex size-11 items-center justify-center rounded-2xl bg-primary/10 text-primary">
              <Building2 className="size-5" />
            </div>
          </CardContent>
        </Card>

        {/* Card 2: Cross-Platform Staff / Active Accounts */}
        <Card
          role="button"
          tabIndex={0}
          onClick={() => handleCardClick("active")}
          className={`rounded-2xl border shadow-xs interactive-card cursor-pointer select-none transition-all ${
            cardFilter === "active" || statusFilter === "active"
              ? "border-success/60 ring-2 ring-success/20 bg-success/5"
              : "border-border hover:border-success/40"
          }`}
        >
          <CardContent className="flex items-center justify-between p-4 sm:p-5">
            <div>
              <p className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                <span>Active Accounts</span>
                {(cardFilter === "active" || statusFilter === "active") && (
                  <span className="size-1.5 rounded-full bg-success" />
                )}
              </p>
              <p className="mt-1 text-2xl font-bold text-foreground">{summary?.activeCompanies ?? 0}</p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                <span className="font-semibold text-foreground">{summary?.employees ?? 0}</span> cross-platform staff
              </p>
            </div>
            <div className="flex size-11 items-center justify-center rounded-2xl bg-success/10 text-success">
              <Users className="size-5" />
            </div>
          </CardContent>
        </Card>

        {/* Card 3: Monthly Subscriptions */}
        <Card
          role="button"
          tabIndex={0}
          onClick={() => handleCardClick("subscriptions")}
          className={`rounded-2xl border shadow-xs interactive-card cursor-pointer select-none transition-all ${
            cardFilter === "subscriptions"
              ? "border-brand-accent/60 ring-2 ring-brand-accent/20 bg-brand-accent/5"
              : "border-border hover:border-brand-accent/40"
          }`}
        >
          <CardContent className="flex items-center justify-between p-4 sm:p-5">
            <div>
              <p className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                <span>Subscriptions</span>
                {cardFilter === "subscriptions" && (
                  <span className="size-1.5 rounded-full bg-brand-accent" />
                )}
              </p>
              <p className="mt-1 text-2xl font-bold text-foreground">
                {summary?.totalMrr ? `₹${Number(summary.totalMrr).toLocaleString()}` : `${summary?.subscriptions ?? 0} Active`}
              </p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">Click to view subscribed</p>
            </div>
            <div className="flex size-11 items-center justify-center rounded-2xl bg-brand-accent/10 text-brand-accent">
              <CreditCard className="size-5" />
            </div>
          </CardContent>
        </Card>

        {/* Card 4: Payment Verifications */}
        <Card
          role="button"
          tabIndex={0}
          onClick={() => handleCardClick("pending")}
          className={`rounded-2xl border shadow-xs interactive-card cursor-pointer select-none transition-all ${
            cardFilter === "pending"
              ? "border-warning/60 ring-2 ring-warning/20 bg-warning/5"
              : "border-border hover:border-warning/40"
          }`}
        >
          <CardContent className="flex items-center justify-between p-4 sm:p-5">
            <div>
              <p className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                <span>Payment Verifications</span>
                {cardFilter === "pending" && (
                  <span className="size-1.5 rounded-full bg-warning" />
                )}
              </p>
              <p className="mt-1 text-2xl font-bold text-foreground">
                {summary?.pendingPayments ?? 0}
              </p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                {summary?.pendingPayments ? (
                  <span className="text-warning font-semibold">Click to verify pending</span>
                ) : (
                  <span className="text-success font-medium">All accounts verified</span>
                )}
              </p>
            </div>
            <div className="flex size-11 items-center justify-center rounded-2xl bg-warning/10 text-warning">
              <Clock className="size-5" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* 3. Search, Filter & Tenant Management Directory */}
      <Card className="rounded-2xl border border-border shadow-xs">
        <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between pb-4">
          <div>
            <div className="flex items-center gap-2">
              <CardTitle className="text-base font-semibold">Tenant Companies Directory</CardTitle>
              {cardFilter !== "all" && (
                <Badge variant="outline" className="text-xs font-semibold capitalize">
                  Filter: {cardFilter}
                </Badge>
              )}
            </div>
            <CardDescription className="text-xs">
              Click any company card or row to view complete details, verify payment, or enter support session
            </CardDescription>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Filter pills */}
            <div className="flex items-center rounded-xl border border-border bg-muted/50 p-1 text-xs">
              {["all", "active", "trial", "suspended"].map((status) => (
                <button
                  key={status}
                  type="button"
                  onClick={() => {
                    setStatusFilter(status)
                    if (status !== "all") setCardFilter("all")
                  }}
                  className={`rounded-lg px-2.5 py-1 font-medium capitalize transition-colors ${
                    statusFilter === status
                      ? "bg-card text-foreground shadow-2xs font-semibold"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {status}
                </button>
              ))}
            </div>

            {/* Search Input */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search companies, code, email…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="h-8 w-48 sm:w-64 rounded-xl pl-8 text-xs bg-muted/30"
              />
            </div>
          </div>
        </CardHeader>

        <CardContent className="p-0">
          {/* Desktop & Tablet Table View */}
          <div className="hidden md:block overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/30">
                  <TableHead className="pl-6">Company & Admin</TableHead>
                  <TableHead>Subscription & Fee</TableHead>
                  <TableHead>Payment Status</TableHead>
                  <TableHead>Modules</TableHead>
                  <TableHead>Seat Utilization</TableHead>
                  <TableHead>Payslips</TableHead>
                  <TableHead>Last Sign-In</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="pr-6 text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading && (
                  <TableRow>
                    <TableCell colSpan={9} className="py-8">
                      <Skeleton className="h-10 w-full rounded-xl" />
                    </TableCell>
                  </TableRow>
                )}

                {!isLoading && filtered.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={9} className="py-12 text-center text-sm text-muted-foreground">
                      {search ? "No companies match that search criteria." : "No companies found for this filter."}
                    </TableCell>
                  </TableRow>
                )}

                {filtered.map((c) => {
                  const limit = c.employeeLimit || 50
                  const usedPct = Math.min(100, Math.round((c.employees / limit) * 100))
                  const feeDisplay =
                    c.monthlyPrice !== null && c.monthlyPrice !== undefined
                      ? `₹${Number(c.monthlyPrice).toLocaleString()}/mo`
                      : "Custom / Negotiated"

                  return (
                    <TableRow
                      key={c.id}
                      onClick={() => setDetailCompany(c)}
                      className="hover:bg-muted/40 cursor-pointer transition-colors group"
                    >
                      {/* Company Info */}
                      <TableCell className="pl-6">
                        <div className="flex items-center gap-3">
                          <div
                            className="flex size-9 shrink-0 items-center justify-center rounded-xl text-white font-bold text-xs shadow-2xs transition-transform group-hover:scale-105"
                            style={{ background: c.primaryColor ?? "var(--primary)" }}
                          >
                            {c.name.slice(0, 2).toUpperCase()}
                          </div>
                          <div className="min-w-0">
                            <p className="font-semibold text-foreground text-sm truncate group-hover:text-primary transition-colors">
                              {c.name}
                            </p>
                            <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                              <span className="font-mono text-[11px] font-bold text-foreground/80">{c.code}</span>
                              {c.adminEmail ? (
                                <span className="truncate max-w-[160px]" title={c.adminEmail}>
                                  · {c.adminEmail}
                                </span>
                              ) : c.email ? (
                                <span className="truncate max-w-[160px]">· {c.email}</span>
                              ) : null}
                            </p>
                          </div>
                        </div>
                      </TableCell>

                      {/* Subscription & Flexible Fee */}
                      <TableCell>
                        <div className="flex flex-col gap-0.5">
                          <span className="text-xs font-semibold text-foreground">{feeDisplay}</span>
                          <span className="text-[11px] text-muted-foreground capitalize">
                            {c.plan ?? "Standard"} · {c.billingCycle ?? "monthly"}
                          </span>
                        </div>
                      </TableCell>

                      {/* Payment Verification Status */}
                      <TableCell>
                        <div className="flex flex-col gap-0.5">
                          {c.paymentStatus === "verified" ? (
                            <Badge variant="success" className="gap-1 text-[11px] font-semibold w-fit">
                              <CheckCircle2 className="size-3" />
                              <span>Verified</span>
                            </Badge>
                          ) : c.paymentStatus === "pending" ? (
                            <Badge variant="warning" className="gap-1 text-[11px] font-semibold w-fit">
                              <Clock className="size-3" />
                              <span>Pending</span>
                            </Badge>
                          ) : c.paymentStatus === "waived" ? (
                            <Badge variant="outline" className="text-[11px] w-fit">
                              Waived
                            </Badge>
                          ) : (
                            <Badge variant="danger" className="text-[11px] w-fit">
                              Past Due
                            </Badge>
                          )}
                          {c.paymentReference && (
                            <span className="font-mono text-[10px] text-muted-foreground truncate max-w-[120px]" title={c.paymentReference}>
                              Ref: {c.paymentReference}
                            </span>
                          )}
                        </div>
                      </TableCell>

                      {/* Module Access */}
                      <TableCell>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation()
                            setModulesCompany(c)
                          }}
                          className="group/btn inline-flex items-center gap-1.5 rounded-lg border border-border/80 bg-muted/40 px-2 py-1 text-xs transition-colors hover:bg-muted hover:border-primary/40"
                          title="Click to configure modules"
                        >
                          <Layers className="size-3 text-muted-foreground group-hover/btn:text-primary" />
                          <span className="font-medium text-foreground">{c.modules ?? 0}</span>
                          <span className="text-[10px] text-muted-foreground">modules</span>
                        </button>
                      </TableCell>

                      {/* Headcount Utilization */}
                      <TableCell>
                        <div className="flex flex-col gap-1 w-28">
                          <div className="flex items-center justify-between text-xs">
                            <span className="font-semibold text-foreground">{c.employees}</span>
                            <span className="text-muted-foreground text-[11px]">/ {c.employeeLimit ?? "∞"}</span>
                          </div>
                          {c.employeeLimit && (
                            <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                              <div
                                className={`h-full rounded-full transition-all ${
                                  usedPct > 90 ? "bg-danger" : usedPct > 75 ? "bg-warning" : "bg-primary"
                                }`}
                                style={{ width: `${usedPct}%` }}
                              />
                            </div>
                          )}
                        </div>
                      </TableCell>

                      {/* Payslips */}
                      <TableCell className="text-sm font-medium text-foreground">{c.payslips}</TableCell>

                      {/* Last Sign-In */}
                      <TableCell className="text-xs text-muted-foreground">
                        {c.lastSignIn ? (
                          format(new Date(c.lastSignIn), "MMM d, yyyy")
                        ) : (
                          <span className="inline-flex items-center gap-1 font-medium text-warning text-xs">
                            <AlertTriangle className="size-3.5" />
                            Never
                          </span>
                        )}
                      </TableCell>

                      {/* Status */}
                      <TableCell>
                        <div className="flex items-center gap-1.5">
                          <Badge variant={statusTone[c.status]} className="capitalize text-xs font-medium">
                            {c.status}
                          </Badge>
                          {c.supportOpen && (
                            <Badge variant="warning" className="gap-1 text-xs">
                              <LifeBuoy className="size-3" />
                              Active
                            </Badge>
                          )}
                        </div>
                      </TableCell>

                      {/* Row Actions */}
                      <TableCell className="pr-6 text-right">
                        <div className="flex items-center justify-end gap-1.5" onClick={(e) => e.stopPropagation()}>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="rounded-xl h-8 px-2.5 text-xs text-muted-foreground hover:text-foreground hover:bg-muted"
                            title="Manage subscription & payment"
                            onClick={() => setSubscriptionCompany(c)}
                          >
                            <CreditCard className="size-3.5" />
                            <span className="hidden xl:inline ml-1">Billing</span>
                          </Button>

                          <Button
                            size="sm"
                            variant="ghost"
                            className="rounded-xl h-8 px-2.5 text-xs text-muted-foreground hover:text-foreground hover:bg-muted"
                            title="Configure module access"
                            onClick={() => setModulesCompany(c)}
                          >
                            <Layers className="size-3.5" />
                            <span className="hidden xl:inline ml-1">Modules</span>
                          </Button>

                          <Button
                            size="sm"
                            variant="outline"
                            className="rounded-xl h-8 px-3 gap-1.5 hover:bg-primary/10 hover:text-primary hover:border-primary/30"
                            disabled={enter.isPending}
                            onClick={() => enter.mutate({ id: c.id, name: c.name })}
                          >
                            <LogIn className="size-3.5" />
                            <span>Enter</span>
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>

          {/* Mobile & Small Screen Interactive Cards View */}
          <div className="md:hidden divide-y divide-border p-3 space-y-3">
            {isLoading && (
              <div className="py-8 space-y-3">
                <Skeleton className="h-24 w-full rounded-2xl" />
                <Skeleton className="h-24 w-full rounded-2xl" />
              </div>
            )}

            {!isLoading && filtered.length === 0 && (
              <div className="py-12 text-center text-sm text-muted-foreground">
                {search ? "No companies match that search." : "No companies found."}
              </div>
            )}

            {filtered.map((c) => {
              const feeDisplay =
                c.monthlyPrice !== null && c.monthlyPrice !== undefined
                  ? `₹${Number(c.monthlyPrice).toLocaleString()}/mo`
                  : "Custom / Negotiated"

              return (
                <div
                  key={c.id}
                  onClick={() => setDetailCompany(c)}
                  className="rounded-2xl border border-border bg-card p-4 space-y-3 interactive-card cursor-pointer active:scale-[0.99] transition-all"
                >
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <div
                        className="flex size-10 shrink-0 items-center justify-center rounded-xl text-white font-bold text-xs shadow-2xs"
                        style={{ background: c.primaryColor ?? "var(--primary)" }}
                      >
                        {c.name.slice(0, 2).toUpperCase()}
                      </div>
                      <div>
                        <p className="font-semibold text-foreground text-sm">{c.name}</p>
                        <p className="text-xs text-muted-foreground font-mono font-bold">{c.code}</p>
                      </div>
                    </div>

                    <div className="flex flex-col items-end gap-1">
                      <Badge variant={statusTone[c.status]} className="capitalize text-xs">
                        {c.status}
                      </Badge>
                      {c.paymentStatus === "verified" ? (
                        <Badge variant="success" className="text-[10px] gap-1">
                          <CheckCircle2 className="size-2.5" />
                          Verified
                        </Badge>
                      ) : (
                        <Badge variant="warning" className="text-[10px] gap-1">
                          <Clock className="size-2.5" />
                          Pending
                        </Badge>
                      )}
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-2 text-xs border-y border-border/60 py-2.5 bg-muted/20 px-2 rounded-xl">
                    <div>
                      <p className="text-[10px] text-muted-foreground">Fee</p>
                      <p className="font-semibold text-foreground font-mono">{feeDisplay}</p>
                    </div>
                    <div>
                      <p className="text-[10px] text-muted-foreground">Staff</p>
                      <p className="font-semibold text-foreground">{c.employees} / {c.employeeLimit ?? "∞"}</p>
                    </div>
                    <div>
                      <p className="text-[10px] text-muted-foreground">Modules</p>
                      <p className="font-semibold text-foreground">{c.modules} active</p>
                    </div>
                  </div>

                  <div className="flex items-center justify-between pt-1" onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center gap-1.5">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="rounded-xl h-8 px-2 text-xs"
                        onClick={() => setSubscriptionCompany(c)}
                      >
                        Billing
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="rounded-xl h-8 px-2 text-xs"
                        onClick={() => setModulesCompany(c)}
                      >
                        Modules
                      </Button>
                    </div>

                    <Button
                      size="sm"
                      className="rounded-xl h-8 px-3 gap-1.5 text-xs font-semibold"
                      disabled={enter.isPending}
                      onClick={() => enter.mutate({ id: c.id, name: c.name })}
                    >
                      <LogIn className="size-3.5" />
                      <span>Enter</span>
                    </Button>
                  </div>
                </div>
              )
            })}
          </div>
        </CardContent>
      </Card>

      {/* 4. Security & Audit Guidelines Callout */}
      <div className="rounded-2xl border border-border bg-muted/30 p-4 text-xs text-muted-foreground flex items-start gap-3">
        <ShieldCheck className="size-5 shrink-0 text-primary mt-0.5" />
        <p>
          <strong>Security & Tenant Sovereignty Policy:</strong> All telemetry metrics are cross-tenant aggregates.
          Super Admin onboards companies, configures flexible pricing, verifies payments, and delegates user
          creation to the client company HR. Entering a company initiates an immutable, cryptographically recorded
          support session in <code className="rounded bg-muted px-1.5 py-0.5 text-foreground font-mono">support_sessions</code>.
        </p>
      </div>

      {/* Modals */}
      <CreateCompanyDialog
        open={createDialogOpen}
        onOpenChange={setCreateDialogOpen}
      />

      <ManageSubscriptionDialog
        company={subscriptionCompany}
        open={Boolean(subscriptionCompany)}
        onOpenChange={(open) => {
          if (!open) setSubscriptionCompany(null)
        }}
      />

      <ManageModulesDialog
        company={modulesCompany}
        open={Boolean(modulesCompany)}
        onOpenChange={(open) => {
          if (!open) setModulesCompany(null)
        }}
      />

      <CompanyDetailDialog
        company={detailCompany}
        open={Boolean(detailCompany)}
        onOpenChange={(open) => {
          if (!open) setDetailCompany(null)
        }}
        onEnter={(comp) => enter.mutate({ id: comp.id, name: comp.name })}
        onManageBilling={(comp) => setSubscriptionCompany(comp)}
        onManageModules={(comp) => setModulesCompany(comp)}
        entering={enter.isPending}
      />
    </div>
  )
}
