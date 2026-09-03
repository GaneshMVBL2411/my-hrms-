import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { Building2, Users, CreditCard, LifeBuoy, LogIn, AlertTriangle } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { listCompanies, getPlatformSummary, startSupport, type CompanyOverview } from "@/features/platform/api"
import { errorMessage } from "@/lib/errors"

/**
 * What the platform owner sees: every client company, and the way in to each.
 *
 * The counts here are aggregates only — headcount, payslips issued, pending
 * approvals. Enough to run the business and to spot which customer is stuck,
 * without reading anybody's payroll. Seeing actual records means entering the
 * company, which is a recorded act.
 */

const statusTone: Record<CompanyOverview["status"], "success" | "warning" | "danger" | "secondary"> = {
  active: "success",
  trial: "warning",
  suspended: "danger",
  inactive: "secondary",
}

function StatCard({ label, value, icon: Icon }: { label: string; value: number; icon: typeof Building2 }) {
  return (
    <Card className="rounded-md border shadow-none">
      <CardContent className="flex items-center justify-between py-4">
        <div>
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className="mt-1 text-lg font-semibold text-foreground">{value}</p>
        </div>
        <span className="rounded-md bg-primary/10 p-2 text-primary">
          <Icon className="size-4" />
        </span>
      </CardContent>
    </Card>
  )
}

export function PlatformDashboard() {
  const queryClient = useQueryClient()
  const [search, setSearch] = useState("")

  const { data: summary } = useQuery({ queryKey: ["platform", "summary"], queryFn: getPlatformSummary })
  const { data: companies, isLoading } = useQuery({
    queryKey: ["platform", "companies"],
    queryFn: listCompanies,
  })

  const enter = useMutation({
    mutationFn: ({ id, name }: { id: number; name: string }) =>
      startSupport(id, `Support session opened from the platform console for ${name}`),
    onSuccess: () => {
      // The session changes what every subsequent request resolves to, so the
      // whole cache is stale — reloading is simpler and less error-prone than
      // trying to invalidate each key.
      toast.success("Support session opened")
      queryClient.clear()
      window.location.href = "/dashboard"
    },
    onError: (error) => toast.error(errorMessage(error, "Could not open the support session")),
  })

  const filtered = (companies ?? []).filter((c) =>
    `${c.name} ${c.code} ${c.email ?? ""}`.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div className="flex flex-1 flex-col gap-5">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Platform</h1>
        <p className="text-sm text-muted-foreground">Every company on this HRMS.</p>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Companies" value={summary?.companies ?? 0} icon={Building2} />
        <StatCard label="Active" value={summary?.activeCompanies ?? 0} icon={Building2} />
        <StatCard label="Employees" value={summary?.employees ?? 0} icon={Users} />
        <StatCard label="Subscriptions" value={summary?.subscriptions ?? 0} icon={CreditCard} />
      </div>

      <Input
        placeholder="Search companies…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="max-w-sm rounded-md"
      />

      <div className="overflow-x-auto rounded-md border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Company</TableHead>
              <TableHead>Plan</TableHead>
              <TableHead>Employees</TableHead>
              <TableHead>Payslips</TableHead>
              <TableHead>Pending</TableHead>
              <TableHead>Last sign-in</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="w-32" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && (
              <TableRow>
                <TableCell colSpan={8}>
                  <Skeleton className="h-8 w-full rounded-md" />
                </TableCell>
              </TableRow>
            )}

            {!isLoading && filtered.length === 0 && (
              <TableRow>
                <TableCell colSpan={8} className="py-8 text-center text-sm text-muted-foreground">
                  {search ? "No companies match that search." : "No companies yet."}
                </TableCell>
              </TableRow>
            )}

            {filtered.map((c) => (
              <TableRow key={c.id}>
                <TableCell>
                  <div className="flex items-center gap-2">
                    {/* The company's own colour, so the list is scannable by
                        brand rather than by reading every name. */}
                    <span
                      className="size-2.5 shrink-0 rounded-full"
                      style={{ background: c.primaryColor ?? "var(--muted-foreground)" }}
                      aria-hidden="true"
                    />
                    <div className="min-w-0">
                      <p className="font-medium text-foreground">{c.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {c.code}
                        {c.email ? ` · ${c.email}` : ""}
                      </p>
                    </div>
                  </div>
                </TableCell>
                <TableCell className="text-muted-foreground">{c.plan ?? "—"}</TableCell>
                <TableCell>
                  {c.employees}
                  {c.employeeLimit ? (
                    <span className="text-muted-foreground"> / {c.employeeLimit}</span>
                  ) : null}
                </TableCell>
                <TableCell className="text-muted-foreground">{c.payslips}</TableCell>
                <TableCell>
                  {c.pendingLeave > 0 ? (
                    <Badge variant="warning">{c.pendingLeave}</Badge>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {/* Never signed in is the clearest sign an onboarding stalled,
                      so it is called out rather than shown as a blank. */}
                  {c.lastSignIn ? (
                    new Date(c.lastSignIn).toLocaleDateString("en-IN")
                  ) : (
                    <span className="inline-flex items-center gap-1 text-warning">
                      <AlertTriangle className="size-3.5" />
                      never
                    </span>
                  )}
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-1.5">
                    <Badge variant={statusTone[c.status]} className="capitalize">
                      {c.status}
                    </Badge>
                    {c.supportOpen && (
                      <Badge variant="warning" className="gap-1">
                        <LifeBuoy className="size-3" />
                        in support
                      </Badge>
                    )}
                  </div>
                </TableCell>
                <TableCell>
                  <Button
                    size="sm"
                    variant="outline"
                    className="rounded-md"
                    disabled={enter.isPending}
                    onClick={() => enter.mutate({ id: c.id, name: c.name })}
                  >
                    <LogIn className="mr-1.5 size-3.5" />
                    Manage
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <p className="text-xs text-muted-foreground">
        These are totals only. Opening a company with <strong>Manage</strong> starts a support session — it
        is recorded, the customer can see it, and every action taken inside is attributed to you.
      </p>
    </div>
  )
}
