import { useRef, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { format } from "date-fns"
import { Plus, Pencil, BadgeCheck, Eye, EyeOff, Upload, Landmark, ShieldAlert } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { errorMessage } from "@/lib/errors"
import { useAuth } from "@/features/auth/AuthContext"
import {
  listCompanyBankDetails,
  uploadCompanyAsset,
  upsertCompanyBankDetails,
  verifyCompanyBankDetails,
} from "@/features/banking/api"
import { CompanyBankFormDialog } from "@/features/banking/CompanyBankFormDialog"
import type { CompanyBankDetails } from "@/features/banking/types"

function mask(accountNumber: string): string {
  return `${"•".repeat(Math.max(accountNumber.length - 4, 0))}${accountNumber.slice(-4)}`
}

function Row({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="space-y-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm font-medium text-foreground">{value?.trim() ? value : "—"}</dd>
    </div>
  )
}

function AccountCard({
  account,
  canEdit,
  canVerify,
  onEdit,
}: {
  account: CompanyBankDetails
  canEdit: boolean
  canVerify: boolean
  onEdit: () => void
}) {
  const queryClient = useQueryClient()
  // Revealed per card rather than page-wide: a full account number should be a
  // deliberate act, not the default state of a screen someone leaves open.
  const [revealed, setRevealed] = useState(false)
  const logoInput = useRef<HTMLInputElement>(null)
  const signatureInput = useRef<HTMLInputElement>(null)

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["company-bank"] })

  const verifyMutation = useMutation({
    mutationFn: () => verifyCompanyBankDetails(account.id),
    onSuccess: () => {
      toast.success("Account verified")
      invalidate()
    },
    onError: (error) => toast.error(errorMessage(error, "Could not verify this account")),
  })

  const uploadMutation = useMutation({
    mutationFn: async ({ kind, file }: { kind: "logo" | "signature"; file: File }) => {
      const url = await uploadCompanyAsset(account.id, kind, file)
      // upsert_company_bank_details() coalesces over omitted keys, so sending
      // only the changed URL leaves every other column untouched.
      await upsertCompanyBankDetails(account.id, {
        companyName: account.companyName,
        bankName: account.bankName,
        accountHolderName: account.accountHolderName,
        accountNumber: account.accountNumber,
        ifscCode: account.ifscCode,
        isPrimary: account.isPrimary,
        status: account.status,
        ...(kind === "logo" ? { logoUrl: url } : { signatureUrl: url }),
      })
    },
    onSuccess: () => {
      toast.success("Image uploaded")
      invalidate()
    },
    onError: (error) => toast.error(errorMessage(error, "Could not upload the image")),
  })

  return (
    <Card className="rounded-md border shadow-none">
      <CardContent className="space-y-5 py-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-md bg-secondary text-secondary-foreground">
              <Landmark className="size-5" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-foreground">{account.bankName}</h3>
              <p className="text-xs text-muted-foreground">{account.companyName}</p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            {account.isPrimary && <Badge>Payout account</Badge>}
            <Badge variant={account.status === "active" ? "outline" : "secondary"} className="capitalize">
              {account.status}
            </Badge>
            {account.verifiedAt ? (
              <Badge variant="outline" className="gap-1 text-emerald-600">
                <BadgeCheck className="size-3" />
                Verified
              </Badge>
            ) : (
              <Badge variant="outline" className="gap-1 text-amber-600">
                <ShieldAlert className="size-3" />
                Unverified
              </Badge>
            )}
          </div>
        </div>

        <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Row label="Account holder" value={account.accountHolderName} />
          <div className="space-y-0.5">
            <dt className="text-xs text-muted-foreground">Account number</dt>
            <dd className="flex items-center gap-2 text-sm font-medium text-foreground">
              <span className="font-mono">
                {revealed ? account.accountNumber : mask(account.accountNumber)}
              </span>
              <button
                type="button"
                onClick={() => setRevealed((prev) => !prev)}
                className="text-muted-foreground hover:text-foreground"
                aria-label={revealed ? "Hide account number" : "Show account number"}
              >
                {revealed ? <Eye className="size-3.5" /> : <EyeOff className="size-3.5" />}
              </button>
            </dd>
          </div>
          <Row label="IFSC" value={account.ifscCode} />
          <Row label="Branch" value={account.branchName} />
          <Row label="SWIFT" value={account.swiftCode} />
          <Row label="UPI ID" value={account.upiId} />
          <Row label="GST" value={account.gstNumber} />
          <Row label="PAN" value={account.panNumber} />
          <Row label="TAN" value={account.tanNumber} />
          <Row label="PF registration" value={account.pfRegistrationNumber} />
          <Row label="ESI registration" value={account.esiRegistrationNumber} />
          <Row label="Authorized signatory" value={account.authorizedSignatory} />
        </dl>

        <div className="flex flex-wrap items-center gap-6">
          <div className="space-y-1.5">
            <p className="text-xs text-muted-foreground">Company logo</p>
            {account.logoUrl ? (
              <img src={account.logoUrl} alt="" className="h-10 object-contain" />
            ) : (
              <p className="text-xs text-muted-foreground">Not set</p>
            )}
          </div>
          <div className="space-y-1.5">
            <p className="text-xs text-muted-foreground">Digital signature</p>
            {account.signatureUrl ? (
              <img src={account.signatureUrl} alt="" className="h-10 object-contain" />
            ) : (
              <p className="text-xs text-muted-foreground">Not set</p>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
          <p className="text-xs text-muted-foreground">
            Updated {format(new Date(account.updatedAt), "d MMM yyyy")}
            {account.updatedByName ? ` by ${account.updatedByName}` : ""}
            {account.verifiedAt && account.verifiedByName
              ? ` · verified by ${account.verifiedByName}`
              : ""}
          </p>

          <div className="flex flex-wrap gap-2">
            {canEdit && (
              <>
                <input
                  ref={logoInput}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0]
                    if (file) uploadMutation.mutate({ kind: "logo", file })
                    e.target.value = ""
                  }}
                />
                <input
                  ref={signatureInput}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0]
                    if (file) uploadMutation.mutate({ kind: "signature", file })
                    e.target.value = ""
                  }}
                />
                <Button
                  variant="outline"
                  size="sm"
                  className="rounded-md"
                  disabled={uploadMutation.isPending}
                  onClick={() => logoInput.current?.click()}
                >
                  <Upload className="mr-2 size-3.5" />
                  Logo
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="rounded-md"
                  disabled={uploadMutation.isPending}
                  onClick={() => signatureInput.current?.click()}
                >
                  <Upload className="mr-2 size-3.5" />
                  Signature
                </Button>
                <Button variant="outline" size="sm" className="rounded-md" onClick={onEdit}>
                  <Pencil className="mr-2 size-3.5" />
                  Edit
                </Button>
              </>
            )}
            {canVerify && !account.verifiedAt && (
              <Button
                size="sm"
                className="rounded-md"
                disabled={verifyMutation.isPending}
                onClick={() => verifyMutation.mutate()}
              >
                <BadgeCheck className="mr-2 size-3.5" />
                Verify
              </Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

export function CompanyBankPage() {
  const { user } = useAuth()
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<CompanyBankDetails | undefined>(undefined)

  // The route already refuses everyone else; these only decide what is rendered.
  // The database re-checks both — upsert requires HR, verify requires accounts.
  const canEdit = (user?.role === "founder" || user?.role === "company_admin") || user?.role === "hr_admin"
  const canVerify = (user?.role === "founder" || user?.role === "company_admin") || user?.role === "accounts_manager"

  const { data: accounts, isLoading, error } = useQuery({
    queryKey: ["company-bank"],
    queryFn: listCompanyBankDetails,
  })

  return (
    <div className="flex flex-1 flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Company Bank Details</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            The accounts salaries are paid from, and the registration numbers that appear on payslips.
          </p>
        </div>
        {canEdit && (
          <Button
            className="rounded-md"
            onClick={() => {
              setEditing(undefined)
              setFormOpen(true)
            }}
          >
            <Plus className="mr-2 size-4" />
            Add account
          </Button>
        )}
      </div>

      {isLoading && <Skeleton className="h-64 w-full rounded-md" />}

      {error && (
        <Card className="rounded-md border shadow-none">
          <CardContent className="py-10 text-center">
            <p className="text-sm text-destructive">{errorMessage(error, "Could not load bank details")}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              If this says the function does not exist, migrations 0007–0009 have not been applied yet.
            </p>
          </CardContent>
        </Card>
      )}

      {accounts?.length === 0 && (
        <Card className="rounded-md border border-dashed shadow-none">
          <CardContent className="py-12 text-center">
            <Landmark className="mx-auto size-8 text-muted-foreground" />
            <p className="mt-3 text-sm font-medium text-foreground">No bank account on file</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Payroll needs a payout account before it can produce a payment file.
            </p>
          </CardContent>
        </Card>
      )}

      <div className="flex flex-col gap-4">
        {accounts?.map((account) => (
          <AccountCard
            key={account.id}
            account={account}
            canEdit={canEdit}
            canVerify={canVerify}
            onEdit={() => {
              setEditing(account)
              setFormOpen(true)
            }}
          />
        ))}
      </div>

      <CompanyBankFormDialog open={formOpen} onOpenChange={setFormOpen} account={editing} />
    </div>
  )
}
