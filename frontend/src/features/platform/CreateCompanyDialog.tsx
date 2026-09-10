import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import {
  Building2,
  KeyRound,
  CreditCard,
  Layers,
  Copy,
  Check,
  RefreshCw,
  Eye,
  EyeOff,
  Sparkles,
  ShieldCheck,
  CheckCircle2,
} from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"
import { Textarea } from "@/components/ui/textarea"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  createCompany,
  listSubscriptionPlans,
  type CreateCompanyInput,
  type CreateCompanyResult,
} from "@/features/platform/api"
import { errorMessage } from "@/lib/errors"

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

const COLOR_PRESETS = [
  { label: "Emerald", hex: "#0F4C34" },
  { label: "Teal", hex: "#2E6A76" },
  { label: "Indigo", hex: "#4F46E5" },
  { label: "Sky", hex: "#0284C7" },
  { label: "Violet", hex: "#7C3AED" },
  { label: "Rose", hex: "#E11D48" },
  { label: "Slate", hex: "#334155" },
]

function generateSecurePassword(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%^&*"
  let pwd = ""
  for (let i = 0; i < 14; i++) {
    pwd += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  // Guarantee rules: upper, lower, number, special
  return "Hrms@" + pwd.slice(0, 8) + "1!"
}

export function CreateCompanyDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const queryClient = useQueryClient()
  const { data: plans = [] } = useQuery({
    queryKey: ["platform", "plans"],
    queryFn: listSubscriptionPlans,
    enabled: open,
  })

  // Form state
  const [activeTab, setActiveTab] = useState("company")
  const [name, setName] = useState("")
  const [code, setCode] = useState("")
  const [phone, setPhone] = useState("")
  const [country, setCountry] = useState("India")
  const [primaryColor, setPrimaryColor] = useState("#0F4C34")

  // Admin credentials state
  const [adminName, setAdminName] = useState("")
  const [adminEmail, setAdminEmail] = useState("")
  const [adminPassword, setAdminPassword] = useState(generateSecurePassword)
  const [showPassword, setShowPassword] = useState(false)

  // Subscription state (dynamic fee, no fixed amount enforced)
  const [planId, setPlanId] = useState<number | undefined>(undefined)
  const [monthlyPrice, setMonthlyPrice] = useState<string>("")
  const [billingCycle, setBillingCycle] = useState("monthly")
  const [paymentStatus, setPaymentStatus] = useState<"verified" | "pending" | "waived">("verified")
  const [paymentReference, setPaymentReference] = useState("")
  const [paymentNotes, setPaymentNotes] = useState("")

  // Modules state
  const [selectedModules, setSelectedModules] = useState<string[]>(ALL_MODULES.map((m) => m.id))

  // Result state for success screen
  const [createdResult, setCreatedResult] = useState<{
    result: CreateCompanyResult
    passwordUsed: string
    fee: string
  } | null>(null)
  const [copied, setCopied] = useState(false)

  const mutation = useMutation({
    mutationFn: (input: CreateCompanyInput) => createCompany(input),
    onSuccess: (data) => {
      toast.success(`Company ${data.name} created successfully!`)
      setCreatedResult({
        result: data,
        passwordUsed: adminPassword,
        fee: monthlyPrice ? `₹${monthlyPrice}/mo` : "Custom / Negotiated",
      })
      queryClient.invalidateQueries({ queryKey: ["platform"] })
    },
    onError: (err) => {
      toast.error(errorMessage(err, "Failed to create company"))
    },
  })

  const handleNameChange = (val: string) => {
    setName(val)
    if (!code) {
      // Auto-suggest 3-4 letter uppercase code
      const suggested = val
        .replace(/[^A-Za-z]/g, "")
        .slice(0, 4)
        .toUpperCase()
      setCode(suggested)
    }
  }

  const handlePlanSelect = (selectedId: string) => {
    const id = Number(selectedId)
    setPlanId(id)
    const found = plans.find((p) => p.id === id)
    if (found?.priceAmount && !monthlyPrice) {
      setMonthlyPrice(String(found.priceAmount))
    }
  }

  const toggleModule = (id: string) => {
    setSelectedModules((prev) =>
      prev.includes(id) ? prev.filter((m) => m !== id) : [...prev, id]
    )
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) {
      toast.error("Company name is required")
      setActiveTab("company")
      return
    }
    if (!code.trim()) {
      toast.error("Company code is required")
      setActiveTab("company")
      return
    }
    if (!adminName.trim()) {
      toast.error("Admin contact name is required")
      setActiveTab("admin")
      return
    }
    if (!adminEmail.trim()) {
      toast.error("Admin login email is required")
      setActiveTab("admin")
      return
    }
    if (!adminPassword || adminPassword.length < 8) {
      toast.error("Password must be at least 8 characters")
      setActiveTab("admin")
      return
    }

    const priceNum = monthlyPrice ? Number(monthlyPrice) : null

    mutation.mutate({
      name: name.trim(),
      code: code.trim().toUpperCase(),
      adminName: adminName.trim(),
      adminEmail: adminEmail.trim().toLowerCase(),
      adminPassword,
      planId,
      monthlyPrice: priceNum,
      billingCycle,
      paymentStatus,
      paymentReference: paymentReference.trim() || undefined,
      paymentNotes: paymentNotes.trim() || undefined,
      modules: selectedModules,
      phone: phone.trim() || undefined,
      country,
      primaryColor,
    })
  }

  const handleCopyCredentials = () => {
    if (!createdResult) return
    const text = `==============================================
HRMS PORTAL - COMPANY ACCESS CREDENTIALS
==============================================
Company Name : ${createdResult.result.name}
Company Code : ${createdResult.result.code}
Admin Login  : ${createdResult.result.adminEmail}
Password     : ${createdResult.passwordUsed}
Subscription : ${createdResult.fee}
Status       : ${createdResult.result.status.toUpperCase()}
==============================================
Client HR can log in to setup bank details and add team members.`
    navigator.clipboard.writeText(text)
    setCopied(true)
    toast.success("Credentials copied to clipboard!")
    setTimeout(() => setCopied(false), 2500)
  }

  const handleClose = () => {
    if (mutation.isPending) return
    setCreatedResult(null)
    setName("")
    setCode("")
    setPhone("")
    setAdminName("")
    setAdminEmail("")
    setAdminPassword(generateSecurePassword())
    setMonthlyPrice("")
    setPaymentReference("")
    setPaymentNotes("")
    setActiveTab("company")
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl p-6">
        {createdResult ? (
          // Success Screen
          <div className="space-y-6 py-2">
            <div className="flex flex-col items-center text-center space-y-2">
              <div className="flex size-14 items-center justify-center rounded-2xl bg-success/15 text-success">
                <CheckCircle2 className="size-8" />
              </div>
              <h2 className="text-xl font-bold text-foreground">Company Onboarded Successfully!</h2>
              <p className="text-xs text-muted-foreground max-w-md">
                <strong>{createdResult.result.name}</strong> ({createdResult.result.code}) has been
                registered. Initial administrative access has been generated.
              </p>
            </div>

            <div className="rounded-2xl border border-border bg-muted/40 p-4 space-y-3 font-mono text-xs">
              <div className="flex items-center justify-between border-b border-border/60 pb-2">
                <span className="text-muted-foreground font-sans font-medium">Company Code:</span>
                <span className="font-bold text-foreground text-sm">{createdResult.result.code}</span>
              </div>
              <div className="flex items-center justify-between border-b border-border/60 pb-2">
                <span className="text-muted-foreground font-sans font-medium">Admin Email:</span>
                <span className="font-semibold text-foreground">{createdResult.result.adminEmail}</span>
              </div>
              <div className="flex items-center justify-between border-b border-border/60 pb-2">
                <span className="text-muted-foreground font-sans font-medium">Initial Password:</span>
                <span className="font-bold text-primary text-sm">{createdResult.passwordUsed}</span>
              </div>
              <div className="flex items-center justify-between border-b border-border/60 pb-2">
                <span className="text-muted-foreground font-sans font-medium">Subscription:</span>
                <span className="font-sans font-semibold text-foreground">{createdResult.fee}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground font-sans font-medium">Payment Status:</span>
                <Badge variant="success" className="capitalize text-[11px]">
                  {paymentStatus}
                </Badge>
              </div>
            </div>

            <div className="rounded-xl border border-primary/20 bg-primary/5 p-3 text-xs text-muted-foreground flex items-start gap-2.5">
              <ShieldCheck className="size-4 shrink-0 text-primary mt-0.5" />
              <p>
                <strong>Company HR Sovereignty:</strong> Provide these credentials to the client HR/Owner.
                They will be able to log in, configure company bank payout details, and invite their own
                employees without Super Admin intervention.
              </p>
            </div>

            <div className="flex flex-col sm:flex-row items-center justify-end gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                className="w-full sm:w-auto rounded-xl gap-2 h-9"
                onClick={handleCopyCredentials}
              >
                {copied ? <Check className="size-4 text-success" /> : <Copy className="size-4" />}
                <span>{copied ? "Copied Slip!" : "Copy Credentials Slip"}</span>
              </Button>
              <Button
                type="button"
                className="w-full sm:w-auto rounded-xl h-9"
                onClick={handleClose}
              >
                Done
              </Button>
            </div>
          </div>
        ) : (
          // Multi-tab Wizard
          <form onSubmit={handleSubmit} className="space-y-5">
            <DialogHeader>
              <div className="flex items-center gap-2">
                <div className="flex size-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <Building2 className="size-5" />
                </div>
                <div>
                  <DialogTitle className="text-lg font-bold">Onboard New Client Company</DialogTitle>
                  <DialogDescription className="text-xs">
                    Create company, set flexible subscription & payment, and configure module permissions
                  </DialogDescription>
                </div>
              </div>
            </DialogHeader>

            <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
              <TabsList className="grid grid-cols-4 rounded-xl bg-muted/60 p-1 text-xs">
                <TabsTrigger value="company" className="rounded-lg text-xs gap-1.5 data-[state=active]:font-semibold">
                  <Building2 className="size-3.5" />
                  <span className="hidden sm:inline">Company</span>
                </TabsTrigger>
                <TabsTrigger value="admin" className="rounded-lg text-xs gap-1.5 data-[state=active]:font-semibold">
                  <KeyRound className="size-3.5" />
                  <span className="hidden sm:inline">Admin Access</span>
                </TabsTrigger>
                <TabsTrigger value="billing" className="rounded-lg text-xs gap-1.5 data-[state=active]:font-semibold">
                  <CreditCard className="size-3.5" />
                  <span className="hidden sm:inline">Subscription</span>
                </TabsTrigger>
                <TabsTrigger value="modules" className="rounded-lg text-xs gap-1.5 data-[state=active]:font-semibold">
                  <Layers className="size-3.5" />
                  <span className="hidden sm:inline">Modules</span>
                </TabsTrigger>
              </TabsList>

              {/* Tab 1: Company Profile */}
              <TabsContent value="company" className="space-y-4 pt-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                  <div className="space-y-1.5 sm:col-span-2">
                    <Label className="text-xs font-semibold">Company Full Name *</Label>
                    <Input
                      placeholder="e.g. Apex Global Solutions Pvt Ltd"
                      value={name}
                      onChange={(e) => handleNameChange(e.target.value)}
                      required
                      className="rounded-xl h-9 text-xs"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold">Short Code (Unique Identifier) *</Label>
                    <Input
                      placeholder="e.g. APEX"
                      value={code}
                      onChange={(e) => setCode(e.target.value.toUpperCase())}
                      maxLength={10}
                      required
                      className="rounded-xl h-9 text-xs font-mono font-bold tracking-wide"
                    />
                    <p className="text-[10px] text-muted-foreground">Used in employee codes (e.g. APEX-0001)</p>
                  </div>

                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold">Country</Label>
                    <Input
                      value={country}
                      onChange={(e) => setCountry(e.target.value)}
                      className="rounded-xl h-9 text-xs"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold">Contact Phone Number</Label>
                    <Input
                      placeholder="+91 98765 43210"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      className="rounded-xl h-9 text-xs"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold">Primary Brand Theme</Label>
                    <div className="flex items-center gap-2">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {COLOR_PRESETS.map((color) => (
                          <button
                            key={color.hex}
                            type="button"
                            onClick={() => setPrimaryColor(color.hex)}
                            className={`size-6 rounded-full border-2 transition-all ${
                              primaryColor.toLowerCase() === color.hex.toLowerCase()
                                ? "scale-110 border-foreground shadow-sm"
                                : "border-transparent hover:scale-105"
                            }`}
                            style={{ backgroundColor: color.hex }}
                            title={color.label}
                          />
                        ))}
                      </div>
                      <Input
                        value={primaryColor}
                        onChange={(e) => setPrimaryColor(e.target.value)}
                        className="w-24 h-8 rounded-xl text-xs font-mono"
                      />
                    </div>
                  </div>
                </div>

                <div className="flex justify-end pt-2">
                  <Button
                    type="button"
                    size="sm"
                    className="rounded-xl h-8 px-4"
                    onClick={() => setActiveTab("admin")}
                  >
                    Next: Admin Access &rarr;
                  </Button>
                </div>
              </TabsContent>

              {/* Tab 2: Initial Admin Access */}
              <TabsContent value="admin" className="space-y-4 pt-3">
                <div className="rounded-xl border border-primary/20 bg-primary/5 p-3 text-xs text-muted-foreground flex items-start gap-2">
                  <Sparkles className="size-4 shrink-0 text-primary mt-0.5" />
                  <p>
                    <strong>Company HR Credentials:</strong> These credentials will be provided to the
                    client's HR / Admin so they can log into the portal and create their own users.
                  </p>
                </div>

                <div className="space-y-3.5">
                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold">Admin Contact Full Name *</Label>
                    <Input
                      placeholder="e.g. Priya Sharma"
                      value={adminName}
                      onChange={(e) => setAdminName(e.target.value)}
                      required
                      className="rounded-xl h-9 text-xs"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold">Admin Login Email *</Label>
                    <Input
                      type="email"
                      placeholder="e.g. hr@apexsolutions.com"
                      value={adminEmail}
                      onChange={(e) => setAdminEmail(e.target.value)}
                      required
                      className="rounded-xl h-9 text-xs"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <Label className="text-xs font-semibold">Initial Password *</Label>
                      <button
                        type="button"
                        onClick={() => setAdminPassword(generateSecurePassword())}
                        className="inline-flex items-center gap-1 text-[11px] font-medium text-primary hover:underline"
                      >
                        <RefreshCw className="size-3" />
                        Generate Strong Password
                      </button>
                    </div>
                    <div className="relative">
                      <Input
                        type={showPassword ? "text" : "password"}
                        value={adminPassword}
                        onChange={(e) => setAdminPassword(e.target.value)}
                        required
                        className="rounded-xl h-9 text-xs pr-10 font-mono"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      >
                        {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                      </button>
                    </div>
                    <p className="text-[10px] text-muted-foreground">
                      Must be at least 8 characters with upper, lower, and number/symbol.
                    </p>
                  </div>
                </div>

                <div className="flex justify-between pt-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="rounded-xl h-8 px-4"
                    onClick={() => setActiveTab("company")}
                  >
                    &larr; Back
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    className="rounded-xl h-8 px-4"
                    onClick={() => setActiveTab("billing")}
                  >
                    Next: Subscription &rarr;
                  </Button>
                </div>
              </TabsContent>

              {/* Tab 3: Subscription & Payment */}
              <TabsContent value="billing" className="space-y-4 pt-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold">Subscription Plan</Label>
                    <Select value={planId ? String(planId) : undefined} onValueChange={handlePlanSelect}>
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

                  {/* Flexible/Custom Subscription Fee input */}
                  <div className="space-y-1.5 sm:col-span-2">
                    <Label className="text-xs font-semibold">
                      Custom Subscription Fee (Flexible / Negotiated Amount)
                    </Label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 font-semibold text-xs text-muted-foreground">
                        ₹
                      </span>
                      <Input
                        type="number"
                        placeholder="Enter agreed monthly amount or leave blank"
                        value={monthlyPrice}
                        onChange={(e) => setMonthlyPrice(e.target.value)}
                        className="rounded-xl h-9 text-xs pl-7 font-mono"
                      />
                    </div>
                    <p className="text-[10px] text-muted-foreground">
                      No fixed pricing is enforced. You can set any customized monthly rate agreed with the client.
                    </p>
                  </div>

                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold">Payment Status</Label>
                    <Select
                      value={paymentStatus}
                      onValueChange={(val) => setPaymentStatus(val as "verified" | "pending" | "waived")}
                    >
                      <SelectTrigger className="rounded-xl h-9 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="rounded-xl text-xs">
                        <SelectItem value="verified">Verified (Payment Received)</SelectItem>
                        <SelectItem value="pending">Pending Verification</SelectItem>
                        <SelectItem value="waived">Waived (Trial / Courtesy)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold">Payment Reference / Transaction ID</Label>
                    <Input
                      placeholder="e.g. UTR-2026-98124 or UPI Ref"
                      value={paymentReference}
                      onChange={(e) => setPaymentReference(e.target.value)}
                      className="rounded-xl h-9 text-xs font-mono"
                    />
                  </div>

                  <div className="space-y-1.5 sm:col-span-2">
                    <Label className="text-xs font-semibold">Payment & Billing Notes</Label>
                    <Textarea
                      placeholder="e.g. Paid via NEFT for Q3 advance, invoice #INV-9021"
                      value={paymentNotes}
                      onChange={(e) => setPaymentNotes(e.target.value)}
                      className="rounded-xl text-xs resize-none h-16"
                    />
                  </div>
                </div>

                <div className="flex justify-between pt-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="rounded-xl h-8 px-4"
                    onClick={() => setActiveTab("admin")}
                  >
                    &larr; Back
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    className="rounded-xl h-8 px-4"
                    onClick={() => setActiveTab("modules")}
                  >
                    Next: Module Access &rarr;
                  </Button>
                </div>
              </TabsContent>

              {/* Tab 4: Module Permissions */}
              <TabsContent value="modules" className="space-y-4 pt-3">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-xs font-semibold text-foreground">Permitted Functional Modules</h3>
                    <p className="text-[11px] text-muted-foreground">
                      Enable or disable features for this company. Disabled modules are hidden from tenant view.
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 text-xs px-2"
                      onClick={() => setSelectedModules(ALL_MODULES.map((m) => m.id))}
                    >
                      Select All
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 text-xs px-2 text-muted-foreground"
                      onClick={() => setSelectedModules([])}
                    >
                      Clear All
                    </Button>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-60 overflow-y-auto pr-1">
                  {ALL_MODULES.map((m) => {
                    const isChecked = selectedModules.includes(m.id)
                    return (
                      <label
                        key={m.id}
                        className={`flex items-start gap-2.5 p-2.5 rounded-xl border transition-colors cursor-pointer ${
                          isChecked
                            ? "border-primary/40 bg-primary/5"
                            : "border-border bg-card/60 hover:bg-muted/30"
                        }`}
                      >
                        <Checkbox
                          checked={isChecked}
                          onCheckedChange={() => toggleModule(m.id)}
                          className="mt-0.5"
                        />
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-semibold text-foreground truncate">{m.name}</p>
                          <p className="text-[10px] text-muted-foreground line-clamp-1">{m.desc}</p>
                        </div>
                      </label>
                    )
                  })}
                </div>

                <div className="flex justify-between pt-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="rounded-xl h-8 px-4"
                    onClick={() => setActiveTab("billing")}
                  >
                    &larr; Back
                  </Button>
                  <Button
                    type="submit"
                    size="sm"
                    disabled={mutation.isPending}
                    className="rounded-xl h-8 px-5 gap-1.5 font-semibold"
                  >
                    {mutation.isPending && <RefreshCw className="size-3.5 animate-spin" />}
                    <span>{mutation.isPending ? "Creating Company..." : "Create & Activate Company"}</span>
                  </Button>
                </div>
              </TabsContent>
            </Tabs>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
