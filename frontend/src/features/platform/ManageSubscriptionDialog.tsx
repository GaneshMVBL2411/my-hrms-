import { useState, useEffect } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { CreditCard, RefreshCw } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
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
import {
  updateCompanySubscription,
  listSubscriptionPlans,
  type CompanyOverview,
} from "@/features/platform/api"
import { errorMessage } from "@/lib/errors"

export function ManageSubscriptionDialog({
  company,
  open,
  onOpenChange,
}: {
  company: CompanyOverview | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const queryClient = useQueryClient()
  const { data: plans = [] } = useQuery({
    queryKey: ["platform", "plans"],
    queryFn: listSubscriptionPlans,
    enabled: open,
  })

  const [planId, setPlanId] = useState<number | undefined>(undefined)
  const [monthlyPrice, setMonthlyPrice] = useState<string>("")
  const [billingCycle, setBillingCycle] = useState<string>("monthly")
  const [paymentStatus, setPaymentStatus] = useState<string>("verified")
  const [paymentReference, setPaymentReference] = useState<string>("")
  const [paymentNotes, setPaymentNotes] = useState<string>("")
  const [companyStatus, setCompanyStatus] = useState<string>("active")
  const [endDate, setEndDate] = useState<string>("")

  useEffect(() => {
    if (company) {
      const currentPlan = plans.find((p) => p.name.toLowerCase() === company.plan?.toLowerCase())
      setPlanId(currentPlan?.id)
      setMonthlyPrice(company.monthlyPrice !== null && company.monthlyPrice !== undefined ? String(company.monthlyPrice) : "")
      setBillingCycle(company.billingCycle ?? "monthly")
      setPaymentStatus(company.paymentStatus ?? "verified")
      setPaymentReference(company.paymentReference ?? "")
      setPaymentNotes(company.paymentNotes ?? "")
      setCompanyStatus(company.status)
      setEndDate(company.endDate ? company.endDate.split("T")[0] : "")
    }
  }, [company, plans])

  const mutation = useMutation({
    mutationFn: () => {
      if (!company) throw new Error("No company selected")
      const priceNum = monthlyPrice ? Number(monthlyPrice) : null
      return updateCompanySubscription({
        companyId: company.id,
        planId,
        monthlyPrice: priceNum,
        billingCycle,
        paymentStatus,
        paymentReference: paymentReference.trim() || undefined,
        paymentNotes: paymentNotes.trim() || undefined,
        status: companyStatus,
        endDate: endDate || null,
      })
    },
    onSuccess: () => {
      toast.success(`Subscription updated for ${company?.name}`)
      queryClient.invalidateQueries({ queryKey: ["platform"] })
      onOpenChange(false)
    },
    onError: (err) => {
      toast.error(errorMessage(err, "Failed to update subscription"))
    },
  })

  if (!company) return null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg rounded-2xl p-6">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <div className="flex size-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <CreditCard className="size-5" />
            </div>
            <div>
              <DialogTitle className="text-base font-bold">Manage Subscription & Payment</DialogTitle>
              <DialogDescription className="text-xs">
                {company.name} (<span className="font-mono">{company.code}</span>)
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <form
          onSubmit={(e) => {
            e.preventDefault()
            mutation.mutate()
          }}
          className="space-y-4 pt-2"
        >
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Subscription Plan</Label>
              <Select
                value={planId ? String(planId) : undefined}
                onValueChange={(val) => setPlanId(Number(val))}
              >
                <SelectTrigger className="rounded-xl h-9 text-xs">
                  <SelectValue placeholder="Select Plan" />
                </SelectTrigger>
                <SelectContent className="rounded-xl text-xs">
                  {plans.map((p) => (
                    <SelectItem key={p.id} value={String(p.id)}>
                      {p.name} {p.priceAmount ? `(₹${p.priceAmount})` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Billing Cycle</Label>
              <Select value={billingCycle} onValueChange={setBillingCycle}>
                <SelectTrigger className="rounded-xl h-9 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="rounded-xl text-xs">
                  <SelectItem value="monthly">Monthly</SelectItem>
                  <SelectItem value="quarterly">Quarterly</SelectItem>
                  <SelectItem value="annual">Annual</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Dynamic / Flexible Subscription Fee */}
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold">
              Subscription Fee (Flexible / Custom Amount)
            </Label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 font-semibold text-xs text-muted-foreground">
                ₹
              </span>
              <Input
                type="number"
                placeholder="Enter agreed fee or leave blank"
                value={monthlyPrice}
                onChange={(e) => setMonthlyPrice(e.target.value)}
                className="rounded-xl h-9 text-xs pl-7 font-mono"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Payment Status</Label>
              <Select value={paymentStatus} onValueChange={setPaymentStatus}>
                <SelectTrigger className="rounded-xl h-9 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="rounded-xl text-xs">
                  <SelectItem value="verified">Verified (Received)</SelectItem>
                  <SelectItem value="pending">Pending Verification</SelectItem>
                  <SelectItem value="waived">Waived (Courtesy)</SelectItem>
                  <SelectItem value="failed">Failed / Past Due</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Account Status</Label>
              <Select value={companyStatus} onValueChange={setCompanyStatus}>
                <SelectTrigger className="rounded-xl h-9 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="rounded-xl text-xs">
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="trial">Trial</SelectItem>
                  <SelectItem value="suspended">Suspended</SelectItem>
                  <SelectItem value="inactive">Inactive</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Payment Reference / UTR</Label>
              <Input
                placeholder="e.g. UTR-2026-98124"
                value={paymentReference}
                onChange={(e) => setPaymentReference(e.target.value)}
                className="rounded-xl h-9 text-xs font-mono"
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Subscription Expiry Date</Label>
              <Input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="rounded-xl h-9 text-xs"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs font-semibold">Payment & Audit Notes</Label>
            <Textarea
              placeholder="e.g. Verified payment against bank statement ref #48912"
              value={paymentNotes}
              onChange={(e) => setPaymentNotes(e.target.value)}
              className="rounded-xl text-xs resize-none h-16"
            />
          </div>

          <DialogFooter className="pt-2">
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
              type="submit"
              size="sm"
              disabled={mutation.isPending}
              className="rounded-xl h-8 px-5 gap-1.5"
            >
              {mutation.isPending && <RefreshCw className="size-3.5 animate-spin" />}
              <span>Save Subscription</span>
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
