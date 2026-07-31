import { useRef, useState } from "react"
import { Download, Loader2 } from "lucide-react"
import { toast } from "sonner"
import { Dialog, DialogContent } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { PrintDocument } from "@/components/shared/PrintDocument"
import { downloadElementAsPdf } from "@/lib/pdf"
import type { LetterPayload } from "@/features/documents/types"

function formatDate(value: string) {
  return new Date(value).toLocaleDateString("en-IN", { year: "numeric", month: "long", day: "numeric" })
}

function money(value: number) {
  return `₹${value.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`
}

const REF_ABBREV: Record<LetterPayload["letterType"], string> = {
  offer: "OFR",
  appointment: "APT",
  experience: "EXP",
  relieving: "REL",
  certificate: "CERT",
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4 border-b border-[#eaf0ec] py-1.5 text-[13px] last:border-b-0">
      <dt className="text-[#6e7679]">{label}</dt>
      <dd className="text-right font-medium text-foreground">{value}</dd>
    </div>
  )
}

function LetterContent({ letter }: { letter: LetterPayload }) {
  const designation = letter.designationTitle ?? "your role"
  const department = letter.departmentName ?? "your department"
  const joining = letter.joiningDate ? formatDate(letter.joiningDate) : "your date of joining"
  const firstName = letter.employeeName.split(" ")[0]

  if (letter.letterType === "offer") {
    return (
      <>
        <p className="text-sm">{letter.employeeName}</p>
        {letter.employeeAddress && <p className="text-sm text-muted-foreground">{letter.employeeAddress}</p>}

        <p className="mt-4 text-sm font-semibold">
          Subject: Offer of employment — {designation}, {department}
        </p>
        <p className="mt-3 text-sm">Dear {firstName},</p>

        <p className="mt-3 text-sm leading-relaxed text-foreground">
          Further to our discussions and your interview with us, we are pleased to offer you the position of{" "}
          <strong>{designation}</strong> in the <strong>{department}</strong> function of {letter.companyName}. Your
          appointment shall be effective from <strong>{joining}</strong>
          {letter.reportingManagerName ? (
            <>
              {" "}
              and you will report to <strong>{letter.reportingManagerName}</strong>.
            </>
          ) : (
            "."
          )}
        </p>

        <p className="mt-3 text-sm leading-relaxed text-foreground">
          Your employment will be governed by the terms of this letter and by the policies of the LLP as amended
          from time to time. This offer is subject to satisfactory verification of your credentials and background
          checks.
        </p>

        <dl className="mt-4 rounded-sm border border-[#eaf0ec] bg-[#f8faf9] px-4 py-1">
          <DetailRow label="Designation" value={designation} />
          <DetailRow
            label="Annual CTC"
            value={letter.annualCtc ? `${money(letter.annualCtc)} per annum` : "As per company policy"}
          />
          <DetailRow label="Probation" value={letter.probationText ?? "Six months from the date of joining"} />
          <DetailRow
            label="Notice period"
            value={letter.noticePeriodText ?? "Thirty days on either side after confirmation"}
          />
        </dl>

        <p className="mt-3 text-sm leading-relaxed text-foreground">
          Kindly sign and return a copy of this letter as a token of your acceptance. We look forward to your
          association with us and to the growth we will build together.
        </p>

        {letter.customMessage && <p className="mt-3 text-sm italic text-muted-foreground">{letter.customMessage}</p>}

        <div className="mt-8 flex justify-between text-sm">
          <div>
            <p>Yours sincerely,</p>
            <p className="mt-8 font-medium">Authorised Signatory</p>
            <p className="text-xs text-muted-foreground">Designated Partner — {letter.companyName}</p>
          </div>
          <div className="text-right">
            <p>Accepted and agreed</p>
            <p className="mt-8 font-medium">{letter.employeeName}</p>
            <p className="text-xs text-muted-foreground">Signature / Date</p>
          </div>
        </div>
      </>
    )
  }

  if (letter.letterType === "experience") {
    return (
      <>
        <h3 className="text-center text-base font-bold tracking-wide text-[#0f4c34]">EXPERIENCE CERTIFICATE</h3>

        <p className="mt-4 text-sm leading-relaxed text-foreground">
          This is to certify that <strong>{letter.employeeName}</strong>, bearing Employee Code{" "}
          <strong>{letter.employeeCode}</strong>, was employed with {letter.companyName} from{" "}
          <strong>{joining}</strong> to <strong>{formatDate(letter.today)}</strong>.
        </p>

        <p className="mt-3 text-sm leading-relaxed text-foreground">
          At the time of relieving, they held the position of <strong>{designation}</strong> in the{" "}
          <strong>{department}</strong> function.
        </p>

        <p className="mt-3 text-sm leading-relaxed text-foreground">
          During their tenure with us, they discharged the responsibilities entrusted to them with diligence,
          professional integrity and commitment. Their conduct throughout the period of service was found to be
          satisfactory.
        </p>

        <p className="mt-3 text-sm leading-relaxed text-foreground">
          We place on record our appreciation for their contribution and wish them success in their future
          endeavours.
        </p>

        {letter.customMessage && <p className="mt-3 text-sm italic text-muted-foreground">{letter.customMessage}</p>}

        <p className="mt-3 text-sm text-foreground">
          This certificate is issued at the request of the employee for the purpose of record.
        </p>

        <dl className="mt-4 rounded-sm border border-[#eaf0ec] bg-[#f8faf9] px-4 py-1">
          <DetailRow label="Period of service" value={`${joining} – ${formatDate(letter.today)}`} />
          <DetailRow label="Last designation" value={`${designation}, ${department}`} />
        </dl>

        <div className="mt-8 text-sm">
          <p>For {letter.companyName},</p>
          <p className="mt-8 font-medium">Authorised Signatory</p>
          <p className="text-xs text-muted-foreground">Designated Partner / Head — Human Resources</p>
        </div>
      </>
    )
  }

  const heading =
    letter.letterType === "appointment"
      ? "Appointment Letter"
      : letter.letterType === "relieving"
        ? "Relieving Letter"
        : "Certificate of Employment"

  const bodyParagraph = (() => {
    switch (letter.letterType) {
      case "appointment":
        return `Further to your offer of employment, we are pleased to confirm your appointment as ${designation} in the ${department} team, effective ${joining}.${
          letter.reportingManagerName ? ` You will be reporting to ${letter.reportingManagerName}.` : ""
        } This appointment is subject to the terms and conditions of employment as per company policy.`
      case "relieving":
        return `This is to confirm that ${letter.employeeName} (Employee Code ${letter.employeeCode}) has been relieved from their duties as ${designation} at ${letter.companyName}, effective ${formatDate(letter.today)}. We thank them for their contributions during their tenure with us and wish them the very best in their future endeavours.`
      default:
        return `This is to certify that ${letter.employeeName}, bearing Employee Code ${letter.employeeCode}, is currently employed with ${letter.companyName} as ${designation} in the ${department} department, since ${joining}. This certificate is issued upon request for official purposes.`
    }
  })()

  return (
    <>
      <p className="text-sm">{letter.employeeName}</p>
      {letter.employeeAddress && <p className="text-sm text-muted-foreground">{letter.employeeAddress}</p>}

      <p className="mt-4 text-sm">
        {letter.letterType === "appointment" || letter.letterType === "relieving"
          ? `Dear ${firstName},`
          : "To Whomsoever It May Concern,"}
      </p>

      <h3 className="mt-2 text-base font-semibold text-[#0f4c34]">{heading}</h3>

      <p className="mt-3 text-sm leading-relaxed text-foreground">{bodyParagraph}</p>

      {letter.customMessage && <p className="mt-3 text-sm italic text-muted-foreground">{letter.customMessage}</p>}

      <div className="mt-8 text-sm">
        <p>For {letter.companyName},</p>
        <p className="mt-8 font-medium">Authorised Signatory</p>
      </div>
    </>
  )
}

export function LetterView({
  letter,
  open,
  onOpenChange,
}: {
  letter: LetterPayload | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const printRef = useRef<HTMLDivElement>(null)
  const [downloading, setDownloading] = useState(false)

  if (!letter) return null

  const handleDownload = async () => {
    if (!printRef.current) return
    setDownloading(true)
    try {
      const filename = `${letter.letterType}_letter_${letter.employeeCode}.pdf`
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
        <div className="flex items-center justify-end gap-2 px-4 pt-4">
          <Button variant="outline" size="sm" className="rounded-md" disabled={downloading} onClick={handleDownload}>
            {downloading ? <Loader2 className="mr-2 size-4 animate-spin" /> : <Download className="mr-2 size-4" />}
            Download PDF
          </Button>
        </div>

        <PrintDocument
          ref={printRef}
          companyName={letter.companyName}
          companyAddress={letter.companyAddress}
          refLine={`Ref: WPL/HR/${REF_ABBREV[letter.letterType]}/${new Date(letter.today).getFullYear()}/${String(letter.id).padStart(3, "0")}  ·  Date: ${formatDate(letter.today)}`}
        >
          <LetterContent letter={letter} />
        </PrintDocument>
      </DialogContent>
    </Dialog>
  )
}
