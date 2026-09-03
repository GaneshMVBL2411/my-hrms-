import { useRef, useState } from "react"
import { Download, Loader2 } from "lucide-react"
import { toast } from "sonner"
import { Dialog, DialogContent } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { PrintDocument } from "@/components/shared/PrintDocument"
import { useAuth } from "@/features/auth/AuthContext"
import { downloadElementAsPdf } from "@/lib/pdf"
import type { LetterPayload } from "@/features/documents/types"

/**
 * Every generated letter, laid out to match the Word templates in
 * `Letterhead template design`.
 *
 * Those templates share one structure, and so does this:
 *
 *   1. a document title      "Letter of Offer", "Experience Certificate"
 *   2. the recipient block   name and address, or "To Whomsoever It May Concern"
 *   3. a subject line        where the template has one
 *   4. salutation
 *   5. body paragraphs
 *   6. a details table       label/value pairs in a tinted box
 *   7. closing paragraphs
 *   8. signature block       "For <company>," / Authorised Signatory
 *   9. acceptance block      offer and appointment only, which are countersigned
 *
 * Previously the offer letter had a rich layout and everything else shared a
 * thin generic one. The templates make no such distinction — a relieving letter
 * is as formal a document as an offer — so the structure is now shared and only
 * the wording differs.
 */

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

const TITLE: Record<LetterPayload["letterType"], string> = {
  offer: "Letter of Offer",
  appointment: "Appointment Letter",
  experience: "Experience Certificate",
  relieving: "Relieving Letter",
  certificate: "Certificate of Employment",
}

/** Countersigned by the employee; the others are issued, not agreed. */
const COUNTERSIGNED: LetterPayload["letterType"][] = ["offer", "appointment"]

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4 border-b border-[#eaf0ec] py-1.5 text-[13px] last:border-b-0">
      <dt className="text-[#6e7679]">{label}</dt>
      <dd className="text-right font-medium text-foreground">{value}</dd>
    </div>
  )
}

