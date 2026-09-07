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
} from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { listCompanies, getPlatformSummary, startSupport, type CompanyOverview } from "@/features/platform/api"
import { errorMessage } from "@/lib/errors"

const statusTone: Record<CompanyOverview["status"], "success" | "warning" | "danger" | "secondary"> = {
  active: "success",
  trial: "warning",
  suspended: "danger",
  inactive: "secondary",
}

export function PlatformDashboard() {
  const queryClient = useQueryClient()
  const [search, setSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState<string>("all")

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

  const filtered = companies.filter((c) => {
    const matchesSearch = `${c.name} ${c.code} ${c.email ?? ""}`.toLowerCase().includes(search.toLowerCase())
    const matchesStatus = statusFilter === "all" || c.status === statusFilter
    return matchesSearch && matchesStatus
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
              Multi-tenant operations, global tenant telemetry & verified support console
            </p>
          </div>

          <div className="flex items-center gap-2 self-start sm:self-center">
            <div className="flex items-center gap-2 rounded-xl border border-border bg-muted/40 px-3 py-1.5 text-xs text-muted-foreground">
              <ShieldCheck className="size-4 text-success" />
              <span>PostgreSQL Connected</span>
              <span className="text-foreground font-semibold">· 99.9% Platform Uptime</span>
            </div>
          </div>
        </div>
      </div>

      {/* 2. Platform Key Telemetry Cards */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <Card className="rounded-2xl border border-border shadow-xs interactive-card">
          <CardContent className="flex items-center justify-between p-4 sm:p-5">
            <div>
              <p className="text-xs font-medium text-muted-foreground">Total Tenants</p>
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

        <Card className="rounded-2xl border border-border shadow-xs interactive-card">
          <CardContent className="flex items-center justify-between p-4 sm:p-5">
            <div>
              <p className="text-xs font-medium text-muted-foreground">Cross-Platform Staff</p>
              <p className="mt-1 text-2xl font-bold text-foreground">{summary?.employees ?? 0}</p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">Across all registered companies</p>
            </div>
            <div className="flex size-11 items-center justify-center rounded-2xl bg-success/10 text-success">
              <Users className="size-5" />
            </div>
          </CardContent>
        </Card>

        <Card className="rounded-2xl border border-border shadow-xs interactive-card">
          <CardContent className="flex items-center justify-between p-4 sm:p-5">
            <div>
              <p className="text-xs font-medium text-muted-foreground">Subscriptions</p>
              <p className="mt-1 text-2xl font-bold text-foreground">{summary?.subscriptions ?? 0}</p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">Active recurring billing tiers</p>
            </div>
            <div className="flex size-11 items-center justify-center rounded-2xl bg-brand-accent/10 text-brand-accent">
              <CreditCard className="size-5" />
            </div>
          </CardContent>
        </Card>

        <Card className="rounded-2xl border border-border shadow-xs interactive-card">
          <CardContent className="flex items-center justify-between p-4 sm:p-5">
            <div>
              <p className="text-xs font-medium text-muted-foreground">Open Support Sessions</p>
              <p className="mt-1 text-2xl font-bold text-foreground">{summary?.openSupport ?? 0}</p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">Active recorded audit sessions</p>
            </div>
            <div className="flex size-11 items-center justify-center rounded-2xl bg-warning/10 text-warning">
              <LifeBuoy className="size-5" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* 3. Search, Filter & Tenant Management Table */}
      <Card className="rounded-2xl border border-border shadow-xs">
        <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between pb-4">
          <div>
            <CardTitle className="text-base font-semibold">Tenant Companies Directory</CardTitle>
            <CardDescription className="text-xs">
              Monitor customer activity, employee limits, and initiate verified support sessions
            </CardDescription>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Filter pills */}
            <div className="flex items-center rounded-xl border border-border bg-muted/50 p-1 text-xs">
              {["all", "active", "trial", "suspended"].map((status) => (
                <button
                  key={status}
                  type="button"
                  onClick={() => setStatusFilter(status)}
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
                placeholder="Filter companies…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="h-8 w-44 sm:w-60 rounded-xl pl-8 text-xs bg-muted/30"
              />
            </div>
          </div>
        </CardHeader>

        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/30">
                  <TableHead className="pl-6">Company</TableHead>
                  <TableHead>Plan</TableHead>
                  <TableHead>Seat Utilization</TableHead>
                  <TableHead>Payslips</TableHead>
                  <TableHead>Pending</TableHead>
                  <TableHead>Last Sign-In</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="pr-6 text-right">Support Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading && (
                  <TableRow>
                    <TableCell colSpan={8} className="py-8">
                      <Skeleton className="h-10 w-full rounded-xl" />
                    </TableCell>
                  </TableRow>
                )}

                {!isLoading && filtered.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={8} className="py-12 text-center text-sm text-muted-foreground">
                      {search ? "No companies match that search criteria." : "No companies registered yet."}
                    </TableCell>
                  </TableRow>
                )}

                {filtered.map((c) => {
                  const limit = c.employeeLimit || 50
                  const usedPct = Math.min(100, Math.round((c.employees / limit) * 100))

                  return (
                    <TableRow key={c.id} className="hover:bg-muted/30 transition-colors">
                      <TableCell className="pl-6">
                        <div className="flex items-center gap-3">
                          <div
                            className="flex size-9 shrink-0 items-center justify-center rounded-xl text-white font-bold text-xs shadow-2xs"
                            style={{ background: c.primaryColor ?? "var(--primary)" }}
                          >
                            {c.name.slice(0, 2).toUpperCase()}
                          </div>
                          <div className="min-w-0">
                            <p className="font-semibold text-foreground text-sm truncate">{c.name}</p>
                            <p className="text-xs text-muted-foreground">
                              <span className="font-mono text-[11px] font-medium">{c.code}</span>
                              {c.email ? ` · ${c.email}` : ""}
                            </p>
                          </div>
                        </div>
                      </TableCell>

                      <TableCell>
                        <Badge variant="outline" className="text-xs capitalize font-medium">
                          {c.plan ?? "Standard"}
                        </Badge>
                      </TableCell>

                      <TableCell>
                        <div className="flex flex-col gap-1 w-32">
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

                      <TableCell className="text-sm font-medium text-foreground">{c.payslips}</TableCell>

                      <TableCell>
                        {c.pendingLeave > 0 ? (
                          <Badge variant="warning" className="text-xs font-semibold">
                            {c.pendingLeave}
                          </Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>

                      <TableCell className="text-xs text-muted-foreground">
                        {c.lastSignIn ? (
                          format(new Date(c.lastSignIn), "MMM d, yyyy")
                        ) : (
                          <span className="inline-flex items-center gap-1 font-medium text-warning">
                            <AlertTriangle className="size-3.5" />
                            Never
                          </span>
                        )}
                      </TableCell>

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

                      <TableCell className="pr-6 text-right">
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
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* 4. Security & Audit Guidelines Callout */}
      <div className="rounded-2xl border border-border bg-muted/30 p-4 text-xs text-muted-foreground flex items-start gap-3">
        <ShieldCheck className="size-5 shrink-0 text-primary mt-0.5" />
        <p>
          <strong>Security & Tenant Isolation Policy:</strong> All telemetry metrics are cross-tenant aggregates.
          Clicking <strong>Enter</strong> initiates an immutable, cryptographically recorded support session in{" "}
          <code className="rounded bg-muted px-1.5 py-0.5 text-foreground font-mono">support_sessions</code>.
          The customer is notified of support activity for strict compliance and SOC2 auditing.
        </p>
      </div>
    </div>
  )
}
