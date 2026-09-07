import type { LetterPayload, LetterType } from "./api"

/**
 * A generated letter, turned into the document that gets read.
 *
 * The wording lives here rather than in the screen, and it is deliberately the
 * same wording as the portal's LetterView. A letter is a legal-ish artefact: an
 * offer issued from a phone and the same offer re-opened on the web have to say
 * the same thing, or the company has quietly issued two different documents.
 * Keeping this a pure function of the payload — no components, no styles — is
 * what makes that easy to check, and it is also what lets the same structure be
 * both rendered on screen and flattened to text for sharing.
 *
 * The structure follows the Word templates in `Letterhead template design`,
 * which all share one shape: title, recipient, subject, salutation, body, a
 * details table, a closing, and a signature block that the two countersigned
 * letters give a second column to.
 */

export const LETTER_TITLES: Record<LetterType, string> = {
  offer: "Letter of Offer",
  appointment: "Appointment Letter",
  joining: "Confirmation of Joining",
  experience: "Experience Certificate",
  relieving: "Relieving Letter",
  certificate: "Certificate of Employment",
  internship: "Internship Offer & Engagement Letter",
  promotion: "Promotion & Increment Letter",
  appraisal: "Annual Appraisal & Salary Revision Letter",
  confirmation: "Probation Confirmation Letter",
  warning: "Formal Warning Notice",
  termination: "Letter of Termination",
}

export const LETTER_CHOICES: { value: LetterType; label: string }[] = [
  { value: "offer", label: "Offer Letter" },
  { value: "joining", label: "Joining Letter (Reporting for Duty)" },
  { value: "appointment", label: "Appointment Letter" },
  { value: "confirmation", label: "Probation Confirmation" },
  { value: "promotion", label: "Promotion & Increment" },
  { value: "appraisal", label: "Salary Appraisal Letter" },
  { value: "internship", label: "Internship Offer" },
  { value: "experience", label: "Experience Certificate" },
  { value: "relieving", label: "Relieving Letter" },
  { value: "certificate", label: "Employment Certificate" },
  { value: "warning", label: "Warning Notice" },
  { value: "termination", label: "Termination Letter" },
]

/** The reference-line abbreviation, matching the templates: WPL/HR/OFR/2026/001 */
const REF_ABBREV: Record<LetterType, string> = {
  offer: "OFR",
  appointment: "APT",
  joining: "JON",
  experience: "EXP",
  relieving: "REL",
  certificate: "CERT",
  internship: "INT",
  promotion: "PRM",
  appraisal: "APR",
  confirmation: "CNF",
  warning: "WRN",
  termination: "TRM",
}

/** Countersigned by the employee; the others are issued, not agreed. */
const COUNTERSIGNED: LetterType[] = [
  "offer",
  "appointment",
  "joining",
  "internship",
  "promotion",
  "warning",
  "termination",
]

/** Letters that state commercial terms, and so collect them on the form. */
export const STATES_TERMS: LetterType[] = [
  "offer",
  "appointment",
  "joining",
  "confirmation",
  "promotion",
  "appraisal",
  "internship",
]

export const DEFAULT_PROBATION = "Six months from the date of joining"
export const DEFAULT_NOTICE_PERIOD = "Thirty days on either side after confirmation"

export interface LetterDoc {
  title: string
  /** "Ref: WPL/HR/OFR/2026/001", as the templates print it. */
  refLine: string
  dateLine: string
  companyName: string
  companyAddress: string | null
  /** Name and address, or null where the letter addresses the world instead. */
  recipient: { name: string; address: string | null } | null
  subject: string | null
  salutation: string
  body: string[]
  details: { label: string; value: string }[]
  closing: string | null
  /** Whatever HR typed into the custom message box, if anything. */
  note: string | null
  signOff: string
  countersignedBy: string | null
  /** Used for the share sheet's subject line. */
  employeeName: string
  employeeCode: string
}

function formatDate(value: string): string {
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return value
  return d.toLocaleDateString("en-IN", { year: "numeric", month: "long", day: "numeric" })
}

function money(value: number | string): string {
  const n = Number(value)
  if (!Number.isFinite(n)) return "As per company policy"
  return "₹" + n.toLocaleString("en-IN", { maximumFractionDigits: 0 }) + " per annum"
}