function LetterContent({ letter, primary }: { letter: LetterPayload; primary: string }) {
  const designation = letter.designationTitle ?? "your role"
  const department = letter.departmentName ?? "your department"
  const joining = letter.joiningDate ? formatDate(letter.joiningDate) : "your date of joining"
  const today = formatDate(letter.today)
  const firstName = letter.employeeName.split(" ")[0]
  const company = letter.companyName

  const ctc = letter.annualCtc ? `${money(letter.annualCtc)} per annum` : "As per company policy"
  const probation = letter.probationText ?? "Six months from the date of joining"
  const notice = letter.noticePeriodText ?? "Thirty days on either side after confirmation"

  // The two certificates address the world rather than the employee, which the
  // templates reflect in the salutation and in who the details describe.
  const addressesEmployee = letter.letterType !== "certificate"

  const body: React.ReactNode[] = []
  const details: { label: string; value: string }[] = []

  switch (letter.letterType) {
    case "offer":
      body.push(
        <>
          Further to our discussions and your interview with us, we are pleased to offer you the position of{" "}
          <strong>{designation}</strong> in the <strong>{department}</strong> function of {company}. Your
          appointment shall be effective from <strong>{joining}</strong>
          {letter.reportingManagerName ? (
            <> and you will report to <strong>{letter.reportingManagerName}</strong>.</>
          ) : (
            "."
          )}
        </>,
        <>
          Your employment will be governed by the terms set out in this letter and by the policies of the LLP
          as amended from time to time. This offer is subject to satisfactory verification of your credentials
          and background checks.
        </>
      )
      details.push(
        { label: "Designation", value: designation },
        { label: "Department", value: department },
        { label: "Date of joining", value: joining },
        { label: "Annual CTC", value: ctc },
        { label: "Probation", value: probation },
        { label: "Notice period", value: notice }
      )
      break

    case "appointment":
      body.push(
        <>
          With reference to your application and the discussions you have had with us, we are pleased to
          confirm your appointment as <strong>{designation}</strong> in the <strong>{department}</strong>{" "}
          function of {company}, with effect from <strong>{joining}</strong>.
          {letter.reportingManagerName ? (
            <> You will report to <strong>{letter.reportingManagerName}</strong>.</>
          ) : null}
        </>,
        <>
          Your services will be confirmed on satisfactory completion of the probation period stated above.
          Your employment shall be governed by the terms of this letter and by the policies of the LLP as
          amended from time to time, and you are expected to maintain the confidentiality of all information
          that comes to you in the course of your work.
        </>
      )
      details.push(
        { label: "Employee code", value: letter.employeeCode },
        { label: "Designation", value: designation },
        { label: "Department", value: department },
        { label: "Date of joining", value: joining },
        { label: "Annual CTC", value: ctc },
        { label: "Probation", value: probation },
        { label: "Notice period", value: notice }
      )
      break

    case "experience":
      body.push(
        <>
          This is to certify that <strong>{letter.employeeName}</strong>, bearing Employee Code{" "}
          <strong>{letter.employeeCode}</strong>, was employed with {company} from <strong>{joining}</strong>{" "}
          to <strong>{today}</strong>.
        </>,
        <>
          At the time of relieving, they held the position of <strong>{designation}</strong> in the{" "}
          <strong>{department}</strong> function.
        </>,
        <>
          During their tenure with us, they discharged the responsibilities entrusted to them with diligence,
          professional integrity and commitment. Their conduct throughout the period of service was found to
          be satisfactory.
        </>,
        <>
          We place on record our appreciation for their contribution and wish them success in their future
          endeavours. This certificate is issued at the request of the employee for the purpose of record.
        </>
      )
      details.push(
        { label: "Employee code", value: letter.employeeCode },
        { label: "Period of service", value: `${joining} — ${today}` },
        { label: "Last designation", value: `${designation}, ${department}` },
        { label: "Employment type", value: "Full-time / Permanent" }
      )
      break

    case "relieving":
      body.push(
        <>
          This is to confirm that <strong>{letter.employeeName}</strong> (Employee Code{" "}
          <strong>{letter.employeeCode}</strong>) has been relieved from their duties as{" "}
          <strong>{designation}</strong> in the <strong>{department}</strong> function at {company}, with
          effect from <strong>{today}</strong>.
        </>,
        <>
          All company property in their possession has been returned and their dues have been settled. We
          thank them for their contribution during their tenure with us and wish them the very best in their
          future endeavours.
        </>
      )
      details.push(
        { label: "Employee code", value: letter.employeeCode },
        { label: "Period of service", value: `${joining} — ${today}` },
        { label: "Last designation", value: `${designation}, ${department}` },
        { label: "Relieved with effect from", value: today }
      )
      break

    case "certificate":
      body.push(
        <>
          This is to certify that <strong>{letter.employeeName}</strong>, bearing Employee Code{" "}
          <strong>{letter.employeeCode}</strong>, is currently employed with {company} as{" "}
          <strong>{designation}</strong> in the <strong>{department}</strong> function, and has been since{" "}
          <strong>{joining}</strong>.
        </>,
        <>This certificate is issued upon request for official purposes.</>
      )
      details.push(
        { label: "Employee code", value: letter.employeeCode },
        { label: "Designation", value: `${designation}, ${department}` },
        { label: "Date of joining", value: joining },
        { label: "Employment status", value: "Active" }
      )
      break
  }

  return (
    <>
      {/* 1 — the document title, which every template carries */}
      <h2
        className="text-center text-base font-bold tracking-wide"
        style={{ color: primary, fontFamily: "Georgia, 'Times New Roman', serif" }}
      >
        {TITLE[letter.letterType].toUpperCase()}
      </h2>

      {/* 2 — recipient */}
      {addressesEmployee ? (
        <div className="mt-4">
          <p className="text-sm font-medium">{letter.employeeName}</p>
          {letter.employeeAddress && (
            <p className="text-sm text-muted-foreground">{letter.employeeAddress}</p>
          )}
        </div>
      ) : null}

      {/* 3 — subject, where the template has one */}
      {(letter.letterType === "offer" || letter.letterType === "appointment") && (
        <p className="mt-4 text-sm font-semibold">
          Subject: {letter.letterType === "offer" ? "Offer of employment" : "Appointment"} —{" "}
          {designation}, {department}
        </p>
      )}

      {/* 4 — salutation */}
      <p className="mt-3 text-sm">
        {addressesEmployee ? `Dear ${firstName},` : "To Whomsoever It May Concern,"}
      </p>

      {/* 5 — body */}
      {body.map((paragraph, i) => (
        <p key={i} className="mt-3 text-sm leading-relaxed text-foreground">
          {paragraph}
        </p>
      ))}

      {/* 6 — details */}
      <dl className="mt-4 rounded-sm border border-[#eaf0ec] bg-[#f8faf9] px-4 py-1">
        {details.map((d) => (
          <DetailRow key={d.label} label={d.label} value={d.value} />
        ))}
      </dl>

      {/* 7 — closing */}
      {letter.letterType === "offer" && (
        <p className="mt-3 text-sm leading-relaxed text-foreground">
          Kindly sign and return a copy of this letter as a token of your acceptance. We look forward to your
          association with us and to the growth we will build together.
        </p>
      )}
      {letter.letterType === "appointment" && (
        <p className="mt-3 text-sm leading-relaxed text-foreground">
          Kindly sign and return the duplicate copy of this letter in token of your acceptance. We welcome you
          to {company} and look forward to a long and rewarding association.
        </p>
      )}

      {letter.customMessage && (
        <p className="mt-3 text-sm italic text-muted-foreground">{letter.customMessage}</p>
      )}

      {/* 8 and 9 — signature, and acceptance where the document is countersigned */}
      <div className="mt-8 flex justify-between gap-8 text-sm">
        <div>
          <p>{letter.letterType === "offer" ? "Yours sincerely," : `For ${company},`}</p>
          <p className="mt-8 font-medium">Authorised Signatory</p>
          <p className="text-xs text-muted-foreground">Designated Partner / Head — Human Resources</p>
        </div>

        {COUNTERSIGNED.includes(letter.letterType) && (
          <div className="text-right">
            <p>Accepted and agreed</p>
            <p className="mt-8 font-medium">{letter.employeeName}</p>
            <p className="text-xs text-muted-foreground">Signature / Date</p>
          </div>
        )}
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
  const { user } = useAuth()
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

  // Matches the templates: WPL/HR/OFR/2026/001
  const refLine =
    `Ref: ${letter.companyCode ?? "HR"}/HR/${REF_ABBREV[letter.letterType]}/` +
    `${new Date(letter.today).getFullYear()}/${String(letter.id).padStart(3, "0")}` +
    `  ·  Date: ${formatDate(letter.today)}`

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton className="max-h-[90vh] max-w-2xl overflow-y-auto rounded-md p-0">
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
          refLine={refLine}
        >
          <LetterContent letter={letter} primary={user?.primaryColor ?? "#0f4c34"} />
        </PrintDocument>
      </DialogContent>
    </Dialog>
  )
}
