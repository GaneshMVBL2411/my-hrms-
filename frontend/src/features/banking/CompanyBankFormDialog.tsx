import { useEffect } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { Loader2 } from "lucide-react"
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
import { Checkbox } from "@/components/ui/checkbox"
import { errorMessage } from "@/lib/errors"
import { upsertCompanyBankDetails } from "@/features/banking/api"
import type { CompanyBankDetails } from "@/features/banking/types"

/**
 * These patterns mirror the CHECK constraints on company_bank_details. Validating
 * here as well is not duplication for its own sake: without it the user gets a
 * raw `violates check constraint "ck_company_bank_ifsc"` from Postgres instead of
 * being told which field is wrong. The database remains the one that decides.
 */
const IFSC = /^[A-Z]{4}0[A-Z0-9]{6}$/
const PAN = /^[A-Z]{5}[0-9]{4}[A-Z]$/
const GST = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]{3}$/

/** Optional text field that is either blank or has to match. */
const optional = (pattern: RegExp, message: string) =>
  z
    .string()
    .trim()
    .refine((v) => v === "" || pattern.test(v.toUpperCase()), message)

const schema = z.object({
  companyName: z.string().trim().min(1, "Company name is required"),
  legalName: z.string().trim(),
  bankName: z.string().trim().min(1, "Bank name is required"),
  accountHolderName: z.string().trim().min(1, "Account holder name is required"),
  accountNumber: z
    .string()
    .trim()
    .min(6, "Account number looks too short")
    .max(30, "Account number looks too long")
    .regex(/^[0-9]+$/, "Digits only"),
  ifscCode: z
    .string()
    .trim()
    .min(1, "IFSC is required")
    .refine((v) => IFSC.test(v.toUpperCase()), "Must look like HDFC0001234"),
  branchName: z.string().trim(),
  swiftCode: optional(/^[A-Z0-9]{8}([A-Z0-9]{3})?$/, "Must be 8 or 11 characters"),
  upiId: z.string().trim(),
  gstNumber: optional(GST, "Must be a 15-character GSTIN"),
  panNumber: optional(PAN, "Must look like ABCDE1234F"),
  tanNumber: optional(/^[A-Z]{4}[0-9]{5}[A-Z]$/, "Must look like BLRW12345C"),
  pfRegistrationNumber: z.string().trim(),
  esiRegistrationNumber: z.string().trim(),
  authorizedSignatory: z.string().trim(),
  logoUrl: z.string().trim(),
  signatureUrl: z.string().trim(),
  isPrimary: z.boolean(),
})

type FormValues = z.infer<typeof schema>

const EMPTY: FormValues = {
  companyName: "",
  legalName: "",
  bankName: "",
  accountHolderName: "",
  accountNumber: "",
  ifscCode: "",
  branchName: "",
  swiftCode: "",
  upiId: "",
  gstNumber: "",
  panNumber: "",
  tanNumber: "",
  pfRegistrationNumber: "",
  esiRegistrationNumber: "",
  authorizedSignatory: "",
  logoUrl: "",
  signatureUrl: "",
  isPrimary: false,
}

export function CompanyBankFormDialog({
  account,
  open,
  onOpenChange,
}: {
  account?: CompanyBankDetails
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const queryClient = useQueryClient()

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: EMPTY })

  useEffect(() => {
    if (!open) return
    reset(
      account
        ? {
            companyName: account.companyName,
            legalName: account.legalName ?? "",
            bankName: account.bankName,
            accountHolderName: account.accountHolderName,
            accountNumber: account.accountNumber,
            ifscCode: account.ifscCode,
            branchName: account.branchName ?? "",
            swiftCode: account.swiftCode ?? "",
            upiId: account.upiId ?? "",
            gstNumber: account.gstNumber ?? "",
            panNumber: account.panNumber ?? "",
            tanNumber: account.tanNumber ?? "",
            pfRegistrationNumber: account.pfRegistrationNumber ?? "",
            esiRegistrationNumber: account.esiRegistrationNumber ?? "",
            authorizedSignatory: account.authorizedSignatory ?? "",
            logoUrl: account.logoUrl ?? "",
            signatureUrl: account.signatureUrl ?? "",
            isPrimary: account.isPrimary,
          }
        : EMPTY
    )
  }, [open, account, reset])

  const mutation = useMutation({
    mutationFn: (values: FormValues) =>
      upsertCompanyBankDetails(account?.id ?? null, {
        ...values,
        // The database stores these upper-cased; matching it here keeps the form
        // from redisplaying a different string than what was saved.
        ifscCode: values.ifscCode.toUpperCase(),
        swiftCode: values.swiftCode.toUpperCase(),
        gstNumber: values.gstNumber.toUpperCase(),
        panNumber: values.panNumber.toUpperCase(),
        tanNumber: values.tanNumber.toUpperCase(),
        status: account?.status ?? "active",
      }),
    onSuccess: () => {
      toast.success(account ? "Bank details updated" : "Bank account added")
      queryClient.invalidateQueries({ queryKey: ["company-bank"] })
      onOpenChange(false)
    },
    onError: (error) => toast.error(errorMessage(error, "Could not save bank details")),
  })

  const field = (
    name: keyof FormValues,
    label: string,
    props: React.ComponentProps<typeof Input> = {}
  ) => (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <Input {...props} {...register(name)} />
      {errors[name] && <p className="text-xs text-destructive">{errors[name]?.message}</p>}
    </div>
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto rounded-md">
        <DialogHeader>
          <DialogTitle>{account ? "Edit bank account" : "Add bank account"}</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit((values) => mutation.mutate(values))} className="space-y-6">
          <section className="space-y-4">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Company</h3>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {field("companyName", "Company name")}
              {field("legalName", "Legal name")}
            </div>
          </section>

          <section className="space-y-4">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Bank</h3>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {field("bankName", "Bank name")}
              {field("accountHolderName", "Account holder name")}
              {field("accountNumber", "Account number", { inputMode: "numeric", autoComplete: "off" })}
              {field("ifscCode", "IFSC code", { placeholder: "HDFC0001234", className: "uppercase" })}
              {field("branchName", "Branch name")}
              {field("swiftCode", "SWIFT code", { className: "uppercase" })}
            </div>
            {field("upiId", "UPI ID", { placeholder: "company@bank" })}
          </section>

          <section className="space-y-4">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Statutory registration
            </h3>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {field("gstNumber", "GST number", { className: "uppercase" })}
              {field("panNumber", "PAN number", { placeholder: "ABCDE1234F", className: "uppercase" })}
              {field("tanNumber", "TAN number", { className: "uppercase" })}
              {field("pfRegistrationNumber", "PF registration number")}
              {field("esiRegistrationNumber", "ESI registration number")}
            </div>
          </section>

          <section className="space-y-4">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Payslip branding
            </h3>
            {field("authorizedSignatory", "Authorized signatory")}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {field("logoUrl", "Company logo URL")}
              {field("signatureUrl", "Digital signature URL")}
            </div>
            <p className="text-xs text-muted-foreground">
              Both appear on generated payslips. Save the account first to upload image files instead.
            </p>
          </section>

          <label className="flex items-center gap-2 text-sm text-foreground">
            <Checkbox
              checked={watch("isPrimary")}
              onCheckedChange={(checked) => setValue("isPrimary", checked === true)}
            />
            Use this account to pay salaries
          </label>

          <DialogFooter>
            <Button type="button" variant="outline" className="rounded-md" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting} className="rounded-md">
              {isSubmitting && <Loader2 className="mr-2 size-4 animate-spin" />}
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