export function buildLetter(letter: LetterPayload): LetterDoc {
  const designation = letter.designation_title ?? "your role"
  const department = letter.department_name ?? "your department"
  const joining = letter.joining_date ? formatDate(letter.joining_date) : "your date of joining"
  const today = formatDate(letter.today)
  const firstName = letter.employee_name.split(" ")[0]
  const company = letter.company_name

  const ctc = letter.annual_ctc == null ? "As per company policy" : money(letter.annual_ctc)
  const probation = letter.probation_text ?? DEFAULT_PROBATION
  const notice = letter.notice_period_text ?? DEFAULT_NOTICE_PERIOD

  // The two certificates address the world rather than the employee
  const addressesEmployee = letter.letter_type !== "certificate" && letter.letter_type !== "experience"

  const body: string[] = []
  const details: { label: string; value: string }[] = []
  let subject: string | null = null
  let closing: string | null = null

  switch (letter.letter_type) {
    case "offer":
      subject = "Offer of employment — " + designation + ", " + department
      body.push(
        "Further to our discussions and your interview with us, we are pleased to offer you the position of " +
          designation +
          " in the " +
          department +
          " function of " +
          company +
          ". Your appointment shall be effective from " +
          joining +
          (letter.reporting_manager_name
            ? " and you will report to " + letter.reporting_manager_name + "."
            : "."),
        "Your employment will be governed by the terms set out in this letter and by the policies of the LLP as amended from time to time. This offer is subject to satisfactory verification of your credentials and background checks."
      )
      details.push(
        { label: "Designation", value: designation },
        { label: "Department", value: department },
        { label: "Date of joining", value: joining },
        { label: "Annual CTC", value: ctc },
        { label: "Probation", value: probation },
        { label: "Notice period", value: notice }
      )
      closing =
        "Kindly sign and return a copy of this letter as a token of your acceptance. We look forward to your association with us and to the growth we will build together."
      break

    case "joining":
      subject = "Confirmation of Joining & Reporting for Duty — " + designation
      body.push(
        "We are delighted to formally welcome you to " +
          company +
          " and confirm your reporting for duty as " +
          designation +
          " in the " +
          department +
          " function, effective from " +
          joining +
          (letter.reporting_manager_name
            ? ". You will report to " + letter.reporting_manager_name + "."
            : "."),
        "This letter serves as an official acknowledgment that you have joined our organization, submitted all onboarding documentation, and been allocated Employee Code " +
          letter.employee_code +
          ".",
        "We are confident that your expertise and professional dedication will make a meaningful contribution to our team, and we look forward to a successful and rewarding journey together."
      )
      details.push(
        { label: "Employee code", value: letter.employee_code },
        { label: "Designation", value: designation },
        { label: "Department", value: department },
        { label: "Date of joining", value: joining },
        { label: "Annual CTC", value: ctc },
        { label: "Probation period", value: probation },
        { label: "Official workplace", value: letter.company_address ?? company }
      )
      closing = "Kindly sign and return a duplicate copy of this letter in acknowledgment of your reporting for duty."
      break

    case "appointment":
      subject = "Appointment — " + designation + ", " + department
      body.push(
        "With reference to your application and the discussions you have had with us, we are pleased to confirm your appointment as " +
          designation +
          " in the " +
          department +
          " function of " +
          company +
          ", with effect from " +
          joining +
          "." +
          (letter.reporting_manager_name
            ? " You will report to " + letter.reporting_manager_name + "."
            : ""),
        "Your services will be confirmed on satisfactory completion of the probation period stated above. Your employment shall be governed by the terms of this letter and by the policies of the LLP as amended from time to time, and you are expected to maintain the confidentiality of all information that comes to you in the course of your work."
      )
      details.push(
        { label: "Employee code", value: letter.employee_code },
        { label: "Designation", value: designation },
        { label: "Department", value: department },
        { label: "Date of joining", value: joining },
        { label: "Annual CTC", value: ctc },
        { label: "Probation", value: probation },
        { label: "Notice period", value: notice }
      )
      closing =
        "Kindly sign and return the duplicate copy of this letter in token of your acceptance. We welcome you to " +
        company +
        " and look forward to a long and rewarding association."
      break

    case "confirmation":
      subject = "Confirmation of Employment — " + designation
      body.push(
        "Further to your appointment as " +
          designation +
          " in the " +
          department +
          " department on " +
          joining +
          ", we have reviewed your performance and conduct during the probationary period.",
        "We are pleased to inform you that you have satisfactorily completed your probation, and your services with " +
          company +
          " are hereby confirmed as a regular, full-time permanent employee with effect from " +
          today +
          ".",
        "All terms and conditions of service applicable to confirmed staff shall now apply to you. We congratulate you on this milestone and look forward to your continued contribution."
      )
      details.push(
        { label: "Employee code", value: letter.employee_code },
        { label: "Designation", value: designation },
        { label: "Department", value: department },
        { label: "Original date of joining", value: joining },
        { label: "Confirmation effective date", value: today },
        { label: "Notice period", value: notice }
      )
      closing = "We appreciate your contribution and wish you ongoing success in your career with us."
      break

    case "promotion":
      subject = "Promotion to " + designation + " & Compensation Revision"
      body.push(
        "In recognition of your exceptional performance, sustained dedication, and valuable contributions to " +
          company +
          ", the Management is pleased to promote you to the position of " +
          designation +
          " in the " +
          department +
          " function, with effect from " +
          today +
          ".",
        "In alignment with your elevated role and expanded responsibilities, your Annual Cost to Company (CTC) has been revised to " +
          ctc +
          ". All other terms and conditions of your employment contract remain in full effect.",
        "We commend your consistent commitment to excellence and trust you will continue to inspire your team and drive significant value in your new capacity."
      )
      details.push(
        { label: "Employee code", value: letter.employee_code },
        { label: "New designation", value: designation },
        { label: "Department", value: department },
        { label: "Effective date", value: today },
        { label: "Revised annual CTC", value: ctc }
      )
      closing = "Please accept our heartiest congratulations on your well-deserved promotion."
      break

    case "appraisal":
      subject = "Annual Performance Appraisal & Compensation Revision"
      body.push(
        "Following our annual performance appraisal and compensation review, we take great pleasure in communicating the revision in your remuneration package at " +
          company +
          ".",
        "Effective from " +
          today +
          ", your Annual Cost to Company (CTC) has been enhanced to " +
          ctc +
          " in recognition of your dedicated services as " +
          designation +
          " in the " +
          department +
          " team.",
        "We deeply appreciate your hard work, loyalty, and positive impact across our initiatives. We look forward to your continued enthusiasm and partnership in our collective growth."
      )
      details.push(
        { label: "Employee code", value: letter.employee_code },
        { label: "Designation", value: designation },
        { label: "Department", value: department },
        { label: "Revision effective date", value: today },
        { label: "Revised annual CTC", value: ctc }
      )
      closing = "Thank you for your dedicated contribution to our organizational objectives."
      break

    case "internship":
      subject = "Offer of Internship Engagement — " + department
      body.push(
        "We are pleased to offer you an engagement as an Intern / Trainee in the " +
          department +
          " team at " +
          company +
          ", commencing from " +
          joining +
          (letter.reporting_manager_name
            ? ". You will work under the mentorship of " + letter.reporting_manager_name + "."
            : "."),
        "During this period, you will gain practical industry experience, contribute to real-world projects, and receive mentorship. You are expected to observe company policies, protect proprietary information, and maintain professional standards throughout your tenure.",
        "Upon successful completion of your internship deliverables, you will receive an official Internship Completion Certificate."
      )
      details.push(
        { label: "Role / Track", value: designation + " (Intern)" },
        { label: "Department", value: department },
        { label: "Commencement date", value: joining },
        { label: "Monthly stipend / CTC", value: ctc },
        { label: "Internship duration", value: probation }
      )
      closing = "Kindly sign and return a duplicate copy of this letter in acceptance of the internship terms."
      break

    case "experience":
      body.push(
        "This is to certify that " +
          letter.employee_name +
          ", bearing Employee Code " +
          letter.employee_code +
          ", was employed with " +
          company +
          " from " +
          joining +
          " to " +
          today +
          ".",
        "At the time of relieving, they held the position of " +
          designation +
          " in the " +
          department +
          " function.",
        "During their tenure with us, they discharged the responsibilities entrusted to them with diligence, professional integrity and commitment. Their conduct throughout the period of service was found to be satisfactory.",
        "We place on record our appreciation for their contribution and wish them success in their future endeavours. This certificate is issued at the request of the employee for the purpose of record."
      )
      details.push(
        { label: "Employee code", value: letter.employee_code },
        { label: "Period of service", value: joining + " — " + today },
        { label: "Last designation", value: designation + ", " + department },
        { label: "Employment type", value: "Full-time / Permanent" }
      )
      break

    case "relieving":
      subject = "Relieving from Services — " + designation
      body.push(
        "This is to confirm that " +
          letter.employee_name +
          " (Employee Code " +
          letter.employee_code +
          ") has been relieved from their duties as " +
          designation +
          " in the " +
          department +
          " function at " +
          company +
          ", with effect from " +
          today +
          ".",
        "All company property in their possession has been returned and their dues have been settled. We thank them for their contribution during their tenure with us and wish them the very best in their future endeavours."
      )
      details.push(
        { label: "Employee code", value: letter.employee_code },
        { label: "Period of service", value: joining + " — " + today },
        { label: "Last designation", value: designation + ", " + department },
        { label: "Relieved with effect from", value: today }
      )
      break

    case "certificate":
      body.push(
        "This is to certify that " +
          letter.employee_name +
          ", bearing Employee Code " +
          letter.employee_code +
          ", is currently employed with " +
          company +
          " as " +
          designation +
          " in the " +
          department +
          " function, and has been since " +
          joining +
          ".",
        "This certificate is issued upon request for official verification and record purposes."
      )
      details.push(
        { label: "Employee code", value: letter.employee_code },
        { label: "Designation", value: designation + ", " + department },
        { label: "Date of joining", value: joining },
        { label: "Employment status", value: "Active" }
      )
      break

    case "warning":
      subject = "Formal Warning Notice — " + designation
      body.push(
        "This letter serves as a formal written warning regarding observed issues concerning your performance and compliance with company standards in your capacity as " +
          designation +
          " in the " +
          department +
          " department.",
        letter.custom_message
          ? letter.custom_message
          : "Despite prior feedback, your deliverables and adherence have fallen short of required standards. You are advised to take corrective steps immediately and maintain consistent performance.",
        "Failure to demonstrate the requisite improvement within the review timeframe may lead to further disciplinary measures in accordance with company policy."
      )
      details.push(
        { label: "Employee code", value: letter.employee_code },
        { label: "Designation", value: designation },
        { label: "Department", value: department },
        { label: "Date of notice", value: today },
        { label: "Notice category", value: "Formal Written Warning" }
      )
      closing = "Please acknowledge receipt of this notice by signing a copy for HR records."
      break

    case "termination":
      subject = "Letter of Separation / Termination — " + designation
      body.push(
        "We regret to inform you that your employment as " +
          designation +
          " in the " +
          department +
          " function with " +
          company +
          " stands terminated with effect from " +
          today +
          ".",
        letter.custom_message
          ? letter.custom_message
          : "This decision follows formal review and is in accordance with company policies and terms of your employment contract.",
        "You are requested to return all company assets, credentials, and equipment immediately. Your final dues and settlement will be disbursed post-clearance."
      )
      details.push(
        { label: "Employee code", value: letter.employee_code },
        { label: "Designation", value: designation },
        { label: "Department", value: department },
        { label: "Separation date", value: today },
        { label: "Separation status", value: "Formal Separation" }
      )
      closing = "We wish you the best in your future endeavors."
      break
  }

  const year = new Date(letter.today).getFullYear()

  return {
    title: LETTER_TITLES[letter.letter_type].toUpperCase(),
    refLine:
      "Ref: " +
      (letter.company_code ?? "HR") +
      "/HR/" +
      REF_ABBREV[letter.letter_type] +
      "/" +
      year +
      "/" +
      String(letter.id).padStart(3, "0"),
    dateLine: "Date: " + today,
    companyName: company,
    companyAddress: letter.company_address,
    recipient: addressesEmployee
      ? { name: letter.employee_name, address: letter.employee_address }
      : null,
    subject,
    salutation: addressesEmployee ? "Dear " + firstName + "," : "To Whomsoever It May Concern,",
    body,
    details,
    closing,
    note: letter.custom_message,
    signOff: letter.letter_type === "offer" ? "Yours sincerely," : "For " + company + ",",
    countersignedBy: COUNTERSIGNED.includes(letter.letter_type) ? letter.employee_name : null,
    employeeName: letter.employee_name,
    employeeCode: letter.employee_code,
  }
}

