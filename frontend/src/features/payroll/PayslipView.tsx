import { useRef, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { Download, Loader2 } from "lucide-react"
import { toast } from "sonner"
import { Dialog, DialogContent } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { PrintDocument } from "@/components/shared/PrintDocument"
import { rupeesInWords } from "@/lib/numberToWords"
import { downloadElementAsPdf } from "@/lib/pdf"
import { getPayslip } from "@/features/payroll/api"

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
]

function money(value: number) {
  return `₹${value.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function DetailCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3 border-b border-[#eaf0ec] px-3 py-1 text-[12px]">
      <dt className="text-[#6e7679]">{label}</dt>
      <dd className="text-right font-medium text-foreground">{value}</dd>
    </div>
  )
}

export function PayslipView({
  payslipId,
  open,
  onOpenChange,
}: {
  payslipId: number | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { data: payslip, isLoading } = useQuery({
    queryKey: ["payslips", payslipId],
    queryFn: () => getPayslip(payslipId!),
    enabled: open && !!payslipId,
  })

  const printRef = useRef<HTMLDivElement>(null)
  const [downloading, setDownloading] = useState(false)

  const totalDeductions = payslip
    ? payslip.pfDeduction + payslip.esiDeduction + payslip.professionalTax
    : 0

  const handleDownload = async () => {
    if (!printRef.current || !payslip) return
    setDownloading(true)
    try {
      const filename = `Payslip_${payslip.employeeCode}_${MONTHS[payslip.month - 1]}${payslip.year}.pdf`
      await downloadElementAsPdf(printRef.current, filename)
    } catch {
      toast.error("Could not generate PDF")
    } finally {
      setDownloading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton
        className="max-h-[90vh] max-w-2xl overflow-y-auto rounded-md p-0"
      >
        {isLoading || !payslip ? (
          <div className="p-6">
            <Skeleton className="h-96 w-full rounded-md" />
          </div>
        ) : (
          <>
            <div className="flex items-center justify-end gap-2 px-4 pt-4">
              <Button
                variant="outline"
                size="sm"
                className="rounded-md"
                disabled={downloading}
                onClick={handleDownload}
              >
                {downloading ? <Loader2 className="mr-2 size-4 animate-spin" /> : <Download className="mr-2 size-4" />}
                Download PDF
              </Button>
            </div>

            <PrintDocument ref={printRef}
              companyName="Whhohh Path LLP"
              refLine={`Ref: WPL/PAY/${payslip.year}/${String(payslip.id).padStart(3, "0")}`}
            >
              <p className="text-center text-sm font-semibold text-[#0f4c34]">
                Salary Slip · For the month of {MONTHS[payslip.month - 1]} {payslip.year}
              </p>

              <div className="mt-3 grid grid-cols-2 overflow-hidden rounded-sm border border-[#eaf0ec]">
                <DetailCell label="Employee name" value={payslip.employeeName} />
                <DetailCell label="Employee code" value={payslip.employeeCode} />
                <DetailCell label="Designation" value={payslip.designationTitle ?? "—"} />
                <DetailCell label="Department" value={payslip.departmentName ?? "—"} />
                <DetailCell
                  label="Date of joining"
                  value={payslip.joiningDate ? new Date(payslip.joiningDate).toLocaleDateString("en-IN") : "—"}
                />
                <DetailCell label="Generated on" value={new Date(payslip.generatedAt).toLocaleDateString("en-IN")} />
              </div>

              <table className="mt-3 w-full border-collapse overflow-hidden rounded-sm border border-[#eaf0ec] text-[12px]">
                <thead>
                  <tr className="bg-[#eaf0ec] text-left text-[#0f4c34]">
                    <th className="px-3 py-1 font-semibold">Earnings</th>
                    <th className="px-3 py-1 text-right font-semibold">Amount</th>
                    <th className="border-l border-[#eaf0ec] px-3 py-1 font-semibold">Deductions</th>
                    <th className="px-3 py-1 text-right font-semibold">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-t border-[#eaf0ec]">
                    <td className="px-3 py-1">Basic salary</td>
                    <td className="px-3 py-1 text-right">{money(payslip.basic)}</td>
                    <td className="border-l border-[#eaf0ec] px-3 py-1">Provident Fund</td>
                    <td className="px-3 py-1 text-right">{money(payslip.pfDeduction)}</td>
                  </tr>
                  <tr className="border-t border-[#eaf0ec]">
                    <td className="px-3 py-1">House Rent Allowance</td>
                    <td className="px-3 py-1 text-right">{money(payslip.hra)}</td>
                    <td className="border-l border-[#eaf0ec] px-3 py-1">ESIC</td>
                    <td className="px-3 py-1 text-right">{money(payslip.esiDeduction)}</td>
                  </tr>
                  <tr className="border-t border-[#eaf0ec]">
                    <td className="px-3 py-1">Special Allowance</td>
                    <td className="px-3 py-1 text-right">{money(payslip.specialAllowance)}</td>
                    <td className="border-l border-[#eaf0ec] px-3 py-1">Professional Tax</td>
                    <td className="px-3 py-1 text-right">{money(payslip.professionalTax)}</td>
                  </tr>
                  <tr className="border-t border-[#eaf0ec] bg-[#f8faf9] font-semibold text-foreground">
                    <td className="px-3 py-1">Gross Earnings</td>
                    <td className="px-3 py-1 text-right">{money(payslip.grossPay)}</td>
                    <td className="border-l border-[#eaf0ec] px-3 py-1">Total Deductions</td>
                    <td className="px-3 py-1 text-right">{money(totalDeductions)}</td>
                  </tr>
                </tbody>
              </table>

              <div className="mt-3 flex items-center justify-between rounded-sm bg-[#0f4c34] px-4 py-2 text-white">
                <span className="text-sm font-semibold">NET PAY</span>
                <span className="text-base font-semibold">{money(payslip.netPay)}</span>
              </div>

              <p className="mt-2 text-[12px] text-foreground">
                Net pay in words: <em>{rupeesInWords(payslip.netPay)}</em>
              </p>

              <p className="mt-3 text-[10px] leading-relaxed text-[#6e7679]">
                This is a computer-generated statement of salary and does not require a signature. For any
                discrepancy, write to hr@whhoohhpath.com within seven days of receipt. This document is confidential
                and intended solely for the employee named above.
              </p>

              <div className="mt-4 flex justify-between text-xs">
                <div>
                  <p className="text-[10px] text-[#6e7679]">Prepared by</p>
                  <p className="mt-4 font-medium">Payroll</p>
                </div>
                <div className="text-right">
                  <p className="text-[10px] text-[#6e7679]">For Whhohh Path LLP</p>
                  <p className="mt-4 font-medium">Authorised Signatory</p>
                </div>
              </div>
            </PrintDocument>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