/**
 * The letter as plain text, for the share sheet.
 *
 * There is no PDF here on purpose. Producing one on the phone means another
 * native module and a second layout to keep in step with this one, while the
 * portal already renders the PDF from the same payload. What a phone is good at
 * is getting the words to someone now — into a chat, into a mail draft — and
 * that is what this is for.
 */
export function letterAsText(doc: LetterDoc): string {
  const lines: string[] = [doc.companyName]
  if (doc.companyAddress) lines.push(doc.companyAddress)
  lines.push("", doc.refLine, doc.dateLine, "", doc.title, "")

  if (doc.recipient) {
    lines.push(doc.recipient.name)
    if (doc.recipient.address) lines.push(doc.recipient.address)
    lines.push("")
  }
  if (doc.subject) lines.push("Subject: " + doc.subject, "")

  lines.push(doc.salutation, "")
  for (const paragraph of doc.body) lines.push(paragraph, "")

  for (const d of doc.details) lines.push(d.label + ": " + d.value)
  lines.push("")

  if (doc.closing) lines.push(doc.closing, "")
  if (doc.note) lines.push(doc.note, "")

  lines.push(doc.signOff, "", "Authorised Signatory", "Designated Partner / Head — Human Resources")
  if (doc.countersignedBy) {
    lines.push("", "Accepted and agreed", "", doc.countersignedBy, "Signature / Date")
  }
  return lines.join("\n")
}
